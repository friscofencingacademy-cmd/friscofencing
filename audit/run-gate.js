// Runs one live gate (docs/live-gates/<id>.md) as its Playwright script
// (audit/gates/<id>.js) against staging, and writes the result file.
// Design: docs/plans/playwright-live-gates-plan.md.
//
//   npm run gate -- <id> [--headed] [--slow <ms>] [--allow-writes]
//
// Exit codes: 0 pass · 1 fail · 2 blocked · 3 refused (no/unknown id, a
// production URL, missing env, a mutating gate without --allow-writes).
//
// Passwords come only from audit/.env and are never printed or written. Each
// account signs in before its trace starts, because a Playwright trace records
// typed values; the video is fine (the password field shows dots).

const fs = require('fs');
const path = require('path');

require('dotenv').config({ path: path.join(__dirname, '.env') });

const { stagingProblem } = require('./lib/staging-guard');
const { centralToday, isoDay } = require('./lib/gate-dates');

const REPO_ROOT = path.join(__dirname, '..');
const GATES_DIR = path.join(__dirname, 'gates');
const SPECS_DIR = path.join(REPO_ROOT, 'docs', 'live-gates');
const RESULTS_DIR = path.join(SPECS_DIR, 'results');
const RUNS_DIR = path.join(__dirname, 'gate-runs');

const EXIT = { pass: 0, fail: 1, blocked: 2, refused: 3 };

function parseArgs(argv) {
  const args = { id: null, headed: false, slowMo: null, allowWrites: false, problem: null };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--headed') args.headed = true;
    else if (arg === '--allow-writes') args.allowWrites = true;
    else if (arg === '--slow') {
      const ms = Number(argv[i + 1]);
      if (!Number.isInteger(ms) || ms < 0) args.problem = '--slow needs a whole number of milliseconds';
      args.slowMo = ms;
      i += 1;
    } else if (arg.startsWith('--')) args.problem = `Unknown option ${arg}`;
    else if (args.id) args.problem = `Only one gate id, got "${args.id}" and "${arg}"`;
    else args.id = arg;
  }

  return args;
}

