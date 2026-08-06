// Plain require() calls (not `import`) are deliberate here: `import`
// statements are hoisted above all other code in the module regardless of
// source order, but `undici`'s own module top-level code needs
// global.TextEncoder/TextDecoder to already exist when IT loads. require()
// runs exactly where it's written, so the polyfill assignments below happen
// before undici is loaded.
require('@testing-library/jest-dom');

const { TextEncoder, TextDecoder } = require('util');

// jest-environment-jsdom builds an isolated global scope that has none of
// the fetch-family primitives Node's real global object has (fetch,
// Request, Response, Headers, FormData) nor TextEncoder/TextDecoder — but
// msw's underlying @mswjs/interceptors library needs all of these to
// inspect and match request/response bodies. Standard polyfill for
// MSW + Jest + jsdom (see mswjs.io troubleshooting docs).
if (typeof global.TextEncoder === 'undefined') {
  global.TextEncoder = TextEncoder;
}
if (typeof global.TextDecoder === 'undefined') {
  global.TextDecoder = TextDecoder;
}

const { ReadableStream, TransformStream } = require('stream/web');

if (typeof global.ReadableStream === 'undefined') {
  global.ReadableStream = ReadableStream;
}
if (typeof global.TransformStream === 'undefined') {
  global.TransformStream = TransformStream;
}

// `undici` is the same fetch implementation Node itself bundles natively —
// used here only because jest-environment-jsdom doesn't expose it.
const { fetch, Headers, Request, Response, FormData } = require('undici');

if (typeof global.fetch === 'undefined') {
  global.fetch = fetch;
  global.Headers = Headers;
  global.Request = Request;
  global.Response = Response;
  global.FormData = FormData;
}

// msw uses BroadcastChannel internally to coordinate across tabs/workers —
// jsdom doesn't implement it, but Node does (via worker_threads).
const { BroadcastChannel } = require('worker_threads');

if (typeof global.BroadcastChannel === 'undefined') {
  global.BroadcastChannel = BroadcastChannel;
}
