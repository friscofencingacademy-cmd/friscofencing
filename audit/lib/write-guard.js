// Read-only is enforced, not promised (docs/plans/playwright-live-gates-plan.md
// D3). Every browser context a live gate creates gets this guard: any request
// to the app's API that is not a GET/HEAD is aborted before it leaves the
// browser, except signing in and out. An accidental click on Confirm Charge,
// Record Payment or Register & Pay therefore never reaches the server, and
// the runner fails the step with the blocked method and path.
//
// Requests to other origins (Stripe's own domains, which the inline card form
// talks to on mount) are not app API calls and pass untouched.

const ALLOWED_WRITES = new Set(['POST /api/v1/auth/login', 'POST /api/v1/auth/logout']);

// { allowed: true } or { allowed: false, reason: 'Blocked write: POST /api/v1/…' }.
function checkRequest(method, url) {
  const upper = String(method).toUpperCase();
  let pathname;

  try {
    pathname = new URL(url).pathname;
  } catch {
    return { allowed: true };
  }

  if (!pathname.startsWith('/api/v1/')) return { allowed: true };
  if (upper === 'GET' || upper === 'HEAD') return { allowed: true };
  if (ALLOWED_WRITES.has(`${upper} ${pathname}`)) return { allowed: true };

  return { allowed: false, reason: `Blocked write: ${upper} ${pathname}` };
}

// Installs the guard on a Playwright BrowserContext (not a page, so every page
// and popup in it is covered). `allowWrites` is the runner's --allow-writes.
// Returns { takeBlocked() } — the reasons blocked since the last call.
async function installWriteGuard(context, { allowWrites = false } = {}) {
  let blocked = [];

  await context.route('**/api/v1/**', async (route) => {
    const request = route.request();
    const verdict = checkRequest(request.method(), request.url());

    if (verdict.allowed || allowWrites) {
      await route.continue();
      return;
    }

    blocked.push(verdict.reason);
    await route.abort('blockedbyclient');
  });

  return {
    takeBlocked() {
      const taken = blocked;
      blocked = [];
      return taken;
    },
  };
}

module.exports = { checkRequest, installWriteGuard };
