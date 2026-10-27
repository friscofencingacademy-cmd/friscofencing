// Live gate charge-dialog-modes — mirrors docs/live-gates/charge-dialog-modes.md
// step for step. Read-only: Confirm Charge and Record Payment are never clicked
// (and the write guard would block them if they were).

const { step, expectThat } = require('../lib/gate-runner');
const {
  centralToday,
  compareDays,
  daySentinel,
  firstOfMonthAfter,
  formatDay,
  instantDay,
  money,
  prorate,
  siblingDiscount,
} = require('../lib/gate-dates');
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

const FIRST = 'Audit FirstSibling';
const SECOND = 'Audit SecondSibling';
const RETRY = 'Audit RetryChild';
const SIBLING_LINE = 'sibling discount (10%)';
const AMOUNT_LABEL = 'Amount';
const NOTE_LABEL = 'Note';
const CONFIRM_CHARGE = 'Confirm Charge';
const RECORD_PAYMENT = 'Record Payment';
const CANCEL = 'Cancel';
const NOTE_HINT = 'A note is required to record an offline payment.';

function cardLabel(paymentMethod) {
  const brand = paymentMethod.cardBrand.charAt(0).toUpperCase() + paymentMethod.cardBrand.slice(1);
  return `${brand} •••• ${paymentMethod.cardLast4}`;
}

async function liveRow(page, name) {
  await searchSubscriptions(page, name.split(' ').pop());
  const rows = liveRowsOf(page, name);
  const count = await rows.count();
  expectThat(count === 1, `${count} non-cancelled rows for ${name}`);
  return rows.first();
}

async function cancelDialog(page) {
  await chargeDialog(page).getByRole('button', { name: CANCEL, exact: true }).click();
  await chargeDialog(page).waitFor({ state: 'hidden' });
}

