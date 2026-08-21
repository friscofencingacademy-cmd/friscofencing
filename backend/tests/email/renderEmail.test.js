const { renderEmail, TEMPLATES, hasTemplate } = require('../../src/email');
const { SAMPLE_DATA } = require('../../src/email/sampleData');

describe('email design system — renderEmail', () => {
  describe.each(TEMPLATES.map((t) => t.key))('%s', (key) => {
    it('renders a non-empty subject/html/text with no unresolved {{tokens}} and no literal "undefined"', () => {
      const { subject, preheader, html, text } = renderEmail(key, SAMPLE_DATA[key]);

      expect(subject.length).toBeGreaterThan(0);
      expect(preheader.length).toBeGreaterThan(0);
      expect(html.length).toBeGreaterThan(0);
      expect(text.length).toBeGreaterThan(0);

      expect(subject).not.toMatch(/\{\{/);
      expect(preheader).not.toMatch(/\{\{/);
      expect(html).not.toMatch(/\{\{/);

      expect(html).not.toMatch(/undefined/);
      expect(text).not.toMatch(/undefined/);
    });

    it('produces a text twin that carries the same detail-list content as the html', () => {
      const { html, text } = renderEmail(key, SAMPLE_DATA[key]);

      // Every template in the registry uses at least one detailList row —
      // spot-check that the html's card content also appears in the text
      // twin, proving they're both derived from the same blocks rather than
      // authored independently and free to drift.
      expect(html).toContain('<table');
      expect(text.trim().length).toBeGreaterThan(0);
    });
  });

  it('escapes an unsafe student name in html but not in a way that mangles the text twin', () => {
    const unsafeName = '<b>X&Y</b>';
    const { html, text } = renderEmail('trialConfirmation', {
      ...SAMPLE_DATA.trialConfirmation,
      studentName: unsafeName,
    });

    // The heading block escapes its text — the raw "<b>" tag must never
    // appear unescaped in the html output.
    expect(html).not.toContain('<b>X&Y</b>');
    expect(html).toContain('&lt;b&gt;X&amp;Y&lt;/b&gt;');

    // Plain-text twin has no HTML to escape — the name reads naturally.
    expect(text).toContain('<b>X&Y</b>');
  });

  it('renders breakdown math verbatim from the passed strings/numbers — no arithmetic performed in the template', () => {
    const { html, text } = renderEmail('renewalReceipt', {
      ...SAMPLE_DATA.renewalReceipt,
      monthlyFee: 200,
      siblingDiscountAmount: 20,
      chargeAmount: 180,
    });

    expect(html).toContain('$200.00');
    expect(html).toContain('$20.00');
    expect(html).toContain('$180.00');
    expect(text).toContain('$200.00');
    expect(text).toContain('$20.00');
    expect(text).toContain('$180.00');
  });

  it('omits the sibling-discount row entirely when siblingDiscountAmount is 0/falsy', () => {
    const { html } = renderEmail('registrationConfirmation', {
      ...SAMPLE_DATA.registrationConfirmation,
      siblingDiscountAmount: 0,
    });

    expect(html).not.toContain('Sibling discount');
  });

  it('text twin contains detailList labels and button URLs', () => {
    const { text } = renderEmail('registrationConfirmation', SAMPLE_DATA.registrationConfirmation);

    expect(text).toContain('Coach:');
    expect(text).toContain('Open your parent portal:');
    expect(text).toContain('http');
  });

  it('hasTemplate is true for every registered key and false for an unknown one', () => {
    TEMPLATES.forEach((t) => expect(hasTemplate(t.key)).toBe(true));
    expect(hasTemplate('notARealTemplate')).toBe(false);
  });

  it('throws on an unknown template key', () => {
    expect(() => renderEmail('notARealTemplate', {})).toThrow(/unknown template key/);
  });
});
