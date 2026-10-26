#!/usr/bin/env node
/**
 * check-route-existence.mjs
 *
 * Fails the build when the frontend calls an API route the backend does not
 * register ("phantom route"). Ported from CKQ's scripts/check-route-existence.mjs
 * (that bug shape shipped there silently for two months), adapted to this repo
 * (docs/plans/testing-strategy-refresh-plan.md PR A, T3):
 *
 *   - Backend routes: LIVE introspection of the real Express app in a child
 *     process (scripts/route-introspect.cjs) — never a regex over route files.
 *   - Frontend calls: every `api.<method>(...)` call site under frontend/app
 *     and frontend/lib (lib/api.ts's axios instance, baseURL /api/v1).
 *   - E2E mocks: every MockRule under frontend/e2e (the default registry in
 *     fixtures/mock-api.ts and every spec's own overrides) — a
 *     mock for a route that does not exist is the same drift, one layer down.
 *
 * Exit codes:
 *   0 — clean
 *   1 — phantom routes found
 *   2 — extraction failure (child crashed, unparseable call site, too few
 *       routes found) — this must NEVER look like a pass
 *
 * Usage:
 *   node scripts/check-route-existence.mjs --frontend frontend --backend backend
 *   node scripts/check-route-existence.mjs --self-test
 *
 * Zero npm dependencies — Node built-ins only.
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const START_MARKER = '@@ROUTE_JSON_START@@';
const END_MARKER = '@@ROUTE_JSON_END@@';
const API_PREFIX = '/api/v1';
// The app registers ~150 routes; fewer than this means introspection broke.
const MIN_BACKEND_ROUTES = 50;

// Frontend files whose API URL is built outside an api.<method>() call — each
// entry verified by hand against a real backend route. Keep narrow.
const ALLOWLIST = [];

function fail(message) {
  console.error(`🚫 EXTRACTION FAILURE — treat as a blocked ship, never a pass.\n${message}`);
  process.exit(2);
}

function parseArgs(argv) {
  const args = { frontend: null, backend: null, selfTest: false };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--frontend') args.frontend = argv[++i];
    else if (argv[i] === '--backend') args.backend = argv[++i];
    else if (argv[i] === '--self-test') args.selfTest = true;
  }
  return args;
}

// ── Matching (shared by the real run and --self-test) ─────────────────────

function toSegments(rawPath) {
  return rawPath.replace(/\/+/g, '/').replace(/^\//, '').replace(/\/$/, '').split('/').filter(Boolean);
}

function makeCall(method, rawPath, loc) {
  const wilds = new Set();
  const segs = toSegments(rawPath).map((seg, i) => {
    if (seg.includes('${') || seg.startsWith(':')) {
      wilds.add(i);
      return '*';
    }
    return seg;
  });
  return { method, raw: rawPath, segs, wilds, loc };
}

function makeRoute(method, fullPath) {
  return { method, segs: toSegments(fullPath) };
}

function routeMatches(call, route) {
  if (route.method !== call.method && route.method !== 'all') return false;
  if (route.segs.length !== call.segs.length) return false;
  return route.segs.every((seg, i) => seg.startsWith(':') || call.wilds.has(i) || call.segs[i] === seg);
}

function findPhantoms(calls, routes) {
  return calls.filter((call) => !routes.some((route) => routeMatches(call, route)));
}

function selfTest() {
  const fixtures = [
    ['literal exact match', makeCall('get', '/levels', 'f'), makeRoute('get', '/levels'), true],
    [':param vs literal', makeCall('get', '/levels/123', 'f'), makeRoute('get', '/levels/:id'), true],
    ['frontend ${} wildcard vs backend literal', makeCall('get', '/levels/${id}', 'f'), makeRoute('get', '/levels/public'), true],
    ['e2e :param wildcard vs backend :param', makeCall('put', '/levels/:id', 'f'), makeRoute('put', '/levels/:id'), true],
    ['method mismatch', makeCall('post', '/levels', 'f'), makeRoute('get', '/levels'), false],
    ['segment-count mismatch', makeCall('get', '/levels', 'f'), makeRoute('get', '/levels/:id'), false],
    ["backend 'all' matches any method", makeCall('delete', '/x/5', 'f'), makeRoute('all', '/x/:id'), true],
  ];
  let pass = true;
  for (const [name, call, route, expected] of fixtures) {
    const got = routeMatches(call, route);
    if (got !== expected) pass = false;
    console.log(`  [${got === expected ? 'PASS' : 'FAIL'}] ${name}`);
  }
  // CKQ's historical bug shape: a call with no matching route is reported.
  const phantom = makeCall('get', '/parent/child-stats/${childId}', 'f');
  const historicalOk =
    findPhantoms([phantom], [makeRoute('get', '/parent/dashboard'), makeRoute('get', '/parent/:id')]).length === 1;
  if (!historicalOk) pass = false;
  console.log(`  [${historicalOk ? 'PASS' : 'FAIL'}] historical phantom shape reported`);
  console.log(pass ? '✅ All self-test fixtures passed.' : '🚫 Self-test FAILED.');
  process.exit(pass ? 0 : 2);
}

// ── Backend ────────────────────────────────────────────────────────────────

function introspectBackend(backendDir) {
  const result = spawnSync(process.execPath, [path.join(__dirname, 'route-introspect.cjs'), backendDir], {
    cwd: backendDir,
    encoding: 'utf8',
    maxBuffer: 20 * 1024 * 1024,
    env: { ...process.env, JWT_SECRET: process.env.JWT_SECRET || 'route-existence-check' },
  });
  const stdout = result.stdout || '';
  const start = stdout.indexOf(START_MARKER);
  const end = stdout.indexOf(END_MARKER);
  if (result.error || result.status !== 0 || start === -1 || end === -1) {
    fail(
      `backend introspection failed (exit ${result.status}).\n--- stderr ---\n${(result.stderr || '').trim() || '(empty)'}`
    );
  }
  const parsed = JSON.parse(stdout.slice(start + START_MARKER.length, end));
  if (parsed.unreadableMounts.length > 0) {
    fail(`could not read the mount path of: ${parsed.unreadableMounts.join(', ')}`);
  }
  const apiRoutes = parsed.routes
    .filter((r) => r.path.startsWith(API_PREFIX))
    .map((r) => makeRoute(r.method, r.path.slice(API_PREFIX.length)));
  if (apiRoutes.length < MIN_BACKEND_ROUTES) {
    fail(`only ${apiRoutes.length} ${API_PREFIX} routes found (expected ≥ ${MIN_BACKEND_ROUTES})`);
  }
  return apiRoutes;
}

// ── Frontend ───────────────────────────────────────────────────────────────

function walk(dir, out = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (['node_modules', '.next', '__tests__'].includes(entry.name) || entry.name.startsWith('.')) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full, out);
    else if (/\.(ts|tsx)$/.test(entry.name) && !/\.d\.ts$/.test(entry.name)) out.push(full);
  }
  return out;
}

const lineOf = (src, index) => src.slice(0, index).split('\n').length;
const rel = (root, file) => path.relative(root, file).split(path.sep).join('/');

function extractFrontendCalls(frontendDir) {
  const files = ['app', 'lib'].flatMap((dir) => walk(path.join(frontendDir, dir)));
  if (files.length < 50) fail(`only ${files.length} frontend source files found under ${frontendDir}`);

  const calls = [];
  const unparseable = [];
  // api.get<…>('/path…') — the generic may span lines; its body never contains '('.
  const callRe = /\bapi\s*\.\s*(get|post|put|patch|delete)\s*(?:<[^(]*?>)?\s*\(\s*(['"`]?)/g;

  for (const file of files) {
    const src = fs.readFileSync(file, 'utf8');
    if (!/\bapi\s*\./.test(src)) continue;
    for (const match of src.matchAll(callRe)) {
      const [, method, quote] = match;
      const loc = `${rel(frontendDir, file)}:${lineOf(src, match.index)}`;
      if (!quote) {
        if (!ALLOWLIST.some((entry) => entry.file === rel(frontendDir, file))) {
          unparseable.push(`${method.toUpperCase()} (non-literal first argument) [${loc}]`);
        }
        continue;
      }
      const startIdx = match.index + match[0].length;
      const raw = src.slice(startIdx, src.indexOf(quote, startIdx)).split('?')[0];
      if (!raw.startsWith('/')) {
        unparseable.push(`${method.toUpperCase()} "${raw.slice(0, 60)}" (does not start with /) [${loc}]`);
        continue;
      }
      calls.push(makeCall(method, raw, loc));
    }
  }
  return { calls, unparseable };
}

// Every MockRule under frontend/e2e — the default registry AND each spec's own
// overrides, since a spec mocking a route the backend does not have is the
// same drift. A template-literal path's `${...}` is a :param.
function extractE2eMockRoutes(frontendDir) {
  const e2eDir = path.join(frontendDir, 'e2e');
  const registry = path.join(e2eDir, 'fixtures', 'mock-api.ts');
  if (!fs.existsSync(registry)) fail(`E2E mock registry not found: ${registry}`);
  // Find every rule first, then parse its path: a path that is not a plain
  // '...' or `...` literal is an extraction failure, never silently skipped.
  const ruleRe = /method:\s*'(GET|POST|PUT|PATCH|DELETE)',\s*path:\s*/g;
  const calls = [];
  const unparseable = [];
  for (const file of walk(e2eDir).filter((f) => f.endsWith('.ts'))) {
    const src = fs.readFileSync(file, 'utf8');
    for (const m of src.matchAll(ruleRe)) {
      const loc = `${rel(frontendDir, file)}:${lineOf(src, m.index)}`;
      const literal = /^(?:'(\/[^'\n]*)'|`(\/(?:[^`$\n]|\$\{[A-Za-z0-9_.]+\})*)`)/.exec(src.slice(m.index + m[0].length));
      if (!literal) {
        unparseable.push(`${m[1]} (path is not a literal) [${loc}]`);
        continue;
      }
      const raw = (literal[1] ?? literal[2]).replace(/\$\{[^}]*\}/g, ':param');
      calls.push(makeCall(m[1].toLowerCase(), raw, loc));
    }
  }
  if (unparseable.length > 0) {
    fail(`unparseable E2E MockRule path(s) — use a literal path:\n  ${unparseable.join('\n  ')}`);
  }
  if (!calls.some((call) => call.loc.startsWith(rel(frontendDir, registry)))) {
    fail(`no MockRule entries parsed from ${registry}`);
  }
  return calls;
}

