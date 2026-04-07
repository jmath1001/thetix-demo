"use client"
import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
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

const EMPTY_FORM = { name: '', grade: '', email: '', phone: '', parent_name: '', parent_email: '', parent_phone: '' };
const ACTIVE_DAYS = [1, 2, 3, 4, 6];
const DAY_NAMES = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Saturday'];
const MAX_CAPACITY = 3;

const isTutorAvailable = (tutor: any, dow: number, time: string) =>
  tutor.availability_blocks?.includes(`${dow}-${time}`);

const inputCls = "w-full px-3 py-2 bg-[#f8fafc] rounded-lg text-sm text-[#0f172a] outline-none focus:ring-2 focus:ring-[#dc2626] border border-[#e2e8f0] focus:border-[#dc2626] placeholder:text-[#94a3b8] transition-colors";

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
    <div className="rounded-xl overflow-hidden" style={{ border: `1px solid ${open ? '#fecaca' : '#e2e8f0'}` }}>
      <button onClick={() => setOpen(o => !o)}
        className="w-full flex items-center justify-between px-5 py-3 transition-all"
        style={{ background: open ? '#fff5f5' : '#fafafa' }}>
        <div className="flex items-center gap-2.5">
          <BarChart2 size={13} style={{ color: open ? '#dc2626' : '#94a3b8' }} />
          <div className="text-left">
            <p className="text-xs font-black text-[#1e293b]">Analytics</p>
            <p className="text-[10px] text-[#94a3b8]">
              {metrics.total > 0 ? `${metrics.total} sessions · ${pct(metrics.attendanceRate)} attendance · ${pct(metrics.noShowRate)} no-show` : 'No past data yet'}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {metrics.atRisk.length > 0 && (
            <span className="text-[9px] font-black px-2 py-0.5 rounded-full flex items-center gap-1" style={{ background: '#fef2f2', color: '#dc2626' }}>
              <AlertTriangle size={8} /> {metrics.atRisk.length} at risk
            </span>
          )}
          {open ? <ChevronUp size={12} className="text-[#94a3b8]" /> : <ChevronDown size={12} className="text-[#94a3b8]" />}
        </div>
      </button>
      {open && (
        <div style={{ borderTop: '1px solid #f1f5f9' }}>
          <div className="grid grid-cols-2 md:grid-cols-4" style={{ borderBottom: '1px solid #f1f5f9' }}>
            {[
              { label: 'Attendance', value: pct(metrics.attendanceRate), sub: `${metrics.present}/${metrics.total}`, color: rateColor(metrics.attendanceRate) },
              { label: 'No-show', value: pct(metrics.noShowRate), sub: `${metrics.noShow} sessions`, color: metrics.noShowRate && metrics.noShowRate > 0.2 ? '#dc2626' : '#16a34a' },
              { label: 'Booked This Week', value: pct(metrics.bookingCoverage), sub: `${metrics.bookedCount}/${students.length}`, color: rateColor(metrics.bookingCoverage) },
              { label: 'At Risk', value: String(metrics.atRisk.length), sub: '>40% no-show rate', color: metrics.atRisk.length > 0 ? '#dc2626' : '#16a34a' },
            ].map((k, i) => (
              <div key={k.label} className="px-5 py-4" style={{ borderRight: i < 3 ? '1px solid #f1f5f9' : 'none' }}>
                <p className="text-[9px] font-black uppercase tracking-widest text-[#94a3b8] mb-1">{k.label}</p>
                <p className="text-2xl font-black leading-none" style={{ color: k.color }}>{k.value}</p>
                <p className="text-[10px] text-[#94a3b8] mt-1">{k.sub}</p>
              </div>
            ))}
          </div>
          <div className="grid md:grid-cols-3" style={{ borderBottom: '1px solid #f1f5f9' }}>
            <div className="p-4" style={{ borderRight: '1px solid #f1f5f9' }}>
              <p className="text-[9px] font-black uppercase tracking-widest text-[#94a3b8] mb-3">No-shows by Day</p>
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
            <div className="p-4" style={{ borderRight: '1px solid #f1f5f9' }}>
              <p className="text-[9px] font-black uppercase tracking-widest text-[#94a3b8] mb-3">{metrics.atRisk.length > 0 ? 'At-Risk Students' : 'Lowest Attendance'}</p>
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
              <p className="text-[9px] font-black uppercase tracking-widest text-[#94a3b8] mb-3">Tutor Load This Week</p>
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
  const [isEditing, setIsEditing] = useState(false);
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
          gridTemplateColumns: '36px 36px 2fr 60px 100px 100px 80px 120px',
          borderBottom: expanded ? 'none' : '1px solid #f1f5f9',
          background: selected ? '#fff5f5' : expanded ? '#fafafa' : '#fff',
          minHeight: 52,
        }}>

        {/* Checkbox */}
        <div className="flex items-center justify-center" onClick={e => e.stopPropagation()}>
          <button onClick={onToggle} className="text-[#94a3b8] hover:text-[#dc2626] transition-colors">
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
              <span className="text-[13px] font-bold text-[#0f172a] truncate">{student.name}</span>
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
        <div className="flex items-center gap-1 pr-3" onClick={e => e.stopPropagation()}>
          <button onClick={() => setShowBooking(true)}
            className="px-2 py-1 rounded-md text-[10px] font-black text-white transition-all"
            style={{ background: '#dc2626' }}>Book</button>
          <button onClick={() => { setIsEditing(true); setExpanded(true); setTab('contact'); }}
            className="px-2 py-1 rounded-md text-[10px] font-bold text-[#64748b] transition-all"
            style={{ background: '#f1f5f9', border: '1px solid #e2e8f0' }}>Edit</button>
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
        <div style={{ borderBottom: '1px solid #f1f5f9', background: '#fafafa', borderLeft: '3px solid #dc2626' }}>
          <div className="flex px-4 gap-0" style={{ background: '#f1f5f9', borderBottom: '1px solid #e2e8f0' }}>
            {(['contact', 'sessions'] as const).map(t => (
              <button key={t} onClick={() => setTab(t)}
                className="py-2 mr-5 text-[10px] font-black uppercase tracking-widest border-b-2 -mb-px transition-colors"
                style={tab === t ? { color: '#dc2626', borderColor: '#dc2626' } : { color: '#94a3b8', borderColor: 'transparent' }}>
                {t === 'sessions' ? `Sessions (${allStudentSessions.length})` : 'Contact'}
              </button>
            ))}
          </div>

          <div className="p-4">
            {tab === 'contact' && (
              <div className="space-y-4">
                <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                  {[
                    { label: 'Student Email', field: 'email', type: 'email', value: student.email },
                    { label: 'Student Phone', field: 'phone', type: 'tel', value: student.phone },
                    { label: 'Grade', field: 'grade', type: 'text', value: student.grade },
                    { label: 'Hours Left', field: 'hours_left', type: 'number', value: student.hours_left },
                  ].map(({ label, field, type, value }) => (
                    <div key={field} className="space-y-1">
                      <label className="text-[9px] font-black text-[#94a3b8] uppercase tracking-widest">{label}</label>
                      {isEditing
                        ? <input type={type} value={draft[field] ?? ''} onChange={e => setDraft((p: any) => ({ ...p, [field]: e.target.value }))} className={inputCls} placeholder={label} />
                        : <p className="text-sm text-[#1e293b]">{value || <span className="text-[#cbd5e1] italic text-xs">—</span>}</p>}
                    </div>
                  ))}
                </div>
                <div>
                  <p className="text-[9px] font-black uppercase tracking-widest mb-2 text-[#94a3b8]">Parent / Guardian</p>
                  <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                    {[
                      { label: 'Name', field: 'parent_name', type: 'text', value: student.parent_name },
                      { label: 'Email', field: 'parent_email', type: 'email', value: student.parent_email },
                      { label: 'Phone', field: 'parent_phone', type: 'tel', value: student.parent_phone },
                    ].map(({ label, field, type, value }) => (
                      <div key={field} className="space-y-1">
                        <label className="text-[9px] font-black text-[#94a3b8] uppercase tracking-widest">{label}</label>
                        {isEditing
                          ? <input type={type} value={draft[field] ?? ''} onChange={e => setDraft((p: any) => ({ ...p, [field]: e.target.value }))} className={inputCls} placeholder={label} />
                          : <p className="text-sm text-[#1e293b]">{value || <span className="text-[#cbd5e1] italic text-xs">—</span>}</p>}
                      </div>
                    ))}
                  </div>
                </div>
                <div>
                  <p className="text-[9px] font-black uppercase tracking-widest mb-1.5 text-[#94a3b8]">Bluebook</p>
                  {isEditing
                    ? <input type="url" value={draft.bluebook_url ?? ''} onChange={e => setDraft((p: any) => ({ ...p, bluebook_url: e.target.value }))} className={inputCls} placeholder="https://..." />
                    : student.bluebook_url
                      ? <a href={student.bluebook_url} target="_blank" rel="noopener noreferrer"
                          className="inline-flex items-center gap-2 px-3 py-1.5 rounded-lg text-xs font-semibold"
                          style={{ background: '#f0fdf4', border: '1px solid #bbf7d0', color: '#15803d' }}>
                          <ExternalLink size={11} /> Open Bluebook
                        </a>
                      : <p className="text-xs text-[#cbd5e1] italic">No Bluebook linked</p>}
                </div>
                {isEditing && (
                  <div className="flex justify-end gap-2">
                    <button onClick={() => { setIsEditing(false); setDraft(student); }}
                      className="px-4 py-1.5 text-xs font-bold text-[#64748b] rounded-lg" style={{ background: '#f1f5f9' }}>Cancel</button>
                    <button onClick={handleUpdate} disabled={saving}
                      className="flex items-center gap-1.5 px-4 py-1.5 text-white rounded-lg text-xs font-black disabled:opacity-50"
                      style={{ background: '#dc2626' }}>
                      {saving ? <Loader2 size={11} className="animate-spin" /> : <Save size={11} />} Save
                    </button>
                  </div>
                )}
              </div>
            )}

            {tab === 'sessions' && (
              <div className="space-y-1.5">
                {allStudentSessions.length === 0 && <p className="text-xs text-[#94a3b8] italic">No sessions yet</p>}
                {allStudentSessions.slice(0, 8).map((s, i) => {
                  const d = new Date(s.date + 'T00:00:00');
                  const statusColors: Record<string, { bg: string; text: string }> = {
                    present: { bg: '#f0fdf4', text: '#16a34a' },
                    confirmed: { bg: '#f0fdf4', text: '#16a34a' },
                    'no-show': { bg: '#fef2f2', text: '#dc2626' },
                  };
                  const sc = statusColors[s.status] ?? { bg: '#f8fafc', text: '#64748b' };
                  return (
                    <div key={i} className="flex items-center gap-3 px-3 py-2 rounded-lg"
                      style={{ background: s.isPast ? '#fafafa' : '#fff', border: '1px solid #f1f5f9' }}>
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
                {allStudentSessions.length > 8 && (
                  <p className="text-[10px] text-[#94a3b8] text-center pt-1">+{allStudentSessions.length - 8} more</p>
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
      parent_name: newStudent.parent_name || null, parent_email: newStudent.parent_email || null,
      parent_phone: newStudent.parent_phone || null,
    }]);
    setAdding(false); setNewStudent(EMPTY_FORM); fetchData(); setCreating(false);
  };

  return (
    <div className="min-h-screen pb-20" style={{ background: '#f1f5f9', fontFamily: 'ui-sans-serif, system-ui, sans-serif' }}>

      {/* Top bar */}
      <div className="sticky top-0 z-40 bg-white" style={{ borderBottom: '1px solid #e2e8f0' }}>
        <div className="max-w-7xl mx-auto px-5 h-12 flex items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <GraduationCap size={15} style={{ color: '#dc2626' }} />
            <span className="text-sm font-black text-[#0f172a]">Students</span>
            {!loading && <span className="text-[10px] font-bold text-[#94a3b8] bg-[#f8fafc] px-2 py-0.5 rounded-full border border-[#e2e8f0]">{students.length}</span>}
          </div>
          <div className="flex items-center gap-2">
            {selected.size > 0 && (
              <button onClick={handleBulkDelete} disabled={bulkDeleting}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-black text-white transition-all disabled:opacity-50"
                style={{ background: confirmBulk ? '#991b1b' : '#dc2626' }}>
                {bulkDeleting ? <Loader2 size={11} className="animate-spin" /> : <Trash2 size={11} />}
                {confirmBulk ? `Confirm delete ${selected.size}` : `Delete ${selected.size}`}
              </button>
            )}
            <button onClick={() => setShowImport(true)}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold transition-all"
              style={{ background: '#f8fafc', border: '1px solid #e2e8f0', color: '#475569' }}>
              <Upload size={11} /> Import CSV
            </button>
            <button onClick={() => setAdding(a => !a)}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-black text-white transition-all"
              style={{ background: adding ? '#64748b' : '#dc2626' }}>
              {adding ? <X size={11} /> : <Plus size={11} />}
              {adding ? 'Cancel' : 'Add Student'}
            </button>
          </div>
        </div>
      </div>

      <div className="max-w-7xl mx-auto px-5 pt-4 space-y-3">

        {/* Stats */}
        {!loading && (
          <div className="grid grid-cols-3 gap-3">
            {[
              { label: 'Total Students', value: students.length, key: 'all', color: '#0f172a', activeBg: '#0f172a', bg: '#fff' },
              { label: 'Booked This Week', value: bookedIds.size, key: 'booked', color: '#16a34a', activeBg: '#16a34a', bg: '#f0fdf4' },
              { label: 'Not Booked', value: students.length - bookedIds.size, key: 'unbooked', color: '#dc2626', activeBg: '#dc2626', bg: '#fff5f5' },
            ].map(s => (
              <button key={s.key} onClick={() => setFilter(f => f === s.key ? 'all' : s.key as any)}
                className="p-4 rounded-xl text-left transition-all"
                style={{
                  background: filter === s.key ? s.activeBg : s.bg,
                  border: `1px solid ${filter === s.key ? s.activeBg : '#e2e8f0'}`,
                  color: filter === s.key ? '#fff' : s.color,
                }}>
                <p className="text-2xl font-black leading-none">{s.value}</p>
                <p className="text-[10px] font-bold uppercase tracking-wider mt-1.5 opacity-70">{s.label}</p>
              </button>
            ))}
          </div>
        )}

        {!loading && <MetricsPanel students={students} allSessions={allSessions} tutors={tutors} />}

        {/* Search */}
        <div className="relative">
          <Search size={13} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-[#94a3b8]" />
          <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search students…"
            className="w-full pl-9 pr-4 py-2.5 bg-white border border-[#e2e8f0] rounded-xl text-sm text-[#0f172a] outline-none focus:ring-2 focus:border-[#dc2626] transition-all placeholder:text-[#94a3b8]" />
          {search && <button onClick={() => setSearch('')} className="absolute right-3 top-1/2 -translate-y-1/2 text-[#94a3b8]"><X size={13} /></button>}
        </div>

        {/* Add student form */}
        {adding && (
          <div className="bg-white rounded-xl overflow-hidden" style={{ border: '1px solid #fecaca' }}>
            <div className="px-5 py-3 flex items-center justify-between" style={{ background: '#fff5f5', borderBottom: '1px solid #fecdd3' }}>
              <p className="text-xs font-black uppercase tracking-widest text-[#dc2626]">New Student</p>
              <button onClick={() => setAdding(false)} className="text-[#94a3b8]"><X size={14} /></button>
            </div>
            <div className="p-5 space-y-4">
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1 col-span-2 md:col-span-1">
                  <label className="text-[9px] font-black text-[#94a3b8] uppercase tracking-widest">Name *</label>
                  <input value={newStudent.name} onChange={e => setNewStudent({ ...newStudent, name: e.target.value })} className={inputCls} placeholder="Full name" />
                </div>
                <div className="space-y-1">
                  <label className="text-[9px] font-black text-[#94a3b8] uppercase tracking-widest">Grade</label>
                  <input value={newStudent.grade} onChange={e => setNewStudent({ ...newStudent, grade: e.target.value })} className={inputCls} placeholder="1–12" />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                {[['Email','email','email','student@email.com'],['Phone','phone','tel','(555) 000-0000']].map(([l,f,t,ph]) => (
                  <div key={f} className="space-y-1">
                    <label className="text-[9px] font-black text-[#94a3b8] uppercase tracking-widest">{l}</label>
                    <input type={t} value={(newStudent as any)[f]} onChange={e => setNewStudent({ ...newStudent, [f]: e.target.value })} className={inputCls} placeholder={ph} />
                  </div>
                ))}
              </div>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                {[['Parent Name','parent_name','text','Parent name'],['Parent Email','parent_email','email','parent@email.com'],['Parent Phone','parent_phone','tel','(555) 000-0000']].map(([l,f,t,ph]) => (
                  <div key={f} className="space-y-1">
                    <label className="text-[9px] font-black text-[#94a3b8] uppercase tracking-widest">{l}</label>
                    <input type={t} value={(newStudent as any)[f]} onChange={e => setNewStudent({ ...newStudent, [f]: e.target.value })} className={inputCls} placeholder={ph} />
                  </div>
                ))}
              </div>
              <button onClick={handleCreate} disabled={!newStudent.name || creating}
                className="w-full py-2.5 rounded-lg text-sm font-black uppercase tracking-wider text-white disabled:opacity-40"
                style={{ background: '#dc2626' }}>
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
          <div className="rounded-xl overflow-hidden bg-white" style={{ border: '1px solid #e2e8f0' }}>
            {/* Table header */}
            <div className="grid items-center px-0"
              style={{ gridTemplateColumns: '36px 36px 2fr 60px 100px 100px 80px 120px', background: '#f8fafc', borderBottom: '1.5px solid #e2e8f0', height: 36 }}>
              <div className="flex items-center justify-center">
                <button onClick={toggleAll} className="text-[#94a3b8] hover:text-[#dc2626] transition-colors">
                  {allSelected ? <CheckSquare size={13} style={{ color: '#dc2626' }} /> : <Square size={13} />}
                </button>
              </div>
              <div />
              {['Student', 'Sessions', 'Booking', 'Attendance', 'Next', 'Actions'].map(h => (
                <div key={h} className="text-[9px] font-black uppercase tracking-widest text-[#94a3b8]">{h}</div>
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
          <div className="text-center py-24 bg-white rounded-xl" style={{ border: '1px dashed #e2e8f0' }}>
            <GraduationCap size={28} className="mx-auto mb-3 text-[#cbd5e1]" />
            <p className="text-sm font-bold text-[#94a3b8]">No students found</p>
            {search && <p className="text-xs text-[#cbd5e1] mt-1">Try a different search</p>}
          </div>
        )}
      </div>

      {showImport && <CSVImportModal onClose={() => setShowImport(false)} onImported={fetchData} />}
      {bookingToast && <BookingToast data={bookingToast} onClose={() => setBookingToast(null)} />}
    </div>
  );
}