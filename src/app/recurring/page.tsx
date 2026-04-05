'use client';
import { useState, useEffect, useCallback } from 'react';
import { supabase } from '@/lib/supabaseClient';
import { DB } from '@/lib/db';
import {
  fetchAllSeries, fetchSeriesSessions, cancelSeries,
  rescheduleSeries, markCompletedSeries,
  type RecurringSeries, type Tutor, type Student, toISODate,
} from '@/lib/useScheduleData';
import { getSessionsForDay } from '@/components/constants';
import { Repeat, X, AlertTriangle, RefreshCw, Calendar, User, BookOpen, Edit3, Clock, Pencil, Trash2, ChevronDown, ChevronUp } from 'lucide-react';
import { logEvent } from '@/lib/analytics';

const DAY_NAMES: Record<number, string> = {
  1:'Monday',2:'Tuesday',3:'Wednesday',4:'Thursday',5:'Friday',6:'Saturday',7:'Sunday',
};

const MATH_TOPICS = ['Algebra','Geometry','Pre-Calculus','Calculus','Statistics','SAT Math','ACT Math','Math'];
const ENG_TOPICS  = ['Reading','Writing','Grammar','Essay','SAT English','ACT English','English'];
const ALL_TOPICS  = [...MATH_TOPICS, ...ENG_TOPICS, 'Other'];

type SessionRow = {
  id: string; status: string; notes: string | null; topic: string | null; tutorId: string | null;
  slake_sessions: { id: string; session_date: string; time: string; tutor_id: string } | null;
};
type EditTab = 'schedule' | 'duration' | 'day';
type SingleSessionEdit = {
  row: SessionRow; series: RecurringSeries;
  newDate: string; newTime: string; newTutorId: string; newTopic: string;
  saving: boolean; error: string | null; confirmCancel: boolean;
};

function addWeeks(d: string, w: number) {
  const date = new Date(d + 'T00:00:00'); date.setDate(date.getDate() + w * 7); return toISODate(date);
}
function endDateFromWeeks(start: string, weeks: number) { return addWeeks(start, weeks - 1); }
function dowFromIso(d: string) { const dt = new Date(d + 'T00:00:00'); return dt.getDay() === 0 ? 7 : dt.getDay(); }
function normaliseRows(data: any[]): SessionRow[] {
  return data.map(r => ({
    id: r.id, status: r.status, notes: r.notes, topic: r.topic ?? null,
    tutorId: r.slake_sessions ? (Array.isArray(r.slake_sessions) ? r.slake_sessions[0]?.tutor_id : r.slake_sessions?.tutor_id) ?? null : null,
    slake_sessions: Array.isArray(r.slake_sessions) ? r.slake_sessions[0] || null : r.slake_sessions || null,
  }));
}

