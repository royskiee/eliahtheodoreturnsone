// =============================================================
// Elijah RSVP — Google Apps Script Web App
// Stores submissions in a Google Sheet + emails royvincentb@gmail.com
// =============================================================
//
// SETUP (one time):
// 1. Create a new Google Sheet titled "Elijah RSVPs".
//    Add this header row in row 1 (exact order):
//      timestamp | name | mobile | attending | adults | children | message | invite_type | user_agent | guest2_name | children_names
// 2. Copy the Sheet ID from its URL:
//      https://docs.google.com/spreadsheets/d/<SHEET_ID>/edit
//    Paste it into SHEET_ID below.
// 3. In the Sheet: Extensions → Apps Script. Replace the default
//    Code.gs with this file's contents. Save.
// 4. Click "Deploy" → "New deployment".
//    - Type: Web app
//    - Description: Elijah RSVP
//    - Execute as: Me (your Gmail account)
//    - Who has access: Anyone
//    Click Deploy, authorize, copy the Web App URL ending in /exec.
// 5. In index.html, replace PASTE_GAS_WEB_APP_URL_HERE with that URL.
// 6. Submit a test RSVP from the site. Confirm a row appears in the
//    Sheet AND you receive an email at NOTIFY_EMAIL.
//
// REDEPLOY whenever you edit this script:
//   Deploy → Manage deployments → pencil icon → Version: New version → Deploy.
//   (If you change the URL, paste the new one back into index.html.)
// =============================================================

const SHEET_ID    = '1WhJxo00HULJeItNXqGPHrO4wB8BonhEKjQJL2Rfy07A';
const NOTIFY_EMAIL = 'royvincentb@gmail.com';

function doPost(e) {
  try {
    const p = (e && e.parameter) ? e.parameter : {};
    const sheet = SpreadsheetApp.openById(SHEET_ID).getSheets()[0];

    // Duplicate-name guard — Sheet is the source of truth, so reject any
    // submission whose name already appears. Case + whitespace insensitive.
    const submittedName = String(p.name || '').trim().toLowerCase().replace(/\s+/g, ' ');
    if (!submittedName){
      return ContentService
        .createTextOutput(JSON.stringify({ ok: false, error: 'missing_name' }))
        .setMimeType(ContentService.MimeType.JSON);
    }
    // Normalize mobile to trailing 8 digits so +356 vs local forms still match.
    const submittedMobile = normalizeMobile_(p.mobile);
    const data = sheet.getDataRange().getValues();
    if (data.length >= 2){
      const headers = data[0].map(h => String(h).trim().toLowerCase());
      const nameCol = headers.indexOf('name');
      const mobileCol = headers.indexOf('mobile');
      for (let i = 1; i < data.length; i++){
        if (nameCol >= 0){
          const existing = String(data[i][nameCol] || '').trim().toLowerCase().replace(/\s+/g, ' ');
          if (existing && existing === submittedName){
            return ContentService
              .createTextOutput(JSON.stringify({ ok: false, error: 'duplicate_name' }))
              .setMimeType(ContentService.MimeType.JSON);
          }
        }
        if (mobileCol >= 0 && submittedMobile){
          const existingMobile = normalizeMobile_(data[i][mobileCol]);
          if (existingMobile && existingMobile === submittedMobile){
            return ContentService
              .createTextOutput(JSON.stringify({ ok: false, error: 'duplicate_mobile' }))
              .setMimeType(ContentService.MimeType.JSON);
          }
        }
      }
    }

    sheet.appendRow([
      new Date(),
      p.name || '',
      p.mobile || '',
      p.attending || '',
      p.adults || '',
      p.children || '',
      p.message || '',
      p.invite_type || '',
      (e.parameter && e.parameter._ua) || '',
      p.guest2_name || '',
      p.children_names || ''
    ]);

    const attending = String(p.attending || '').toLowerCase().startsWith('yes')
      ? '✅ ACCEPTING' : '❌ DECLINING';
    const subject = `🎉 RSVP — ${p.name || 'Unknown'} — ${attending}`;
    const body = [
      `Name:       ${p.name}`,
      `Mobile:     ${p.mobile}`,
      `Attending:  ${p.attending}`,
      `Adults:     ${p.adults}`,
      `2nd guest:  ${p.guest2_name || '(none)'}`,
      `Children:   ${p.children}`,
      `Child names:${p.children_names || '(none)'}`,
      `Invite:     ${p.invite_type || 'default'}`,
      '',
      'Note for Elijah:',
      p.message || '(none)'
    ].join('\n');

    MailApp.sendEmail({
      to: NOTIFY_EMAIL,
      subject: subject,
      body: body,
      replyTo: NOTIFY_EMAIL
    });

    return ContentService
      .createTextOutput(JSON.stringify({ ok: true }))
      .setMimeType(ContentService.MimeType.JSON);
  } catch (err) {
    return ContentService
      .createTextOutput(JSON.stringify({ ok: false, error: String(err) }))
      .setMimeType(ContentService.MimeType.JSON);
  }
}

