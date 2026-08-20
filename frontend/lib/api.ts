import axios from 'axios';

// Default path goes through the Next.js rewrite proxy configured in
// next.config.js, so requests stay same-origin and the backend's httpOnly
// `accessToken` cookie is always first-party. NEXT_PUBLIC_API_URL remains
// an escape hatch for pointing directly at a backend (e.g. no rewrite proxy
// available in that environment). withCredentials is still required so the
// cookie round-trips whichever path is in effect.
const api = axios.create({
  baseURL: process.env.NEXT_PUBLIC_API_URL || '/api/v1',
  withCredentials: true,
});

export default api;
