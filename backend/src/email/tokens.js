'use strict';

/**
 * Email design tokens — the Frisco Fencing Academy design system frozen to
 * literal hex + a system-safe font stack.
 *
 * WHY FROZEN: email clients do not support CSS custom properties (var()),
 * @import, or web fonts reliably. Every value below is the resolved value of
 * a design-system.md token. If the palette in globals.css ever changes,
 * mirror the change here too — this is the ONE other place colors live for
 * email.
 *
 * Rebranded 2026-08-29 alongside globals.css (navy/crimson replace
 * ink/gold — docs/plans/wordpress-ui-alignment-plan.md, Phase 1). The `gold*`
 * key names are kept as-is rather than renamed to `accent*`: every call
 * site in layout.js/templates.js references these keys, a rename would
 * touch all of them for no behavioral gain, and this module isn't in that
 * plan's reviewed scope — only the mirrored values are. `goldInk` (a
 * separate darker shade gold needed because raw gold failed contrast at
 * small sizes) collapses to the same value as `gold` — crimson passes
 * contrast on white/goldSoft directly (~5.8-6.7:1), no separate ink shade
 * needed.
 *
 * All functions below (not plain constants) so nothing is captured at
 * module-load time — the test suite uses jest.resetModules() and toggles
 * env vars between cases (same rule Phase 1's isEmailBlocked follows).
 */

const C = {
  bg: '#F9F7F4',
  white: '#ffffff',
  panel: '#F4F2EC',
  border: '#E2E0DB',
  borderSoft: '#EEECE6',

  ink: '#0E1B2A',
  soft: '#44423C',
  muted: '#6B6B63',
  muted2: '#9C9A90',

  gold: '#B51726',
  goldHover: '#8F131C',
  goldSoft: '#FBEAEA',
  goldBorder: '#E8C2C6',
  goldInk: '#B51726',

  green: '#0e9f6e',
  greenSoft: '#f0fdf4',
  greenBorder: '#bbf7d0',

  red: '#dc2626',
  redSoft: '#fef2f2',
  redBorder: '#fecaca',

  blue: '#1565c0',
  blueSoft: '#eff6ff',
  blueBorder: '#dbeafe',
};

const FONT =
  "'Inter',-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif";

// null -> the layout renders a styled text wordmark instead of an <img>.
const LOGO_URL = () => process.env.LOGO_URL || null;

const ORG = () => ({
  name: 'Frisco Fencing Academy',
  fromEmail: process.env.MAIL_FROM_ADDRESS || 'noreply@friscofencing.local',
  supportEmail: process.env.ADMIN_EMAIL || 'friscofencingacademy@gmail.com',
  portalUrl: `${process.env.FRONTEND_URL || 'http://localhost:3000'}/parent/dashboard`,
});

module.exports = { C, FONT, LOGO_URL, ORG };
