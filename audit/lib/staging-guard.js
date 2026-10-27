// Imported first by every entry point in this package (docs/plans/audit-
// system-plan.md, D8). Hard-fails rather than just documenting the rule —
// a typo'd env var pointing this at production must never silently run.
//
// Only AUDIT_STAGING_URL (the frontend) is used anywhere in this package —
// there is deliberately no separate backend-URL config. The reporting step
// POSTs through the frontend's own `/api/v1/*` proxy (frontend/next.config.js's
// rewrite), the same path every real browser request already takes, so the
// httpOnly accessToken cookie set at login (scoped to the frontend's own
// origin, per CLAUDE.md's cookie-first-party design) is actually sent. A
// raw backend-origin URL would be a different domain and wouldn't carry
// that cookie at all.

// The reason `staging` must not be used, or null when it is the staging
// alias. Pure, so the live-gate runner can refuse with its own exit code
// (docs/plans/playwright-live-gates-plan.md D6) instead of exiting here.
function stagingProblem(staging) {
  if (!staging) {
    return 'AUDIT_STAGING_URL must be set. Refusing to run.';
  }

  // Production is the bare "friscofencing.vercel.app" host per
  // docs/plans/deployment-launch-plan.md's Production URLs — anything else
  // containing "friscofencing" (the git-branch preview alias) is staging.
  const looksLikeStaging = staging.includes('friscofencing') && !staging.includes('friscofencing.vercel.app');

  if (!looksLikeStaging) {
    return `AUDIT_STAGING_URL doesn't look like the staging preview alias (got "${staging}"). Refusing to run against what looks like production.`;
  }

  return null;
}

function assertStaging() {
  const problem = stagingProblem(process.env.AUDIT_STAGING_URL || '');

  if (problem) {
    console.error(problem);
    process.exit(1);
  }
}

module.exports = { assertStaging, stagingProblem };
