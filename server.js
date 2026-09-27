require('dotenv').config();
const express    = require('express');
const fs         = require('fs');
const path       = require('path');
const nodemailer = require('nodemailer');
const LEAD_TYPES = require('./lead-types');
const { createSheet } = require('./google');

const app  = express();
const PORT = process.env.PORT || 3005;
const DATA_DIR = path.join(__dirname, 'data');
const LOG_FILE = path.join(DATA_DIR, 'sends.json');
const DRY_RUN  = process.env.DRY_RUN === 'true';

app.use(express.json());
app.use(express.urlencoded({ extended: true })); // Zapier / form tools often send form-encoded

// ── Input normalization ───────────────────────────────────

// "Tipo de Lead", "tipo_de_lead", "tipoDeLead" -> "tipodelead"
const norm = s => String(s || '').toLowerCase().normalize('NFD').replace(/[^a-z0-9]/g, '');

// Accepted field names for each input (compared after norm()).
const FIELD_ALIASES = {
  agentName: ['agentname', 'agent', 'nombre', 'nombreagente', 'nombredelagente', 'name'],
  phone:     ['phone', 'telefono', 'phonenumber', 'celular'],
  email:     ['email', 'correo', 'correoelectronico', 'emailaddress'],
  tipoLead:  ['tipodelead', 'tipolead', 'tipo', 'leadtype', 'type'],
};

function readFields(body) {
  const byNorm = {};
  for (const [k, v] of Object.entries(body || {})) byNorm[norm(k)] = v;
  const out = {};
  for (const [field, aliases] of Object.entries(FIELD_ALIASES)) {
    const hit = aliases.find(a => byNorm[a] != null && String(byNorm[a]).trim() !== '');
    out[field] = hit ? String(byNorm[hit]).trim() : '';
  }
  return out;
}

function findLeadType(tipo) {
  const key = Object.keys(LEAD_TYPES).find(k => norm(k) === norm(tipo));
  return key ? { name: key, headers: LEAD_TYPES[key] } : null;
}

// ── Email ─────────────────────────────────────────────────

const SMTP_PORT = parseInt(process.env.SMTP_PORT || '465');
const transporter = nodemailer.createTransport({
  host:   process.env.SMTP_HOST,
  port:   SMTP_PORT,
  secure: SMTP_PORT === 465, // 465 = SSL; 587 = STARTTLS
  // Fail fast so the webhook answers well inside the caller's 60s limit
  connectionTimeout: 10000,
  greetingTimeout:   10000,
  socketTimeout:     20000,
  auth: {
    user: process.env.SMTP_USER,
    pass: process.env.SMTP_PASS,
  },
});

const escapeHtml = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

async function sendSheetLink({ agentName, email }, leadType, url) {
  const greeting = agentName ? `Hi ${agentName},` : 'Hi,';
  await transporter.sendMail({
    from: `"${process.env.FROM_NAME || 'LEADS TFC'}" <${process.env.SMTP_USER}>`,
    to: email,
    subject: `Your ${leadType} spreadsheet`,
    text: `${greeting}\n\nHere is your ${leadType} spreadsheet:\n${url}\n`,
    html: `<p>${escapeHtml(greeting)}</p>
      <p>Here is your <b>${escapeHtml(leadType)}</b> spreadsheet:</p>
      <p><a href="${url}" style="display:inline-block;padding:10px 18px;background:#000;color:#fff;text-decoration:none;border-radius:6px">Open spreadsheet</a></p>
      <p style="color:#666;font-size:13px">Or copy this link: <a href="${url}">${url}</a></p>`,
  });
}

// ── Log ───────────────────────────────────────────────────

function logSend(entry) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  const log = fs.existsSync(LOG_FILE) ? JSON.parse(fs.readFileSync(LOG_FILE, 'utf8')) : [];
  log.push({ at: new Date().toISOString(), ...entry });
  fs.writeFileSync(LOG_FILE, JSON.stringify(log, null, 2));
}

// ── Routes ────────────────────────────────────────────────

app.post('/webhook', async (req, res) => {
  console.log('Webhook received:', JSON.stringify(req.body));
  const fields = readFields(req.body);
  if (!fields.email) {
    console.log('Rejected: email is required');
    return res.status(400).json({ error: 'email is required' });
  }
  if (!fields.tipoLead) {
    console.log('Rejected: tipo de lead is required');
    return res.status(400).json({ error: 'tipo de lead is required' });
  }
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(fields.email)) {
    console.log(`Rejected: invalid email "${fields.email}"`);
    return res.status(400).json({ error: `Invalid email: ${fields.email}` });
  }

  const leadType = findLeadType(fields.tipoLead);
  if (!leadType) {
    console.log(`Rejected: unknown tipo de lead "${fields.tipoLead}"`);
    logSend({ ...fields, status: 'rejected', error: 'unknown tipo de lead' });
    return res.status(400).json({
      error: `Unknown tipo de lead: "${fields.tipoLead}"`,
      validTypes: Object.keys(LEAD_TYPES),
    });
  }

  const date  = new Date().toISOString().slice(0, 10);
  const title = [leadType.name, fields.agentName, date].filter(Boolean).join(' - ');

  if (DRY_RUN) {
    console.log(`Dry run: would create "${title}" and email it to ${fields.email}`);
    logSend({ ...fields, leadType: leadType.name, status: 'dry-run' });
    return res.json({ success: true, leadType: leadType.name, sentTo: fields.email, dryRun: true });
  }

  console.log(`Creating "${title}" for ${fields.email}...`);
  try {
    const { url, sharing } = await createSheet(title, leadType.headers, fields.email);
    console.log(`Created ${url} (shared: ${sharing})`);
    await sendSheetLink(fields, leadType.name, url);
    console.log(`Sent ${leadType.name} sheet link to ${fields.email}`);
    logSend({ ...fields, leadType: leadType.name, status: 'sent', url, sharing });
    res.json({ success: true, leadType: leadType.name, sentTo: fields.email, sheetUrl: url, sharing });
  } catch (err) {
    console.error('Send failed:', err.message);
    logSend({ ...fields, leadType: leadType.name, status: 'failed', error: err.message });
    res.status(500).json({ error: 'Failed to send spreadsheet: ' + err.message });
  }
});

app.get('/', (req, res) => res.json({ ok: true, service: 'sheet-sender', leadTypes: Object.keys(LEAD_TYPES) }));

app.listen(PORT, () => {
  console.log(`Sheet Sender: http://localhost:${PORT}  (webhook: POST /webhook)`);
  if (DRY_RUN) console.log('DRY_RUN is on: no sheets are created and no emails are sent');
  if (!process.env.SMTP_HOST || !process.env.SMTP_USER || !process.env.SMTP_PASS)
    console.warn('WARNING: SMTP_HOST / SMTP_USER / SMTP_PASS not set; emails will fail. Copy .env.example to .env.');
  if (!process.env.GOOGLE_CLIENT_ID || !process.env.GOOGLE_CLIENT_SECRET || !process.env.GOOGLE_REFRESH_TOKEN)
    console.warn('WARNING: GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET / GOOGLE_REFRESH_TOKEN not set; sheets cannot be created. See README.');
});
