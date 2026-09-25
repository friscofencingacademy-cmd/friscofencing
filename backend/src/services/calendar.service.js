const mongoose = require('mongoose');

const GroupClassSession = require('../models/groupClassSession.model');
const PrivateClassSchedule = require('../models/privateClassSchedule.model');
const PrivateClassSession = require('../models/privateClassSession.model');
const Subscription = require('../models/subscription.model');
const TrialClass = require('../models/trialClass.model');
const User = require('../models/user.model');
const holidayService = require('./holiday.service');
const privateClassScheduleService = require('./privateClassSchedule.service');
const { purchaseOptionsFor } = require('../utils/privateClassPricing');
const {
  dateOnlyUTC,
  addDaysToDateOnly,
  sentinelDayString,
  combineDayAndTimeInTZ,
  instantDayString,
} = require('../utils/dateShapes');
const { todayDateOnly } = require('../utils/billingDates');
const { badRequestError } = require('../utils/errors');

// One calendar of what the academy offers, day by day (docs/plans/calendar-
// view-plan.md). The backend builds every event ready to draw — its Central
// calendar `day` included — so the browser does no date math, no
// availability logic and no price math (C1, C3). Three audiences share ONE
// event shape (C5); a public event never names a student.

const MAX_RANGE_DAYS = 42;
const MS_PER_DAY = 24 * 60 * 60 * 1000;
const DAY_STRING = /^\d{4}-\d{2}-\d{2}$/;
const TYPES = ['all', 'group', 'private'];

const RANGE_REQUIRED_MESSAGE = 'from and to are required (YYYY-MM-DD)';

// ── Query parsing ─────────────────────────────────────────────────────────

function parseDayParam(value) {
  if (typeof value !== 'string' || !DAY_STRING.test(value)) {
    throw badRequestError(RANGE_REQUIRED_MESSAGE);
  }

  const sentinel = dateOnlyUTC(value);

  if (Number.isNaN(sentinel.getTime()) || sentinelDayString(sentinel) !== value) {
    throw badRequestError(RANGE_REQUIRED_MESSAGE);
  }

  return sentinel;
}

// C6. Validates the requested range, then — for public/parent callers —
// clips it to today … today + PRIVATE_BOOKING_HORIZON_DAYS. Returns the
// sentinels to query (`fromDay`/`toDay`, possibly an empty range when the
// request lies wholly outside the window) and `horizonTo` ('YYYY-MM-DD', or
// null for admin, who may look back and ahead freely).
function parseRange({ from, to }, { allowPast }) {
  const fromSentinel = parseDayParam(from);
  const toSentinel = parseDayParam(to);

  if (fromSentinel > toSentinel) {
    throw badRequestError('from must be on or before to');
  }

  if ((toSentinel - fromSentinel) / MS_PER_DAY + 1 > MAX_RANGE_DAYS) {
    throw badRequestError(`A calendar range can be at most ${MAX_RANGE_DAYS} days`);
  }

  if (allowPast) {
    return { fromDay: fromSentinel, toDay: toSentinel, horizonTo: null };
  }

  const today = todayDateOnly();
  const horizon = addDaysToDateOnly(today, privateClassScheduleService.PRIVATE_BOOKING_HORIZON_DAYS);

  return {
    fromDay: fromSentinel > today ? fromSentinel : today,
    toDay: toSentinel < horizon ? toSentinel : horizon,
    horizonTo: sentinelDayString(horizon),
  };
}

function parseFilters({ coachId, type }) {
  if (coachId !== undefined && coachId !== '' && !mongoose.isValidObjectId(coachId)) {
    throw badRequestError('coachId is not a valid id');
  }

  if (type !== undefined && type !== '' && !TYPES.includes(type)) {
    throw badRequestError(`type must be one of: ${TYPES.join(', ')}`);
  }

  return {
    coachId: coachId ? String(coachId) : null,
    includeGroup: !type || type === 'all' || type === 'group',
    includePrivate: !type || type === 'all' || type === 'private',
  };
}

