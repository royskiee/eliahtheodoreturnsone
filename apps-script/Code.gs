// =============================================================
// Elijah RSVP — Google Apps Script Web App
// Stores submissions in a Google Sheet + emails royvincentb@gmail.com
// =============================================================
//
// SETUP (one time):
// 1. Create a new Google Sheet titled "Elijah RSVPs".
//    Add this header row in row 1 (exact order):
//      timestamp | name | email | attending | adults | children | message | invite_type | user_agent
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

// Guest-facing confirmation email settings.
const SITE_URL    = 'https://elijahturnsone.com';
const SENDER_NAME = "Elijah's 1st Birthday";
const EVENT_WHEN  = 'Saturday, 26 July 2026 · 12:30 – 16:30';
const EVENT_WHERE = 'State Hall & Alexandra Gardens, AX The Palace, Sliema, Malta';

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
    const data = sheet.getDataRange().getValues();
    if (data.length >= 2){
      const headers = data[0].map(h => String(h).trim().toLowerCase());
      const nameCol = headers.indexOf('name');
      if (nameCol >= 0){
        for (let i = 1; i < data.length; i++){
          const existing = String(data[i][nameCol] || '').trim().toLowerCase().replace(/\s+/g, ' ');
          if (existing && existing === submittedName){
            return ContentService
              .createTextOutput(JSON.stringify({ ok: false, error: 'duplicate_name' }))
              .setMimeType(ContentService.MimeType.JSON);
          }
        }
      }
    }

    sheet.appendRow([
      new Date(),
      p.name || '',
      p.email || '',
      p.attending || '',
      p.adults || '',
      p.children || '',
      p.message || '',
      p.invite_type || '',
      (e.parameter && e.parameter._ua) || ''
    ]);

    const attending = String(p.attending || '').toLowerCase().startsWith('yes')
      ? '✅ ACCEPTING' : '❌ DECLINING';
    const subject = `🎉 RSVP — ${p.name || 'Unknown'} — ${attending}`;
    const body = [
      `Name:       ${p.name}`,
      `Email:      ${p.email}`,
      `Attending:  ${p.attending}`,
      `Adults:     ${p.adults}`,
      `Children:   ${p.children}`,
      `Invite:     ${p.invite_type || 'default'}`,
      '',
      'Note for Elijah:',
      p.message || '(none)'
    ].join('\n');

    MailApp.sendEmail({
      to: NOTIFY_EMAIL,
      subject: subject,
      body: body,
      replyTo: p.email || NOTIFY_EMAIL
    });

    // Guest confirmation — only when ACCEPTING and a valid email was given
    // (email is optional). Declines get no guest email.
    const guestEmail = String(p.email || '').trim();
    const accepting = String(p.attending || '').toLowerCase().startsWith('yes');
    if (accepting && isValidEmail_(guestEmail)){
      sendGuestConfirmation_(guestEmail, p.name || 'friend');
    }

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
    const cMail = col('email');
    const cAtt  = col('attending');
    const cAd   = col('adults');
    const cCh   = col('children');
    const cMsg  = col('message');
    const cInv  = col('invite_type');

    const guests = [];
    for (let i = 1; i < data.length; i++) {
      const row = data[i];
      const name = cName >= 0 ? String(row[cName] || '').trim() : '';
      if (!name) continue; // skip blank rows
      guests.push({
        ts: cTs >= 0 && row[cTs] ? new Date(row[cTs]).getTime() : 0,
        name: name,
        email: cMail >= 0 ? String(row[cMail] || '') : '',
        attending: cAtt >= 0 ? String(row[cAtt] || '') : '',
        adults: cAd >= 0 ? (row[cAd] || 1) : 1,
        children: cCh >= 0 ? (row[cCh] || 0) : 0,
        message: cMsg >= 0 ? String(row[cMsg] || '') : '',
        invite_type: cInv >= 0 ? String(row[cInv] || '') : ''
      });
    }
    return jsonOut({ ok: true, guests: guests }, callback);
  } catch (err) {
    return jsonOut({ ok: false, error: String(err), guests: [] }, callback);
  }
}

// Basic email sanity check (don't try to send to garbage).
function isValidEmail_(s){
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(s || '').trim());
}

