"use client"
import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { Plus, Trash2, GraduationCap, Loader2, Save, X, Search, ChevronDown, ChevronUp, ExternalLink, BarChart2, AlertTriangle } from 'lucide-react';
import { supabase } from '@/lib/supabaseClient';
import { BookingForm, BookingToast } from '@/components/BookingForm';
import {
  bookStudent, getWeekStart, getWeekDates, toISODate, dayOfWeek, getCentralTimeNow,
} from '@/lib/useScheduleData';
import { getSessionsForDay } from '@/components/constants';
import { logEvent } from '@/lib/analytics';

// ── Table names ───────────────────────────────────────────────────────────────
const p       = process.env.NEXT_PUBLIC_TABLE_PREFIX ?? 'slake'
const TUTORS   = `${p}_tutors`
const STUDENTS = `${p}_students`
const SESSIONS = `${p}_sessions`
const SS       = `${p}_session_students`

const EMPTY_FORM = { name: '', grade: '', email: '', phone: '', parent_name: '', parent_email: '', parent_phone: '' };
const ACTIVE_DAYS = [1, 2, 3, 4, 6];
const DAY_NAMES = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Saturday'];
const MAX_CAPACITY = 3;

const isTutorAvailable = (tutor: any, dow: number, time: string) =>
  tutor.availability_blocks?.includes(`${dow}-${time}`);

const inputCls = "w-full px-3 py-2 bg-[#f8fafc] rounded-lg text-sm text-black outline-none focus:ring-2 focus:ring-[#dc2626] border border-[#e2e8f0] focus:border-[#dc2626] placeholder:text-[#94a3b8] transition-colors";

const STATUS_META: Record<string, { bg: string; text: string; label: string }> = {
  present:   { bg: '#f0fdf4', text: '#16a34a', label: 'Present' },
  'no-show': { bg: '#fef2f2', text: '#dc2626', label: 'No-show' },
  scheduled: { bg: '#f8fafc', text: '#64748b', label: 'Upcoming' },
  confirmed: { bg: '#f0fdf4', text: '#16a34a', label: 'Present' },
  unknown:   { bg: '#f8fafc', text: '#94a3b8', label: 'Unmarked' },
};

const AVATAR_PALETTE = [
  '#dc2626','#d97706','#16a34a','#2563eb','#7c3aed','#db2777','#0891b2','#65a30d',
];

function avatarColor(name: string) {
  return AVATAR_PALETTE[name.charCodeAt(0) % AVATAR_PALETTE.length];
}

function MiniBar({ value, max, color }: { value: number; max: number; color: string }) {
  const pct = max > 0 ? Math.min(100, Math.round((value / max) * 100)) : 0;
  return (
    <div className="flex-1 h-1 rounded-full bg-[#f1f5f9] overflow-hidden">
      <div className="h-full rounded-full" style={{ width: `${pct}%`, background: color }} />
    </div>
  );
}

