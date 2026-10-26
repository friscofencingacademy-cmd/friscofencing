const mongoose = require('mongoose');

const User = require('../../src/models/user.model');
const WebhookEvent = require('../../src/models/webhookEvent.model');

// One-time migration for the payment provider port's field rename
// (docs/plans/payment-provider-port-plan.md D6, PR 2;
// docs/decisions/013-payment-provider-port.md). Renames every Stripe-named
// persisted field to its provider-neutral name and records which provider
// each value belongs to — every value written before the port came from
// Stripe, the only provider that existed:
//
//   users          stripeCustomerId       -> providerCustomerId + paymentProvider: 'stripe'
//   paymentmethods stripePaymentMethodId  -> providerPaymentMethodId + provider: 'stripe'
//   registrations  stripePaymentIntentId  -> providerPaymentId + provider ('stripe' iff it holds a payment id, else null)
//   webhookevents  stripeEventId          -> providerEventId, paymentIntentId -> providerPaymentId, + provider: 'stripe'
//
// then drops the two old single-field unique indexes (users.stripeCustomerId_1,
// webhookevents.stripeEventId_1) by name and builds the models' declared
// indexes with createIndexes() — NEVER syncIndexes(), which would also drop
// any index not declared in the schema.
//
// Decisions recorded here because they are not obvious from the code:
//  - A user whose stripeCustomerId is null (not a string) has the field
//    removed rather than carried over: a null in the new unique sparse index
//    would collide with the next one.
//  - A historical ledger row is stamped provider 'stripe' only when it carries
//    a Stripe payment id. A row without one (a manual recording, a legacy
//    import, a backfilled row, or a decline that recorded no payment) gets
//    null — the honest "no provider payment recorded". Rows written after the
//    port record their provider on every attempt.
//
// Works on the raw collections, not the models — the models no longer know
// the old field names. Dry-run by default (counts only, no writes). Idempotent:
// a second live run changes nothing and reports zero. Ends with a verification
// scan; any document still carrying an old field name, or missing a required
// provider, fails the run.

const OLD_INDEXES = [
  { collection: 'users', name: 'stripeCustomerId_1' },
  { collection: 'webhookevents', name: 'stripeEventId_1' },
];

function plan(db) {
  const users = db.collection('users');
  const paymentMethods = db.collection('paymentmethods');
  const registrations = db.collection('registrations');
  const webhookEvents = db.collection('webhookevents');

  return [
    {
      label: 'users: stripeCustomerId -> providerCustomerId (+ paymentProvider stripe)',
      collection: users,
      filter: { stripeCustomerId: { $type: 'string' } },
      update: { $rename: { stripeCustomerId: 'providerCustomerId' }, $set: { paymentProvider: 'stripe' } },
    },
    {
      label: 'users: null stripeCustomerId removed',
      collection: users,
      filter: { stripeCustomerId: { $exists: true, $not: { $type: 'string' } } },
      update: { $unset: { stripeCustomerId: '' } },
    },
    {
      label: 'paymentmethods: stripePaymentMethodId -> providerPaymentMethodId (+ provider stripe)',
      collection: paymentMethods,
      filter: { stripePaymentMethodId: { $exists: true } },
      update: { $rename: { stripePaymentMethodId: 'providerPaymentMethodId' }, $set: { provider: 'stripe' } },
    },
    {
      label: 'registrations: stripePaymentIntentId -> providerPaymentId',
      collection: registrations,
      filter: { stripePaymentIntentId: { $exists: true } },
      update: { $rename: { stripePaymentIntentId: 'providerPaymentId' } },
    },
    {
      label: 'registrations: provider stripe where a payment id is recorded',
      collection: registrations,
      filter: { providerPaymentId: { $type: 'string' }, provider: { $exists: false } },
      // A dry run counts BEFORE the rename above has happened, so it asks the
      // same question of the old field.
      dryRunFilter: {
        provider: { $exists: false },
        $or: [{ providerPaymentId: { $type: 'string' } }, { stripePaymentIntentId: { $type: 'string' } }],
      },
      update: { $set: { provider: 'stripe' } },
    },
    {
      // Only rows the step above did not stamp reach here.
      label: 'registrations: provider null where no payment id is recorded',
      collection: registrations,
      filter: { provider: { $exists: false } },
      dryRunFilter: {
        provider: { $exists: false },
        providerPaymentId: { $not: { $type: 'string' } },
        stripePaymentIntentId: { $not: { $type: 'string' } },
      },
      update: { $set: { provider: null, providerPaymentId: null } },
    },
    {
      label: 'webhookevents: stripeEventId -> providerEventId, paymentIntentId -> providerPaymentId (+ provider stripe)',
      collection: webhookEvents,
      filter: { stripeEventId: { $exists: true } },
      update: {
        $rename: { stripeEventId: 'providerEventId', paymentIntentId: 'providerPaymentId' },
        $set: { provider: 'stripe' },
      },
    },
  ];
}

