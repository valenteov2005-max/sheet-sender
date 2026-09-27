# Sheet Sender

Webhook that receives an agent's info plus a "tipo de lead", creates a Google Sheet with the headers for that lead type, shares it with the agent, and emails them the link.

Sheets are created in a **Sheet Sender** folder in the Google Drive of the account set up below.

## Setup

1. `cd sheet-sender && npm install`
2. Copy `.env.example` to `.env` and fill in the `SMTP_*` settings for the sending email account.
3. Do the Google setup below.
4. `npm start` (runs on port 3005)

## Google setup (one time)

1. Go to https://console.cloud.google.com and create a project (e.g. "Sheet Sender").
2. **APIs & Services → Library**: enable **Google Drive API** and **Google Sheets API**.
3. **APIs & Services → OAuth consent screen**: choose **External**, fill in app name and your email, add scope `.../auth/drive.file`, save. Then click **Publish app** (so the login doesn't expire after 7 days; `drive.file` doesn't need Google verification).
4. **APIs & Services → Credentials → Create credentials → OAuth client ID**: type **Desktop app**. Copy the client ID and secret into `.env` as `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET`.
5. Run `npm run google-token` and sign in with the Google account that should own the sheets. It saves `GOOGLE_REFRESH_TOKEN` to `.env`.
6. Add `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` and `GOOGLE_REFRESH_TOKEN` to Railway's Variables.

The app only gets access to files it creates itself (`drive.file` scope), not the rest of the Drive.

## Webhook

`POST /webhook` with JSON or form-encoded body:

| Field | Accepted names (case/spaces/accents ignored) |
|---|---|
| Agent name | `agentName`, `agent_name`, `Agent Name`, `nombre` |
| Phone | `phone`, `telefono`, `celular` |
| Email (required) | `email`, `correo` |
| Tipo de lead (required) | `tipoDeLead`, `tipo_de_lead`, `Tipo de Lead`, `tipo`, `leadType` |

The sheet is shared with the agent's email as an editor. If that email has no Google account, Google refuses to share with it directly, so the sheet is set to "anyone with the link can edit" instead.

Unknown lead types are rejected with a 400 that lists the valid ones. Every request is logged to the console and `data/sends.json`.

## Lead types

Edit `lead-types.js` to add types or change headers, then restart.
