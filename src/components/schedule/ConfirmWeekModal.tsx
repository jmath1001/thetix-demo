"use client";

import { useState, useMemo } from 'react';
import { X, Check, Loader2, Mail } from 'lucide-react';
import { toISODate, getWeekDates, type Tutor } from '@/lib/useScheduleData';
import { formatWeekRange } from './scheduleConstants';

interface ConfirmWeekModalProps {
  weekStart: Date;
  tutors: Tutor[];
  sessions: any[];
  weekConfirmedAt: string | null;
  onConfirmed: (confirmedAt: string) => void;
  onClose: () => void;
}

type SendResult = {
  sent: number;
  failed: number;
  errors: string[];
  mode?: string;
  redirectedTo?: string | null;
  skipped?: boolean;
  reason?: string;
};

function fmt12(time: string): string {
  const [hStr, mStr] = time.split(':');
  const h = Number(hStr);
  const suffix = h >= 12 ? 'PM' : 'AM';
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return `${h12}:${mStr} ${suffix}`;
}

function fmtShortDate(iso: string): string {
  return new Date(iso + 'T00:00:00').toLocaleDateString('en-US', {
    weekday: 'short', month: 'short', day: 'numeric',
  });
}

export function ConfirmWeekModal({
  weekStart,
  tutors,
  sessions,
  weekConfirmedAt,
  onConfirmed,
  onClose,
}: ConfirmWeekModalProps) {
  const [sending, setSending] = useState(false);
  const [localConfirmedAt, setLocalConfirmedAt] = useState<string | null>(null);
  const [sendResult, setSendResult] = useState<SendResult | null>(null);

  const weekDateIsos = useMemo(
    () => getWeekDates(weekStart).map(d => toISODate(d)),
    [weekStart]
  );

  const weekSessions = useMemo(
    () => sessions.filter(s => weekDateIsos.includes(s.date)),
    [sessions, weekDateIsos]
  );

  const tutorBreakdown = useMemo(() => {
    return tutors
      .map(tutor => ({
        tutor,
        slots: weekSessions
          .filter(s => s.tutorId === tutor.id)
          .map(s => ({
            date: s.date,
            time: s.time,
            activeStudents: (s.students ?? []).filter((st: any) => st.status !== 'cancelled'),
          }))
          .sort((a, b) => a.date.localeCompare(b.date) || a.time.localeCompare(b.time)),
      }))
      .filter(tb => tb.slots.length > 0);
  }, [tutors, weekSessions]);

  const totalSessions = weekSessions.length;
  const totalSlots = weekSessions.reduce(
    (sum, s) => sum + (s.students ?? []).filter((st: any) => st.status !== 'cancelled').length,
    0
  );
  const tutorsWithEmail = tutors.filter(t => !!t.email);

  const confirmedAt = localConfirmedAt ?? weekConfirmedAt;
  const isConfirmed = !!confirmedAt;

  const handleConfirm = () => {
    const ts = new Date().toISOString();
    const key = `week-confirmed-${toISODate(weekStart)}`;
    try { localStorage.setItem(key, ts); } catch {}
    setLocalConfirmedAt(ts);
    onConfirmed(ts);
  };

  const handleSend = async () => {
    setSending(true);
    setSendResult(null);
    try {
      const ids = tutorsWithEmail.map(t => t.id);
      const res = await fetch('/api/send-tutor-schedule', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tutorIds: ids, mode: 'weekly', date: toISODate(weekStart) }),
      });
      const data = await res.json();
      setSendResult(data);
    } catch (e: any) {
      setSendResult({ sent: 0, failed: 0, errors: [e?.message ?? 'Unknown error'] });
    } finally {
      setSending(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center p-4 sm:items-center"
      style={{ background: 'rgba(15,23,42,0.6)', backdropFilter: 'blur(6px)' }}
      onClick={e => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div
        className="w-full max-w-lg rounded-2xl overflow-hidden flex flex-col"
        style={{
          background: 'white',
          border: '1px solid #e0e7ff',
          boxShadow: '0 24px 64px rgba(15,23,42,0.22)',
          maxHeight: '90dvh',
        }}
        onClick={e => e.stopPropagation()}
      >
        {/* Header */}
        <div
          className="flex items-start justify-between px-5 py-4 shrink-0"
          style={{ background: '#0f172a' }}
        >
          <div>
            <p className="text-[10px] font-black uppercase tracking-[0.2em]" style={{ color: '#818cf8' }}>
              Week Confirmation
            </p>
            <h2 className="mt-0.5 text-base font-black text-white">{formatWeekRange(weekStart)}</h2>
            <p className="mt-1 text-[11px]" style={{ color: '#94a3b8' }}>
              {totalSessions} session{totalSessions !== 1 ? 's' : ''} · {totalSlots} student slot{totalSlots !== 1 ? 's' : ''} · {tutorBreakdown.length} tutor{tutorBreakdown.length !== 1 ? 's' : ''}
            </p>
          </div>
          <button
            onClick={onClose}
            className="mt-0.5 rounded-lg p-1.5 transition-colors"
            style={{ color: '#64748b' }}
          >
            <X size={16} />
          </button>
        </div>

        {/* Confirmation status bar */}
        <div
          className="flex items-center justify-between gap-3 px-5 py-3 shrink-0"
          style={{
            borderBottom: '1px solid #e0e7ff',
            background: isConfirmed ? '#f0fdf4' : '#fafbff',
          }}
        >
          {isConfirmed ? (
            <div className="flex items-center gap-2">
              <div
                className="flex h-6 w-6 items-center justify-center rounded-full"
                style={{ background: '#16a34a' }}
              >
                <Check size={12} color="white" />
              </div>
              <div>
                <p className="text-[11px] font-black" style={{ color: '#166534' }}>Week confirmed</p>
                {confirmedAt && (
                  <p className="text-[10px]" style={{ color: '#4ade80' }}>
                    {new Date(confirmedAt).toLocaleDateString('en-US', {
                      month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit',
                    })}
                  </p>
                )}
              </div>
            </div>
          ) : (
            <div className="flex items-center gap-2">
              <div className="h-2 w-2 rounded-full" style={{ background: '#f59e0b' }} />
              <p className="text-[11px] font-semibold" style={{ color: '#92400e' }}>
                Not yet confirmed for this week
              </p>
            </div>
          )}

          <button
            onClick={handleConfirm}
            disabled={isConfirmed}
            className="flex shrink-0 items-center gap-1.5 rounded-lg px-3 py-1.5 text-[10px] font-black uppercase tracking-wider transition-all disabled:opacity-60"
            style={
              isConfirmed
                ? { background: 'white', border: '1px solid #86efac', color: '#15803d' }
                : { background: '#4f46e5', color: 'white', boxShadow: '0 4px 12px rgba(79,70,229,0.3)' }
            }
          >
            {isConfirmed
              ? <><Check size={10} /> Confirmed</>
              : 'Confirm this Week'
            }
          </button>
        </div>

        {/* Sessions breakdown */}
        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4 space-y-5">
          {tutorBreakdown.length === 0 ? (
            <div
              className="rounded-xl border-2 border-dashed py-10 text-center"
              style={{ borderColor: '#e2e8f0' }}
            >
              <p className="text-[11px] font-semibold" style={{ color: '#94a3b8' }}>
                No sessions scheduled for this week
              </p>
            </div>
          ) : (
            tutorBreakdown.map(({ tutor, slots }) => (
              <div key={tutor.id}>
                <p
                  className="mb-2 text-[10px] font-black uppercase tracking-[0.18em]"
                  style={{ color: '#64748b' }}
                >
                  {tutor.name}
                </p>
                <div className="space-y-1.5">
                  {slots.map((s, i) => (
                    <div
                      key={i}
                      className="flex items-start justify-between rounded-lg px-3 py-2"
                      style={{ background: '#f8fafc', border: '1px solid #e2e8f0' }}
                    >
                      <div>
                        <p className="text-[11px] font-bold" style={{ color: '#1e293b' }}>
                          {fmtShortDate(s.date)} · {fmt12(s.time)}
                        </p>
                        <p className="mt-0.5 text-[10px]" style={{ color: '#64748b' }}>
                          {s.activeStudents.length === 0
                            ? 'No students'
                            : s.activeStudents.map((st: any) => st.name).join(', ')}
                        </p>
                      </div>
                      <span
                        className="rounded-full px-2 py-0.5 text-[10px] font-black"
                        style={{ background: '#e0e7ff', color: '#4338ca' }}
                      >
                        {s.activeStudents.length}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            ))
          )}
        </div>

        {/* Send to tutors footer */}
        <div
          className="shrink-0 px-5 py-4"
          style={{ borderTop: '1px solid #e0e7ff', background: '#fafbff' }}
        >
          <div className="flex items-center justify-between gap-3">
            <div>
              <p className="text-[10px] font-black uppercase tracking-[0.18em]" style={{ color: '#475569' }}>
                Send to Tutors
              </p>
              <p className="mt-0.5 text-[11px]" style={{ color: '#64748b' }}>
                {tutorsWithEmail.length} tutor{tutorsWithEmail.length !== 1 ? 's' : ''} with email on file
                {tutors.length - tutorsWithEmail.length > 0 && (
                  <span style={{ color: '#94a3b8' }}>
                    {' '}({tutors.length - tutorsWithEmail.length} will be skipped)
                  </span>
                )}
              </p>
            </div>
            <button
              onClick={handleSend}
              disabled={sending || tutorsWithEmail.length === 0}
              className="flex shrink-0 items-center gap-1.5 rounded-lg px-4 py-2 text-[11px] font-black uppercase tracking-wider transition-all disabled:opacity-50"
              style={{ background: '#0f172a', color: 'white', boxShadow: '0 4px 12px rgba(15,23,42,0.2)' }}
            >
              {sending
                ? <><Loader2 size={11} className="animate-spin" /> Sending…</>
                : <><Mail size={11} /> Send Weekly Schedule</>
              }
            </button>
          </div>

          {sendResult && (
            <div
              className={`mt-3 rounded-lg border px-3 py-2 text-[11px] font-medium`}
              style={
                sendResult.skipped
                  ? { background: '#f8fafc', border: '1px solid #e2e8f0', color: '#475569' }
                  : sendResult.failed > 0
                    ? { background: '#fff1f2', border: '1px solid #fda4af', color: '#991b1b' }
                    : { background: '#f0fdf4', border: '1px solid #86efac', color: '#166534' }
              }
            >
              {sendResult.skipped
                ? (sendResult.reason ?? 'Email sending is disabled.')
                : (
                  <>
                    Sent {sendResult.sent}, failed {sendResult.failed}.
                    {sendResult.redirectedTo && (
                      <span style={{ color: '#64748b' }}> Redirected to {sendResult.redirectedTo}.</span>
                    )}
                    {sendResult.errors.length > 0 && (
                      <ul className="mt-1 list-disc pl-4 space-y-0.5 text-[10px]">
                        {sendResult.errors.map((e, i) => <li key={i}>{e}</li>)}
                      </ul>
                    )}
                  </>
                )
              }
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
