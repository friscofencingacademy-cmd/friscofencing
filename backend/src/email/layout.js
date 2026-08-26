'use strict';

/**
 * HTML renderer — turns a Block[] into email-safe HTML wrapped in the ONE
 * shared shell. Table-based layout, fully inline styles, no flex/grid, no
 * var(), ~600px, single mobile media query, hidden preheader, real alt text.
 *
 * This is the only file that knows what an email looks like. Templates emit
 * blocks; they never author HTML (design-system invariant D3 in
 * docs/plans/ckq-parity-plan.md). A brand/footer/color change is one edit
 * here or in tokens.js and every email updates.
 *
 * Block shapes (the vocabulary templates compose — Frisco's subset of CKQ's):
 *   { t:'spacer', h? }
 *   { t:'divider' }
 *   { t:'eyebrow', text, tone? }
 *   { t:'heading', text }
 *   { t:'subheading', text }
 *   { t:'text', html, muted?, size? }
 *   { t:'badge', tone, glyph }
 *   { t:'button', label, href, variant?, block? }
 *   { t:'link', label, href, tone? }
 *   { t:'card', tone, children:Block[] }
 *   { t:'detailList', rows:[label,value][] }
 *   { t:'steps', title, items:[] }
 *   { t:'breakdown', data:{ monthlyFee, siblingDiscountAmount, registrationFeeCharged, prorated, totalClassDays, remainingClassDays, total } }
 */

const { C, FONT, LOGO_URL, ORG } = require('./tokens');