// ── Main ───────────────────────────────────────────────────────────────────

function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.selfTest) return selfTest();

  const repoRoot = path.join(__dirname, '..');
  const backendDir = path.resolve(args.backend || path.join(repoRoot, 'backend'));
  const frontendDir = path.resolve(args.frontend || path.join(repoRoot, 'frontend'));
  for (const dir of [backendDir, frontendDir]) {
    if (!fs.existsSync(dir)) fail(`directory not found: ${dir}`);
  }

  const routes = introspectBackend(backendDir);
  const { calls, unparseable } = extractFrontendCalls(frontendDir);
  const mockCalls = extractE2eMockRoutes(frontendDir);

  if (unparseable.length > 0) {
    fail(`unparseable frontend API call(s) — use a literal path, or allowlist with a verified reason:\n  ${unparseable.join('\n  ')}`);
  }

  const phantoms = [...findPhantoms(calls, routes), ...findPhantoms(mockCalls, routes)];
  console.log(
    `route-existence: ${calls.length} frontend calls, ${mockCalls.length} e2e mock routes, ${routes.length} backend routes, ${phantoms.length} phantoms`
  );
  if (phantoms.length === 0) {
    console.log('✅ Every frontend call and E2E mock matches a registered backend route.');
    process.exit(0);
  }
  console.log('🚨 PHANTOM ROUTES — no matching backend route:');
  for (const p of phantoms) console.log(`  ${p.loc}  ${p.method.toUpperCase()} ${p.raw}`);
  process.exit(1);
}

main();
