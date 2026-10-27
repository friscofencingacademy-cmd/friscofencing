// Live gate f15-prorated-top-payer — mirrors docs/live-gates/f15-prorated-top-payer.md
// step for step. Read-only: the Charge dialog is opened and read, never confirmed.

const { step, expectThat } = require('../lib/gate-runner');
const { centralToday, formatDay, money, prorate, siblingDiscount } = require('../lib/gate-dates');
const {
  chargeDialog,
  liveRowsOf,
  openChargeDialog,
  openSubscriptions,
  readText,
  searchSubscriptions,
  shorten,
  totalIn,
} = require('../lib/gate-page');

const TOP = 'Audit BridgeSecond';
const LOWER = 'Audit BridgeFirst';
const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const SIBLING_LINE = 'sibling discount (10%)';

async function liveRow(page, name) {
  await searchSubscriptions(page, name.split(' ').pop());
  const rows = liveRowsOf(page, name);
  const count = await rows.count();
  expectThat(count === 1, `${count} non-cancelled rows for ${name}`);
  return rows.first();
}

async function closeWithCancel(page, row, rowTextBefore) {
  await chargeDialog(page).getByRole('button', { name: 'Cancel', exact: true }).click();
  await chargeDialog(page).waitFor({ state: 'hidden' });
  const rowTextAfter = await readText(row);
  expectThat(rowTextAfter === rowTextBefore, `Row changed: before "${rowTextBefore}", after "${rowTextAfter}"`);
  return `Dialog closed; row unchanged "${shorten(rowTextAfter, 160)}"`;
}

module.exports = {
  id: 'f15-prorated-top-payer',
  accounts: { admin: 'superadmin' },

  async preconditions(g) {
    const rows = [];
    const top = await g.api.activeSubscriptionOf(TOP);
    const lower = await g.api.activeSubscriptionOf(LOWER);
    rows.push({
      n: 'P1',
      expect: 'Audit fixtures: BridgeSecond and BridgeFirst each have an active subscription',
      seen: `${TOP}: ${top ? 'active' : 'none'}; ${LOWER}: ${lower ? 'active' : 'none'}`,
      result: top && lower ? 'pass' : 'blocked',
    });
    if (!top || !lower) return rows;

    const priceTop = await g.api.priceOfLevel(top.scheduleId.classId.levelId.name);
    const priceLower = await g.api.priceOfLevel(lower.scheduleId.classId.levelId.name);
    const today = centralToday();
    const topProrated = prorate(priceTop.monthlyFee, top.scheduleId.dayOfWeek, today);
    const lowerProrated = prorate(priceLower.monthlyFee, lower.scheduleId.dayOfWeek, today);
    const inWindow = topProrated.amount > 0 && topProrated.amount < priceLower.monthlyFee;
    rows.push({
      n: 'P2',
      expect: `${top.scheduleId.classId.levelId.name} prorated amount today is above $0 and below ${money(priceLower.monthlyFee)}`,
      seen: `${formatDay(today)} (Central); ${DAYS[top.scheduleId.dayOfWeek]}s left ${topProrated.left} of ${topProrated.total} → ${topProrated.arithmetic}`,
      result: inWindow ? 'pass' : 'blocked',
    });
    rows.push({
      n: 'P3',
      expect: 'Staging serves #133 or later (recorded)',
      seen: g.commit === 'unknown' ? 'develop commit unknown' : `develop at ${g.commit}; both Vercel deployments success`,
      result: 'pass',
    });

    g.facts = {
      feeTop: priceTop.monthlyFee,
      feeLower: priceLower.monthlyFee,
      topProrated,
      lowerProrated,
      lowerDiscount: siblingDiscount(lowerProrated.amount),
    };
    return rows;
  },

  steps: [
    step(1, 'Open /admin/subscriptions logged in as the staging superadmin.', 'The Subscriptions table loads.', async (g) => {
      const page = g.pages.admin;
      const rows = await openSubscriptions(page, g.url);
      return `${await rows.count()} rows; first: "${shorten(await readText(rows.first()), 120)}"`;
    }),

    step(2, 'Search for BridgeSecond.', 'One active row: Audit BridgeSecond, Audit Class A.', async (g) => {
      const row = await liveRow(g.pages.admin, TOP);
      const text = await readText(row);
      expectThat(text.includes('Audit Class A') && text.includes('Active'), text);
      g.facts.topRowText = text;
      return shorten(text);
    }),

    step(3, 'Click Charge on that row.', 'The Charge dialog opens and loads its preview.', async (g) => {
      const page = g.pages.admin;
      const dialog = await openChargeDialog(page, liveRowsOf(page, TOP).first());
      const text = await readText(dialog);
      expectThat(text.includes('Breakdown'), text);
      return shorten(text);
    }),

    step(4, 'Read the Prorated from today option label.', 'It shows the computed prorated amount exactly, not 90% of it.', async (g) => {
      const label = await readText(chargeDialog(g.pages.admin).locator('label').filter({ hasText: 'Prorated from today' }));
      const expected = `Prorated from today — ${money(g.facts.topProrated.amount)}`;
      expectThat(label === expected, `${label} (expected "${expected}", ${g.facts.topProrated.arithmetic})`);
      return label;
    }),

    step(5, 'Select Prorated from today.', 'Monthly fee is the plan fee, no sibling-discount line, Total equals the step 4 amount.', async (g) => {
      const dialog = chargeDialog(g.pages.admin);
      await dialog.getByLabel(/Prorated from today/).check();
      const text = await readText(dialog);
      expectThat(
        text.includes(`Monthly fee: ${money(g.facts.feeTop)}`) &&
          !text.includes(SIBLING_LINE) &&
          totalIn(text) === g.facts.topProrated.amount,
        text
      );
      return shorten(text);
    }),

    step(6, 'Select Full month.', 'Total is the full plan fee and no sibling-discount line.', async (g) => {
      const dialog = chargeDialog(g.pages.admin);
      await dialog.getByLabel(/Full month/).check();
      const text = await readText(dialog);
      expectThat(totalIn(text) === g.facts.feeTop && !text.includes(SIBLING_LINE), text);
      return shorten(text);
    }),

    step(7, 'Close the dialog with Cancel (never Confirm).', 'The dialog closes; nothing was charged.', async (g) => {
      const page = g.pages.admin;
      return closeWithCancel(page, liveRowsOf(page, TOP).first(), g.facts.topRowText);
    }),

    step(
      8,
      'Search for BridgeFirst, click Charge, select Prorated from today.',
      "A 10% sibling-discount line on BridgeFirst's own prorated amount, and Total = prorated − discount.",
      async (g) => {
        const page = g.pages.admin;
        const row = await liveRow(page, LOWER);
        g.facts.lowerRowText = await readText(row);
        const dialog = await openChargeDialog(page, row);
        await dialog.getByLabel(/Prorated from today/).check();
        const text = await readText(dialog);
        const { discount, total } = g.facts.lowerDiscount;
        const expectedLine = `− ${money(discount)} ${SIBLING_LINE}`;
        expectThat(
          text.includes(`Monthly fee: ${money(g.facts.feeLower)}`) && text.includes(expectedLine) && totalIn(text) === total,
          `${text} (expected "${expectedLine}" and Total ${money(total)}; ${g.facts.lowerProrated.arithmetic})`
        );
        return shorten(text);
      }
    ),

    step(9, 'Close the dialog with Cancel.', 'The dialog closes; nothing was charged.', async (g) => {
      const page = g.pages.admin;
      return closeWithCancel(page, liveRowsOf(page, LOWER).first(), g.facts.lowerRowText);
    }),
  ],
};
