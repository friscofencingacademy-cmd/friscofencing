import axios from 'axios';

// Every call goes through the Next.js rewrite proxy configured in
// next.config.js (BACKEND_URL, server-side only), so requests stay
// same-origin and the backend's httpOnly `accessToken` cookie is always
// first-party. There is deliberately no override: the browser never calls
// the backend origin directly (CLAUDE.md), and frontendEnvGuard keeps
// build-time public variables out of the bundle. withCredentials keeps the
// cookie round-tripping.
const api = axios.create({
  baseURL: '/api/v1',
  withCredentials: true,
});

export default api;
