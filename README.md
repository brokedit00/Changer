# Frontend Changer

A simple tool that takes any frontend (or full-stack) web project, changes the **name**, **images**, **API URLs** and **keys**, then gives you a downloadable ZIP of the modified project.

## Features

- Upload a project as `.zip`
- Provide a simple JSON config for what to change
- Optionally upload new images (logo, favicon, etc.)
- Automatic find-and-replace across JS/TS/HTML/CSS/JSON/ENV files
- Image file swapping
- Clean download of the modified project

## Quick Start

```bash
cd frontend-changer
npm install
npm start
```

Then open **http://localhost:3000** in your browser.

## How to use

1. **Zip your project** (the whole frontend folder or full-stack repo).
2. Create a `config.json` like this:

```json
{
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
}
```

3. Upload the ZIP + paste the config + (optional) new images.
4. Click **Change Frontend & Download**.

## What gets changed

| Item              | How it works                                      |
|-------------------|---------------------------------------------------|
| App / Brand Name  | Replaces `oldAppName` â `appName` everywhere     |
| API Base URL      | Replaces old URL with new one                     |
| API Keys          | Replaces old key with new key                     |
| Images            | Swaps files that match the name you upload        |
| Custom text       | Any extra `from` â `to` pairs you add             |

## Notes

- Ignores `node_modules`, `.git`, `dist`, `build`, `.next`
- Works best when you give the exact old strings that exist in the code
- Only changes text files + image files â does not rewrite business logic
- Max upload size: 100 MB

## Example config file

See `example-config.json` in this folder.
