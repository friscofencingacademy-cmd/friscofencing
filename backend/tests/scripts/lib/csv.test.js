const { parseCsv } = require('../../../scripts/lib/csv');

describe('scripts/lib/csv', () => {
  describe('parseCsv', () => {
    it('parses a simple header + rows', () => {
      const text = 'First Name,Last Name\nAda,Lovelace\nAlan,Turing';

      expect(parseCsv(text)).toEqual([
        { 'First Name': 'Ada', 'Last Name': 'Lovelace' },
        { 'First Name': 'Alan', 'Last Name': 'Turing' },
      ]);
    });

    it('handles a quoted field containing a comma', () => {
      const text = 'Name,Address\nAda,"123 Main St, Frisco, TX"';

      expect(parseCsv(text)).toEqual([{ Name: 'Ada', Address: '123 Main St, Frisco, TX' }]);
    });

    it('handles a doubled quote as an escaped literal quote inside a quoted field', () => {
      const text = 'Name,Note\nAda,"Height: 5 \'\' 7 \"\"; Weight: 100"';

      expect(parseCsv(text)[0].Note).toBe('Height: 5 \'\' 7 "; Weight: 100');
    });

    it('pads a short row with empty strings instead of dropping fields', () => {
      const text = 'A,B,C\n1,2';

      expect(parseCsv(text)).toEqual([{ A: '1', B: '2', C: '' }]);
    });

    it('skips blank lines', () => {
      const text = 'A,B\n1,2\n\n3,4\n';

      expect(parseCsv(text)).toEqual([
        { A: '1', B: '2' },
        { A: '3', B: '4' },
      ]);
    });

    it('returns an empty array for an empty string', () => {
      expect(parseCsv('')).toEqual([]);
    });

    it('handles a field that is entirely blank between commas', () => {
      const text = 'A,B,C\n1,,3';

      expect(parseCsv(text)).toEqual([{ A: '1', B: '', C: '3' }]);
    });
  });
});
