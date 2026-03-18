'use client';
import { useEffect, useState, useCallback } from 'react';
import { supabase } from '@/lib/supabaseClient';
import { toISODate, getCentralTimeNow } from '@/lib/useScheduleData';
import { Loader2, Search, X, ChevronDown, ChevronUp, Calendar, Clock, User } from 'lucide-react';

const statusStyle: Record<string, { bg: string; color: string; label: string }> = {
  present:   { bg: '#dcfce7', color: '#15803d', label: 'Present' },
  'no-show': { bg: '#fee2e2', color: '#b91c1c', label: 'No-show' },
  scheduled: { bg: '#ede9fe', color: '#6d28d9', label: 'Scheduled' },
  confirmed: { bg: '#dcfce7', color: '#15803d', label: 'Confirmed' },
};

function formatDate(d: string) {
  return new Date(d + 'T00:00:00').toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' });
}

function formatTime(t: string) {
  const [h, m] = t.split(':');
  const hr = parseInt(h);
  return `${hr > 12 ? hr - 12 : hr || 12}:${m} ${hr >= 12 ? 'PM' : 'AM'}`;
}

export default function StudentHistoryPage() {
  const [students, setStudents] = useState<any[]>([]);
  const [sessions, setSessions] = useState<any[]>([]);
  const [tutors, setTutors] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [expanded, setExpanded] = useState<string | null>(null);
  const [sessionFilter, setSessionFilter] = useState<'all' | 'upcoming' | 'past'>('all');

  const fetchData = useCallback(async () => {
    setLoading(true);
    const [studentsRes, tutorsRes, sessionsRes] = await Promise.all([
      supabase.from('slake_students').select('*').order('name'),
      supabase.from('slake_tutors').select('id, name').order('name'),
      supabase.from('slake_sessions').select(`
        id, session_date, time, tutor_id,
        slake_session_students ( id, student_id, name, topic, status, notes )
      `).order('session_date', { ascending: false }),
    ]);
    setStudents(studentsRes.data ?? []);
    setTutors(tutorsRes.data ?? []);
    setSessions(sessionsRes.data ?? []);
    setLoading(false);
  }, []);

  useEffect(() => { fetchData(); }, [fetchData]);

  const today = toISODate(getCentralTimeNow());

  const getStudentSessions = (studentId: string) => {
    return sessions
      .flatMap(s => {
        const entry = (s.slake_session_students ?? []).find((ss: any) => ss.student_id === studentId);
        if (!entry) return [];
        return [{
          date: s.session_date,
          time: s.time,
          tutorName: tutors.find(t => t.id === s.tutor_id)?.name ?? 'Unknown',
          topic: entry.topic,
          status: entry.status,
          notes: entry.notes,
          isPast: s.session_date < today,
        }];
      })
      .sort((a, b) => b.date.localeCompare(a.date));
  };

  const filtered = students.filter(s =>
    s.name.toLowerCase().includes(search.toLowerCase())
  );

  const colors = ['#ede9fe', '#dbeafe', '#dcfce7', '#fef3c7', '#fce7f3', '#e0f2fe'];
  const textColors = ['#6d28d9', '#1d4ed8', '#15803d', '#92400e', '#be185d', '#0369a1'];

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
          {/* Filter */}
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
        {/* Search */}
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
              const displaySessions = sessionFilter === 'upcoming'
                ? allSessions.filter(s => !s.isPast)
                : sessionFilter === 'past'
                  ? allSessions.filter(s => s.isPast)
                  : allSessions;
              const upcomingCount = allSessions.filter(s => !s.isPast).length;
              const pastCount = allSessions.filter(s => s.isPast).length;
              const presentCount = allSessions.filter(s => s.status === 'present').length;
              const colorIdx = student.name.charCodeAt(0) % colors.length;
              const isOpen = expanded === student.id;

              return (
                <div key={student.id} className={`bg-white rounded-2xl border-2 transition-all overflow-hidden ${isOpen ? 'border-[#c4b5fd]' : 'border-[#f0ece8] hover:border-[#e7e3dd]'}`}>
                  {/* Student row */}
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

                  {/* Sessions list */}
                  {isOpen && (
                    <div className="border-t border-[#f0ece8]">
                      {displaySessions.length === 0 ? (
                        <div className="p-6 text-center">
                          <p className="text-sm text-[#a8a29e] italic">No {sessionFilter !== 'all' ? sessionFilter : ''} sessions</p>
                        </div>
                      ) : (
                        <div className="divide-y divide-[#f0ece8]">
                          {displaySessions.map((s, i) => {
                            const sc = statusStyle[s.status] ?? statusStyle.scheduled;
                            return (
                              <div key={i} className="px-4 py-3 flex items-start gap-3">
                                {/* Date block */}
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
                                {/* Info */}
                                <div className="flex-1 min-w-0">
                                  <div className="flex items-center gap-2 flex-wrap">
                                    <p className="text-sm font-bold text-[#1c1917]">{s.topic}</p>
                                    <span className="text-[9px] font-black px-2 py-0.5 rounded-lg" style={{ background: sc.bg, color: sc.color }}>{sc.label}</span>
                                  </div>
                                  <div className="flex items-center gap-2 mt-0.5 flex-wrap">
                                    <span className="text-[10px] text-[#a8a29e] flex items-center gap-1"><User size={9} /> {s.tutorName}</span>
                                    <span className="text-[10px] text-[#a8a29e] flex items-center gap-1"><Clock size={9} /> {formatTime(s.time)}</span>
                                  </div>
                                  {s.notes && <p className="text-[10px] mt-1 italic text-[#a8a29e]">📝 {s.notes}</p>}
                                </div>
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