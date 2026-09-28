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
app.use(express.json());

// Serve static files
app.use(express.static(path.join(__dirname, 'public')));

// Explicitly serve index.html on root
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

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
  limits: { fileSize: 100 * 1024 * 1024 }
});

app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', message: 'Frontend Changer is running' });
});

app.post('/api/change', upload.fields([
  { name: 'project', maxCount: 1 },
  { name: 'config', maxCount: 1 },
  { name: 'images', maxCount: 20 }
]), async (req, res) => {
  const sessionId = Date.now().toString();
  const tempDir = path.join(TEMP, sessionId);
  const extractDir = path.join(tempDir, 'project');

  try {
    if (!req.files || !req.files.project || !req.files.project[0]) {
      return res.status(400).json({ error: 'Project ZIP file is required' });
    }
    if (!req.files.config || !req.files.config[0]) {
      return res.status(400).json({ error: 'Config JSON file is required' });
    }

    await fs.ensureDir(extractDir);

    const projectZip = new AdmZip(req.files.project[0].path);
    projectZip.extractAllTo(extractDir, true);

    let projectRoot = extractDir;
    const entries = await fs.readdir(extractDir);
    if (entries.length === 1) {
      const possibleRoot = path.join(extractDir, entries[0]);
      const stat = await fs.stat(possibleRoot);
      if (stat.isDirectory()) {
        projectRoot = possibleRoot;
      }
    }

    const configRaw = await fs.readFile(req.files.config[0].path, 'utf8');
    let config;
    try {
      config = JSON.parse(configRaw);
    } catch (e) {
      return res.status(400).json({ error: 'Invalid JSON in config file' });
    }

    const changes = { textReplacements: 0, imagesReplaced: 0, filesProcessed: 0 };

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
    textFiles = [...new Set(textFiles)];

    for (const file of textFiles) {
      try {
        let content = await fs.readFile(file, 'utf8');
        let original = content;

        if (config.oldAppName && config.appName) {
          content = content.split(config.oldAppName).join(config.appName);
          if (config.oldAppName.toLowerCase() !== config.appName.toLowerCase()) {
            content = content.split(config.oldAppName.toLowerCase()).join(config.appName.toLowerCase());
            content = content.split(config.oldAppName.toUpperCase()).join(config.appName.toUpperCase());
          }
        }

        if (config.oldApiBaseUrl && config.apiBaseUrl) {
          content = content.split(config.oldApiBaseUrl).join(config.apiBaseUrl);
        }

        if (config.oldApiKey && config.apiKey) {
          content = content.split(config.oldApiKey).join(config.apiKey);
        }

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
        console.warn(`Skipped file ${file}: ${err.message}`);
      }
    }

    if (req.files.images && req.files.images.length > 0) {
      const imageMap = config.images || {};

      for (const img of req.files.images) {
        const originalName = img.originalname;
        const targetName = imageMap[originalName] || originalName;

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
            const fallback = path.join(projectRoot, 'public', targetName);
            await fs.ensureDir(path.dirname(fallback));
            await fs.copy(img.path, fallback);
            changes.imagesReplaced++;
          }
        }
      }
    }

    const outputZipPath = path.join(OUTPUTS, `changed-${sessionId}.zip`);
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
    if (req.files) {
      for (const key of Object.keys(req.files)) {
        for (const f of req.files[key]) {
          await fs.remove(f.path).catch(() => {});
        }
      }
    }

    res.download(outputZipPath, `frontend-changed-${sessionId}.zip`, async (err) => {
      setTimeout(async () => {
        try {
          await fs.remove(tempDir);
          await fs.remove(outputZipPath);
        } catch (_) {}
      }, 60000);
    });

  } catch (err) {
    console.error('Error processing:', err);
    await fs.remove(tempDir).catch(() => {});
    res.status(500).json({ error: err.message || 'Internal server error' });
  }
});

app.listen(PORT, () => {
  console.log(`\n🚀 Frontend Changer running at http://localhost:${PORT}`);
  console.log(`   Open the browser and start changing frontends!\n`);
});
