const {
  resolveProgram,
  isTestRecord,
  isAdultRow,
  splitGuardianName,
  groupIntoFamilies,
} = require('../../../scripts/lib/familyGrouping');

const CONFIG = {
  LEVELS: {
    beginnerUnder10: { name: 'Beginners (Below 10 Yrs)', aliases: ['beginner under 10'] },
    intermediate: { name: 'Intermediate', aliases: ['intermediate'] },
    advanced: { name: 'Advanced', aliases: ['advanced'] },
    fencingFoundation: { name: 'Fencing Foundation', aliases: ['fencing foundation', 'toddler program'] },
  },
  COACHES: {
    chris: { firstName: 'Chris' },
    abel: { firstName: 'Abel' },
  },
  TEST_RECORD_FILTERS: {
    emailDomains: ['kicksite.net'],
    firstNamePrefixes: ['test'],
  },
};

// Builds a row shaped like a real CSV record, defaulting every field this
// module reads to '' so each test only has to specify what it cares about.
function row(overrides = {}) {
  return {
    PIN: '1000',
    'First Name': 'Child',
    'Last Name': 'Example',
    'Family Name': '',
    'Phone Number': '',
    Age: '0',
    Birthdate: '',
    Programs: '',
    'Email Address(es)': '',
    'Guardian(s)': '',
    ...overrides,
  };
}

