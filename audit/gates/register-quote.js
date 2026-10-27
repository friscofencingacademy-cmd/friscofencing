// Live gate register-quote — mirrors docs/live-gates/register-quote.md step for
// step. Signed in as the decline parent, who never has a card on file (the
// weekly reset deletes it and S4 only tries a declining card), so the payment
// section is the inline Add Card form and Register & Pay stays disabled. It is
// never clicked; the write guard would block it if it were.

const { step, expectThat, skipped } = require('../lib/gate-runner');
const { centralToday, firstOfMonthAfter, formatDay, money, parsePillDay, prorate, weekdayOf } = require('../lib/gate-dates');
const { readText, shorten, waitUntil } = require('../lib/gate-page');

const PARENT = 'audit-decline-parent@example.com';
const CHILD = 'Audit DeclineChild';
const PREFERRED_LEVEL = 'Audit Level B';
const OTHER_LEVEL = 'Audit Level A';
const LEVELS = [PREFERRED_LEVEL, OTHER_LEVEL];

const PAGE_TITLE = 'Register for a Class';
const LIVE_QUOTE = 'Live Quote';
const LEVEL_SECTION = 'Choose your level';
const START_SECTION = 'Choose your start date';
const LOADING_DATES = 'Loading upcoming dates...';
const NEXT_MONTH = 'Enroll for next month';
const FIRST_CLASS = /First class/;
const ALREADY_ENROLLED = 'Already enrolled';
const ADD_CARD = 'Add Card';
const REGISTER_AND_PAY = 'Register & Pay';
const BREADCRUMB = 'Breadcrumb';
const HOME = 'Home';

const START_DATE = 'Start Date';
const MONTHLY_FEE = 'Monthly Fee';
const PRORATED = 'Prorated';
const REGISTRATION_FEE = 'Registration Fee';
const REGISTRATION_FEE_ONE_TIME = 'Registration Fee (one-time)';
const DUE = 'Due at enrollment';
const FULL_PRICE_STARTS = 'Full price starts';
const PLAN_RENEWS = 'Plan renews';

// The Live Quote panel: the innermost element holding the "Live Quote" overline.
function quotePanel(page) {
  return page.locator('div', { has: page.getByText(LIVE_QUOTE, { exact: true }) }).last();
}

// A summary row's value: the span after its label span, or null when the row is absent.
async function valueOf(labelLocator) {
  if ((await labelLocator.count()) === 0) return null;
  return (await labelLocator.first().locator('xpath=following-sibling::span[1]').textContent()).trim();
}

function levelCard(page, levelName) {
  return page.getByRole('radio').filter({ hasText: levelName });
}

function datePills(page) {
  return page.getByRole('radiogroup', { name: 'Select a start date' }).getByRole('radio');
}

async function waitForDates(page) {
  await page.getByRole('heading', { name: START_SECTION }).waitFor();
  await waitUntil(async () => (await page.getByText(LOADING_DATES).count()) === 0, { what: 'the start dates' });
}

// Waits for the level's own sessions request: between the click and that
// request the previous level's pills are still on screen.
async function pickLevel(page, levelName) {
  const sessionsLoaded = page.waitForResponse((response) => response.url().includes('/api/v1/group-class-sessions/by-class/'));
  await levelCard(page, levelName).click();
  await sessionsLoaded;
  await waitForDates(page);
  return datePills(page).count();
}

