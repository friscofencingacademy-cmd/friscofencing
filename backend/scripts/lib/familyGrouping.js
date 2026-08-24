// Pure logic for turning legacy Kicksite "people" CSV rows into an import
// plan (parents + the students under them, each resolved to a level and/or
// a private-class flag). No DB access here — scripts/lib/runLegacyImport.js
// is what actually writes documents, using the plan this module builds.
// Kept separate and dependency-free specifically so it can be unit tested
// without mongodb-memory-server (see tests/scripts/lib/familyGrouping.test.js).

function normalizeProgramText(value) {
  return value
    .replace(/\([^)]*\)/g, '') // strip "(Age 13 -18)", "(Competitive)", etc.
    .trim()
    .replace(/\s+/g, ' ')
    .toLowerCase();
}

function findLevelKeyByAlias(normalizedText, levels) {
  const entry = Object.entries(levels).find(([, level]) =>
    level.aliases.some((alias) => alias.toLowerCase() === normalizedText)
  );

  return entry ? entry[0] : null;
}

// A legacy Programs value is one of: blank, a plain level name/alias, or
// (one known case in the 2026-08-23 export) "Private[/Pricate] Classes -
// Coach <Name>, <level name>" — both a private-class flag AND a group-level
// enrollment in the same cell. `pri[cv]ate` catches the source export's own
// "Pricate" typo without assuming every future export repeats it.
function resolveProgram(programsValue, config) {
  const value = (programsValue || '').trim();

  if (!value) {
    return { levelKey: null, hasPrivateClass: false, privateCoachKey: null };
  }

  const isPrivate = /pri[cv]ate/i.test(value);

  if (!isPrivate) {
    return {
      levelKey: findLevelKeyByAlias(normalizeProgramText(value), config.LEVELS),
      hasPrivateClass: false,
      privateCoachKey: null,
    };
  }

  const coachMatch = value.match(/coach\s+(\w+)/i);
  const coachFirstName = coachMatch ? coachMatch[1].toLowerCase() : null;
  const privateCoachKey = coachFirstName
    ? Object.entries(config.COACHES).find(
        ([, coach]) => coach.firstName.toLowerCase() === coachFirstName
      )?.[0] || null
    : null;

  // Everything after the first comma is the group-level portion, if any
  // ("...Coach Chris, Advanced (Competitive)" -> "Advanced (Competitive)").
  const commaIndex = value.indexOf(',');
  const remainder = commaIndex === -1 ? '' : value.slice(commaIndex + 1);
  const levelKey = remainder ? findLevelKeyByAlias(normalizeProgramText(remainder), config.LEVELS) : null;

  return { levelKey, hasPrivateClass: true, privateCoachKey };
}

function isTestRecord(row, config) {
  const email = (row['Email Address(es)'] || '').trim().toLowerCase();
  const emailDomain = email.includes('@') ? email.split('@')[1] : '';

  if (emailDomain && config.TEST_RECORD_FILTERS.emailDomains.includes(emailDomain)) {
    return true;
  }

  const firstName = (row['First Name'] || '').trim().toLowerCase();

  return config.TEST_RECORD_FILTERS.firstNamePrefixes.some((prefix) => firstName.startsWith(prefix));
}

// A row counts as an adult only on a REAL birthdate showing age >= 18 — a
// blank/unknown birthdate (11 rows in the 2026-08-23 export, `Age` defaults
// to "0") must never be treated as an adult by default; it stays a minor
// needing a synthesized parent, the safer default.
function isAdultRow(row) {
  const birthdate = (row.Birthdate || '').trim();
  const age = Number(row.Age);

  return birthdate !== '' && Number.isFinite(age) && age >= 18;
}

// "Jasmine Di Duca" -> { firstName: "Jasmine Di", lastName: "Duca" }. A
// single-token guardian name (not seen in the source export, but not
// impossible) gets a non-empty lastName fallback — User.lastName is
// schema-required and Mongoose's required validator rejects ''.
function splitGuardianName(text) {
  const trimmed = text.trim();
  const parts = trimmed.split(/\s+/);

  if (parts.length === 1) {
    return { firstName: parts[0], lastName: 'Guardian' };
  }

  return { firstName: parts.slice(0, -1).join(' '), lastName: parts[parts.length - 1] };
}

