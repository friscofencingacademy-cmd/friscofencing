'use client';

import Link from 'next/link';

import { useAuth } from './context/AuthContext';

export default function HomePage() {
  const { user, loading, logout } = useAuth();

  return (
    <main>
      <h1>Frisco Fencing Academy</h1>
      <p>This site is under construction.</p>

      {loading ? (
        <p>Loading...</p>
      ) : user ? (
        <div>
          <p>Welcome, {user.firstName}</p>
          <button type="button" onClick={() => logout()}>
            Log out
          </button>
        </div>
      ) : (
        <p>
          <Link href="/login">Log in</Link>
        </p>
      )}
    </main>
  );
}
