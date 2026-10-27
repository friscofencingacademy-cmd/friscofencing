// Live gate payment-history — mirrors docs/live-gates/payment-history.md step
// for step. Two isolated contexts: the superadmin (steps 1–4) and the bridge
// parent (steps 5–7), each signed in by the runner from audit/.env. Download
// is never clicked; nothing is changed.

const { step, expectThat } = require('../lib/gate-runner');
const { daySentinel, formatDay, instantDay, money, siblingDiscount } = require('../lib/gate-dates');
const { historyDialog, liveRowsOf, openSubscriptions, readText, searchSubscriptions, shorten } = require('../lib/gate-page');

const BRIDGE_PARENT = 'audit-bridge-parent@example.com';
const BRIDGE_CHILDREN = ['Audit BridgeFirst', 'Audit BridgeSecond'];
const RETRY = 'Audit RetryChild';
const HISTORY_BUTTON = 'Payment History';
const CLOSE = 'Close';
const MY_REGISTRATIONS = 'My Registrations';
const ADMIN_INTRO = "family, straight from our billing records.";
const PARENT_INTRO = 'Every charge on file for your family, straight from our billing records.';
const HEADER = 'Date · Student · For · Amount · Status · Method · Invoice';

const STATUS_LABEL = { completed: 'Paid', failed: 'Failed' };

// One ledger row exactly as PaymentHistoryTable renders it, cell by cell.
function renderedRow(row) {
  let period = null;
  if (row.periodStart && row.periodEnd) {
    period = `${formatDay(daySentinel(row.periodStart))} – ${formatDay(daySentinel(row.periodEnd))}`;
  } else if (row.sessionDate) {
    period = formatDay(instantDay(row.sessionDate));
  }
  const method = row.chargeMethod === 'manual' ? ['Manual', row.manualNote] : ['Card'];
  return [
    formatDay(instantDay(row.paidAt || row.createdAt)),
    row.studentName,
    row.description,
    period,
    money(row.amount),
    STATUS_LABEL[row.status] || 'Pending',
    ...method,
    row.invoiceAvailable ? 'Download' : '—',
  ]
    .filter(Boolean)
    .join(' · ');
}

async function tableRows(container) {
  const rows = container.locator('tbody tr');
  const count = await rows.count();
  const texts = [];
  for (let i = 0; i < count; i += 1) {
    // eslint-disable-next-line no-await-in-loop -- read in order.
    texts.push(await readText(rows.nth(i)));
  }
  return texts;
}

function compareRows(seen, expected) {
  const mismatch = expected.findIndex((row, i) => seen[i] !== row);
  if (seen.length === expected.length && mismatch === -1) return null;
  if (seen.length !== expected.length) return `${seen.length} rows shown, ${expected.length} in the ledger`;
  return `Row ${mismatch + 1}: shown "${seen[mismatch]}", ledger "${expected[mismatch]}"`;
}

async function openHistoryFor(page, name) {
  await searchSubscriptions(page, name.split(' ').pop());
  const row = liveRowsOf(page, name).first();
  await row.getByRole('button', { name: HISTORY_BUTTON, exact: true }).click();
  const dialog = historyDialog(page);
  await dialog.waitFor();
  await dialog.locator('tbody tr').first().waitFor();
  return dialog;
}

async function closeHistory(page) {
  // The footer button; the header's × is also named "Close".
  await historyDialog(page).getByRole('button', { name: CLOSE, exact: true }).last().click();
  await historyDialog(page).waitFor({ state: 'hidden' });
  return 'Dialog closed';
}

