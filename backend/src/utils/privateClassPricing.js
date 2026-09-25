// Pricing math for private lessons — pure functions only, no DB access.
// Rates are stored HOURLY everywhere upstream (CoachContract.
// studentBillingRate, PrivateClassEnrollment.agreedHourlyRate). A dollar
// amount is stored in exactly one place: the Registration ledger row of a
// purchase (per_session discriminator), which records what was charged.
//
// This is the ONLY place any private-lesson price or pack rule lives
// (docs/plans/coach-pack-pricing-plan.md D14). Every consumer (the purchase
// charge, the purchase quote, the public listing, the contract pack editor's
// preview, emails, invoices) imports from here rather than re-deriving the
// math (Hard Rule 7 — no pricing math anywhere else, frontend included).
//
// Built bottom-up so each rule exists once:
//   quotePurchase    — the only savings formula (D6)
//   packPriceBand    — the only definition of a pack's allowed price range (D8)
//   describePack     — the only pack check; returns an error, never throws
//   validatePacks    — describePack for every pack, throws the first error
//   purchaseOptionsFor — the only shape of a purchase option (D14 d)
//   purchaseBreakdown  — a ledger row's lines, for the email and the invoice
//
// Money is computed in whole cents internally so a band edge can never be
// off by a floating-point hair. Fails closed — a function that returns a
// price never guesses; invalid input throws.

const { money } = require('../email/layout');

// D8's floor: a pack must cost at least this share of buying its sessions
// singly. Below it is almost certainly a typo (the single price entered as
// the pack price) that would undercharge the academy. Change it here, and
// only here, if the academy ever wants deeper packs.
const PACK_PRICE_FLOOR_RATIO = 0.5;

const MIN_PACK_QUANTITY = 2;
const MIN_LESSON_MINUTES = 15;

function toCents(value) {
  return Math.round(value * 100);
}

function fromCents(cents) {
  return cents / 100;
}

function roundToCents(value) {
  return fromCents(toCents(value));
}

// Rounds UP to the next whole cent — used for the band's floor, so "at least
// half" of $146.25 reads $73.13, never $73.12.
function ceilToCents(value) {
  return fromCents(Math.ceil(value * 100 - 1e-9));
}

