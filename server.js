require('dotenv').config();
const express    = require('express');
const fs         = require('fs');
const path       = require('path');
const ExcelJS    = require('exceljs');
const nodemailer = require('nodemailer');
const LEAD_TYPES = require('./lead-types');

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

// ── Spreadsheet ───────────────────────────────────────────

async function buildWorkbook(headers, sheetName) {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet(sheetName.replace(/[\\/?*[\]:]/g, '').slice(0, 31)); // Excel sheet-name rules
  if (!headers.length) return wb.xlsx.writeBuffer();
  ws.columns = headers.map(h => ({ header: h, width: Math.max(14, h.length + 4) }));
  const headerRow = ws.getRow(1);
  headerRow.font = { bold: true, color: { argb: 'FFFFFFFF' } };
  headerRow.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF000000' } };
  ws.views = [{ state: 'frozen', ySplit: 1 }];
  return wb.xlsx.writeBuffer();
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

async function sendSheet({ agentName, email }, leadType, filename, buffer) {
  const greeting = agentName ? `Hi ${agentName},` : 'Hi,';
  await transporter.sendMail({
    from: `"${process.env.FROM_NAME || 'LEADS TFC'}" <${process.env.SMTP_USER}>`,
    to: email,
    subject: `Your ${leadType} spreadsheet`,
    html: `<p>${greeting}</p><p>Attached is your <b>${leadType}</b> spreadsheet.</p>`,
    attachments: [{
      filename,
      content: buffer,
      contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    }],
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
  const fields = readFields(req.body);
  if (!fields.email)    return res.status(400).json({ error: 'email is required' });
  if (!fields.tipoLead) return res.status(400).json({ error: 'tipo de lead is required' });
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(fields.email))
    return res.status(400).json({ error: `Invalid email: ${fields.email}` });

  const leadType = findLeadType(fields.tipoLead);
  if (!leadType) {
    logSend({ ...fields, status: 'rejected', error: 'unknown tipo de lead' });
    return res.status(400).json({
      error: `Unknown tipo de lead: "${fields.tipoLead}"`,
      validTypes: Object.keys(LEAD_TYPES),
    });
  }

  const date     = new Date().toISOString().slice(0, 10);
  const filename = `${leadType.name.replace(/[^A-Za-z0-9]+/g, '-').replace(/^-|-$/g, '')}-${date}.xlsx`;

  try {
    const buffer = await buildWorkbook(leadType.headers, leadType.name);
    if (DRY_RUN) {
      fs.mkdirSync(DATA_DIR, { recursive: true });
      fs.writeFileSync(path.join(DATA_DIR, filename), buffer);
    } else {
      await sendSheet(fields, leadType.name, filename, buffer);
    }
    logSend({ ...fields, leadType: leadType.name, status: DRY_RUN ? 'dry-run' : 'sent' });
    res.json({ success: true, leadType: leadType.name, sentTo: fields.email, dryRun: DRY_RUN });
  } catch (err) {
    console.error('Send failed:', err.message);
    logSend({ ...fields, leadType: leadType.name, status: 'failed', error: err.message });
    res.status(500).json({ error: 'Failed to send spreadsheet: ' + err.message });
  }
});

app.get('/', (req, res) => res.json({ ok: true, service: 'sheet-sender', leadTypes: Object.keys(LEAD_TYPES) }));

app.listen(PORT, () => {
  console.log(`Sheet Sender: http://localhost:${PORT}  (webhook: POST /webhook)`);
  if (DRY_RUN) console.log('DRY_RUN is on: spreadsheets are saved to data/ instead of emailed');
  else if (!process.env.SMTP_HOST || !process.env.SMTP_USER || !process.env.SMTP_PASS)
    console.warn('WARNING: SMTP_HOST / SMTP_USER / SMTP_PASS not set; emails will fail. Copy .env.example to .env.');
});
