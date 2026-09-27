// One-time setup: sign in with the Google account that should own the sheets
// and save the refresh token to .env.
//
//   1. Put GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET in .env
//   2. node get-google-token.js
//   3. Approve in the browser window that opens
//   4. Copy GOOGLE_REFRESH_TOKEN from .env into Railway's Variables

require('dotenv').config();
const http = require('http');
const fs   = require('fs');
const path = require('path');
const { exec } = require('child_process');

const { GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET } = process.env;
if (!GOOGLE_CLIENT_ID || !GOOGLE_CLIENT_SECRET) {
  console.error('Set GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET in .env first.');
  process.exit(1);
}

const PORT     = 53682;
const REDIRECT = `http://127.0.0.1:${PORT}`;
const authUrl  = 'https://accounts.google.com/o/oauth2/v2/auth?' + new URLSearchParams({
  client_id:     GOOGLE_CLIENT_ID,
  redirect_uri:  REDIRECT,
  response_type: 'code',
  scope:         'https://www.googleapis.com/auth/drive.file',
  access_type:   'offline',
  prompt:        'consent',
});

function saveToEnv(token) {
  const envPath = path.join(__dirname, '.env');
  let env = fs.existsSync(envPath) ? fs.readFileSync(envPath, 'utf8') : '';
  env = /^GOOGLE_REFRESH_TOKEN=.*$/m.test(env)
    ? env.replace(/^GOOGLE_REFRESH_TOKEN=.*$/m, `GOOGLE_REFRESH_TOKEN=${token}`)
    : env.replace(/\n?$/, `\nGOOGLE_REFRESH_TOKEN=${token}\n`);
  fs.writeFileSync(envPath, env);
}

const server = http.createServer(async (req, res) => {
  const code  = new URL(req.url, REDIRECT).searchParams.get('code');
  const error = new URL(req.url, REDIRECT).searchParams.get('error');
  if (!code && !error) { res.end(); return; } // e.g. favicon

  let message;
  try {
    if (error) throw new Error(error);
    const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        code, client_id: GOOGLE_CLIENT_ID, client_secret: GOOGLE_CLIENT_SECRET,
        redirect_uri: REDIRECT, grant_type: 'authorization_code',
      }),
    });
    const data = await tokenRes.json();
    if (!data.refresh_token) throw new Error(data.error_description || data.error || 'No refresh token returned');
    saveToEnv(data.refresh_token);
    message = 'Done. GOOGLE_REFRESH_TOKEN was saved to .env. You can close this tab.';
    console.log('\n' + message);
  } catch (err) {
    message = 'Failed: ' + err.message;
    console.error('\n' + message);
  }
  res.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8' });
  res.end(message);
  server.close();
});

server.listen(PORT, '127.0.0.1', () => {
  console.log('Opening your browser to sign in with Google. If it does not open, visit:\n\n' + authUrl + '\n');
  const opener = process.platform === 'win32' ? `start "" "${authUrl}"`
               : process.platform === 'darwin' ? `open "${authUrl}"` : `xdg-open "${authUrl}"`;
  exec(opener);
});
