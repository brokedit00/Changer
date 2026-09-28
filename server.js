const express = require('express');
const multer = require('multer');
const AdmZip = require('adm-zip');
const fs = require('fs-extra');
const path = require('path');
const { glob } = require('glob');
const cors = require('cors');

const app = express();
const PORT = process.env.PORT || 3000;

// Ensure directories exist
const UPLOADS = path.join(__dirname, 'uploads');
const OUTPUTS = path.join(__dirname, 'outputs');
const TEMP = path.join(__dirname, 'temp');

fs.ensureDirSync(UPLOADS);
fs.ensureDirSync(OUTPUTS);
fs.ensureDirSync(TEMP);

app.use(cors());
app.use(express.static(path.join(__dirname, 'public')));
app.use(express.json());

// Multer setup
const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, UPLOADS),
  filename: (req, file, cb) => {
    const unique = Date.now() + '-' + Math.round(Math.random() * 1e9);
    cb(null, unique + '-' + file.originalname);
  }
});

const upload = multer({
  storage,
  limits: { fileSize: 100 * 1024 * 1024 } // 100MB
});

// Health check
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', message: 'Frontend Changer is running' });
});

// Main endpoint
app.post('/api/change', upload.fields([
  { name: 'project', maxCount: 1 },
  { name: 'config', maxCount: 1 },
  { name: 'images', maxCount: 20 }
]), async (req, res) => {
  const sessionId = Date.now().toString();
  const tempDir = path.join(TEMP, sessionId);
  const extractDir = path.join(tempDir, 'project');

  try {
    // Validate uploads
    if (!req.files || !req.files.project || !req.files.project[0]) {
      return res.status(400).json({ error: 'Project ZIP file is required' });
    }
    if (!req.files.config || !req.files.config[0]) {
      return res.status(400).json({ error: 'Config JSON file is required' });
    }

    await fs.ensureDir(extractDir);

    // 1. Extract project ZIP
    const projectZip = new AdmZip(req.files.project[0].path);
    projectZip.extractAllTo(extractDir, true);

    // Find the actual root (sometimes zips have a single top-level folder)
    let projectRoot = extractDir;
    const entries = await fs.readdir(extractDir);
    if (entries.length === 1) {
      const possibleRoot = path.join(extractDir, entries[0]);
      const stat = await fs.stat(possibleRoot);
      if (stat.isDirectory()) {
        projectRoot = possibleRoot;
      }
    }

    // 2. Load config
    const configRaw = await fs.readFile(req.files.config[0].path, 'utf8');
    let config;
    try {
      config = JSON.parse(configRaw);
    } catch (e) {
      return res.status(400).json({ error: 'Invalid JSON in config file' });
    }

    const changes = {
      textReplacements: 0,
      imagesReplaced: 0,
      filesProcessed: 0
    };

    // 3. Text replacements
    const patterns = [
      '**/*.{js,jsx,ts,tsx,mjs,cjs}',
      '**/*.{html,htm}',
      '**/*.{json,jsonc}',
      '**/*.{css,scss,sass,less}',
      '**/*.{env,env.*}',
      '**/*.{md,txt}',
      '**/manifest.json',
      '**/package.json',
      '**/index.html'
    ];

    const ignore = [
      '**/node_modules/**',
      '**/.git/**',
      '**/dist/**',
      '**/build/**',
      '**/.next/**',
      '**/coverage/**',
      '**/*.min.js',
      '**/*.map'
    ];

    let textFiles = [];
    for (const pattern of patterns) {
      const matches = await glob(pattern, {
        cwd: projectRoot,
        absolute: true,
        nodir: true,
        ignore,
        dot: true
      });
      textFiles = textFiles.concat(matches);
    }
    // unique
    textFiles = [...new Set(textFiles)];

    for (const file of textFiles) {
      try {
        let content = await fs.readFile(file, 'utf8');
        let original = content;

        // App name replacements
        if (config.oldAppName && config.appName) {
          // Case-sensitive exact
          content = content.split(config.oldAppName).join(config.appName);
          // Also common title-case / lower variations if different
          if (config.oldAppName.toLowerCase() !== config.appName.toLowerCase()) {
            content = content.split(config.oldAppName.toLowerCase()).join(config.appName.toLowerCase());
            content = content.split(config.oldAppName.toUpperCase()).join(config.appName.toUpperCase());
          }
        }

        // API Base URL
        if (config.oldApiBaseUrl && config.apiBaseUrl) {
          content = content.split(config.oldApiBaseUrl).join(config.apiBaseUrl);
        }

        // API Key
        if (config.oldApiKey && config.apiKey) {
          content = content.split(config.oldApiKey).join(config.apiKey);
        }

        // Extra custom replacements
        if (Array.isArray(config.replacements)) {
          for (const r of config.replacements) {
            if (r.from && r.to !== undefined) {
              content = content.split(r.from).join(r.to);
            }
          }
        }

        if (content !== original) {
          await fs.writeFile(file, content, 'utf8');
          changes.textReplacements++;
        }
        changes.filesProcessed++;
      } catch (err) {
        // skip binary or unreadable files
        console.warn(`Skipped file ${file}: ${err.message}`);
      }
    }

    // 4. Image replacements
    if (req.files.images && req.files.images.length > 0) {
      // config.images can be: { "logo.png": "new-logo.png" } or just match by filename
      const imageMap = config.images || {};

      for (const img of req.files.images) {
        const originalName = img.originalname;
        // Find target filename: either mapped or same name
        const targetName = imageMap[originalName] || originalName;

        // Search for files with that name in the project
        const found = await glob(`**/${targetName}`, {
          cwd: projectRoot,
          absolute: true,
          nodir: true,
          ignore: ['**/node_modules/**', '**/.git/**']
        });

        if (found.length > 0) {
          for (const targetPath of found) {
            await fs.copy(img.path, targetPath);
            changes.imagesReplaced++;
          }
        } else {
          // If not found, try to place in common asset folders
          const commonDirs = ['public', 'src/assets', 'assets', 'static', 'images', 'img'];
          let placed = false;
          for (const dir of commonDirs) {
            const candidate = path.join(projectRoot, dir, targetName);
            if (await fs.pathExists(path.dirname(candidate))) {
              await fs.copy(img.path, candidate);
              changes.imagesReplaced++;
              placed = true;
              break;
            }
          }
          if (!placed) {
            // Create public folder and put it there
            const fallback = path.join(projectRoot, 'public', targetName);
            await fs.ensureDir(path.dirname(fallback));
            await fs.copy(img.path, fallback);
            changes.imagesReplaced++;
          }
        }
      }
    }

    // 5. Create output ZIP
    const outputZipPath = path.join(OUTPUTS, `changed-${sessionId}.zip`);
    const outputZip = new AdmZip();

    // Add the project root contents
    outputZip.addLocalFolder(projectRoot, path.basename(projectRoot) === 'project' ? '' : path.basename(projectRoot));
    // Better: always put contents at root of zip
    // Re-do cleanly
    const cleanZip = new AdmZip();
    const allFiles = await glob('**/*', {
      cwd: projectRoot,
      absolute: true,
      nodir: false,
      dot: true,
      ignore: ['**/node_modules/**', '**/.git/**']
    });

    for (const f of allFiles) {
      const rel = path.relative(projectRoot, f);
      const stat = await fs.stat(f);
      if (stat.isFile()) {
        cleanZip.addLocalFile(f, path.dirname(rel) === '.' ? '' : path.dirname(rel));
      }
    }
    cleanZip.writeZip(outputZipPath);

    // Cleanup uploaded files
    await cleanupUploads(req.files);

    // Send the zip
    res.download(outputZipPath, `frontend-changed-${sessionId}.zip`, async (err) => {
      // cleanup after download
      setTimeout(async () => {
        try {
          await fs.remove(tempDir);
          await fs.remove(outputZipPath);
        } catch (_) {}
      }, 60_000); // keep for 1 min
    });

  } catch (err) {
    console.error('Error processing:', err);
    await fs.remove(tempDir).catch(() => {});
    res.status(500).json({ error: err.message || 'Internal server error' });
  }
});

async function cleanupUploads(files) {
  if (!files) return;
  for (const key of Object.keys(files)) {
    for (const f of files[key]) {
      await fs.remove(f.path).catch(() => {});
    }
  }
}

// Simple cleanup of old temp/output every hour
setInterval(async () => {
  try {
    const now = Date.now();
    for (const dir of [TEMP, OUTPUTS, UPLOADS]) {
      const items = await fs.readdir(dir);
      for (const item of items) {
        const full = path.join(dir, item);
        const stat = await fs.stat(full);
        if (now - stat.mtimeMs > 2 * 60 * 60 * 1000) { // 2 hours
          await fs.remove(full).catch(() => {});
        }
      }
    }
  } catch (_) {}
}, 60 * 60 * 1000);

app.listen(PORT, () => {
  console.log(`\nð Frontend Changer running at http://localhost:${PORT}`);
  console.log(`   Open the browser and start changing frontends!\n`);
});
