const { KNOWN_DATABASES, databaseNameOf, assertExplicitDatabase } = require('../../../scripts/lib/mongoTarget');

// Synthetic URIs only — never a real credential.
const HOST = 'mongodb+srv://user:p%40ss@cluster0.example.mongodb.net';

describe('scripts/lib/mongoTarget', () => {
  describe('databaseNameOf', () => {
    it.each([
      [`${HOST}/friscofencing`, 'friscofencing'],
      [`${HOST}/friscofencing-staging?retryWrites=true&w=majority`, 'friscofencing-staging'],
      ['mongodb://localhost:27017/frisco-local', 'frisco-local'],
      ['mongodb://h1:27017,h2:27017/friscofencing?replicaSet=rs0', 'friscofencing'],
      [`${HOST}/`, ''],
      [HOST, ''],
      [`${HOST}/?retryWrites=true`, ''],
    ])('%s -> %j', (uri, expected) => {
      expect(databaseNameOf(uri)).toBe(expected);
    });

    it('returns null for anything that is not a MongoDB URI', () => {
      expect(databaseNameOf('https://example.com/friscofencing')).toBeNull();
      expect(databaseNameOf('')).toBeNull();
      expect(databaseNameOf(undefined)).toBeNull();
    });
  });

  describe('assertExplicitDatabase', () => {
    it('returns the database name when one is present', () => {
      expect(assertExplicitDatabase(`${HOST}/friscofencing`)).toBe('friscofencing');
    });

    it('refuses a URI with no database — the driver would silently use "test"', () => {
      expect(() => assertExplicitDatabase(`${HOST}/`)).toThrow('names no database, so MongoDB would silently use "test"');
      expect(() => assertExplicitDatabase(`${HOST}/?retryWrites=true`)).toThrow('names no database');
    });

    it('refuses a non-MongoDB string', () => {
      expect(() => assertExplicitDatabase('not a uri')).toThrow('not a mongodb:// or mongodb+srv:// URI');
    });

    it('refuses a different database than the expected one', () => {
      expect(() => assertExplicitDatabase(`${HOST}/friscofencing-staging`, { expected: KNOWN_DATABASES.production })).toThrow(
        'targets database "friscofencing-staging", expected "friscofencing"'
      );
      expect(assertExplicitDatabase(`${HOST}/friscofencing`, { expected: KNOWN_DATABASES.production })).toBe('friscofencing');
    });

    it('never echoes credentials in its errors', () => {
      expect(() => assertExplicitDatabase(`${HOST}/`)).toThrow(expect.objectContaining({ message: expect.not.stringContaining('p%40ss') }));
    });
  });
});
