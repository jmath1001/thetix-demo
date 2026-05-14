'use client';
import { useEffect, useState, useCallback, useRef } from 'react';
import { supabase } from '@/lib/supabaseClient';
import { DB } from '@/lib/db';
import { toISODate, getCentralTimeNow } from '@/lib/useScheduleData';
import { Loader2, Search, X, ChevronDown, ChevronUp, Calendar, Clock, User, RefreshCw } from 'lucide-react';

const STATUS_OPTIONS = ['present', 'no-show', 'scheduled', 'confirmed'] as const;
type SessionStatus = typeof STATUS_OPTIONS[number] | 'unknown';

const statusStyle: Record<string, { bg: string; color: string; label: string }> = {
  present:   { bg: '#dcfce7', color: '#15803d', label: 'Present' },
  'no-show': { bg: '#fee2e2', color: '#b91c1c', label: 'No-show' },
  scheduled: { bg: '#f3f4f6', color: '#6b7280', label: 'Scheduled' },
  confirmed: { bg: '#dbeafe', color: '#1d4ed8', label: 'Confirmed' },
  unknown:   { bg: '#f3f4f6', color: '#9ca3af', label: 'Not marked' },
};

function formatTime(t: string) {
  const [h, m] = t.split(':');
  const hr = parseInt(h);
  return `${hr > 12 ? hr - 12 : hr || 12}:${m} ${hr >= 12 ? 'PM' : 'AM'}`;
}

type SessionEntry = {
  ssId: string;
  sessionId: string;
  date: string;
  time: string;
  tutorName: string;
  topic: string;
  status: string;
  notes: string | null;
  seriesId: string | null;
  isPast: boolean;
};

type SessionGroup =
  | { kind: 'single'; session: SessionEntry }
  | { kind: 'series'; seriesId: string; topic: string; sessions: SessionEntry[] };

