/** @type {import('next').NextConfig} */
module.exports = {
  async rewrites() {
    // Proxy API calls through the frontend's own origin so the backend's
    // httpOnly accessToken cookie is first-party in every environment.
    const backendUrl = process.env.BACKEND_URL || 'http://localhost:4000';
    return [
      { source: '/api/v1/:path*', destination: `${backendUrl}/api/v1/:path*` },
    ];
  },
};
