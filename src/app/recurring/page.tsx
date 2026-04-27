'use client';
import { useState, useEffect, useCallback } from 'react';
import { supabase } from '@/lib/supabaseClient';
import { DB, withCenter } from '@/lib/db';
import {
  fetchAllSeries, fetchSeriesSessions, cancelSeries,
  rescheduleSeries, markCompletedSeries, createConfirmationToken, bookStudent,
  type RecurringSeries, type Tutor, type Student, toISODate,
} from '@/lib/useScheduleData';
import { getSessionsForDay } from '@/components/constants';
import { Repeat, X, AlertTriangle, RefreshCw, Calendar, User, BookOpen, Edit3, Clock, Pencil, ChevronDown, ChevronUp, Search } from 'lucide-react';
import { logEvent } from '@/lib/analytics';

const DAY_NAMES: Record<number, string> = {
  1:'Monday',2:'Tuesday',3:'Wednesday',4:'Thursday',5:'Friday',6:'Saturday',7:'Sunday',
};

const MATH_TOPICS = ['Algebra','Geometry','Pre-Calculus','Calculus','Statistics','SAT Math','ACT Math','Math'];
const ENG_TOPICS  = ['Reading','Writing','Grammar','Essay','SAT English','ACT English','English'];
const ALL_TOPICS  = [...MATH_TOPICS, ...ENG_TOPICS, 'Other'];

type SessionRow = {
  id: string; status: string; notes: string | null; topic: string | null; tutorId: string | null;
  session: { id: string; session_date: string; time: string; tutor_id: string } | null;
};
type EditTab = 'schedule' | 'duration' | 'day';
type SingleSessionEdit = {
  row: SessionRow; series: RecurringSeries;
  newDate: string; newTime: string; newTutorId: string; newTopic: string;
  saving: boolean; error: string | null; confirmCancel: boolean;
};

type CreateRecurringForm = {
  studentId: string;
  tutorId: string;
  dayOfWeek: number;
  time: string;
  topic: string;
  weeks: number;
  startDate: string;
  notes: string;
};

function addWeeks(d: string, w: number) {
  const date = new Date(d + 'T00:00:00'); date.setDate(date.getDate() + w * 7); return toISODate(date);
}
function endDateFromWeeks(start: string, weeks: number) { return addWeeks(start, weeks - 1); }
function dowFromIso(d: string) { const dt = new Date(d + 'T00:00:00'); return dt.getDay() === 0 ? 7 : dt.getDay(); }
function alignDateToIsoDow(startIso: string, targetDow: number) {
  const cursor = new Date(startIso + 'T00:00:00');
  while (dowFromIso(toISODate(cursor)) !== targetDow) {
    cursor.setDate(cursor.getDate() + 1);
  }
  return toISODate(cursor);
}
function normaliseRows(data: any[]): SessionRow[] {
  return data.map(r => ({
    id: r.id, status: r.status, notes: r.notes, topic: r.topic ?? null,
    tutorId: (Array.isArray(r[DB.sessions]) ? r[DB.sessions][0] : r[DB.sessions])?.tutor_id ?? null,
    session: (Array.isArray(r[DB.sessions]) ? r[DB.sessions][0] : r[DB.sessions]) || null,
  }));
}

function SessionDot({ status, date, isPast, onClick }: { status: string; date: string; isPast: boolean; onClick?: () => void }) {
  const color =
    status === 'present' || status === 'confirmed' ? '#16a34a' :
    status === 'no-show' ? '#dc2626' :
    status === 'cancelled' ? '#e2e8f0' :
    isPast ? '#f59e0b' : '#4f46e5';
  const d = new Date(date + 'T00:00:00');
  const label = d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  return (
    <div title={`${label} · ${status}`} onClick={onClick} className="group relative" style={{ cursor: onClick ? 'pointer' : 'default' }}>
      <div className="w-4 h-4 rounded-full transition-transform group-hover:scale-125" style={{ background: color }} />
      <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-1.5 px-2 py-1 rounded-lg text-[9px] font-bold whitespace-nowrap opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none z-10"
        style={{ background: '#0f172a', color: 'white' }}>
        {label}<br/>{status}{onClick ? ' · click to edit' : ''}
      </div>
    </div>
  );
}

