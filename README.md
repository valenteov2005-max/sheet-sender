# Sheet Sender

Webhook that receives an agent's info plus a "tipo de lead", builds an `.xlsx` spreadsheet with the headers for that lead type, and emails it to the email that was sent.

## Setup

1. `cd sheet-sender && npm install`
2. Copy `.env.example` to `.env` and fill in the `SMTP_*` settings for the sending email account (GoDaddy settings are in the comments)
3. `npm start` (runs on port 3005)

## Webhook

`POST /webhook` with JSON or form-encoded body:

| Field | Accepted names (case/spaces/accents ignored) |
|---|---|
| Agent name | `agentName`, `agent_name`, `Agent Name`, `nombre` |
| Phone | `phone`, `telefono`, `celular` |
| Email (required) | `email`, `correo` |
| Tipo de lead (required) | `tipoDeLead`, `tipo_de_lead`, `Tipo de Lead`, `tipo`, `leadType` |

Unknown lead types are rejected with a 400 that lists the valid ones. Every request is logged to `data/sends.json`.

## Lead types

Edit `lead-types.js` to add types or change headers, then restart.
