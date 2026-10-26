// Read-only data health report for one environment
// (docs/plans/audit-and-health-refresh-plan.md PR 3) — the data half of the
// `/health` skill. All checks live in scripts/lib/healthCheck.js; this file
// picks the database, never prints its URI, and sets the exit code.
//
// Usage (from backend/):
//   npm run health -- --env staging      AUDIT_MONGO_URI from backend/.env (must be the staging
//                                        cluster); also expects the live-audit fixtures and a
//                                        recent audit run
//   npm run health -- --env production   MONGO_URI from backend/.env.production.local
//   --provider=<name>                    the payment provider the environment runs
//                                        (default: PAYMENT_PROVIDER, else "stripe")
//
// Exit 0 when nothing failed (warnings allowed), 1 when any check failed or
// the database could not be reached.

const fs = require('fs');
const path = require('path');
const dotenv = require('dotenv');
const mongoose = require('mongoose');

const { collectHealth } = require('./lib/healthCheck');

const BACKEND_ROOT = path.join(__dirname, '..');
const ICONS = { ok: '✅', warn: '⚠️ ', fail: '❌' };

function readEnvFile(fileName) {
  const file = path.join(BACKEND_ROOT, fileName);
  return fs.existsSync(file) ? dotenv.parse(fs.readFileSync(file)) : {};
}

function argValue(name) {
  const prefix = `--${name}=`;
  const inline = process.argv.find((arg) => arg.startsWith(prefix));
  if (inline) return inline.slice(prefix.length);
  const index = process.argv.indexOf(`--${name}`);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

function resolveTarget(env) {
  if (env === 'staging') {
    const uri = readEnvFile('.env').AUDIT_MONGO_URI || process.env.AUDIT_MONGO_URI;
    if (!uri || !uri.includes('friscofencing-staging')) {
      return { error: 'AUDIT_MONGO_URI (backend/.env) is missing or is not the staging cluster ("friscofencing-staging").' };
    }
    return { uri, expectAuditFixtures: true };
  }

  if (env === 'production') {
    const uri = readEnvFile('.env.production.local').MONGO_URI;
    if (!uri) {
      return { error: 'MONGO_URI is missing from backend/.env.production.local.' };
    }
    if (uri.includes('friscofencing-staging')) {
      return { error: 'backend/.env.production.local points at the staging cluster.' };
    }
    return { uri, expectAuditFixtures: false };
  }

  return { error: 'Pass --env staging or --env production.' };
}

async function main() {
  const env = argValue('env');
  const target = resolveTarget(env);

  if (target.error) {
    console.error(target.error);
    process.exit(1);
  }

  const activeProvider = argValue('provider') || readEnvFile('.env').PAYMENT_PROVIDER || process.env.PAYMENT_PROVIDER || 'stripe';

  try {
    await mongoose.connect(target.uri);
  } catch (error) {
    console.error(`Could not connect to the ${env} database: ${error.message}`);
    process.exit(1);
  }

  try {
    const { checks, summary } = await collectHealth({
      activeProvider,
      expectAuditFixtures: target.expectAuditFixtures,
    });

    console.log(`Data health — ${env} (database "${mongoose.connection.name}", provider "${activeProvider}")`);
    checks.forEach((c) => {
      console.log(`  ${ICONS[c.status]} ${c.label}: ${c.detail}`);
    });
    console.log(`  ${summary.ok} ok, ${summary.warn} warning(s), ${summary.fail} failure(s)`);
    process.exitCode = summary.fail > 0 ? 1 : 0;
  } catch (error) {
    console.error('Health check failed:', error.message);
    process.exitCode = 1;
  } finally {
    await mongoose.disconnect();
  }
}

main();