function SeriesCard({ s, tutors, students, today, onEdit, onCancelSeries, onDelete, onEditSession, onCancelSession, refreshStamp }: {
  s: RecurringSeries; tutors: Tutor[]; students: Student[]; today: string;
  onEdit: (s: RecurringSeries) => void;
  onCancelSeries: (id: string) => void;
  onDelete: (id: string) => void;
  onEditSession: (row: SessionRow, s: RecurringSeries) => void;
  onCancelSession: (row: SessionRow, s: RecurringSeries) => void;
  refreshStamp: number;
}) {
  const [sessions, setSessions] = useState<SessionRow[]>([]);
  const [loadingSessions, setLoadingSessions] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const [confirmAction, setConfirmAction] = useState<'cancel' | 'delete' | null>(null);

  const loadSessions = async (force = false) => {
    if (!force && sessions.length > 0) return;
    setLoadingSessions(true);
    try { const data = await fetchSeriesSessions(s.id); setSessions(normaliseRows(data)); } catch {}
    setLoadingSessions(false);
  };

  const toggle = () => { if (!expanded) loadSessions(); setExpanded(e => !e); };

  useEffect(() => {
    if (expanded) {
      void loadSessions(true);
      return;
    }
    setSessions([]);
  }, [refreshStamp]);

  const tutorNameById = new Map(tutors.map(t => [t.id, t.name]));
  const isInstanceOverride = (row: SessionRow) => {
    const date = row.session?.session_date;
    if (!date) return false;
    const rowDow = dowFromIso(date);
    return row.session?.tutor_id !== s.tutorId || row.session?.time !== s.time || rowDow !== s.dayOfWeek;
  };

  const past = sessions.filter(r => (r.session?.session_date ?? '') < today);
  const future = sessions
    .filter(r => (r.session?.session_date ?? '') >= today && r.status !== 'cancelled')
    .sort((a, b) => (a.session?.session_date ?? '').localeCompare(b.session?.session_date ?? ''));
  const cancelledUpcoming = sessions.filter(r => (r.session?.session_date ?? '') >= today && r.status === 'cancelled');
  const present = past.filter(r => r.status === 'present' || r.status === 'confirmed').length;
  const noShow = past.filter(r => r.status === 'no-show').length;
  const attended = past.filter(r => r.status !== 'cancelled').length;
  const rate = attended > 0 ? Math.round((present / attended) * 100) : null;
  const statusColor = s.status === 'active' ? '#4f46e5' : s.status === 'completed' ? '#16a34a' : '#94a3b8';
  const statusBg = s.status === 'active' ? '#eef2ff' : s.status === 'completed' ? '#f0fdf4' : '#f8fafc';
  const totalSessions = sessions.filter(r => r.status !== 'cancelled').length || s.totalWeeks;
  const completedSessions = past.filter(r => r.status !== 'cancelled').length;
  const progressPct = totalSessions > 0 ? Math.round((completedSessions / totalSessions) * 100) : 0;

  return (
    <div className="bg-white rounded-2xl overflow-hidden transition-all"
      style={{ border: `1.5px solid ${expanded ? statusColor + '60' : '#f1f5f9'}` }}>
      <div className="p-3.5">
        <div className="flex items-start gap-3">
          <div className="shrink-0">
            <div className="w-9 h-9 rounded-xl flex items-center justify-center text-xs font-black text-white"
              style={{ background: statusColor }}>
              {s.studentName.charAt(0)}
            </div>
          </div>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 flex-wrap mb-1">
              <p className="text-sm font-black text-[#0f172a]">{s.studentName}</p>
              <span className="text-[9px] font-black px-2 py-0.5 rounded-full uppercase tracking-wider"
                style={{ background: statusBg, color: statusColor }}>{s.status}</span>
              {s.status === 'active' && s.endDate < today && (
                <span className="text-[9px] font-bold px-2 py-0.5 rounded-full" style={{ background: '#fef3c7', color: '#92400e' }}>ending</span>
              )}
            </div>
            <div className="flex items-center gap-3 flex-wrap">
              <span className="text-[11px] text-[#334155] flex items-center gap-1"><User size={10}/> {s.tutorName}</span>
              <span className="text-[11px] text-[#334155] flex items-center gap-1"><Calendar size={10}/> {DAY_NAMES[s.dayOfWeek]}s</span>
              <span className="text-[11px] text-[#334155] flex items-center gap-1"><Clock size={10}/> {s.time}</span>
              <span className="text-[11px] text-[#334155] flex items-center gap-1"><BookOpen size={10}/> {s.topic}</span>
            </div>
            <div className="flex items-center gap-3 mt-1.5">
              <span className="text-[10px] text-[#334155]">{s.startDate} → {s.endDate}</span>
              <span className="text-[10px] font-bold text-[#334155]">{s.totalWeeks}wk</span>
              {sessions.length > 0 && rate !== null && (
                <>
                  <span className="text-[#e2e8f0]">·</span>
                  <span className="text-[10px] font-bold" style={{ color: rate >= 80 ? '#16a34a' : rate >= 60 ? '#f59e0b' : '#dc2626' }}>{rate}% attendance</span>
                  {noShow > 0 && <span className="text-[10px] text-[#334155]">{noShow} no-show{noShow !== 1 ? 's' : ''}</span>}
                </>
              )}
            </div>
            {sessions.length > 0 && (
              <div className="mt-2 flex items-center gap-2">
                <div className="flex-1 h-1.5 rounded-full bg-[#f1f5f9] overflow-hidden">
                  <div className="h-full rounded-full transition-all" style={{ width: `${progressPct}%`, background: statusColor }}/>
                </div>
                <span className="text-[10px] text-[#334155] shrink-0">{completedSessions}/{totalSessions}</span>
              </div>
            )}
          </div>
          <div className="flex items-center gap-1.5 shrink-0">
            {s.status === 'active' && (
              <>
                <button onClick={() => onEdit(s)} className="px-3 py-1.5 rounded-lg text-[11px] font-bold transition-all flex items-center gap-1"
                  style={{ background: '#eef2ff', border: '1px solid #c7d2fe', color: '#4f46e5' }}>
                  <Edit3 size={11}/> Edit
                </button>
                <button onClick={() => setConfirmAction('cancel')} className="p-1.5 rounded-lg text-[#94a3b8] transition-colors hover:text-[#dc2626] hover:bg-[#fff5f5]">
                  <X size={14}/>
                </button>
              </>
            )}
            {s.status !== 'active' && (
              <button onClick={() => setConfirmAction('delete')} className="p-1.5 rounded-lg text-[#cbd5e1] transition-colors hover:text-[#dc2626] hover:bg-[#fff5f5]">
                <X size={14}/>
              </button>
            )}
            <button onClick={toggle} className="p-1.5 rounded-lg text-[#94a3b8] transition-colors hover:bg-[#f8fafc]">
              {expanded ? <ChevronUp size={14}/> : <ChevronDown size={14}/>}
            </button>
          </div>
        </div>

        {confirmAction && (
          <div className="mt-4 px-4 py-3 rounded-xl flex items-center justify-between gap-4"
            style={{ background: '#fef2f2', border: '1px solid #fecaca' }}>
            <div className="flex items-center gap-2">
              <AlertTriangle size={13} style={{ color: '#dc2626' }}/>
              <p className="text-xs font-bold text-[#dc2626]">
                {confirmAction === 'cancel' ? `Cancel all future sessions for ${s.studentName}?` : `Delete this series record? This cannot be undone.`}
              </p>
            </div>
            <div className="flex gap-2 shrink-0">
              <button onClick={() => setConfirmAction(null)} className="px-3 py-1.5 rounded-lg text-[11px] font-bold text-[#64748b]"
                style={{ background: 'white', border: '1px solid #e2e8f0' }}>Keep</button>
              <button onClick={() => { setConfirmAction(null); confirmAction === 'cancel' ? onCancelSeries(s.id) : onDelete(s.id); }}
                className="px-3 py-1.5 rounded-lg text-[11px] font-bold text-white" style={{ background: '#dc2626' }}>
                {confirmAction === 'cancel' ? 'Yes, Cancel' : 'Yes, Delete'}
              </button>
            </div>
          </div>
        )}
      </div>

      {expanded && (
        <div style={{ borderTop: '1px solid #f8fafc' }}>
          <div className="px-3.5 py-3">
            {loadingSessions ? (
              <div className="flex items-center gap-2 text-xs text-[#334155]"><RefreshCw size={12} className="animate-spin"/> Loading sessions…</div>
            ) : sessions.length === 0 ? (
              <p className="text-xs text-[#334155] italic">No sessions found</p>
            ) : (
              <>
                <p className="text-[9px] font-black uppercase tracking-widest text-[#334155] mb-2.5">Session Timeline · {sessions.length} sessions</p>
                <div className="flex flex-wrap gap-2 mb-3">
                  {sessions.sort((a, b) => (a.session?.session_date ?? '').localeCompare(b.session?.session_date ?? '')).map(row => {
                    const date = row.session?.session_date ?? '';
                    const isPast = date < today;
                    const canEdit = s.status === 'active' && date >= today;
                    return <SessionDot key={row.id} status={row.status} date={date} isPast={isPast} onClick={canEdit ? () => onEditSession(row, s) : undefined} />;
                  })}
                </div>
                <div className="flex items-center gap-4 mb-4">
                  {[['#16a34a','Present'],['#dc2626','No-show'],['#4f46e5','Upcoming'],['#f59e0b','Unmarked'],['#e2e8f0','Cancelled']].map(([c,l]) => (
                    <div key={l} className="flex items-center gap-1.5">
                      <div className="w-2.5 h-2.5 rounded-full" style={{ background: c }}/><span className="text-[9px] text-[#334155]">{l}</span>
                    </div>
                  ))}
                </div>
                {future.length > 0 && (
                  <div>
                    <p className="text-[9px] font-black uppercase tracking-widest text-[#4f46e5] mb-2">Upcoming · {future.length}</p>
                    <div className="space-y-1.5">
                      {future.slice(0, 4).map(row => {
                        const date = row.session?.session_date ?? '';
                        const d = new Date(date + 'T00:00:00');
                        const canEdit = s.status === 'active' && row.status !== 'cancelled';
                        const isOverride = isInstanceOverride(row);
                        const rowDow = dowFromIso(date);
                        const rowTutor = row.session?.tutor_id ? (tutorNameById.get(row.session.tutor_id) ?? 'Tutor') : 'Tutor';
                        return (
                          <div key={row.id} className="flex items-center gap-2.5 px-2.5 py-2 rounded-xl group" style={{ background: '#fafafa', border: '1px solid #f1f5f9' }}>
                            <div className="text-center shrink-0 w-8">
                              <p className="text-[8px] font-black uppercase text-[#334155] leading-none">{d.toLocaleDateString('en-US', { month: 'short' })}</p>
                              <p className="text-sm font-black text-[#1e293b] leading-tight">{d.getDate()}</p>
                            </div>
                            <div className="flex-1 min-w-0">
                              <p className="text-xs font-bold text-[#1e293b] truncate">{row.topic ?? s.topic}</p>
                              <p className="text-[10px] text-[#334155]">{DAY_NAMES[rowDow]} · {row.session?.time ?? s.time} · {rowTutor}</p>
                              {isOverride && (
                                <span className="inline-flex mt-1 text-[9px] font-black px-1.5 py-0.5 rounded-full uppercase tracking-wider" style={{ background: '#dbeafe', color: '#1d4ed8', border: '1px solid #93c5fd' }}>
                                  Moved Instance
                                </span>
                              )}
                            </div>
                            {canEdit && (
                              <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                                <button onClick={() => onEditSession(row, s)} className="px-2 py-1 rounded-lg text-[10px] font-bold flex items-center gap-1" style={{ background: '#f1f5f9', color: '#64748b' }}>
                                  <Pencil size={9}/> Edit
                                </button>
                                <button onClick={() => onCancelSession(row, s)} className="p-1 rounded-lg text-[#cbd5e1] hover:text-[#dc2626]"><X size={12}/></button>
                              </div>
                            )}
                          </div>
                        );
                      })}
                      {future.length > 4 && <p className="text-[10px] text-[#334155] text-center pt-1">+{future.length - 4} more upcoming</p>}
                    </div>
                  </div>
                )}
                {cancelledUpcoming.length > 0 && (
                  <div className="mt-4">
                    <p className="text-[9px] font-black uppercase tracking-widest text-[#334155] mb-2">Cancelled Upcoming · {cancelledUpcoming.length}</p>
                    <div className="space-y-1.5">
                      {cancelledUpcoming.slice(0, 4).map(row => {
                        const date = row.session?.session_date ?? '';
                        const d = new Date(date + 'T00:00:00');
                        const canRestore = s.status === 'active';
                        return (
                          <div key={row.id} className="flex items-center gap-2.5 px-2.5 py-2 rounded-xl group" style={{ background: '#f8fafc', border: '1px solid #e2e8f0' }}>
                            <div className="text-center shrink-0 w-8">
                              <p className="text-[8px] font-black uppercase text-[#334155] leading-none">{d.toLocaleDateString('en-US', { month: 'short' })}</p>
                              <p className="text-sm font-black text-[#334155] leading-tight">{d.getDate()}</p>
                            </div>
                            <div className="flex-1 min-w-0">
                              <p className="text-xs font-bold text-[#334155] truncate">Cancelled Session</p>
                              <p className="text-[10px] text-[#334155]">{DAY_NAMES[s.dayOfWeek]} · {row.session?.time ?? s.time}</p>
                            </div>
                            {canRestore && (
                              <button onClick={() => onEditSession(row, s)} className="px-2.5 py-1 rounded-lg text-[10px] font-bold" style={{ background: '#eef2ff', border: '1px solid #c7d2fe', color: '#4f46e5' }}>
                                Restore
                              </button>
                            )}
                          </div>
                        );
                      })}
                      {cancelledUpcoming.length > 4 && <p className="text-[10px] text-[#334155] text-center pt-1">+{cancelledUpcoming.length - 4} more cancelled</p>}
                    </div>
                  </div>
                )}
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

export default function RecurringManager() {
  const [series, setSeries] = useState<RecurringSeries[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [tutors, setTutors] = useState<Tutor[]>([]);
  const [students, setStudents] = useState<Student[]>([]);
  const [statusFilter, setStatusFilter] = useState<'all' | 'active' | 'completed' | 'cancelled'>('all');
  const [search, setSearch] = useState('');
  const [editingSeries, setEditingSeries] = useState<RecurringSeries | null>(null);
  const [editTab, setEditTab] = useState<EditTab>('schedule');
  const [editing, setEditing] = useState(false);
  const [editError, setEditError] = useState<string | null>(null);
  const [newTutorId, setNewTutorId] = useState('');
  const [newTime, setNewTime] = useState('');
  const [newTotalWeeks, setNewTotalWeeks] = useState(0);
  const [newDayOfWeek, setNewDayOfWeek] = useState(0);
  const [confirmStep, setConfirmStep] = useState(false);
  const [sessionsToRemove, setSessionsToRemove] = useState(0);
  const [singleEdit, setSingleEdit] = useState<SingleSessionEdit | null>(null);
  const [refreshStamp, setRefreshStamp] = useState(0);
  const [showCreate, setShowCreate] = useState(false);
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);
  const [createForm, setCreateForm] = useState<CreateRecurringForm>({
    studentId: '',
    tutorId: '',
    dayOfWeek: 1,
    time: getSessionsForDay(1)[0]?.time ?? '15:30',
    topic: '',
    weeks: 8,
    startDate: toISODate(new Date()),
    notes: '',
  });

  const today = toISODate(new Date());

  const load = useCallback(async () => {
    setLoading(true); setError(null);
    try {
      await markCompletedSeries();
      const [seriesData, tutorRes, studentRes] = await Promise.all([
        fetchAllSeries(),
        withCenter(supabase.from(DB.tutors).select('*')).order('name'),
        withCenter(supabase.from(DB.students).select('*')).order('name'),
      ]);
      setSeries(seriesData);
      setTutors((tutorRes.data ?? []).map((r: any) => ({
        id: r.id, name: r.name, subjects: r.subjects ?? [], cat: r.cat,
        availability: r.availability ?? [], availabilityBlocks: r.availability_blocks ?? [],
      })));
      setStudents((studentRes.data ?? []).map((r: any) => ({
        id: r.id,
        name: r.name,
        subjects: Array.isArray(r.subjects)
          ? r.subjects.filter((s: unknown): s is string => typeof s === 'string' && !!s.trim())
          : (r.subject ? [r.subject] : []),
        subject: r.subject ?? null,
        grade: r.grade ?? null,
        hoursLeft: r.hours_left, availabilityBlocks: r.availability_blocks ?? [],
        email: r.email ?? null, phone: r.phone ?? null,
        parent_name: r.parent_name ?? null,
        parent_email: r.parent_email ?? null,
        parent_phone: r.parent_phone ?? null,
        mom_name: r.mom_name ?? null,
        mom_email: r.mom_email ?? null,
        mom_phone: r.mom_phone ?? null,
        dad_name: r.dad_name ?? null,
        dad_email: r.dad_email ?? null,
        dad_phone: r.dad_phone ?? null,
        bluebook_url: r.bluebook_url ?? null,
      })));
      setRefreshStamp(v => v + 1);
    } catch (e: any) { setError(e.message); }
    setLoading(false);
  }, []);

  useEffect(() => { load(); }, [load]);

  const handleCancelSeries = async (id: string) => {
    try { await cancelSeries(id); logEvent('recurring_series_cancelled', { seriesId: id }); await load(); }
    catch (e: any) { alert(e.message); }
  };

  const handleDelete = async (id: string) => {
    try {
      await withCenter(supabase.from(DB.recurringSeries).delete()).eq('id', id);
      logEvent('recurring_series_deleted', { seriesId: id });
      await load();
    }
    catch (e: any) { alert(e.message); }
  };

  const openCreate = () => {
    const firstTutor = tutors[0];
    const firstStudent = students[0];
    const day = 1;
    const firstTime = getSessionsForDay(day)[0]?.time ?? '15:30';
    setCreateForm({
      studentId: firstStudent?.id ?? '',
      tutorId: firstTutor?.id ?? '',
      dayOfWeek: day,
      time: firstTime,
      topic: firstStudent?.subjects?.[0] ?? firstStudent?.subject ?? firstTutor?.subjects?.[0] ?? 'Math',
      weeks: 8,
      startDate: toISODate(new Date()),
      notes: '',
    });
    setCreateError(null);
    setShowCreate(true);
  };

  const patchCreate = (patch: Partial<CreateRecurringForm>) => {
    setCreateForm(prev => ({ ...prev, ...patch }));
  };

  const handleCreateSeries = async () => {
    const student = students.find(s => s.id === createForm.studentId);
    const tutor = tutors.find(t => t.id === createForm.tutorId);
    if (!student || !tutor) {
      setCreateError('Please select both a student and tutor.');
      return;
    }
    if (!createForm.topic.trim()) {
      setCreateError('Topic is required.');
      return;
    }
    if (createForm.weeks < 2) {
      setCreateError('Recurring series must be at least 2 weeks.');
      return;
    }

    setCreateError(null);
    setCreating(true);
    try {
      const alignedDate = alignDateToIsoDow(createForm.startDate, createForm.dayOfWeek);
      await bookStudent({
        tutorId: tutor.id,
        date: alignedDate,
        time: createForm.time,
        student,
        topic: createForm.topic.trim(),
        notes: createForm.notes.trim(),
        recurring: true,
        recurringWeeks: createForm.weeks,
      });
      setShowCreate(false);
      logEvent('recurring_booking_used', { source: 'recurring_page_create', weeks: createForm.weeks });
      await load();
    } catch (e: any) {
      setCreateError(e.message || 'Could not create recurring series.');
    }
    setCreating(false);
  };

  const openEdit = (s: RecurringSeries) => {
    setEditingSeries(s); setEditTab('schedule');
    setNewTutorId(s.tutorId); setNewTime(s.time);
    setNewTotalWeeks(s.totalWeeks); setNewDayOfWeek(s.dayOfWeek);
    setEditError(null); setConfirmStep(false); setSessionsToRemove(0); setEditing(false);
  };
  const closeEdit = () => { setEditingSeries(null); setConfirmStep(false); setEditError(null); };

  const getSeriesSessions = async (seriesId: string): Promise<SessionRow[]> => {
    const data = await fetchSeriesSessions(seriesId);
    return normaliseRows(data);
  };

  const handleEditSubmit = async () => {
    if (!editingSeries) return;
    setEditError(null);
    if (editTab === 'duration') {
      const newEnd = endDateFromWeeks(editingSeries.startDate, newTotalWeeks);
      if (newTotalWeeks < editingSeries.totalWeeks) {
        try {
          const sessions = await getSeriesSessions(editingSeries.id);
          const dropping = sessions.filter(r => { const d = r.session?.session_date ?? ''; return d >= today && d > newEnd; }).length;
          if (dropping > 0) { setSessionsToRemove(dropping); setConfirmStep(true); return; }
        } catch {}
      }
    }
    if (editTab === 'day') {
      try {
        const sessions = await getSeriesSessions(editingSeries.id);
        const future = sessions.filter(r => (r.session?.session_date ?? '') >= today).length;
        if (future > 0) { setSessionsToRemove(future); setConfirmStep(true); return; }
      } catch {}
    }
    await commitEdit();
  };

  const commitEdit = async () => {
    if (!editingSeries) return;
    setEditing(true); setEditError(null);
    const student = students.find(s => s.id === editingSeries.studentId);
    if (!student) { setEditError('Student not found'); setEditing(false); return; }
    try {
      if (editTab === 'schedule') {
        await rescheduleSeries({ seriesId: editingSeries.id, newTutorId, newTime, student, topic: editingSeries.topic });
      } else if (editTab === 'duration') {
        const newEnd = endDateFromWeeks(editingSeries.startDate, newTotalWeeks);
        const { error: ue } = await supabase.from(DB.recurringSeries).update({ end_date: newEnd, total_weeks: newTotalWeeks }).eq('id', editingSeries.id);
        if (ue) throw ue;
        const sessions = await getSeriesSessions(editingSeries.id);
        const toDrop = sessions.filter(r => { const d = r.session?.session_date ?? ''; return d >= today && d > newEnd; }).map(r => r.id);
        if (toDrop.length > 0) { const { error: de } = await supabase.from(DB.sessionStudents).delete().in('id', toDrop); if (de) throw de; }
        if (newTotalWeeks > editingSeries.totalWeeks) {
          const oldEnd = editingSeries.endDate;
          let cursor = new Date(oldEnd + 'T00:00:00'); cursor.setDate(cursor.getDate() + 7);
          while (toISODate(cursor) <= newEnd) {
            const isoDate = toISODate(cursor);
            const { data: ex } = await (supabase.from(DB.sessions).select(`id, ${DB.sessionStudents}(id)`).eq('session_date', isoDate).eq('tutor_id', editingSeries.tutorId).eq('time', editingSeries.time).maybeSingle() as any);
            let sessionId: string;
            if (ex) {
              if (ex[DB.sessionStudents] && ex[DB.sessionStudents].length >= 3) throw new Error(`Session is full on ${isoDate}`);
              sessionId = ex.id;
            } else {
              const { data: cr, error: ce } = await supabase.from(DB.sessions).insert({ session_date: isoDate, tutor_id: editingSeries.tutorId, time: editingSeries.time }).select('id').single();
              if (ce) throw ce; sessionId = cr.id;
            }
            const { error: ee } = await supabase.from(DB.sessionStudents).insert({ session_id: sessionId, student_id: student.id, name: student.name, topic: editingSeries.topic, status: 'scheduled', series_id: editingSeries.id, confirmation_token: createConfirmationToken() });
            if (ee) throw ee;
            cursor.setDate(cursor.getDate() + 7);
          }
        }
      } else if (editTab === 'day') {
        await rescheduleSeries({ seriesId: editingSeries.id, newTutorId: editingSeries.tutorId, newTime: editingSeries.time, student, topic: editingSeries.topic, overrideDayOfWeek: newDayOfWeek });
      }
      closeEdit();
      logEvent('recurring_series_edited', { seriesId: editingSeries.id, tab: editTab });
      await load();
    } catch (e: any) { setEditError(e.message); setConfirmStep(false); }
    setEditing(false);
  };

  const openSingleEdit = (row: SessionRow, s: RecurringSeries) => {
    const date = row.session?.session_date ?? '';
    setSingleEdit({ row, series: s, newDate: date, newTime: row.session?.time ?? s.time, newTutorId: row.session?.tutor_id ?? s.tutorId, newTopic: row.topic ?? s.topic, saving: false, error: null, confirmCancel: false });
  };

  const openSingleCancel = (row: SessionRow, s: RecurringSeries) => {
    setSingleEdit({ row, series: s, newDate: row.session?.session_date ?? '', newTime: row.session?.time ?? s.time, newTutorId: row.session?.tutor_id ?? s.tutorId, newTopic: row.topic ?? s.topic, saving: false, error: null, confirmCancel: true });
  };

  const closeSingleEdit = () => setSingleEdit(null);
  const patchSingle = (patch: Partial<SingleSessionEdit>) => setSingleEdit(prev => prev ? { ...prev, ...patch } : prev);
  const singleEditBlocks = singleEdit ? getSessionsForDay(dowFromIso(singleEdit.newDate)) : [];
  const newEndPreview = editingSeries ? endDateFromWeeks(editingSeries.startDate, newTotalWeeks) : '';
  const availableBlocks = editingSeries ? getSessionsForDay(editTab === 'day' ? newDayOfWeek : editingSeries.dayOfWeek) : [];

  const handleSingleSave = async () => {
    if (!singleEdit) return;
    patchSingle({ saving: true, error: null });
    const { row, series: s, newDate, newTime, newTutorId: nTutor, newTopic } = singleEdit;
    try {
      const { error: re } = await supabase.from(DB.sessionStudents).update({ status: 'cancelled' }).eq('id', row.id);
      if (re) throw re;
      const { data: ex } = await (supabase.from(DB.sessions).select(`id, ${DB.sessionStudents}(id)`).eq('session_date', newDate).eq('tutor_id', nTutor).eq('time', newTime).maybeSingle() as any);
      let newSessionId: string;
      if (ex) {
        if ((ex[DB.sessionStudents]?.length ?? 0) >= 3) throw new Error(`That slot is already full on ${newDate}`);
        newSessionId = ex.id;
      } else {
        const { data: cr, error: ce } = await supabase.from(DB.sessions).insert({ session_date: newDate, tutor_id: nTutor, time: newTime }).select('id').single();
        if (ce) throw ce; newSessionId = cr.id;
      }
      const student = students.find(st => st.id === s.studentId);
      const { error: ie } = await supabase.from(DB.sessionStudents).insert({ session_id: newSessionId, student_id: s.studentId, name: student?.name ?? s.studentName, topic: newTopic, status: 'scheduled', series_id: s.id, confirmation_token: createConfirmationToken() });
      if (ie) throw ie;
      closeSingleEdit();
      logEvent('recurring_session_edited', { seriesId: s.id, date: newDate });
      await load();
    } catch (e: any) { patchSingle({ saving: false, error: e.message }); }
  };

  const handleSingleCancel = async () => {
    if (!singleEdit) return;
    patchSingle({ saving: true, error: null });
    try {
      const { error: e } = await supabase.from(DB.sessionStudents).update({ status: 'cancelled' }).eq('id', singleEdit.row.id);
      if (e) throw e;
      closeSingleEdit();
      logEvent('recurring_session_cancelled', { seriesId: singleEdit.series.id, date: singleEdit.row.session?.session_date });
      await load();
    } catch (e: any) { patchSingle({ saving: false, error: e.message }); }
  };

  const filtered = series
    .filter(s => statusFilter === 'all' || s.status === statusFilter)
    .filter(s => {
      if (!search.trim()) return true;
      const q = search.toLowerCase();
      return s.studentName.toLowerCase().includes(q) || s.tutorName.toLowerCase().includes(q) || s.topic.toLowerCase().includes(q);
    });
  const counts = { all: series.length, active: series.filter(s => s.status === 'active').length, completed: series.filter(s => s.status === 'completed').length, cancelled: series.filter(s => s.status === 'cancelled').length };
  const createBlocks = getSessionsForDay(createForm.dayOfWeek);

  return (
    <div className="min-h-screen pb-20" style={{ background: 'radial-gradient(1200px 500px at 15% -10%, #dbeafe 0%, rgba(219,234,254,0) 60%), radial-gradient(1000px 480px at 95% 0%, #ede9fe 0%, rgba(237,233,254,0) 58%), #f1f5f9', fontFamily: 'ui-sans-serif, system-ui, sans-serif' }}>
      <div className="sticky top-0 z-40" style={{ backdropFilter: 'blur(10px)', background: 'rgba(248,250,252,0.88)', borderBottom: '1px solid #dbe4f3' }}>
        <div className="max-w-5xl mx-auto px-4 py-3 flex items-start justify-between gap-4">
          <div>
            <div className="flex items-center gap-2.5">
              <div className="w-8 h-8 rounded-xl flex items-center justify-center" style={{ background: '#4338ca', color: '#ffffff', boxShadow: '0 8px 22px rgba(67,56,202,0.25)' }}>
                <Repeat size={14} />
              </div>
              <span className="text-lg font-black tracking-tight text-[#0f172a]">Recurring Manager</span>
              <span className="text-[10px] font-bold text-[#475569] bg-white px-2 py-1 rounded-full border border-[#cbd5e1]">
                {series.length} total
              </span>
            </div>
            <p className="mt-1 text-xs" style={{ color: '#334155' }}>Edit series safely, restore cancelled instances, and rebuild recurring plans fast.</p>
          </div>
          <div className="flex items-center gap-2">
            <button onClick={openCreate} className="flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-black uppercase tracking-wider text-white" style={{ background: '#0f172a', boxShadow: '0 8px 22px rgba(15,23,42,0.2)' }}>
              <Repeat size={11} /> Create Series
            </button>
            <button onClick={load} disabled={loading} className="flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-bold text-[#334155]" style={{ background: 'white', border: '1px solid #cbd5e1' }}>
              <RefreshCw size={11} className={loading ? 'animate-spin' : ''}/> Refresh
            </button>
          </div>
        </div>
      </div>

      <div className="max-w-5xl mx-auto px-4 pt-4 space-y-3.5">
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5">
          <div className="rounded-2xl px-4 py-3" style={{ background: 'white', border: '1px solid #dbe4f3' }}>
            <p className="text-[10px] font-black uppercase tracking-widest text-[#334155]">Active Series</p>
            <p className="mt-1 text-2xl font-black text-[#312e81]">{counts.active}</p>
          </div>
          <div className="rounded-2xl px-4 py-3" style={{ background: 'white', border: '1px solid #dbe4f3' }}>
            <p className="text-[10px] font-black uppercase tracking-widest text-[#334155]">Completed</p>
            <p className="mt-1 text-2xl font-black text-[#166534]">{counts.completed}</p>
          </div>
          <div className="rounded-2xl px-4 py-3" style={{ background: 'white', border: '1px solid #dbe4f3' }}>
            <p className="text-[10px] font-black uppercase tracking-widest text-[#334155]">Cancelled</p>
            <p className="mt-1 text-2xl font-black text-[#64748b]">{counts.cancelled}</p>
          </div>
        </div>

        <div className="relative">
          <Search size={13} className="absolute left-3 top-1/2 -translate-y-1/2 text-[#94a3b8] pointer-events-none" />
          <input
            type="text"
            placeholder="Search by student, tutor, or topic…"
            value={search}
            onChange={e => setSearch(e.target.value)}
            className="w-full pl-8 pr-3 py-2 rounded-xl text-xs font-medium outline-none transition-all"
            style={{ background: 'white', border: '1.5px solid #e2e8f0', color: '#0f172a' }}
          />
          {search && (
            <button onClick={() => setSearch('')} className="absolute right-2.5 top-1/2 -translate-y-1/2 text-[#94a3b8] hover:text-[#334155]">
              <X size={12} />
            </button>
          )}
        </div>

        <div className="flex items-center gap-2 flex-wrap">
          {([
            { key: 'all', label: 'All', color: '#0f172a', bg: 'white', activeBg: '#0f172a' },
            { key: 'active', label: 'Active', color: '#4f46e5', bg: '#eef2ff', activeBg: '#4f46e5' },
            { key: 'completed', label: 'Completed', color: '#16a34a', bg: '#f0fdf4', activeBg: '#16a34a' },
            { key: 'cancelled', label: 'Cancelled', color: '#94a3b8', bg: '#f8fafc', activeBg: '#64748b' },
          ] as const).map(f => (
            <button key={f.key} onClick={() => setStatusFilter(f.key)}
              className="flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-black uppercase tracking-wider transition-all"
              style={statusFilter === f.key ? { background: f.activeBg, color: 'white' } : { background: f.bg, color: f.color, border: `1.5px solid ${f.color}20` }}>
              {f.label} <span className="text-[9px] opacity-70">({counts[f.key]})</span>
            </button>
          ))}
        </div>

        {error && (
          <div className="flex items-center gap-2 px-4 py-3 rounded-xl text-sm" style={{ background: '#fef2f2', border: '1px solid #fecaca', color: '#dc2626' }}>
            <AlertTriangle size={14}/> {error}
          </div>
        )}

        {loading ? (
          <div className="flex items-center justify-center py-16 gap-3 text-[#334155]">
            <RefreshCw size={18} className="animate-spin"/><span className="text-sm">Loading…</span>
          </div>
        ) : filtered.length === 0 ? (
          <div className="text-center py-16 bg-white rounded-2xl" style={{ border: '1.5px dashed #e2e8f0' }}>
            <Repeat size={28} className="mx-auto mb-3 text-[#cbd5e1]"/>
            <p className="text-sm font-bold text-[#334155]">No {statusFilter !== 'all' ? statusFilter : ''} recurring series</p>
          </div>
        ) : (
          <div className="space-y-3">
            {filtered.map(s => (
              <SeriesCard key={s.id} s={s} tutors={tutors} students={students} today={today}
                onEdit={openEdit} onCancelSeries={handleCancelSeries} onDelete={handleDelete}
                onEditSession={openSingleEdit} onCancelSession={openSingleCancel} refreshStamp={refreshStamp} />
            ))}
          </div>
        )}
      </div>

      {showCreate && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{ background: 'rgba(15,23,42,0.6)', backdropFilter: 'blur(6px)' }}
          onClick={e => { if (e.target === e.currentTarget) setShowCreate(false); }}>
          <div className="w-full max-w-md bg-white rounded-2xl overflow-hidden shadow-2xl" style={{ border: '1px solid #c7d2fe' }}
            onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between px-5 py-4" style={{ background: '#0f172a' }}>
              <div>
                <p className="text-sm font-black text-white">Create Recurring Series</p>
                <p className="text-[11px] mt-0.5" style={{ color: 'rgba(255,255,255,0.65)' }}>Rebuild a recurring plan in one flow</p>
              </div>
              <button onClick={() => setShowCreate(false)} className="w-8 h-8 flex items-center justify-center rounded-full" style={{ background: 'rgba(255,255,255,0.12)', color: 'white' }}>
                <X size={15}/>
              </button>
            </div>

            <div className="p-5 space-y-4">
              <div>
                <label className="block text-[10px] font-black uppercase tracking-widest mb-1.5 text-[#64748b]">Student</label>
                <select value={createForm.studentId} onChange={e => {
                  const picked = students.find(s => s.id === e.target.value);
                  patchCreate({ studentId: e.target.value, topic: picked?.subjects?.[0] ?? picked?.subject ?? createForm.topic });
                }} className="w-full px-3 py-2.5 rounded-xl text-sm outline-none text-[#0f172a]" style={{ border: '2px solid #e2e8f0' }}>
                  <option value="">Select student</option>
                  {students.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
                </select>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-[10px] font-black uppercase tracking-widest mb-1.5 text-[#64748b]">Tutor</label>
                  <select value={createForm.tutorId} onChange={e => patchCreate({ tutorId: e.target.value })} className="w-full px-3 py-2.5 rounded-xl text-sm outline-none text-[#0f172a]" style={{ border: '2px solid #e2e8f0' }}>
                    <option value="">Select tutor</option>
                    {tutors.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
                  </select>
                </div>
                <div>
                  <label className="block text-[10px] font-black uppercase tracking-widest mb-1.5 text-[#64748b]">Start Date</label>
                  <input type="date" value={createForm.startDate} onChange={e => patchCreate({ startDate: e.target.value })}
                    className="w-full px-3 py-2.5 rounded-xl text-sm outline-none text-[#0f172a]" style={{ border: '2px solid #e2e8f0' }} />
                </div>
              </div>

              <div className="grid grid-cols-3 gap-3">
                <div>
                  <label className="block text-[10px] font-black uppercase tracking-widest mb-1.5 text-[#64748b]">Day</label>
                  <select value={createForm.dayOfWeek} onChange={e => {
                    const dow = Number(e.target.value);
                    patchCreate({ dayOfWeek: dow, time: getSessionsForDay(dow)[0]?.time ?? createForm.time });
                  }} className="w-full px-3 py-2.5 rounded-xl text-sm outline-none text-[#0f172a]" style={{ border: '2px solid #e2e8f0' }}>
                    {[1,2,3,4,5,6,7].map(d => <option key={d} value={d}>{DAY_NAMES[d].slice(0,3)}</option>)}
                  </select>
                </div>
                <div>
                  <label className="block text-[10px] font-black uppercase tracking-widest mb-1.5 text-[#64748b]">Time</label>
                  <select value={createForm.time} onChange={e => patchCreate({ time: e.target.value })} className="w-full px-3 py-2.5 rounded-xl text-sm outline-none text-[#0f172a]" style={{ border: '2px solid #e2e8f0' }}>
                    {createBlocks.map(b => <option key={b.time} value={b.time}>{b.label}</option>)}
                  </select>
                </div>
                <div>
                  <label className="block text-[10px] font-black uppercase tracking-widest mb-1.5 text-[#64748b]">Weeks</label>
                  <input type="number" min={2} max={24} value={createForm.weeks} onChange={e => patchCreate({ weeks: Math.max(2, Math.min(24, Number(e.target.value || 2))) })}
                    className="w-full px-3 py-2.5 rounded-xl text-sm outline-none text-[#0f172a]" style={{ border: '2px solid #e2e8f0' }} />
                </div>
              </div>

              <div>
                <label className="block text-[10px] font-black uppercase tracking-widest mb-1.5 text-[#64748b]">Topic</label>
                <select value={createForm.topic} onChange={e => patchCreate({ topic: e.target.value })} className="w-full px-3 py-2.5 rounded-xl text-sm outline-none text-[#0f172a]" style={{ border: '2px solid #e2e8f0' }}>
                  {ALL_TOPICS.map(t => <option key={t} value={t}>{t}</option>)}
                </select>
              </div>

              <div>
                <label className="block text-[10px] font-black uppercase tracking-widest mb-1.5 text-[#64748b]">Notes (optional)</label>
                <textarea value={createForm.notes} onChange={e => patchCreate({ notes: e.target.value })} rows={2}
                  className="w-full px-3 py-2.5 rounded-xl text-sm outline-none text-[#0f172a] resize-y" style={{ border: '2px solid #e2e8f0' }} />
              </div>

              {createError && (
                <div className="flex items-center gap-2 px-3 py-2.5 rounded-xl text-xs" style={{ background: '#fef2f2', border: '1px solid #fecaca', color: '#dc2626' }}>
                  <AlertTriangle size={12}/> {createError}
                </div>
              )}

              <div className="flex gap-3 pt-1">
                <button onClick={() => setShowCreate(false)} className="flex-1 py-2.5 rounded-xl text-sm font-bold text-[#64748b]" style={{ background: '#f8fafc', border: '1px solid #e2e8f0' }}>Cancel</button>
                <button onClick={handleCreateSeries} disabled={creating} className="flex-1 py-2.5 rounded-xl text-sm font-bold text-white" style={{ background: creating ? '#94a3b8' : '#0f172a' }}>
                  {creating ? 'Creating…' : 'Create Series'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Series edit modal */}
      {editingSeries && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{ background: 'rgba(15,23,42,0.6)', backdropFilter: 'blur(6px)' }}
          onClick={e => { if (e.target === e.currentTarget) closeEdit(); }}>
          <div className="w-full max-w-md bg-white rounded-2xl overflow-hidden shadow-2xl" style={{ border: '1px solid #c7d2fe' }}
            onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between px-5 py-4" style={{ background: '#4f46e5' }}>
              <div>
                <p className="text-sm font-black text-white">Edit Series</p>
                <p className="text-[11px] text-indigo-200 mt-0.5">{editingSeries.studentName} · {DAY_NAMES[editingSeries.dayOfWeek]}s · {editingSeries.totalWeeks}wk</p>
              </div>
              <button onClick={closeEdit} className="w-8 h-8 flex items-center justify-center rounded-full" style={{ background: 'rgba(255,255,255,0.2)', color: 'white' }}>
                <X size={15}/>
              </button>
            </div>
            <div className="flex border-b border-[#f1f5f9]">
              {([
                { key: 'schedule', label: 'Tutor & Time', icon: <User size={11}/> },
                { key: 'duration', label: 'Duration', icon: <Clock size={11}/> },
                { key: 'day', label: 'Day', icon: <Calendar size={11}/> },
              ] as { key: EditTab; label: string; icon: React.ReactNode }[]).map(tab => (
                <button key={tab.key} onClick={() => { setEditTab(tab.key); setConfirmStep(false); setEditError(null); }}
                  className="flex-1 flex items-center justify-center gap-1.5 py-3 text-[11px] font-bold transition-all"
                  style={editTab === tab.key ? { borderBottom: '2px solid #4f46e5', color: '#4f46e5', background: '#eef2ff' } : { borderBottom: '2px solid transparent', color: '#94a3b8' }}>
                  {tab.icon} {tab.label}
                </button>
              ))}
            </div>
            <div className="p-5 space-y-4">
              {confirmStep ? (
                <div className="space-y-4">
                  <div className="px-4 py-4 rounded-xl" style={{ background: '#eef2ff', border: '1px solid #c7d2fe' }}>
                    <div className="flex items-center gap-2 mb-2"><AlertTriangle size={16} style={{ color: '#4f46e5' }}/>
                      <p className="text-sm font-black text-[#4f46e5]">{sessionsToRemove} future session{sessionsToRemove !== 1 ? 's' : ''} will be cancelled</p>
                    </div>
                    <p className="text-xs text-[#64748b] leading-relaxed">
                      {editTab === 'duration' ? `Shortening to ${newTotalWeeks} weeks will remove ${sessionsToRemove} scheduled session${sessionsToRemove !== 1 ? 's' : ''}.` : `Moving to ${DAY_NAMES[newDayOfWeek]}s will cancel and recreate ${sessionsToRemove} future session${sessionsToRemove !== 1 ? 's' : ''}.`}
                    </p>
                  </div>
                  <div className="flex gap-3">
                    <button onClick={() => setConfirmStep(false)} className="flex-1 py-2.5 rounded-xl text-sm font-bold text-[#64748b]" style={{ background: '#f8fafc', border: '1px solid #e2e8f0' }}>Go Back</button>
                    <button onClick={commitEdit} disabled={editing} className="flex-1 py-2.5 rounded-xl text-sm font-bold text-white" style={{ background: editing ? '#94a3b8' : '#4f46e5' }}>{editing ? 'Saving…' : 'Yes, Proceed'}</button>
                  </div>
                </div>
              ) : (
                <>
                  {editTab === 'schedule' && (
                    <>
                      <div className="px-3 py-2.5 rounded-xl text-xs" style={{ background: '#fef3c7', border: '1px solid #fcd34d', color: '#92400e' }}>
                        <strong>Note:</strong> Past sessions are untouched. Only future sessions will be updated.
                      </div>
                      <div>
                        <label className="block text-[10px] font-black uppercase tracking-widest mb-1.5 text-[#64748b]">Tutor</label>
                        <select value={newTutorId} onChange={e => setNewTutorId(e.target.value)} className="w-full px-3 py-2.5 rounded-xl text-sm outline-none text-[#0f172a]" style={{ border: '2px solid #c7d2fe' }}>
                          {tutors.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
                        </select>
                      </div>
                      <div>
                        <label className="block text-[10px] font-black uppercase tracking-widest mb-1.5 text-[#64748b]">Time Slot</label>
                        <select value={newTime} onChange={e => setNewTime(e.target.value)} className="w-full px-3 py-2.5 rounded-xl text-sm outline-none text-[#0f172a]" style={{ border: '2px solid #c7d2fe' }}>
                          {availableBlocks.map(b => <option key={b.time} value={b.time}>{b.label} ({b.display})</option>)}
                        </select>
                      </div>
                    </>
                  )}
                  {editTab === 'duration' && (
                    <>
                      <div className="px-3 py-2.5 rounded-xl text-xs" style={{ background: '#fef3c7', border: '1px solid #fcd34d', color: '#92400e' }}>
                        <strong>Shortening</strong> removes sessions beyond new end. <strong>Extending</strong> books new sessions.
                      </div>
                      <div>
                        <label className="block text-[10px] font-black uppercase tracking-widest mb-2 text-[#64748b]">Total Weeks</label>
                        <div className="flex items-center gap-3">
                          <button onClick={() => setNewTotalWeeks(w => Math.max(1, w - 1))} className="w-9 h-9 rounded-xl text-lg font-black active:scale-95" style={{ background: '#eef2ff', border: '1.5px solid #c7d2fe', color: '#4f46e5' }}>−</button>
                          <div className="flex-1 text-center"><span className="text-3xl font-black text-[#0f172a]">{newTotalWeeks}</span><span className="text-sm ml-1.5 text-[#64748b]">weeks</span></div>
                          <button onClick={() => setNewTotalWeeks(w => w + 1)} className="w-9 h-9 rounded-xl text-lg font-black active:scale-95" style={{ background: '#eef2ff', border: '1.5px solid #c7d2fe', color: '#4f46e5' }}>+</button>
                        </div>
                      </div>
                      <div className="flex justify-between px-4 py-3 rounded-xl" style={{ background: '#f8fafc', border: '1px solid #f1f5f9' }}>
                        {[['Start', editingSeries.startDate, '#0f172a'], ['New End', newEndPreview, newEndPreview < editingSeries.endDate ? '#dc2626' : newEndPreview > editingSeries.endDate ? '#16a34a' : '#0f172a'], ['Change', newTotalWeeks === editingSeries.totalWeeks ? '—' : `${newTotalWeeks > editingSeries.totalWeeks ? '+' : ''}${newTotalWeeks - editingSeries.totalWeeks}wk`, newTotalWeeks < editingSeries.totalWeeks ? '#dc2626' : newTotalWeeks > editingSeries.totalWeeks ? '#16a34a' : '#94a3b8']].map(([label, val, color]) => (
                          <div key={label as string} className="flex-1 text-center">
                            <p className="text-[9px] font-black uppercase tracking-widest text-[#94a3b8] mb-0.5">{label}</p>
                            <p className="text-xs font-bold" style={{ color: color as string }}>{val}</p>
                          </div>
                        ))}
                      </div>
                    </>
                  )}
                  {editTab === 'day' && (
                    <>
                      <div className="px-3 py-2.5 rounded-xl text-xs" style={{ background: '#fef3c7', border: '1px solid #fcd34d', color: '#92400e' }}>
                        <strong>Note:</strong> Future sessions will be cancelled and recreated on the new day.
                      </div>
                      <div>
                        <label className="block text-[10px] font-black uppercase tracking-widest mb-2 text-[#64748b]">New Day</label>
                        <div className="grid grid-cols-4 gap-2">
                          {([1,2,3,4,5,6,7] as const).map(d => (
                            <button key={d} onClick={() => setNewDayOfWeek(d)} className="py-2 rounded-xl text-[11px] font-black active:scale-95"
                              style={newDayOfWeek === d ? { background: '#4f46e5', color: 'white', border: '2px solid #3730a3' } : { background: '#f8fafc', color: '#64748b', border: '1.5px solid #e2e8f0' }}>
                              {DAY_NAMES[d].slice(0,3)}
                            </button>
                          ))}
                        </div>
                      </div>
                      <div>
                        <label className="block text-[10px] font-black uppercase tracking-widest mb-1.5 text-[#64748b]">Time on {DAY_NAMES[newDayOfWeek]}</label>
                        <select value={newTime} onChange={e => setNewTime(e.target.value)} className="w-full px-3 py-2.5 rounded-xl text-sm outline-none text-[#0f172a]" style={{ border: '2px solid #c7d2fe' }}>
                          {availableBlocks.map(b => <option key={b.time} value={b.time}>{b.label} ({b.display})</option>)}
                        </select>
                      </div>
                    </>
                  )}
                  {editError && (
                    <div className="flex items-center gap-2 px-3 py-2.5 rounded-xl text-xs" style={{ background: '#fef2f2', border: '1px solid #fecaca', color: '#dc2626' }}>
                      <AlertTriangle size={12}/> {editError}
                    </div>
                  )}
                  <div className="flex gap-3 pt-1">
                    <button onClick={closeEdit} className="flex-1 py-2.5 rounded-xl text-sm font-bold text-[#64748b]" style={{ background: '#f8fafc', border: '1px solid #e2e8f0' }}>Cancel</button>
                    <button onClick={handleEditSubmit}
                      disabled={editing || (editTab === 'duration' && newTotalWeeks === editingSeries.totalWeeks) || (editTab === 'day' && newDayOfWeek === editingSeries.dayOfWeek)}
                      className="flex-1 py-2.5 rounded-xl text-sm font-bold text-white active:scale-95"
                      style={{ background: (editing || (editTab==='duration' && newTotalWeeks===editingSeries.totalWeeks) || (editTab==='day' && newDayOfWeek===editingSeries.dayOfWeek)) ? '#94a3b8' : '#4f46e5' }}>
                      {editing ? 'Saving…' : 'Save Changes'}
                    </button>
                  </div>
                </>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Single session edit modal */}
      {singleEdit && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{ background: 'rgba(15,23,42,0.6)', backdropFilter: 'blur(6px)' }}
          onClick={e => { if (e.target === e.currentTarget) closeSingleEdit(); }}>
          <div className="w-full max-w-sm bg-white rounded-2xl overflow-hidden shadow-2xl" style={{ border: '1px solid #e2e8f0' }}
            onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between px-5 py-4" style={{ background: '#1e293b' }}>
              <div>
                <p className="text-sm font-black text-white">{singleEdit.confirmCancel ? 'Cancel Session?' : 'Edit Session'}</p>
                <p className="text-[11px] mt-0.5" style={{ color: 'rgba(255,255,255,0.5)' }}>{singleEdit.series.studentName} · {singleEdit.row.session?.session_date}</p>
              </div>
              <button onClick={closeSingleEdit} className="w-8 h-8 flex items-center justify-center rounded-full" style={{ background: 'rgba(255,255,255,0.1)', color: 'white' }}>
                <X size={15}/>
              </button>
            </div>
            <div className="p-5 space-y-4">
              {singleEdit.confirmCancel ? (
                <div className="space-y-4">
                  <div className="px-4 py-4 rounded-xl" style={{ background: '#fef2f2', border: '1px solid #fecaca' }}>
                    <div className="flex items-center gap-2 mb-1.5"><AlertTriangle size={14} style={{ color: '#dc2626' }}/><p className="text-sm font-black text-[#dc2626]">Cancel this occurrence?</p></div>
                    <p className="text-xs text-[#64748b]">Only <strong>{singleEdit.row.session?.session_date}</strong> is affected. The rest of the series continues.</p>
                  </div>
                  <div className="flex gap-3">
                    <button onClick={() => patchSingle({ confirmCancel: false })} className="flex-1 py-2.5 rounded-xl text-sm font-bold text-[#64748b]" style={{ background: '#f8fafc', border: '1px solid #e2e8f0' }}>Go Back</button>
                    <button onClick={handleSingleCancel} disabled={singleEdit.saving} className="flex-1 py-2.5 rounded-xl text-sm font-bold text-white" style={{ background: singleEdit.saving ? '#94a3b8' : '#dc2626' }}>{singleEdit.saving ? 'Cancelling…' : 'Yes, Cancel It'}</button>
                  </div>
                </div>
              ) : (
                <>
                  <div>
                    <label className="block text-[10px] font-black uppercase tracking-widest mb-1.5 text-[#64748b]">Date</label>
                    <input type="date" value={singleEdit.newDate}
                      onChange={e => { const dow = dowFromIso(e.target.value); const blocks = getSessionsForDay(dow); patchSingle({ newDate: e.target.value, newTime: blocks[0]?.time ?? singleEdit.newTime }); }}
                      className="w-full px-3 py-2.5 rounded-xl text-sm outline-none text-[#0f172a]" style={{ border: '2px solid #e2e8f0' }}/>
                  </div>
                  <div>
                    <label className="block text-[10px] font-black uppercase tracking-widest mb-1.5 text-[#64748b]">Time Slot</label>
                    <select value={singleEdit.newTime} onChange={e => patchSingle({ newTime: e.target.value })} className="w-full px-3 py-2.5 rounded-xl text-sm outline-none text-[#0f172a]" style={{ border: '2px solid #e2e8f0' }}>
                      {singleEditBlocks.map(b => <option key={b.time} value={b.time}>{b.label} ({b.display})</option>)}
                    </select>
                  </div>
                  <div>
                    <label className="block text-[10px] font-black uppercase tracking-widest mb-1.5 text-[#64748b]">Tutor</label>
                    <select value={singleEdit.newTutorId} onChange={e => patchSingle({ newTutorId: e.target.value })} className="w-full px-3 py-2.5 rounded-xl text-sm outline-none text-[#0f172a]" style={{ border: '2px solid #e2e8f0' }}>
                      {tutors.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
                    </select>
                  </div>
                  <div>
                    <label className="block text-[10px] font-black uppercase tracking-widest mb-1.5 text-[#64748b]">Topic</label>
                    <select value={singleEdit.newTopic} onChange={e => patchSingle({ newTopic: e.target.value })} className="w-full px-3 py-2.5 rounded-xl text-sm outline-none text-[#0f172a]" style={{ border: '2px solid #e2e8f0' }}>
                      {ALL_TOPICS.map(t => <option key={t} value={t}>{t}</option>)}
                    </select>
                  </div>
                  {singleEdit.error && (
                    <div className="flex items-center gap-2 px-3 py-2.5 rounded-xl text-xs" style={{ background: '#fef2f2', border: '1px solid #fecaca', color: '#dc2626' }}>
                      <AlertTriangle size={12}/> {singleEdit.error}
                    </div>
                  )}
                  <div className="flex gap-2 pt-1">
                    <button onClick={() => patchSingle({ confirmCancel: true })} className="px-3 py-2.5 rounded-xl text-[11px] font-bold" style={{ background: '#fef2f2', border: '1px solid #fecaca', color: '#dc2626' }}>Cancel Session</button>
                    <div className="flex gap-2 flex-1">
                      <button onClick={closeSingleEdit} className="flex-1 py-2.5 rounded-xl text-sm font-bold text-[#64748b]" style={{ background: '#f8fafc', border: '1px solid #e2e8f0' }}>Discard</button>
                      <button onClick={handleSingleSave} disabled={singleEdit.saving} className="flex-1 py-2.5 rounded-xl text-sm font-bold text-white active:scale-95" style={{ background: singleEdit.saving ? '#94a3b8' : '#1e293b' }}>{singleEdit.saving ? 'Saving…' : 'Save'}</button>
                    </div>
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