function isWholeCents(value) {
  return Number.isFinite(value) && Math.abs(value * 100 - Math.round(value * 100)) < 1e-6;
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

// Every figure a purchase shows, from what one session costs and what the
// purchase costs. `total` is `price` (the pack price, or the unit price for a
// single session); `savings = subtotal - total`. THE ONLY SAVINGS FORMULA —
// the quote, the listing, the pack preview, the email and the invoice all
// come through here, so a savings figure can never disagree with a charge.
function quotePurchase(unitPrice, { quantity, price }) {
  if (!Number.isFinite(unitPrice) || unitPrice < 0) {
    throw new Error('A valid unit price is required to quote a purchase');
  }

  if (!Number.isInteger(quantity) || quantity < 1) {
    throw new Error('A purchase quantity must be a positive whole number');
  }

  if (!Number.isFinite(price) || price < 0) {
    throw new Error('A valid price is required to quote a purchase');
  }

  const subtotalCents = toCents(unitPrice) * quantity;
  const totalCents = toCents(price);

  return {
    quantity,
    unitPrice: roundToCents(unitPrice),
    subtotal: fromCents(subtotalCents),
    savings: fromCents(subtotalCents - totalCents),
    total: fromCents(totalCents),
  };
}

// D8's allowed price range for a pack of `quantity` lessons of
// `sessionDurationMinutes` at `hourlyRate`:
//   min = subtotal x PACK_PRICE_FLOOR_RATIO, rounded UP to whole cents
//   max = subtotal - $0.01 (a pack must save the parent something)
// The one definition of the band — validation and the preview both use it.
function packPriceBand(hourlyRate, { sessionDurationMinutes, quantity }) {
  const unitPrice = computeSessionPrice(hourlyRate, sessionDurationMinutes);
  const subtotalCents = toCents(unitPrice) * quantity;

  return {
    unitPrice,
    subtotal: fromCents(subtotalCents),
    min: ceilToCents(fromCents(subtotalCents) * PACK_PRICE_FLOOR_RATIO),
    max: fromCents(subtotalCents - 1),
  };
}

function packLabel({ quantity, sessionDurationMinutes }) {
  return `${quantity} × ${sessionDurationMinutes} min`;
}

// The first rule a pack breaks, as the message a save returns, or null.
function packError(hourlyRate, pack, band) {
  const { sessionDurationMinutes, quantity, price } = pack;

  if (!Number.isInteger(sessionDurationMinutes) || sessionDurationMinutes < MIN_LESSON_MINUTES) {
    return `Each pack needs a lesson length of at least ${MIN_LESSON_MINUTES} minutes`;
  }

  if (!Number.isInteger(quantity) || quantity < MIN_PACK_QUANTITY) {
    return `A pack must include at least ${MIN_PACK_QUANTITY} sessions (a single session is always offered)`;
  }

  if (!(band.subtotal > 0)) {
    return `${packLabel(pack)}: a pack needs a positive session price — set the hourly rate first`;
  }

  const range = `between ${money(band.min)} and ${money(band.max)}`;

  if (!Number.isFinite(price) || !isWholeCents(price)) {
    return `${packLabel(pack)}: price must be a dollar amount in whole cents, ${range}`;
  }

  if (price < band.min || price > band.max) {
    return `${packLabel(pack)}: price must be ${range}`;
  }

  return null;
}

// The editor preview for ONE pack (D9a), and the one pack check (D14 a).
// Never throws: a pack that breaks a rule comes back with `error` set to the
// exact message saving it would return. Figures that cannot be computed
// (an unusable length or quantity, a non-numeric price) are null.
function describePack(hourlyRate, pack) {
  const input = pack && typeof pack === 'object' ? pack : {};
  const { sessionDurationMinutes, quantity, price } = input;

  const base = {
    sessionDurationMinutes,
    quantity,
    price,
    perLessonPrice: null,
    subtotal: null,
    savings: null,
    savingsPercent: null,
    allowedRange: null,
    error: null,
  };

  const shapeUsable =
    Number.isInteger(sessionDurationMinutes) &&
    sessionDurationMinutes >= MIN_LESSON_MINUTES &&
    Number.isInteger(quantity) &&
    quantity >= MIN_PACK_QUANTITY;

  if (!shapeUsable) {
    return { ...base, error: packError(hourlyRate, input, { subtotal: 0 }) };
  }

  const band = packPriceBand(hourlyRate, { sessionDurationMinutes, quantity });
  const error = packError(hourlyRate, input, band);
  const described = { ...base, subtotal: band.subtotal, allowedRange: { min: band.min, max: band.max }, error };

  if (!Number.isFinite(price) || price < 0 || !(band.subtotal > 0)) {
    return described;
  }

  const { savings } = quotePurchase(band.unitPrice, { quantity, price });

  return {
    ...described,
    perLessonPrice: roundToCents(price / quantity),
    savings,
    savingsPercent: Math.round((savings / band.subtotal) * 100),
  };
}

// D8 for a whole list: every pack through describePack (the one check),
// then no two packs with the same length and quantity. Returns the list
// normalized ({ _id? , sessionDurationMinutes, quantity, price }, sorted by
// length then quantity) or throws a plain Error — the caller turns it into
// a 400. `_id` is passed through untouched; whether it survives is the
// contract service's decision (plan D7).
function validatePacks(packs, hourlyRate) {
  if (!Array.isArray(packs)) {
    throw new Error('privateLessonPacks must be a list');
  }

  const seen = new Set();

  const normalized = packs.map((pack) => {
    const { error } = describePack(hourlyRate, pack);

    if (error) {
      throw new Error(error);
    }

    const key = `${pack.sessionDurationMinutes}:${pack.quantity}`;
    if (seen.has(key)) {
      throw new Error(`Only one pack may offer ${packLabel(pack)}`);
    }
    seen.add(key);

    return {
      ...(pack._id ? { _id: pack._id } : {}),
      sessionDurationMinutes: pack.sessionDurationMinutes,
      quantity: pack.quantity,
      price: pack.price,
    };
  });

  return normalized.sort(
    (a, b) => a.sessionDurationMinutes - b.sessionDurationMinutes || a.quantity - b.quantity
  );
}

// Every purchase option offered for a slot of `durationMinutes` with this
// coach: the single session at the contract's rate, always first, then the
// contract's packs of exactly that length (a pack's credits book only that
// length — plan D3). THE ONE SHAPE of a purchase option: the quote endpoint
// and the public listing both return this output unchanged.
function purchaseOptionsFor(contract, durationMinutes) {
  const unitPrice = computeSessionPrice(contract.studentBillingRate, durationMinutes);

  const packs = (contract.privateLessonPacks || [])
    .filter((pack) => pack.sessionDurationMinutes === durationMinutes)
    .sort((a, b) => a.quantity - b.quantity)
    .map((pack) => ({
      packId: String(pack._id),
      ...quotePurchase(unitPrice, { quantity: pack.quantity, price: pack.price }),
    }));

  return [{ packId: null, ...quotePurchase(unitPrice, { quantity: 1, price: unitPrice }) }, ...packs];
}

// A completed purchase's lines, from its immutable ledger row: sessions x
// the unit price at purchase, the subtotal, the derived savings, and the
// total — which is ALWAYS row.amount, what was actually charged. The email
// and the invoice both render from this, never from their own arithmetic.
function purchaseBreakdown(row) {
  return quotePurchase(row.unitPrice, { quantity: row.quantity, price: row.amount });
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
  PACK_PRICE_FLOOR_RATIO,
  computeSessionPrice,
  quotePurchase,
  packPriceBand,
  describePack,
  validatePacks,
  purchaseOptionsFor,
  purchaseBreakdown,
  sessionDurationMinutes,
};
