// Live gate trial-cancel-reschedule — mirrors
// docs/live-gates/trial-cancel-reschedule.md step for step. Signed in as the
// gate's own audit family (audit-trial-parent, child Audit TrialChild, from
// seedAuditFixtures.js), so no real family and no other audit scenario is
// touched. It books, moves and cancels one trial (mutates: true, so the
// runner needs --allow-writes); no money moves, and step 9 leaves the child
// with no trial, so the gate can run again.

const { step, expectThat } = require('../lib/gate-runner');
const { readText, shorten, waitUntil } = require('../lib/gate-page');

const PARENT = 'audit-trial-parent@example.com';
const CHILD = 'Audit TrialChild';
const AUDIT_CLASSES = ['Audit Class A', 'Audit Class B'];
const BOOKING_CLASS = 'Audit Class A';
const LEVEL = 'Audit Level A';

const BOOK_CTA = 'Book a free trial →';
const RESCHEDULE_LINK = 'Reschedule trial';
const CANCEL_BUTTON = 'Cancel trial';
const CANCEL_DIALOG = 'Cancel Trial';
const CONFIRM_CANCEL = 'Cancel Trial';
const LEVEL_SELECT = 'Level';
const SESSION_PICKER = 'Select a session';
const BOOK_SUBMIT = 'Book Trial Class';
const RESCHEDULE_SUBMIT = 'Reschedule Trial';
const RESCHEDULE_TITLE = 'Reschedule Trial';
const BOOKED = 'Trial class booked!';
const RESCHEDULED = 'Trial class rescheduled!';
const BACK = 'Back to Dashboard';

// Intl may put a narrow no-break space before AM/PM; compare text with every
// run of whitespace as one plain space.
function normalize(text) {
  return text.replace(/\s+/g, ' ').trim();
}

// A session pill reads "<day, with year>" over "<time range>". The dashboard,
// the reschedule badge and the cancel dialog show the same day without the
// year: "Tue, Nov 3 · 4:00 PM–5:00 PM".
async function readPill(pill) {
  const day = normalize(await pill.locator('span').nth(0).innerText());
  const time = normalize(await pill.locator('span').nth(1).innerText());
  return { line: `${day} · ${time}`, short: `${day.replace(/, \d{4}$/, '')} · ${time}` };
}

// The portal shell's <main>: the page content, without the sidebar (which
// repeats each child's name and status). The gate family has one child, so
// within it every label below is unique.
function content(page) {
  return page.locator('main').first();
}

// The dashboard card's name-and-status link: "Audit TrialChild" over its
// enrollment line.
async function cardText(page) {
  return normalize(await readText(content(page).getByRole('link', { name: CHILD })));
}

async function actionCount(page) {
  const area = content(page);
  const reschedule = await area.getByRole('link', { name: RESCHEDULE_LINK, exact: true }).count();
  const cancel = await area.getByRole('button', { name: CANCEL_BUTTON, exact: true }).count();
  return { reschedule, cancel };
}

function sessionPills(page) {
  return page.getByRole('radiogroup', { name: SESSION_PICKER }).getByRole('radio');
}

async function confirmationText(page) {
  return normalize(await readText(content(page)));
}

