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
 * All functions below (not plain constants) so nothing is captured at
 * module-load time — the test suite uses jest.resetModules() and toggles
 * env vars between cases (same rule Phase 1's isEmailBlocked follows).
 */

const C = {
  bg: '#FAF9F6',
  white: '#ffffff',
  panel: '#F4F2EC',
  border: '#E2E0DB',
  borderSoft: '#EEECE6',

  ink: '#1B1A17',
  soft: '#44423C',
  muted: '#6B6B63',
  muted2: '#9C9A90',

  gold: '#C8A000',
  goldHover: '#A08000',
  goldSoft: '#FBF6E3',
  goldBorder: '#EDDFA6',
  // Legible gold TEXT on goldSoft — raw gold fails contrast at small sizes.
  goldInk: '#8A6D00',

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
  "'Saira',-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif";

// null -> the layout renders a styled text wordmark instead of an <img>.
const LOGO_URL = () => process.env.LOGO_URL || null;

const ORG = () => ({
  name: 'Frisco Fencing Academy',
  fromEmail: process.env.MAIL_FROM_ADDRESS || 'noreply@friscofencing.local',
  supportEmail: process.env.ADMIN_EMAIL || 'friscofencingacademy@gmail.com',
  portalUrl: `${process.env.FRONTEND_URL || 'http://localhost:3000'}/parent/dashboard`,
});

module.exports = { C, FONT, LOGO_URL, ORG };
