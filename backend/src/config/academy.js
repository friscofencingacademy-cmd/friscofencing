// Hard-coded academy identity for PDF invoices (docs/plans/manual-charge-
// and-pdf-invoice-plan.md D7) — deliberately NOT an admin-editable Setting.
// The owner said they can hand-edit this one file when the real values are
// ready, so there's no UI, no DB round-trip, no migration for it. `ein` is a
// PLACEHOLDER until the owner replaces it with the real number.
module.exports = {
  name: 'Frisco Fencing Academy',
  addressLines: ['<street address>', '<city>, TX <zip>'],
  phone: '',
  email: '',
  ein: 'XX-XXXXXXX',
};
