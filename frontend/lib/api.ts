import axios from 'axios';

// withCredentials is required so the httpOnly `accessToken` cookie set by
// the backend round-trips on cross-port requests in local dev
// (frontend :3000 -> backend :4000).
const api = axios.create({
  baseURL: process.env.NEXT_PUBLIC_API_URL,
  withCredentials: true,
});

export default api;
