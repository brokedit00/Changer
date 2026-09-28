const express = require('express');
const multer = require('multer');
const AdmZip = require('adm-zip');
const fs = require('fs-extra');
const path = require('path');
const { glob } = require('glob');
const cors = require('cors');

const app = express();
const PORT = process.env.PORT || 3000;

const UPLOADS = path.join(__dirname, 'uploads');
const OUTPUTS = path.join(__dirname, 'outputs');
const TEMP = path.join(__dirname, 'temp');

fs.ensureDirSync(UPLOADS);
fs.ensureDirSync(OUTPUTS);
fs.ensureDirSync(TEMP);

app.use(cors());
app.use(express.json());

// ========== FULL HTML EMBEDDED HERE ==========
const HTML = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Frontend Changer</title>
  <style>
    :root {
      --bg: #0f0f12;
      --card: #1a1a21;
      --border: #2a2a35;
      --text: #e8e8ed;
      --muted: #9a9aab;
      --accent: #6366f1;
      --accent-hover: #818cf8;
    }
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      font-family: system-ui, -apple-system, sans-serif;
      background: var(--bg);
      color: var(--text);
      min-height: 100vh;
      line-height: 1.5;
    }
    .container { max-width: 720px; margin: 0 auto; padding: 40px 20px; }
    header { text-align: center; margin-bottom: 40px; }
    header h1 {
      font-size: 2rem; font-weight: 700;
      background: linear-gradient(135deg, #818cf8, #c084fc);
      -webkit-background-clip: text; -webkit-text-fill-color: transparent;
      margin-bottom: 8px;
    }
    header p { color: var(--muted); }
    .card {
      background: var(--card); border: 1px solid var(--border);
      border-radius: 16px; padding: 28px; margin-bottom: 24px;
    }
    .card h2 {
      font-size: 1.1rem; font-weight: 600; margin-bottom: 16px;
      display: flex; align-items: center; gap: 8px;
    }
    .card h2 span {
      background: var(--accent); color: white; width: 24px; height: 24px;
      border-radius: 50%; display: inline-flex; align-items: center;
      justify-content: center; font-size: 0.75rem;
    }
    label { display: block; font-size: 0.875rem; color: var(--muted); margin-bottom: 6px; }
    input[type="file"], textarea {
      width: 100%; background: #121217; border: 1px solid var(--border);
      border-radius: 10px; padding: 12px 14px; color: var(--text);
      font-size: 0.9rem; margin-bottom: 16px;
    }
    textarea {
      min-height: 180px; font-family: monospace; font-size: 0.82rem; resize: vertical;
    }
    .file-info { font-size: 0.8rem; color: var(--muted); margin-top: -10px; margin-bottom: 16px; }
    .btn {
      display: inline-flex; align-items: center; justify-content: center;
      background: var(--accent); color: white; border: none; border-radius: 12px;
      padding: 14px 28px; font-size: 1rem; font-weight: 600; cursor: pointer; width: 100%;
    }
    .btn:disabled { opacity: 0.6; }
    .status { margin-top: 20px; padding: 14px 16px; border-radius: 10px; font-size: 0.9rem; display: none; }
    .status.success { display: block; background: rgba(34,197,94,0.12); color: #4ade80; }
    .status.error { display: block; background: rgba(239,68,68,0.12); color: #f87171; }
    .status.loading { display: block; background: rgba(99,102,241,0.12); color: #a5b4fc; }
    .example-btn {
      background: transparent; border: 1px solid var(--border); color: var(--muted);
      padding: 6px 12px; border-radius: 8px; font-size: 0.8rem; cursor: pointer; margin-bottom: 12px;
    }
    footer { text-align: center; margin-top: 40px; color: var(--muted); font-size: 0.8rem; }
  </style>
</head>
<body>
  <div class="container">
    <header>
      <h1>Frontend Changer</h1>
      <p>Rebrand any frontend — change name, images, API URLs & keys in one click</p>
    </header>
    <form id="changerForm">
      <div class="card">
        <h2><span>1</span> Project ZIP</h2>
        <label>Upload your project (.zip)</label>
        <input type="file" id="project" accept=".zip" required />
        <p class="file-info">Supports React, Next.js, Vue, plain HTML, etc.</p>
      </div>
      <div class="card">
        <h2><span>2</span> Change Config (JSON)</h2>
        <button type="button" class="example-btn" id="loadExample">Load example config</button>
        <label>Paste or edit the JSON config</label>
        <textarea id="configText" spellcheck="false">{
  "appName": "MyNewApp",
  "oldAppName": "OldAppName",
  "apiBaseUrl": "https://api.mynewapp.com",
  "oldApiBaseUrl": "https://api.oldapp.com",
  "apiKey": "sk-new-secret-key",
  "oldApiKey": "sk-old-secret-key",
  "images": {
    "logo.png": "logo.png",
    "favicon.ico": "favicon.ico"
  },
  "replacements": [
    { "from": "Old Company", "to": "New Company" }
  ]
}</textarea>
      </div>
      <div class="card">
        <h2><span>3</span> New Images (optional)</h2>
        <label>Upload new logo, favicon, etc.</label>
        <input type="file" id="images" accept="image/*,.ico,.svg" multiple />
      </div>
      <button type="submit" class="btn" id="submitBtn">✨ Change Frontend & Download</button>
      <div id="status" class="status"></div>
    </form>
    <footer>Frontend Changer • Only modifies frontend files</footer>
  </div>
  <script>
    const form = document.getElementById('changerForm');
    const statusEl = document.getElementById('status');
    const submitBtn = document.getElementById('submitBtn');
    const configText = document.getElementById('configText');

    document.getElementById('loadExample').onclick = () => {
      configText.value = \`{
  "appName": "MyNewApp",
  "oldAppName": "OldAppName",
  "apiBaseUrl": "https://api.mynewapp.com",
  "oldApiBaseUrl": "https://api.oldapp.com",
  "apiKey": "sk-new-secret-key",
  "oldApiKey": "sk-old-secret-key",
  "images": { "logo.png": "logo.png", "favicon.ico": "favicon.ico" },
  "replacements": [{ "from": "Old Company", "to": "New Company" }]
}\`;
    };

    form.onsubmit = async (e) => {
      e.preventDefault();
      const projectFile = document.getElementById('project').files[0];
      if (!projectFile) return showStatus('Please select a project ZIP', 'error');

      let configObj;
      try { configObj = JSON.parse(configText.value); }
      catch { return showStatus('Invalid JSON', 'error'); }

      const formData = new FormData();
      formData.append('project', projectFile);
      formData.append('config', new Blob([JSON.stringify(configObj)], {type:'application/json'}), 'config.json');
      for (const f of document.getElementById('images').files) formData.append('images', f);

      submitBtn.disabled = true;
      showStatus('Processing…', 'loading');

      try {
        const res = await fetch('/api/change', { method: 'POST', body: formData });
        if (!res.ok) {
          const err = await res.json().catch(() => ({}));
          throw new Error(err.error || 'Server error');
        }
        const blob = await res.blob();
        const a = document.createElement('a');
        a.href = URL.createObjectURL(blob);
        a.download = 'frontend-changed.zip';
        a.click();
        showStatus('✅ Done! Downloaded.', 'success');
      } catch (err) {
        showStatus('❌ ' + err.message, 'error');
      } finally {
        submitBtn.disabled = false;
      }
    };

    function showStatus(msg, type) {
      statusEl.textContent = msg;
      statusEl.className = 'status ' + type;
    }
  </script>
</body>
</html>`;

// Serve the embedded HTML
app.get('/', (req, res) => {
  res.setHeader('Content-Type', 'text/html');
  res.send(HTML);
});

// Multer
const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, UPLOADS),
  filename: (req, file, cb) => cb(null, Date.now() + '-' + file.originalname)
});
const upload = multer({ storage, limits: { fileSize: 100 * 1024 * 1024 } });

app.post('/api/change', upload.fields([
  { name: 'project', maxCount: 1 },
  { name: 'config', maxCount: 1 },
  { name: 'images', maxCount: 20 }
]), async (req, res) => {
  const sessionId = Date.now().toString();
  const tempDir = path.join(TEMP, sessionId);
  const extractDir = path.join(tempDir, 'project');

  try {
    if (!req.files?.project?.[0]) return res.status(400).json({ error: 'Project ZIP required' });
    if (!req.files?.config?.[0]) return res.status(400).json({ error: 'Config required' });

    await fs.ensureDir(extractDir);
    const zip = new AdmZip(req.files.project[0].path);
    zip.extractAllTo(extractDir, true);

    let projectRoot = extractDir;
    const entries = await fs.readdir(extractDir);
    if (entries.length === 1) {
      const p = path.join(extractDir, entries[0]);
      if ((await fs.stat(p)).isDirectory()) projectRoot = p;
    }

    const config = JSON.parse(await fs.readFile(req.files.config[0].path, 'utf8'));

    const textFiles = await glob('**/*.{js,jsx,ts,tsx,html,htm,json,css,scss,env,env.*,md,txt}', {
      cwd: projectRoot, absolute: true, nodir: true,
      ignore: ['**/node_modules/**', '**/.git/**', '**/dist/**', '**/build/**', '**/.next/**']
    });

    for (const file of textFiles) {
      try {
        let content = await fs.readFile(file, 'utf8');
        const original = content;

        if (config.oldAppName && config.appName) {
          content = content.split(config.oldAppName).join(config.appName);
        }
        if (config.oldApiBaseUrl && config.apiBaseUrl) {
          content = content.split(config.oldApiBaseUrl).join(config.apiBaseUrl);
        }
        if (config.oldApiKey && config.apiKey) {
          content = content.split(config.oldApiKey).join(config.apiKey);
        }
        if (Array.isArray(config.replacements)) {
          for (const r of config.replacements) {
            if (r.from) content = content.split(r.from).join(r.to || '');
          }
        }

        if (content !== original) await fs.writeFile(file, content);
      } catch {}
    }

    // Images
    if (req.files.images) {
      for (const img of req.files.images) {
        const targetName = (config.images && config.images[img.originalname]) || img.originalname;
        const found = await glob(`**/${targetName}`, {
          cwd: projectRoot, absolute: true, nodir: true,
          ignore: ['**/node_modules/**']
        });
        if (found.length) {
          for (const t of found) await fs.copy(img.path, t);
        } else {
          const dest = path.join(projectRoot, 'public', targetName);
          await fs.ensureDir(path.dirname(dest));
          await fs.copy(img.path, dest);
        }
      }
    }

    const outPath = path.join(OUTPUTS, `changed-${sessionId}.zip`);
    const outZip = new AdmZip();
    const all = await glob('**/*', {
      cwd: projectRoot, absolute: true, nodir: true,
      ignore: ['**/node_modules/**', '**/.git/**']
    });
    for (const f of all) {
      outZip.addLocalFile(f, path.dirname(path.relative(projectRoot, f)));
    }
    outZip.writeZip(outPath);

    // cleanup uploads
    for (const key of Object.keys(req.files || {})) {
      for (const f of req.files[key]) await fs.remove(f.path).catch(() => {});
    }

    res.download(outPath, 'frontend-changed.zip', () => {
      setTimeout(() => {
        fs.remove(tempDir).catch(() => {});
        fs.remove(outPath).catch(() => {});
      }, 30000);
    });

  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

app.listen(PORT, () => {
  console.log(`Frontend Changer running on port ${PORT}`);
});
