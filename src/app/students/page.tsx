"use client"
import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import Link from 'next/link';
import {
  Plus, Trash2, GraduationCap, Loader2, Save, X, Clock,
  ChevronDown, ChevronUp, ExternalLink, BarChart2, AlertTriangle,
  Upload, CheckSquare, Square, ChevronRight, Mail, Phone, User
} from 'lucide-react';
import { supabase } from '@/lib/supabaseClient';
import { BookingForm, BookingToast } from '@/components/BookingForm';
import {
  bookStudent, getWeekStart, getWeekDates, toISODate, dayOfWeek, getCentralTimeNow,
} from '@/lib/useScheduleData';
import { getSessionsForDay } from '@/components/constants';
import { logEvent } from '@/lib/analytics';
import { CSVImportModal } from '@/components/CSVImportModal';

const p        = process.env.NEXT_PUBLIC_TABLE_PREFIX ?? 'slake'
const TUTORS   = `${p}_tutors`
const STUDENTS = `${p}_students`
const SESSIONS = `${p}_sessions`
const SS       = `${p}_session_students`

const EMPTY_FORM = {
  name: '', grade: '', email: '', phone: '',
  mom_name: '', mom_email: '', mom_phone: '',
  dad_name: '', dad_email: '', dad_phone: '',
};
const ACTIVE_DAYS = [1, 2, 3, 4, 6];
const DAY_NAMES = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Saturday'];
const MAX_CAPACITY = 3;

const isTutorAvailable = (tutor: any, dow: number, time: string) =>
  tutor.availability_blocks?.includes(`${dow}-${time}`);

const inputCls = "w-full rounded-lg border border-[#94a3b8] bg-white px-3.5 py-2.5 text-sm font-medium text-[#0f172a] shadow-[0_1px_2px_rgba(15,23,42,0.06)] outline-none transition-all placeholder:text-[#64748b] focus:border-[#4f46e5] focus:ring-4 focus:ring-[#e0e7ff]";
const fieldCardCls = "rounded-lg border border-[#cbd5e1] bg-white px-3.5 py-3 shadow-[0_1px_2px_rgba(15,23,42,0.06)]";
const fieldLabelCls = "text-[9px] font-black uppercase tracking-[0.22em] text-[#64748b]";
const fieldValueCls = "mt-2 text-sm font-semibold text-[#0f172a]";

const AVATAR_PALETTE = ['#dc2626','#d97706','#16a34a','#2563eb','#7c3aed','#db2777','#0891b2','#65a30d'];
function avatarColor(name: string) { return AVATAR_PALETTE[name.charCodeAt(0) % AVATAR_PALETTE.length]; }

function MiniBar({ value, max, color }: { value: number; max: number; color: string }) {
  const pct = max > 0 ? Math.min(100, Math.round((value / max) * 100)) : 0;
  return (
    <div className="flex-1 h-1 rounded-full bg-[#f1f5f9] overflow-hidden">
      <div className="h-full rounded-full" style={{ width: `${pct}%`, background: color }} />
    </div>
  );
}