module.exports = {
  id: 'trial-cancel-reschedule',
  accounts: { parent: PARENT },

  async preconditions(g) {
    const rows = [];
    const { groupClasses } = await g.api.get('/group-classes');
    const classes = AUDIT_CLASSES.map((name) => groupClasses.find((groupClass) => groupClass.name === name));
    const sessionsByClass = {};
    for (const groupClass of classes.filter(Boolean)) {
      // eslint-disable-next-line no-await-in-loop -- two reads.
      sessionsByClass[groupClass.name] = (await g.api.get(`/group-class-sessions/by-class/${groupClass._id}`)).sessions;
    }

    const bookable = sessionsByClass[BOOKING_CLASS] || [];
    rows.push({
      n: 'P1',
      expect: `${BOOKING_CLASS} has at least two upcoming trial sessions`,
      seen: classes[0] ? `${bookable.length} upcoming sessions` : `${BOOKING_CLASS} not found`,
      result: bookable.length >= 2 ? 'pass' : 'blocked',
    });

    const onRoster = [];
    for (const [className, sessions] of Object.entries(sessionsByClass)) {
      for (const session of sessions) {
        // eslint-disable-next-line no-await-in-loop -- at most 16 reads.
        const detail = (await g.api.get(`/group-class-sessions/${session._id}`)).session;
        const listed = detail.students.some(
          (entry) => entry.studentId && `${entry.studentId.firstName} ${entry.studentId.lastName}` === CHILD
        );
        if (listed) onRoster.push(`${className} ${session.date.slice(0, 10)}`);
      }
    }
    rows.push({
      n: 'P2',
      expect: `${CHILD} has no trial on any upcoming audit roster`,
      seen: onRoster.length === 0 ? 'on no upcoming roster' : `already on ${onRoster.join(', ')} — run npm run audit:reset, then npm run audit:seed`,
      result: onRoster.length === 0 ? 'pass' : 'blocked',
    });

    rows.push({
      n: 'P3',
      expect: 'Staging serves the commit being promoted (recorded)',
      seen: g.commit === 'unknown' ? 'develop commit unknown' : `develop at ${g.commit}`,
      result: 'pass',
    });

    g.facts = { upcomingCount: bookable.length };
    return rows;
  },

  steps: [
    step(
      1,
      'Open /parent/dashboard.',
      `The ${CHILD} card offers "${BOOK_CTA}", and no "${RESCHEDULE_LINK}" or "${CANCEL_BUTTON}".`,
      async (g) => {
        const page = g.pages.parent;
        await page.goto(`${g.url}/parent/dashboard`);
        await content(page).getByRole('link', { name: CHILD }).waitFor();
        const book = await content(page).getByRole('link', { name: BOOK_CTA }).count();
        const { reschedule, cancel } = await actionCount(page);
        const text = await cardText(page);
        expectThat(book === 1 && reschedule === 0 && cancel === 0, `${text} (Book a free trial: ${book}, Reschedule: ${reschedule}, Cancel: ${cancel})`);
        return `${text} · ${BOOK_CTA}`;
      }
    ),

    step(
      2,
      `Click "${BOOK_CTA}", pick ${CHILD}, choose level ${LEVEL}, pick the first session, click "${BOOK_SUBMIT}".`,
      `"${BOOKED}", with the Session line of the session picked.`,
      async (g) => {
        const page = g.pages.parent;
        await content(page).getByRole('link', { name: BOOK_CTA }).click();
        await page.waitForURL('**/parent/book-trial');
        await page.getByRole('radio', { name: CHILD }).click();
        await page.getByLabel(LEVEL_SELECT).selectOption({ label: LEVEL });
        const pill = sessionPills(page).first();
        await pill.waitFor();
        g.facts.booked = await readPill(pill);
        await pill.click();
        await page.getByRole('button', { name: BOOK_SUBMIT }).click();
        await page.getByText(BOOKED).waitFor();
        const text = await confirmationText(page);
        expectThat(text.includes(g.facts.booked.line), `${shorten(text, 300)} (expected "${g.facts.booked.line}")`);
        return `${BOOKED} ${g.facts.booked.line}`;
      }
    ),

    step(
      3,
      `Click "${BACK}".`,
      `The card reads "Trial class — <day> · <time>" for that session, and offers "${RESCHEDULE_LINK}" and "${CANCEL_BUTTON}".`,
      async (g) => {
        const page = g.pages.parent;
        await page.getByRole('link', { name: BACK }).click();
        await page.waitForURL('**/parent/dashboard');
        await content(page).getByRole('link', { name: RESCHEDULE_LINK, exact: true }).waitFor();
        const expected = `Trial class — ${g.facts.booked.short}`;
        const text = await cardText(page);
        const { reschedule, cancel } = await actionCount(page);
        expectThat(text.includes(expected) && reschedule === 1 && cancel === 1, `${text} (expected "${expected}", Reschedule: ${reschedule}, Cancel: ${cancel})`);
        return `${text} · ${RESCHEDULE_LINK} · ${CANCEL_BUTTON}`;
      }
    ),

    step(
      4,
      `Click "${RESCHEDULE_LINK}".`,
      `/parent/book-trial?reschedule=<child id>, the title "${RESCHEDULE_TITLE}", and only ${CHILD}'s card, chosen, reading "Currently <day> · <time>".`,
      async (g) => {
        const page = g.pages.parent;
        await content(page).getByRole('link', { name: RESCHEDULE_LINK, exact: true }).click();
        await page.waitForURL('**/parent/book-trial?reschedule=*');
        await page.getByRole('heading', { name: RESCHEDULE_TITLE }).waitFor();
        const cards = page.getByRole('radiogroup', { name: 'Select a child' }).getByRole('radio');
        const count = await cards.count();
        const checked = await cards.first().getAttribute('aria-checked');
        const text = normalize(await readText(cards.first()));
        const expected = `Currently ${g.facts.booked.short}`;
        expectThat(count === 1 && checked === 'true' && text.includes(CHILD) && text.includes(expected), `${count} card(s), checked=${checked}: "${text}" (expected "${expected}")`);
        return `${page.url().replace(g.url, '')} — ${text}`;
      }
    ),

    step(
      5,
      `Choose level ${LEVEL}.`,
      'The session picker does not offer the booked session: one session fewer than the precondition counted.',
      async (g) => {
        const page = g.pages.parent;
        await page.getByLabel(LEVEL_SELECT).selectOption({ label: LEVEL });
        await sessionPills(page).first().waitFor();
        const offered = [];
        const pills = sessionPills(page);
        const count = await pills.count();
        for (let i = 0; i < count; i += 1) {
          // eslint-disable-next-line no-await-in-loop -- read in order.
          offered.push((await readPill(pills.nth(i))).line);
        }
        const expectedCount = g.facts.upcomingCount - 1;
        expectThat(
          !offered.includes(g.facts.booked.line) && count === expectedCount,
          `${count} offered (expected ${expectedCount}, without "${g.facts.booked.line}"): ${offered.join(' | ')}`
        );
        return `${count} offered, booked session left out: ${shorten(offered.join(' | '), 300)}`;
      }
    ),

    step(
      6,
      `Pick the first session offered, click "${RESCHEDULE_SUBMIT}".`,
      `"${RESCHEDULED}", with the Session line of the new session.`,
      async (g) => {
        const page = g.pages.parent;
        const pill = sessionPills(page).first();
        g.facts.moved = await readPill(pill);
        await pill.click();
        await page.getByRole('button', { name: RESCHEDULE_SUBMIT }).click();
        await page.getByText(RESCHEDULED).waitFor();
        const text = await confirmationText(page);
        expectThat(text.includes(g.facts.moved.line), `${shorten(text, 300)} (expected "${g.facts.moved.line}")`);
        return `${RESCHEDULED} ${g.facts.moved.line}`;
      }
    ),

    step(
      7,
      `Click "${BACK}".`,
      'The card reads "Trial class — <new day> · <time>".',
      async (g) => {
        const page = g.pages.parent;
        await page.getByRole('link', { name: BACK }).click();
        await page.waitForURL('**/parent/dashboard');
        const expected = `Trial class — ${g.facts.moved.short}`;
        await waitUntil(async () => (await cardText(page)).includes(expected), { what: 'the moved trial on the dashboard' });
        return cardText(page);
      }
    ),

    step(
      8,
      `Click "${CANCEL_BUTTON}".`,
      `A "${CANCEL_DIALOG}" dialog naming the child and the new day and time.`,
      async (g) => {
        const page = g.pages.parent;
        await content(page).getByRole('button', { name: CANCEL_BUTTON, exact: true }).click();
        const dialog = page.getByRole('dialog', { name: CANCEL_DIALOG });
        await dialog.waitFor();
        const expected = `Cancel Audit's free trial on ${g.facts.moved.short}? You can book a new trial afterwards.`;
        const text = normalize(await readText(dialog));
        expectThat(text.includes(expected), `${text} (expected "${expected}")`);
        return text;
      }
    ),

    step(
      9,
      `Click "${CONFIRM_CANCEL}" in the dialog.`,
      `The dialog closes, and the card offers "${BOOK_CTA}" again, with no "${RESCHEDULE_LINK}" or "${CANCEL_BUTTON}".`,
      async (g) => {
        const page = g.pages.parent;
        const dialog = page.getByRole('dialog', { name: CANCEL_DIALOG });
        await dialog.getByRole('button', { name: CONFIRM_CANCEL }).click();
        await dialog.waitFor({ state: 'hidden' });
        await content(page).getByRole('link', { name: BOOK_CTA }).waitFor();
        const { reschedule, cancel } = await actionCount(page);
        const text = await cardText(page);
        expectThat(reschedule === 0 && cancel === 0, `${text} (Reschedule: ${reschedule}, Cancel: ${cancel})`);
        return `${text} · ${BOOK_CTA}`;
      }
    ),
  ],
};
