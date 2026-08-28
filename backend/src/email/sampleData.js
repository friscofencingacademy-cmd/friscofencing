'use strict';

/**
 * One realistic sample data object per template key — feeds
 * scripts/preview-emails.js and the renderEmail smoke test. Every field a
 * template's build() reads must appear here with a real, non-empty value so
 * the "no undefined leaks into the output" test is meaningful.
 */

const SAMPLE_DATA = {
  trialConfirmation: {
    studentName: 'Sam Rivera',
    className: 'Beginner Foil',
    levelName: 'Beginner',
    coachName: 'Coach Dana',
    whenLabel: 'Monday, Aug 25, 2026 · 4:00 PM',
    locationName: 'Frisco HQ',
  },

  trialEvaluation: {
    studentName: 'Sam Rivera',
    coachName: 'Coach Dana',
    levelName: 'Beginner Above 10Y',
    notes: 'Great footwork and focus for a first class — ready to start regular training.',
  },

  registrationConfirmation: {
    studentName: 'Sam Rivera',
    className: 'Beginner Foil',
    levelName: 'Beginner',
    coachName: 'Coach Dana',
    scheduleLabel: 'Monday, 4:00 PM - 5:00 PM',
    locationName: 'Frisco HQ',
    monthlyFee: 150,
    siblingDiscountAmount: 0,
    chargeAmount: 150,
    firstClassDateLabel: 'Monday, Aug 25, 2026',
  },

  renewalReceipt: {
    studentName: 'Sam Rivera',
    className: 'Beginner Foil',
    monthLabel: 'September',
    billingPeriodLabel: 'Sep 1, 2026 - Oct 1, 2026',
    monthlyFee: 150,
    siblingDiscountAmount: 15,
    chargeAmount: 135,
  },

  cancellationConfirmation: {
    studentName: 'Sam Rivera',
    className: 'Beginner Foil',
    scheduleLabel: 'Monday, 4:00 PM - 5:00 PM',
    endDateLabel: 'Oct 1, 2026',
  },

  reactivationConfirmation: {
    studentName: 'Sam Rivera',
    className: 'Beginner Foil',
    scheduleLabel: 'Monday, 4:00 PM - 5:00 PM',
    nextBillingDateLabel: 'Oct 1, 2026',
  },

  scheduleChangeConfirmation: {
    studentName: 'Sam Rivera',
    previousClassName: 'Beginner Foil',
    previousScheduleLabel: 'Monday, 4:00 PM - 5:00 PM',
    newClassName: 'Beginner Foil (Wed cohort)',
    newScheduleLabel: 'Wednesday, 5:00 PM - 6:00 PM',
    newCoachName: 'Coach Dana',
  },

  paymentFailure: {
    studentName: 'Sam Rivera',
    className: 'Beginner Foil',
    amountDueLabel: '$150.00',
    nextRetryDateLabel: 'Saturday, Aug 29, 2026',
    attemptNumber: 1,
    maxAttempts: 3,
    isFinal: false,
    subjectPrefix: 'Payment failed',
    preheaderLine: "We couldn't charge your saved card — please update your payment method.",
  },

  privateClassConfirmation: {
    studentName: 'Sam Rivera',
    coachName: 'Dana Cole',
    slotLabel: 'Tuesday · 4:00 PM · 60 min',
    rateLabel: '$65/hr — $65 per session',
    firstSessionDateLabel: 'Tuesday, Aug 26, 2026',
    sessionPriceLabel: '$65',
  },

  privateClassSessionReceipt: {
    studentName: 'Sam Rivera',
    coachName: 'Dana Cole',
    sessionDateLabel: 'Tuesday, Aug 26, 2026',
    durationLabel: '60 min',
    amountLabel: '$65.00',
  },

  privateClassPaymentFailed: {
    studentName: 'Sam Rivera',
    sessionDateLabel: 'Tuesday, Aug 26, 2026',
    amountLabel: '$65.00',
    paymentMethodUrl: 'http://localhost:3000/parent/payment-method',
  },

  privateClassCancellation: {
    studentName: 'Sam Rivera',
    coachName: 'Dana Cole',
    slotLabel: 'Tuesday · 4:00 PM · 60 min',
  },
};

module.exports = { SAMPLE_DATA };