function familyGroupKey(row) {
  const phone = (row['Phone Number'] || '').trim();
  if (phone) return `phone:${phone}`;

  const email = (row['Email Address(es)'] || '').trim().toLowerCase();
  if (email) return `email:${email}`;

  return `pin:${row.PIN}`;
}

function buildSyntheticParentName(groupRows) {
  const guardianRow = groupRows.find((row) => (row['Guardian(s)'] || '').trim());

  if (guardianRow) {
    return splitGuardianName(guardianRow['Guardian(s)']);
  }

  const lastNames = new Set(groupRows.map((row) => (row['Last Name'] || '').trim()).filter(Boolean));

  if (lastNames.size === 1) {
    return { firstName: 'Parent', lastName: [...lastNames][0] };
  }

  const familyName = (groupRows[0]['Family Name'] || '').trim();
  if (familyName) {
    return { firstName: 'Parent', lastName: familyName.replace(/\s+Family$/i, '') };
  }

  return { firstName: 'Parent', lastName: (groupRows[0]['Last Name'] || '').trim() || 'Family' };
}

function toStudentPlan(row, config) {
  const program = resolveProgram(row.Programs, config);

  return {
    legacyPin: row.PIN,
    firstName: (row['First Name'] || '').trim(),
    lastName: (row['Last Name'] || '').trim() || 'Unknown',
    levelKey: program.levelKey,
    hasPrivateClass: program.hasPrivateClass,
    privateCoachKey: program.privateCoachKey,
    // Kept for the "level didn't resolve" case: distinguishes "no Programs
    // value at all" (studentsWithNoProgram) from "had a value we couldn't
    // map" (studentsWithUnmappedProgram, a real warning) in
    // runLegacyImport.js's summary.
    programsRaw: (row.Programs || '').trim(),
  };
}

// Builds the full import plan: one entry per family, each `{ parent,
// students }`. `parent.legacyPin` is only ever set when the parent record
// maps onto a single real CSV row (an adult self-registering, or the real
// adult identified in a mixed adult+minor phone group) — a synthesized
// parent for an all-minors group gets no legacyPin at all (never `null`;
// User.legacyPin is a sparse unique index, so an explicit `null` on two
// synthesized parents would collide — omitting the key entirely is what
// sparse actually requires).
function groupIntoFamilies(rows, config) {
  const realRows = rows.filter((row) => !isTestRecord(row, config));

  const groups = new Map();
  realRows.forEach((row) => {
    const key = familyGroupKey(row);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(row);
  });

  const families = [];

  groups.forEach((groupRows) => {
    const adults = groupRows.filter(isAdultRow);
    let parent;
    let studentRows;

    if (groupRows.length === 1 && adults.length === 1) {
      // Solo adult, self-pay: one human, two User docs (parent + student)
      // sharing a name. Distinct legacyPins (a `-parent` suffix on the
      // parent side) so the unique index never collides across the pair.
      const [row] = groupRows;
      parent = {
        legacyPin: `${row.PIN}-parent`,
        firstName: (row['First Name'] || '').trim(),
        lastName: (row['Last Name'] || '').trim() || 'Unknown',
        email: (row['Email Address(es)'] || '').trim() || null,
      };
      studentRows = groupRows;
    } else if (adults.length > 0) {
      const [parentRow] = adults;
      parent = {
        legacyPin: parentRow.PIN,
        firstName: (parentRow['First Name'] || '').trim(),
        lastName: (parentRow['Last Name'] || '').trim() || 'Unknown',
        email: (parentRow['Email Address(es)'] || '').trim() || null,
      };
      studentRows = groupRows.filter((row) => row !== parentRow);
    } else {
      const { firstName, lastName } = buildSyntheticParentName(groupRows);
      const email = groupRows.map((row) => (row['Email Address(es)'] || '').trim()).find(Boolean) || null;
      parent = { legacyPin: null, firstName, lastName, email };
      studentRows = groupRows;
    }

    families.push({
      parent,
      students: studentRows.map((row) => toStudentPlan(row, config)),
    });
  });

  return families;
}

module.exports = {
  resolveProgram,
  isTestRecord,
  isAdultRow,
  splitGuardianName,
  familyGroupKey,
  groupIntoFamilies,
};
