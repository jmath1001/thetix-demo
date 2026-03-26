'use client';
import { useState, useEffect, useCallback } from 'react';
import { supabase } from '@/lib/supabaseClient';
import {
  fetchAllSeries,
  fetchSeriesSessions,
  cancelSeries,
  rescheduleSeries,
  markCompletedSeries,
  type RecurringSeries,
  type Tutor,
  type Student,
  toISODate,
} from '@/lib/useScheduleData';
import { getSessionsForDay } from '@/components/constants';
import {
  Repeat, ChevronDown, ChevronUp, X, AlertTriangle,
  RefreshCw, Calendar, User, BookOpen, Edit3, Clock,
} from 'lucide-react';

const DAY_NAMES: Record<number, string> = {
  1: 'Monday', 2: 'Tuesday', 3: 'Wednesday',
  4: 'Thursday', 5: 'Friday', 6: 'Saturday', 7: 'Sunday',
};

const STATUS_STYLES: Record<string, { bg: string; text: string; dot: string }> = {
  active:    { bg: '#fff5f5', text: '#dc2626', dot: '#dc2626' },
  completed: { bg: '#f0fdf4', text: '#16a34a', dot: '#16a34a' },
  cancelled: { bg: '#f9fafb', text: '#6b7280', dot: '#9ca3af' },
};

function StatusBadge({ status }: { status: string }) {
  const s = STATUS_STYLES[status] ?? STATUS_STYLES.cancelled;
  return (
    <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[10px] font-black uppercase tracking-wider"
      style={{ background: s.bg, color: s.text }}>
      <span className="w-1.5 h-1.5 rounded-full" style={{ background: s.dot }} />
      {status}
    </span>
  );
}

type SessionRow = {
  id: string;
  status: string;
  notes: string | null;
  slake_sessions: { id: string; session_date: string; time: string; tutor_id: string } | null;
};

type EditTab = 'schedule' | 'duration' | 'day';

function addWeeks(dateStr: string, weeks: number): string {
  const d = new Date(dateStr + 'T00:00:00');
  d.setDate(d.getDate() + weeks * 7);
  return toISODate(d);
}

function endDateFromWeeks(startDate: string, totalWeeks: number): string {
  return addWeeks(startDate, totalWeeks - 1);
}