// doGet — returns the current guest list as JSON.
// Source of truth is the Sheet itself, so deleting a row removes that
// guest from the site immediately on next page load.
function doGet(e) {
  const callback = (e && e.parameter && e.parameter.callback) || '';
  try {
    const sheet = SpreadsheetApp.openById(SHEET_ID).getSheets()[0];
    const data = sheet.getDataRange().getValues();
    if (data.length < 2) {
      return jsonOut({ ok: true, guests: [] }, callback);
    }
    const headers = data[0].map(h => String(h).trim().toLowerCase());
    const col = (key) => headers.indexOf(key);

    const cTs   = col('timestamp');
    const cName = col('name');
    const cMob  = col('mobile');
    const cAtt  = col('attending');
    const cAd   = col('adults');
    const cCh   = col('children');
    const cMsg  = col('message');
    const cInv  = col('invite_type');
    const cG2   = col('guest2_name');
    const cCN   = col('children_names');

    const guests = [];
    for (let i = 1; i < data.length; i++) {
      const row = data[i];
      const name = cName >= 0 ? String(row[cName] || '').trim() : '';
      if (!name) continue; // skip blank rows
      guests.push({
        ts: cTs >= 0 && row[cTs] ? new Date(row[cTs]).getTime() : 0,
        name: name,
        mobile: cMob >= 0 ? String(row[cMob] || '') : '',
        attending: cAtt >= 0 ? String(row[cAtt] || '') : '',
        adults: cAd >= 0 ? (row[cAd] || 1) : 1,
        children: cCh >= 0 ? (row[cCh] || 0) : 0,
        message: cMsg >= 0 ? String(row[cMsg] || '') : '',
        invite_type: cInv >= 0 ? String(row[cInv] || '') : '',
        guest2_name: cG2 >= 0 ? String(row[cG2] || '') : '',
        children_names: cCN >= 0 ? String(row[cCN] || '') : ''
      });
    }
    return jsonOut({ ok: true, guests: guests }, callback);
  } catch (err) {
    return jsonOut({ ok: false, error: String(err), guests: [] }, callback);
  }
}

// Normalize a mobile number to its trailing 8 digits so that +356 / 00356 /
// local forms of the same number all compare equal in the duplicate guard.
function normalizeMobile_(s){
  const d = String(s || '').replace(/\D/g, '');
  return d.length > 8 ? d.slice(-8) : d;
}

function jsonOut(obj, callback) {
  const text = JSON.stringify(obj);
  if (callback) {
    return ContentService
      .createTextOutput(callback + '(' + text + ')')
      .setMimeType(ContentService.MimeType.JAVASCRIPT);
  }
  return ContentService
    .createTextOutput(text)
    .setMimeType(ContentService.MimeType.JSON);
}
