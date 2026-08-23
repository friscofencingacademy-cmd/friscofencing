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
function assertStaging() {
  const staging = process.env.AUDIT_STAGING_URL || '';

  // Production is the bare "friscofencing.vercel.app" host per
  // docs/plans/deployment-launch-plan.md's Production URLs — anything else
  // containing "friscofencing" (the git-branch preview alias) is staging.
  const looksLikeStaging = staging.includes('friscofencing') && !staging.includes('friscofencing.vercel.app');

  if (!staging) {
    console.error('AUDIT_STAGING_URL must be set. Refusing to run.');
    process.exit(1);
  }

  if (!looksLikeStaging) {
    console.error(
      `AUDIT_STAGING_URL doesn't look like the staging preview alias (got "${staging}"). Refusing to run against what looks like production.`
    );
    process.exit(1);
  }
}

module.exports = { assertStaging };