// Documents that would mean the migration is incomplete.
function verificationQueries(db) {
  return [
    { label: 'users still carrying stripeCustomerId', collection: db.collection('users'), filter: { stripeCustomerId: { $exists: true } } },
    {
      label: 'paymentmethods still carrying stripePaymentMethodId or missing provider',
      collection: db.collection('paymentmethods'),
      filter: { $or: [{ stripePaymentMethodId: { $exists: true } }, { provider: { $exists: false } }] },
    },
    {
      label: 'registrations still carrying stripePaymentIntentId or missing provider',
      collection: db.collection('registrations'),
      filter: { $or: [{ stripePaymentIntentId: { $exists: true } }, { provider: { $exists: false } }] },
    },
    {
      label: 'webhookevents still carrying stripeEventId/paymentIntentId or missing provider',
      collection: db.collection('webhookevents'),
      filter: { $or: [{ stripeEventId: { $exists: true } }, { paymentIntentId: { $exists: true } }, { provider: { $exists: false } }] },
    },
  ];
}

async function existingIndexNames(collection) {
  try {
    return (await collection.indexes()).map((index) => index.name);
  } catch (error) {
    // A collection that does not exist yet has no indexes.
    if (error.codeName === 'NamespaceNotFound' || error.code === 26) return [];
    throw error;
  }
}

async function migrateProviderFields({ apply = false } = {}) {
  const { db } = mongoose.connection;
  const steps = [];

  for (const step of plan(db)) {
    // Sequential on purpose: later registration steps depend on earlier ones.
    // eslint-disable-next-line no-await-in-loop
    const matched = await step.collection.countDocuments(apply ? step.filter : step.dryRunFilter || step.filter);
    let modified = 0;

    if (apply && matched > 0) {
      // eslint-disable-next-line no-await-in-loop
      const result = await step.collection.updateMany(step.filter, step.update);
      modified = result.modifiedCount;
    }

    steps.push({ label: step.label, matched, modified });
  }

  const indexesDropped = [];
  const indexesToDrop = [];

  for (const { collection, name } of OLD_INDEXES) {
    // eslint-disable-next-line no-await-in-loop
    if ((await existingIndexNames(db.collection(collection))).includes(name)) {
      indexesToDrop.push(`${collection}.${name}`);
      if (apply) {
        // eslint-disable-next-line no-await-in-loop
        await db.collection(collection).dropIndex(name);
        indexesDropped.push(`${collection}.${name}`);
      }
    }
  }

  if (apply) {
    // Declared indexes only (providerCustomerId_1 unique sparse; the
    // (provider, providerEventId) unique pair) — never syncIndexes().
    await User.createIndexes();
    await WebhookEvent.createIndexes();
  }

  const verification = [];

  if (apply) {
    for (const query of verificationQueries(db)) {
      // eslint-disable-next-line no-await-in-loop
      verification.push({ label: query.label, count: await query.collection.countDocuments(query.filter) });
    }
  }

  const remaining = verification.reduce((sum, item) => sum + item.count, 0);

  return {
    applied: apply,
    steps,
    indexesToDrop,
    indexesDropped,
    verification,
    verified: apply ? remaining === 0 : null,
  };
}

module.exports = { migrateProviderFields };