function SessionTimeline({ sessions, tutors }: { sessions: any[]; tutors: any[] }) {
  const past = sessions.filter(s => s.isPast).slice(0, 16);
  const upcoming = sessions.filter(s => !s.isPast);

  if (sessions.length === 0) return (
    <div className="py-6 text-center">
      <p className="text-xs text-[#94a3b8] italic">No sessions yet</p>
    </div>
  );

  const statusDot = (status: string) => {
    if (status === 'present' || status === 'confirmed') return { bg: '#16a34a', title: 'Present' };
    if (status === 'no-show') return { bg: '#dc2626', title: 'No-show' };
    return { bg: '#f59e0b', title: 'Unmarked' };
  };

  return (
    <div className="space-y-4">
      {upcoming.length > 0 && (
        <div>
          <p className="text-[9px] font-black uppercase tracking-widest text-[#dc2626] mb-2">Upcoming · {upcoming.length}</p>
          <div className="space-y-1.5">
            {upcoming.map((s, i) => {
              const d = new Date(s.date + 'T00:00:00');
              return (
                <div key={i} className="flex items-center gap-3 px-3 py-2 rounded-xl"
                  style={{ background: '#fafafa', border: '1px solid #f1f5f9' }}>
                  <div className="text-center shrink-0 w-8">
                    <p className="text-[8px] font-black uppercase text-[#94a3b8] leading-none">{d.toLocaleDateString('en-US', { month: 'short' })}</p>
                    <p className="text-sm font-black text-[#1e293b] leading-tight">{d.getDate()}</p>
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-xs font-bold text-[#1e293b] truncate">{s.topic}</p>
                    <p className="text-[10px] text-[#94a3b8] truncate">{s.tutorName} · {s.blockLabel}</p>
                  </div>
                  <span className="text-[9px] font-bold px-2 py-0.5 rounded-full shrink-0"
                    style={{ background: '#f0fdf4', color: '#16a34a' }}>Scheduled</span>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {past.length > 0 && (
        <div>
          <p className="text-[9px] font-black uppercase tracking-widest text-[#94a3b8] mb-3">History · {past.length} sessions</p>
          <div className="flex flex-wrap gap-1.5 mb-3">
            {past.map((s, i) => {
              const dot = statusDot(s.status);
              const d = new Date(s.date + 'T00:00:00');
              return (
                <div key={i}
                  title={`${d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })} · ${s.topic} · ${dot.title}`}
                  className="w-5 h-5 rounded-full cursor-default transition-transform hover:scale-125"
                  style={{ background: dot.bg }} />
              );
            })}
          </div>
          <div className="flex items-center gap-3 mb-3">
            {[['#16a34a','Present'],['#dc2626','No-show'],['#f59e0b','Unmarked']].map(([c,l]) => (
              <div key={l} className="flex items-center gap-1">
                <div className="w-2.5 h-2.5 rounded-full" style={{ background: c }}/>
                <span className="text-[9px] text-[#94a3b8]">{l}</span>
              </div>
            ))}
          </div>
          <div className="space-y-1">
            <p className="text-[9px] font-black uppercase tracking-widest text-[#94a3b8] mb-1.5">Recent</p>
            {past.slice(0, 4).map((s, i) => {
              const d = new Date(s.date + 'T00:00:00');
              const meta = STATUS_META[s.status] ?? STATUS_META.unknown;
              return (
                <div key={i} className="flex items-center gap-3 px-3 py-2 rounded-xl"
                  style={{ background: '#fafafa', border: '1px solid #f1f5f9' }}>
                  <div className="text-center shrink-0 w-8">
                    <p className="text-[8px] font-black uppercase text-[#94a3b8] leading-none">{d.toLocaleDateString('en-US', { month: 'short' })}</p>
                    <p className="text-sm font-black text-[#94a3b8] leading-tight">{d.getDate()}</p>
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-xs font-bold text-[#475569] truncate">{s.topic}</p>
                    <p className="text-[10px] text-[#94a3b8] truncate">{s.tutorName}</p>
                  </div>
                  <span className="text-[9px] font-bold px-2 py-0.5 rounded-full shrink-0"
                    style={{ background: meta.bg, color: meta.text }}>{meta.label}</span>
                </div>
              );
            })}
            {past.length > 4 && (
              <p className="text-[10px] text-[#94a3b8] text-center pt-1">+{past.length - 4} more sessions</p>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function MetricsPanel({ students, allSessions, tutors }: { students: any[]; allSessions: any[]; tutors: any[] }) {
  const [open, setOpen] = useState(false);

  const metrics = useMemo(() => {
    const today = toISODate(getCentralTimeNow());
    const weekStart = getWeekStart(getCentralTimeNow());
    const weekEnd = toISODate(new Date(weekStart.getTime() + 6 * 86400000));
    const allRecords = allSessions.flatMap(s =>
      s.students.map((st: any) => ({ ...st, date: s.date, tutorId: s.tutorId, isPast: s.date < today }))
    );
    const past = allRecords.filter(r => r.isPast);
    const present = past.filter(r => r.status === 'present' || r.status === 'confirmed');
    const noShow = past.filter(r => r.status === 'no-show');
    const unmarked = past.filter(r => r.status === 'scheduled');
    const weekSessions = allSessions.filter(s => s.date >= today && s.date <= weekEnd);
    const bookedThisWeek = new Set(weekSessions.flatMap(s => s.students.map((st: any) => st.id)));
    const atRisk = students.filter(student => {
      const recs = past.filter(r => r.id === student.id);
      if (recs.length < 3) return false;
      return recs.filter(r => r.status === 'no-show').length / recs.length > 0.4;
    });
    const studentStats = students.map(student => {
      const recs = past.filter(r => r.id === student.id);
      const pres = recs.filter(r => r.status === 'present' || r.status === 'confirmed').length;
      const ns = recs.filter(r => r.status === 'no-show').length;
      return { ...student, total: recs.length, present: pres, noShow: ns, rate: recs.length > 0 ? pres / recs.length : null };
    }).filter(s => s.total > 0).sort((a, b) => (a.rate ?? 1) - (b.rate ?? 1));
    const tutorLoad = tutors.map(t => ({
      ...t,
      count: weekSessions.filter(s => s.tutorId === t.id).reduce((a, s) => a + s.students.length, 0),
    })).filter(t => t.count > 0).sort((a, b) => b.count - a.count);
    const dowStats = [1,2,3,4,6].map(dow => {
      const recs = past.filter(r => dayOfWeek(r.date) === dow);
      return { dow, label: ['','Mon','Tue','Wed','Thu','','Sat'][dow], total: recs.length, noShow: recs.filter(r => r.status === 'no-show').length };
    });
    return {
      total: past.length, present: present.length, noShow: noShow.length, unmarked: unmarked.length,
      attendanceRate: past.length > 0 ? present.length / past.length : null,
      noShowRate: past.length > 0 ? noShow.length / past.length : null,
      bookingCoverage: students.length > 0 ? bookedThisWeek.size / students.length : null,
      bookedCount: bookedThisWeek.size, atRisk, studentStats, tutorLoad, dowStats,
    };
  }, [students, allSessions, tutors]);

  const pct = (v: number | null) => v === null ? '—' : `${Math.round(v * 100)}%`;
  const rateColor = (v: number | null) => !v ? '#94a3b8' : v >= 0.8 ? '#16a34a' : v >= 0.6 ? '#f59e0b' : '#dc2626';

  return (
    <div className="rounded-2xl border overflow-hidden" style={{ borderColor: open ? '#fecaca' : '#f1f5f9' }}>
      <button onClick={() => setOpen(o => !o)}
        className="w-full flex items-center justify-between px-5 py-3.5"
        style={{ background: open ? '#fff5f5' : '#fafafa' }}>
        <div className="flex items-center gap-2.5">
          <BarChart2 size={14} style={{ color: open ? '#dc2626' : '#94a3b8' }} />
          <div className="text-left">
            <p className="text-xs font-black text-[#1e293b]">Pilot Metrics</p>
            <p className="text-[10px] text-[#94a3b8]">
              {metrics.total > 0 ? `${metrics.total} sessions · ${pct(metrics.attendanceRate)} attendance · ${pct(metrics.noShowRate)} no-show` : 'No past data yet'}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {metrics.atRisk.length > 0 && (
            <span className="text-[9px] font-black px-2 py-0.5 rounded-full flex items-center gap-1"
              style={{ background: '#fef2f2', color: '#dc2626' }}>
              <AlertTriangle size={8}/> {metrics.atRisk.length} at risk
            </span>
          )}
          {open ? <ChevronUp size={13} className="text-[#94a3b8]"/> : <ChevronDown size={13} className="text-[#94a3b8]"/>}
        </div>
      </button>

      {open && (
        <div style={{ borderTop: '1px solid #f1f5f9' }}>
          <div className="grid grid-cols-2 md:grid-cols-4" style={{ borderBottom: '1px solid #f1f5f9' }}>
            {[
              { label: 'Attendance', value: pct(metrics.attendanceRate), sub: `${metrics.present}/${metrics.total}`, color: rateColor(metrics.attendanceRate) },
              { label: 'No-show Rate', value: pct(metrics.noShowRate), sub: `${metrics.noShow} sessions`, color: metrics.noShowRate && metrics.noShowRate > 0.2 ? '#dc2626' : '#16a34a' },
              { label: 'Booked This Week', value: pct(metrics.bookingCoverage), sub: `${metrics.bookedCount}/${students.length} students`, color: rateColor(metrics.bookingCoverage) },
              { label: 'Unmarked', value: pct(metrics.unmarked > 0 && metrics.total > 0 ? metrics.unmarked / metrics.total : null), sub: `${metrics.unmarked} sessions`, color: metrics.unmarked > 0 ? '#f59e0b' : '#16a34a' },
            ].map((k, i) => (
              <div key={k.label} className="px-5 py-4" style={{ borderRight: i < 3 ? '1px solid #f1f5f9' : 'none' }}>
                <p className="text-[9px] font-black uppercase tracking-widest text-[#94a3b8] mb-1">{k.label}</p>
                <p className="text-2xl font-black leading-none" style={{ color: k.color }}>{k.value}</p>
                <p className="text-[10px] text-[#94a3b8] mt-1">{k.sub}</p>
              </div>
            ))}
          </div>

          <div className="grid md:grid-cols-3" style={{ borderBottom: '1px solid #f1f5f9' }}>
            <div className="p-5" style={{ borderRight: '1px solid #f1f5f9' }}>
              <p className="text-[9px] font-black uppercase tracking-widest text-[#94a3b8] mb-3">No-shows by Day</p>
              <div className="space-y-2.5">
                {metrics.dowStats.filter(d => d.total > 0).map(d => (
                  <div key={d.dow} className="flex items-center gap-2">
                    <span className="text-[10px] font-bold text-[#475569] w-7 shrink-0">{d.label}</span>
                    <MiniBar value={d.noShow} max={d.total} color={d.total > 0 && d.noShow/d.total > 0.25 ? '#dc2626' : '#fca5a5'} />
                    <span className="text-[10px] text-[#94a3b8] w-10 text-right shrink-0">{d.noShow}/{d.total}</span>
                  </div>
                ))}
                {metrics.dowStats.every(d => d.total === 0) && <p className="text-xs text-[#94a3b8] italic">No data</p>}
              </div>
            </div>

            <div className="p-5" style={{ borderRight: '1px solid #f1f5f9' }}>
              <p className="text-[9px] font-black uppercase tracking-widest text-[#94a3b8] mb-3">
                {metrics.atRisk.length > 0 ? 'At-Risk Students' : 'Lowest Attendance'}
              </p>
              <div className="space-y-2.5">
                {(metrics.atRisk.length > 0 ? metrics.atRisk : metrics.studentStats.slice(0, 5)).map((s: any) => (
                  <div key={s.id} className="flex items-center gap-2">
                    <div className="w-5 h-5 rounded-full flex items-center justify-center text-[8px] font-black text-white shrink-0"
                      style={{ background: avatarColor(s.name) }}>{s.name[0]}</div>
                    <span className="text-[10px] font-bold text-[#475569] truncate flex-1">{s.name}</span>
                    <MiniBar value={s.present} max={s.total} color={rateColor(s.rate)} />
                    <span className="text-[10px] font-black shrink-0 w-8 text-right" style={{ color: rateColor(s.rate) }}>
                      {s.rate !== null ? `${Math.round(s.rate*100)}%` : '—'}
                    </span>
                  </div>
                ))}
                {metrics.studentStats.length === 0 && <p className="text-xs text-[#94a3b8] italic">No data</p>}
              </div>
            </div>

            <div className="p-5">
              <p className="text-[9px] font-black uppercase tracking-widest text-[#94a3b8] mb-3">Tutor Load This Week</p>
              <div className="space-y-2.5">
                {metrics.tutorLoad.length > 0 ? metrics.tutorLoad.map((t: any) => (
                  <div key={t.id} className="flex items-center gap-2">
                    <div className="w-5 h-5 rounded-full bg-[#fee2e2] text-[#dc2626] flex items-center justify-center text-[8px] font-black shrink-0">{t.name[0]}</div>
                    <span className="text-[10px] font-bold text-[#475569] truncate flex-1">{t.name}</span>
                    <MiniBar value={t.count} max={Math.max(...metrics.tutorLoad.map((x: any) => x.count), 1)} color="#dc2626" />
                    <span className="text-[10px] text-[#94a3b8] shrink-0 w-10 text-right">{t.count} st.</span>
                  </div>
                )) : <p className="text-xs text-[#94a3b8] italic">No sessions this week</p>}
              </div>
            </div>
          </div>

          <div className="px-5 py-2.5" style={{ background: '#fafafa' }}>
            <p className="text-[9px] text-[#cbd5e1]">At-risk = &gt;40% no-show over 3+ sessions · Hover dots for session detail</p>
          </div>
        </div>
      )}
    </div>
  );
}

function Field({ label, value, field, type = 'text', isEditing, draft, onChange }: {
  label: string; value: string; field: string; type?: string;
  isEditing: boolean; draft: any; onChange: (f: string, v: string) => void;
}) {
  return (
    <div className="space-y-1">
      <label className="text-[9px] font-black text-[#94a3b8] uppercase tracking-widest">{label}</label>
      {isEditing
        ? <input type={type} value={draft[field] ?? ''} onChange={e => onChange(field, e.target.value)} className={inputCls} placeholder={label}/>
        : <p className="text-sm text-[#1e293b]">{value || <span className="text-[#cbd5e1] italic text-xs">—</span>}</p>}
    </div>
  );
}

function StudentCard({
  student, onRefetch, tutors, allSessions, allAvailableSeats, onBookingSuccess,
}: {
  student: any; onRefetch: () => void; tutors: any[];
  allSessions: any[]; allAvailableSeats: any[]; onBookingSuccess: (d: any) => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const [tab, setTab] = useState<'sessions' | 'contact'>('sessions');
  const [isEditing, setIsEditing] = useState(false);
  const [draft, setDraft] = useState(student);
  const [saving, setSaving] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [showBooking, setShowBooking] = useState(false);
  const [enrollCat, setEnrollCat] = useState('math');

  const today = toISODate(getCentralTimeNow());
  const weekStart = getWeekStart(getCentralTimeNow());
  const weekEnd = toISODate(new Date(weekStart.getTime() + 6 * 86400000));

  const handleDraftChange = useCallback((field: string, value: string) => {
    setDraft((p: any) => ({ ...p, [field]: value }));
  }, []);

  const allStudentSessions = useMemo(() =>
    allSessions.flatMap(s => s.students
      .filter((ss: any) => ss.id === student.id)
      .map((ss: any) => ({
        date: s.date, tutorId: s.tutorId,
        tutorName: tutors.find(t => t.id === s.tutorId)?.name ?? 'Unknown',
        time: s.time,
        blockLabel: getSessionsForDay(dayOfWeek(s.date)).find((b: any) => b.time === s.time)?.label ?? s.time,
        topic: ss.topic, status: ss.status, isPast: s.date < today,
      }))
    ).sort((a, b) => b.date.localeCompare(a.date)),
    [allSessions, student.id, tutors, today]
  );

  const upcoming = allStudentSessions.filter(s => !s.isPast);
  const past = allStudentSessions.filter(s => s.isPast);
  const isBooked = upcoming.some(s => s.date <= weekEnd);
  const presentCount = past.filter(s => s.status === 'present' || s.status === 'confirmed').length;
  const noShowCount = past.filter(s => s.status === 'no-show').length;
  const rate = past.length > 0 ? presentCount / past.length : null;
  const rateColor = !rate ? '#94a3b8' : rate >= 0.8 ? '#16a34a' : rate >= 0.6 ? '#f59e0b' : '#dc2626';
  const isAtRisk = past.length >= 3 && noShowCount / past.length > 0.4;

  const handleUpdate = async () => {
    setSaving(true);
    const { error } = await supabase.from(STUDENTS).update({
      name: draft.name, grade: draft.grade,
      email: draft.email || null, phone: draft.phone || null,
      parent_name: draft.parent_name || null, parent_email: draft.parent_email || null,
      parent_phone: draft.parent_phone || null, bluebook_url: draft.bluebook_url || null,
    }).eq('id', student.id);
    if (!error) { onRefetch(); setIsEditing(false); logEvent('student_edited', { studentName: draft.name }); }
    setSaving(false);
  };

  const handleDelete = async () => {
    if (!confirmDelete) { setConfirmDelete(true); setTimeout(() => setConfirmDelete(false), 3000); return; }
    await supabase.from(STUDENTS).delete().eq('id', student.id);
    logEvent('student_deleted', {});
    onRefetch();
  };

  const handleConfirmBooking = async (data: any) => {
    await bookStudent({
      tutorId: data.slot.tutor.id, date: data.slot.date, time: data.slot.time,
      student: { id: student.id, name: student.name, subject: student.subject ?? '', grade: student.grade ?? null, hoursLeft: student.hours_left ?? 0, availabilityBlocks: student.availability_blocks ?? [], email: student.email ?? null, phone: student.phone ?? null, parent_name: student.parent_name ?? null, parent_email: student.parent_email ?? null, parent_phone: student.parent_phone ?? null, bluebook_url: student.bluebook_url ?? null },
      topic: data.topic, recurring: data.recurring, recurringWeeks: data.recurringWeeks,
    });
    setShowBooking(false); onRefetch();
    logEvent('session_booked', { studentName: student.name, tutorName: data.slot.tutor.name, date: data.slot.date, recurring: data.recurring });
    onBookingSuccess(data);
  };

  const color = avatarColor(student.name);
  const initials = student.name.split(' ').map((n: string) => n[0]).join('').slice(0, 2).toUpperCase();
  const nextSession = upcoming[0];

  return (
    <>
      <div className="bg-white rounded-2xl overflow-hidden transition-all"
        style={{ border: expanded ? '1.5px solid #fecaca' : '1.5px solid #f1f5f9' }}>
        <div className="px-4 py-3.5 flex items-center gap-3">
          <div className="w-9 h-9 rounded-full flex items-center justify-center text-xs font-black text-white shrink-0"
            style={{ background: color }}>{initials}</div>

          <div className="flex-1 min-w-0 cursor-pointer" onClick={() => setExpanded(e => !e)}>
            <div className="flex items-center gap-2 flex-wrap">
              <span className="text-sm font-black text-[#0f172a]">{student.name}</span>
              {student.grade && <span className="text-[9px] font-bold text-[#94a3b8]">Gr. {student.grade}</span>}
              {isAtRisk && (
                <span className="text-[9px] font-black px-1.5 py-0.5 rounded-full flex items-center gap-0.5"
                  style={{ background: '#fef2f2', color: '#dc2626' }}>
                  <AlertTriangle size={8}/> at risk
                </span>
              )}
            </div>
            <div className="flex items-center gap-2 mt-0.5 flex-wrap">
              <span className="flex items-center gap-1 text-[10px] font-semibold"
                style={{ color: isBooked ? '#16a34a' : '#dc2626' }}>
                <span className="w-1.5 h-1.5 rounded-full inline-block" style={{ background: isBooked ? '#16a34a' : '#dc2626' }}/>
                {isBooked ? 'Booked' : 'Not booked'}
              </span>
              {past.length > 0 && (
                <>
                  <span className="text-[#e2e8f0]">·</span>
                  <span className="text-[10px] font-semibold" style={{ color: rateColor }}>
                    {rate !== null ? `${Math.round(rate * 100)}%` : '—'} attendance
                  </span>
                  {noShowCount > 0 && <span className="text-[10px] text-[#94a3b8]">{noShowCount} no-show{noShowCount !== 1 ? 's' : ''}</span>}
                </>
              )}
              {nextSession && (
                <>
                  <span className="text-[#e2e8f0]">·</span>
                  <span className="text-[10px] text-[#94a3b8]">
                    next {new Date(nextSession.date + 'T00:00:00').toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })}
                  </span>
                </>
              )}
            </div>
          </div>

          <div className="flex items-center gap-1.5 shrink-0">
            <button onClick={() => setShowBooking(true)}
              className="px-2.5 py-1.5 rounded-lg text-[10px] font-black uppercase tracking-wider text-white transition-all active:scale-95"
              style={{ background: '#dc2626' }}>Book</button>
            {!isEditing && (
              <>
                <button onClick={() => { setIsEditing(true); setExpanded(true); setTab('contact'); }}
                  className="px-2 py-1.5 rounded-lg text-[10px] font-bold text-[#64748b] transition-all"
                  style={{ background: '#f8fafc', border: '1px solid #e2e8f0' }}>Edit</button>
                <button onClick={handleDelete}
                  className={`p-1.5 rounded-lg transition-all ${confirmDelete ? 'bg-red-100 text-red-600 text-xs font-black px-2' : 'text-[#cbd5e1] hover:text-red-400'}`}>
                  {confirmDelete ? '?' : <Trash2 size={12}/>}
                </button>
              </>
            )}
            {isEditing && (
              <>
                <button onClick={() => { setIsEditing(false); setDraft(student); }} className="p-1.5 rounded-lg text-[#94a3b8]"><X size={13}/></button>
                <button onClick={handleUpdate} disabled={saving}
                  className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-[10px] font-black text-white disabled:opacity-50"
                  style={{ background: '#0f172a' }}>
                  {saving ? <Loader2 size={10} className="animate-spin"/> : <Save size={10}/>} Save
                </button>
              </>
            )}
            <button onClick={() => setExpanded(e => !e)} className="p-1.5 rounded-lg text-[#94a3b8] transition-all">
              {expanded ? <ChevronUp size={14}/> : <ChevronDown size={14}/>}
            </button>
          </div>
        </div>

        {expanded && (
          <div style={{ borderTop: '1px solid #f8fafc' }}>
            <div className="flex px-4 gap-0" style={{ background: '#fafafa', borderBottom: '1px solid #f1f5f9' }}>
              {(['sessions', 'contact'] as const).map(t => (
                <button key={t} onClick={() => setTab(t)}
                  className="py-2.5 mr-5 text-[10px] font-black uppercase tracking-widest border-b-2 -mb-px transition-colors"
                  style={tab === t ? { color: '#dc2626', borderColor: '#dc2626' } : { color: '#94a3b8', borderColor: 'transparent' }}>
                  {t === 'sessions' ? `Sessions (${allStudentSessions.length})` : 'Contact'}
                </button>
              ))}
            </div>

            <div className="p-4">
              {tab === 'sessions' && <SessionTimeline sessions={allStudentSessions} tutors={tutors} />}
              {tab === 'contact' && (
                <div className="space-y-4">
                  <div>
                    <p className="text-[9px] font-black uppercase tracking-widest mb-2 text-[#dc2626]">Student</p>
                    <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
                      <Field label="Email" value={student.email} field="email" type="email" isEditing={isEditing} draft={draft} onChange={handleDraftChange}/>
                      <Field label="Phone" value={student.phone} field="phone" type="tel" isEditing={isEditing} draft={draft} onChange={handleDraftChange}/>
                      <Field label="Grade" value={student.grade} field="grade" isEditing={isEditing} draft={draft} onChange={handleDraftChange}/>
                    </div>
                  </div>
                  <div>
                    <p className="text-[9px] font-black uppercase tracking-widest mb-2 text-[#dc2626]">Parent / Guardian</p>
                    <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                      <Field label="Name" value={student.parent_name} field="parent_name" isEditing={isEditing} draft={draft} onChange={handleDraftChange}/>
                      <Field label="Email" value={student.parent_email} field="parent_email" type="email" isEditing={isEditing} draft={draft} onChange={handleDraftChange}/>
                      <Field label="Phone" value={student.parent_phone} field="parent_phone" type="tel" isEditing={isEditing} draft={draft} onChange={handleDraftChange}/>
                    </div>
                  </div>
                  <div>
                    <p className="text-[9px] font-black uppercase tracking-widest mb-2 text-[#dc2626]">Bluebook</p>
                    {isEditing
                      ? <input type="url" value={draft.bluebook_url ?? ''} onChange={e => handleDraftChange('bluebook_url', e.target.value)} className={inputCls} placeholder="https://..."/>
                      : student.bluebook_url
                        ? <a href={student.bluebook_url} target="_blank" rel="noopener noreferrer"
                            className="inline-flex items-center gap-2 px-3 py-2 rounded-xl text-xs font-semibold"
                            style={{ background: '#f0fdf4', border: '1.5px solid #bbf7d0', color: '#15803d' }}>
                            <ExternalLink size={12}/> Open Bluebook
                          </a>
                        : <p className="text-xs text-[#cbd5e1] italic">No Bluebook linked</p>}
                  </div>
                  {isEditing && (
                    <div className="flex justify-end gap-2 pt-1">
                      <button onClick={() => { setIsEditing(false); setDraft(student); }}
                        className="px-4 py-2 text-xs font-bold text-[#64748b] rounded-xl" style={{ background: '#f1f5f9' }}>Cancel</button>
                      <button onClick={handleUpdate} disabled={saving}
                        className="flex items-center gap-2 px-5 py-2 text-white rounded-xl text-xs font-black disabled:opacity-50"
                        style={{ background: '#dc2626' }}>
                        {saving ? <Loader2 size={12} className="animate-spin"/> : <Save size={12}/>} Save
                      </button>
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>
        )}
      </div>

      {showBooking && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4"
          style={{ background: 'rgba(15,23,42,0.6)', backdropFilter: 'blur(4px)' }}>
          <BookingForm prefilledSlot={null} onConfirm={handleConfirmBooking} onCancel={() => setShowBooking(false)}
            enrollCat={enrollCat} setEnrollCat={setEnrollCat} allAvailableSeats={allAvailableSeats} studentDatabase={[student]}/>
        </div>
      )}
    </>
  );
}

export default function StudentAdminPage() {
  const [students, setStudents] = useState<any[]>([]);
  const [tutors, setTutors] = useState<any[]>([]);
  const [allSessions, setAllSessions] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [adding, setAdding] = useState(false);
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState<'all' | 'booked' | 'unbooked'>('all');
  const [newStudent, setNewStudent] = useState(EMPTY_FORM);
  const [creating, setCreating] = useState(false);
  const [bookingToast, setBookingToast] = useState<any>(null);

  const fetchData = useCallback(async () => {
    setLoading(true);
    const [sRes, tRes, sesRes] = await Promise.all([
      supabase.from(STUDENTS).select('*').order('name'),
      supabase.from(TUTORS).select('*').order('name'),
      (supabase.from(SESSIONS)
        .select(`id, session_date, tutor_id, time, ${SS}(id, student_id, name, topic, status)`)
        .order('session_date') as any),
    ]);
    setStudents(sRes.data ?? []);
    setTutors(tRes.data ?? []);
    setAllSessions((sesRes.data ?? []).map((r: any) => ({
      id: r.id, date: r.session_date, tutorId: r.tutor_id, time: r.time,
      students: (r[SS] ?? []).map((ss: any) => ({
        id: ss.student_id, rowId: ss.id, name: ss.name, topic: ss.topic, status: ss.status,
      })),
    })));
    setLoading(false);
  }, []);

  useEffect(() => { fetchData(); }, [fetchData]);

  const today = toISODate(getCentralTimeNow());
  const weekStart = getWeekStart(getCentralTimeNow());
  const weekDates = getWeekDates(weekStart);
  const activeDates = weekDates.filter(d => ACTIVE_DAYS.includes(dayOfWeek(toISODate(d))));
  const weekEnd = toISODate(new Date(weekStart.getTime() + 6 * 86400000));

  const allAvailableSeats = useMemo(() => {
    const seats: any[] = [];
    tutors.forEach(tutor => {
      activeDates.forEach(date => {
        const iso = toISODate(date);
        const dow = dayOfWeek(iso);
        if (!tutor.availability?.includes(dow)) return;
        getSessionsForDay(dow).forEach((block: any) => {
          if (!isTutorAvailable(tutor, dow, block.time)) return;
          const session = allSessions.find(s => s.date === iso && s.tutorId === tutor.id && s.time === block.time);
          const count = session ? session.students.length : 0;
          if (count < MAX_CAPACITY) {
            seats.push({ tutor: { ...tutor, availabilityBlocks: tutor.availability_blocks }, dayName: DAY_NAMES[ACTIVE_DAYS.indexOf(dow)], date: iso, time: block.time, block, count, seatsLeft: MAX_CAPACITY - count, dayNum: dow });
          }
        });
      });
    });
    return seats.sort((a, b) => a.date.localeCompare(b.date) || a.time.localeCompare(b.time));
  }, [tutors, allSessions, activeDates]);

  const bookedIds = useMemo(() => {
    const ids = new Set<string>();
    allSessions.filter(s => s.date >= today && s.date <= weekEnd)
      .forEach(s => s.students.forEach((st: any) => ids.add(st.id)));
    return ids;
  }, [allSessions, today, weekEnd]);

  const filtered = students.filter(s => {
    if (!s.name.toLowerCase().includes(search.toLowerCase())) return false;
    if (filter === 'booked') return bookedIds.has(s.id);
    if (filter === 'unbooked') return !bookedIds.has(s.id);
    return true;
  });

  const handleCreate = async () => {
    if (!newStudent.name) return;
    setCreating(true);
    await supabase.from(STUDENTS).insert([{
      name: newStudent.name, grade: newStudent.grade || null,
      email: newStudent.email || null, phone: newStudent.phone || null,
      parent_name: newStudent.parent_name || null, parent_email: newStudent.parent_email || null,
      parent_phone: newStudent.parent_phone || null,
    }]);
    setAdding(false); setNewStudent(EMPTY_FORM); fetchData(); setCreating(false);
  };

  return (
    <div className="min-h-screen pb-20" style={{ background: '#f8fafc', fontFamily: 'ui-sans-serif, system-ui, sans-serif' }}>
      <div className="sticky top-0 z-40 bg-white border-b border-[#f1f5f9]">
        <div className="max-w-3xl mx-auto px-5 h-14 flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <div className="w-7 h-7 rounded-lg bg-[#dc2626] flex items-center justify-center">
              <GraduationCap size={14} className="text-white"/>
            </div>
            <div>
              <h1 className="text-sm font-black text-[#0f172a] leading-none">Students</h1>
              <p className="text-[9px] font-bold uppercase tracking-widest text-[#dc2626]">C2 Education</p>
            </div>
          </div>
          <button onClick={() => setAdding(a => !a)}
            className="flex items-center gap-1.5 px-4 py-2 rounded-xl text-xs font-black uppercase tracking-wider text-white transition-all active:scale-95"
            style={{ background: adding ? '#64748b' : '#dc2626' }}>
            {adding ? <X size={13}/> : <Plus size={13}/>}
            {adding ? 'Cancel' : 'Add Student'}
          </button>
        </div>
      </div>

      <div className="max-w-3xl mx-auto px-5 pt-5 space-y-4">
        {!loading && (
          <div className="grid grid-cols-3 gap-3">
            {[
              { label: 'Total', value: students.length, key: 'all', color: '#0f172a', border: '#f1f5f9', activeBorder: '#0f172a', bg: 'white' },
              { label: 'Booked', value: bookedIds.size, key: 'booked', color: '#16a34a', border: '#dcfce7', activeBorder: '#16a34a', bg: '#f0fdf4' },
              { label: 'Not Booked', value: students.length - bookedIds.size, key: 'unbooked', color: '#dc2626', border: '#fecdd3', activeBorder: '#dc2626', bg: '#fff5f5' },
            ].map(s => (
              <button key={s.key} onClick={() => setFilter(f => f === s.key ? 'all' : s.key as any)}
                className="p-4 rounded-2xl text-left transition-all hover:scale-[1.01] active:scale-[0.99]"
                style={{ background: s.bg, border: `1.5px solid ${filter === s.key ? s.activeBorder : s.border}` }}>
                <p className="text-2xl font-black leading-none" style={{ color: s.color }}>{s.value}</p>
                <p className="text-[9px] font-bold uppercase tracking-wider mt-1.5" style={{ color: s.color, opacity: 0.6 }}>{s.label}</p>
              </button>
            ))}
          </div>
        )}

        {!loading && <MetricsPanel students={students} allSessions={allSessions} tutors={tutors}/>}

        <div className="relative">
          <Search size={13} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-[#94a3b8]"/>
          <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search students…"
            className="w-full pl-9 pr-4 py-2.5 bg-white border border-[#e2e8f0] rounded-xl text-sm text-black outline-none focus:ring-2 focus:border-[#dc2626] transition-all placeholder:text-[#94a3b8]"/>
          {search && <button onClick={() => setSearch('')} className="absolute right-3 top-1/2 -translate-y-1/2 text-[#94a3b8]"><X size={13}/></button>}
        </div>

        {adding && (
          <div className="bg-white rounded-2xl overflow-hidden shadow-sm" style={{ border: '1.5px solid #fecaca' }}>
            <div className="px-5 py-3.5 flex items-center justify-between" style={{ background: '#fff5f5', borderBottom: '1px solid #fecdd3' }}>
              <p className="text-xs font-black uppercase tracking-widest text-[#dc2626]">New Student</p>
              <button onClick={() => setAdding(false)} className="text-[#94a3b8]"><X size={14}/></button>
            </div>
            <div className="p-5 space-y-4">
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1 col-span-2 md:col-span-1">
                  <label className="text-[9px] font-black text-[#94a3b8] uppercase tracking-widest">Name *</label>
                  <input value={newStudent.name} onChange={e => setNewStudent({ ...newStudent, name: e.target.value })} className={inputCls} placeholder="Full name"/>
                </div>
                <div className="space-y-1">
                  <label className="text-[9px] font-black text-[#94a3b8] uppercase tracking-widest">Grade</label>
                  <input value={newStudent.grade} onChange={e => setNewStudent({ ...newStudent, grade: e.target.value })} className={inputCls} placeholder="1–12"/>
                </div>
              </div>
              <div>
                <p className="text-[9px] font-black uppercase tracking-widest mb-2 text-[#dc2626]">Student Contact <span className="font-normal normal-case text-[#94a3b8]">(optional)</span></p>
                <div className="grid grid-cols-2 gap-3">
                  {[['Email','email','email','student@email.com'],['Phone','phone','tel','(555) 000-0000']].map(([l,f,t,ph]) => (
                    <div key={f} className="space-y-1">
                      <label className="text-[9px] font-black text-[#94a3b8] uppercase tracking-widest">{l}</label>
                      <input type={t} value={(newStudent as any)[f]} onChange={e => setNewStudent({ ...newStudent, [f]: e.target.value })} className={inputCls} placeholder={ph}/>
                    </div>
                  ))}
                </div>
              </div>
              <div>
                <p className="text-[9px] font-black uppercase tracking-widest mb-2 text-[#dc2626]">Parent / Guardian <span className="font-normal normal-case text-[#94a3b8]">(optional)</span></p>
                <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                  {[['Name','parent_name','text','Parent name'],['Email','parent_email','email','parent@email.com'],['Phone','parent_phone','tel','(555) 000-0000']].map(([l,f,t,ph]) => (
                    <div key={f} className="space-y-1">
                      <label className="text-[9px] font-black text-[#94a3b8] uppercase tracking-widest">{l}</label>
                      <input type={t} value={(newStudent as any)[f]} onChange={e => setNewStudent({ ...newStudent, [f]: e.target.value })} className={inputCls} placeholder={ph}/>
                    </div>
                  ))}
                </div>
              </div>
              <button onClick={handleCreate} disabled={!newStudent.name || creating}
                className="w-full py-3 rounded-xl text-sm font-black uppercase tracking-wider text-white transition-all active:scale-[0.98] disabled:opacity-40"
                style={{ background: '#dc2626' }}>
                {creating ? <Loader2 size={14} className="animate-spin mx-auto"/> : 'Register Student'}
              </button>
            </div>
          </div>
        )}

        {!loading && (
          <p className="text-[10px] font-bold text-[#94a3b8] uppercase tracking-widest px-1">
            {filtered.length} student{filtered.length !== 1 ? 's' : ''}
            {filter !== 'all' && <span className="ml-1 text-[#dc2626]">· {filter}</span>}
            {search && ` matching "${search}"`}
          </p>
        )}

        {loading ? (
          <div className="flex flex-col items-center py-24 gap-3">
            <Loader2 size={22} className="animate-spin text-[#dc2626]"/>
            <p className="text-xs font-semibold text-[#94a3b8] uppercase tracking-widest">Loading…</p>
          </div>
        ) : filtered.length > 0 ? (
          <div className="space-y-2">
            {filtered.map(s => (
              <StudentCard key={s.id} student={s} onRefetch={fetchData}
                tutors={tutors} allSessions={allSessions} allAvailableSeats={allAvailableSeats}
                onBookingSuccess={d => { setBookingToast(d); setTimeout(() => setBookingToast(null), 4000); }}/>
            ))}
          </div>
        ) : (
          <div className="text-center py-24 bg-white rounded-2xl" style={{ border: '1.5px dashed #e2e8f0' }}>
            <GraduationCap size={28} className="mx-auto mb-3 text-[#cbd5e1]"/>
            <p className="text-sm font-bold text-[#94a3b8]">No students found</p>
            {search && <p className="text-xs text-[#cbd5e1] mt-1">Try a different search</p>}
          </div>
        )}
      </div>

      {bookingToast && <BookingToast data={bookingToast} onClose={() => setBookingToast(null)}/>}
    </div>
  );
}