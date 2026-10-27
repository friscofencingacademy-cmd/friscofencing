// Page helpers shared by the live-gate scripts (audit/gates/). Every helper
// reads the page; none assumes a click worked.
//
// Selector rule (docs/plans/playwright-live-gates-plan.md D8): locate by a
// plain label string or a simple regex, so auditSelectorGuard can check it
// against the app source; compare amounts from the text read back, never
// with a regex selector.

const SEARCH_LABEL = 'Search subscriptions';
const CHARGE_DIALOG = 'Charge Subscription';
const HISTORY_DIALOG = 'Payment History';
const NO_ROWS = 'No subscriptions found';

// The element's visible text on one line, one " · " between blocks, exactly
// as written in the source. innerText is not used: it applies CSS
// text-transform, so an uppercased label would read "BREAKDOWN" and never
// match the app's own "Breakdown". Text nodes are grouped by their nearest
// non-inline ancestor, so "Full month" + " — $100.00" in one label stays one
// piece.
async function readText(locator) {
  await locator.first().waitFor();
  return locator.first().evaluate((root) => {
    const groups = [];
    let currentBlock = null;
    let currentParent = null;
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);

    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      const parent = node.parentElement;
      if (!parent || parent.getClientRects().length === 0) continue;
      let block = parent;
      while (block !== root && ['inline', 'contents'].includes(getComputedStyle(block).display)) {
        block = block.parentElement;
      }
      if (block !== currentBlock) {
        groups.push('');
        currentBlock = block;
      }
      const last = groups.length - 1;
      // Two neighbouring inline elements (an amount, then a chip) are separate
      // words on screen even with no space in the markup.
      if (parent !== currentParent && /\S$/.test(groups[last]) && /^\S/.test(node.textContent)) {
        groups[last] += ' ';
      }
      groups[last] += node.textContent;
      currentParent = parent;
    }

    return groups
      .map((group) => group.replace(/\s+/g, ' ').trim())
      .filter(Boolean)
      .join(' · ');
  });
}

function timeoutError(message) {
  const error = new Error(message);
  error.name = 'TimeoutError';
  return error;
}

// Polls `check` until it returns a truthy value, which is returned.
async function waitUntil(check, { timeout = 15000, interval = 250, what = 'the page' } = {}) {
  const deadline = Date.now() + timeout;
  for (;;) {
    // eslint-disable-next-line no-await-in-loop -- polling by design.
    const value = await check().catch(() => null);
    if (value) return value;
    if (Date.now() > deadline) throw timeoutError(`Timed out waiting for ${what}`);
    // eslint-disable-next-line no-await-in-loop
    await new Promise((resolve) => {
      setTimeout(resolve, interval);
    });
  }
}

function shorten(text, max = 240) {
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}

// /admin/subscriptions with its table loaded; returns the header + first row text.
async function openSubscriptions(page, url) {
  await page.goto(`${url}/admin/subscriptions`);
  await page.getByRole('heading', { name: 'Subscriptions', exact: true }).waitFor();
  const rows = page.locator('tbody tr');
  // The loading row is a spinner with no text.
  await waitUntil(async () => (await rows.count()) > 0 && (await rows.first().textContent()).trim().length > 0, {
    what: 'the subscriptions table',
  });
  return rows;
}

// Types `term` into the search box and waits until every row matches it.
async function searchSubscriptions(page, term) {
  const search = page.getByLabel(SEARCH_LABEL);
  await search.fill('');
  await search.fill(term);
  const rows = page.locator('tbody tr');
  await waitUntil(
    async () => {
      const texts = await rows.allTextContents();
      if (texts.length === 1 && texts[0].includes(NO_ROWS)) return true;
      return texts.length > 0 && texts.every((text) => text.includes(term));
    },
    { what: `the search for "${term}"` }
  );
  return rows;
}

// The rows of `studentName` that are not cancelled.
function liveRowsOf(page, studentName) {
  return page.locator('tbody tr').filter({ hasText: studentName }).filter({ hasNotText: 'Cancelled' });
}

function chargeDialog(page) {
  return page.getByRole('dialog', { name: CHARGE_DIALOG });
}

function historyDialog(page) {
  return page.getByRole('dialog', { name: HISTORY_DIALOG });
}

// Clicks Charge on `row` and waits for the preview (or its error) to load.
async function openChargeDialog(page, row) {
  await row.getByRole('button', { name: 'Charge', exact: true }).click();
  const dialog = chargeDialog(page);
  await dialog.waitFor();
  await waitUntil(async () => !(await readText(dialog)).includes('Loading preview'), { what: 'the charge preview' });
  return dialog;
}

// "Total: $25.00" in a dialog's text, as a number, or null.
function totalIn(text) {
  const match = /Total: \$(\d+\.\d{2})/.exec(text);
  return match ? Number(match[1]) : null;
}

module.exports = {
  chargeDialog,
  historyDialog,
  liveRowsOf,
  openChargeDialog,
  openSubscriptions,
  readText,
  searchSubscriptions,
  shorten,
  totalIn,
  waitUntil,
};
