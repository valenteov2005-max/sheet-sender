// Google Drive / Sheets helpers using plain REST + an OAuth refresh token.
// The sheets are owned by the Google account that ran get-google-token.js.
// Scope is drive.file: the app can only see files it created itself.

const FOLDER_NAME = process.env.GOOGLE_FOLDER_NAME || 'Sheet Sender';

let accessToken = null;
let tokenExpires = 0;
let folderId = null;

async function getAccessToken() {
  if (accessToken && Date.now() < tokenExpires - 60000) return accessToken;
  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id:     process.env.GOOGLE_CLIENT_ID,
      client_secret: process.env.GOOGLE_CLIENT_SECRET,
      refresh_token: process.env.GOOGLE_REFRESH_TOKEN,
      grant_type:    'refresh_token',
    }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(`Google auth failed: ${data.error_description || data.error}`);
  accessToken  = data.access_token;
  tokenExpires = Date.now() + data.expires_in * 1000;
  return accessToken;
}

async function google(method, url, body) {
  const res = await fetch(url, {
    method,
    headers: { Authorization: `Bearer ${await getAccessToken()}`, 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = new Error(`Google API ${res.status}: ${data.error?.message || res.statusText}`);
    err.status = res.status;
    throw err;
  }
  return data;
}

const DRIVE = 'https://www.googleapis.com/drive/v3/files';

// Finds (or creates) the "Sheet Sender" folder. With drive.file scope the
// search only sees folders this app created, so it never picks up other folders.
async function getFolderId() {
  if (folderId) return folderId;
  const q = `name='${FOLDER_NAME.replace(/'/g, "\\'")}' and mimeType='application/vnd.google-apps.folder' and trashed=false`;
  const found = await google('GET', `${DRIVE}?q=${encodeURIComponent(q)}&fields=files(id)`);
  folderId = found.files[0]?.id
    || (await google('POST', DRIVE, { name: FOLDER_NAME, mimeType: 'application/vnd.google-apps.folder' })).id;
  return folderId;
}

// Creates a Google Sheet with a bold, frozen header row and shares it with `shareWith` as an editor.
// Returns { url, sharing } where sharing is 'email' or 'anyone-with-link'.
async function createSheet(title, headers, shareWith) {
  const file = await google('POST', `${DRIVE}?fields=id`, {
    name: title,
    mimeType: 'application/vnd.google-apps.spreadsheet',
    parents: [await getFolderId()],
  });

  if (headers.length) {
    await google('POST', `https://sheets.googleapis.com/v4/spreadsheets/${file.id}:batchUpdate`, {
      requests: [
        {
          updateCells: {
            start: { sheetId: 0, rowIndex: 0, columnIndex: 0 },
            rows: [{ values: headers.map(h => ({
              userEnteredValue:  { stringValue: h },
              userEnteredFormat: { textFormat: { bold: true } },
            })) }],
            fields: 'userEnteredValue,userEnteredFormat.textFormat.bold',
          },
        },
        {
          updateSheetProperties: {
            properties: { sheetId: 0, title: 'Leads', gridProperties: { frozenRowCount: 1 } },
            fields: 'title,gridProperties.frozenRowCount',
          },
        },
        { autoResizeDimensions: { dimensions: { sheetId: 0, dimension: 'COLUMNS', startIndex: 0, endIndex: headers.length } } },
      ],
    });
  }

  // Share with the agent's email. Google rejects this when the address has no
  // Google account, so fall back to "anyone with the link can edit".
  let sharing = 'email';
  try {
    await google('POST', `${DRIVE}/${file.id}/permissions?sendNotificationEmail=false`,
      { type: 'user', role: 'writer', emailAddress: shareWith });
  } catch (err) {
    if (err.status !== 400 && err.status !== 403) throw err;
    console.log(`Could not share with ${shareWith} (${err.message}); using anyone-with-link instead`);
    await google('POST', `${DRIVE}/${file.id}/permissions`, { type: 'anyone', role: 'writer' });
    sharing = 'anyone-with-link';
  }

  return { url: `https://docs.google.com/spreadsheets/d/${file.id}/edit`, sharing };
}

module.exports = { createSheet };