export default function RecurringManager() {
  const [series, setSeries] = useState<RecurringSeries[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [tutors, setTutors] = useState<Tutor[]>([]);
  const [students, setStudents] = useState<Student[]>([]);

  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [expandedSessions, setExpandedSessions] = useState<SessionRow[]>([]);
  const [loadingExpanded, setLoadingExpanded] = useState(false);

  const [cancellingId, setCancellingId] = useState<string | null>(null);
  const [cancelling, setCancelling] = useState(false);

  // Edit modal
  const [editingSeries, setEditingSeries] = useState<RecurringSeries | null>(null);
  const [editTab, setEditTab] = useState<EditTab>('schedule');
  const [editing, setEditing] = useState(false);
  const [editError, setEditError] = useState<string | null>(null);

  // Schedule tab
  const [newTutorId, setNewTutorId] = useState('');
  const [newTime, setNewTime] = useState('');

  // Duration tab
  const [newTotalWeeks, setNewTotalWeeks] = useState(0);

  // Day tab
  const [newDayOfWeek, setNewDayOfWeek] = useState(0);

  // Confirm-deletion step (duration shortening or day change)
  const [confirmStep, setConfirmStep] = useState(false);
  const [sessionsToRemove, setSessionsToRemove] = useState(0);

  const [statusFilter, setStatusFilter] = useState<'all' | 'active' | 'completed' | 'cancelled'>('all');

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      await markCompletedSeries();
      const [seriesData, tutorRes, studentRes] = await Promise.all([
        fetchAllSeries(),
        supabase.from('slake_tutors').select('*').order('name'),
        supabase.from('slake_students').select('*').order('name'),
      ]);
      setSeries(seriesData);
      setTutors((tutorRes.data ?? []).map((r: any) => ({
        id: r.id, name: r.name, subjects: r.subjects ?? [], cat: r.cat,
        availability: r.availability ?? [], availabilityBlocks: r.availability_blocks ?? [],
      })));
      setStudents((studentRes.data ?? []).map((r: any) => ({
        id: r.id, name: r.name, subject: r.subject, grade: r.grade ?? null,
        hoursLeft: r.hours_left, availabilityBlocks: r.availability_blocks ?? [],
        email: r.email ?? null, phone: r.phone ?? null,
        parent_name: r.parent_name ?? null, parent_email: r.parent_email ?? null,
        parent_phone: r.parent_phone ?? null, bluebook_url: r.bluebook_url ?? null,
      })));
    } catch (e: any) {
      setError(e.message);
    }
    setLoading(false);
  }, []);

  useEffect(() => { load(); }, [load]);

  const toggleExpand = async (id: string) => {
    if (expandedId === id) { setExpandedId(null); return; }
    setExpandedId(id);
    setLoadingExpanded(true);
    try {
      const data = await fetchSeriesSessions(id);
      setExpandedSessions((data as any[]).map((row) => ({
        id: row.id, status: row.status, notes: row.notes,
        slake_sessions: Array.isArray(row.slake_sessions)
          ? row.slake_sessions[0] || null : row.slake_sessions || null,
      })));
    } catch (e) { console.error('Error fetching sessions:', e); }
    setLoadingExpanded(false);
  };

  const handleCancel = async (id: string) => {
    setCancelling(true);
    try {
      await cancelSeries(id);
      await load();
      setCancellingId(null);
      if (expandedId === id) setExpandedId(null);
    } catch (e: any) { alert(e.message); }
    setCancelling(false);
  };

  const openEdit = (s: RecurringSeries) => {
    setEditingSeries(s);
    setEditTab('schedule');
    setNewTutorId(s.tutorId);
    setNewTime(s.time);
    setNewTotalWeeks(s.totalWeeks);
    setNewDayOfWeek(s.dayOfWeek);
    setEditError(null);
    setConfirmStep(false);
    setSessionsToRemove(0);
    setEditing(false);
  };

  const closeEdit = () => {
    setEditingSeries(null);
    setConfirmStep(false);
    setEditError(null);
  };

  // Fetch sessions for a series (uses cached expandedSessions if already loaded)
  const getSeriesSessions = async (seriesId: string): Promise<SessionRow[]> => {
    if (expandedId === seriesId) return expandedSessions;
    const data = await fetchSeriesSessions(seriesId);
    return (data as any[]).map((row) => ({
      id: row.id, status: row.status, notes: row.notes,
      slake_sessions: Array.isArray(row.slake_sessions)
        ? row.slake_sessions[0] || null : row.slake_sessions || null,
    }));
  };

  const handleEditSubmit = async () => {
    if (!editingSeries) return;
    setEditError(null);
    const today = toISODate(new Date());

    if (editTab === 'duration') {
      const newEnd = endDateFromWeeks(editingSeries.startDate, newTotalWeeks);
      if (newTotalWeeks < editingSeries.totalWeeks) {
        // Count future sessions that would be cut
        try {
          const sessions = await getSeriesSessions(editingSeries.id);
          const dropping = sessions.filter(r => {
            const d = r.slake_sessions?.session_date ?? '';
            return d >= today && d > newEnd;
          }).length;
          if (dropping > 0) {
            setSessionsToRemove(dropping);
            setConfirmStep(true);
            return;
          }
        } catch {}
      }
    }

    if (editTab === 'day') {
      try {
        const sessions = await getSeriesSessions(editingSeries.id);
        const future = sessions.filter(r => (r.slake_sessions?.session_date ?? '') >= today).length;
        if (future > 0) {
          setSessionsToRemove(future);
          setConfirmStep(true);
          return;
        }
      } catch {}
    }

    await commitEdit();
  };

  const commitEdit = async () => {
    if (!editingSeries) return;
    setEditing(true);
    setEditError(null);
    const student = students.find(s => s.id === editingSeries.studentId);
    if (!student) { setEditError('Student not found'); setEditing(false); return; }

    try {
      if (editTab === 'schedule') {
        await rescheduleSeries({
          seriesId: editingSeries.id,
          newTutorId,
          newTime,
          student,
          topic: editingSeries.topic,
        });

      } else if (editTab === 'duration') {
        const newEnd = endDateFromWeeks(editingSeries.startDate, newTotalWeeks);

        // Update series record
        const { error: updateErr } = await supabase
          .from('slake_recurring_series')
          .update({ end_date: newEnd, total_weeks: newTotalWeeks })
          .eq('id', editingSeries.id);
        if (updateErr) throw updateErr;

        // Delete future sessions beyond new end date
        const today = toISODate(new Date());
        const sessions = await getSeriesSessions(editingSeries.id);
        const toDrop = sessions
          .filter(r => {
            const d = r.slake_sessions?.session_date ?? '';
            return d >= today && d > newEnd;
          })
          .map(r => r.id);

        if (toDrop.length > 0) {
          const { error: dropErr } = await supabase
            .from('slake_session_students')
            .delete()
            .in('id', toDrop);
          if (dropErr) throw dropErr;
        }

        // If extending, book new sessions from old end+1 week through new end
        if (newTotalWeeks > editingSeries.totalWeeks) {
          const oldEnd = editingSeries.endDate;
          const tutor = tutors.find(t => t.id === editingSeries.tutorId);
          if (!tutor) throw new Error('Tutor not found');

          const MAX_CAPACITY = 3;
          let cursor = new Date(oldEnd + 'T00:00:00');
          cursor.setDate(cursor.getDate() + 7);

          while (toISODate(cursor) <= newEnd) {
            const isoDate = toISODate(cursor);

            const { data: existing } = await supabase
              .from('slake_sessions')
              .select('id, slake_session_students(id)')
              .eq('session_date', isoDate)
              .eq('tutor_id', editingSeries.tutorId)
              .eq('time', editingSeries.time)
              .maybeSingle();

            let sessionId: string;
            if (existing) {
              if (existing.slake_session_students && existing.slake_session_students.length >= MAX_CAPACITY) {
                throw new Error(`Session is full on ${isoDate}`);
              }
              sessionId = existing.id;
            } else {
              const { data: created, error: createErr } = await supabase
                .from('slake_sessions')
                .insert({ session_date: isoDate, tutor_id: editingSeries.tutorId, time: editingSeries.time })
                .select('id')
                .single();
              if (createErr) throw createErr;
              sessionId = created.id;
            }

            const { error: enrollErr } = await supabase
              .from('slake_session_students')
              .insert({
                session_id: sessionId,
                student_id: student.id,
                name: student.name,
                topic: editingSeries.topic,
                status: 'scheduled',
                series_id: editingSeries.id,
              });
            if (enrollErr) throw enrollErr;

            cursor.setDate(cursor.getDate() + 7);
          }
        }

      } else if (editTab === 'day') {
        await rescheduleSeries({
          seriesId: editingSeries.id,
          newTutorId: editingSeries.tutorId,
          newTime: editingSeries.time,
          student,
          topic: editingSeries.topic,
          overrideDayOfWeek: newDayOfWeek,
        });
      }

      closeEdit();
      await load();
    } catch (e: any) {
      setEditError(e.message);
      setConfirmStep(false);
    }
    setEditing(false);
  };

  const filtered = statusFilter === 'all' ? series : series.filter(s => s.status === statusFilter);
  const counts = {
    all: series.length,
    active: series.filter(s => s.status === 'active').length,
    completed: series.filter(s => s.status === 'completed').length,
    cancelled: series.filter(s => s.status === 'cancelled').length,
  };

  const availableBlocks = editingSeries
    ? getSessionsForDay(editTab === 'day' ? newDayOfWeek : editingSeries.dayOfWeek)
    : [];

  const today = toISODate(new Date());
  const newEndPreview = editingSeries ? endDateFromWeeks(editingSeries.startDate, newTotalWeeks) : '';

  return (
    <div className="min-h-screen" style={{ background: '#fafafa', fontFamily: 'ui-sans-serif, system-ui, sans-serif' }}>
      <div className="max-w-5xl mx-auto px-4 py-8 space-y-6">

        {/* Header */}
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-black tracking-tight" style={{ color: '#111827' }}>Recurring Sessions</h1>
            <p className="text-sm mt-0.5" style={{ color: '#6b7280' }}>Manage all recurring student schedules</p>
          </div>
          <button onClick={load} disabled={loading}
            className="flex items-center gap-2 px-3 py-2 rounded-xl text-xs font-bold transition-all"
            style={{ background: 'white', border: '1px solid #fca5a5', color: '#dc2626' }}>
            <RefreshCw size={13} className={loading ? 'animate-spin' : ''} />
            Refresh
          </button>
        </div>

        {/* Status filter */}
        <div className="flex gap-1 p-1 rounded-xl w-fit" style={{ background: '#f3f4f6' }}>
          {(['all', 'active', 'completed', 'cancelled'] as const).map(f => (
            <button key={f} onClick={() => setStatusFilter(f)}
              className="px-3 py-1.5 rounded-lg text-[11px] font-black uppercase tracking-wider transition-all"
              style={statusFilter === f
                ? { background: f === 'active' ? '#dc2626' : f === 'completed' ? '#16a34a' : f === 'cancelled' ? '#6b7280' : '#111827', color: 'white' }
                : { color: '#9ca3af' }}>
              {f} <span className="ml-1 opacity-70">({counts[f]})</span>
            </button>
          ))}
        </div>

        {error && (
          <div className="flex items-center gap-2 px-4 py-3 rounded-xl text-sm"
            style={{ background: '#fef2f2', border: '1px solid #fca5a5', color: '#dc2626' }}>
            <AlertTriangle size={14} /> {error}
          </div>
        )}

        {loading ? (
          <div className="flex items-center justify-center py-20 gap-3" style={{ color: '#9ca3af' }}>
            <RefreshCw size={18} className="animate-spin" />
            <span className="text-sm">Loading series…</span>
          </div>
        ) : filtered.length === 0 ? (
          <div className="text-center py-20">
            <Repeat size={32} className="mx-auto mb-3" style={{ color: '#fca5a5' }} />
            <p className="text-sm font-semibold" style={{ color: '#9ca3af' }}>No {statusFilter !== 'all' ? statusFilter : ''} recurring series found</p>
          </div>
        ) : (
          <div className="space-y-3">
            {filtered.map(s => {
              const isExpanded = expandedId === s.id;
              const isCancelling = cancellingId === s.id;
              const isPast = s.endDate < today;

              return (
                <div key={s.id} className="rounded-2xl overflow-hidden transition-all"
                  style={{ background: 'white', border: `1px solid ${s.status === 'active' ? '#fca5a5' : '#e5e7eb'}`, boxShadow: '0 1px 6px rgba(0,0,0,0.05)' }}>

                  <div className="flex items-center gap-4 px-5 py-4">
                    <div className="w-10 h-10 rounded-xl flex items-center justify-center shrink-0"
                      style={{ background: s.status === 'active' ? '#fff5f5' : '#f9fafb', border: `1.5px solid ${s.status === 'active' ? '#fca5a5' : '#e5e7eb'}` }}>
                      <Repeat size={16} style={{ color: s.status === 'active' ? '#dc2626' : '#9ca3af' }} />
                    </div>

                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <p className="text-sm font-black" style={{ color: '#111827' }}>{s.studentName}</p>
                        <StatusBadge status={s.status} />
                        {s.status === 'active' && isPast && (
                          <span className="text-[9px] font-bold px-2 py-0.5 rounded-full"
                            style={{ background: '#fef3c7', color: '#92400e' }}>ENDING</span>
                        )}
                      </div>
                      <div className="flex items-center gap-3 mt-1 flex-wrap">
                        <span className="flex items-center gap-1 text-[11px]" style={{ color: '#6b7280' }}>
                          <User size={10} /> {s.tutorName}
                        </span>
                        <span className="flex items-center gap-1 text-[11px]" style={{ color: '#6b7280' }}>
                          <Calendar size={10} /> {DAY_NAMES[s.dayOfWeek]} · {s.time}
                        </span>
                        <span className="flex items-center gap-1 text-[11px]" style={{ color: '#6b7280' }}>
                          <BookOpen size={10} /> {s.topic}
                        </span>
                        <span className="text-[11px]" style={{ color: '#9ca3af' }}>
                          {s.startDate} → {s.endDate} ({s.totalWeeks}wk)
                        </span>
                      </div>
                    </div>

                    <div className="flex items-center gap-2 shrink-0">
                      {s.status === 'active' && (
                        <>
                          <button onClick={() => openEdit(s)}
                            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[11px] font-bold transition-all"
                            style={{ background: '#fff5f5', border: '1px solid #fca5a5', color: '#dc2626' }}>
                            <Edit3 size={11} /> Edit
                          </button>
                          <button onClick={() => setCancellingId(s.id)}
                            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[11px] font-bold transition-all"
                            style={{ background: '#f9fafb', border: '1px solid #e5e7eb', color: '#6b7280' }}>
                            <X size={11} /> Cancel
                          </button>
                        </>
                      )}
                      <button onClick={() => toggleExpand(s.id)}
                        className="w-8 h-8 flex items-center justify-center rounded-lg transition-all"
                        style={{ background: '#f9fafb', border: '1px solid #e5e7eb', color: '#6b7280' }}>
                        {isExpanded ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
                      </button>
                    </div>
                  </div>

                  {/* Cancel confirm */}
                  {isCancelling && (
                    <div className="mx-5 mb-4 px-4 py-3 rounded-xl flex items-center justify-between gap-4"
                      style={{ background: '#fef2f2', border: '1px solid #fca5a5' }}>
                      <div className="flex items-center gap-2">
                        <AlertTriangle size={14} style={{ color: '#dc2626' }} />
                        <p className="text-xs font-bold" style={{ color: '#dc2626' }}>
                          Cancel all future sessions for {s.studentName}?
                        </p>
                      </div>
                      <div className="flex gap-2 shrink-0">
                        <button onClick={() => setCancellingId(null)}
                          className="px-3 py-1.5 rounded-lg text-[11px] font-bold"
                          style={{ background: 'white', border: '1px solid #e5e7eb', color: '#6b7280' }}>
                          Keep
                        </button>
                        <button onClick={() => handleCancel(s.id)} disabled={cancelling}
                          className="px-3 py-1.5 rounded-lg text-[11px] font-bold text-white"
                          style={{ background: cancelling ? '#9ca3af' : '#dc2626' }}>
                          {cancelling ? 'Cancelling…' : 'Yes, Cancel'}
                        </button>
                      </div>
                    </div>
                  )}

                  {/* Expanded sessions */}
                  {isExpanded && (
                    <div style={{ borderTop: '1px solid #f3f4f6' }}>
                      {loadingExpanded ? (
                        <div className="flex items-center gap-2 px-5 py-4" style={{ color: '#9ca3af' }}>
                          <RefreshCw size={13} className="animate-spin" />
                          <span className="text-xs">Loading sessions…</span>
                        </div>
                      ) : expandedSessions.length === 0 ? (
                        <p className="px-5 py-4 text-xs italic" style={{ color: '#9ca3af' }}>No individual sessions found</p>
                      ) : (
                        <div className="px-5 py-3">
                          <p className="text-[9px] font-black uppercase tracking-widest mb-2.5" style={{ color: '#9ca3af' }}>
                            Individual Sessions ({expandedSessions.length})
                          </p>
                          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-2">
                            {expandedSessions
                              .sort((a, b) => (a.slake_sessions?.session_date ?? '').localeCompare(b.slake_sessions?.session_date ?? ''))
                              .map(row => {
                                const date = row.slake_sessions?.session_date ?? '';
                                const isPastSession = date < today;
                                const statusColor = row.status === 'present' ? '#16a34a'
                                  : row.status === 'no-show' ? '#dc2626'
                                  : isPastSession ? '#9ca3af' : '#dc2626';
                                const statusBg = row.status === 'present' ? '#f0fdf4'
                                  : row.status === 'no-show' ? '#fef2f2'
                                  : isPastSession ? '#f9fafb' : '#fff5f5';
                                return (
                                  <div key={row.id} className="px-3 py-2.5 rounded-xl"
                                    style={{ background: statusBg, border: `1px solid ${statusColor}22` }}>
                                    <p className="text-[11px] font-bold" style={{ color: '#111827' }}>{date}</p>
                                    <div className="flex items-center gap-1 mt-0.5">
                                      <span className="w-1.5 h-1.5 rounded-full shrink-0" style={{ background: statusColor }} />
                                      <span className="text-[10px] font-semibold capitalize" style={{ color: statusColor }}>{row.status}</span>
                                    </div>
                                  </div>
                                );
                              })}
                          </div>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* ── EDIT MODAL ── */}
      {editingSeries && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4"
          style={{ background: 'rgba(0,0,0,0.5)', backdropFilter: 'blur(8px)' }}>
          <div className="w-full max-w-md bg-white rounded-2xl overflow-hidden shadow-2xl"
            style={{ border: '1px solid #fca5a5' }}>

            {/* Modal header */}
            <div className="flex items-center justify-between px-5 py-4"
              style={{ background: '#dc2626', borderBottom: '1px solid #b91c1c' }}>
              <div>
                <p className="text-sm font-black text-white">Edit Series</p>
                <p className="text-[11px] text-red-200 mt-0.5">
                  {editingSeries.studentName} · {DAY_NAMES[editingSeries.dayOfWeek]}s · {editingSeries.totalWeeks}wk
                </p>
              </div>
              <button onClick={closeEdit}
                className="w-8 h-8 flex items-center justify-center rounded-full"
                style={{ background: 'rgba(255,255,255,0.2)', color: 'white' }}>
                <X size={15} />
              </button>
            </div>

            {/* Tab bar */}
            <div className="flex border-b" style={{ borderColor: '#f3f4f6' }}>
              {([
                { key: 'schedule', label: 'Tutor & Time', icon: <User size={11} /> },
                { key: 'duration', label: 'Duration',     icon: <Clock size={11} /> },
                { key: 'day',      label: 'Day of Week',  icon: <Calendar size={11} /> },
              ] as { key: EditTab; label: string; icon: React.ReactNode }[]).map(tab => (
                <button key={tab.key}
                  onClick={() => { setEditTab(tab.key); setConfirmStep(false); setEditError(null); }}
                  className="flex-1 flex items-center justify-center gap-1.5 py-3 text-[11px] font-bold transition-all"
                  style={editTab === tab.key
                    ? { borderBottom: '2px solid #dc2626', color: '#dc2626', background: '#fff5f5' }
                    : { borderBottom: '2px solid transparent', color: '#9ca3af' }}>
                  {tab.icon} {tab.label}
                </button>
              ))}
            </div>

            <div className="p-5 space-y-4">

              {/* ── CONFIRM STEP ── */}
              {confirmStep ? (
                <div className="space-y-4">
                  <div className="px-4 py-4 rounded-xl"
                    style={{ background: '#fef2f2', border: '1px solid #fca5a5' }}>
                    <div className="flex items-center gap-2 mb-2">
                      <AlertTriangle size={16} style={{ color: '#dc2626' }} />
                      <p className="text-sm font-black" style={{ color: '#dc2626' }}>
                        {sessionsToRemove} future session{sessionsToRemove !== 1 ? 's' : ''} will be cancelled
                      </p>
                    </div>
                    <p className="text-xs leading-relaxed" style={{ color: '#6b7280' }}>
                      {editTab === 'duration'
                        ? `Shortening to ${newTotalWeeks} weeks (ending ${newEndPreview}) will remove ${sessionsToRemove} already-scheduled session${sessionsToRemove !== 1 ? 's' : ''}.`
                        : `Moving to ${DAY_NAMES[newDayOfWeek]}s will cancel ${sessionsToRemove} future session${sessionsToRemove !== 1 ? 's' : ''} and recreate them on the new day.`
                      }
                    </p>
                  </div>
                  <div className="flex gap-3">
                    <button onClick={() => setConfirmStep(false)}
                      className="flex-1 py-2.5 rounded-xl text-sm font-bold"
                      style={{ background: '#f9fafb', border: '1px solid #e5e7eb', color: '#6b7280' }}>
                      Go Back
                    </button>
                    <button onClick={commitEdit} disabled={editing}
                      className="flex-1 py-2.5 rounded-xl text-sm font-bold text-white active:scale-95"
                      style={{ background: editing ? '#9ca3af' : '#dc2626' }}>
                      {editing ? 'Saving…' : 'Yes, Proceed'}
                    </button>
                  </div>
                </div>
              ) : (
                <>
                  {/* ── SCHEDULE TAB ── */}
                  {editTab === 'schedule' && (
                    <>
                      <div className="px-3 py-2.5 rounded-xl text-xs"
                        style={{ background: '#fef3c7', border: '1px solid #fcd34d', color: '#92400e' }}>
                        <strong>Note:</strong> Past sessions are untouched. Only future sessions will be updated.
                      </div>
                      <div>
                        <label className="block text-[10px] font-black uppercase tracking-widest mb-1.5" style={{ color: '#6b7280' }}>Tutor</label>
                        <select value={newTutorId} onChange={e => setNewTutorId(e.target.value)}
                          className="w-full px-3 py-2.5 rounded-xl text-sm outline-none"
                          style={{ border: '2px solid #fca5a5', color: '#111827' }}>
                          {tutors.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
                        </select>
                      </div>
                      <div>
                        <label className="block text-[10px] font-black uppercase tracking-widest mb-1.5" style={{ color: '#6b7280' }}>Time Slot</label>
                        <select value={newTime} onChange={e => setNewTime(e.target.value)}
                          className="w-full px-3 py-2.5 rounded-xl text-sm outline-none"
                          style={{ border: '2px solid #fca5a5', color: '#111827' }}>
                          {availableBlocks.map(b => <option key={b.time} value={b.time}>{b.label} ({b.display})</option>)}
                        </select>
                      </div>
                    </>
                  )}

                  {/* ── DURATION TAB ── */}
                  {editTab === 'duration' && (
                    <>
                      <div className="px-3 py-2.5 rounded-xl text-xs"
                        style={{ background: '#fef3c7', border: '1px solid #fcd34d', color: '#92400e' }}>
                        <strong>Shortening</strong> removes sessions beyond the new end date.{' '}
                        <strong>Extending</strong> books new sessions through the new end date.
                      </div>

                      {/* Week stepper */}
                      <div>
                        <label className="block text-[10px] font-black uppercase tracking-widest mb-2" style={{ color: '#6b7280' }}>Total Weeks</label>
                        <div className="flex items-center gap-3">
                          <button onClick={() => setNewTotalWeeks(w => Math.max(1, w - 1))}
                            className="w-9 h-9 rounded-xl flex items-center justify-center text-lg font-black active:scale-95"
                            style={{ background: '#fff5f5', border: '1.5px solid #fca5a5', color: '#dc2626' }}>
                            −
                          </button>
                          <div className="flex-1 text-center">
                            <span className="text-3xl font-black" style={{ color: '#111827' }}>{newTotalWeeks}</span>
                            <span className="text-sm ml-1.5" style={{ color: '#6b7280' }}>weeks</span>
                          </div>
                          <button onClick={() => setNewTotalWeeks(w => w + 1)}
                            className="w-9 h-9 rounded-xl flex items-center justify-center text-lg font-black active:scale-95"
                            style={{ background: '#fff5f5', border: '1.5px solid #fca5a5', color: '#dc2626' }}>
                            +
                          </button>
                        </div>
                      </div>

                      {/* Preview */}
                      <div className="flex items-center justify-between px-4 py-3 rounded-xl"
                        style={{ background: '#f9fafb', border: '1px solid #e5e7eb' }}>
                        <div className="text-center flex-1">
                          <p className="text-[9px] font-black uppercase tracking-widest mb-0.5" style={{ color: '#9ca3af' }}>Start</p>
                          <p className="text-xs font-bold" style={{ color: '#111827' }}>{editingSeries.startDate}</p>
                        </div>
                        <span style={{ color: '#d1d5db', fontSize: 18 }}>→</span>
                        <div className="text-center flex-1">
                          <p className="text-[9px] font-black uppercase tracking-widest mb-0.5" style={{ color: '#9ca3af' }}>New End</p>
                          <p className="text-xs font-bold" style={{
                            color: newEndPreview < editingSeries.endDate ? '#dc2626'
                              : newEndPreview > editingSeries.endDate ? '#16a34a' : '#111827'
                          }}>{newEndPreview}</p>
                        </div>
                        <div className="text-center flex-1">
                          <p className="text-[9px] font-black uppercase tracking-widest mb-0.5" style={{ color: '#9ca3af' }}>Change</p>
                          <p className="text-xs font-bold" style={{
                            color: newTotalWeeks < editingSeries.totalWeeks ? '#dc2626'
                              : newTotalWeeks > editingSeries.totalWeeks ? '#16a34a' : '#9ca3af'
                          }}>
                            {newTotalWeeks === editingSeries.totalWeeks ? '—'
                              : `${newTotalWeeks > editingSeries.totalWeeks ? '+' : ''}${newTotalWeeks - editingSeries.totalWeeks}wk`}
                          </p>
                        </div>
                      </div>
                    </>
                  )}

                  {/* ── DAY TAB ── */}
                  {editTab === 'day' && (
                    <>
                      <div className="px-3 py-2.5 rounded-xl text-xs"
                        style={{ background: '#fef3c7', border: '1px solid #fcd34d', color: '#92400e' }}>
                        <strong>Note:</strong> Future sessions on the current day will be cancelled and recreated on the new day.
                      </div>
                      <div>
                        <label className="block text-[10px] font-black uppercase tracking-widest mb-2" style={{ color: '#6b7280' }}>New Day of Week</label>
                        <div className="grid grid-cols-4 gap-2">
                          {([1,2,3,4,5,6,7] as const).map(d => (
                            <button key={d} onClick={() => setNewDayOfWeek(d)}
                              className="py-2 rounded-xl text-[11px] font-black active:scale-95"
                              style={newDayOfWeek === d
                                ? { background: '#dc2626', color: 'white', border: '2px solid #b91c1c' }
                                : { background: '#f9fafb', color: '#6b7280', border: '1.5px solid #e5e7eb' }}>
                              {DAY_NAMES[d].slice(0, 3)}
                            </button>
                          ))}
                        </div>
                      </div>
                      <div>
                        <label className="block text-[10px] font-black uppercase tracking-widest mb-1.5" style={{ color: '#6b7280' }}>
                          Time on {DAY_NAMES[newDayOfWeek]}
                        </label>
                        <select value={newTime} onChange={e => setNewTime(e.target.value)}
                          className="w-full px-3 py-2.5 rounded-xl text-sm outline-none"
                          style={{ border: '2px solid #fca5a5', color: '#111827' }}>
                          {availableBlocks.map(b => <option key={b.time} value={b.time}>{b.label} ({b.display})</option>)}
                        </select>
                      </div>
                    </>
                  )}

                  {editError && (
                    <div className="flex items-center gap-2 px-3 py-2.5 rounded-xl text-xs"
                      style={{ background: '#fef2f2', border: '1px solid #fca5a5', color: '#dc2626' }}>
                      <AlertTriangle size={12} /> {editError}
                    </div>
                  )}

                  <div className="flex gap-3 pt-1">
                    <button onClick={closeEdit}
                      className="flex-1 py-2.5 rounded-xl text-sm font-bold"
                      style={{ background: '#f9fafb', border: '1px solid #e5e7eb', color: '#6b7280' }}>
                      Cancel
                    </button>
                    <button
                      onClick={handleEditSubmit}
                      disabled={
                        editing
                        || (editTab === 'duration' && newTotalWeeks === editingSeries.totalWeeks)
                        || (editTab === 'day' && newDayOfWeek === editingSeries.dayOfWeek)
                      }
                      className="flex-1 py-2.5 rounded-xl text-sm font-bold text-white active:scale-95"
                      style={{
                        background: (editing
                          || (editTab === 'duration' && newTotalWeeks === editingSeries.totalWeeks)
                          || (editTab === 'day' && newDayOfWeek === editingSeries.dayOfWeek))
                          ? '#9ca3af' : '#dc2626'
                      }}>
                      {editing ? 'Saving…' : 'Save Changes'}
                    </button>
                  </div>
                </>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}