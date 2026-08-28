// Seeds/corrects the Service registry (docs/plans/service-registry-unified-
// ledger-plan.md D2) — idempotent upsert by `code`. Re-running restores
// `name`/`billingShape` drift back to this canonical list (they're not
// owner-editable data — the registry must match the code that reads it, or
// nothing works). `isActive` is deliberately NEVER touched on an existing
// row here — that's owner/admin state (turning a dormant service on, or an
// active one off), not seed state.

const Service = require('../../src/models/service.model');

// camps/meets are real future services, seeded now (so the schema/plan is
// complete and a later feature PR only builds behavior, never reshapes the
// registry) but start inactive — there is no camp/meet feature to route
// money to yet.
const CANONICAL_SERVICES = [
  { code: 'group-classes', name: 'Group Classes', billingShape: 'subscription_cycle' },
  { code: 'private-lessons', name: 'Private Lessons', billingShape: 'per_session' },
  { code: 'camps', name: 'Camps', billingShape: 'one_time_event' },
  { code: 'meets', name: 'Meets', billingShape: 'one_time_event' },
];

const DORMANT_CODES = new Set(['camps', 'meets']);

async function seedServices() {
  const results = [];

  for (const canonical of CANONICAL_SERVICES) {
    // eslint-disable-next-line no-await-in-loop -- sequential by design, a
    // handful of static rows — no benefit to parallelizing.
    const existing = await Service.findOne({ code: canonical.code });

    if (!existing) {
      // eslint-disable-next-line no-await-in-loop -- see note above.
      const created = await Service.create({
        ...canonical,
        isActive: !DORMANT_CODES.has(canonical.code),
      });
      results.push({ code: canonical.code, action: 'created', id: created._id });
      // eslint-disable-next-line no-continue -- clearer than nesting the
      // rest of this loop body one level deeper.
      continue;
    }

    const driftedFields = {};
    if (existing.name !== canonical.name) driftedFields.name = canonical.name;
    if (existing.billingShape !== canonical.billingShape) driftedFields.billingShape = canonical.billingShape;

    if (Object.keys(driftedFields).length > 0) {
      // eslint-disable-next-line no-await-in-loop -- see note above.
      await Service.updateOne({ _id: existing._id }, { $set: driftedFields });
      results.push({ code: canonical.code, action: 'corrected', id: existing._id, fields: Object.keys(driftedFields) });
    } else {
      results.push({ code: canonical.code, action: 'unchanged', id: existing._id });
    }
  }

  return { results };
}

module.exports = { seedServices, CANONICAL_SERVICES };
