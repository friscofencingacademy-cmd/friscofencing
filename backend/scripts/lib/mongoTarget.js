// Which database a MongoDB connection string actually targets — checked
// BEFORE a script connects (docs/plans/audit-and-health-refresh-plan.md §9,
// "explicit database" follow-up).
//
// Found 2026-10-26 while setting the scheduled jobs' secrets: a URI with no
// database in its path (`mongodb+srv://…@cluster0.x.mongodb.net/`) is valid,
// and the driver silently uses a database named `test`. A script pointed at
// such a URI would have written to, or reported on, `test` while saying it
// had worked. Every script that writes or reports per environment refuses
// one, and can be told which database it must be.

// The two real databases (CLAUDE.md, Deployment & Environments).
const KNOWN_DATABASES = {
  production: 'friscofencing',
  staging: 'friscofencing-staging',
};

/**
 * The database named in a mongodb:// or mongodb+srv:// URI's path, '' when
 * it names none, or null when the string is not a MongoDB URI at all.
 */
function databaseNameOf(uri) {
  const match = /^mongodb(?:\+srv)?:\/\/(?:[^@/]*@)?[^/?]+(?:\/([^?]*))?(?:\?.*)?$/.exec(uri || '');

  if (!match) return null;

  return decodeURIComponent(match[1] || '');
}

/**
 * Returns the database name, or throws when the URI is not a MongoDB URI,
 * names no database, or (with `expected`) names a different one.
 */
function assertExplicitDatabase(uri, { expected } = {}) {
  const name = databaseNameOf(uri);

  if (name === null) {
    throw new Error('The connection string is not a mongodb:// or mongodb+srv:// URI.');
  }

  if (name === '') {
    throw new Error(
      'The connection string names no database, so MongoDB would silently use "test". ' +
        `Add the database to its path, e.g. …mongodb.net/${KNOWN_DATABASES.production}`
    );
  }

  if (expected && name !== expected) {
    throw new Error(`The connection string targets database "${name}", expected "${expected}".`);
  }

  return name;
}

module.exports = { KNOWN_DATABASES, databaseNameOf, assertExplicitDatabase };
