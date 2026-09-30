// The front-desk sign-in tablet's timings and search rule, in one place
// (docs/plans/kiosk-signin-plan.md K3/K7). Kept out of app/kiosk/page.tsx:
// an App Router page file may only export its default component.

// How long the "signed in" card stays before the tablet returns to search.
export const SUCCESS_DISMISS_MS = 5000;

// How often the idle search screen refreshes (new students, a flipped
// confirmation setting).
export const POLL_INTERVAL_MS = 30_000;

// Names stay hidden until this many characters are typed, so a screen
// visitors can see never lists every enrolled child by default.
export const MIN_SEARCH_LENGTH = 2;
