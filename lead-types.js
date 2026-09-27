// Spreadsheet headers for each "tipo de lead".
//
// The key is the lead type as it will arrive in the webhook. Matching ignores
// case, spaces and punctuation, so "Spanish Truckers", "spanish-truckers" and
// "SPANISH_TRUCKERS" all match the "SPANISH TRUCKERS" entry below.
// An empty list sends a blank spreadsheet with no header row.
//
// To add a lead type, add a new line with its headers. Restart the server after editing.

const ENGLISH_IUL = ['First Name', 'Last Name', 'Email', 'Phone', 'State', 'DOB_text', 'Primary_Goal', 'household_income', 'life_insurance', 'Timestamp'];
const SPANISH_IUL = ['First Name', 'Last Name', 'Email', 'Phone', 'State', 'Fecha_de_nacimiento', 'objetivo', 'ingreso_annual', 'tiene_seguro_de_vida?', 'Mejor_hora_para_llamar', 'Timestamp'];

module.exports = {
  'TRUCKER IUL':      ENGLISH_IUL,
  'SPANISH IUL':      SPANISH_IUL,
  'SPANISH FEX':      ['First Name', 'Last Name', 'Email', 'Phone', 'State', 'Beneficiary', 'Coverage', 'Coverage_Amount', 'DOB_text', 'Timestamp'],
  'SPANISH MP':       ['First Name', 'Last Name', 'Email', 'Phone', 'State', 'Coverage_Type', 'Monthly_Mortgage', 'beneficiary', 'DOB_text', 'Timestamp'],
  'SPANISH TRUCKERS': ['First Name', 'Last Name', 'Email', 'Phone', 'State', 'Fecha_de_nacimiento', 'objetivo', 'ingreso_annual', 'seguro_de_vida', 'Timestamp'],
  '$1 SPANISH':       [],
  'AGED SPANISH IUL': SPANISH_IUL,
  'AGED ENGLISH IUL': ENGLISH_IUL,
};
