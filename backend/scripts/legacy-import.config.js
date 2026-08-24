// Business config for backend/scripts/import-legacy-data.js — the part of
// the migration that's hand-edited (not scripted), then re-run. Everything
// here is a plain value: swap the placeholder coach names/emails/rate for
// the real ones before the go-live re-run and nothing else about the
// pipeline changes. Derived from `Class Schedule_New_Dueforapproval_v1.pdf`
// (Aug 2026–Aug 2027) and the coach/level assignments the owner gave
// (2026-08-24 planning conversation).

const LOCATION = {
  name: 'Frisco Fencing Academy',
  // PLACEHOLDER — the PDF doesn't state a street address. Fill in the real
  // studio address before the go-live run.
  address: '[PLACEHOLDER — studio street address]',
};

// PLACEHOLDER last names/emails/passwords — first names are real (per the
// owner), everything else is filled in later by editing this file and
// re-running the import (upserts by email, so editing an email here creates
// a new coach record rather than renaming the placeholder one — a deliberate
// one-time edit, not something the script infers).
const COACHES = {
  abel: {
    firstName: 'Abel',
    lastName: '[PLACEHOLDER LAST NAME]',
    email: 'coach-abel@friscofencing.local',
    password: 'ChangeMe-Abel-2026!',
  },
  chris: {
    firstName: 'Chris',
    lastName: '[PLACEHOLDER LAST NAME]',
    email: 'coach-chris@friscofencing.local',
    password: 'ChangeMe-Chris-2026!',
  },
  keith: {
    firstName: 'Keith',
    lastName: '[PLACEHOLDER LAST NAME]',
    email: 'coach-keith@friscofencing.local',
    password: 'ChangeMe-Keith-2026!',
  },
  mark: {
    firstName: 'Mark',
    lastName: '[PLACEHOLDER LAST NAME]',
    email: 'coach-mark@friscofencing.local',
    password: 'ChangeMe-Mark-2026!',
  },
};

// PDF doesn't state a capacity for any level — 20 is a placeholder default,
// same as every level, editable per-level before go-live.
const DEFAULT_CAPACITY = 20;

// One Level per PDF row. `order` drives display sort. `aliases` are legacy
// CSV `Programs` values that map onto this level (case-insensitive, matched
// after stripping any parenthetical suffix like "(Competitive)" — see
// scripts/lib/familyGrouping.js's resolveProgram()). "Toddler Program" is
// folded into Fencing Foundation, not a separate level (owner decision,
// 2026-08-24): same below-7 class, just renamed in the new schedule.
// order starts at 10 — staging also carries backend/scripts/audit-seed.js's
// fixed "Audit Level A/B" (order 900/901), so this just stays clear of both
// that range and any low single-digit scratch numbers a manual admin-panel
// test might reach for.
const LEVELS = {
  fencingFoundation: {
    name: 'Fencing Foundation',
    order: 10,
    monthlyFee: 120,
    capacity: DEFAULT_CAPACITY,
    aliases: ['fencing foundation', 'toddler program'],
  },
  beginnerUnder10: {
    name: 'Beginners (Below 10 Yrs)',
    order: 11,
    monthlyFee: 245,
    capacity: DEFAULT_CAPACITY,
    aliases: ['beginner under 10'],
  },
  beginnerAbove10: {
    name: 'Beginners (10 Yrs and above)',
    order: 12,
    monthlyFee: 245,
    capacity: DEFAULT_CAPACITY,
    aliases: ['beginner above 10y'],
  },
  intermediate: {
    name: 'Intermediate',
    order: 13,
    monthlyFee: 275,
    capacity: DEFAULT_CAPACITY,
    // The CSV's "(Age 13 -18)" suffix is stripped before matching, so this
    // one alias covers "Intermediate (Age 13 -18)" too.
    aliases: ['intermediate'],
  },
  advanced: {
    name: 'Advanced',
    order: 14,
    monthlyFee: 390,
    capacity: DEFAULT_CAPACITY,
    aliases: ['advanced'],
  },
  adults: {
    name: 'Adults',
    order: 15,
    monthlyFee: 220,
    capacity: DEFAULT_CAPACITY,
    aliases: ['adults'],
  },
};

// JS Date.getDay() convention: 0=Sunday...6=Saturday, matching
// GroupClassSchedule's own convention.
const DAYS = { SUN: 0, MON: 1, TUE: 2, WED: 3, THU: 4, FRI: 5, SAT: 6 };

