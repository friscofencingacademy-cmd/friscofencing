// Pricing math for private lessons — pure functions only, no DB access.
// Rates are stored HOURLY everywhere upstream (CoachContract.
// studentBillingRate, PrivateClassEnrollment.agreedHourlyRate). A dollar
// amount is stored in exactly one place: the Registration ledger row of a
// purchase (per_session discriminator), which records what was charged.
//
// This is the ONLY place any private-lesson price or pack rule lives. Every
// consumer (the purchase charge, the purchase preview, the public listing,
// emails, invoices, settings validation) imports from here rather than
// re-deriving the math (Hard Rule 7 — no pricing math anywhere else,
// frontend included).
//
// Fails closed — these functions never guess a price. Any invalid input
// throws rather than silently producing a wrong or zero amount.

// Pack discounts are capped below 100%: a free pack is not a pack.
const MAX_PACK_DISCOUNT_PERCENT = 99;

function roundToCents(value) {
  return Math.round(value * 100) / 100;
}

function computeSessionPrice(hourlyRate, durationMinutes) {
  if (
    hourlyRate === null ||
    hourlyRate === undefined ||
    !Number.isFinite(hourlyRate) ||
    hourlyRate < 0
  ) {
    throw new Error('A valid hourly rate is required to compute a session price');
  }

  if (!Number.isFinite(durationMinutes) || durationMinutes <= 0) {
    throw new Error('A valid positive session duration is required to compute a session price');
  }

  return roundToCents((hourlyRate * durationMinutes) / 60);
}

function assertValidQuantity(quantity) {
  if (!Number.isInteger(quantity) || quantity < 1) {
    throw new Error('A pack quantity must be a positive whole number');
  }
}

function assertValidDiscountPercent(discountPercent) {
  if (!Number.isFinite(discountPercent) || discountPercent < 0 || discountPercent > MAX_PACK_DISCOUNT_PERCENT) {
    throw new Error(`A pack discount must be between 0 and ${MAX_PACK_DISCOUNT_PERCENT} percent`);
  }
}

// The full price of `quantity` sessions at `unitPrice`, before any discount.
function computePackSubtotal(unitPrice, quantity) {
  if (!Number.isFinite(unitPrice) || unitPrice < 0) {
    throw new Error('A valid unit price is required to compute a pack total');
  }
  assertValidQuantity(quantity);

  return roundToCents(unitPrice * quantity);
}

// What a purchase of `quantity` sessions is charged. The discount is taken
// off the subtotal once, then rounded — never per session, so ten sessions
// at 10% off cost exactly 90% of the subtotal to the cent.
function computePackTotal(unitPrice, quantity, discountPercent) {
  assertValidDiscountPercent(discountPercent);
  const subtotal = computePackSubtotal(unitPrice, quantity);

  return roundToCents((subtotal * (100 - discountPercent)) / 100);
}

// Every figure a purchase quote shows, from the same three inputs the charge
// uses. `discountAmount` is subtotal - total, so the lines always sum.
function computePackQuote(unitPrice, quantity, discountPercent) {
  const subtotal = computePackSubtotal(unitPrice, quantity);
  const total = computePackTotal(unitPrice, quantity, discountPercent);

  return {
    unitPrice,
    quantity,
    discountPercent,
    subtotal,
    discountAmount: roundToCents(subtotal - total),
    total,
  };
}

// Validates and normalizes the admin-configured pack list
// (Setting.privateClassPackages): whole quantities >= 2 (a single session is
// always offered implicitly), discounts within range, no duplicate
// quantities; sorted by quantity. Throws a plain Error naming the problem —
// setting.service.js turns it into a 400.
function normalizePackageOffers(packages) {
  if (!Array.isArray(packages)) {
    throw new Error('privateClassPackages must be a list');
  }

  const seen = new Set();

  const normalized = packages.map((pack) => {
    if (!pack || typeof pack !== 'object') {
      throw new Error('Each private-lesson pack needs a quantity and a discountPercent');
    }

    const { quantity, discountPercent } = pack;

    if (!Number.isInteger(quantity) || quantity < 2) {
      throw new Error('A private-lesson pack quantity must be a whole number of at least 2');
    }
    assertValidDiscountPercent(discountPercent);

    if (seen.has(quantity)) {
      throw new Error(`Only one private-lesson pack may have quantity ${quantity}`);
    }
    seen.add(quantity);

    return { quantity, discountPercent };
  });

  return normalized.sort((a, b) => a.quantity - b.quantity);
}

// Every purchase option offered to a parent: a single session at full price,
// always first, then the configured packs. The single place the "one
// session is always offered" rule lives.
function resolvePackOptions(storedPackages = []) {
  return [{ quantity: 1, discountPercent: 0 }, ...normalizePackageOffers(storedPackages)];
}

// Minute difference between two Date instants — may be fractional.
function sessionDurationMinutes(startDate, endDate) {
  const start = new Date(startDate).getTime();
  const end = new Date(endDate).getTime();

  if (!Number.isFinite(start) || !Number.isFinite(end)) {
    throw new Error('Valid start and end dates are required to compute session duration');
  }

  const minutes = (end - start) / 60000;

  if (!(minutes > 0)) {
    throw new Error('Session end date must be after the start date');
  }

  return minutes;
}

module.exports = {
  MAX_PACK_DISCOUNT_PERCENT,
  computeSessionPrice,
  computePackSubtotal,
  computePackTotal,
  computePackQuote,
  normalizePackageOffers,
  resolvePackOptions,
  sessionDurationMinutes,
};
