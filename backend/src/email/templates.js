'use strict';

/**
 * TEMPLATE REGISTRY — every email Frisco Fencing Academy sends, as
 * structured content (docs/plans/ckq-parity-plan.md §3.1). Adding/changing
 * an email = compose blocks in build(); never touch HTML directly (that
 * lives only in layout.js/text.js).
 *
 * build(data) is PURE — no fetching, no business logic, no Mongoose. Every
 * dollar amount and formatted date/time arrives already computed by the
 * caller (mail.service.js's send* functions, using dates.js formatters and
 * privateClassPricing.js/calculateChargeAmount.service.js) — backend-source-
 * of-truth applies to emails too (Hard Rule 7).
 */

const { ORG, C } = require('./tokens');

function esc(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function strong(s) {
  return `<strong style="color:${C.ink}">${esc(s)}</strong>`;
}

const TEMPLATES = [
  // ── Group class ──────────────────────────────────────────────────────
  {
    key: 'trialConfirmation',
    subject: "{{studentName}}'s free trial class is confirmed",
    preheader: "Your free trial is booked — here are the details.",
    build: (v) => [
      { t: 'badge', tone: 'green', glyph: '&#9876;' },
      { t: 'eyebrow', text: 'Free trial class', tone: 'green' },
      { t: 'heading', text: `${v.studentName}'s trial is confirmed` },
      {
        t: 'text',
        html: `We've saved a free trial class for ${strong(v.studentName)}. Here are the details — a coach will be ready and waiting.`,
      },
      {
        t: 'card',
        tone: 'green',
        children: [
          {
            t: 'detailList',
            rows: [
              ['Student', esc(v.studentName)],
              ['Class', esc(v.className)],
              ['Level', esc(v.levelName)],
              ['Coach', esc(v.coachName)],
              ['When', esc(v.whenLabel)],
              ['Location', esc(v.locationName)],
            ],
          },
        ],
      },
      {
        t: 'text',
        html: "Need a different time? Just reply to this email and we'll reschedule.",
        muted: true,
        size: 'sm',
      },
    ],
  },

  {
    key: 'trialEvaluation',
    subject: "{{studentName}}'s trial evaluation is ready",
    preheader: 'A coach shared feedback and a recommended level from the trial class.',
    build: (v) => [
      { t: 'badge', tone: 'green', glyph: '&#127942;' },
      { t: 'eyebrow', text: 'Trial evaluation', tone: 'green' },
      { t: 'heading', text: `${v.studentName}'s trial evaluation` },
      {
        t: 'text',
        html: `${strong(v.coachName)} evaluated ${strong(v.studentName)}'s trial class and recommends ${strong(v.levelName)}.`,
      },
      {
        t: 'card',
        tone: 'green',
        children: [
          {
            t: 'detailList',
            rows: [
              ['Coach', esc(v.coachName)],
              ['Recommended level', esc(v.levelName)],
            ],
          },
        ],
      },
      {
        t: 'text',
        html: esc(v.notes),
      },
      {
        t: 'text',
        html: 'Ready to enroll? Head to Register in your parent portal.',
        muted: true,
        size: 'sm',
      },
    ],
  },

  {
    key: 'registrationConfirmation',
    subject: '{{studentName}} is enrolled — Frisco Fencing Academy',
    preheader: 'Enrollment confirmed — here are the class details and your payment breakdown.',
    build: (v) => {
      const blocks = [
        { t: 'badge', tone: 'green', glyph: '&#10003;' },
        { t: 'eyebrow', text: 'Enrollment confirmed', tone: 'green' },
        { t: 'heading', text: `${v.studentName} is enrolled` },
        {
          t: 'text',
          html: `${strong(v.studentName)} is enrolled in ${strong(v.className)} with ${strong(v.coachName)}. Here are the details.`,
        },
        {
          t: 'card',
          tone: 'green',
          children: [
            {
              t: 'detailList',
              rows: [
                ['Class', esc(v.className)],
                ['Level', esc(v.levelName)],
                ['Coach', esc(v.coachName)],
                ['Schedule', esc(v.scheduleLabel)],
                ['Location', esc(v.locationName)],
              ],
            },
          ],
        },
        {
          t: 'breakdown',
          data: {
            monthlyFee: v.monthlyFee,
            siblingDiscountAmount: v.siblingDiscountAmount || 0,
            registrationFeeCharged: v.registrationFeeCharged || 0,
            prorated: v.prorated || false,
            totalClassDays: v.totalClassDays || 0,
            remainingClassDays: v.remainingClassDays || 0,
            total: v.chargeAmount,
          },
        },
        {
          t: 'steps',
          title: 'What happens next',
          items: [
            `First class is ${esc(v.firstClassDateLabel)}.`,
            'Your card renews automatically each month on the saved payment method.',
            'Manage or cancel any time from your parent portal.',
          ],
        },
        { t: 'button', label: 'Open your parent portal', href: ORG().portalUrl, variant: 'primary' },
      ];
      return blocks;
    },
  },

  {
    key: 'renewalReceipt',
    subject: 'Payment receipt — {{studentName}}’s {{monthLabel}} classes',
    preheader: "Your {{monthLabel}} payment went through — here's your receipt.",
    build: (v) => [
      { t: 'eyebrow', text: 'Payment receipt', tone: 'neutral' },
      { t: 'heading', text: 'Your renewal receipt' },
      { t: 'text', html: `We've processed ${v.studentName}'s ${esc(v.className)} payment for ${esc(v.monthLabel)}.` },
      {
        t: 'card',
        tone: 'neutral',
        children: [
          {
            t: 'detailList',
            rows: [
              ['Student', esc(v.studentName)],
              ['Class', esc(v.className)],
              ['Billing period', esc(v.billingPeriodLabel)],
            ],
          },
        ],
      },
      {
        t: 'breakdown',
        data: {
          monthlyFee: v.monthlyFee,
          siblingDiscountAmount: v.siblingDiscountAmount || 0,
          total: v.chargeAmount,
        },
      },
      { t: 'text', html: 'Charged to your saved card.', muted: true, size: 'sm' },
      { t: 'button', label: 'Open your parent portal', href: ORG().portalUrl, variant: 'ghost' },
    ],
  },

  {
    key: 'cancellationConfirmation',
    subject: 'Your cancellation is confirmed — Frisco Fencing Academy',
    preheader: "We've received the cancellation request for {{studentName}}'s classes.",
    build: (v) => [
      { t: 'eyebrow', text: 'Cancellation confirmed', tone: 'blue' },
      { t: 'heading', text: 'Your cancellation is confirmed' },
      {
        t: 'text',
        html: `We've received the cancellation request for ${strong(v.studentName)}'s classes. No further action is needed.`,
      },
      {
        t: 'card',
        tone: 'blue',
        children: [
          {
            t: 'detailList',
            rows: [
              ['Student', esc(v.studentName)],
              ['Class', esc(v.className)],
              ['Schedule', esc(v.scheduleLabel)],
              ['Classes continue through', esc(v.endDateLabel)],
            ],
          },
        ],
      },
      {
        t: 'text',
        html: "Per our policy, cancellations don't carry a refund or proration for the current period — access simply continues through the date above.",
        muted: true,
        size: 'sm',
      },
      {
        t: 'text',
        html: 'Changed your mind? Reactivate any time before the end date from your portal.',
        muted: true,
        size: 'sm',
      },
      { t: 'button', label: 'Open your parent portal', href: ORG().portalUrl, variant: 'ghost' },
    ],
  },

  {
    key: 'reactivationConfirmation',
    subject: "{{studentName}}'s classes will continue",
    preheader: "Good news — {{studentName}}'s classes are back on. Nothing was charged.",
    build: (v) => [
      { t: 'badge', tone: 'green', glyph: '&#10003;' },
      { t: 'eyebrow', text: 'Subscription reactivated', tone: 'green' },
      { t: 'heading', text: `${v.studentName}'s classes will continue` },
      {
        t: 'text',
        html: `The pending cancellation for ${strong(v.studentName)}'s classes has been removed — renewals continue as normal. Nothing was charged today.`,
      },
      {
        t: 'card',
        tone: 'green',
        children: [
          {
            t: 'detailList',
            rows: [
              ['Student', esc(v.studentName)],
              ['Class', esc(v.className)],
              ['Schedule', esc(v.scheduleLabel)],
              ['Next billing date', esc(v.nextBillingDateLabel)],
            ],
          },
        ],
      },
      { t: 'button', label: 'Open your parent portal', href: ORG().portalUrl, variant: 'ghost' },
    ],
  },

  {
    key: 'scheduleChangeConfirmation',
    subject: "{{studentName}}'s class schedule has been updated",
    preheader: "{{studentName}}'s class schedule has been updated.",
    build: (v) => [
      { t: 'badge', tone: 'green', glyph: '&#10003;' },
      { t: 'eyebrow', text: 'Schedule updated', tone: 'green' },
      { t: 'heading', text: `${v.studentName}'s class schedule has been updated` },
      {
        t: 'card',
        tone: 'neutral',
        children: [
          {
            t: 'detailList',
            rows: [
              ['Previous class', esc(v.previousClassName)],
              ['Previous schedule', esc(v.previousScheduleLabel)],
            ],
          },
          { t: 'divider' },
          {
            t: 'detailList',
            rows: [
              ['New class', esc(v.newClassName)],
              ['New schedule', esc(v.newScheduleLabel)],
              ['New coach', esc(v.newCoachName)],
            ],
          },
        ],
      },
      { t: 'text', html: 'Your monthly fee is unchanged.' },
      { t: 'button', label: 'Open your parent portal', href: ORG().portalUrl, variant: 'ghost' },
    ],
  },

  // Renewal/retry payment failure (docs/plans/registration-ledger-plan.md
  // D4/D6) — one template, three renderings driven by `isFinal`/
  // `attemptNumber`: Day 0 (attemptNumber 1, isFinal false), Day 1/2
  // (attemptNumber 2/3, isFinal false), and the final cancellation notice
  // (isFinal true). mail.service.js's sendPaymentFailureEmail computes
  // subjectPrefix/preheaderLine from those same two fields — no conditional
  // logic in the subject/preheader template strings themselves, matching
  // every other template's plain-string convention; the branching lives
  // here in build(), a pure function, same as the rest of this file.
  {
    key: 'paymentFailure',
    subject: "{{subjectPrefix}} — {{studentName}}'s classes",
    preheader: '{{preheaderLine}}',
    build: (v) => {
      const blocks = [
        { t: 'badge', tone: 'red', glyph: '!' },
        { t: 'eyebrow', text: v.isFinal ? 'Subscription cancelled' : 'Payment failed', tone: 'red' },
        {
          t: 'heading',
          text: v.isFinal
            ? 'Subscription cancelled after repeated payment failures'
            : 'Action needed — payment failed',
        },
        {
          t: 'card',
          tone: 'red',
          children: [
            {
              t: 'detailList',
              rows: [
                ['Student', esc(v.studentName)],
                ['Class', esc(v.className)],
                ['Amount due', esc(v.amountDueLabel)],
                ...(v.isFinal ? [] : [['Next retry', esc(v.nextRetryDateLabel)]]),
              ],
            },
          ],
        },
      ];

      if (v.isFinal) {
        blocks.push(
          {
            t: 'text',
            html: "We were unable to charge your saved card after several attempts, so this subscription has been cancelled. No further charges will be made.",
          },
          { t: 'text', html: 'You can re-register any time from your parent portal.' },
          { t: 'button', label: 'Re-register', href: ORG().portalUrl, variant: 'primary' }
        );
      } else {
        const attemptNote = v.attemptNumber > 1 ? ` (attempt ${v.attemptNumber} of ${v.maxAttempts})` : '';
        blocks.push(
          {
            t: 'text',
            html: `We couldn't charge your saved card${attemptNote}. Please update your payment method before the next retry.`,
          },
          { t: 'button', label: 'Update payment method', href: ORG().portalUrl, variant: 'primary' }
        );
      }

      return blocks;
    },
  },

  // ── Private class ─────────────────────────────────────────────────────
  {
    key: 'privateClassConfirmation',
    subject: "{{studentName}}'s private lessons with Coach {{coachName}} are confirmed",
    preheader: "{{studentName}}'s private lessons are confirmed.",
    build: (v) => [
      { t: 'badge', tone: 'green', glyph: '&#9876;' },
      { t: 'eyebrow', text: 'Private lessons confirmed', tone: 'green' },
      { t: 'heading', text: `${v.studentName}'s private lessons are confirmed` },
      {
        t: 'text',
        html: `${strong(v.studentName)}'s private lessons with ${strong(`Coach ${v.coachName}`)} are confirmed.`,
      },
      {
        t: 'card',
        tone: 'gold',
        children: [
          {
            t: 'detailList',
            rows: [
              ['Student', esc(v.studentName)],
              ['Coach', esc(v.coachName)],
              ['Slot', esc(v.slotLabel)],
              ['Rate', esc(v.rateLabel)],
              ['First session', esc(v.firstSessionDateLabel)],
            ],
          },
        ],
      },
      {
        t: 'steps',
        title: 'What happens next',
        items: [
          'Sessions recur weekly at this slot.',
          `${strong(`You're charged ${v.sessionPriceLabel}`)} after each completed session on your saved card.`,
          'Cancel any time from the portal.',
        ],
      },
      { t: 'button', label: 'Open your parent portal', href: ORG().portalUrl, variant: 'ghost' },
    ],
  },

  {
    key: 'privateClassSessionReceipt',
    subject: 'Private lesson receipt — {{studentName}}',
    preheader: "Receipt for {{studentName}}'s private lesson session.",
    build: (v) => [
      { t: 'eyebrow', text: 'Session receipt', tone: 'neutral' },
      { t: 'heading', text: 'Private lesson receipt' },
      {
        t: 'card',
        tone: 'neutral',
        children: [
          {
            t: 'detailList',
            rows: [
              ['Student', esc(v.studentName)],
              ['Coach', esc(v.coachName)],
              ['Session date', esc(v.sessionDateLabel)],
              ['Duration', esc(v.durationLabel)],
              ['Amount charged', esc(v.amountLabel)],
            ],
          },
        ],
      },
      { t: 'text', html: 'Charged to your saved card after the completed session.', muted: true, size: 'sm' },
    ],
  },

  {
    key: 'privateClassPaymentFailed',
    subject: "Action needed — payment failed for {{studentName}}'s private lesson",
    preheader: "We couldn't charge your saved card for {{studentName}}'s private lesson.",
    build: (v) => [
      { t: 'badge', tone: 'red', glyph: '!' },
      { t: 'eyebrow', text: 'Payment failed', tone: 'red' },
      { t: 'heading', text: 'Action needed — payment failed' },
      {
        t: 'card',
        tone: 'red',
        children: [
          {
            t: 'detailList',
            rows: [
              ['Student', esc(v.studentName)],
              ['Session date', esc(v.sessionDateLabel)],
              ['Amount', esc(v.amountLabel)],
            ],
          },
        ],
      },
      {
        t: 'text',
        html: "We couldn't charge your saved card. Please update your payment method — the coach can retry the charge afterward.",
      },
      { t: 'button', label: 'Update payment method', href: v.paymentMethodUrl || ORG().portalUrl, variant: 'primary' },
    ],
  },

  {
    key: 'privateClassCancellation',
    subject: 'Private lessons cancelled — {{studentName}}',
    preheader: "{{studentName}}'s private lessons have been cancelled.",
    build: (v) => [
      { t: 'eyebrow', text: 'Cancellation confirmed', tone: 'blue' },
      { t: 'heading', text: 'Private lessons cancelled' },
      {
        t: 'card',
        tone: 'blue',
        children: [
          {
            t: 'detailList',
            rows: [
              ['Student', esc(v.studentName)],
              ['Coach', esc(v.coachName)],
              ['Slot', esc(v.slotLabel)],
            ],
          },
        ],
      },
      {
        t: 'text',
        html:
          'All upcoming sessions have been removed. Completed sessions already charged are unaffected. The weekly slot is now released.',
      },
    ],
  },
];

const TEMPLATE_MAP = TEMPLATES.reduce((map, tpl) => {
  map[tpl.key] = tpl;
  return map;
}, {});

module.exports = { TEMPLATES, TEMPLATE_MAP };