// One GroupClass per level; each gets 1+ GroupClassSchedule rows below.
// Exactly one schedule per level is `primary: true` — that's the slot the
// migration anchors a student's real Registration/Subscription (billing +
// renewal) to. Every other schedule for that level gets the student added
// to its roster directly (no separate Registration/Subscription), which is
// what "one flat monthly fee, attend any scheduled session" (owner
// clarification, 2026-08-24) means under the CURRENT schema — Track 2 (the
// docs/decisions ADR to re-key Subscription to classId instead of
// scheduleId) is what removes the need for this primary/roster-only split
// entirely; this is the interim, schema-compatible shape.
const CLASS_SCHEDULES = {
  fencingFoundation: [
    { coach: 'chris', day: DAYS.SAT, start: '13:20', end: '14:00', primary: true },
  ],
  beginnerUnder10: [
    { coach: 'chris', day: DAYS.MON, start: '16:45', end: '17:45', primary: true },
    { coach: 'chris', day: DAYS.WED, start: '16:45', end: '17:45' },
    { coach: 'chris', day: DAYS.FRI, start: '16:45', end: '17:45' },
  ],
  beginnerAbove10: [
    { coach: 'abel', day: DAYS.TUE, start: '16:45', end: '17:45', primary: true },
    { coach: 'abel', day: DAYS.THU, start: '16:45', end: '17:45' },
    { coach: 'abel', day: DAYS.SAT, start: '09:00', end: '10:00' },
  ],
  intermediate: [
    // Fencing sessions (Coach Chris) — Tue is the primary/billing anchor
    // since Monday is the fitness add-on, not a fencing session.
    { coach: 'chris', day: DAYS.TUE, start: '18:00', end: '19:00', primary: true },
    { coach: 'chris', day: DAYS.THU, start: '18:00', end: '20:00' },
    { coach: 'chris', day: DAYS.SAT, start: '10:30', end: '13:00' },
    // Fitness add-on (Coach Keith), bundled into the same monthly fee.
    { coach: 'keith', day: DAYS.MON, start: '17:30', end: '18:30' },
  ],
  advanced: [
    { coach: 'chris', day: DAYS.TUE, start: '19:00', end: '20:30', primary: true },
    { coach: 'chris', day: DAYS.WED, start: '18:00', end: '20:00' },
    { coach: 'chris', day: DAYS.FRI, start: '18:00', end: '20:30' },
    { coach: 'chris', day: DAYS.SAT, start: '10:30', end: '13:00' },
    // Fitness (Coach Keith) + Mental Coaching (Coach Mark) add-ons, both
    // Monday, both bundled into the same monthly fee.
    { coach: 'keith', day: DAYS.MON, start: '17:30', end: '18:30' },
    { coach: 'mark', day: DAYS.MON, start: '19:00', end: '20:00' },
  ],
  adults: [
    { coach: 'chris', day: DAYS.WED, start: '18:00', end: '20:00', primary: true },
    { coach: 'chris', day: DAYS.SAT, start: '15:00', end: '16:00' },
  ],
};

// Coach Chris's private-lesson rate (docs/features/private-class.md).
// PLACEHOLDER — the PDF/CSV don't state a real rate. Fill in the real
// $/hour figures before the go-live run; the one legacy private-class
// student (Sana Sarath, PIN 6221) gets her agreedHourlyRate pinned from
// whatever this contract says at import time.
const PRIVATE_CLASS_CONTRACT = {
  coach: 'chris',
  studentBillingRate: 60,
  coachCompensationRate: 30,
  sessionDurationMinutes: 60,
  notes: 'PLACEHOLDER rate, created by import-legacy-data.js — confirm the real rate before go-live.',
};

// A legacy "people" row is excluded from the import entirely (not migrated
// as a user at all) if it matches one of these — Kicksite's own bundled
// system contact, plus ad-hoc test rows found in the 2026-08-23 export
// (PINs 6627, 8394, 4469). Automated, not a per-record decision: edit this
// list if a future export contains other obvious junk, rather than hand-
// filtering rows.
const TEST_RECORD_FILTERS = {
  emailDomains: ['kicksite.net'],
  firstNamePrefixes: ['test'],
};

module.exports = {
  LOCATION,
  COACHES,
  LEVELS,
  CLASS_SCHEDULES,
  PRIVATE_CLASS_CONTRACT,
  TEST_RECORD_FILTERS,
};
