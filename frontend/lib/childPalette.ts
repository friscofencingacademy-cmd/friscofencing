// Deterministic per-child avatar palette — assigned by index (1st child,
// 2nd child, ...) so a given household always sees the same colors across
// sessions. Four gold/ink-harmonious pairs, never CKQ's own blue/purple/etc
// palette values (see docs/plans/ckq-ui-adoption-plan.md §1 brand table).
export interface ChildPalette {
  /** CSS gradient for the avatar background. */
  gradient: string;
  /** A representative solid color — used for active-state accents (e.g. a left border). */
  text: string;
}

const PALETTES: ChildPalette[] = [
  { gradient: 'linear-gradient(135deg, #C8A000, #E6C34D)', text: '#C8A000' }, // gold
  { gradient: 'linear-gradient(135deg, #1B1A17, #4A4844)', text: '#1B1A17' }, // ink
  { gradient: 'linear-gradient(135deg, #8C6B1F, #C8A000)', text: '#8C6B1F' }, // bronze
  { gradient: 'linear-gradient(135deg, #4A4844, #C8A000)', text: '#4A4844' }, // charcoal-gold
];

export function getChildPalette(index: number): ChildPalette {
  return PALETTES[index % PALETTES.length];
}