module.exports = {
  id: 'charge-dialog-modes',
  accounts: { admin: 'superadmin' },

  async preconditions(g) {
    const rows = [];
    const today = centralToday();
    const subs = {};
    const previews = {};

    for (const name of [FIRST, SECOND]) {
      // eslint-disable-next-line no-await-in-loop -- two reads.
      const sub = await g.api.activeSubscriptionOf(name);
      // eslint-disable-next-line no-await-in-loop
      const preview = sub ? await g.api.chargePreview(sub._id) : null;
      const paid = preview && preview.monthAlreadyPaid;
      const ok =
        sub &&
        preview.outcome === 'previewable' &&
        !preview.inDunning &&
        paid &&
        paid.chargeMethod === 'card' &&
        compareDays(daySentinel(preview.nextBillingDate), today) > 0;
      rows.push({
        n: name === FIRST ? 'P1' : 'P2',
        expect: `${name} is active, not in dunning, paid by card this month, next billing after today`,
        seen: sub
          ? `inDunning ${Boolean(preview.inDunning)}; paid ${paid ? `${money(paid.amount)} on ${formatDay(instantDay(paid.paidAt))} (${paid.chargeMethod})` : 'no'}; next billing ${preview.nextBillingDate ? formatDay(daySentinel(preview.nextBillingDate)) : '—'}`
          : 'no active subscription',
        result: ok ? 'pass' : 'blocked',
      });
      subs[name] = sub;
      previews[name] = preview;
    }

    const retry = await g.api.activeSubscriptionOf(RETRY);
    const retryPreview = retry ? await g.api.chargePreview(retry._id) : null;
    const retryOk = retry && retryPreview.inDunning && retryPreview.retryCount >= 1;
    rows.push({
      n: 'P3',
      expect: `${RETRY} is active and in dunning (retryCount ≥ 1) with a failed charge`,
      seen: retry
        ? `inDunning ${Boolean(retryPreview.inDunning)}; retry ${retryPreview.retryCount} of ${(retryPreview.retryCount || 0) + (retryPreview.attemptsRemaining || 0)}; failed amount ${money(retryPreview.amount || 0)}`
        : 'no active subscription — the retry job may have cancelled it; re-run the live audit (S6)',
      result: retryOk ? 'pass' : 'blocked',
    });

    if (rows.some((row) => row.result === 'blocked')) return rows;

    const first = subs[FIRST];
    const priceA = await g.api.priceOfLevel(first.scheduleId.classId.levelId.name);
    const priceB = await g.api.priceOfLevel(subs[SECOND].scheduleId.classId.levelId.name);
    const prorated = prorate(priceA.monthlyFee, first.scheduleId.dayOfWeek, today);
    rows.push({
      n: 'P4',
      expect: 'P_A for Level A today (computed)',
      seen: `${formatDay(today)} (Central) → ${prorated.arithmetic}`,
      result: 'pass',
    });
    rows.push({
      n: 'P5',
      expect: 'Staging serves the commit being promoted (recorded)',
      seen: g.commit === 'unknown' ? 'develop commit unknown' : `develop at ${g.commit}`,
      result: 'pass',
    });

    const retryTotal = (retryPreview.retryCount || 0) + (retryPreview.attemptsRemaining || 0);
    g.facts = {
      today,
      feeA: priceA.monthlyFee,
      feeB: priceB.monthlyFee,
      prorated,
      firstPreview: previews[FIRST],
      secondDiscount: siblingDiscount(priceB.monthlyFee),
      retry: { n: retryPreview.retryCount, of: retryTotal, amount: retryPreview.amount },
    };
    return rows;
  },

  steps: [
    step(1, 'Open /admin/subscriptions logged in as the staging superadmin.', 'The Subscriptions table loads; the sidebar shows Superadmin.', async (g) => {
      const page = g.pages.admin;
      const rows = await openSubscriptions(page, g.url);
      const role = await page.getByText('superadmin', { exact: true }).count();
      expectThat(role > 0, 'No superadmin role shown in the sidebar');
      return `${await rows.count()} rows; sidebar role "superadmin"`;
    }),

    step(
      2,
      'Search FirstSibling and click Charge on its row.',
      'Card selected; Full month and Prorated amounts; the already-paid notice; Monthly fee and Total equal the plan fee, no sibling line; the card on file; Confirm Charge disabled.',
      async (g) => {
        const page = g.pages.admin;
        const { feeA, prorated, firstPreview } = g.facts;
        const row = await liveRow(page, FIRST);
        g.facts.firstRowText = await readText(row);
        const dialog = await openChargeDialog(page, row);
        const text = await readText(dialog);
        const notice = `Already paid through this period. Not due until ${formatDay(daySentinel(firstPreview.nextBillingDate))} — the Confirm button unlocks then.`;
        const checks = [
          text.includes('Audit Class A — Audit Level A'),
          await dialog.getByLabel(/Charge card on file/).isChecked(),
          text.includes(`Full month — ${money(feeA)}`),
          text.includes(`Prorated from today — ${money(prorated.amount)}`),
          text.includes(notice),
          text.includes(`Monthly fee: ${money(feeA)}`),
          !text.includes(SIBLING_LINE),
          totalIn(text) === feeA,
          text.includes(cardLabel(firstPreview.paymentMethod)),
          await chargeDialog(page).getByRole('button', { name: CONFIRM_CHARGE, exact: true }).isDisabled(),
        ];
        expectThat(checks.every(Boolean), `${text} (checks ${checks.map((ok) => (ok ? '✓' : '✗')).join('')})`);
        return shorten(text, 400);
      }
    ),

    step(
      3,
      'Select Prorated from today.',
      'The month-already-paid notice; billing period today to the 1st of next month; Total P_A, no sibling line; Confirm Charge still disabled.',
      async (g) => {
        const page = g.pages.admin;
        const dialog = chargeDialog(page);
        const { today, prorated, firstPreview } = g.facts;
        await dialog.getByLabel(/Prorated from today/).check();
        const text = await readText(dialog);
        const paid = firstPreview.monthAlreadyPaid;
        const notice = `This month is already paid — ${money(paid.amount)} on ${formatDay(instantDay(paid.paidAt))} (card).`;
        const period = `${formatDay(today)} – ${formatDay(firstOfMonthAfter(today))}`;
        const checks = [
          text.includes(notice),
          text.includes(period),
          totalIn(text) === prorated.amount,
          !text.includes(SIBLING_LINE),
          await chargeDialog(page).getByRole('button', { name: CONFIRM_CHARGE, exact: true }).isDisabled(),
        ];
        expectThat(checks.every(Boolean), `${text} (checks ${checks.map((ok) => (ok ? '✓' : '✗')).join('')})`);
        return shorten(text, 400);
      }
    ),

    step(
      4,
      'Select Record offline payment.',
      'Record Payment shown and disabled; Card on file replaced by Amount prefilled with P_A and an empty Note with its hint.',
      async (g) => {
        const page = g.pages.admin;
        const dialog = chargeDialog(page);
        await dialog.getByLabel(/Record offline payment/).check();
        const amount = await dialog.getByLabel(AMOUNT_LABEL, { exact: true }).inputValue();
        const note = await dialog.getByLabel(NOTE_LABEL, { exact: true }).inputValue();
        const text = await readText(dialog);
        const checks = [
          await chargeDialog(page).getByRole('button', { name: RECORD_PAYMENT, exact: true }).isDisabled(),
          !text.includes('Card on file'),
          amount === g.facts.prorated.amount.toFixed(2),
          note === '',
          text.includes(NOTE_HINT),
        ];
        expectThat(checks.every(Boolean), `Amount "${amount}", Note "${note}"; ${text} (checks ${checks.map((ok) => (ok ? '✓' : '✗')).join('')})`);
        return `Record Payment disabled; Amount "${amount}"; Note empty; "${NOTE_HINT}"`;
      }
    ),

    step(5, 'Select Full month.', 'Amount re-prefills to the plan fee; the already-paid-through notice returns.', async (g) => {
      const dialog = chargeDialog(g.pages.admin);
      await dialog.getByLabel(/Full month/).check();
      const amount = await dialog.getByLabel(AMOUNT_LABEL, { exact: true }).inputValue();
      const text = await readText(dialog);
      expectThat(amount === g.facts.feeA.toFixed(2) && text.includes('Already paid through this period'), `Amount "${amount}"; ${text}`);
      return `Amount "${amount}"; notice "Already paid through this period…"`;
    }),

    step(
      6,
      'Select Charge card on file, then close with Cancel.',
      'Confirm Charge and Card on file return before closing; the dialog closes; the row is unchanged.',
      async (g) => {
        const page = g.pages.admin;
        const dialog = chargeDialog(page);
        await dialog.getByLabel(/Charge card on file/).check();
        const back = (await chargeDialog(page).getByRole('button', { name: CONFIRM_CHARGE, exact: true }).count()) === 1 && (await readText(dialog)).includes('Card on file');
        expectThat(back, `Before closing: ${await readText(dialog)}`);
        await cancelDialog(page);
        const after = await readText(liveRowsOf(page, FIRST).first());
        expectThat(after === g.facts.firstRowText, `Row changed: before "${g.facts.firstRowText}", after "${after}"`);
        return `Confirm Charge and Card on file returned; dialog closed; row unchanged "${shorten(after, 160)}"`;
      }
    ),

    step(
      7,
      'Search SecondSibling, click Charge (Full month is selected), then close with Cancel.',
      'Monthly fee, the 10% sibling line and the discounted Total and Full month amounts; Confirm Charge disabled.',
      async (g) => {
        const page = g.pages.admin;
        const { feeB, secondDiscount } = g.facts;
        const dialog = await openChargeDialog(page, await liveRow(page, SECOND));
        const text = await readText(dialog);
        const checks = [
          text.includes(`Monthly fee: ${money(feeB)}`),
          text.includes(`− ${money(secondDiscount.discount)} ${SIBLING_LINE}`),
          totalIn(text) === secondDiscount.total,
          text.includes(`Full month — ${money(secondDiscount.total)}`),
          await chargeDialog(page).getByRole('button', { name: CONFIRM_CHARGE, exact: true }).isDisabled(),
        ];
        expectThat(checks.every(Boolean), `${text} (checks ${checks.map((ok) => (ok ? '✓' : '✗')).join('')})`);
        await cancelDialog(page);
        return shorten(text, 400);
      }
    ),

    step(
      8,
      'Search RetryChild, click Charge.',
      'The retry-attempt notice; no Period covered; Monthly fee and the failed amount as Total; Confirm Charge enabled by design (never clicked).',
      async (g) => {
        const page = g.pages.admin;
        const { retry, feeA } = g.facts;
        const dialog = await openChargeDialog(page, await liveRow(page, RETRY));
        const text = await readText(dialog);
        const notice = `Retry attempt ${retry.n} of ${retry.of} — charging the locked amount from the failed charge.`;
        const checks = [
          await dialog.getByLabel(/Charge card on file/).isChecked(),
          text.includes(notice),
          !text.includes('Period covered'),
          text.includes(`Monthly fee: ${money(feeA)}`),
          totalIn(text) === retry.amount,
          await chargeDialog(page).getByRole('button', { name: CONFIRM_CHARGE, exact: true }).isEnabled(),
        ];
        expectThat(checks.every(Boolean), `${text} (checks ${checks.map((ok) => (ok ? '✓' : '✗')).join('')})`);
        return shorten(text, 400);
      }
    ),

    step(
      9,
      'Select Record offline payment, then close with Cancel.',
      'The dunning notice; Amount prefilled with the failed amount; Record Payment disabled while Note is empty; the dialog closes.',
      async (g) => {
        const page = g.pages.admin;
        const dialog = chargeDialog(page);
        const { retry } = g.facts;
        await dialog.getByLabel(/Record offline payment/).check();
        const text = await readText(dialog);
        const amount = await dialog.getByLabel(AMOUNT_LABEL, { exact: true }).inputValue();
        const notice = `This subscription is in dunning (retry ${retry.n} of ${retry.of}). Recording a payment below clears the retry cycle.`;
        const checks = [text.includes(notice), amount === retry.amount.toFixed(2), await chargeDialog(page).getByRole('button', { name: RECORD_PAYMENT, exact: true }).isDisabled()];
        expectThat(checks.every(Boolean), `Amount "${amount}"; ${text} (checks ${checks.map((ok) => (ok ? '✓' : '✗')).join('')})`);
        await cancelDialog(page);
        return `"${notice}"; Amount "${amount}"; Record Payment disabled; dialog closed`;
      }
    ),
  ],
};