describe('scripts/lib/familyGrouping', () => {
  describe('resolveProgram', () => {
    it('returns nulls for a blank Programs value', () => {
      expect(resolveProgram('', CONFIG)).toEqual({ levelKey: null, hasPrivateClass: false, privateCoachKey: null });
    });

    it('matches a plain level alias', () => {
      expect(resolveProgram('Beginner Under 10', CONFIG).levelKey).toBe('beginnerUnder10');
    });

    it('matches an alias after stripping a parenthetical suffix', () => {
      expect(resolveProgram('Intermediate (Age 13 -18)', CONFIG).levelKey).toBe('intermediate');
      expect(resolveProgram('Advanced (Competitive)', CONFIG).levelKey).toBe('advanced');
    });

    it('aliases "Toddler Program" onto Fencing Foundation', () => {
      expect(resolveProgram('Toddler Program', CONFIG).levelKey).toBe('fencingFoundation');
    });

    it('parses a combined private-class + group-level value, including the source export\'s "Pricate" typo', () => {
      const result = resolveProgram('Pricate Classes - Coach Chris, Advanced (Competitive)', CONFIG);

      expect(result).toEqual({ levelKey: 'advanced', hasPrivateClass: true, privateCoachKey: 'chris' });
    });

    it('flags private class with no group-level portion', () => {
      const result = resolveProgram('Private Classes - Coach Abel', CONFIG);

      expect(result).toEqual({ levelKey: null, hasPrivateClass: true, privateCoachKey: 'abel' });
    });

    it('returns a null levelKey for an unrecognized value instead of throwing', () => {
      expect(resolveProgram('Some Future Program', CONFIG).levelKey).toBeNull();
    });
  });

  describe('isTestRecord', () => {
    it('flags a kicksite.net email', () => {
      expect(isTestRecord(row({ 'Email Address(es)': 'swanson@kicksite.net' }), CONFIG)).toBe(true);
    });

    it('flags a first name starting with "test", case-insensitively', () => {
      expect(isTestRecord(row({ 'First Name': 'testDiya' }), CONFIG)).toBe(true);
      expect(isTestRecord(row({ 'First Name': 'Test' }), CONFIG)).toBe(true);
    });

    it('does not flag a real record', () => {
      expect(isTestRecord(row({ 'First Name': 'Ardiv', 'Email Address(es)': 'a@gmail.com' }), CONFIG)).toBe(false);
    });
  });

  describe('isAdultRow', () => {
    it('is true for a real birthdate with age >= 18', () => {
      expect(isAdultRow(row({ Birthdate: '1987-05-15', Age: '39' }))).toBe(true);
    });

    it('is false when age >= 18 but birthdate is blank (unknown-age default stays a minor)', () => {
      expect(isAdultRow(row({ Birthdate: '', Age: '0' }))).toBe(false);
    });

    it('is false for a real birthdate under 18', () => {
      expect(isAdultRow(row({ Birthdate: '2016-05-21', Age: '10' }))).toBe(false);
    });
  });

  describe('splitGuardianName', () => {
    it('splits a two-token name into first/last', () => {
      expect(splitGuardianName('Liz Edelbrock')).toEqual({ firstName: 'Liz', lastName: 'Edelbrock' });
    });

    it('splits a multi-token name at the last token', () => {
      expect(splitGuardianName('Jasmine Di Duca')).toEqual({ firstName: 'Jasmine Di', lastName: 'Duca' });
    });

    it('falls back to a non-empty lastName for a single-token name', () => {
      expect(splitGuardianName('Cher')).toEqual({ firstName: 'Cher', lastName: 'Guardian' });
    });
  });

  describe('groupIntoFamilies', () => {
    it('filters out test records entirely — they appear in no family', () => {
      const rows = [row({ PIN: '1', 'First Name': 'Test', Programs: '' })];

      expect(groupIntoFamilies(rows, CONFIG)).toEqual([]);
    });

    it('mirrors a solo adult into a parent + student pair with distinct legacyPins, email on the parent only', () => {
      const rows = [
        row({
          PIN: '1110',
          'First Name': 'Kay',
          'Last Name': 'L',
          Age: '56',
          Birthdate: '1970-01-01',
          'Email Address(es)': 'kay@example.com',
        }),
      ];

      const [family] = groupIntoFamilies(rows, CONFIG);

      expect(family.parent).toEqual({ legacyPin: '1110-parent', firstName: 'Kay', lastName: 'L', email: 'kay@example.com' });
      expect(family.students).toHaveLength(1);
      expect(family.students[0].legacyPin).toBe('1110');
    });

    it('makes the real adult in a mixed adult+minor phone group the parent, using their own name/email', () => {
      const rows = [
        row({ PIN: '1161', 'First Name': 'Luna', 'Last Name': 'Rodriguez', 'Phone Number': '+1555', Age: '10', Birthdate: '2016-01-25' }),
        row({
          PIN: '1162',
          'First Name': 'Valerie',
          'Last Name': 'Rodriguez',
          'Phone Number': '+1555',
          Age: '49',
          Birthdate: '1976-12-02',
          'Email Address(es)': 'valerie@example.com',
        }),
      ];

      const [family] = groupIntoFamilies(rows, CONFIG);

      expect(family.parent).toEqual({
        legacyPin: '1162',
        firstName: 'Valerie',
        lastName: 'Rodriguez',
        email: 'valerie@example.com',
      });
      expect(family.students).toHaveLength(1);
      expect(family.students[0].legacyPin).toBe('1161');
    });

    it('synthesizes one parent for an all-minors sibling group sharing a phone, no legacyPin, using the shared last name', () => {
      const rows = [
        row({ PIN: '1031', 'First Name': 'Janaki', 'Last Name': 'Chilumuru', 'Phone Number': '+1999' }),
        row({ PIN: '1032', 'First Name': 'Saathvika', 'Last Name': 'Chilumuru', 'Phone Number': '+1999' }),
      ];

      const [family] = groupIntoFamilies(rows, CONFIG);

      expect(family.parent).toEqual({ legacyPin: null, firstName: 'Parent', lastName: 'Chilumuru', email: null });
      expect(family.students.map((s) => s.legacyPin).sort()).toEqual(['1031', '1032']);
    });

    it('prefers an explicit Guardian(s) name over the synthesized fallback', () => {
      const rows = [row({ PIN: '1049', 'First Name': 'Beckett', 'Last Name': 'Edelbrock', 'Guardian(s)': 'Liz Edelbrock' })];

      const [family] = groupIntoFamilies(rows, CONFIG);

      expect(family.parent).toEqual({ legacyPin: null, firstName: 'Liz', lastName: 'Edelbrock', email: null });
    });

    it('falls back to the Family Name field when siblings have different (non-blank) last names and no guardian is given', () => {
      const rows = [
        row({ PIN: '2001', 'First Name': 'Ann', 'Last Name': 'Smith', 'Family Name': 'Smith Jones Family' }),
        row({ PIN: '2002', 'First Name': 'Ben', 'Last Name': 'Jones', 'Family Name': 'Smith Jones Family' }),
      ];
      // Give them a shared grouping signal (same email) since they don't
      // share a phone in this fixture.
      rows.forEach((r) => {
        r['Email Address(es)'] = 'family@example.com';
      });

      const [family] = groupIntoFamilies(rows, CONFIG);

      expect(family.parent.lastName).toBe('Smith Jones');
    });

    it('uses the one sibling\'s shared last name even when the other sibling row has a blank last name', () => {
      // Matches the real 2026-08-23 export's Deeksha/Daksh Panuganti row
      // pair (PIN 3996 has a blank Last Name) — the blank is filtered out of
      // the "do all siblings share a last name" check rather than counting
      // as a distinct value, so this still takes the shared-name branch
      // instead of falling through to Family Name.
      const rows = [
        row({ PIN: '3996', 'First Name': 'Deeksha', 'Last Name': '', 'Family Name': 'Swetha Panuganti Family' }),
        row({ PIN: '1142', 'First Name': 'Daksh', 'Last Name': 'Panuganti', 'Family Name': 'Swetha Panuganti Family' }),
      ];
      rows.forEach((r) => {
        r['Email Address(es)'] = 'swetha@example.com';
      });

      const [family] = groupIntoFamilies(rows, CONFIG);

      expect(family.parent.lastName).toBe('Panuganti');
    });

    it('resolves each student\'s level/private-class flags via resolveProgram', () => {
      const rows = [row({ PIN: '6221', Programs: 'Pricate Classes - Coach Chris, Advanced (Competitive)' })];

      const [family] = groupIntoFamilies(rows, CONFIG);

      expect(family.students[0]).toMatchObject({ levelKey: 'advanced', hasPrivateClass: true, privateCoachKey: 'chris' });
    });

    it('gives a lone minor with no siblings and no guardian a "Parent <LastName>" synthesized parent', () => {
      const rows = [row({ PIN: '1006', 'First Name': 'Ardiv', 'Last Name': 'Ancha' })];

      const [family] = groupIntoFamilies(rows, CONFIG);

      expect(family.parent).toEqual({ legacyPin: null, firstName: 'Parent', lastName: 'Ancha', email: null });
    });
  });
});
