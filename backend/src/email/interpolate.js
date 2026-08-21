'use strict';

/**
 * {{var}} substitution for subject / preheader lines at render time.
 *
 * Block bodies do NOT use this — build(data) injects real values directly.
 * Only the subject and preheader strings may carry {{tokens}}, filled from
 * the same data object. An unresolved token is left in place (and warned)
 * so a missing variable is visible in QA rather than silently blank.
 */

function get(obj, path) {
  return path.split('.').reduce((o, k) => (o == null ? undefined : o[k]), obj);
}

function interpolate(str, data) {
  if (typeof str !== 'string') return str;

  return str.replace(/\{\{\s*([\w.$]+)\s*\}\}/g, (full, path) => {
    const value = get(data, path);

    if (value === undefined || value === null) {
      // eslint-disable-next-line no-console -- operational QA visibility for
      // a template/data mismatch, not debug output.
      console.warn(`[email] unresolved variable in subject/preheader: {{${path}}}`);
      return full;
    }

    return String(value);
  });
}

module.exports = { interpolate, get };
