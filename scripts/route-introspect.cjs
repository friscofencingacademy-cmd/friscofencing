// Child process for check-route-existence.mjs: loads the real Express app and
// prints every registered route as JSON between two markers. Run as a child so
// the backend's own module graph (Mongoose models, passport, the Stripe SDK
// bootstrap) loads in isolation and can never leak into the checker itself.
//
// Requiring backend/src/app.js opens no database connection — server.js and
// api/index.js own connectDB() — so this needs no MongoDB and no secrets.
//
// Usage (spawned by check-route-existence.mjs): node route-introspect.cjs <backendDir>

const path = require('path');

const START_MARKER = '@@ROUTE_JSON_START@@';
const END_MARKER = '@@ROUTE_JSON_END@@';

// Express 4 stores a mount path only as the layer's compiled RegExp, e.g.
// app.use('/api/v1/levels', router) -> /^\/api\/v1\/levels\/?(?=\/|$)/i.
// Turns that back into '/api/v1/levels'. Returns null for a RegExp this does
// not understand — the caller reports it, never silently drops the router.
function mountPathFromRegexp(regexp) {
  if (regexp.fast_slash) return '';
  const source = regexp.source
    .replace(/^\^/, '')
    .replace(/\\\/\?\(\?=\\\/\|\$\)$/, '')
    .replace(/\(\?=\\\/\|\$\)$/, '')
    .replace(/\$$/, '');
  if (/[()[\]*+?|]/.test(source.replace(/\\\//g, ''))) return null;
  return source.replace(/\\\//g, '/');
}

function main() {
  const backendDir = path.resolve(process.argv[2]);
  // eslint-disable-next-line import/no-dynamic-require, global-require
  const app = require(path.join(backendDir, 'src', 'app.js'));

  const routes = [];
  const unreadableMounts = [];

  function collect(stack, prefix) {
    for (const layer of stack) {
      if (layer.route) {
        for (const method of Object.keys(layer.route.methods)) {
          routes.push({ method, path: prefix + layer.route.path });
        }
      } else if (layer.handle && Array.isArray(layer.handle.stack)) {
        const mount = mountPathFromRegexp(layer.regexp);
        if (mount === null) {
          unreadableMounts.push(String(layer.regexp));
          continue;
        }
        collect(layer.handle.stack, prefix + mount);
      }
    }
  }

  collect(app._router.stack, '');

  process.stdout.write(`${START_MARKER}${JSON.stringify({ routes, unreadableMounts })}${END_MARKER}\n`);
  // The app module opens no handles, but a required SDK might; exit explicitly.
  process.exit(0);
}

main();
