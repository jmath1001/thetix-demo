"use client"
import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import Link from 'next/link';
import {
  Plus, Trash2, GraduationCap, Loader2, Save, X, Search,
  ChevronDown, ChevronUp, ExternalLink, BarChart2, AlertTriangle,
  Upload, CheckSquare, Square, FileText, ChevronRight, Mail, Phone, User
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
    return {
      total: past.length, present: present.length, noShow: noShow.length,
      attendanceRate: past.length > 0 ? present.length / past.length : null,
      noShowRate: past.length > 0 ? noShow.length / past.length : null,
      bookingCoverage: students.length > 0 ? bookedThisWeek.size / students.length : null,
      bookedCount: bookedThisWeek.size, atRisk, studentStats, tutorLoad, dowStats,
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
              { label: 'Attendance', value: pct(metrics.attendanceRate), sub: `${metrics.present}/${metrics.total}`, color: rateColor(metrics.attendanceRate) },
              { label: 'No-show', value: pct(metrics.noShowRate), sub: `${metrics.noShow} sessions`, color: metrics.noShowRate && metrics.noShowRate > 0.2 ? '#dc2626' : '#16a34a' },
              { label: 'Booked This Week', value: pct(metrics.bookingCoverage), sub: `${metrics.bookedCount}/${students.length}`, color: rateColor(metrics.bookingCoverage) },
              { label: 'At Risk', value: String(metrics.atRisk.length), sub: '>40% no-show rate', color: metrics.atRisk.length > 0 ? '#dc2626' : '#16a34a' },
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

// ── Student Row (table row style) ─────────────────────────────────────────────
function StudentRow({
  student, selected, onToggle, onRefetch, tutors, allSessions, allAvailableSeats, onBookingSuccess,
}: {
  student: any; selected: boolean; onToggle: () => void;
  onRefetch: () => void; tutors: any[]; allSessions: any[];
  allAvailableSeats: any[]; onBookingSuccess: (d: any) => void;
}) {
  const [expanded, setExpanded] = useState(false);
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
    <>
      {/* Main row */}
      <div className="grid items-center transition-all"
        style={{
          gridTemplateColumns: '32px 34px minmax(140px,2.2fr) minmax(56px,0.75fr) minmax(88px,1fr) minmax(88px,1fr) minmax(68px,0.8fr) minmax(108px,1fr)',
          borderBottom: expanded ? 'none' : '1px solid #dbe4ee',
          background: selected ? '#fff1f2' : expanded ? '#f8fbff' : '#ffffff',
          minHeight: 58,
        }}>

        {/* Checkbox */}
        <div className="flex items-center justify-center" onClick={e => e.stopPropagation()}>
          <button onClick={onToggle} className="text-[#64748b] hover:text-[#dc2626] transition-colors">
            {selected ? <CheckSquare size={14} style={{ color: '#dc2626' }} /> : <Square size={14} />}
          </button>
        </div>

        {/* Avatar */}
        <div className="flex items-center justify-center">
          <div className="w-7 h-7 rounded-lg flex items-center justify-center text-[10px] font-black text-white shrink-0"
            style={{ background: color }}>{initials}</div>
        </div>

        {/* Name + risk */}
        <div className="flex items-center gap-2 min-w-0 cursor-pointer pr-2" onClick={() => setExpanded(e => !e)}>
          <div className="min-w-0">
            <div className="flex items-center gap-1.5">
              <span className="text-[13px] font-black text-[#0f172a] truncate">{student.name}</span>
              {isAtRisk && <AlertTriangle size={10} style={{ color: '#dc2626', flexShrink: 0 }} />}
            </div>
            {student.grade && <span className="text-[10px] text-[#94a3b8]">Grade {student.grade}</span>}
          </div>
        </div>

        {/* Sessions count */}
        <div className="text-center">
          <span className="text-[12px] font-bold text-[#475569]">{allStudentSessions.length}</span>
        </div>

        {/* Booking status */}
        <div className="flex items-center gap-1.5">
          <span className="w-1.5 h-1.5 rounded-full shrink-0" style={{ background: isBooked ? '#16a34a' : '#dc2626' }} />
          <span className="text-[11px] font-semibold" style={{ color: isBooked ? '#16a34a' : '#dc2626' }}>
            {isBooked ? 'Booked' : 'Not booked'}
          </span>
        </div>

        {/* Attendance */}
        <div className="flex items-center gap-1.5">
          {past.length > 0 ? (
            <>
              <div className="flex gap-0.5">
                {past.slice(0, 5).map((s, i) => (
                  <div key={i} className="w-2 h-2 rounded-sm" style={{ background: statusDot(s.status) }} />
                ))}
              </div>
              <span className="text-[11px] font-bold" style={{ color: rateColor }}>
                {rate !== null ? `${Math.round(rate * 100)}%` : '—'}
              </span>
            </>
          ) : (
            <span className="text-[11px] text-[#cbd5e1]">No data</span>
          )}
        </div>

        {/* Next session */}
        <div>
          {nextSession ? (
            <span className="text-[10px] text-[#64748b]">
              {new Date(nextSession.date + 'T00:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
            </span>
          ) : (
            <span className="text-[10px] text-[#cbd5e1]">—</span>
          )}
        </div>

        {/* Actions */}
        <div className="flex items-center justify-end gap-1 pr-3" onClick={e => e.stopPropagation()}>
          <Link href={`/students/${student.id}`}
            className="inline-flex rounded-lg px-2.5 py-1.5 text-[10px] font-black uppercase tracking-[0.16em] text-[#7f1d1d] transition-all"
            style={{ background: '#fee2e2', border: '1px solid #fca5a5' }}>
            History
          </Link>
          <button onClick={() => setShowBooking(true)}
            className="rounded-lg px-2.5 py-1.5 text-[10px] font-black uppercase tracking-[0.16em] text-white transition-all"
            style={{ background: '#dc2626', boxShadow: '0 8px 18px rgba(220,38,38,0.24)' }}>Book</button>
          <button onClick={() => { setDraft(student); setShowEditModal(true); }}
            className="rounded-lg px-2.5 py-1.5 text-[10px] font-black uppercase tracking-[0.16em] text-[#334155] transition-all"
            style={{ background: '#e2e8f0', border: '1px solid #94a3b8' }}>Edit</button>
          <button onClick={handleDelete}
            className={`p-1 rounded-md transition-all ${confirmDelete ? 'bg-red-50 text-red-500' : 'text-[#cbd5e1] hover:text-red-400'}`}>
            {confirmDelete ? '?' : <Trash2 size={11} />}
          </button>
          <button onClick={() => setExpanded(e => !e)} className="p-1 text-[#94a3b8]">
            {expanded ? <ChevronUp size={12} /> : <ChevronDown size={12} />}
          </button>
        </div>
      </div>

      {/* Expanded panel */}
      {expanded && (
        <div style={{ borderBottom: '1px solid #dbe4ee', background: '#f8fbff', borderLeft: '4px solid #dc2626' }}>
          <div className="flex gap-0 px-4" style={{ background: '#e2e8f0', borderBottom: '1px solid #cbd5e1' }}>
            {(['contact', 'sessions'] as const).map(t => (
              <button key={t} onClick={() => setTab(t)}
                className="-mb-px mr-5 border-b-2 py-3 text-[10px] font-black uppercase tracking-[0.2em] transition-colors"
                style={tab === t ? { color: '#7f1d1d', borderColor: '#dc2626' } : { color: '#475569', borderColor: 'transparent' }}>
                {t === 'sessions' ? `Sessions (${allStudentSessions.length})` : 'Contact'}
              </button>
            ))}
          </div>

          <div className="p-4 max-h-[62vh] overflow-y-auto">
            {tab === 'contact' && (
              <div className="space-y-4">
                <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                  {[
                    { label: 'Student Email', field: 'email', type: 'email', value: student.email },
                    { label: 'Student Phone', field: 'phone', type: 'tel', value: student.phone },
                    { label: 'Grade', field: 'grade', type: 'text', value: student.grade },
                    { label: 'Hours Left', field: 'hours_left', type: 'number', value: student.hours_left },
                  ].map(({ label, field, type, value }) => (
                    <div key={field} className={fieldCardCls}>
                      <label className={fieldLabelCls}>{label}</label>
                      <p className={fieldValueCls}>{value || <span className="text-xs italic text-[#94a3b8]">—</span>}</p>
                    </div>
                  ))}
                </div>
                <div className="rounded-lg border border-[#cbd5e1] bg-white p-4 shadow-[0_1px_2px_rgba(15,23,42,0.06)]">
                  <p className="mb-3 text-[9px] font-black uppercase tracking-[0.2em] text-[#64748b]">Mom</p>
                  <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                    {[
                      { label: 'Name', field: 'mom_name', type: 'text', value: student.mom_name },
                      { label: 'Email', field: 'mom_email', type: 'email', value: student.mom_email },
                      { label: 'Phone', field: 'mom_phone', type: 'tel', value: student.mom_phone },
                    ].map(({ label, field, type, value }) => (
                      <div key={field} className={fieldCardCls}>
                        <label className={fieldLabelCls}>{label}</label>
                        <p className={fieldValueCls}>{value || <span className="text-xs italic text-[#94a3b8]">—</span>}</p>
                      </div>
                    ))}
                  </div>
                </div>
                <div className="rounded-lg border border-[#cbd5e1] bg-white p-4 shadow-[0_1px_2px_rgba(15,23,42,0.06)]">
                  <p className="mb-3 text-[9px] font-black uppercase tracking-[0.2em] text-[#64748b]">Dad</p>
                  <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                    {[
                      { label: 'Name', field: 'dad_name', type: 'text', value: student.dad_name },
                      { label: 'Email', field: 'dad_email', type: 'email', value: student.dad_email },
                      { label: 'Phone', field: 'dad_phone', type: 'tel', value: student.dad_phone },
                    ].map(({ label, field, type, value }) => (
                      <div key={field} className={fieldCardCls}>
                        <label className={fieldLabelCls}>{label}</label>
                        <p className={fieldValueCls}>{value || <span className="text-xs italic text-[#94a3b8]">—</span>}</p>
                      </div>
                    ))}
                  </div>
                </div>
                <div className="rounded-lg border border-[#cbd5e1] bg-white p-4 shadow-[0_1px_2px_rgba(15,23,42,0.06)]">
                  <p className="mb-1.5 text-[9px] font-black uppercase tracking-[0.2em] text-[#64748b]">Bluebook</p>
                  {student.bluebook_url
                    ? <a href={student.bluebook_url} target="_blank" rel="noopener noreferrer"
                        className="inline-flex items-center gap-2 rounded-xl px-3.5 py-2 text-xs font-black uppercase tracking-[0.14em]"
                        style={{ background: '#dcfce7', border: '1px solid #86efac', color: '#166534' }}>
                        <ExternalLink size={11} /> Open Bluebook
                      </a>
                    : <p className="text-xs italic text-[#94a3b8]">No Bluebook linked</p>}
                </div>
              </div>
            )}

            {tab === 'sessions' && (
              <div className="space-y-1.5 max-h-105 overflow-y-auto pr-1">
                {allStudentSessions.length === 0 && <p className="text-xs text-[#94a3b8] italic">No sessions yet</p>}
                {allStudentSessions.map((s, i) => {
                  const d = new Date(s.date + 'T00:00:00');
                  const statusColors: Record<string, { bg: string; text: string }> = {
                    present: { bg: '#f0fdf4', text: '#16a34a' },
                    confirmed: { bg: '#f0fdf4', text: '#16a34a' },
                    'no-show': { bg: '#fef2f2', text: '#dc2626' },
                  };
                  const sc = statusColors[s.status] ?? { bg: '#f8fafc', text: '#64748b' };
                  return (
                    <div key={i} className="flex items-center gap-3 rounded-xl px-3 py-2.5"
                      style={{ background: s.isPast ? '#f8fafc' : '#ffffff', border: '1px solid #dbe4ee' }}>
                      <div className="text-center w-8 shrink-0">
                        <p className="text-[8px] font-black uppercase text-[#94a3b8] leading-none">{d.toLocaleDateString('en-US', { month: 'short' })}</p>
                        <p className="text-sm font-black leading-tight" style={{ color: s.isPast ? '#94a3b8' : '#0f172a' }}>{d.getDate()}</p>
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-xs font-bold truncate" style={{ color: s.isPast ? '#475569' : '#0f172a' }}>{s.topic}</p>
                        <p className="text-[10px] text-[#94a3b8]">{s.tutorName} · {s.blockLabel}</p>
                      </div>
                      <span className="text-[9px] font-bold px-2 py-0.5 rounded-full shrink-0"
                        style={{ background: sc.bg, color: sc.text }}>
                        {s.status === 'present' || s.status === 'confirmed' ? 'Present' : s.status === 'no-show' ? 'No-show' : s.isPast ? 'Unmarked' : 'Upcoming'}
                      </span>
                    </div>
                  );
                })}
                {allStudentSessions.length > 0 && (
                  <div className="pt-2 text-center">
                    <Link href={`/students/${student.id}`}
                      className="inline-flex items-center gap-1 rounded-lg px-2.5 py-1.5 text-[10px] font-black uppercase tracking-[0.16em]"
                      style={{ color: '#7f1d1d', background: '#fff1f2', border: '1px solid #fecdd3' }}>
                      Full History <ChevronRight size={10} />
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
          style={{ background: 'rgba(15,23,42,0.6)', backdropFilter: 'blur(4px)' }}>
          <BookingForm prefilledSlot={null} onConfirm={handleConfirmBooking} onCancel={() => setShowBooking(false)}
            enrollCat={enrollCat} setEnrollCat={setEnrollCat} allAvailableSeats={allAvailableSeats} studentDatabase={[student]} />
        </div>
      )}

      {showEditModal && (
        <div className="fixed inset-0 z-60 flex items-center justify-center p-4" style={{ background: 'rgba(15,23,42,0.64)', backdropFilter: 'blur(4px)' }}>
          <div className="w-full max-w-3xl overflow-hidden rounded-2xl border border-[#cbd5e1] bg-white shadow-[0_30px_80px_rgba(15,23,42,0.35)]">
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
    </>
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
  const [filter, setFilter] = useState<'all' | 'booked' | 'unbooked'>('all');
  const [newStudent, setNewStudent] = useState(EMPTY_FORM);
  const [creating, setCreating] = useState(false);
  const [bookingToast, setBookingToast] = useState<any>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [bulkDeleting, setBulkDeleting] = useState(false);
  const [confirmBulk, setConfirmBulk] = useState(false);

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

  const filtered = students.filter(s => {
    if (!s.name.toLowerCase().includes(search.toLowerCase())) return false;
    if (filter === 'booked') return bookedIds.has(s.id);
    if (filter === 'unbooked') return !bookedIds.has(s.id);
    return true;
  });

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
    <div className="student-admin h-[calc(100dvh-58px)] overflow-hidden md:h-dvh" style={{ background: 'linear-gradient(180deg, #dbe5f0 0%, #edf2f7 26%, #f6f8fb 100%)', fontFamily: 'ui-sans-serif, system-ui, sans-serif' }}>
      <div className="h-full overflow-y-auto overscroll-contain">

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

      <div className="mx-auto max-w-7xl px-5 py-5 space-y-4">

        {/* Stats */}
        {!loading && (
          <div className="grid grid-cols-3 gap-3">
            {[
              { label: 'Total Students', value: students.length, key: 'all', color: '#0f172a', activeBg: '#0f172a', bg: '#fff' },
              { label: 'Booked This Week', value: bookedIds.size, key: 'booked', color: '#16a34a', activeBg: '#16a34a', bg: '#f0fdf4' },
              { label: 'Not Booked', value: students.length - bookedIds.size, key: 'unbooked', color: '#dc2626', activeBg: '#dc2626', bg: '#fff5f5' },
            ].map(s => (
              <button key={s.key} onClick={() => setFilter(f => f === s.key ? 'all' : s.key as any)}
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

        {!loading && <MetricsPanel students={students} allSessions={allSessions} tutors={tutors} />}

        {/* Search */}
        <div className="relative rounded-xl border border-[#cbd5e1] bg-white p-2 shadow-[0_18px_38px_rgba(15,23,42,0.08)]">
          <Search size={13} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-[#94a3b8]" />
          <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search students…"
            className="w-full rounded-lg border border-[#cbd5e1] bg-[#f8fafc] py-3 pl-10 pr-10 text-sm font-medium text-[#0f172a] outline-none transition-all placeholder:text-[#64748b] focus:border-[#4f46e5] focus:ring-4 focus:ring-[#e0e7ff]" />
          {search && <button onClick={() => setSearch('')} className="absolute right-3 top-1/2 -translate-y-1/2 text-[#94a3b8]"><X size={13} /></button>}
        </div>

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

        {/* Table */}
        {loading ? (
          <div className="flex flex-col items-center py-24 gap-3">
            <Loader2 size={22} className="animate-spin text-[#dc2626]" />
            <p className="text-xs font-semibold text-[#94a3b8] uppercase tracking-widest">Loading…</p>
          </div>
        ) : filtered.length > 0 ? (
          <div className="overflow-hidden rounded-xl bg-white shadow-[0_20px_44px_rgba(15,23,42,0.1)]" style={{ border: '1px solid #cbd5e1' }}>
            {/* Table header */}
            <div className="grid items-center px-0"
              style={{ gridTemplateColumns: '32px 34px minmax(140px,2.2fr) minmax(56px,0.75fr) minmax(88px,1fr) minmax(88px,1fr) minmax(68px,0.8fr) minmax(108px,1fr)', background: '#f8fafc', borderBottom: '1px solid #e2e8f0', height: 40 }}>
              <div className="flex items-center justify-center">
                <button onClick={toggleAll} className="text-[#94a3b8] hover:text-[#dc2626] transition-colors">
                  {allSelected ? <CheckSquare size={13} style={{ color: '#dc2626' }} /> : <Square size={13} />}
                </button>
              </div>
              <div />
              {['Student', 'Sessions', 'Booking', 'Attendance', 'Next', 'Actions'].map(h => (
                <div key={h} className={`text-[9px] font-black uppercase tracking-[0.2em] text-[#64748b] ${h === 'Actions' ? 'text-right pr-3' : ''}`}>{h}</div>
              ))}
            </div>
            {/* Rows */}
            {filtered.map(s => (
              <StudentRow
                key={s.id} student={s}
                selected={selected.has(s.id)}
                onToggle={() => setSelected(sel => { const n = new Set(sel); n.has(s.id) ? n.delete(s.id) : n.add(s.id); return n; })}
                onRefetch={fetchData} tutors={tutors} allSessions={allSessions}
                allAvailableSeats={allAvailableSeats}
                onBookingSuccess={d => { setBookingToast(d); setTimeout(() => setBookingToast(null), 4000); }}
              />
            ))}
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
      <style>{`
        .student-admin button {
          border-radius: 8px !important;
        }
      `}</style>
    </div>
  );
}