function SessionDot({ status, date, isPast, onClick }: { status: string; date: string; isPast: boolean; onClick?: () => void }) {
  const color =
    status === 'present' || status === 'confirmed' ? '#16a34a' :
    status === 'no-show' ? '#dc2626' :
    status === 'cancelled' ? '#e2e8f0' :
    isPast ? '#f59e0b' : '#dc2626';
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

function SeriesCard({ s, tutors, students, today, onEdit, onCancelSeries, onDelete, onEditSession, onCancelSession }: {
  s: RecurringSeries; tutors: Tutor[]; students: Student[]; today: string;
  onEdit: (s: RecurringSeries) => void;
  onCancelSeries: (id: string) => void;
  onDelete: (id: string) => void;
  onEditSession: (row: SessionRow, s: RecurringSeries) => void;
  onCancelSession: (row: SessionRow, s: RecurringSeries) => void;
}) {
  const [sessions, setSessions] = useState<SessionRow[]>([]);
  const [loadingSessions, setLoadingSessions] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const [confirmAction, setConfirmAction] = useState<'cancel' | 'delete' | null>(null);

  const loadSessions = async () => {
    if (sessions.length > 0) return;
    setLoadingSessions(true);
    try { const data = await fetchSeriesSessions(s.id); setSessions(normaliseRows(data)); } catch {}
    setLoadingSessions(false);
  };

  const toggle = () => { if (!expanded) loadSessions(); setExpanded(e => !e); };

  const past = sessions.filter(r => (r.slake_sessions?.session_date ?? '') < today);
  const future = sessions.filter(r => (r.slake_sessions?.session_date ?? '') >= today && r.status !== 'cancelled');
  const present = past.filter(r => r.status === 'present' || r.status === 'confirmed').length;
  const noShow = past.filter(r => r.status === 'no-show').length;
  const attended = past.filter(r => r.status !== 'cancelled').length;
  const rate = attended > 0 ? Math.round((present / attended) * 100) : null;
  const statusColor = s.status === 'active' ? '#dc2626' : s.status === 'completed' ? '#16a34a' : '#94a3b8';
  const statusBg = s.status === 'active' ? '#fff5f5' : s.status === 'completed' ? '#f0fdf4' : '#f8fafc';
  const totalSessions = sessions.filter(r => r.status !== 'cancelled').length || s.totalWeeks;
  const completedSessions = past.filter(r => r.status !== 'cancelled').length;
  const progressPct = totalSessions > 0 ? Math.round((completedSessions / totalSessions) * 100) : 0;

  return (
    <div className="bg-white rounded-2xl overflow-hidden transition-all"
      style={{ border: `1.5px solid ${expanded ? statusColor + '60' : '#f1f5f9'}` }}>
      <div className="p-5">
        <div className="flex items-start gap-4">
          <div className="shrink-0">
            <div className="w-11 h-11 rounded-xl flex items-center justify-center text-sm font-black text-white"
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
              <span className="text-[11px] text-[#64748b] flex items-center gap-1"><User size={10}/> {s.tutorName}</span>
              <span className="text-[11px] text-[#64748b] flex items-center gap-1"><Calendar size={10}/> {DAY_NAMES[s.dayOfWeek]}s</span>
              <span className="text-[11px] text-[#64748b] flex items-center gap-1"><Clock size={10}/> {s.time}</span>
              <span className="text-[11px] text-[#64748b] flex items-center gap-1"><BookOpen size={10}/> {s.topic}</span>
            </div>
            <div className="flex items-center gap-3 mt-2">
              <span className="text-[10px] text-[#94a3b8]">{s.startDate} → {s.endDate}</span>
              <span className="text-[10px] font-bold text-[#94a3b8]">{s.totalWeeks}wk</span>
              {sessions.length > 0 && rate !== null && (
                <>
                  <span className="text-[#e2e8f0]">·</span>
                  <span className="text-[10px] font-bold" style={{ color: rate >= 80 ? '#16a34a' : rate >= 60 ? '#f59e0b' : '#dc2626' }}>{rate}% attendance</span>
                  {noShow > 0 && <span className="text-[10px] text-[#94a3b8]">{noShow} no-show{noShow !== 1 ? 's' : ''}</span>}
                </>
              )}
            </div>
            {sessions.length > 0 && (
              <div className="mt-2.5 flex items-center gap-2">
                <div className="flex-1 h-1.5 rounded-full bg-[#f1f5f9] overflow-hidden">
                  <div className="h-full rounded-full transition-all" style={{ width: `${progressPct}%`, background: statusColor }}/>
                </div>
                <span className="text-[10px] text-[#94a3b8] shrink-0">{completedSessions}/{totalSessions}</span>
              </div>
            )}
          </div>
          <div className="flex items-center gap-1.5 shrink-0">
            {s.status === 'active' && (
              <>
                <button onClick={() => onEdit(s)} className="px-3 py-1.5 rounded-lg text-[11px] font-bold transition-all flex items-center gap-1"
                  style={{ background: '#fff5f5', border: '1px solid #fecaca', color: '#dc2626' }}>
                  <Edit3 size={11}/> Edit
                </button>
                <button onClick={() => setConfirmAction('cancel')} className="p-1.5 rounded-lg text-[#94a3b8] transition-colors hover:text-[#dc2626] hover:bg-[#fff5f5]">
                  <X size={14}/>
                </button>
              </>
            )}
            {s.status !== 'active' && (
              <button onClick={() => setConfirmAction('delete')} className="p-1.5 rounded-lg text-[#cbd5e1] transition-colors hover:text-[#dc2626] hover:bg-[#fff5f5]">
                <Trash2 size={14}/>
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
          <div className="px-5 py-4">
            {loadingSessions ? (
              <div className="flex items-center gap-2 text-xs text-[#94a3b8]"><RefreshCw size={12} className="animate-spin"/> Loading sessions…</div>
            ) : sessions.length === 0 ? (
              <p className="text-xs text-[#94a3b8] italic">No sessions found</p>
            ) : (
              <>
                <p className="text-[9px] font-black uppercase tracking-widest text-[#94a3b8] mb-3">Session Timeline · {sessions.length} sessions</p>
                <div className="flex flex-wrap gap-2 mb-4">
                  {sessions.sort((a, b) => (a.slake_sessions?.session_date ?? '').localeCompare(b.slake_sessions?.session_date ?? '')).map(row => {
                    const date = row.slake_sessions?.session_date ?? '';
                    const isPast = date < today;
                    const canEdit = s.status === 'active' && row.status !== 'cancelled' && date >= today;
                    return <SessionDot key={row.id} status={row.status} date={date} isPast={isPast} onClick={canEdit ? () => onEditSession(row, s) : undefined} />;
                  })}
                </div>
                <div className="flex items-center gap-4 mb-4">
                  {[['#16a34a','Present'],['#dc2626','No-show / Upcoming'],['#f59e0b','Unmarked'],['#e2e8f0','Cancelled']].map(([c,l]) => (
                    <div key={l} className="flex items-center gap-1.5">
                      <div className="w-2.5 h-2.5 rounded-full" style={{ background: c }}/><span className="text-[9px] text-[#94a3b8]">{l}</span>
                    </div>
                  ))}
                </div>
                {future.length > 0 && (
                  <div>
                    <p className="text-[9px] font-black uppercase tracking-widest text-[#dc2626] mb-2">Upcoming · {future.length}</p>
                    <div className="space-y-1.5">
                      {future.slice(0, 4).map(row => {
                        const date = row.slake_sessions?.session_date ?? '';
                        const d = new Date(date + 'T00:00:00');
                        const canEdit = s.status === 'active' && row.status !== 'cancelled';
                        return (
                          <div key={row.id} className="flex items-center gap-3 px-3 py-2.5 rounded-xl group" style={{ background: '#fafafa', border: '1px solid #f1f5f9' }}>
                            <div className="text-center shrink-0 w-8">
                              <p className="text-[8px] font-black uppercase text-[#94a3b8] leading-none">{d.toLocaleDateString('en-US', { month: 'short' })}</p>
                              <p className="text-sm font-black text-[#1e293b] leading-tight">{d.getDate()}</p>
                            </div>
                            <div className="flex-1 min-w-0">
                              <p className="text-xs font-bold text-[#1e293b] truncate">{row.topic ?? s.topic}</p>
                              <p className="text-[10px] text-[#94a3b8]">{DAY_NAMES[s.dayOfWeek]} · {row.slake_sessions?.time ?? s.time}</p>
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
                      {future.length > 4 && <p className="text-[10px] text-[#94a3b8] text-center pt-1">+{future.length - 4} more upcoming</p>}
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

  const today = toISODate(new Date());

  const load = useCallback(async () => {
    setLoading(true); setError(null);
    try {
      await markCompletedSeries();
      const [seriesData, tutorRes, studentRes] = await Promise.all([
        fetchAllSeries(),
        supabase.from(DB.tutors).select('*').order('name'),
        supabase.from(DB.students).select('*').order('name'),
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
    } catch (e: any) { setError(e.message); }
    setLoading(false);
  }, []);

  useEffect(() => { load(); }, [load]);

  const handleCancelSeries = async (id: string) => {
    try { await cancelSeries(id); logEvent('recurring_series_cancelled', { seriesId: id }); await load(); }
    catch (e: any) { alert(e.message); }
  };

  const handleDelete = async (id: string) => {
    try { await supabase.from(DB.recurringSeries).delete().eq('id', id); await load(); }
    catch (e: any) { alert(e.message); }
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
          const dropping = sessions.filter(r => { const d = r.slake_sessions?.session_date ?? ''; return d >= today && d > newEnd; }).length;
          if (dropping > 0) { setSessionsToRemove(dropping); setConfirmStep(true); return; }
        } catch {}
      }
    }
    if (editTab === 'day') {
      try {
        const sessions = await getSeriesSessions(editingSeries.id);
        const future = sessions.filter(r => (r.slake_sessions?.session_date ?? '') >= today).length;
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
        const toDrop = sessions.filter(r => { const d = r.slake_sessions?.session_date ?? ''; return d >= today && d > newEnd; }).map(r => r.id);
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
            const { error: ee } = await supabase.from(DB.sessionStudents).insert({ session_id: sessionId, student_id: student.id, name: student.name, topic: editingSeries.topic, status: 'scheduled', series_id: editingSeries.id });
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
    const date = row.slake_sessions?.session_date ?? '';
    setSingleEdit({ row, series: s, newDate: date, newTime: row.slake_sessions?.time ?? s.time, newTutorId: row.slake_sessions?.tutor_id ?? s.tutorId, newTopic: row.topic ?? s.topic, saving: false, error: null, confirmCancel: false });
  };

  const openSingleCancel = (row: SessionRow, s: RecurringSeries) => {
    setSingleEdit({ row, series: s, newDate: row.slake_sessions?.session_date ?? '', newTime: row.slake_sessions?.time ?? s.time, newTutorId: row.slake_sessions?.tutor_id ?? s.tutorId, newTopic: row.topic ?? s.topic, saving: false, error: null, confirmCancel: true });
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
      const { error: ie } = await supabase.from(DB.sessionStudents).insert({ session_id: newSessionId, student_id: s.studentId, name: student?.name ?? s.studentName, topic: newTopic, status: 'scheduled', series_id: s.id });
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
      logEvent('recurring_session_cancelled', { seriesId: singleEdit.series.id, date: singleEdit.row.slake_sessions?.session_date });
      await load();
    } catch (e: any) { patchSingle({ saving: false, error: e.message }); }
  };

  const filtered = statusFilter === 'all' ? series : series.filter(s => s.status === statusFilter);
  const counts = { all: series.length, active: series.filter(s => s.status === 'active').length, completed: series.filter(s => s.status === 'completed').length, cancelled: series.filter(s => s.status === 'cancelled').length };

  return (
    <div className="min-h-screen pb-20" style={{ background: '#f8fafc', fontFamily: 'ui-sans-serif, system-ui, sans-serif' }}>
      <div className="sticky top-0 z-40 bg-white border-b border-[#f1f5f9]">
        <div className="max-w-4xl mx-auto px-5 h-14 flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <div className="w-7 h-7 rounded-lg bg-[#dc2626] flex items-center justify-center">
              <Repeat size={14} className="text-white"/>
            </div>
            <div>
              <h1 className="text-sm font-black text-[#0f172a] leading-none">Recurring</h1>
              <p className="text-[9px] font-bold uppercase tracking-widest text-[#dc2626]">C2 Education</p>
            </div>
          </div>
          <button onClick={load} disabled={loading} className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold text-[#64748b]" style={{ background: '#f1f5f9' }}>
            <RefreshCw size={11} className={loading ? 'animate-spin' : ''}/> Refresh
          </button>
        </div>
      </div>

      <div className="max-w-4xl mx-auto px-5 pt-5 space-y-4">
        <div className="flex items-center gap-2 flex-wrap">
          {([
            { key: 'all', label: 'All', color: '#0f172a', bg: 'white', activeBg: '#0f172a' },
            { key: 'active', label: 'Active', color: '#dc2626', bg: '#fff5f5', activeBg: '#dc2626' },
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
          <div className="flex items-center justify-center py-20 gap-3 text-[#94a3b8]">
            <RefreshCw size={18} className="animate-spin"/><span className="text-sm">Loading…</span>
          </div>
        ) : filtered.length === 0 ? (
          <div className="text-center py-20 bg-white rounded-2xl" style={{ border: '1.5px dashed #e2e8f0' }}>
            <Repeat size={28} className="mx-auto mb-3 text-[#cbd5e1]"/>
            <p className="text-sm font-bold text-[#94a3b8]">No {statusFilter !== 'all' ? statusFilter : ''} recurring series</p>
          </div>
        ) : (
          <div className="space-y-3">
            {filtered.map(s => (
              <SeriesCard key={s.id} s={s} tutors={tutors} students={students} today={today}
                onEdit={openEdit} onCancelSeries={handleCancelSeries} onDelete={handleDelete}
                onEditSession={openSingleEdit} onCancelSession={openSingleCancel} />
            ))}
          </div>
        )}
      </div>

      {/* Series edit modal */}
      {editingSeries && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{ background: 'rgba(15,23,42,0.6)', backdropFilter: 'blur(6px)' }}>
          <div className="w-full max-w-md bg-white rounded-2xl overflow-hidden shadow-2xl" style={{ border: '1px solid #fecaca' }}>
            <div className="flex items-center justify-between px-5 py-4" style={{ background: '#dc2626' }}>
              <div>
                <p className="text-sm font-black text-white">Edit Series</p>
                <p className="text-[11px] text-red-200 mt-0.5">{editingSeries.studentName} · {DAY_NAMES[editingSeries.dayOfWeek]}s · {editingSeries.totalWeeks}wk</p>
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
                  style={editTab === tab.key ? { borderBottom: '2px solid #dc2626', color: '#dc2626', background: '#fff5f5' } : { borderBottom: '2px solid transparent', color: '#94a3b8' }}>
                  {tab.icon} {tab.label}
                </button>
              ))}
            </div>
            <div className="p-5 space-y-4">
              {confirmStep ? (
                <div className="space-y-4">
                  <div className="px-4 py-4 rounded-xl" style={{ background: '#fef2f2', border: '1px solid #fecaca' }}>
                    <div className="flex items-center gap-2 mb-2"><AlertTriangle size={16} style={{ color: '#dc2626' }}/>
                      <p className="text-sm font-black text-[#dc2626]">{sessionsToRemove} future session{sessionsToRemove !== 1 ? 's' : ''} will be cancelled</p>
                    </div>
                    <p className="text-xs text-[#64748b] leading-relaxed">
                      {editTab === 'duration' ? `Shortening to ${newTotalWeeks} weeks will remove ${sessionsToRemove} scheduled session${sessionsToRemove !== 1 ? 's' : ''}.` : `Moving to ${DAY_NAMES[newDayOfWeek]}s will cancel and recreate ${sessionsToRemove} future session${sessionsToRemove !== 1 ? 's' : ''}.`}
                    </p>
                  </div>
                  <div className="flex gap-3">
                    <button onClick={() => setConfirmStep(false)} className="flex-1 py-2.5 rounded-xl text-sm font-bold text-[#64748b]" style={{ background: '#f8fafc', border: '1px solid #e2e8f0' }}>Go Back</button>
                    <button onClick={commitEdit} disabled={editing} className="flex-1 py-2.5 rounded-xl text-sm font-bold text-white" style={{ background: editing ? '#94a3b8' : '#dc2626' }}>{editing ? 'Saving…' : 'Yes, Proceed'}</button>
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
                        <select value={newTutorId} onChange={e => setNewTutorId(e.target.value)} className="w-full px-3 py-2.5 rounded-xl text-sm outline-none text-[#0f172a]" style={{ border: '2px solid #fecaca' }}>
                          {tutors.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
                        </select>
                      </div>
                      <div>
                        <label className="block text-[10px] font-black uppercase tracking-widest mb-1.5 text-[#64748b]">Time Slot</label>
                        <select value={newTime} onChange={e => setNewTime(e.target.value)} className="w-full px-3 py-2.5 rounded-xl text-sm outline-none text-[#0f172a]" style={{ border: '2px solid #fecaca' }}>
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
                          <button onClick={() => setNewTotalWeeks(w => Math.max(1, w - 1))} className="w-9 h-9 rounded-xl text-lg font-black active:scale-95" style={{ background: '#fff5f5', border: '1.5px solid #fecaca', color: '#dc2626' }}>−</button>
                          <div className="flex-1 text-center"><span className="text-3xl font-black text-[#0f172a]">{newTotalWeeks}</span><span className="text-sm ml-1.5 text-[#64748b]">weeks</span></div>
                          <button onClick={() => setNewTotalWeeks(w => w + 1)} className="w-9 h-9 rounded-xl text-lg font-black active:scale-95" style={{ background: '#fff5f5', border: '1.5px solid #fecaca', color: '#dc2626' }}>+</button>
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
                              style={newDayOfWeek === d ? { background: '#dc2626', color: 'white', border: '2px solid #b91c1c' } : { background: '#f8fafc', color: '#64748b', border: '1.5px solid #e2e8f0' }}>
                              {DAY_NAMES[d].slice(0,3)}
                            </button>
                          ))}
                        </div>
                      </div>
                      <div>
                        <label className="block text-[10px] font-black uppercase tracking-widest mb-1.5 text-[#64748b]">Time on {DAY_NAMES[newDayOfWeek]}</label>
                        <select value={newTime} onChange={e => setNewTime(e.target.value)} className="w-full px-3 py-2.5 rounded-xl text-sm outline-none text-[#0f172a]" style={{ border: '2px solid #fecaca' }}>
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
                      style={{ background: (editing || (editTab==='duration' && newTotalWeeks===editingSeries.totalWeeks) || (editTab==='day' && newDayOfWeek===editingSeries.dayOfWeek)) ? '#94a3b8' : '#dc2626' }}>
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
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{ background: 'rgba(15,23,42,0.6)', backdropFilter: 'blur(6px)' }}>
          <div className="w-full max-w-sm bg-white rounded-2xl overflow-hidden shadow-2xl" style={{ border: '1px solid #e2e8f0' }}>
            <div className="flex items-center justify-between px-5 py-4" style={{ background: '#1e293b' }}>
              <div>
                <p className="text-sm font-black text-white">{singleEdit.confirmCancel ? 'Cancel Session?' : 'Edit Session'}</p>
                <p className="text-[11px] mt-0.5" style={{ color: 'rgba(255,255,255,0.5)' }}>{singleEdit.series.studentName} · {singleEdit.row.slake_sessions?.session_date}</p>
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
                    <p className="text-xs text-[#64748b]">Only <strong>{singleEdit.row.slake_sessions?.session_date}</strong> is affected. The rest of the series continues.</p>
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