// The gate .md's frontmatter as { key: value } strings.
function readFrontmatter(markdown) {
  const match = /^---\r?\n([\s\S]*?)\r?\n---/.exec(markdown);
  const fields = {};
  if (!match) return fields;
  match[1].split(/\r?\n/).forEach((line) => {
    const kv = /^([\w-]+):\s*(.*?)\s*(#.*)?$/.exec(line);
    if (kv) fields[kv[1]] = kv[2];
  });
  return fields;
}

function listGateIds(gatesDir = GATES_DIR) {
  return fs.existsSync(gatesDir)
    ? fs.readdirSync(gatesDir).filter((file) => file.endsWith('.js')).map((file) => file.replace(/\.js$/, '')).sort()
    : [];
}

function requiredEnv(gate) {
  const keys = ['AUDIT_STAGING_URL', 'AUDIT_SUPERADMIN_EMAIL', 'AUDIT_SUPERADMIN_PASSWORD'];
  if (Object.values(gate.accounts).some((account) => account !== 'superadmin')) keys.push('AUDIT_TEST_PASSWORD');
  return keys;
}

// Everything that makes the runner refuse before opening a browser.
// Returns { problem } or { gate, spec }.
function checkRefusals({ args, env, gatesDir = GATES_DIR, specsDir = SPECS_DIR }) {
  if (args.problem) return { problem: args.problem };

  if (!args.id) {
    return { problem: `Name a gate: npm run gate -- <id>. Gates: ${listGateIds(gatesDir).join(', ') || 'none'}` };
  }

  const scriptFile = path.join(gatesDir, `${args.id}.js`);
  const specFile = path.join(specsDir, `${args.id}.md`);
  if (!/^[a-z0-9-]+$/.test(args.id) || !fs.existsSync(scriptFile) || !fs.existsSync(specFile)) {
    return { problem: `Unknown gate "${args.id}". Gates: ${listGateIds(gatesDir).join(', ') || 'none'}` };
  }

  const spec = readFrontmatter(fs.readFileSync(specFile, 'utf8'));
  if (spec.env && spec.env !== 'staging') {
    return { problem: `Gate "${args.id}" targets env "${spec.env}"; this runner only runs staging gates.` };
  }

  const staging = stagingProblem(env.AUDIT_STAGING_URL || '');
  if (staging) return { problem: staging };

  // eslint-disable-next-line global-require, import/no-dynamic-require -- the gate is chosen at run time.
  const gate = require(scriptFile);
  const missing = requiredEnv(gate).filter((key) => !env[key]);
  if (missing.length > 0) return { problem: `Missing required env vars: ${missing.join(', ')}. Set them in audit/.env.` };

  if (spec.mutates === 'true' && !args.allowWrites) {
    return { problem: `Gate "${args.id}" saves or charges (mutates: true). Re-run with --allow-writes once you accept that.` };
  }

  return { gate, spec };
}

function freeDir(base) {
  let dir = base;
  for (let suffix = 2; fs.existsSync(dir); suffix += 1) dir = `${base}-${suffix}`;
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

function credentialsFor(account, env) {
  return account === 'superadmin'
    ? { email: env.AUDIT_SUPERADMIN_EMAIL, password: env.AUDIT_SUPERADMIN_PASSWORD }
    : { email: account, password: env.AUDIT_TEST_PASSWORD };
}

function relative(file) {
  return path.relative(REPO_ROOT, file).split(path.sep).join('/');
}

async function runGate({ args, gate, env, log = console.log }) {
  // Loaded here, not at the top, so the offline tests never need a browser.
  // eslint-disable-next-line global-require
  const { chromium } = require('playwright');
  // eslint-disable-next-line global-require
  const { login } = require('./lib/login');
  // eslint-disable-next-line global-require
  const { installWriteGuard } = require('./lib/write-guard');
  // eslint-disable-next-line global-require
  const { createGateApi } = require('./lib/gate-api');
  // eslint-disable-next-line global-require
  const { runSteps } = require('./lib/gate-runner');
  // eslint-disable-next-line global-require
  const { lookUpCommit, writeResult } = require('./lib/gate-result');

  const stagingUrl = env.AUDIT_STAGING_URL.replace(/\/$/, '');
  const date = isoDay(centralToday());
  const runDir = freeDir(path.join(RUNS_DIR, `${date}-${gate.id}`));
  const slowMo = args.slowMo != null ? args.slowMo : args.headed ? 700 : 0;
  const secrets = [env.AUDIT_SUPERADMIN_PASSWORD, env.AUDIT_TEST_PASSWORD];

  log(`Live gate ${gate.id} against ${stagingUrl}${args.headed ? ' (headed)' : ''}`);

  const browser = await chromium.launch({ headless: !args.headed, slowMo });
  const rows = [];
  const notes = [];
  const recordings = [];
  const sessions = [];
  let result = 'pass';
  let commit = 'unknown';
  let apiContext = null;

  try {
    // A superadmin API reader (g.api) for preconditions and read-only
    // re-checks — its own context, no video, no trace.
    apiContext = await browser.newContext();
    await installWriteGuard(apiContext);
    const apiPage = await apiContext.newPage();
    const admin = credentialsFor('superadmin', env);
    await login(apiPage, stagingUrl, admin.email, admin.password);

    commit = lookUpCommit();
    const g = { url: stagingUrl, api: createGateApi(apiContext.request, stagingUrl), commit, facts: {}, skip: {}, notes, pages: {} };

    log('Preconditions');
    let preRows;
    try {
      preRows = await gate.preconditions(g);
    } catch (error) {
      preRows = [{ n: 'P', expect: 'Preconditions can be read', seen: error.message, result: 'blocked' }];
    }
    preRows.forEach((row) => log(`  ${row.n} ${row.expect} — Seen: "${row.seen}" — ${row.result}`));
    rows.push(...preRows);

    if (preRows.some((row) => row.result === 'blocked')) {
      result = 'blocked';
    } else {
      for (const [name, account] of Object.entries(gate.accounts)) {
        // eslint-disable-next-line no-await-in-loop -- one account at a time.
        const context = await browser.newContext({
          viewport: { width: 1280, height: 800 },
          recordVideo: { dir: runDir, size: { width: 1280, height: 800 } },
        });
        // eslint-disable-next-line no-await-in-loop
        const guard = await installWriteGuard(context, { allowWrites: args.allowWrites });
        // eslint-disable-next-line no-await-in-loop
        const page = await context.newPage();
        page.setDefaultTimeout(15000);
        sessions.push({ name, context, page, guard });

        const { email, password } = credentialsFor(account, env);
        try {
          // eslint-disable-next-line no-await-in-loop
          await login(page, stagingUrl, email, password);
        } catch (error) {
          rows.push({ n: 'P', expect: `Sign in as ${email}`, seen: `Sign-in failed: ${error.message.split('\n')[0]}`, result: 'blocked' });
          result = 'blocked';
          break;
        }
        // Tracing starts only after the password was typed (D4).
        // eslint-disable-next-line no-await-in-loop
        await context.tracing.start({ screenshots: true, snapshots: true });
        g.pages[name] = page;
      }

      if (result !== 'blocked') {
        const stepRows = await runSteps(gate.steps, g, {
          log,
          takeBlocked: () => sessions.flatMap((session) => session.guard.takeBlocked()),
        });
        rows.push(...stepRows);
        const failed = stepRows.some((row) => row.result === 'fail');
        result = failed ? 'fail' : 'pass';

        if (failed) {
          for (const session of sessions) {
            const shot = path.join(runDir, `failure-${session.name}.png`);
            // eslint-disable-next-line no-await-in-loop
            await session.page.screenshot({ path: shot, fullPage: true }).catch(() => {});
            notes.push(`Failure screenshot: ${relative(shot)}`);
          }
        }
      }
    }
  } catch (error) {
    rows.push({ n: '!', expect: 'The run completes', seen: error.message.split('\n')[0], result: 'fail' });
    result = 'fail';
  } finally {
    for (const session of sessions) {
      const trace = path.join(runDir, `trace-${session.name}.zip`);
      // eslint-disable-next-line no-await-in-loop
      await session.context.tracing.stop({ path: trace }).catch(() => {});
      // eslint-disable-next-line no-await-in-loop
      await session.context.close();
      const video = session.page.video();
      if (video) {
        const target = path.join(runDir, `${gate.id}-${session.name}.webm`);
        // eslint-disable-next-line no-await-in-loop
        await video.saveAs(target);
        // eslint-disable-next-line no-await-in-loop
        await video.delete();
        recordings.push(relative(target));
      }
    }
    // The API reader stays open for steps that re-check data (register-quote step 8).
    if (apiContext) await apiContext.close();
    await browser.close();
  }

  const file = writeResult(RESULTS_DIR, {
    gate: gate.id,
    result,
    env: 'staging',
    url: stagingUrl,
    commit,
    date,
    runBy: `Playwright (npm run gate)${args.headed ? ', watched by the owner' : ''}`,
    recording: recordings.join(', ') || 'none',
    rows,
    notes,
    secrets,
  });

  log('');
  log(`Result: ${result}`);
  log(`Result file: ${relative(file)}`);
  log(`Run folder: ${relative(runDir)}`);
  return result;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const checked = checkRefusals({ args, env: process.env });

  if (checked.problem) {
    console.error(checked.problem);
    process.exitCode = EXIT.refused;
    return;
  }

  const result = await runGate({ args, gate: checked.gate, env: process.env });
  process.exitCode = EXIT[result];
}

if (require.main === module) {
  main().catch((error) => {
    console.error(error);
    process.exitCode = EXIT.fail;
  });
}

module.exports = { EXIT, checkRefusals, parseArgs, readFrontmatter };