// ── Event shape (C5) ──────────────────────────────────────────────────────

// Every event carries every field, so the frontend types one shape. Fields a
// given kind or audience does not use stay at these defaults.
function makeEvent(fields) {
  return {
    id: null,
    kind: null,
    day: null,
    startsAt: null,
    endsAt: null,
    title: null,
    coach: null,
    locationName: null,
    levelName: null,
    durationMinutes: null,
    scheduleId: null,
    sessionId: null,
    price: null,
    mine: false,
    // Admin, and the parent's own children, only. Always [] on /public.
    students: [],
    isHoliday: false,
    holidayName: null,
    ...fields,
  };
}

function personRef(user) {
  return { id: String(user._id), name: `${user.firstName} ${user.lastName}` };
}

function durationBetween(startsAt, endsAt) {
  return Math.round((endsAt.getTime() - startsAt.getTime()) / 60000);
}

function privateTitle(durationMinutes) {
  return `Private lesson — ${durationMinutes} min`;
}

// ── Event sources ─────────────────────────────────────────────────────────

// Group sessions whose calendar day is in range, with every reference they
// display resolved. A session whose class, level, location or coach is gone
// is skipped (the same rule groupClassSchedule.service.js's listPublic
// follows), never half-drawn.
async function loadGroupSessions(fromDay, toDay) {
  const sessions = await GroupClassSession.find({ date: { $gte: fromDay, $lte: toDay } })
    .populate({
      path: 'scheduleId',
      select: 'classId coachId',
      populate: [
        {
          path: 'classId',
          select: 'name levelId locationId',
          populate: [
            { path: 'levelId', select: 'name' },
            { path: 'locationId', select: 'name' },
          ],
        },
        { path: 'coachId', select: 'firstName lastName' },
      ],
    })
    .lean();

  return sessions.filter(
    (session) =>
      session.scheduleId &&
      session.scheduleId.classId &&
      session.scheduleId.classId.levelId &&
      session.scheduleId.classId.locationId &&
      session.scheduleId.coachId
  );
}

function groupEvent(session, holiday) {
  const schedule = session.scheduleId;

  return makeEvent({
    id: `group:${session._id}`,
    kind: 'group',
    day: sentinelDayString(session.date),
    startsAt: session.startsAt,
    endsAt: session.endsAt,
    title: schedule.classId.name,
    coach: personRef(schedule.coachId),
    locationName: schedule.classId.locationId.name,
    levelName: schedule.classId.levelId.name,
    durationMinutes: durationBetween(session.startsAt, session.endsAt),
    scheduleId: String(schedule._id),
    sessionId: String(session._id),
    isHoliday: holiday !== null,
    holidayName: holiday ? holiday.name : null,
  });
}

// Current rules whose coach still exists and has an active contract (the
// public listing's own gate — no contract, no valid price), open slots from
// the ONE openSlotsForRules (C2), priced from purchaseOptionsFor's single
// session — never recomputed.
async function loadPrivateOpen(fromDay, toDay, now) {
  const rules = await PrivateClassSchedule.find(
    privateClassScheduleService.currentRulesFilter({ startDate: { $lte: toDay } })
  ).populate('coachId', 'firstName lastName');

  const liveRules = rules.filter((rule) => rule.coachId && rule.endDate >= fromDay);
  const contractByCoachId = await privateClassScheduleService.activeContractsByCoach(
    liveRules.map((rule) => rule.coachId._id)
  );
  const offeredRules = liveRules.filter((rule) => contractByCoachId.has(String(rule.coachId._id)));
  const ruleById = new Map(offeredRules.map((rule) => [String(rule._id), rule]));

  const slots = await privateClassScheduleService.openSlotsForRules(offeredRules, fromDay, toDay, now);

  const events = slots.map((slot) => {
    const rule = ruleById.get(String(slot.scheduleId));
    const contract = contractByCoachId.get(String(rule.coachId._id));

    return makeEvent({
      id: `private-open:${rule._id}:${slot.day}`,
      kind: 'private-open',
      day: slot.day,
      startsAt: slot.startDate,
      endsAt: slot.endDate,
      title: privateTitle(rule.durationMinutes),
      coach: personRef(rule.coachId),
      durationMinutes: rule.durationMinutes,
      scheduleId: String(rule._id),
      price: purchaseOptionsFor(contract, rule.durationMinutes)[0].unitPrice,
    });
  });

  return { events, coaches: offeredRules.map((rule) => personRef(rule.coachId)) };
}

