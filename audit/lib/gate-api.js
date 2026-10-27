// Read-only superadmin API reads for live-gate preconditions
// (docs/plans/playwright-live-gates-plan.md D5). Every call is a GET through
// the staging frontend's own /api/v1 proxy, the same path a browser takes, so
// the login cookie is sent (see staging-guard.js). There is deliberately no
// post/put/delete here.

function createGateApi(request, stagingUrl) {
  const api = `${stagingUrl}/api/v1`;

  async function get(pathAndQuery) {
    const res = await request.get(`${api}${pathAndQuery}`);
    if (!res.ok()) {
      throw new Error(`GET ${pathAndQuery} returned ${res.status()}`);
    }
    return res.json();
  }

  return {
    get,

    // Every subscription whose student/parent name or parent email matches `q`.
    async subscriptions(q, status) {
      const query = new URLSearchParams({ q, limit: '100' });
      if (status) query.set('status', status);
      const body = await get(`/subscriptions?${query}`);
      return body.subscriptions;
    },

    // The one active subscription of the student named `fullName`, or null.
    async activeSubscriptionOf(fullName) {
      const rows = await this.subscriptions(fullName.split(' ').pop(), 'active');
      return rows.find((row) => `${row.studentId.firstName} ${row.studentId.lastName}` === fullName) || null;
    },

    // The Charge dialog's own preview (previewRenewal — no side effects).
    chargePreview(subscriptionId) {
      return get(`/subscriptions/${subscriptionId}/charge-preview`);
    },

    // A family's ledger rows, newest first — the Payment History dialog's source.
    async history(parentId) {
      const body = await get(`/registrations/history?parentId=${encodeURIComponent(parentId)}`);
      return body.history;
    },

    async prices() {
      return (await get('/prices')).prices;
    },

    async levels() {
      return (await get('/levels')).levels;
    },

    // The monthly fee and registration fee of the level named `levelName`.
    async priceOfLevel(levelName) {
      const [levels, prices] = await Promise.all([this.levels(), this.prices()]);
      const level = levels.find((candidate) => candidate.name === levelName);
      if (!level) return null;
      const price = prices.find((candidate) => String(candidate.levelId) === String(level._id));
      return price ? { levelId: level._id, monthlyFee: price.monthlyFee, registrationFee: price.registrationFee } : null;
    },
  };
}

module.exports = { createGateApi };