// ── Metrics Panel ─────────────────────────────────────────────────────────────
function MetricsPanel({ students, allSessions, tutors }: { students: any[]; allSessions: any[]; tutors: any[] }) {
  const [open, setOpen] = useState(false);
  const metrics = useMemo(() => {
    const today = toISODate(getCentralTimeNow());
    const weekStart = getWeekStart(getCentralTimeNow());
    const weekEnd = toISODate(new Date(weekStart.getTime() + 6 * 86400000));
    const allRecords = allSessions.flatMap(s => s.students.map((st: any) => ({ ...st, date: s.date, isPast: s.date < today })));
    const past = allRecords.filter(r => r.isPast);
    const present = past.filter(r => r.status === 'present' || r.status === 'confirmed');
    const noShow = past.filter(r => r.status === 'no-show');
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
      ...t, count: weekSessions.filter(s => s.tutorId === t.id).reduce((a, s) => a + s.students.length, 0),
    })).filter(t => t.count > 0).sort((a, b) => b.count - a.count);
    const dowStats = [1,2,3,4,6].map(dow => {
      const recs = past.filter(r => dayOfWeek(r.date) === dow);
      return { dow, label: ['','Mon','Tue','Wed','Thu','','Sat'][dow], total: recs.length, noShow: recs.filter(r => r.status === 'no-show').length };
    });
    const thirtyDaysAgo = toISODate(new Date(new Date(today).setDate(new Date(today).getDate() - 30)));
    const activeIds = new Set(
      allSessions
        .filter(s => s.date >= thirtyDaysAgo && s.date <= today)
        .flatMap(s => s.students.map((st: any) => st.id as string))
    );
    return {
      total: past.length, present: present.length, noShow: noShow.length,
      attendanceRate: past.length > 0 ? present.length / past.length : null,
      noShowRate: past.length > 0 ? noShow.length / past.length : null,
      bookingCoverage: students.length > 0 ? bookedThisWeek.size / students.length : null,
      bookedCount: bookedThisWeek.size, atRisk, studentStats, tutorLoad, dowStats,
      activeCount: activeIds.size, inactiveCount: students.length - activeIds.size,
    };
  }, [students, allSessions, tutors]);

  const pct = (v: number | null) => v === null ? '—' : `${Math.round(v * 100)}%`;
  const rateColor = (v: number | null) => !v ? '#94a3b8' : v >= 0.8 ? '#16a34a' : v >= 0.6 ? '#f59e0b' : '#dc2626';

  return (
    <div className="overflow-hidden rounded-xl bg-white shadow-[0_18px_38px_rgba(15,23,42,0.08)]" style={{ border: `1px solid ${open ? '#fda4af' : '#cbd5e1'}` }}>
      <button onClick={() => setOpen(o => !o)}
        className="flex w-full items-center justify-between px-5 py-4 transition-all"
        style={{ background: open ? '#fff1f2' : '#f8fafc' }}>
        <div className="flex items-center gap-2.5">
          <BarChart2 size={13} style={{ color: open ? '#dc2626' : '#94a3b8' }} />
          <div className="text-left">
            <p className="text-xs font-black uppercase tracking-[0.18em] text-[#0f172a]">Analytics</p>
            <p className="text-[10px] font-medium text-[#475569]">
              {metrics.total > 0 ? `${metrics.total} sessions · ${pct(metrics.attendanceRate)} attendance · ${pct(metrics.noShowRate)} no-show` : 'No past data yet'}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {metrics.atRisk.length > 0 && (
            <span className="flex items-center gap-1 rounded-full px-2.5 py-1 text-[9px] font-black uppercase tracking-[0.18em]" style={{ background: '#7f1d1d', color: '#fff1f2' }}>
              <AlertTriangle size={8} /> {metrics.atRisk.length} at risk
            </span>
          )}
          {open ? <ChevronUp size={12} className="text-[#94a3b8]" /> : <ChevronDown size={12} className="text-[#94a3b8]" />}
        </div>
      </button>
      {open && (
        <div style={{ borderTop: '1px solid #e2e8f0' }}>
          <div className="grid grid-cols-2 md:grid-cols-4" style={{ borderBottom: '1px solid #e2e8f0' }}>
            {[
              { label: 'Active (30d)', value: String(metrics.activeCount), sub: 'attended in last 30 days', color: '#16a34a' },
              { label: 'Inactive (30d)', value: String(metrics.inactiveCount), sub: 'no sessions in 30 days', color: '#94a3b8' },
              { label: 'Attendance', value: pct(metrics.attendanceRate), sub: `${metrics.present}/${metrics.total}`, color: rateColor(metrics.attendanceRate) },
              { label: 'No-show', value: pct(metrics.noShowRate), sub: `${metrics.noShow} sessions`, color: metrics.noShowRate && metrics.noShowRate > 0.2 ? '#dc2626' : '#16a34a' },
            ].map((k, i) => (
              <div key={k.label} className="bg-white px-5 py-4" style={{ borderRight: i < 3 ? '1px solid #e2e8f0' : 'none' }}>
                <p className="mb-1 text-[9px] font-black uppercase tracking-[0.2em] text-[#64748b]">{k.label}</p>
                <p className="text-2xl font-black leading-none" style={{ color: k.color }}>{k.value}</p>
                <p className="mt-1 text-[10px] font-medium text-[#475569]">{k.sub}</p>
              </div>
            ))}
          </div>
          <div className="grid bg-[#fcfdff] md:grid-cols-3" style={{ borderBottom: '1px solid #e2e8f0' }}>
            <div className="p-4" style={{ borderRight: '1px solid #e2e8f0' }}>
              <p className="mb-3 text-[9px] font-black uppercase tracking-[0.2em] text-[#64748b]">No-shows by Day</p>
              <div className="space-y-2">
                {metrics.dowStats.filter(d => d.total > 0).map(d => (
                  <div key={d.dow} className="flex items-center gap-2">
                    <span className="text-[10px] font-bold text-[#475569] w-7 shrink-0">{d.label}</span>
                    <MiniBar value={d.noShow} max={d.total} color={d.total > 0 && d.noShow/d.total > 0.25 ? '#dc2626' : '#fca5a5'} />
                    <span className="text-[10px] text-[#94a3b8] w-10 text-right shrink-0">{d.noShow}/{d.total}</span>
                  </div>
                ))}
              </div>
            </div>
            <div className="p-4" style={{ borderRight: '1px solid #e2e8f0' }}>
              <p className="mb-3 text-[9px] font-black uppercase tracking-[0.2em] text-[#64748b]">{metrics.atRisk.length > 0 ? 'At-Risk Students' : 'Lowest Attendance'}</p>
              <div className="space-y-2">
                {(metrics.atRisk.length > 0 ? metrics.atRisk : metrics.studentStats.slice(0, 5)).map((s: any) => (
                  <div key={s.id} className="flex items-center gap-2">
                    <div className="w-5 h-5 rounded-full flex items-center justify-center text-[8px] font-black text-white shrink-0" style={{ background: avatarColor(s.name) }}>{s.name[0]}</div>
                    <span className="text-[10px] font-bold text-[#475569] truncate flex-1">{s.name}</span>
                    <MiniBar value={s.present} max={s.total} color={rateColor(s.rate)} />
                    <span className="text-[10px] font-black shrink-0 w-8 text-right" style={{ color: rateColor(s.rate) }}>{s.rate !== null ? `${Math.round(s.rate*100)}%` : '—'}</span>
                  </div>
                ))}
              </div>
            </div>
            <div className="p-4">
              <p className="mb-3 text-[9px] font-black uppercase tracking-[0.2em] text-[#64748b]">Tutor Load This Week</p>
              <div className="space-y-2">
                {metrics.tutorLoad.length > 0 ? metrics.tutorLoad.map((t: any) => (
                  <div key={t.id} className="flex items-center gap-2">
                    <div className="w-5 h-5 rounded-full bg-[#fee2e2] text-[#dc2626] flex items-center justify-center text-[8px] font-black shrink-0">{t.name[0]}</div>
                    <span className="text-[10px] font-bold text-[#475569] truncate flex-1">{t.name}</span>
                    <MiniBar value={t.count} max={Math.max(...metrics.tutorLoad.map((x: any) => x.count), 1)} color="#dc2626" />
                    <span className="text-[10px] text-[#94a3b8] shrink-0 w-8 text-right">{t.count} st.</span>
                  </div>
                )) : <p className="text-xs text-[#94a3b8] italic">No sessions this week</p>}
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ── Student Row (compact card style) ──────────────────────────────────────────
function StudentRow({
  student, isActive, selected, onToggle, onRefetch, tutors, allSessions, allAvailableSeats, onBookingSuccess, forceExpanded = false,
}: {
  student: any; isActive: boolean; selected: boolean; onToggle: () => void;
  onRefetch: () => void; tutors: any[]; allSessions: any[];
  allAvailableSeats: any[]; onBookingSuccess: (d: any) => void;
  forceExpanded?: boolean;
}) {
  const [expanded, setExpanded] = useState(forceExpanded);
  const [tab, setTab] = useState<'contact' | 'sessions'>('contact');
  const [showEditModal, setShowEditModal] = useState(false);
  const [draft, setDraft] = useState(student);
  const [saving, setSaving] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [showBooking, setShowBooking] = useState(false);
  const [enrollCat, setEnrollCat] = useState('math');

  const today = toISODate(getCentralTimeNow());
  const weekStart = getWeekStart(getCentralTimeNow());
  const weekEnd = toISODate(new Date(weekStart.getTime() + 6 * 86400000));

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
  const nextSession = upcoming[0];
  const latestSession = past[0];
  const hoursLeft = typeof student.hours_left === 'number' ? student.hours_left : null;

  useEffect(() => {
    if (forceExpanded) setExpanded(true);
  }, [forceExpanded]);

  const handleUpdate = async () => {
    setSaving(true);
    const { error } = await supabase.from(STUDENTS).update({
      name: draft.name, grade: draft.grade,
      email: draft.email || null, phone: draft.phone || null,
      mom_name: draft.mom_name || null, mom_email: draft.mom_email || null,
      mom_phone: draft.mom_phone || null,
      dad_name: draft.dad_name || null, dad_email: draft.dad_email || null,
      dad_phone: draft.dad_phone || null,
      bluebook_url: draft.bluebook_url || null,
    }).eq('id', student.id);
    if (!error) { onRefetch(); setShowEditModal(false); logEvent('student_edited', { studentName: draft.name }); }
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
      student: {
        id: student.id, name: student.name, subject: student.subject ?? '', grade: student.grade ?? null,
        hoursLeft: student.hours_left ?? 0, availabilityBlocks: student.availability_blocks ?? [],
        email: student.email ?? null, phone: student.phone ?? null,
        parent_name: student.parent_name ?? null,
        parent_email: student.parent_email ?? null,
        parent_phone: student.parent_phone ?? null,
        mom_name: student.mom_name ?? null,
        mom_email: student.mom_email ?? null,
        mom_phone: student.mom_phone ?? null,
        dad_name: student.dad_name ?? null,
        dad_email: student.dad_email ?? null,
        dad_phone: student.dad_phone ?? null,
        bluebook_url: student.bluebook_url ?? null,
      },
      topic: data.topic, recurring: data.recurring, recurringWeeks: data.recurringWeeks,
    });
    setShowBooking(false); onRefetch();
    logEvent('session_booked', { studentName: student.name, tutorName: data.slot.tutor.name, date: data.slot.date, recurring: data.recurring });
    onBookingSuccess(data);
  };

  const color = avatarColor(student.name);
  const initials = student.name.split(' ').map((n: string) => n[0]).join('').slice(0, 2).toUpperCase();

  const statusDot = (status: string) => {
    if (status === 'present' || status === 'confirmed') return '#16a34a';
    if (status === 'no-show') return '#dc2626';
    return '#f59e0b';
  };

  return (
    <div className={forceExpanded ? 'h-full min-h-0 flex flex-col gap-2' : 'space-y-2'}>
      {/* Main compact card (tutor-like shell) */}
      <div
        className="overflow-hidden rounded-2xl border shadow-[0_12px_28px_rgba(15,23,42,0.07)] transition-all"
        style={{
          borderColor: selected ? '#fda4af' : expanded ? '#c7d2fe' : '#dbe4ee',
          background: selected
            ? 'linear-gradient(135deg, #fff8f8 0%, #ffffff 55%)'
            : expanded
              ? 'linear-gradient(135deg, #ffffff 0%, #f8fbff 58%, #eef2ff 100%)'
              : '#ffffff',
        }}
      >
        <div className="p-3.5">
          <div className="flex items-start gap-2.5">
            <button onClick={onToggle} className="mt-0.5 rounded-xl border border-[#cbd5e1] bg-white p-2 text-[#64748b] transition-colors hover:border-[#fda4af] hover:text-[#dc2626]" onMouseDown={e => e.stopPropagation()}>
              {selected ? <CheckSquare size={14} style={{ color: '#dc2626' }} /> : <Square size={14} />}
            </button>

            <div className="w-8 h-8 rounded-xl flex items-center justify-center text-[10px] font-black text-white shrink-0" style={{ background: color, boxShadow: '0 8px 16px rgba(79,70,229,0.18)' }}>
              {initials}
            </div>

            <button className="flex-1 min-w-0 text-left" onClick={() => { if (!forceExpanded) setExpanded(e => !e); }}>
              <div className="flex items-center gap-1.5 min-w-0">
                <span className="text-[13px] font-black text-[#0f172a] truncate">{student.name}</span>
                <span
                  className="rounded-full px-1.5 py-0.5 text-[8px] font-black uppercase tracking-wider"
                  style={isActive
                    ? { background: '#dcfce7', color: '#15803d', border: '1px solid #86efac' }
                    : { background: '#f1f5f9', color: '#64748b', border: '1px solid #cbd5e1' }}>
                  {isActive ? 'Active' : 'Inactive'}
                </span>
                {isAtRisk && <AlertTriangle size={10} style={{ color: '#dc2626', flexShrink: 0 }} />}
              </div>
              <div className="mt-1 flex flex-wrap items-center gap-1.5 text-[10px]">
                {student.grade && <span className="rounded-full border border-[#dbeafe] bg-[#eff6ff] px-1.5 py-0.5 font-bold text-[#1d4ed8]">Gr {student.grade}</span>}
                {hoursLeft !== null && <span className="rounded-full border border-[#fde68a] bg-[#fffbeb] px-1.5 py-0.5 font-bold text-[#b45309]">{hoursLeft}h left</span>}
                {nextSession && (
                  <span className="rounded-full border border-[#c7d2fe] bg-[#eef2ff] px-1.5 py-0.5 font-bold text-[#4f46e5]">
                    Next {new Date(nextSession.date + 'T00:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
                  </span>
                )}
              </div>
            </button>

            <div className="flex items-center gap-1" onClick={e => e.stopPropagation()}>
              <Link href={`/students/${student.id}`}
                className="inline-flex items-center rounded-md px-2 py-1 text-[9px] font-black uppercase tracking-[0.12em] transition-all"
                style={{ background: '#f1f5f9', border: '1px solid #cbd5e1', color: '#475569' }}>
                History
              </Link>
              <button onClick={() => setShowBooking(true)}
                className="rounded-md px-2 py-1 text-[9px] font-black uppercase tracking-[0.12em] text-white transition-all"
                style={{ background: '#4f46e5' }}>
                Book
              </button>
              <button onClick={handleDelete}
                className={`p-1.5 rounded-md transition-all ${confirmDelete ? 'bg-red-50 text-red-500' : 'text-[#cbd5e1] hover:text-red-400'}`}>
                {confirmDelete ? '?' : <Trash2 size={11} />}
              </button>
              <button onClick={() => { if (!forceExpanded) setExpanded(e => !e); }} className="rounded-lg border border-[#e2e8f0] p-1.5 text-[#94a3b8] hover:text-[#475569] transition-colors">
                {expanded ? <ChevronUp size={13} /> : <ChevronDown size={13} />}
              </button>
            </div>
          </div>

          <div className="mt-3 grid gap-2.5 md:grid-cols-3">
            <div className="rounded-xl border border-[#e2e8f0] bg-white px-3 py-2.5">
              <p className="text-[9px] font-black uppercase tracking-[0.16em] text-[#64748b]">Sessions</p>
              <p className="mt-1 text-sm font-black text-[#0f172a]">{allStudentSessions.length}</p>
              <p className="text-[10px] text-[#64748b]">{upcoming.length} upcoming · {past.length} past</p>
            </div>
            <div className="rounded-xl border border-[#e2e8f0] bg-white px-3 py-2.5">
              <p className="text-[9px] font-black uppercase tracking-[0.16em] text-[#64748b]">Booking</p>
              <p className="mt-1 text-sm font-black" style={{ color: isBooked ? '#15803d' : '#dc2626' }}>{isBooked ? 'Booked this week' : 'Not booked'}</p>
              <p className="text-[10px] text-[#64748b]">{latestSession ? `Last ${new Date(latestSession.date + 'T00:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}` : 'No previous sessions'}</p>
            </div>
            <div className="rounded-xl border border-[#e2e8f0] bg-white px-3 py-2.5">
              <p className="text-[9px] font-black uppercase tracking-[0.16em] text-[#64748b]">Attendance</p>
              <p className="mt-1 text-sm font-black" style={{ color: rateColor }}>{past.length > 0 ? `${Math.round((rate ?? 0) * 100)}%` : 'No data'}</p>
              <div className="mt-1 flex gap-0.5">
                {past.slice(0, 5).map((s, i) => (
                  <div key={i} className="w-2 h-2 rounded-sm" style={{ background: statusDot(s.status) }} />
                ))}
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Expanded panel */}
      {expanded && (
        <div className={forceExpanded ? 'min-h-0 flex-1 overflow-hidden' : ''} style={{ borderBottom: '1px solid #e2e8f0', background: '#fafbfd', boxShadow: 'inset 0 3px 10px rgba(15,23,42,0.04)' }}>
          {/* Tab bar */}
          <div className="flex items-center gap-0 px-6" style={{ borderBottom: '1px solid #e2e8f0', background: '#f8fafc' }}>
            {(['contact', 'sessions'] as const).map(t => (
              <button key={t} onClick={() => setTab(t)}
                className="relative mr-6 py-3 text-[11px] font-bold transition-colors"
                style={tab === t
                  ? { color: '#4f46e5', borderBottom: '2px solid #4f46e5', marginBottom: -1 }
                  : { color: '#64748b', borderBottom: '2px solid transparent', marginBottom: -1 }}>
                {t === 'sessions' ? `Sessions${allStudentSessions.length > 0 ? ` · ${allStudentSessions.length}` : ''}` : 'Contact Info'}
              </button>
            ))}
            <div className="ml-auto flex items-center gap-2 pb-2 pt-2">
              <button onClick={() => { setDraft(student); setShowEditModal(true); }}
                className="flex items-center gap-1.5 rounded-md border px-3 py-1.5 text-[10px] font-bold transition-all"
                style={{ background: '#fff', borderColor: '#cbd5e1', color: '#475569' }}>
                Edit Info
              </button>
            </div>
          </div>

          <div className={forceExpanded ? 'px-6 py-5 h-full overflow-y-auto' : 'px-6 py-5 max-h-[62vh] overflow-y-auto'}>
            {tab === 'contact' && (
              <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                {/* Student */}
                <div>
                  <p className="mb-3 text-[9px] font-black uppercase tracking-[0.22em] text-[#475569]">Student</p>
                  <div className="space-y-2.5">
                    <div className="flex items-center gap-2.5 rounded-lg border border-[#fcd34d] bg-[#fffbeb] px-3 py-2">
                      <Clock size={12} className="shrink-0" style={{ color: '#b45309' }} />
                      <span className="text-[12px] font-black text-[#92400e]">Hours left: {typeof student.hours_left === 'number' ? student.hours_left : 'Not on file'}</span>
                    </div>
                    <div className="flex items-center gap-2.5 rounded-lg border border-[#d1d5db] bg-[#f3f4f6] px-3 py-2">
                      <Mail size={12} className="shrink-0" style={{ color: '#64748b' }} />
                      <span className="text-[12px] font-medium text-[#0f172a] truncate">{student.email ?? 'Not on file'}</span>
                    </div>
                    <div className="flex items-center gap-2.5 rounded-lg border border-[#d1d5db] bg-[#f3f4f6] px-3 py-2">
                      <Phone size={12} className="shrink-0" style={{ color: '#64748b' }} />
                      <span className="text-[12px] font-medium text-[#0f172a]">{student.phone ?? 'Not on file'}</span>
                    </div>
                    <div className="flex items-center gap-2.5 rounded-lg border border-[#d1d5db] bg-[#f3f4f6] px-3 py-2">
                      <ExternalLink size={12} className="shrink-0" style={{ color: '#64748b' }} />
                      <span className="text-[12px] font-medium text-[#0f172a] truncate">{student.bluebook_url ?? 'Not on file'}</span>
                    </div>
                  </div>
                </div>

                {/* Mom */}
                <div style={{ borderLeft: '1px solid #e2e8f0', paddingLeft: '1.5rem' }}>
                  <p className="mb-3 text-[9px] font-black uppercase tracking-[0.22em] text-[#475569]">Mother</p>
                  <div className="space-y-2.5">
                    <div className="flex items-center gap-2.5 rounded-lg border border-[#d1d5db] bg-[#f3f4f6] px-3 py-2"><User size={12} className="shrink-0" style={{ color: '#64748b' }} /><span className="text-[12px] font-semibold text-[#0f172a]">{student.mom_name ?? 'Not on file'}</span></div>
                    <div className="flex items-center gap-2.5 rounded-lg border border-[#d1d5db] bg-[#f3f4f6] px-3 py-2"><Mail size={12} className="shrink-0" style={{ color: '#64748b' }} /><span className="text-[12px] font-medium text-[#0f172a] truncate">{student.mom_email ?? 'Not on file'}</span></div>
                    <div className="flex items-center gap-2.5 rounded-lg border border-[#d1d5db] bg-[#f3f4f6] px-3 py-2"><Phone size={12} className="shrink-0" style={{ color: '#64748b' }} /><span className="text-[12px] font-medium text-[#0f172a]">{student.mom_phone ?? 'Not on file'}</span></div>
                  </div>
                </div>

                {/* Dad */}
                <div style={{ borderLeft: '1px solid #e2e8f0', paddingLeft: '1.5rem' }}>
                  <p className="mb-3 text-[9px] font-black uppercase tracking-[0.22em] text-[#475569]">Father</p>
                  <div className="space-y-2.5">
                    <div className="flex items-center gap-2.5 rounded-lg border border-[#d1d5db] bg-[#f3f4f6] px-3 py-2"><User size={12} className="shrink-0" style={{ color: '#64748b' }} /><span className="text-[12px] font-semibold text-[#0f172a]">{student.dad_name ?? 'Not on file'}</span></div>
                    <div className="flex items-center gap-2.5 rounded-lg border border-[#d1d5db] bg-[#f3f4f6] px-3 py-2"><Mail size={12} className="shrink-0" style={{ color: '#64748b' }} /><span className="text-[12px] font-medium text-[#0f172a] truncate">{student.dad_email ?? 'Not on file'}</span></div>
                    <div className="flex items-center gap-2.5 rounded-lg border border-[#d1d5db] bg-[#f3f4f6] px-3 py-2"><Phone size={12} className="shrink-0" style={{ color: '#64748b' }} /><span className="text-[12px] font-medium text-[#0f172a]">{student.dad_phone ?? 'Not on file'}</span></div>
                  </div>
                </div>
              </div>
            )}

            {tab === 'sessions' && (
              <div className="space-y-1.5 pr-1">
                {allStudentSessions.length === 0 && (
                  <p className="py-6 text-center text-xs italic text-[#94a3b8]">No sessions on record yet</p>
                )}
                {allStudentSessions.map((s, i) => {
                  const d = new Date(s.date + 'T00:00:00');
                  const isPresent = s.status === 'present' || s.status === 'confirmed';
                  const isNoShow = s.status === 'no-show';
                  const dotColor = isPresent ? '#16a34a' : isNoShow ? '#dc2626' : s.isPast ? '#f59e0b' : '#4f46e5';
                  const label = isPresent ? 'Present' : isNoShow ? 'No-show' : s.isPast ? 'Unmarked' : 'Upcoming';
                  const labelBg = isPresent ? '#f0fdf4' : isNoShow ? '#fef2f2' : s.isPast ? '#fffbeb' : '#eef2ff';
                  const labelColor = isPresent ? '#15803d' : isNoShow ? '#dc2626' : s.isPast ? '#b45309' : '#4f46e5';
                  return (
                    <div key={i} className="flex items-center gap-4 rounded-lg px-4 py-3 transition-colors"
                      style={{ background: '#fff', border: '1px solid #e2e8f0' }}>
                      <div className="shrink-0 text-center w-10">
                        <p className="text-[9px] font-bold uppercase leading-none" style={{ color: '#94a3b8' }}>
                          {d.toLocaleDateString('en-US', { month: 'short' })}
                        </p>
                        <p className="text-[15px] font-black leading-snug" style={{ color: s.isPast ? '#94a3b8' : '#0f172a' }}>
                          {d.getDate()}
                        </p>
                      </div>
                      <div className="w-px self-stretch" style={{ background: '#e2e8f0' }} />
                      <div className="flex-1 min-w-0">
                        <p className="text-[12px] font-semibold truncate" style={{ color: s.isPast ? '#64748b' : '#0f172a' }}>
                          {s.topic || <span className="italic text-[#94a3b8]">No topic</span>}
                        </p>
                        <p className="text-[10px] mt-0.5" style={{ color: '#94a3b8' }}>
                          {s.tutorName} · {s.blockLabel}
                        </p>
                      </div>
                      <span className="shrink-0 rounded-full px-2.5 py-0.5 text-[10px] font-bold"
                        style={{ background: labelBg, color: labelColor }}>
                        {label}
                      </span>
                      <div className="w-1.5 h-1.5 rounded-full shrink-0" style={{ background: dotColor }} />
                    </div>
                  );
                })}
                {allStudentSessions.length > 0 && (
                  <div className="pt-2 text-center">
                    <Link href={`/students/${student.id}`}
                      className="inline-flex items-center gap-1.5 rounded-lg px-3 py-2 text-[10px] font-bold uppercase tracking-[0.14em] transition-all"
                      style={{ color: '#4f46e5', background: '#eef2ff', border: '1px solid #c7d2fe' }}>
                      View Full History <ChevronRight size={10} />
                    </Link>
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      )}

      {showBooking && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4"
          style={{ background: 'rgba(15,23,42,0.6)', backdropFilter: 'blur(4px)' }}
          onClick={e => { if (e.target === e.currentTarget) setShowBooking(false); }}>
          <div onClick={e => e.stopPropagation()}>
            <BookingForm prefilledSlot={null} onConfirm={handleConfirmBooking} onCancel={() => setShowBooking(false)}
              enrollCat={enrollCat} setEnrollCat={setEnrollCat} allAvailableSeats={allAvailableSeats} studentDatabase={[student]} />
          </div>
        </div>
      )}

      {showEditModal && (
        <div className="fixed inset-0 z-60 flex items-center justify-center p-4" style={{ background: 'rgba(15,23,42,0.64)', backdropFilter: 'blur(4px)' }}
          onClick={e => { if (e.target === e.currentTarget) { setShowEditModal(false); setDraft(student); } }}>
          <div className="w-full max-w-3xl overflow-hidden rounded-2xl border border-[#cbd5e1] bg-white shadow-[0_30px_80px_rgba(15,23,42,0.35)]"
            onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between border-b border-[#e2e8f0] bg-[#f8fafc] px-5 py-4">
              <div>
                <p className="text-[10px] font-black uppercase tracking-[0.2em] text-[#64748b]">Student Contact Edit</p>
                <p className="mt-1 text-sm font-black text-[#0f172a]">{student.name}</p>
              </div>
              <button onClick={() => { setShowEditModal(false); setDraft(student); }} className="rounded-lg border border-[#cbd5e1] bg-white p-2 text-[#64748b]">
                <X size={14} />
              </button>
            </div>

            <div className="max-h-[72vh] space-y-4 overflow-y-auto p-5">
              <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
                {[
                  { label: 'Student Email', field: 'email', type: 'email' },
                  { label: 'Student Phone', field: 'phone', type: 'tel' },
                  { label: 'Grade', field: 'grade', type: 'text' },
                  { label: 'Hours Left', field: 'hours_left', type: 'number' },
                ].map(({ label, field, type }) => (
                  <div key={field} className={fieldCardCls}>
                    <label className={fieldLabelCls}>{label}</label>
                    <input type={type} value={draft[field] ?? ''} onChange={e => setDraft((p: any) => ({ ...p, [field]: e.target.value }))} className={`${inputCls} mt-2`} placeholder={label} />
                  </div>
                ))}
              </div>

              <div className="rounded-lg border border-[#cbd5e1] bg-[#f8fafc] p-4 shadow-[inset_0_1px_0_rgba(255,255,255,0.9)]">
                <p className="mb-3 text-[9px] font-black uppercase tracking-[0.2em] text-[#64748b]">Mom</p>
                <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
                  {[
                    { label: 'Name', field: 'mom_name', type: 'text' },
                    { label: 'Email', field: 'mom_email', type: 'email' },
                    { label: 'Phone', field: 'mom_phone', type: 'tel' },
                  ].map(({ label, field, type }) => (
                    <div key={field} className={fieldCardCls}>
                      <label className={fieldLabelCls}>{label}</label>
                      <input type={type} value={draft[field] ?? ''} onChange={e => setDraft((p: any) => ({ ...p, [field]: e.target.value }))} className={`${inputCls} mt-2`} placeholder={label} />
                    </div>
                  ))}
                </div>
              </div>

              <div className="rounded-lg border border-[#cbd5e1] bg-[#f8fafc] p-4 shadow-[inset_0_1px_0_rgba(255,255,255,0.9)]">
                <p className="mb-3 text-[9px] font-black uppercase tracking-[0.2em] text-[#64748b]">Dad</p>
                <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
                  {[
                    { label: 'Name', field: 'dad_name', type: 'text' },
                    { label: 'Email', field: 'dad_email', type: 'email' },
                    { label: 'Phone', field: 'dad_phone', type: 'tel' },
                  ].map(({ label, field, type }) => (
                    <div key={field} className={fieldCardCls}>
                      <label className={fieldLabelCls}>{label}</label>
                      <input type={type} value={draft[field] ?? ''} onChange={e => setDraft((p: any) => ({ ...p, [field]: e.target.value }))} className={`${inputCls} mt-2`} placeholder={label} />
                    </div>
                  ))}
                </div>
              </div>

              <div className="rounded-lg border border-[#cbd5e1] bg-white p-4 shadow-[0_1px_2px_rgba(15,23,42,0.06)]">
                <label className={fieldLabelCls}>Bluebook URL</label>
                <input type="url" value={draft.bluebook_url ?? ''} onChange={e => setDraft((p: any) => ({ ...p, bluebook_url: e.target.value }))} className={`${inputCls} mt-2`} placeholder="https://..." />
              </div>
            </div>

            <div className="flex items-center justify-end gap-2 border-t border-[#e2e8f0] bg-white px-5 py-4">
              <button onClick={() => { setShowEditModal(false); setDraft(student); }} className="rounded-xl border border-[#94a3b8] px-4 py-2 text-xs font-black uppercase tracking-[0.16em] text-[#334155]" style={{ background: '#e2e8f0' }}>
                Cancel
              </button>
              <button onClick={handleUpdate} disabled={saving} className="flex items-center gap-1.5 rounded-md px-4 py-2 text-xs font-black uppercase tracking-[0.16em] text-white disabled:opacity-50" style={{ background: '#4f46e5', boxShadow: '0 12px 24px rgba(79,70,229,0.24)' }}>
                {saving ? <Loader2 size={11} className="animate-spin" /> : <Save size={11} />} Save
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function StudentListItem({
  student,
  isActive,
  isSelected,
  onClick,
  onToggle,
  summary,
}: {
  student: any;
  isActive: boolean;
  isSelected: boolean;
  onClick: () => void;
  onToggle: () => void;
  summary: { total: number; upcoming: number; attendanceRate: number | null; isAtRisk: boolean };
}) {
  const initials = student.name.split(' ').map((n: string) => n[0]).join('').slice(0, 2).toUpperCase() || '?';
  return (
    <div
      role="listitem"
      tabIndex={0}
      onClick={onClick}
      className="w-full rounded-xl border px-2.5 py-2 text-left transition-all"
      style={{
        borderColor: isActive ? '#1d4ed8' : isSelected ? '#fca5a5' : '#dbe4ee',
        background: isActive
          ? 'linear-gradient(135deg, #dbeafe 0%, #eff6ff 58%, #ffffff 100%)'
          : isSelected
            ? 'linear-gradient(135deg, #fff7f7 0%, #fff1f2 100%)'
            : '#ffffff',
        boxShadow: isActive ? '0 18px 34px rgba(37,99,235,0.14)' : '0 1px 2px rgba(15,23,42,0.04)',
      }}>
      <div className="flex items-start gap-2.5">
        <button
          type="button"
          onClick={event => {
            event.stopPropagation();
            onToggle();
          }}
          className="mt-0.5 rounded-md border p-1 transition-colors"
          style={{
            borderColor: isActive ? '#c7d2fe' : '#cbd5e1',
            background: isSelected ? '#fee2e2' : 'transparent',
            color: isSelected ? '#dc2626' : isActive ? '#475569' : '#64748b',
          }}>
          {isSelected ? <CheckSquare size={14} /> : <Square size={14} />}
        </button>
        <div className="w-7 h-7 rounded-lg flex items-center justify-center text-[10px] font-black text-white shrink-0" style={{ background: avatarColor(student.name) }}>
          {initials}
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-center justify-between gap-2">
            <p className="truncate text-[12px] font-black leading-tight" style={{ color: '#0f172a' }}>{student.name || 'Unnamed student'}</p>
            {summary.isAtRisk && <AlertTriangle size={12} style={{ color: '#dc2626', flexShrink: 0 }} />}
          </div>
          <div className="mt-1 flex items-center gap-1.5 text-[10px] font-semibold" style={{ color: '#64748b' }}>
            <span>{summary.total} total</span>
            <span>•</span>
            <span>{summary.upcoming} upcoming</span>
            <span>•</span>
            <span>{summary.attendanceRate !== null ? `${Math.round(summary.attendanceRate * 100)}%` : '—'}</span>
          </div>
        </div>
      </div>
    </div>
  );
}

// ── Main Page ─────────────────────────────────────────────────────────────────
export default function StudentAdminPage() {
  const [students, setStudents] = useState<any[]>([]);
  const [tutors, setTutors] = useState<any[]>([]);
  const [allSessions, setAllSessions] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [adding, setAdding] = useState(false);
  const [showImport, setShowImport] = useState(false);
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState<'all' | 'booked' | 'unbooked' | 'active' | 'inactive'>('all');
  const [newStudent, setNewStudent] = useState(EMPTY_FORM);
  const [creating, setCreating] = useState(false);
  const [bookingToast, setBookingToast] = useState<any>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [bulkDeleting, setBulkDeleting] = useState(false);
  const [confirmBulk, setConfirmBulk] = useState(false);
  const [activeStudentId, setActiveStudentId] = useState<string | null>(null);
  const [showAnalytics, setShowAnalytics] = useState(false);

  const fetchData = useCallback(async () => {
    setLoading(true);
    const [sRes, tRes, sesRes] = await Promise.all([
      supabase.from(STUDENTS).select('*').order('name'),
      supabase.from(TUTORS).select('*').order('name'),
      (supabase.from(SESSIONS).select(`id, session_date, tutor_id, time, ${SS}(id, student_id, name, topic, status)`).order('session_date') as any),
    ]);
    setStudents(sRes.data ?? []);
    setTutors(tRes.data ?? []);
    setAllSessions((sesRes.data ?? []).map((r: any) => ({
      id: r.id, date: r.session_date, tutorId: r.tutor_id, time: r.time,
      students: (r[SS] ?? []).map((ss: any) => ({ id: ss.student_id, rowId: ss.id, name: ss.name, topic: ss.topic, status: ss.status })),
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
    allSessions.filter(s => s.date >= today && s.date <= weekEnd).forEach(s => s.students.forEach((st: any) => ids.add(st.id)));
    return ids;
  }, [allSessions, today, weekEnd]);

  const activeIds = useMemo(() => {
    const ids = new Set<string>();
    const dt = new Date(today + 'T00:00:00');
    dt.setDate(dt.getDate() - 30);
    const thirtyDaysAgo = toISODate(dt);
    allSessions
      .filter(s => s.date >= thirtyDaysAgo && s.date <= today)
      .forEach(s => s.students.forEach((st: any) => ids.add(st.id)));
    return ids;
  }, [allSessions, today]);

  const filtered = students.filter(s => {
    if (!s.name.toLowerCase().includes(search.toLowerCase())) return false;
    if (filter === 'booked') return bookedIds.has(s.id);
    if (filter === 'unbooked') return !bookedIds.has(s.id);
    if (filter === 'active') return activeIds.has(s.id);
    if (filter === 'inactive') return !activeIds.has(s.id);
    return true;
  });

  const studentSummaryById = useMemo(() => {
    const map = new Map<string, { total: number; upcoming: number; attendanceRate: number | null; isAtRisk: boolean }>();
    students.forEach(student => {
      const sessionsForStudent = allSessions.flatMap(s => s.students.filter((st: any) => st.id === student.id));
      const total = sessionsForStudent.length;
      const upcoming = allSessions.filter(s => s.date >= today && s.students.some((st: any) => st.id === student.id)).length;
      const pastSessions = allSessions
        .filter(s => s.date < today)
        .flatMap(s => s.students.filter((st: any) => st.id === student.id));
      const present = pastSessions.filter((st: any) => st.status === 'present' || st.status === 'confirmed').length;
      const noShow = pastSessions.filter((st: any) => st.status === 'no-show').length;
      const attendanceRate = pastSessions.length > 0 ? present / pastSessions.length : null;
      const isAtRisk = pastSessions.length >= 3 && noShow / pastSessions.length > 0.4;
      map.set(student.id, { total, upcoming, attendanceRate, isAtRisk });
    });
    return map;
  }, [students, allSessions, today]);

  const activeStudent = filtered.find(student => student.id === activeStudentId)
    ?? students.find(student => student.id === activeStudentId)
    ?? filtered[0]
    ?? students[0]
    ?? null;

  const allSelected = filtered.length > 0 && filtered.every(s => selected.has(s.id));
  const toggleAll = () => {
    if (allSelected) { setSelected(new Set()); }
    else { setSelected(new Set(filtered.map(s => s.id))); }
  };

  const handleBulkDelete = async () => {
    if (!confirmBulk) { setConfirmBulk(true); setTimeout(() => setConfirmBulk(false), 3000); return; }
    setBulkDeleting(true);
    await supabase.from(STUDENTS).delete().in('id', Array.from(selected));
    logEvent('students_bulk_deleted', { count: selected.size });
    setSelected(new Set());
    setConfirmBulk(false);
    setBulkDeleting(false);
    fetchData();
  };

  const handleCreate = async () => {
    if (!newStudent.name) return;
    setCreating(true);
    await supabase.from(STUDENTS).insert([{
      name: newStudent.name, grade: newStudent.grade || null,
      email: newStudent.email || null, phone: newStudent.phone || null,
      mom_name: newStudent.mom_name || null, mom_email: newStudent.mom_email || null,
      mom_phone: newStudent.mom_phone || null,
      dad_name: newStudent.dad_name || null, dad_email: newStudent.dad_email || null,
      dad_phone: newStudent.dad_phone || null,
    }]);
    setAdding(false); setNewStudent(EMPTY_FORM); fetchData(); setCreating(false);
  };

  return (
    <div className="student-admin h-[calc(100dvh-58px)] overflow-hidden md:h-dvh" style={{ background: 'linear-gradient(180deg, #dbe7f5 0%, #eef4fb 180px, #f8fafc 360px, #f8fafc 100%)', fontFamily: 'Inter, Segoe UI, ui-sans-serif, system-ui, sans-serif' }}>
      <div className="flex h-full flex-col overflow-hidden overscroll-contain">

      {/* Top bar */}
      <div className="sticky top-0 z-40 border-b border-[#e2e8f0] backdrop-blur-xl" style={{ background: 'rgba(255,255,255,0.92)' }}>
        <div className="mx-auto flex h-16 max-w-7xl items-center justify-between gap-4 px-5">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-lg border border-[#c7d2fe] bg-[#eef2ff]">
              <GraduationCap size={18} style={{ color: '#4f46e5' }} />
            </div>
            <div>
              <p className="text-[11px] font-black uppercase tracking-[0.22em] text-[#4f46e5]">Student Admin</p>
              <div className="flex items-center gap-2">
                <span className="text-base font-black text-[#0f172a]">Students</span>
                {!loading && <span className="rounded-full border border-[#c7d2fe] bg-[#eef2ff] px-2.5 py-1 text-[10px] font-black uppercase tracking-[0.16em] text-[#3730a3]">{students.length}</span>}
              </div>
            </div>
          </div>
          <div className="flex items-center gap-2">
            {selected.size > 0 && (
              <button onClick={handleBulkDelete} disabled={bulkDeleting}
                className="flex items-center gap-1.5 rounded-xl px-3.5 py-2 text-xs font-black uppercase tracking-[0.16em] text-white transition-all disabled:opacity-50"
                style={{ background: confirmBulk ? '#991b1b' : '#dc2626', boxShadow: '0 12px 24px rgba(127,29,29,0.22)' }}>
                {bulkDeleting ? <Loader2 size={11} className="animate-spin" /> : <Trash2 size={11} />}
                {confirmBulk ? `Confirm delete ${selected.size}` : `Delete ${selected.size}`}
              </button>
            )}
            <button onClick={() => setShowAnalytics(true)}
              className="flex items-center gap-1.5 rounded-md border px-3.5 py-2 text-xs font-black uppercase tracking-[0.16em] transition-all"
              style={{ background: '#ffffff', borderColor: '#cbd5e1', color: '#334155' }}>
              <BarChart2 size={11} /> Analytics
            </button>
            <button onClick={() => setShowImport(true)}
              className="flex items-center gap-1.5 rounded-md border px-3.5 py-2 text-xs font-black uppercase tracking-[0.16em] transition-all"
              style={{ background: '#ffffff', borderColor: '#cbd5e1', color: '#334155' }}>
              <Upload size={11} /> Import CSV
            </button>
            <button onClick={() => setAdding(a => !a)}
              className="flex items-center gap-1.5 rounded-md px-3.5 py-2 text-xs font-black uppercase tracking-[0.16em] text-white transition-all"
              style={{ background: adding ? '#334155' : '#4f46e5', boxShadow: adding ? 'none' : '0 12px 24px rgba(79,70,229,0.24)' }}>
              {adding ? <X size={11} /> : <Plus size={11} />}
              {adding ? 'Cancel' : 'Add Student'}
            </button>
          </div>
        </div>
      </div>

      <div className="mx-auto flex min-h-0 w-full max-w-7xl flex-1 flex-col space-y-4 overflow-hidden px-5 py-4">

        {/* Stats */}
        {!loading && (
          <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
            {[
              { label: 'Total Students', value: students.length, key: 'all', color: '#0f172a', activeBg: '#0f172a', bg: '#fff' },
              { label: 'Booked This Week', value: bookedIds.size, key: 'booked', color: '#16a34a', activeBg: '#16a34a', bg: '#f0fdf4' },
              { label: 'Not Booked', value: students.length - bookedIds.size, key: 'unbooked', color: '#dc2626', activeBg: '#dc2626', bg: '#fff5f5' },
              { label: 'Active (30d)', value: activeIds.size, key: 'active', color: '#15803d', activeBg: '#15803d', bg: '#f0fdf4' },
              { label: 'Inactive (30d)', value: students.length - activeIds.size, key: 'inactive', color: '#64748b', activeBg: '#475569', bg: '#f8fafc' },
            ].map(s => (
              <button key={s.key} onClick={() => setFilter(f => f === s.key ? 'all' : s.key as 'all' | 'booked' | 'unbooked' | 'active' | 'inactive')}
                className="rounded-lg p-4 text-left shadow-[0_14px_32px_rgba(15,23,42,0.08)] transition-all"
                style={{
                  background: filter === s.key ? s.activeBg : s.bg,
                  border: `1px solid ${filter === s.key ? s.activeBg : '#cbd5e1'}`,
                  color: filter === s.key ? '#fff' : s.color,
                }}>
                <p className="text-2xl font-black leading-none">{s.value}</p>
                <p className="mt-1.5 text-[10px] font-black uppercase tracking-[0.18em] opacity-70">{s.label}</p>
              </button>
            ))}
          </div>
        )}
        {/* Add student form */}
        {adding && (
          <div className="overflow-hidden rounded-xl bg-white shadow-[0_20px_44px_rgba(15,23,42,0.1)]" style={{ border: '1px solid #cbd5e1' }}>
            <div className="flex items-center justify-between px-5 py-4" style={{ background: '#f8fafc', borderBottom: '1px solid #e2e8f0' }}>
              <div>
                <p className="text-xs font-black uppercase tracking-[0.22em] text-[#dc2626]">New Student</p>
                <p className="mt-1 text-xs font-medium text-[#64748b]">Clear sections, stronger labels, and better field contrast.</p>
              </div>
              <button onClick={() => setAdding(false)} className="flex h-9 w-9 items-center justify-center rounded-full border border-[#e2e8f0] bg-white text-[#64748b]"><X size={14} /></button>
            </div>
            <div className="space-y-5 p-5">
              <div className="grid grid-cols-2 gap-3">
                <div className={`${fieldCardCls} col-span-2 md:col-span-1`}>
                  <label className={fieldLabelCls}>Name *</label>
                  <input value={newStudent.name} onChange={e => setNewStudent({ ...newStudent, name: e.target.value })} className={inputCls} placeholder="Full name" />
                </div>
                <div className={fieldCardCls}>
                  <label className={fieldLabelCls}>Grade</label>
                  <input value={newStudent.grade} onChange={e => setNewStudent({ ...newStudent, grade: e.target.value })} className={inputCls} placeholder="1–12" />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                {[['Email','email','email','student@email.com'],['Phone','phone','tel','(555) 000-0000']].map(([l,f,t,ph]) => (
                  <div key={f} className={fieldCardCls}>
                    <label className={fieldLabelCls}>{l}</label>
                    <input type={t} value={(newStudent as any)[f]} onChange={e => setNewStudent({ ...newStudent, [f]: e.target.value })} className={inputCls} placeholder={ph} />
                  </div>
                ))}
              </div>
              <div className="rounded-lg border border-[#cbd5e1] bg-[#f8fafc] p-4 shadow-[inset_0_1px_0_rgba(255,255,255,0.9)]">
                <p className="mb-3 text-[9px] font-black uppercase tracking-[0.2em] text-[#64748b]">Mom</p>
                <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
                {[['Mom Name','mom_name','text','Mom name'],['Mom Email','mom_email','email','mom@email.com'],['Mom Phone','mom_phone','tel','(555) 000-0000']].map(([l,f,t,ph]) => (
                  <div key={f} className={fieldCardCls}>
                    <label className={fieldLabelCls}>{l}</label>
                    <input type={t} value={(newStudent as any)[f]} onChange={e => setNewStudent({ ...newStudent, [f]: e.target.value })} className={inputCls} placeholder={ph} />
                  </div>
                ))}
              </div>
              </div>
              <div className="rounded-lg border border-[#cbd5e1] bg-[#f8fafc] p-4 shadow-[inset_0_1px_0_rgba(255,255,255,0.9)]">
                <p className="mb-3 text-[9px] font-black uppercase tracking-[0.2em] text-[#64748b]">Dad</p>
                <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
                {[['Dad Name','dad_name','text','Dad name'],['Dad Email','dad_email','email','dad@email.com'],['Dad Phone','dad_phone','tel','(555) 000-0000']].map(([l,f,t,ph]) => (
                  <div key={f} className={fieldCardCls}>
                    <label className={fieldLabelCls}>{l}</label>
                    <input type={t} value={(newStudent as any)[f]} onChange={e => setNewStudent({ ...newStudent, [f]: e.target.value })} className={inputCls} placeholder={ph} />
                  </div>
                ))}
              </div>
              </div>
              <button onClick={handleCreate} disabled={!newStudent.name || creating}
                className="w-full rounded-md py-3 text-sm font-black uppercase tracking-[0.2em] text-white disabled:opacity-40"
                style={{ background: '#4f46e5', boxShadow: '0 16px 30px rgba(79,70,229,0.24)' }}>
                {creating ? <Loader2 size={14} className="animate-spin mx-auto" /> : 'Register Student'}
              </button>
            </div>
          </div>
        )}

        {/* Student roster + detail */}
        {loading ? (
          <div className="flex flex-col items-center py-24 gap-3">
            <Loader2 size={22} className="animate-spin text-[#dc2626]" />
            <p className="text-xs font-semibold text-[#94a3b8] uppercase tracking-widest">Loading…</p>
          </div>
        ) : filtered.length > 0 ? (
          <div className="grid min-h-0 flex-1 gap-4 xl:grid-cols-[290px_minmax(0,1fr)]">
            <div className="flex min-h-0 flex-col space-y-2.5 rounded-3xl border border-[#9fb4d1] bg-[linear-gradient(180deg,#dbe7f5_0%,#eef4fb_100%)] p-2.5 shadow-[0_24px_60px_rgba(15,23,42,0.12)]">
              <div className="rounded-xl border border-[#bfd0e6] bg-[linear-gradient(135deg,#ffffff_0%,#edf4ff_100%)] p-2.5 shadow-[0_8px_20px_rgba(15,23,42,0.05)]">
                <p className="text-[10px] font-black uppercase tracking-[0.18em] text-[#2563eb]">Roster</p>
                <div className="mt-1 flex items-center justify-between gap-2">
                  <p className="text-sm font-black text-[#0f172a]">{filtered.length} students</p>
                  <span className="rounded-full bg-[#dbeafe] px-2 py-0.5 text-[10px] font-black uppercase tracking-[0.16em] text-[#1d4ed8]">{activeIds.size} active</span>
                </div>
                <input
                  value={search}
                  onChange={e => setSearch(e.target.value)}
                  placeholder="Search name, email, phone"
                  className="mt-2.5 w-full rounded-lg border border-[#cbd5e1] bg-[#f8fafc] px-3 py-2 text-sm font-medium text-[#0f172a] placeholder:text-[#94a3b8] focus:border-[#60a5fa] focus:outline-none"
                />
              </div>

              <div className="flex items-center justify-between rounded-xl border border-[#bfd0e6] bg-white px-3 py-2 shadow-[0_6px_16px_rgba(15,23,42,0.04)]">
                <button onClick={toggleAll} className="flex items-center gap-2 text-[10px] font-black uppercase tracking-[0.16em] text-[#475569]">
                  {allSelected ? <CheckSquare size={14} style={{ color: '#f87171' }} /> : <Square size={14} />}
                  {allSelected ? 'Clear selection' : 'Select all'}
                </button>
                <span className="rounded-full bg-[#eef2ff] px-2.5 py-1 text-[10px] font-black uppercase tracking-[0.16em] text-[#3730a3]">{selected.size} selected</span>
              </div>

              <div className="min-h-0 space-y-2 overflow-y-auto pr-1">
                {filtered.map(student => (
                  <StudentListItem
                    key={student.id}
                    student={student}
                    isActive={activeStudent?.id === student.id}
                    isSelected={selected.has(student.id)}
                    summary={studentSummaryById.get(student.id) ?? { total: 0, upcoming: 0, attendanceRate: null, isAtRisk: false }}
                    onClick={() => setActiveStudentId(student.id)}
                    onToggle={() => {
                      const next = new Set(selected);
                      if (next.has(student.id)) next.delete(student.id);
                      else next.add(student.id);
                      setSelected(next);
                    }}
                  />
                ))}
              </div>
            </div>

            <div className="min-h-0 h-full overflow-hidden">
              {activeStudent ? (
                <StudentRow
                  key={activeStudent.id}
                  student={activeStudent}
                  isActive={activeIds.has(activeStudent.id)}
                  selected={selected.has(activeStudent.id)}
                  forceExpanded={true}
                  onToggle={() => setSelected(sel => { const n = new Set(sel); n.has(activeStudent.id) ? n.delete(activeStudent.id) : n.add(activeStudent.id); return n; })}
                  onRefetch={fetchData}
                  tutors={tutors}
                  allSessions={allSessions}
                  allAvailableSeats={allAvailableSeats}
                  onBookingSuccess={d => { setBookingToast(d); setTimeout(() => setBookingToast(null), 4000); }}
                />
              ) : (
                <div className="rounded-[28px] border border-[#cbd5e1] bg-white px-6 py-16 text-center shadow-[0_24px_60px_rgba(15,23,42,0.12)]">
                  <p className="text-lg font-black text-[#0f172a]">Pick a student</p>
                  <p className="mt-2 text-[12px] text-[#64748b]">Select someone from the roster to review contact, sessions, and book quickly.</p>
                </div>
              )}
            </div>
          </div>
        ) : (
          <div className="rounded-xl bg-white py-24 text-center shadow-[0_20px_44px_rgba(15,23,42,0.08)]" style={{ border: '1px dashed #cbd5e1' }}>
            <GraduationCap size={28} className="mx-auto mb-3 text-[#cbd5e1]" />
            <p className="text-sm font-bold text-[#94a3b8]">No students found</p>
            {search && <p className="text-xs text-[#cbd5e1] mt-1">Try a different search</p>}
          </div>
        )}
      </div>
      </div>

      {showImport && <CSVImportModal onClose={() => setShowImport(false)} onImported={fetchData} />}
      {bookingToast && <BookingToast data={bookingToast} onClose={() => setBookingToast(null)} />}
      {showAnalytics && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{ background: 'rgba(15,23,42,0.56)', backdropFilter: 'blur(4px)' }}
          onClick={e => { if (e.target === e.currentTarget) setShowAnalytics(false); }}>
          <div className="w-full max-w-6xl max-h-[88vh] overflow-y-auto" onClick={e => e.stopPropagation()}>
            <div className="mb-3 flex items-center justify-end">
              <button onClick={() => setShowAnalytics(false)} className="rounded-lg border border-[#cbd5e1] bg-white p-2 text-[#64748b]">
                <X size={14} />
              </button>
            </div>
            <MetricsPanel students={students} allSessions={allSessions} tutors={tutors} />
          </div>
        </div>
      )}
      <style>{`
        .student-admin button {
          border-radius: 8px !important;
        }
      `}</style>
    </div>
  );
}