// Confirmed bookings whose start instant falls on a Central day in range
// (C3: the instant's day comes from instantDayString, never its UTC date).
async function loadPrivateBooked(fromDay, toDay, { parentId } = {}) {
  const rangeStart = combineDayAndTimeInTZ(sentinelDayString(fromDay), '00:00');
  const rangeEnd = combineDayAndTimeInTZ(sentinelDayString(addDaysToDateOnly(toDay, 1)), '00:00');

  const bookings = await PrivateClassSession.find({
    status: 'confirmed',
    startDate: { $gte: rangeStart, $lt: rangeEnd },
    ...(parentId ? { parentId } : {}),
  })
    .populate('coachId', 'firstName lastName')
    .populate('studentId', 'firstName lastName')
    .lean();

  return bookings
    .filter((booking) => booking.coachId)
    .map((booking) => {
      const durationMinutes = durationBetween(booking.startDate, booking.endDate);

      return makeEvent({
        id: `private-booked:${booking._id}`,
        kind: 'private-booked',
        day: instantDayString(booking.startDate),
        startsAt: booking.startDate,
        endsAt: booking.endDate,
        title: privateTitle(durationMinutes),
        coach: personRef(booking.coachId),
        durationMinutes,
        scheduleId: String(booking.scheduleId),
        sessionId: String(booking._id),
        students: booking.studentId ? [personRef(booking.studentId)] : [],
      });
    });
}

// One all-day event per holiday day inside the range (admin only, C7).
function holidayEvents(holidays, fromDay, toDay) {
  return holidays.flatMap((holiday) => {
    const events = [];
    const first = holiday.startDate > fromDay ? holiday.startDate : fromDay;
    const last = holiday.endDate < toDay ? holiday.endDate : toDay;

    for (let day = dateOnlyUTC(first); day <= last; day = addDaysToDateOnly(day, 1)) {
      const dayString = sentinelDayString(day);
      events.push(
        makeEvent({
          id: `holiday:${holiday._id}:${dayString}`,
          kind: 'holiday',
          day: dayString,
          title: holiday.name,
          isHoliday: true,
          holidayName: holiday.name,
        })
      );
    }

    return events;
  });
}

// The family's own group sessions (O1): a session of a schedule one of
// their ACTIVE subscriptions points at, on or after that subscription's
// period start (a calendar-day sentinel, compared sentinel-to-sentinel with
// the session's `date` — ADR 009), or a child's trial session. The period-
// start gate keeps an "enroll for next month" subscription from claiming
// this month's classes. Returns sessionId -> [student refs].
async function familyGroupStudents(parentId) {
  const [subscriptions, children] = await Promise.all([
    Subscription.find({ parentId, status: 'active' }, 'studentId scheduleId currentPeriodStart')
      .populate('studentId', 'firstName lastName')
      .lean(),
    User.find({ role: 'student', parentId }, 'firstName lastName').lean(),
  ]);

  const trials = await TrialClass.find({ studentId: { $in: children.map((child) => child._id) } }).lean();
  const childById = new Map(children.map((child) => [String(child._id), child]));

  return {
    studentsForSession(session) {
      const students = [];

      subscriptions.forEach((subscription) => {
        if (
          subscription.studentId &&
          String(subscription.scheduleId) === String(session.scheduleId._id) &&
          session.date >= subscription.currentPeriodStart
        ) {
          students.push(personRef(subscription.studentId));
        }
      });

      trials.forEach((trial) => {
        const child = childById.get(String(trial.studentId));

        if (child && String(trial.sessionId) === String(session._id)) {
          students.push(personRef(child));
        }
      });

      return students;
    },
  };
}

