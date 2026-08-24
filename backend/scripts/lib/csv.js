// A small RFC 4180 CSV parser — no dependency added for a one-off migration
// script. Handles what the legacy Kicksite export actually uses: quoted
// fields containing commas, and doubled `""` as an escaped literal quote
// inside a quoted field (e.g. `"Height: 5 ' 7 ""; Weight: 187.00"`). Does
// NOT handle a raw newline inside a quoted field — not present in the
// source export, and not worth the added complexity for a script that only
// ever reads this one known shape.
function parseCsvLine(line) {
  const fields = [];
  let current = '';
  let inQuotes = false;

  for (let i = 0; i < line.length; i += 1) {
    const char = line[i];

    if (inQuotes) {
      if (char === '"') {
        if (line[i + 1] === '"') {
          current += '"';
          i += 1;
        } else {
          inQuotes = false;
        }
      } else {
        current += char;
      }
    } else if (char === '"') {
      inQuotes = true;
    } else if (char === ',') {
      fields.push(current);
      current = '';
    } else {
      current += char;
    }
  }

  fields.push(current);
  return fields;
}

// Parses a full CSV string (header row + data rows) into an array of plain
// objects keyed by the header row. Blank lines are skipped. A short data
// row (fewer fields than headers) pads the remainder with '' rather than
// throwing — the 2026-08-23 export's trailing blank line parses to a single
// empty field, which this silently drops instead of producing a bogus row.
function parseCsv(text) {
  const lines = text.split(/\r\n|\n|\r/).filter((line) => line.length > 0);

  if (lines.length === 0) {
    return [];
  }

  const headers = parseCsvLine(lines[0]);

  return lines.slice(1).map((line) => {
    const values = parseCsvLine(line);
    const row = {};

    headers.forEach((header, index) => {
      row[header] = values[index] !== undefined ? values[index] : '';
    });

    return row;
  });
}

module.exports = { parseCsv };
