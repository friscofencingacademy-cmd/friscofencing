'use client';

import { useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import axios from 'axios';

import api from '../../../../lib/api';
import { formatDateOnly } from '../../../../lib/formatDate';
import { fetchLevels } from '../../../../lib/services/catalog';
import { createEvaluation } from '../../../../lib/services/evaluation';
import type { GroupClassSessionDetail, Level } from '../../../../lib/types';
import ProtectedRoute from '../../../components/ProtectedRoute';
import AppShell from '../../../components/layout/AppShell';
import Button from '../../../components/ui/Button/Button';
import Card from '../../../components/ui/Card/Card';
import Alert from '../../../components/ui/Alert/Alert';
import styles from '../../../components/ui/shared.module.css';

function AttendancePageContent() {
  const params = useParams<{ id: string }>();
  const sessionId = params.id;

  const [session, setSession] = useState<GroupClassSessionDetail | null>(null);
  const [attendance, setAttendance] = useState<Record<string, boolean>>({});
  const [levels, setLevels] = useState<Level[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  // Which student's Evaluate form is open, plus that form's own local
  // state — only one can be open at a time.
  const [evaluatingStudentId, setEvaluatingStudentId] = useState<string | null>(null);
  const [evalLevelId, setEvalLevelId] = useState('');
  const [evalNotes, setEvalNotes] = useState('');
  const [evalSaving, setEvalSaving] = useState(false);
  const [evalError, setEvalError] = useState<string | null>(null);
  const [evaluatedStudentIds, setEvaluatedStudentIds] = useState<Set<string>>(new Set());

  async function fetchSession() {
    const res = await api.get<{ session: GroupClassSessionDetail }>(`/group-class-sessions/${sessionId}`);
    setSession(res.data.session);

    const initialAttendance: Record<string, boolean> = {};
    res.data.session.students.forEach((entry) => {
      initialAttendance[entry.studentId._id] = entry.isPresent;
    });
    setAttendance(initialAttendance);
  }

  useEffect(() => {
    let isMounted = true;

    async function load() {
      setLoading(true);
      try {
        await fetchSession();
        const levelList = await fetchLevels();
        if (isMounted) setLevels(levelList);
      } catch (err) {
        if (isMounted) {
          setError('Failed to load session.');
        }
      } finally {
        if (isMounted) {
          setLoading(false);
        }
      }
    }

    load();

    return () => {
      isMounted = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- fetchSession
    // closes over sessionId, which is already the effect's real dependency.
  }, [sessionId]);

  function toggleStudent(studentId: string) {
    setAttendance((previous) => ({ ...previous, [studentId]: !previous[studentId] }));
  }

  async function handleSave() {
    setSaving(true);
    setError(null);
    setMessage(null);

    try {
      await api.patch(`/group-class-sessions/${sessionId}/attendance`, {
        students: Object.entries(attendance).map(([studentId, isPresent]) => ({
          studentId,
          isPresent,
        })),
      });
      setMessage('Attendance saved.');
      // Re-fetch: a trial student just toggled present needs their
      // classType/isPresent refreshed before the Evaluate action can show
      // for them (the Visit backing this only settles server-side).
      await fetchSession();
    } catch (err) {
      const responseMessage =
        axios.isAxiosError(err) && err.response?.data?.message
          ? err.response.data.message
          : 'Failed to save attendance.';
      setError(responseMessage);
    } finally {
      setSaving(false);
    }
  }

  function openEvaluate(studentId: string) {
    setEvaluatingStudentId(studentId);
    setEvalLevelId('');
    setEvalNotes('');
    setEvalError(null);
  }

  function closeEvaluate() {
    setEvaluatingStudentId(null);
  }

  async function handleSubmitEvaluation() {
    if (!evaluatingStudentId || !session) return;

    setEvalSaving(true);
    setEvalError(null);

    const result = await createEvaluation({
      studentId: evaluatingStudentId,
      groupClassSessionId: session._id,
      assignedLevelId: evalLevelId,
      notes: evalNotes,
    });

    setEvalSaving(false);

    if (result.status === 'success') {
      setEvaluatedStudentIds((previous) => new Set(previous).add(evaluatingStudentId));
      setEvaluatingStudentId(null);
    } else {
      setEvalError(result.message);
    }
  }

  return (
    <main>
      <div className={styles.pageHeader}>
        <h1 className={styles.pageTitle}>Mark Attendance</h1>
      </div>

      {error ? (
        <div style={{ marginBottom: 'var(--space-4)' }}>
          <Alert variant="error">{error}</Alert>
        </div>
      ) : null}
      {message ? (
        <div style={{ marginBottom: 'var(--space-4)' }}>
          <Alert variant="success">{message}</Alert>
        </div>
      ) : null}

      {loading ? (
        <p>Loading...</p>
      ) : session?.isHoliday ? (
        <Card>
          <Alert variant="error">
            This session falls on {session.holidayName} — attendance is disabled.
          </Alert>
        </Card>
      ) : session?.attendanceOpen === false ? (
        // Attendance opens on the session's own day (docs/plans/duplication-
        // cleanup-plan.md A-D1). Blocked ONLY on an explicit `false` — absent
        // means open, same permissive default as isHoliday. Display-only: the
        // backend's 400 is the real enforcement.
        <Card>
          <Alert variant="error">
            Attendance opens on {formatDateOnly(session.date)} — it can&apos;t be marked before the session&apos;s day.
          </Alert>
        </Card>
      ) : session ? (
        <Card>
          <table className={styles.table}>
            <tbody>
              {session.students.map((entry) => {
                const studentId = entry.studentId._id;
                // Evaluate only ever offered for a trial row already
                // persisted as present (entry.isPresent reflects the last
                // save, not the in-progress checkbox toggle) — matches
                // evaluation.service.js's own "must be an attended trial
                // Visit" requirement.
                const canEvaluate = entry.classType === 'trial' && entry.isPresent;
                const alreadyEvaluated = evaluatedStudentIds.has(studentId);

                return (
                  <tr key={studentId}>
                    <td>
                      <label>
                        <input
                          type="checkbox"
                          checked={attendance[studentId] ?? false}
                          onChange={() => toggleStudent(studentId)}
                        />{' '}
                        {entry.studentId.firstName} {entry.studentId.lastName}
                      </label>
                    </td>
                    <td style={{ textAlign: 'right' }}>
                      {canEvaluate ? (
                        alreadyEvaluated ? (
                          <span style={{ color: 'var(--color-text-muted)' }}>Evaluated</span>
                        ) : (
                          <Button
                            type="button"
                            size="sm"
                            variant="secondary"
                            onClick={() => openEvaluate(studentId)}
                          >
                            Evaluate
                          </Button>
                        )
                      ) : null}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          <div style={{ marginTop: 'var(--space-4)' }}>
            <Button type="button" onClick={handleSave} disabled={saving}>
              {saving ? 'Saving...' : 'Save Attendance'}
            </Button>
          </div>

          {evaluatingStudentId ? (
            <div style={{ marginTop: 'var(--space-4)' }}>
              <Card>
                {evalError ? <Alert variant="error">{evalError}</Alert> : null}
                <label>
                  Recommended level
                  <select
                    aria-label="Recommended level"
                    value={evalLevelId}
                    onChange={(e) => setEvalLevelId(e.target.value)}
                    required
                  >
                    <option value="">Select a level</option>
                    {levels.map((level) => (
                      <option key={level._id} value={level._id}>
                        {level.name}
                      </option>
                    ))}
                  </select>
                </label>
                <label style={{ display: 'block', marginTop: 'var(--space-3)' }}>
                  Notes
                  <textarea
                    aria-label="Evaluation notes"
                    value={evalNotes}
                    onChange={(e) => setEvalNotes(e.target.value)}
                    required
                  />
                </label>
                <div style={{ marginTop: 'var(--space-3)' }}>
                  <Button
                    type="button"
                    onClick={handleSubmitEvaluation}
                    disabled={evalSaving || !evalLevelId || !evalNotes}
                  >
                    {evalSaving ? 'Saving...' : 'Save Evaluation'}
                  </Button>{' '}
                  <Button type="button" variant="secondary" onClick={closeEvaluate}>
                    Cancel
                  </Button>
                </div>
              </Card>
            </div>
          ) : null}
        </Card>
      ) : null}
    </main>
  );
}

export default function AttendancePage() {
  return (
    <ProtectedRoute allowedRoles={['admin', 'superadmin', 'coach']}>
      <AppShell>
        <AttendancePageContent />
      </AppShell>
    </ProtectedRoute>
  );
}
