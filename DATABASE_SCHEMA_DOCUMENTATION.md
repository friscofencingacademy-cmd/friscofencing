# Database Schema — Frisco Fencing Academy

Planned schema — not yet implemented. Filled in with real fields as each model is built.

| Collection | Purpose |
|---|---|
| `User` | All 5 roles. Students have `parentId` (ref `User`) and a skill-level field. No chess-specific fields. |
| `Location` | Address/timezone for a physical training location. |
| `Level` | Skill-level lookup (beginner/intermediate/advanced). |
| `GroupClass` | A class offering — name, level ref, location ref, capacity, price ref. |
| `GroupClassSchedule` | A recurring weekly slot for a class — coach, day/time, roster. |
| `GroupClassSession` | One dated occurrence of a schedule — embeds `students[].isPresent` for attendance. |
| `Price` | Rate card by class/level. |
| `TrialClass` | Free one-time trial booking — no payment. |
| `PaymentMethod` | A parent's saved card (Stripe Customer + PaymentMethod IDs). |
| `Registration` | The enrollment record — student, class/schedule ref, status. |
| `Subscription` | Recurring billing state — status, current period, next billing date, `cancelAtPeriodEnd`, sibling-discount fields. |
| `WebhookEvent` | Dedup log of processed Stripe webhook event IDs. |