function escapeHtml(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function money(n) {
  return `$${Number(n || 0).toFixed(2)}`;
}

const eyebrowColor = { gold: C.goldInk, green: C.green, red: C.red, blue: C.blue, neutral: C.muted };
const cardSkin = {
  gold: [C.goldSoft, C.goldBorder],
  green: [C.greenSoft, C.greenBorder],
  red: [C.redSoft, C.redBorder],
  blue: [C.blueSoft, C.blueBorder],
  neutral: [C.panel, C.border],
};
const badgeColor = { gold: C.gold, green: C.green, red: C.red, blue: C.blue, neutral: C.muted };

function button(label, href, variant = 'primary', block = false) {
  if (variant === 'ghost') {
    return `<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:6px 0;${block ? 'width:100%;' : ''}"><tr><td align="center" style="border-radius:12px;border:1.5px solid ${C.gold};"><a href="${href}" style="display:${block ? 'block' : 'inline-block'};padding:13px 24px;font-family:${FONT};font-size:15px;font-weight:700;color:${C.goldInk};text-decoration:none;border-radius:12px;">${escapeHtml(label)}</a></td></tr></table>`;
  }
  const skins = {
    primary: [C.gold, C.ink],
    green: [C.green, '#ffffff'],
    danger: [C.red, '#ffffff'],
  };
  const [bg, fg] = skins[variant] || skins.primary;
  return `<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:6px 0;${block ? 'width:100%;' : ''}"><tr><td align="center" style="border-radius:12px;background:${bg};"><a href="${href}" style="display:${block ? 'block' : 'inline-block'};padding:14px 28px;font-family:${FONT};font-size:15px;font-weight:700;color:${fg};text-decoration:none;border-radius:12px;">${escapeHtml(label)}</a></td></tr></table>`;
}

/** Flat monthly-fee payment breakdown — Frisco has no per-session group math. */
function breakdownHtml(d) {
  const row = (label, amount, opts = {}) => {
    const amountColor = opts.discount ? C.green : C.ink;
    const amountWeight = opts.discount ? 700 : 600;
    return `<tr><td style="padding:5px 0;font-family:${FONT};font-size:14px;color:${C.soft};">${label}</td><td style="padding:5px 0;font-family:${FONT};font-size:14px;font-weight:${amountWeight};color:${amountColor};text-align:right;white-space:nowrap;">${amount}</td></tr>`;
  };

  let rows = row('Monthly fee', money(d.monthlyFee));
  if (d.prorated) {
    rows += row('Prorated', `${d.remainingClassDays} of ${d.totalClassDays} class days this month`);
  }
  if (d.siblingDiscountAmount) {
    rows += row('Sibling discount (10%)', `&minus;${money(d.siblingDiscountAmount)}`, { discount: true });
  }
  if (d.registrationFeeCharged) {
    rows += row('Registration fee (one-time)', money(d.registrationFeeCharged));
  }

  return (
    `<p style="margin:24px 0 8px;font-family:${FONT};font-size:12px;font-weight:700;letter-spacing:.08em;text-transform:uppercase;color:${C.muted};">Payment breakdown</p>` +
    `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:4px 0 20px;border:1px solid ${C.border};border-radius:14px;"><tr><td style="padding:16px 20px 6px;"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">${rows}</table></td></tr><tr><td style="padding:0 20px;"><div style="border-top:1px solid ${C.border};"></div></td></tr><tr><td style="padding:12px 20px 16px;"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr><td style="font-family:${FONT};font-size:15px;font-weight:700;color:${C.ink};">Total charged</td><td style="font-family:${FONT};font-size:22px;font-weight:800;color:${C.ink};text-align:right;letter-spacing:-.02em;">${money(d.total)}</td></tr></table></td></tr></table>`
  );
}

function blockHtml(b) {
  switch (b.t) {
    case 'spacer':
      return `<div style="height:${b.h ?? 16}px;line-height:${b.h ?? 16}px;">&nbsp;</div>`;
    case 'divider':
      return `<div style="border-top:1px solid ${C.border};margin:18px 0;"></div>`;
    case 'eyebrow':
      return `<p style="margin:0 0 10px;font-family:${FONT};font-size:12px;font-weight:700;letter-spacing:.12em;text-transform:uppercase;color:${eyebrowColor[b.tone || 'gold']};">${escapeHtml(b.text)}</p>`;
    case 'heading':
      return `<h1 class="ffa-h1" style="margin:0 0 14px;font-family:${FONT};font-size:28px;line-height:1.15;font-weight:800;letter-spacing:-.02em;color:${C.ink};">${escapeHtml(b.text)}</h1>`;
    case 'subheading':
      return `<p style="margin:24px 0 8px;font-family:${FONT};font-size:12px;font-weight:700;letter-spacing:.08em;text-transform:uppercase;color:${C.muted};">${escapeHtml(b.text)}</p>`;
    case 'text':
      return `<p style="margin:0 0 16px;font-family:${FONT};font-size:${b.size === 'sm' ? '13.5px' : '15px'};line-height:1.62;color:${b.muted ? C.muted : C.soft};">${b.html}</p>`;
    case 'badge':
      return `<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:0 0 18px;"><tr><td width="52" height="52" align="center" valign="middle" style="background:${badgeColor[b.tone]};border-radius:50%;font-size:24px;color:#fff;line-height:52px;">${b.glyph}</td></tr></table>`;
    case 'button':
      return button(b.label, b.href, b.variant, b.block);
    case 'link':
      return `<p style="margin:0 0 12px;"><a href="${b.href}" style="font-family:${FONT};font-size:14px;font-weight:600;color:${b.tone === 'red' ? C.red : C.goldInk};text-decoration:none;">${escapeHtml(b.label)}</a></p>`;
    case 'card': {
      const [bg, bd] = cardSkin[b.tone];
      const inner = b.children.map((c) => blockHtml(c)).join('');
      return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:6px 0 20px;"><tr><td style="background:${bg};border:1px solid ${bd};border-radius:14px;padding:22px;">${inner}</td></tr></table>`;
    }
    case 'detailList': {
      const rows = b.rows
        .map(
          ([k, v]) =>
            `<tr><td style="padding:7px 0;font-family:${FONT};font-size:13px;color:${C.muted};vertical-align:top;white-space:nowrap;">${escapeHtml(k)}</td><td style="padding:7px 0 7px 18px;font-family:${FONT};font-size:14px;font-weight:600;color:${C.ink};text-align:right;">${v}</td></tr>`
        )
        .join('');
      return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">${rows}</table>`;
    }
    case 'steps': {
      const li = b.items
        .map(
          (s) =>
            `<tr><td width="24" style="vertical-align:top;padding:4px 0;font-family:${FONT};font-size:14px;color:${C.goldInk};font-weight:700;">&rsaquo;</td><td style="padding:4px 0;font-family:${FONT};font-size:14px;line-height:1.55;color:${C.soft};">${s}</td></tr>`
        )
        .join('');
      return `<p style="margin:24px 0 8px;font-family:${FONT};font-size:12px;font-weight:700;letter-spacing:.08em;text-transform:uppercase;color:${C.muted};">${escapeHtml(b.title)}</p><table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">${li}</table>`;
    }
    case 'breakdown':
      return breakdownHtml(b.data);
    default:
      return '';
  }
}

function headerHtml() {
  const logoUrl = LOGO_URL();
  const org = ORG();

  if (logoUrl) {
    return `<img src="${logoUrl}" width="172" alt="${escapeHtml(org.name)}" style="display:block;margin:0 auto;border:0;outline:none;text-decoration:none;width:172px;height:auto;">`;
  }

  return `<div style="font-family:${FONT};font-size:20px;font-weight:800;letter-spacing:.08em;text-transform:uppercase;color:${C.ink};">FRISCO <span style="color:${C.gold};">FENCING</span></div>`;
}

/**
 * footerMode: 'transactional' (default) | 'operational'. 'operational' is
 * for internal/relay-style copies — none of the 10 templates in this plan
 * use it yet, but the mode exists so a future operational template doesn't
 * need a layout.js change.
 */
function footerHtml(mode) {
  const org = ORG();

  if (mode === 'operational') {
    return `<tr><td class="ffa-px" style="padding:24px 40px 28px;background:${C.panel};border-top:1px solid ${C.borderSoft};">
      <p style="margin:0 0 10px;font-family:${FONT};font-size:13px;line-height:1.55;color:${C.soft};">Automated message from ${escapeHtml(org.name)}. Questions? Reach us at <a href="mailto:${org.supportEmail}" style="color:${C.goldInk};font-weight:600;">${org.supportEmail}</a>.</p>
      <p style="margin:0;font-family:${FONT};font-size:12px;font-weight:700;color:${C.muted};">${escapeHtml(org.name)}</p>
    </td></tr>`;
  }

  return `<tr><td class="ffa-px" style="padding:26px 40px 30px;background:${C.panel};border-top:1px solid ${C.borderSoft};">
    <p style="margin:0 0 14px;font-family:${FONT};font-size:13px;line-height:1.55;color:${C.soft};">Questions? Just reply to this email, or reach us at <a href="mailto:${org.supportEmail}" style="color:${C.goldInk};font-weight:600;">${org.supportEmail}</a>.</p>
    <p style="margin:0 0 16px;"><a href="${org.portalUrl}" style="font-family:${FONT};font-size:13px;font-weight:700;color:${C.goldInk};">Open your parent portal &rarr;</a></p>
    <div style="border-top:1px solid ${C.border};margin:0 0 14px;"></div>
    <p style="margin:0;font-family:${FONT};font-size:12px;font-weight:700;color:${C.muted};">${escapeHtml(org.name)}</p>
  </td></tr>`;
}

/** Wrap rendered blocks in the full email document. */
function renderHtml(blocks, opts = {}) {
  const org = ORG();
  const inner = blocks.map((b) => blockHtml(b)).join('');
  const footerMode = opts.footer === 'operational' ? 'operational' : 'transactional';
  const preheader = opts.preheader || '';

  return `<!DOCTYPE html>
<html lang="en"><head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="x-apple-disable-message-reformatting">
<meta name="color-scheme" content="light only">
<meta name="supported-color-schemes" content="light">
<title>${escapeHtml(org.name)}</title>
<style>
  body{margin:0;padding:0;background:${C.bg};-webkit-text-size-adjust:100%;}
  a{text-decoration:none;}
  @media only screen and (max-width:600px){
    .ffa-container{width:100%!important;border-radius:0!important;}
    .ffa-px{padding-left:24px!important;padding-right:24px!important;}
    .ffa-h1{font-size:25px!important;}
  }
</style>
</head>
<body style="margin:0;padding:0;background:${C.bg};">
<div style="display:none;max-height:0;overflow:hidden;opacity:0;mso-hide:all;">${escapeHtml(preheader)}&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:${C.bg};">
<tr><td align="center" style="padding:32px 12px;">
  <table role="presentation" class="ffa-container" width="600" cellpadding="0" cellspacing="0" border="0" style="width:600px;max-width:600px;background:#ffffff;border-radius:18px;border:1px solid ${C.border};overflow:hidden;">
    <tr><td align="center" style="padding:26px 24px 22px;border-bottom:1px solid ${C.borderSoft};">
      ${headerHtml()}
    </td></tr>
    <tr><td class="ffa-px" style="padding:34px 40px 8px;">${inner}</td></tr>
    ${footerHtml(footerMode)}
  </table>
</td></tr>
</table>
</body></html>`;
}

module.exports = { renderHtml, escapeHtml, money };
