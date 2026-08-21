'use client';

import { useState } from 'react';
import Link from 'next/link';

import { useParentPortal } from '../../context/ParentPortalContext';
import { getErrorMessage } from '../../../lib/hooks/useLoadState';
import Button from '../../components/ui/Button/Button';
import Card from '../../components/ui/Card/Card';
import LoadError from '../../components/ui/LoadError/LoadError';
import AddChildModal from '../../components/portal/AddChildModal';
import styles from '../../components/ui/shared.module.css';

export default function ChildrenPage() {
  const { students, loading, error, reload } = useParentPortal();
  const [addChildOpen, setAddChildOpen] = useState(false);

  return (
    <main>
      <div className={styles.pageHeader}>
        <h1 className={styles.pageTitle}>My Children</h1>
      </div>

      <div style={{ marginBottom: 'var(--space-4)' }}>
        <Card>
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              gap: 'var(--space-3)',
              flexWrap: 'wrap',
            }}
          >
            <p style={{ margin: 0 }}>Ready to try a class? Book a free trial for your child.</p>
            <Button as="a" href="/parent/book-trial" size="sm">
              Book a Free Trial
            </Button>
          </div>
        </Card>
      </div>

      {error ? (
        <LoadError message={getErrorMessage(error)} onRetry={reload} />
      ) : loading ? (
        <p>Loading...</p>
      ) : (
        <Card>
          <table className={styles.table}>
            <thead>
              <tr>
                <th>First Name</th>
                <th>Last Name</th>
                <th>Skill Level</th>
              </tr>
            </thead>
            <tbody>
              {students.map((student) => (
                <tr key={student._id}>
                  <td>
                    <Link href={`/parent/child/${student._id}`}>{student.firstName}</Link>
                  </td>
                  <td>{student.lastName}</td>
                  <td>{student.skillLevel}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      )}

      <div style={{ marginTop: 'var(--space-5)' }}>
        <Button type="button" onClick={() => setAddChildOpen(true)}>
          Add Child
        </Button>
      </div>

      {addChildOpen ? (
        <AddChildModal
          onClose={() => setAddChildOpen(false)}
          onSuccess={() => {
            setAddChildOpen(false);
            reload();
          }}
        />
      ) : null}
    </main>
  );
}
