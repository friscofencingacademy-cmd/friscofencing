'use client';

import { Suspense, useState, type FormEvent } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import Link from 'next/link';
import axios from 'axios';

import { useAuth } from '../context/AuthContext';
import AppShell from '../components/layout/AppShell';
import Button from '../components/ui/Button/Button';
import Card from '../components/ui/Card/Card';
import Alert from '../components/ui/Alert/Alert';
import styles from '../components/ui/shared.module.css';

// useSearchParams() requires a Suspense boundary above it during static
// generation (https://nextjs.org/docs/messages/missing-suspense-with-csr-bailout)
// — without this, `next build` fails to prerender this page.
export default function RegisterPage() {
  return (
    <Suspense fallback={null}>
      <RegisterPageContent />
    </Suspense>
  );
}

function RegisterPageContent() {
  const { register } = useAuth();
  const router = useRouter();
  const searchParams = useSearchParams();
  const next = searchParams.get('next') || '/parent/dashboard';

  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setSubmitting(true);

    try {
      await register(firstName, lastName, email, password);
      router.push(next);
    } catch (err) {
      const message = axios.isAxiosError(err) && err.response?.data?.message
        ? err.response.data.message
        : 'Registration failed. Please try again.';
      setError(message);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <AppShell>
      <main>
        <div style={{ maxWidth: 400, margin: 'var(--space-6) auto' }}>
          <Card>
            <h1>Sign Up</h1>
            <p style={{ color: 'var(--color-muted)', marginTop: 0 }}>
              Free to create. You&apos;ll add your child and pick a trial class next.
            </p>
            <form onSubmit={handleSubmit}>
              <div className={styles.formField}>
                <label htmlFor="firstName" className={styles.formLabel}>
                  First Name
                </label>
                <input
                  id="firstName"
                  className={styles.formInput}
                  value={firstName}
                  onChange={(event) => setFirstName(event.target.value)}
                  required
                />
              </div>
              <div className={styles.formField}>
                <label htmlFor="lastName" className={styles.formLabel}>
                  Last Name
                </label>
                <input
                  id="lastName"
                  className={styles.formInput}
                  value={lastName}
                  onChange={(event) => setLastName(event.target.value)}
                  required
                />
              </div>
              <div className={styles.formField}>
                <label htmlFor="email" className={styles.formLabel}>
                  Email
                </label>
                <input
                  id="email"
                  type="email"
                  className={styles.formInput}
                  value={email}
                  onChange={(event) => setEmail(event.target.value)}
                  required
                />
              </div>
              <div className={styles.formField}>
                <label htmlFor="password" className={styles.formLabel}>
                  Password
                </label>
                <input
                  id="password"
                  type="password"
                  className={styles.formInput}
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
                  required
                />
              </div>
              {error ? <Alert variant="error">{error}</Alert> : null}
              <Button type="submit" fullWidth disabled={submitting}>
                {submitting ? 'Signing up...' : 'Sign Up'}
              </Button>
            </form>
            <p style={{ marginTop: 'var(--space-4)', textAlign: 'center' }}>
              Already have an account? <Link href="/login">Log in</Link>
            </p>
          </Card>
        </div>
      </main>
    </AppShell>
  );
}
