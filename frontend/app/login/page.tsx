'use client';

import { useState, type FormEvent } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import axios from 'axios';

import { useAuth } from '../context/AuthContext';
import AppShell from '../components/layout/AppShell';
import Button from '../components/ui/Button/Button';
import Card from '../components/ui/Card/Card';
import Alert from '../components/ui/Alert/Alert';
import styles from '../components/ui/shared.module.css';

export default function LoginPage() {
  const { login } = useAuth();
  const router = useRouter();

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setSubmitting(true);

    try {
      await login(email, password);
      router.push('/');
    } catch (err) {
      const message = axios.isAxiosError(err) && err.response?.data?.message
        ? err.response.data.message
        : 'Login failed. Please try again.';
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
            <h1>Log In</h1>
            <form onSubmit={handleSubmit}>
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
                {submitting ? 'Logging in...' : 'Log In'}
              </Button>
            </form>
            <p style={{ marginTop: 'var(--space-4)', textAlign: 'center' }}>
              Don&apos;t have an account? <Link href="/register">Register</Link>
            </p>
          </Card>
        </div>
      </main>
    </AppShell>
  );
}