module.exports = {
  id: 'register-quote',
  accounts: { parent: PARENT },

  async preconditions(g) {
    const rows = [];
    const enrolled = await g.api.activeSubscriptionOf(CHILD);
    rows.push({
      n: 'P1',
      expect: `${CHILD} has no active subscription`,
      seen: enrolled ? 'An active subscription exists — run `npm run audit:reset` in backend/' : 'none active',
      result: enrolled ? 'blocked' : 'pass',
    });

    const prices = {};
    for (const level of LEVELS) {
      // eslint-disable-next-line no-await-in-loop -- two reads.
      prices[level] = await g.api.priceOfLevel(level);
    }
    const feesOk = LEVELS.every((level) => prices[level] && prices[level].registrationFee === 0);
    rows.push({
      n: 'P2',
      expect: 'Audit Level A and Audit Level B both have registrationFee 0',
      seen: LEVELS.map((level) =>
        prices[level] ? `${level} ${money(prices[level].monthlyFee)}/month, registrationFee ${prices[level].registrationFee}` : `${level} has no price`
      ).join('; '),
      result: feesOk ? 'pass' : 'blocked',
    });
    rows.push({
      n: 'P3',
      expect: 'A this-month start date exists (read from the page at step 3; steps 4–5 skip without one)',
      seen: 'checked at step 3',
      result: 'pass',
    });
    rows.push({
      n: 'P4',
      expect: 'Staging serves the commit being promoted (recorded)',
      seen: g.commit === 'unknown' ? 'develop commit unknown' : `develop at ${g.commit}`,
      result: 'pass',
    });

    g.facts = { prices, today: centralToday() };
    return rows;
  },

  steps: [
    step(
      1,
      'Open /parent/register signed in as the decline parent.',
      'Register for a Class; a DeclineChild card with no Already enrolled badge; the Live Quote / Summary panel.',
      async (g) => {
        const page = g.pages.parent;
        await page.goto(`${g.url}/parent/register`);
        await page.getByRole('heading', { name: PAGE_TITLE }).waitFor();
        const card = page.getByRole('radio').filter({ hasText: CHILD });
        await card.waitFor();
        const cardText = await readText(card);
        const panel = await readText(quotePanel(page));
        expectThat(!cardText.includes(ALREADY_ENROLLED) && panel.startsWith('Live Quote · Summary'), `Card "${cardText}"; panel "${panel}"`);
        return `Card "${cardText}"; panel "${shorten(panel, 120)}"`;
      }
    ),

    step(2, 'Click the Audit DeclineChild card.', 'Choose your level appears with both audit levels and their monthly fees.', async (g) => {
      const page = g.pages.parent;
      await page.getByRole('radio').filter({ hasText: CHILD }).click();
      await page.getByRole('heading', { name: LEVEL_SECTION }).waitFor();
      const cards = [];
      for (const level of LEVELS) {
        // eslint-disable-next-line no-await-in-loop -- two cards.
        cards.push(await readText(levelCard(page, level)));
      }
      const expected = LEVELS.map((level) => `${level} · $${g.facts.prices[level].monthlyFee}/month`);
      expectThat(cards.every((text, i) => text === expected[i]), `Cards: ${cards.join(' | ')} (expected ${expected.join(' | ')})`);
      return cards.join(' | ');
    }),

    step(
      3,
      'Click the level with a this-month date (prefer Audit Level B).',
      "This month's dates as pills with times, plus Enroll for next month naming its first class.",
      async (g) => {
        const page = g.pages.parent;
        let chosen = PREFERRED_LEVEL;
        let pills = await pickLevel(page, chosen);
        if (pills === 0) {
          chosen = OTHER_LEVEL;
          pills = await pickLevel(page, chosen);
        }
        if (pills === 0) {
          chosen = PREFERRED_LEVEL;
          await pickLevel(page, chosen);
          const reason = 'No this-month start date for either audit level — steps 4–5 skipped';
          g.skip[4] = reason;
          g.skip[5] = reason;
        }
        g.facts.chosen = chosen;
        g.facts.other = chosen === PREFERRED_LEVEL ? OTHER_LEVEL : PREFERRED_LEVEL;

        const firstClass = (await page.getByText(FIRST_CLASS).textContent()).trim();
        const nextMonth = page.getByRole('button', { name: NEXT_MONTH });
        expectThat((await nextMonth.isEnabled()) && firstClass.startsWith('First class: '), `"${firstClass}"`);
        g.facts.firstClassLine = firstClass.replace('First class: ', '');
        const firstPill = pills > 0 ? await readText(datePills(page).first()) : 'none';
        return `${chosen}: ${pills} this-month date(s), first "${firstPill}"; "${firstClass}"`;
      }
    ),

    step(
      4,
      'Click the first this-month pill.',
      'Monthly Fee; Prorated r of t class days at the daily rate; no Registration Fee; Due at enrollment the prorated amount; Full price starts the 1st of next month; no Sibling Discount; the inline Add Card form.',
      async (g) => {
        const page = g.pages.parent;
        const pill = datePills(page).first();
        const pillText = await readText(pill);
        const day = parsePillDay(pillText);
        expectThat(day, `Could not read a date from the pill "${pillText}"`);
        await pill.click();

        const fee = g.facts.prices[g.facts.chosen].monthlyFee;
        const p = prorate(fee, weekdayOf(day.year, day.month, day.day), day);
        const panel = quotePanel(page);
        await waitUntil(async () => (await valueOf(panel.getByText(DUE, { exact: true }))) != null, { what: 'the quote' });

        const seen = {
          monthlyFee: await valueOf(panel.getByText(MONTHLY_FEE, { exact: true })),
          prorated: await valueOf(panel.getByText(PRORATED, { exact: true })),
          registrationFee:
            (await panel.getByText(REGISTRATION_FEE, { exact: true }).count()) +
            (await panel.getByText(REGISTRATION_FEE_ONE_TIME, { exact: true }).count()),
          due: await valueOf(panel.getByText(DUE, { exact: true })),
          fullPriceStarts: await valueOf(panel.getByText(FULL_PRICE_STARTS, { exact: true })),
          sibling: (await readText(panel)).includes('Sibling Discount'),
          addCard: await page.getByRole('button', { name: ADD_CARD }).isVisible(),
        };
        const expected = {
          monthlyFee: `$${fee}`,
          prorated: `${p.left} of ${p.total} class days · $${p.dailyRate.toFixed(2)}/day`,
          registrationFee: 0,
          due: money(p.amount),
          fullPriceStarts: formatDay(firstOfMonthAfter(day)),
          sibling: false,
          addCard: true,
        };
        const wrong = Object.keys(expected).filter((key) => seen[key] !== expected[key]);
        const line = `${pillText}: Monthly Fee ${seen.monthlyFee}; Prorated ${seen.prorated}; Due ${seen.due}; Full price starts ${seen.fullPriceStarts}; Add Card ${seen.addCard ? 'shown' : 'missing'} (${p.arithmetic})`;
        expectThat(wrong.length === 0, `${line} — wrong: ${wrong.map((key) => `${key} expected ${JSON.stringify(expected[key])}`).join(', ')}`);
        return line;
      }
    ),

    step(5, '(Check only) Register & Pay.', 'The button is visible and disabled (no card on file); it is never clicked.', async (g) => {
      const button = g.pages.parent.getByRole('button', { name: REGISTER_AND_PAY });
      const visible = await button.isVisible();
      const disabled = await button.isDisabled();
      expectThat(visible && disabled, `visible ${visible}, disabled ${disabled}`);
      return 'Register & Pay visible and disabled; not clicked';
    }),

    step(
      6,
      'Click Enroll for next month.',
      "The button turns primary; Start Date the named first class; the full Monthly Fee due; no Prorated, no Registration Fee; Plan renews the 1st of the month after next.",
      async (g) => {
        const page = g.pages.parent;
        const button = page.getByRole('button', { name: NEXT_MONTH });
        await button.click();
        await waitUntil(async () => /primary/.test((await button.getAttribute('class')) || ''), { what: 'the button to turn primary' });

        const fee = g.facts.prices[g.facts.chosen].monthlyFee;
        const panel = quotePanel(page);
        await waitUntil(async () => (await valueOf(panel.getByText(PLAN_RENEWS, { exact: true }))) != null, { what: 'the next-month quote' });
        const seen = {
          startDate: await valueOf(panel.getByText(START_DATE, { exact: true })),
          monthlyFee: await valueOf(panel.getByText(MONTHLY_FEE, { exact: true })),
          prorated: await panel.getByText(PRORATED, { exact: true }).count(),
          registrationFee:
            (await panel.getByText(REGISTRATION_FEE, { exact: true }).count()) +
            (await panel.getByText(REGISTRATION_FEE_ONE_TIME, { exact: true }).count()),
          due: await valueOf(panel.getByText(DUE, { exact: true })),
          planRenews: await valueOf(panel.getByText(PLAN_RENEWS, { exact: true })),
        };
        const expected = {
          startDate: g.facts.firstClassLine,
          monthlyFee: `$${fee}`,
          prorated: 0,
          registrationFee: 0,
          due: money(fee),
          planRenews: formatDay(firstOfMonthAfter(g.facts.today, 2)),
        };
        const wrong = Object.keys(expected).filter((key) => seen[key] !== expected[key]);
        const line = `Start Date ${seen.startDate}; Monthly Fee ${seen.monthlyFee}; Due ${seen.due}; Plan renews ${seen.planRenews}`;
        expectThat(wrong.length === 0, `${line} — wrong: ${wrong.map((key) => `${key} expected ${JSON.stringify(expected[key])}`).join(', ')}`);
        return line;
      }
    ),

    step(
      7,
      "Click the other level's card, then Enroll for next month.",
      "The start date resets with the level; that level's own full fee is Due at enrollment, no Prorated, no Registration Fee.",
      async (g) => {
        const page = g.pages.parent;
        const panel = quotePanel(page);
        await pickLevel(page, g.facts.other);
        const reset = await valueOf(panel.getByText(START_DATE, { exact: true }));
        expectThat(reset === '—', `Start Date after changing level: "${reset}"`);
        await page.getByRole('button', { name: NEXT_MONTH }).click();

        const fee = g.facts.prices[g.facts.other].monthlyFee;
        await waitUntil(async () => (await valueOf(panel.getByText(DUE, { exact: true }))) === money(fee), {
          what: `Due at enrollment ${money(fee)}`,
        });
        const prorated = await panel.getByText(PRORATED, { exact: true }).count();
        const registrationFee =
          (await panel.getByText(REGISTRATION_FEE, { exact: true }).count()) +
          (await panel.getByText(REGISTRATION_FEE_ONE_TIME, { exact: true }).count());
        expectThat(prorated === 0 && registrationFee === 0, `Prorated lines ${prorated}, Registration Fee lines ${registrationFee}`);
        return `${g.facts.other}: Start Date reset to "—"; Due at enrollment ${money(fee)}; no Prorated, no Registration Fee`;
      }
    ),

    step(
      8,
      'Leave the page with the Home breadcrumb.',
      'The parent dashboard loads; nothing was registered (no active subscription, re-checked read-only).',
      async (g) => {
        const page = g.pages.parent;
        await page.getByRole('navigation', { name: BREADCRUMB }).getByRole('link', { name: HOME }).click();
        await page.waitForURL('**/parent/dashboard');
        const enrolled = await g.api.activeSubscriptionOf(CHILD);
        expectThat(!enrolled, `${CHILD} now has an active subscription`);
        return `/parent/dashboard loaded; ${CHILD} still has no active subscription`;
      }
    ),
  ],
};
