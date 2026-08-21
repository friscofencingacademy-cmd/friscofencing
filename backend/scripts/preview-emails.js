'use strict';

/**
 * Dev-only preview: render every email template with sample data to HTML
 * files you can open in a browser. No network, no DB, no send — this is the
 * QA loop that makes the staging email gate (Phase 1) workable, since
 * staging never actually delivers a real email.
 *
 *   node scripts/preview-emails.js
 *   -> writes ./email-preview/<key>.html + <key>.txt + index.html
 */

const fs = require('fs');
const path = require('path');
const { renderEmail, TEMPLATES } = require('../src/email');
const { SAMPLE_DATA } = require('../src/email/sampleData');

const OUT = path.join(__dirname, '..', 'email-preview');
fs.mkdirSync(OUT, { recursive: true });

const links = [];

for (const tpl of TEMPLATES) {
  const { subject, html, text } = renderEmail(tpl.key, SAMPLE_DATA[tpl.key] || {});
  fs.writeFileSync(path.join(OUT, `${tpl.key}.html`), html);
  fs.writeFileSync(path.join(OUT, `${tpl.key}.txt`), text);
  links.push(`<li><a href="./${tpl.key}.html">${tpl.key}</a><br><small>${subject}</small></li>`);
  // eslint-disable-next-line no-console -- CLI script output, not app logging.
  console.log(`✓ ${tpl.key}.html`);
}

fs.writeFileSync(
  path.join(OUT, 'index.html'),
  '<!doctype html><meta charset="utf-8"><title>Frisco Fencing email previews</title>' +
    '<body style="font-family:system-ui;max-width:640px;margin:40px auto;padding:0 20px;">' +
    `<h1>Frisco Fencing email previews</h1><ul style="line-height:2;">${links.join('')}</ul></body>`
);

// eslint-disable-next-line no-console
console.log(`\nDone -- open ${path.join(OUT, 'index.html')} in a browser.`);
