import AxeBuilder from '@axe-core/playwright';
import { expect, type Page } from '@playwright/test';

// The one accessibility assertion every E2E scan uses (docs/TESTING_STRATEGY.md,
// E2E): only serious/critical axe violations fail; moderate/minor do not.
// Call it once the page has settled (a heading or other content is visible).

type AxeViolation = Awaited<ReturnType<AxeBuilder['analyze']>>['violations'][number];

// The ONE known, accepted finding (docs/TESTING_STRATEGY.md "Known, accepted
// accessibility findings"): the admin sidebar's brand-role and section-label
// text is #787f86 on --sidebar-bg, 4.28:1 against the 4.5:1 AA floor — a
// colour decision for docs/design-system.md, not yet made. It is ratcheted by
// NODE, never by rule id: a contrast failure on any other element, or any
// other rule, still fails (a rule-id-wide allowlist once hid a second finding
// on the home page). CSS-module classes keep their local name as the prefix.
const KNOWN_ADMIN_SIDEBAR_CONTRAST = /class="layout_(brandRole|sectionLabel)__/;

function isKnownFinding(violation: AxeViolation): boolean {
  return (
    violation.id === 'color-contrast' && violation.nodes.every((node) => KNOWN_ADMIN_SIDEBAR_CONTRAST.test(node.html))
  );
}

export async function expectNoBlockingA11yViolations(page: Page): Promise<void> {
  const results = await new AxeBuilder({ page }).analyze();
  const blocking = results.violations
    .filter((violation) => violation.impact === 'serious' || violation.impact === 'critical')
    .filter((violation) => !isKnownFinding(violation));

  expect(blocking, JSON.stringify(blocking, null, 2)).toEqual([]);
}
