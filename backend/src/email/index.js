'use strict';

/**
 * Public API for the email design system.
 *
 *   const { renderEmail } = require('./email');
 *   const { subject, preheader, html, text } = renderEmail('trialConfirmation', data);
 *
 * renderEmail is PURE: data in, finished strings out. It does not fetch,
 * send, or apply business logic — mail.service.js's send* functions own
 * that (assembling `data`, then calling renderEmail, then sendMailSafely).
 */

const { TEMPLATES, TEMPLATE_MAP } = require('./templates');
const { renderHtml } = require('./layout');
const { renderText } = require('./text');
const { interpolate } = require('./interpolate');

function hasTemplate(key) {
  return Boolean(TEMPLATE_MAP[key]);
}

/**
 * @param {string} key - registry key, e.g. 'trialConfirmation'
 * @param {Object} data - the data the template's build() needs
 * @returns {{ subject, preheader, html, text }}
 * @throws {Error} if the key is unknown
 */
function renderEmail(key, data = {}) {
  const tpl = TEMPLATE_MAP[key];

  if (!tpl) {
    throw new Error(`[email] unknown template key: ${key}`);
  }

  const blocks = tpl.build(data);
  const subject = interpolate(tpl.subject, data);
  const preheader = interpolate(tpl.preheader, data);

  return {
    subject,
    preheader,
    html: renderHtml(blocks, { preheader, footer: 'transactional' }),
    text: renderText(blocks, 'transactional'),
  };
}

function listTemplates() {
  return TEMPLATES.map((t) => ({ key: t.key, subject: t.subject, preheader: t.preheader }));
}

module.exports = { renderEmail, hasTemplate, listTemplates, TEMPLATES, TEMPLATE_MAP };