function StatusPicker({ ssId, current, onUpdated }: { ssId: string; current: string; onUpdated: (s: string) => void }) {
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false); };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [open]);

  const displayStatus = current === 'scheduled' ? 'unknown' : current;
  const sc = statusStyle[displayStatus] ?? statusStyle.unknown;

  async function pick(s: string) {
    setSaving(true);
    setOpen(false);
    const { error } = await supabase.from(DB.sessionStudents).update({ status: s }).eq('id', ssId);
    setSaving(false);
    if (!error) onUpdated(s);
  }

  return (
    <div className="relative" ref={ref}>
      <button
        onClick={() => setOpen(o => !o)}
        className="flex items-center gap-1 text-[9px] font-black px-2 py-0.5 rounded-lg transition-opacity"
        style={{ background: sc.bg, color: sc.color }}
        disabled={saving}
      >
        {saving ? <RefreshCw size={9} className="animate-spin" /> : sc.label}
        <ChevronDown size={8} />
      </button>
      {open && (
        <div className="absolute left-0 top-full mt-1 z-50 bg-white rounded-xl border border-[#e7e3dd] shadow-lg overflow-hidden min-w-27.5">
          {STATUS_OPTIONS.map(s => {
            const st = statusStyle[s];
            return (
              <button key={s} onClick={() => pick(s)}
                className="w-full text-left px-3 py-1.5 text-[10px] font-bold hover:bg-[#f7f4ef] flex items-center gap-2 transition-colors"
                style={{ color: st.color }}>
                <span className="w-2 h-2 rounded-full shrink-0" style={{ background: st.color }} />
                {st.label}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

export default function StudentHistoryPage() {
  const [students, setStudents] = useState<any[]>([]);
  const [sessions, setSessions] = useState<any[]>([]);
  const [tutors, setTutors] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [expanded, setExpanded] = useState<string | null>(null);
  // seriesId -> expanded state within a student panel
  const [expandedSeries, setExpandedSeries] = useState<Set<string>>(new Set());
  const [sessionFilter, setSessionFilter] = useState<'all' | 'upcoming' | 'past'>('all');
  // live status overrides keyed by ssId
  const [statusOverrides, setStatusOverrides] = useState<Record<string, string>>({});

  const fetchData = useCallback(async () => {
    setLoading(true);
    const [studentsRes, tutorsRes, sessionsRes] = await Promise.all([
      supabase.from(DB.students).select('*').order('name'),
      supabase.from(DB.tutors).select('id, name').order('name'),
      supabase.from(DB.sessions).select(`
        id, session_date, time, tutor_id,
        ${DB.sessionStudents} ( id, student_id, name, topic, status, notes, series_id )
      `).order('session_date', { ascending: false }),
    ]);
    setStudents(studentsRes.data ?? []);
    setTutors(tutorsRes.data ?? []);
    setSessions(sessionsRes.data ?? []);
    setLoading(false);
  }, []);

  useEffect(() => { fetchData(); }, [fetchData]);

  const today = toISODate(getCentralTimeNow());

  const getStudentSessions = (studentId: string): SessionEntry[] => {
    return sessions
      .flatMap(s => {
        const entry = (s[DB.sessionStudents] ?? []).find((ss: any) => ss.student_id === studentId);
        if (!entry) return [];
        return [{
          ssId: entry.id,
          sessionId: s.id,
          date: s.session_date,
          time: s.time,
          tutorName: tutors.find(t => t.id === s.tutor_id)?.name ?? 'Unknown',
          topic: entry.topic ?? 'Session',
          status: statusOverrides[entry.id] ?? entry.status,
          notes: entry.notes ?? null,
          seriesId: entry.series_id ?? null,
          isPast: s.session_date < today,
        }];
      })
      .sort((a, b) => b.date.localeCompare(a.date));
  };

  const buildGroups = (allSessions: SessionEntry[]): SessionGroup[] => {
    const seriesMap = new Map<string, SessionEntry[]>();
    const result: SessionGroup[] = [];

    for (const s of allSessions) {
      if (s.seriesId) {
        if (!seriesMap.has(s.seriesId)) seriesMap.set(s.seriesId, []);
        seriesMap.get(s.seriesId)!.push(s);
      } else {
        result.push({ kind: 'single', session: s });
      }
    }

    // Insert series groups at the position of their most recent session
    for (const [seriesId, sArr] of seriesMap) {
      const topic = sArr[0].topic;
      result.push({ kind: 'series', seriesId, topic, sessions: sArr });
    }

    result.sort((a, b) => {
      const dateA = a.kind === 'single' ? a.session.date : a.sessions[0].date;
      const dateB = b.kind === 'single' ? b.session.date : b.sessions[0].date;
      return dateB.localeCompare(dateA);
    });

    return result;
  };

  const filtered = students.filter(s =>
    s.name.toLowerCase().includes(search.toLowerCase())
  );

  const colors = ['#ede9fe', '#dbeafe', '#dcfce7', '#fef3c7', '#fce7f3', '#e0f2fe'];
  const textColors = ['#6d28d9', '#1d4ed8', '#15803d', '#92400e', '#be185d', '#0369a1'];

  function SessionRow({ s }: { s: SessionEntry }) {
    const displayStatus = s.isPast && s.status === 'scheduled' ? 'unknown' : s.status;
    return (
      <div className="px-4 py-3 flex items-start gap-3">
        <div className="w-10 h-10 rounded-xl flex flex-col items-center justify-center shrink-0"
          style={{ background: s.isPast ? '#f0ece8' : '#ede9fe' }}>
          <span className="text-[8px] font-black uppercase leading-none"
            style={{ color: s.isPast ? '#a8a29e' : '#6d28d9' }}>
            {new Date(s.date + 'T00:00:00').toLocaleDateString('en-US', { month: 'short' })}
          </span>
          <span className="text-sm font-black leading-none"
            style={{ color: s.isPast ? '#1c1917' : '#6d28d9' }}>
            {new Date(s.date + 'T00:00:00').getDate()}
          </span>
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <p className="text-sm font-bold text-[#1c1917]">{s.topic}</p>
            <StatusPicker ssId={s.ssId} current={displayStatus}
              onUpdated={newStatus => setStatusOverrides(prev => ({ ...prev, [s.ssId]: newStatus }))} />
          </div>
          <div className="flex items-center gap-2 mt-0.5 flex-wrap">
            <span className="text-[10px] text-[#a8a29e] flex items-center gap-1"><User size={9} /> {s.tutorName}</span>
            <span className="text-[10px] text-[#a8a29e] flex items-center gap-1"><Clock size={9} /> {formatTime(s.time)}</span>
          </div>
          {s.notes && <p className="text-[10px] mt-1 italic text-[#a8a29e]">📝 {s.notes}</p>}
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen pb-20" style={{ background: '#f7f4ef', fontFamily: 'ui-sans-serif, system-ui, sans-serif' }}>
      {/* Header */}
      <div className="sticky top-0 z-40 bg-white/90 backdrop-blur-md border-b border-[#e7e3dd]">
        <div className="max-w-3xl mx-auto px-5 h-14 flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <div className="w-7 h-7 rounded-lg bg-[#c27d38] flex items-center justify-center">
              <Calendar size={14} className="text-white" />
            </div>
            <div>
              <h1 className="text-sm font-black text-[#1c1917] leading-none">Session History</h1>
              <p className="text-[9px] font-semibold uppercase tracking-widest text-[#c27d38]">All Students</p>
            </div>
          </div>
          <div className="flex gap-0.5 p-0.5 rounded-lg" style={{ background: '#ede8e1' }}>
            {(['all', 'upcoming', 'past'] as const).map(f => (
              <button key={f} onClick={() => setSessionFilter(f)}
                className="px-3 py-1 rounded-md text-[10px] font-black uppercase tracking-wider transition-all"
                style={sessionFilter === f
                  ? { background: 'white', color: '#1c1008', boxShadow: '0 1px 3px rgba(0,0,0,0.1)' }
                  : { color: '#9e8e7e' }}>
                {f}
              </button>
            ))}
          </div>
        </div>
      </div>

      <div className="max-w-3xl mx-auto px-5 pt-5 space-y-3">
        <div className="relative">
          <Search size={14} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-[#a8a29e]" />
          <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search students..."
            className="w-full pl-9 pr-4 py-2.5 bg-white border border-[#e7e3dd] rounded-xl text-sm text-[#1c1917] outline-none focus:ring-2 focus:ring-[#6d28d9]/20 focus:border-[#6d28d9] transition-all placeholder:text-[#c4bfba]" />
          {search && <button onClick={() => setSearch('')} className="absolute right-3 top-1/2 -translate-y-1/2 text-[#a8a29e]"><X size={13} /></button>}
        </div>

        {loading ? (
          <div className="flex flex-col items-center py-24 gap-3">
            <Loader2 size={22} className="animate-spin text-[#6d28d9]" />
            <p className="text-xs font-semibold text-[#a8a29e] uppercase tracking-widest">Loading…</p>
          </div>
        ) : (
          <div className="space-y-2">
            {filtered.map(student => {
              const allSessions = getStudentSessions(student.id);
              const filteredSessions = sessionFilter === 'upcoming'
                ? allSessions.filter(s => !s.isPast)
                : sessionFilter === 'past'
                  ? allSessions.filter(s => s.isPast)
                  : allSessions;
              const groups = buildGroups(filteredSessions);
              const upcomingCount = allSessions.filter(s => !s.isPast).length;
              const pastCount = allSessions.filter(s => s.isPast).length;
              const presentCount = allSessions.filter(s => s.isPast && (s.status === 'present' || s.status === 'confirmed')).length;
              const colorIdx = student.name.charCodeAt(0) % colors.length;
              const isOpen = expanded === student.id;

              return (
                <div key={student.id} className={`bg-white rounded-2xl border-2 transition-all overflow-hidden ${isOpen ? 'border-[#c4b5fd]' : 'border-[#f0ece8] hover:border-[#e7e3dd]'}`}>
                  <button className="w-full p-4 flex items-center gap-3 text-left" onClick={() => setExpanded(isOpen ? null : student.id)}>
                    <div className="w-10 h-10 rounded-xl flex items-center justify-center text-sm font-black shrink-0"
                      style={{ background: colors[colorIdx], color: textColors[colorIdx] }}>
                      {student.name.split(' ').map((n: string) => n[0]).join('').slice(0, 2).toUpperCase()}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <p className="font-black text-[#1c1917] text-sm">{student.name}</p>
                        {student.grade && <span className="text-[9px] font-black px-1.5 py-0.5 rounded-md bg-[#ede9fe] text-[#6d28d9]">Gr. {student.grade}</span>}
                      </div>
                      <div className="flex items-center gap-3 mt-0.5">
                        <span className="text-[10px] text-[#a8a29e]">{allSessions.length} total sessions</span>
                        {upcomingCount > 0 && <span className="text-[10px] font-bold text-[#6d28d9]">{upcomingCount} upcoming</span>}
                        {pastCount > 0 && <span className="text-[10px] text-[#a8a29e]">{presentCount}/{pastCount} attended</span>}
                      </div>
                    </div>
                    {isOpen ? <ChevronUp size={14} className="text-[#a8a29e] shrink-0" /> : <ChevronDown size={14} className="text-[#a8a29e] shrink-0" />}
                  </button>

                  {isOpen && (
                    <div className="border-t border-[#f0ece8]">
                      {groups.length === 0 ? (
                        <div className="p-6 text-center">
                          <p className="text-sm text-[#a8a29e] italic">No {sessionFilter !== 'all' ? sessionFilter : ''} sessions</p>
                        </div>
                      ) : (
                        <div className="divide-y divide-[#f0ece8]">
                          {groups.map((g, gi) => {
                            if (g.kind === 'single') {
                              return <SessionRow key={g.session.ssId} s={g.session} />;
                            }
                            // Recurring series group
                            const seriesKey = `${student.id}::${g.seriesId}`;
                            const seriesOpen = expandedSeries.has(seriesKey);
                            const attendedInSeries = g.sessions.filter(s => s.isPast && (s.status === 'present' || s.status === 'confirmed')).length;
                            const pastInSeries = g.sessions.filter(s => s.isPast).length;
                            return (
                              <div key={g.seriesId}>
                                <button
                                  className="w-full px-4 py-2.5 flex items-center gap-2 text-left hover:bg-[#faf8f6] transition-colors"
                                  onClick={() => setExpandedSeries(prev => {
                                    const next = new Set(prev);
                                    seriesOpen ? next.delete(seriesKey) : next.add(seriesKey);
                                    return next;
                                  })}>
                                  <div className="w-6 h-6 rounded-lg bg-[#ede9fe] flex items-center justify-center shrink-0">
                                    <RefreshCw size={10} className="text-[#6d28d9]" />
                                  </div>
                                  <div className="flex-1 min-w-0">
                                    <span className="text-xs font-black text-[#6d28d9]">{g.topic}</span>
                                    <span className="text-[10px] text-[#a8a29e] ml-2">
                                      {g.sessions.length} sessions
                                      {pastInSeries > 0 && ` · ${attendedInSeries}/${pastInSeries} attended`}
                                    </span>
                                  </div>
                                  {seriesOpen
                                    ? <ChevronUp size={12} className="text-[#a8a29e] shrink-0" />
                                    : <ChevronDown size={12} className="text-[#a8a29e] shrink-0" />}
                                </button>
                                {seriesOpen && (
                                  <div className="divide-y divide-[#f0ece8] bg-[#faf8f6]">
                                    {g.sessions.map(s => <SessionRow key={s.ssId} s={s} />)}
                                  </div>
                                )}
                              </div>
                            );
                          })}
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
    </div>
  );
}