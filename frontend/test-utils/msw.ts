// Strict MSW for the Jest suite: a request no handler matches fails the test
// that made it, instead of erroring quietly inside a component that may
// tolerate it (docs/plans/testing-strategy-refresh-plan.md PR D; the Jest
// counterpart of the E2E layer's loud-fail in e2e/fixtures/mock-api.ts).
//
// Every test file starts its server with
//   beforeAll(() => server.listen({ onUnhandledRequest }));
// and jest.setup.js fails the test in afterEach if anything was recorded
// (frontend/lib/__tests__/guards/mswStrictGuard.test.ts enforces the listen()).

const unhandled: string[] = [];

/** MSW's `onUnhandledRequest` strategy: record the request so the test fails. */
export function onUnhandledRequest(request: Request): void {
  const url = new URL(request.url);
  unhandled.push(`${request.method} ${url.pathname}${url.search}`);
}

/** Throws (failing the current test) when a request went unhandled since the last call. */
export function assertNoUnhandledRequests(): void {
  if (unhandled.length === 0) return;
  const requests = unhandled.splice(0);
  throw new Error(
    `Requests with no matching MSW handler:\n  ${requests.join('\n  ')}\n` +
      "Add a handler (server.use(...)) for each — a test must say what the backend answers."
  );
}
