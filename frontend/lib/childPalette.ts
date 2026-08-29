// Deterministic per-child avatar palette — assigned by index (1st child,
// 2nd child, ...) so a given household always sees the same colors across
// sessions. Four navy/crimson-harmonious pairs (rebranded 2026-08-29,
// docs/plans/wordpress-ui-alignment-plan.md), never CKQ's own blue/purple/
// etc palette values (see docs/plans/ckq-ui-adoption-plan.md §1 brand table).
export interface ChildPalette {
  /** CSS gradient for the avatar background. */
  gradient: string;
  /** A representative solid color — used for active-state accents (e.g. a left border). */
  text: string;
}

const PALETTES: ChildPalette[] = [
  { gradient: 'linear-gradient(135deg, #16324F, #0E1B2A)', text: '#16324F' }, // navy
  { gradient: 'linear-gradient(135deg, #B51726, #7C0F1B)', text: '#B51726' }, // crimson
  { gradient: 'linear-gradient(135deg, #55606C, #2A2D32)', text: '#55606C' }, // slate
  { gradient: 'linear-gradient(135deg, #C96A74, #9E3D48)', text: '#C96A74' }, // dusty rose
];

export function getChildPalette(index: number): ChildPalette {
  return PALETTES[index % PALETTES.length];
}