module.exports = {
  id: 'payment-history',
  accounts: { admin: 'superadmin', parent: BRIDGE_PARENT },

  async preconditions(g) {
    const rows = [];
    const subs = {};
    for (const name of BRIDGE_CHILDREN) {
      // eslint-disable-next-line no-await-in-loop -- two reads.
      subs[name] = await g.api.activeSubscriptionOf(name);
    }
    const missing = BRIDGE_CHILDREN.filter((name) => !subs[name]);
    const family = subs[BRIDGE_CHILDREN[0]] || subs[BRIDGE_CHILDREN[1]];
    const history = family ? await g.api.history(family.parentId._id) : [];
    rows.push({
      n: 'P1',
      expect: "Bridge family's ledger rows, newest first (both children active)",
      seen:
        missing.length > 0
          ? `No active subscription for ${missing.join(', ')}`
          : history.map((row) => `${row.studentName} ${money(row.amount)} ${row.status} ${row.chargeMethod}`).join('; ') || 'no ledger rows',
      result: missing.length === 0 && history.length > 0 ? 'pass' : 'blocked',
    });

    const retrySubs = await g.api.subscriptions(RETRY.split(' ').pop());
    const retrySub = retrySubs.find((row) => `${row.studentId.firstName} ${row.studentId.lastName}` === RETRY && row.status === 'active');
    const retryHistory = retrySub ? await g.api.history(retrySub.parentId._id) : [];
    const failed = retryHistory.find((row) => row.status === 'failed' && row.studentName === RETRY);
    rows.push({
      n: 'P2',
      expect: `${RETRY} has a failed ledger row`,
      seen: failed ? `failed ${money(failed.amount)} (${failed.chargeMethod})` : 'no failed row (or no active subscription)',
      result: failed ? 'pass' : 'blocked',
    });
    rows.push({
      n: 'P3',
      expect: 'Staging serves the commit being promoted (recorded)',
      seen: g.commit === 'unknown' ? 'develop commit unknown' : `develop at ${g.commit}`,
      result: 'pass',
    });
    if (rows.some((row) => row.result === 'blocked')) return rows;

    // My Registrations (step 7): Last Payment is the ledger-sourced lastPayment
    // the admin list carries too; the current sibling discount goes to the
    // cheaper plan, the top payer is full price (ADR 006, F15).
    const fees = {};
    for (const name of BRIDGE_CHILDREN) {
      // eslint-disable-next-line no-await-in-loop
      fees[name] = (await g.api.priceOfLevel(subs[name].scheduleId.classId.levelId.name)).monthlyFee;
    }
    const topPayer = BRIDGE_CHILDREN.reduce((a, b) => (fees[a] >= fees[b] ? a : b));
    const registrations = {};
    BRIDGE_CHILDREN.forEach((name) => {
      const sub = subs[name];
      registrations[name] = {
        lastPayment: sub.lastPayment ? money(sub.lastPayment.amount) : '—',
        chips: [
          sub.lastPayment && sub.lastPayment.chargeMethod === 'manual' ? 'Manual' : null,
          sub.lastSiblingDiscountApplied ? '10% sibling' : null,
          sub.firstChargeProrated ? 'Prorated first month' : null,
        ].filter(Boolean),
        current: name === topPayer ? 'Full price' : `10% sibling — ${money(siblingDiscount(fees[name]).total)}/mo`,
      };
    });

    g.facts = {
      parentName: `${family.parentId.firstName} ${family.parentId.lastName}`,
      expectedRows: history.map(renderedRow),
      failedRow: renderedRow(failed),
      registrations,
    };
    return rows;
  },

  steps: [
    step(
      1,
      'As superadmin, open /admin/subscriptions, search BridgeFirst, click Payment History.',
      "A Payment History dialog with the family intro, the seven columns, and one row per ledger row, newest first, each cell exactly as the ledger says.",
      async (g) => {
        const page = g.pages.admin;
        await openSubscriptions(page, g.url);
        const dialog = await openHistoryFor(page, 'Audit BridgeFirst');
        const text = await readText(dialog);
        const intro = `Every payment on file for ${g.facts.parentName}'s ${ADMIN_INTRO}`;
        const header = await readText(dialog.locator('thead'));
        const problem = compareRows(await tableRows(dialog), g.facts.expectedRows);
        expectThat(text.includes(intro) && header === HEADER && !problem, `${problem || ''} ${shorten(text, 500)}`.trim());
        return shorten(text, 500);
      }
    ),

    step(2, 'Close the dialog with Close.', 'The dialog closes.', async (g) => closeHistory(g.pages.admin)),

    step(
      3,
      'Search RetryChild, click Payment History.',
      'The failed row shows its amount, Status Failed, Method Card, and Invoice — (no Download link).',
      async (g) => {
        const dialog = await openHistoryFor(g.pages.admin, RETRY);
        const rows = await tableRows(dialog);
        expectThat(rows.includes(g.facts.failedRow), `Rows: ${rows.join(' | ')} (expected "${g.facts.failedRow}")`);
        return g.facts.failedRow;
      }
    ),

    step(4, 'Close the dialog with Close.', 'The dialog closes.', async (g) => closeHistory(g.pages.admin)),

    step(
      5,
      'Open the parent portal in the bridge-parent context (signed in by the script).',
      'The parent portal loads; the sidebar shows My Registrations and Payment History as separate entries.',
      async (g) => {
        const page = g.pages.parent;
        await page.goto(`${g.url}/parent/dashboard`);
        await page.getByRole('link', { name: MY_REGISTRATIONS, exact: true }).first().waitFor();
        const history = await page.getByRole('link', { name: HISTORY_BUTTON, exact: true }).count();
        expectThat(history > 0, 'No Payment History link in the sidebar');
        return 'Sidebar links "My Registrations" and "Payment History"';
      }
    ),

    step(
      6,
      'Click Payment History in the sidebar.',
      '/parent/billing with its title and intro, and the same rows as step 1.',
      async (g) => {
        const page = g.pages.parent;
        await page.getByRole('link', { name: HISTORY_BUTTON, exact: true }).first().click();
        await page.waitForURL('**/parent/billing');
        await page.getByRole('heading', { name: HISTORY_BUTTON, exact: true }).waitFor();
        await page.getByText(PARENT_INTRO).waitFor();
        await page.locator('tbody tr').first().waitFor();
        const problem = compareRows(await tableRows(page), g.facts.expectedRows);
        expectThat(!problem, problem);
        return `${g.facts.expectedRows.length} rows, identical to step 1: ${shorten(g.facts.expectedRows.join(' | '), 400)}`;
      }
    ),

    step(
      7,
      'Click My Registrations in the sidebar.',
      "A row per child: Last Payment is that child's newest ledger amount with its chips; Sibling Discount (Current) is Full price for the top payer and 10% off the cheaper plan.",
      async (g) => {
        const page = g.pages.parent;
        await page.getByRole('link', { name: MY_REGISTRATIONS, exact: true }).first().click();
        await page.waitForURL('**/parent/subscriptions');
        await page.locator('tbody tr').first().waitFor();
        const seen = [];
        const problems = [];
        for (const name of BRIDGE_CHILDREN) {
          const expected = g.facts.registrations[name];
          const row = page.locator('tbody tr').filter({ hasText: name }).filter({ hasText: 'active' }).first();
          const cells = row.locator('td');
          // eslint-disable-next-line no-await-in-loop -- two rows.
          const lastPaymentCell = cells.nth(5);
          // eslint-disable-next-line no-await-in-loop
          const amount = ((await lastPaymentCell.evaluate((td) => td.firstChild && td.firstChild.textContent)) || '').trim();
          // eslint-disable-next-line no-await-in-loop
          const chips = (await lastPaymentCell.locator('span').allTextContents()).map((chip) => chip.trim());
          // eslint-disable-next-line no-await-in-loop
          const current = await readText(cells.nth(6));
          seen.push(`${name}: Last Payment ${amount} [${chips.join(', ')}]; Current "${current}"`);
          if (amount !== expected.lastPayment || chips.join('|') !== expected.chips.join('|') || !current.startsWith(expected.current)) {
            problems.push(`${name} expected ${expected.lastPayment} [${expected.chips.join(', ')}], "${expected.current}"`);
          }
        }
        expectThat(problems.length === 0, `${seen.join('; ')} — ${problems.join('; ')}`);
        return seen.join('; ');
      }
    ),
  ],
};