// ── Composition ───────────────────────────────────────────────────────────

function sortEvents(events) {
  return events.sort((a, b) => {
    if (a.day !== b.day) return a.day < b.day ? -1 : 1;
    const aStart = a.startsAt ? a.startsAt.getTime() : -Infinity;
    const bStart = b.startsAt ? b.startsAt.getTime() : -Infinity;
    if (aStart !== bStart) return aStart - bStart;
    return a.id < b.id ? -1 : 1;
  });
}

function uniqueCoaches(refs) {
  const byId = new Map();
  refs.forEach((ref) => byId.set(ref.id, ref));
  return [...byId.values()].sort((a, b) => a.name.localeCompare(b.name));
}

// audience: 'public' | 'parent' | 'admin'.
async function buildCalendar(audience, query, { parentId } = {}) {
  const isAdmin = audience === 'admin';
  const range = parseRange(query, { allowPast: isAdmin });
  const filters = parseFilters(query);
  const now = new Date();
  const { fromDay, toDay } = range;

  const response = { from: query.from, to: query.to, horizonTo: range.horizonTo, events: [], coaches: [] };

  if (toDay < fromDay) {
    return response;
  }

  const holidays = await holidayService.getHolidaysInRange(fromDay, toDay);
  const family = audience === 'parent' ? await familyGroupStudents(parentId) : null;
  const coachRefs = [];
  let events = [];

  // Group sessions. Public/parent: only sessions not yet started (the same
  // `startsAt > now` rule listUpcomingByClass uses) and never on a holiday
  // (C7). Admin: everything in range, a holiday-date session flagged.
  const groupSessions = await loadGroupSessions(fromDay, toDay);
  groupSessions.forEach((session) => coachRefs.push(personRef(session.scheduleId.coachId)));

  if (filters.includeGroup) {
    groupSessions.forEach((session) => {
      const holiday = holidayService.findHolidayForDate(session.date, holidays);

      if (!isAdmin && (holiday || !(session.startsAt > now))) {
        return;
      }

      const event = groupEvent(session, holiday);

      if (family) {
        event.students = family.studentsForSession(session);
        event.mine = event.students.length > 0;
      }

      events.push(event);
    });
  }

  // Open private slots — every audience.
  const privateOpen = await loadPrivateOpen(fromDay, toDay, now);
  coachRefs.push(...privateOpen.coaches);

  if (filters.includePrivate) {
    events.push(...privateOpen.events);
  }

  // Booked private lessons — admin: all; parent: their own, marked mine.
  // Never on /public (C5, O2: a taken slot is simply absent there).
  if (audience !== 'public') {
    const booked = await loadPrivateBooked(fromDay, toDay, isAdmin ? {} : { parentId });
    booked.forEach((event) => coachRefs.push(event.coach));

    if (filters.includePrivate) {
      events.push(...booked.map((event) => ({ ...event, mine: !isAdmin })));
    }
  }

  if (filters.coachId) {
    events = events.filter((event) => event.coach && event.coach.id === filters.coachId);
  }

  // Holidays are academy-wide: shown to admin whatever the coach/type filter.
  if (isAdmin) {
    events.push(...holidayEvents(holidays, fromDay, toDay));
  }

  response.events = sortEvents(events);
  response.coaches = uniqueCoaches(coachRefs);
  return response;
}

function listPublic(query) {
  return buildCalendar('public', query);
}

function listForParent(parentId, query) {
  return buildCalendar('parent', query, { parentId });
}

function listForAdmin(query) {
  return buildCalendar('admin', query);
}

module.exports = { MAX_RANGE_DAYS, parseRange, listPublic, listForParent, listForAdmin };
