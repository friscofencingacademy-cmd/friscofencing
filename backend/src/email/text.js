'use strict';

/**
 * Plain-text renderer — the text twin every email ships (accessibility +
 * deliverability). Walks the SAME Block[] the HTML renderer walks, so text
 * and HTML can never drift apart.
 */

const { ORG } = require('./tokens');
const { money } = require('./layout');

function stripTags(html) {
  return String(html)
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|div|h1|h2|li|tr)>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&minus;/g, '-')
    .replace(/&rarr;/g, '->')
    .replace(/&rsaquo;/g, '-')
    .replace(/[ \t]+\n/g, '\n')
    .trim();
}

function breakdownText(d) {
  const lines = ['Payment breakdown'];
  lines.push(`  Monthly fee: ${money(d.monthlyFee)}`);
  if (d.prorated) {
    lines.push(`  Prorated: ${d.remainingClassDays} of ${d.totalClassDays} class days this month`);
  }
  if (d.siblingDiscountAmount) {
    lines.push(`  Sibling discount (10%): -${money(d.siblingDiscountAmount)}`);
  }
  if (d.registrationFeeCharged) {
    lines.push(`  Registration fee (one-time): ${money(d.registrationFeeCharged)}`);
  }
  lines.push(`  TOTAL CHARGED: ${money(d.total)}`);
  return lines.join('\n');
}

function blockText(b) {
  switch (b.t) {
    case 'spacer':
    case 'divider':
    case 'badge':
      return '';
    case 'eyebrow':
      return stripTags(b.text).toUpperCase();
    case 'heading':
      return stripTags(b.text);
    case 'subheading':
      return `— ${stripTags(b.text)} —`;
    case 'text':
      return stripTags(b.html);
    case 'button':
    case 'link':
      return `${b.label}: ${b.href}`;
    case 'card':
      return b.children.map(blockText).filter(Boolean).join('\n');
    case 'detailList':
      return b.rows.map(([k, v]) => `${k}: ${stripTags(String(v))}`).join('\n');
    case 'steps':
      return `${b.title}\n${b.items.map((s) => `  - ${stripTags(s)}`).join('\n')}`;
    case 'breakdown':
      return breakdownText(b.data);
    default:
      return '';
  }
}

/** footerMode: 'transactional' (default) | 'operational'. */
function renderText(blocks, footerMode = 'transactional') {
  const org = ORG();
  const mode = footerMode === 'operational' ? 'operational' : 'transactional';
  const body = blocks.map(blockText).filter((s) => s !== '').join('\n\n');
  const foot =
    mode === 'operational'
      ? ['', '—', `Automated message from ${org.name}. Questions? Contact ${org.supportEmail}.`].join('\n')
      : [
          '',
          '—',
          `Questions? Reply to this email or contact ${org.supportEmail}.`,
          `Parent portal: ${org.portalUrl}`,
          `${org.name}`,
        ].join('\n');
  return `${body}\n${foot}\n`;
}

module.exports = { renderText };
