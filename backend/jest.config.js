/** @type {import('jest').Config} */
module.exports = {
  testEnvironment: 'node',
  testMatch: ['<rootDir>/tests/**/*.test.js'],
  // Every source file counts toward coverage, including ones no test loads —
  // otherwise an untested file is invisible rather than 0%
  // (docs/plans/testing-strategy-refresh-plan.md PR A).
  collectCoverageFrom: ['<rootDir>/src/**/*.js', '<rootDir>/scripts/lib/**/*.js'],
  coverageReporters: ['text-summary', 'text', 'lcov'],
  // A floor, not a target (docs/TESTING_STRATEGY.md "Coverage Expectations").
  // Applies only when --coverage runs (npm run test:coverage, the CI coverage job).
  coverageThreshold: { global: { statements: 80 } },
};
