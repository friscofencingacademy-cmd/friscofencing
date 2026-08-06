// Isolated on purpose: Phase 8 (sibling discount) edits this function in
// place, and Phase 9 (renewal job) reuses it as-is. No discount logic yet —
// today it's a pass-through of the level's monthly fee.
function calculateChargeAmount(student, monthlyFee) {
  return monthlyFee;
}

module.exports = { calculateChargeAmount };