// Send the warm HTML thank-you to a guest who is attending.
function sendGuestConfirmation_(to, name){
  const firstName = String(name).trim().split(/\s+/)[0] || 'friend';
  const subject = "🧸 Thank you for accepting Elijah's invite!";
  const headline = "Thank you for accepting<br>Elijah's invite!";
  const intro = "We're so delighted you'll be joining us to celebrate Elijah's very first birthday. It wouldn't be the same without you.";

  const detailsBlock = `
            <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:8px 0 4px">
              <tr><td style="padding:14px 18px;background:#F6F1EA;border-radius:12px">
                <p style="margin:0 0 6px;font:600 12px/1.4 Arial,Helvetica,sans-serif;letter-spacing:.12em;text-transform:uppercase;color:#7A9DC4">When &amp; Where</p>
                <p style="margin:0 0 4px;font:400 16px/1.5 Georgia,'Times New Roman',serif;color:#243B5C">${EVENT_WHEN}</p>
                <p style="margin:0;font:400 14px/1.5 Georgia,'Times New Roman',serif;color:#4A5C7A">${EVENT_WHERE}</p>
              </td></tr>
            </table>`;

  const htmlBody = `
  <div style="margin:0;padding:0;background:#EFE7DC">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#EFE7DC;padding:28px 12px">
      <tr><td align="center">
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:520px;background:#FFFDF9;border-radius:18px;overflow:hidden;box-shadow:0 6px 24px rgba(36,59,92,.12)">
          <tr><td style="background:linear-gradient(135deg,#7A9DC4 0%,#243B5C 100%);padding:34px 28px;text-align:center">
            <p style="margin:0 0 10px;font:600 12px/1 Arial,Helvetica,sans-serif;letter-spacing:.28em;text-transform:uppercase;color:#E8D5C4">Elijah Theodore · Turns One</p>
            <h1 style="margin:0;font:400 28px/1.25 Georgia,'Times New Roman',serif;color:#FFFDF9">${headline}</h1>
          </td></tr>
          <tr><td style="padding:30px 30px 8px">
            <p style="margin:0 0 16px;font:400 17px/1.6 Georgia,'Times New Roman',serif;color:#243B5C">Dear ${firstName},</p>
            <p style="margin:0 0 18px;font:400 16px/1.7 Georgia,'Times New Roman',serif;color:#4A5C7A">${intro}</p>
            ${detailsBlock}
          </td></tr>
          <tr><td style="padding:14px 30px 4px;text-align:center">
            <a href="${SITE_URL}" style="display:inline-block;background:#7A9DC4;color:#FFFDF9;text-decoration:none;font:600 14px/1 Arial,Helvetica,sans-serif;letter-spacing:.06em;padding:14px 30px;border-radius:999px">Revisit the invitation →</a>
          </td></tr>
          <tr><td style="padding:14px 30px 30px;text-align:center">
            <p style="margin:0;font:400 13px/1.6 Arial,Helvetica,sans-serif;color:#9A8E7E">Or visit <a href="${SITE_URL}" style="color:#7A9DC4;text-decoration:none">${SITE_URL.replace(/^https?:\/\//,'')}</a> anytime.</p>
          </td></tr>
          <tr><td style="background:#F6F1EA;padding:20px 30px;text-align:center">
            <p style="margin:0;font:italic 400 15px/1.5 Georgia,'Times New Roman',serif;color:#243B5C">With love, from Elijah &amp; family 💙</p>
          </td></tr>
        </table>
        <p style="margin:16px 0 0;font:400 11px/1.5 Arial,Helvetica,sans-serif;color:#9A8E7E">You're receiving this because you replied to Elijah's birthday invitation.</p>
      </td></tr>
    </table>
  </div>`;

  const plain = [
    `Dear ${firstName},`,
    '',
    intro,
    '',
    `When & Where: ${EVENT_WHEN} — ${EVENT_WHERE}`,
    '',
    `Revisit the invitation: ${SITE_URL}`,
    '',
    'With love, from Elijah & family'
  ].join('\n');

  MailApp.sendEmail({
    to: to,
    subject: subject,
    body: plain,
    htmlBody: htmlBody,
    name: SENDER_NAME,
    replyTo: NOTIFY_EMAIL
  });
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
