const CoachContract = require('../../src/models/coachContract.model');
const PrivateClassSchedule = require('../../src/models/privateClassSchedule.model');

// Most fencing private lessons are 30 minutes (owner decision 2026-09-25).
// Both models take their default from one constant, so they cannot drift.
describe('private-lesson length defaults', () => {
  it('is 30 minutes, defined once', () => {
    expect(CoachContract.DEFAULT_LESSON_MINUTES).toBe(30);
  });

  it('applies to a contract with no lesson length set', () => {
    expect(new CoachContract({}).sessionDurationMinutes).toBe(30);
  });

  it('applies to an availability rule with no length set', () => {
    expect(new PrivateClassSchedule({}).durationMinutes).toBe(30);
  });
});
