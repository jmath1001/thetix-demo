"use client";

import React, { useState, useEffect } from 'react';
import { X, Trash2, UserPlus, ChevronDown, ChevronUp, AlertTriangle, CalendarOff, Plus, Loader2, Mail, Phone, Save, CheckSquare, Square } from 'lucide-react';
import { SESSION_BLOCKS, getSessionsForDay } from '@/components/constants';
import type { SessionBlock, SessionTimesByDay } from '@/components/constants';
import { supabase } from '@/lib/supabaseClient';
import { DB, withCenter, withCenterPayload } from '@/lib/db';
import type { Tutor } from '@/lib/useScheduleData';
import { logEvent } from '@/lib/analytics';

// ── Table names ───────────────────────────────────────────────────────────────
const TUTORS   = DB.tutors
const TIME_OFF = DB.timeOff
const SESSIONS = DB.sessions
const SS       = DB.sessionStudents

// ── Subject definitions ───────────────────────────────────────────────────────
export const SUBJECT_GROUPS = [
  { group: 'Math & Science', subjects: ['Algebra', 'Geometry', 'Precalculus', 'Calculus', 'Statistics', 'IB Math', 'Biology', 'Chemistry', 'Physics'] },
  { group: 'English & Humanities', subjects: ['English/Writing', 'Literature', 'History', 'Geography', 'Psychology'] },
  { group: 'Test Prep', subjects: ['SAT Math', 'SAT R/W', 'ACT Math', 'ACT English', 'ACT Science'] },
  { group: 'AP', subjects: ['AP Physics C Mechanics', 'AP Physics C E&M', 'AP Environmental Science', 'AP Statistics'] },
];

const ACTIVE_DAYS_INFO = [
  { dow: 1, label: 'Mon' }, { dow: 2, label: 'Tue' }, { dow: 3, label: 'Wed' },
  { dow: 4, label: 'Thu' }, { dow: 6, label: 'Sat' },
];

type TutorWithContact = Tutor & { email: string | null; phone: string | null; };
type TimeOff = { id: string; tutor_id: string; date: string; note: string; };
type TimeOffGroup = { ids: string[]; startDate: string; endDate: string; note: string; totalDays: number };
type ScheduledStudent = { id: string; name: string; status: string; seriesId: string | null; };
type ScheduledSession = { id: string; tutorId: string; date: string; time: string; students: ScheduledStudent[]; };
type TermOption = { id: string; name: string; status: string; session_times_by_day?: SessionTimesByDay | null };

const EMPTY_TUTOR: Omit<TutorWithContact, 'id'> = {
  name: '', subjects: [], cat: 'math', availability: [], availabilityBlocks: [],
  email: '', phone: '',
};

const inputCls = "w-full rounded border border-slate-200 bg-white px-2.5 py-1.5 text-xs font-medium text-slate-800 outline-none focus:border-slate-400 focus:ring-2 focus:ring-slate-100";
const fieldCardCls = "rounded border border-slate-200 bg-white px-3 py-2.5";
const fieldLabelCls = "block text-[10px] font-semibold text-slate-400";

function toDateValue(isoDate: string) {
  return new Date(`${isoDate}T00:00:00`);
}

function toISODate(d: Date) {
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function formatDateLabel(isoDate: string) {
  return toDateValue(isoDate).toLocaleDateString('en-US', {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
  });
}

function formatDateRangeLabel(startDate: string, endDate: string) {
  if (startDate === endDate) return formatDateLabel(startDate);

  const start = toDateValue(startDate);
  const end = toDateValue(endDate);
  const sameMonth = start.getMonth() === end.getMonth() && start.getFullYear() === end.getFullYear();

  if (sameMonth) {
    return `${start.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })} - ${end.toLocaleDateString('en-US', { day: 'numeric' })}`;
  }

  return `${start.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })} - ${end.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}`;
}

function formatSessionTimeLabel(time: string) {
  const block = SESSION_BLOCKS.find(entry => entry.time === time);
  return block ? `${block.label} · ${block.display}` : time;
}

function enumerateDateRange(startDate: string, endDate: string) {
  const start = toDateValue(startDate);
  const end = toDateValue(endDate);
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime()) || end < start) return [];

  const dates: string[] = [];
  const cursor = new Date(start);
  while (cursor <= end) {
    dates.push(toISODate(cursor));
    cursor.setDate(cursor.getDate() + 1);
  }
  return dates;
}

function areConsecutiveDays(left: string, right: string) {
  const next = toDateValue(left);
  next.setDate(next.getDate() + 1);
  return toISODate(next) === right;
}

function summarizeAvailability(blocks: string[]) {
  const sortedDays = Array.from(new Set(blocks.map(block => Number.parseInt(block.split('-')[0], 10))))
    .filter(day => Number.isFinite(day))
    .sort((left, right) => left - right);

  return {
    slotCount: blocks.length,
    dayCount: sortedDays.length,
    dayLabels: ACTIVE_DAYS_INFO.filter(day => sortedDays.includes(day.dow)).map(day => day.label),
  };
}

function groupTimeOffEntries(entries: TimeOff[]): TimeOffGroup[] {
  const sorted = [...entries].sort((left, right) => left.date.localeCompare(right.date));

  return sorted.reduce<TimeOffGroup[]>((groups, entry) => {
    const lastGroup = groups[groups.length - 1];
    if (lastGroup && lastGroup.note === (entry.note ?? '') && areConsecutiveDays(lastGroup.endDate, entry.date)) {
      lastGroup.ids.push(entry.id);
      lastGroup.endDate = entry.date;
      lastGroup.totalDays += 1;
      return groups;
    }

    groups.push({
      ids: [entry.id],
      startDate: entry.date,
      endDate: entry.date,
      note: entry.note ?? '',
      totalDays: 1,
    });
    return groups;
  }, []);
}

function getConflictingSessions(tutorId: string, dates: string[], scheduledSessions: ScheduledSession[]) {
  const dateSet = new Set(dates);

  return scheduledSessions
    .filter(session => session.tutorId === tutorId && dateSet.has(session.date))
    .map(session => ({
      ...session,
      students: session.students.filter(student => student.status !== 'cancelled'),
    }))
    .filter(session => session.students.length > 0)
    .sort((left, right) => {
      const dateCompare = left.date.localeCompare(right.date);
      return dateCompare !== 0 ? dateCompare : left.time.localeCompare(right.time);
    });
}

function summarizeStudentNames(students: ScheduledStudent[]) {
  if (students.length === 0) return 'No students';
  if (students.length <= 2) return students.map(student => student.name).join(', ');
  return `${students[0].name}, ${students[1].name} +${students.length - 2} more`;
}

function initials(name: string) {
  return name.split(' ').map(n => n[0]).join('').slice(0, 2).toUpperCase() || '?';
}

function getMondayOfCurrentWeek(): string {
  const d = new Date();
  const dow = d.getDay();
  const diff = dow === 0 ? -6 : 1 - dow;
  d.setDate(d.getDate() + diff);
  return toISODate(d);
}

// ── Subject Pills ─────────────────────────────────────────────────────────────
function SubjectCheckboxes({ selected, onChange }: { selected: string[]; onChange: (s: string[]) => void }) {
  const toggle = (s: string) =>
    onChange(selected.includes(s) ? selected.filter(x => x !== s) : [...selected, s]);

  return (
    <div className="space-y-2">
      <label className="block text-[10px] font-semibold text-slate-400">Subjects</label>
      <div className="space-y-2">
        {SUBJECT_GROUPS.map(group => (
          <div key={group.group} className="rounded border border-slate-200 bg-slate-50 p-2.5">
            <p className="mb-2 text-[10px] font-semibold text-slate-500">{group.group}</p>
            <div className="flex flex-wrap gap-1">
              {group.subjects.map(subject => {
                const active = selected.includes(subject);
                return (
                  <button key={subject} type="button" onClick={() => toggle(subject)}
                    className="rounded-md px-2 py-1 text-[10px] font-semibold tracking-[0.02em] transition-all"
                    style={active
                      ? { background: '#0f172a', color: 'white', border: '1px solid #0f172a' }
                      : { background: 'white', color: '#475569', border: '1px solid #cbd5e1' }}>
                    {subject}
                  </button>
                );
              })}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

// ── Availability Grid ─────────────────────────────────────────────────────────
function AvailabilityGrid({
  blocks,
  onChange,
  sessionTimesByDay,
}: {
  blocks: string[];
  onChange: (b: string[]) => void;
  sessionTimesByDay?: SessionTimesByDay | null;
}) {
  const toggle = (d: number, t: string) => {
    const key = `${d}-${t}`;
    onChange(blocks.includes(key) ? blocks.filter(b => b !== key) : [...blocks, key]);
  };

  // Build per-day session blocks using the term's session times (falls back to default if null)
  const dayBlocksMap: Record<number, SessionBlock[]> = {};
  for (const d of ACTIVE_DAYS_INFO) {
    dayBlocksMap[d.dow] = getSessionsForDay(d.dow, sessionTimesByDay);
  }

  // Union of all times across all days, sorted chronologically
  const seenTimes = new Set<string>();
  const rowDescriptors: { time: string; label: string; display: string }[] = [];
  for (const d of ACTIVE_DAYS_INFO) {
    for (const b of dayBlocksMap[d.dow]) {
      if (!seenTimes.has(b.time)) {
        seenTimes.add(b.time);
        rowDescriptors.push({ time: b.time, label: b.label, display: b.display });
      }
    }
  }
  rowDescriptors.sort((a, b) => a.time.localeCompare(b.time));

  return (
    <div className="space-y-2">
      <label className="block text-[9px] font-black uppercase tracking-[0.18em] text-[#334155]">Availability</label>
      <div className="overflow-hidden rounded-xl border border-[#cbd5e1] bg-white shadow-[0_8px_20px_rgba(15,23,42,0.06)]">
        <table className="w-full border-collapse">
          <thead>
            <tr style={{ background: '#1e293b' }}>
              <th className="border-r border-[#334155] px-2 py-2 text-left text-[9px] font-black uppercase tracking-[0.16em] text-[#cbd5e1]">Session</th>
              {ACTIVE_DAYS_INFO.map(d => (
                <th key={d.dow} className="px-1.5 py-2 text-center text-[9px] font-black uppercase tracking-[0.16em] text-[#cbd5e1]">{d.label}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rowDescriptors.map((row, bi) => (
              <tr key={row.time} style={{ borderBottom: bi < rowDescriptors.length - 1 ? '1px solid #e2e8f0' : 'none', background: bi % 2 === 0 ? 'white' : '#f8fafc' }}>
                <td className="border-r border-[#e2e8f0] px-2 py-2">
                  <p className="text-[10px] font-black text-[#0f172a] leading-none">{row.label}</p>
                  <p className="text-[9px] text-[#94a3b8] mt-0.5">{row.display}</p>
                </td>
                {ACTIVE_DAYS_INFO.map(d => {
                  const applicable = dayBlocksMap[d.dow].some(b => b.time === row.time);
                  const active = applicable && blocks.includes(`${d.dow}-${row.time}`);
                  return (
                    <td key={d.dow} className="p-1 text-center">
                      {applicable ? (
                        <button type="button" onClick={() => toggle(d.dow, row.time)}
                          className="mx-auto flex h-7 w-7 items-center justify-center rounded-md transition-all"
                          style={{
                            background: active ? '#4f46e5' : 'white',
                            border: `1px solid ${active ? '#4f46e5' : '#cbd5e1'}`,
                            boxShadow: active ? '0 4px 10px rgba(79,70,229,0.14)' : 'none',
                          }}>
                          {active && <span className="text-white text-[10px] font-black">✓</span>}
                        </button>
                      ) : (
                        <div className="mx-auto h-7 w-7 rounded-md" style={{ background: '#e2e8f0' }} />
                      )}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ── Time Off Panel ────────────────────────────────────────────────────────────
function TimeOffPanel({ tutor, timeOffList, onRefetch }: {
  tutor: TutorWithContact; timeOffList: TimeOff[]; onRefetch: () => Promise<void>;
}) {
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [note, setNote] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const tutorTimeOff = timeOffList.filter(t => t.tutor_id === tutor.id).sort((a, b) => a.date.localeCompare(b.date));
  const groupedTimeOff = groupTimeOffEntries(tutorTimeOff);
  const todayIso = toISODate(new Date());
  const upcomingTimeOff = groupedTimeOff.find(entry => entry.endDate >= todayIso) ?? null;
  const longestRange = groupedTimeOff.reduce((longest, entry) => Math.max(longest, entry.totalDays), 0);
  const requestedDates = startDate ? enumerateDateRange(startDate, endDate || startDate) : [];
  const existingDateSet = new Set(tutorTimeOff.map(entry => entry.date));
  const overlappingDates = requestedDates.filter(date => existingDateSet.has(date)).length;

  const handleAdd = async () => {
    if (!startDate) return;
    const finalEndDate = endDate || startDate;
    if (finalEndDate < startDate) {
      setError('End date must be the same day or later than the start date.');
      return;
    }

    const datesToInsert = enumerateDateRange(startDate, finalEndDate).filter(date => !existingDateSet.has(date));

    if (datesToInsert.length === 0) {
      setError('That entire range is already blocked off.');
      return;
    }

    setError(null);
    setSaving(true);
    const { error: insertError } = await supabase.from(TIME_OFF).insert(
      datesToInsert.map(date => withCenterPayload({ tutor_id: tutor.id, date, note: note.trim() }))
    );

    if (insertError) {
      setSaving(false);
      setError(insertError.message);
      return;
    }

    setStartDate('');
    setEndDate('');
    setNote('');
    await onRefetch();
    setSaving(false);
  };

  const handleDelete = async (ids: string[]) => {
    setError(null);
    setSaving(true);
    const { error: deleteError } = await withCenter(supabase.from(TIME_OFF).delete()).in('id', ids);
    if (deleteError) {
      setSaving(false);
      setError(deleteError.message);
      return;
    }

    await onRefetch();
    setSaving(false);
  };

  return (
    <div className="space-y-2.5">
      <div className="rounded-xl border border-[#cbd5e1] bg-white px-3.5 py-2.5 shadow-[0_8px_20px_rgba(15,23,42,0.05)]">
        <div className="flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
          <div>
            <p className="text-[10px] font-black uppercase tracking-[0.18em] text-[#64748b]">Time off operations</p>
            <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-[#475569]">
              <span><span className="font-black text-[#0f172a]">{tutorTimeOff.length}</span> blocked</span>
              <span><span className="font-black text-[#0f172a]">{longestRange || 0}</span> longest run</span>
              <span>{upcomingTimeOff ? `Next ${formatDateRangeLabel(upcomingTimeOff.startDate, upcomingTimeOff.endDate)}` : 'No upcoming block'}</span>
            </div>
          </div>
        </div>
      </div>

      <div className="rounded-xl border border-[#c7d2fe] bg-[linear-gradient(135deg,#ffffff_0%,#f8fbff_55%,#eef2ff_100%)] p-3.5 shadow-[0_14px_28px_rgba(15,23,42,0.07)]">
        <div className="flex flex-col gap-2.5 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <p className="text-[10px] font-black uppercase tracking-[0.2em] text-[#4f46e5]">Schedule time off</p>
            <h3 className="mt-1 text-[13px] font-black text-[#0f172a]">Block a day or date range</h3>
          </div>
          {requestedDates.length > 0 && (
            <div className="rounded-lg border border-[#c7d2fe] bg-white px-3 py-2 text-right shadow-[0_8px_18px_rgba(79,70,229,0.1)]">
              <p className="text-[10px] font-black uppercase tracking-[0.18em] text-[#6366f1]">Pending block</p>
              <p className="mt-0.5 text-[12px] font-black text-[#0f172a]">{formatDateRangeLabel(startDate, endDate || startDate)}</p>
              <p className="mt-0.5 text-[10px] text-[#64748b]">{requestedDates.length} requested day{requestedDates.length === 1 ? '' : 's'}{overlappingDates > 0 ? ` · ${overlappingDates} already blocked` : ''}</p>
            </div>
          )}
        </div>

        <div className="mt-3 grid gap-2 lg:grid-cols-[0.95fr_0.95fr_1.35fr_auto]">
          <div className={fieldCardCls}>
            <label className={fieldLabelCls}>From</label>
            <input type="date" value={startDate} onChange={e => { setStartDate(e.target.value); if (!endDate) setEndDate(e.target.value); setError(null); }} className={`${inputCls} mt-1.5`} />
          </div>
          <div className={fieldCardCls}>
            <label className={fieldLabelCls}>To</label>
            <input type="date" min={startDate || undefined} value={endDate} onChange={e => { setEndDate(e.target.value); setError(null); }} className={`${inputCls} mt-1.5`} />
          </div>
          <div className={fieldCardCls}>
            <label className={fieldLabelCls}>Reason (optional)</label>
            <input value={note} onChange={e => setNote(e.target.value)} placeholder="Vacation, exams, sick day, conference" className={`${inputCls} mt-1.5`} />
          </div>
          <button onClick={handleAdd} disabled={!startDate || saving || requestedDates.length === 0}
            className="flex min-h-12 items-center justify-center gap-1.5 rounded-xl px-4 py-2.5 text-[11px] font-black uppercase tracking-[0.16em] transition-all active:scale-95 disabled:opacity-60"
            style={{
              background: startDate ? '#4f46e5' : '#e2e8f0',
              color: startDate ? 'white' : '#94a3b8',
              cursor: startDate ? 'pointer' : 'not-allowed',
              boxShadow: startDate ? '0 12px 24px rgba(79,70,229,0.22)' : 'none',
            }}>
            {saving ? <Loader2 size={12} className="animate-spin" /> : <Plus size={13} />} Add range
          </button>
        </div>

        {error && (
          <div className="mt-3 rounded-xl border border-[#fda4af] bg-[#fff1f2] px-3.5 py-2.5 text-[12px] font-medium text-[#991b1b]">
            {error}
          </div>
        )}

      </div>

      {groupedTimeOff.length === 0 ? (
          <div className="rounded-xl border-2 border-dashed border-[#cbd5e1] bg-[#f8fafc] py-6 text-center">
          <CalendarOff size={18} className="mx-auto mb-2 text-[#cbd5e1]" />
          <p className="text-[10px] font-black uppercase tracking-[0.18em] text-[#64748b]">No time off scheduled</p>
        </div>
      ) : (
          <div className="space-y-2">
          {groupedTimeOff.map(entry => (
              <div key={`${entry.startDate}-${entry.endDate}-${entry.note}`} className="rounded-xl border border-[#cbd5e1] bg-white px-3 py-2.5 shadow-[0_10px_22px_rgba(15,23,42,0.05)]">
                <div className="flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
                <div className="flex items-start gap-3">
                    <div className="mt-0.5 flex h-8 w-8 items-center justify-center rounded-lg" style={{ background: '#fff1f2' }}>
                    <CalendarOff size={14} style={{ color: '#dc2626' }} />
                  </div>
                  <div>
                    <div className="flex flex-wrap items-center gap-2">
                      <p className="text-[13px] font-black text-[#0f172a]">{formatDateRangeLabel(entry.startDate, entry.endDate)}</p>
                      <span className="rounded-full bg-[#eef2ff] px-2.5 py-1 text-[10px] font-black uppercase tracking-[0.16em] text-[#4338ca]">
                        {entry.totalDays} day{entry.totalDays === 1 ? '' : 's'}
                      </span>
                    </div>
                    <p className="mt-0.5 text-[10px] text-[#64748b]">{entry.note || 'No reason added'}</p>
                  </div>
                </div>
                <button onClick={() => handleDelete(entry.ids)} disabled={saving}
                  className="flex h-8 items-center justify-center gap-1.5 rounded-lg border border-[#fecaca] px-3 text-[10px] font-black uppercase tracking-[0.16em] text-[#dc2626] transition-all hover:bg-[#fff1f2] disabled:cursor-not-allowed disabled:opacity-60">
                  {saving ? <Loader2 size={12} className="animate-spin" /> : <X size={13} />} Remove
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function TutorListItem({
  tutor,
  isActive,
  isSelected,
  conflictCount,
  onClick,
  onToggle,
}: {
  tutor: TutorWithContact;
  isActive: boolean;
  isSelected: boolean;
  conflictCount: number;
  onClick: () => void;
  onToggle: () => void;
}) {
  const handleKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    // Only treat Enter/Space as card activation when focus is on the card itself.
    if (event.target !== event.currentTarget) return;
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      onClick();
    }
  };

  return (
    <div
      role="listitem"
      tabIndex={0}
      onClick={onClick}
      onKeyDown={handleKeyDown}
      className={`w-full rounded border px-2 py-2 text-left transition-colors ${isActive ? 'border-slate-300 bg-slate-50' : isSelected ? 'border-red-200 bg-red-50/40' : 'border-slate-200 bg-white hover:bg-slate-50'}`}>
      <div className="flex items-start gap-2.5">
        <button
          type="button"
          onClick={event => {
            event.stopPropagation();
            onToggle();
          }}
          className={`mt-0.5 rounded border p-1 transition-colors ${isSelected ? 'border-slate-900 bg-slate-900 text-white' : 'border-slate-300 text-slate-500'}`}>
          {isSelected ? <CheckSquare size={14} /> : <Square size={14} />}
        </button>
        <div className="min-w-0 flex-1">
          <div className="flex items-center justify-between gap-2">
            <div className="min-w-0">
            <p className="truncate text-[12px] font-black leading-tight text-slate-900">{tutor.name || 'Unnamed tutor'}</p>
            <p className="mt-0.5 text-[10px] font-semibold uppercase tracking-[0.12em] text-slate-500">
              {tutor.cat === 'math' ? 'Math / Sci' : 'Eng / Hist'}
            </p>
            </div>
            {conflictCount > 0 && (
              <span
                className="flex h-5 w-5 items-center justify-center rounded-full bg-red-600 text-[12px] font-black text-white"
                title={`${conflictCount} booking${conflictCount === 1 ? '' : 's'} need movement`}>
                !
              </span>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

function TutorDetailPanel({
  tutor,
  timeOffList,
  scheduledSessions,
  onSave,
  onDelete,
  onRefetch,
  selectedTermId,
  termAvailabilityBlocks,
  sessionTimesByDay,
}: {
  tutor: TutorWithContact;
  timeOffList: TimeOff[];
  scheduledSessions: ScheduledSession[];
  onSave: (u: TutorWithContact) => Promise<void>;
  onDelete: (id: string) => Promise<void>;
  onRefetch: () => Promise<void>;
  selectedTermId: string;
  termAvailabilityBlocks: string[] | undefined;
  sessionTimesByDay: SessionTimesByDay | null;
}) {
  const [tab, setTab] = useState<'details' | 'timeoff'>('details');
  const [isEditing, setIsEditing] = useState(false);
  const effectiveBlocks = termAvailabilityBlocks ?? tutor.availabilityBlocks;
  const [draft, setDraft] = useState<TutorWithContact>({
    ...tutor,
    availabilityBlocks: effectiveBlocks,
    availability: Array.from(new Set(effectiveBlocks.map(b => parseInt(b.split('-')[0])))).sort((a, b) => a - b),
  });
  const [saving, setSaving] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);

  useEffect(() => {
    const blocks = termAvailabilityBlocks ?? tutor.availabilityBlocks;
    setDraft({
      ...tutor,
      availabilityBlocks: blocks,
      availability: Array.from(new Set(blocks.map(b => parseInt(b.split('-')[0])))).sort((a, b) => a - b),
    });
    setIsEditing(false);
    setConfirmDelete(false);
    setTab('details');
  }, [tutor]);

  const hasTermOverride = termAvailabilityBlocks !== undefined;

  const dirty =
    tutor.name !== draft.name || tutor.cat !== draft.cat ||
    tutor.email !== draft.email || tutor.phone !== draft.phone ||
    JSON.stringify(tutor.subjects) !== JSON.stringify(draft.subjects) ||
    JSON.stringify(effectiveBlocks) !== JSON.stringify(draft.availabilityBlocks);

  const timeOffCount = timeOffList.filter(t => t.tutor_id === tutor.id).length;
  const availabilitySummary = summarizeAvailability(draft.availabilityBlocks);
  const tutorTimeOffDates = timeOffList.filter(t => t.tutor_id === tutor.id).map(entry => entry.date);
  const conflictSessions = getConflictingSessions(
    tutor.id,
    tutorTimeOffDates,
    scheduledSessions,
  );
  const conflictCount = conflictSessions.length;
  const upcomingTimeOff = timeOffList
    .filter(t => t.tutor_id === tutor.id)
    .sort((left, right) => left.date.localeCompare(right.date))
    .find(entry => entry.date >= toISODate(new Date()));
  const busiestDay = ACTIVE_DAYS_INFO
    .map(day => ({
      label: day.label,
      count: draft.availabilityBlocks.filter(block => Number.parseInt(block.split('-')[0], 10) === day.dow).length,
    }))
    .sort((left, right) => right.count - left.count)[0];
  const catLabel = draft.cat === 'math' ? 'Math / Sci' : 'Eng / Hist';
  const catColor = draft.cat === 'math' ? '#1d4ed8' : '#be185d';
  const catBg = draft.cat === 'math' ? '#dbeafe' : '#fce7f3';

  return (
    <div className="flex h-full min-h-0 flex-col overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
      <div className="border-b border-slate-100 bg-white px-4 py-4 md:px-5">
        <div className="flex flex-col gap-3 xl:flex-row xl:items-start xl:justify-between">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-slate-900 text-xs font-black text-white">
                {initials(draft.name)}
              </div>
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <h2 className="truncate text-lg font-black text-slate-900">{draft.name || 'Unnamed tutor'}</h2>
                  <span className="rounded border border-slate-200 bg-slate-100 px-2 py-0.5 text-[10px] font-semibold text-slate-600">
                    {catLabel}
                  </span>
                  {dirty && <span className="rounded border border-amber-200 bg-amber-50 px-2 py-0.5 text-[10px] font-semibold text-amber-700">Unsaved</span>}
                  {conflictCount > 0 && <span className="rounded border border-red-200 bg-red-50 px-2 py-0.5 text-[10px] font-semibold text-red-700">Needs attention · {conflictCount}</span>}
                </div>
                <div className="mt-1 flex flex-wrap gap-x-3 gap-y-1 text-[11px] text-slate-600">
                  <span className="flex items-center gap-1.5"><Mail size={12} className="text-slate-400" /> {draft.email || 'No email on file'}</span>
                  <span className="flex items-center gap-1.5"><Phone size={12} className="text-slate-400" /> {draft.phone || 'No phone on file'}</span>
                </div>
                <p className="mt-1.5 text-[11px] text-slate-500">{draft.subjects.slice(0, 3).join(' • ') || 'No subjects assigned yet'}</p>
              </div>
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {isEditing ? (
              <>
                <button onClick={() => { setIsEditing(false); setDraft(tutor); }} className="rounded border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-slate-600 hover:bg-slate-50">
                  Cancel
                </button>
                <button
                  onClick={async () => {
                    setSaving(true);
                    await onSave(draft);
                    setSaving(false);
                    setIsEditing(false);
                  }}
                  disabled={!dirty || saving}
                  className="flex items-center gap-1.5 rounded bg-slate-900 px-3 py-1.5 text-xs font-semibold text-white hover:bg-slate-800 disabled:opacity-40">
                  {saving ? <Loader2 size={11} className="animate-spin" /> : <Save size={11} />} Save
                </button>
              </>
            ) : (
              <button onClick={() => setIsEditing(true)} className="rounded border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-slate-600 hover:bg-slate-50">
                Edit tutor
              </button>
            )}
            <button onClick={() => setConfirmDelete(true)} className="rounded border border-red-200 bg-red-50 px-3 py-1.5 text-xs font-semibold text-red-700">
              Delete
            </button>
          </div>
        </div>

        <div className="mt-3 grid gap-2.5 lg:grid-cols-2">
          <div className="rounded border border-slate-100 bg-slate-50 px-3.5 py-3">
            <p className="text-[10px] font-bold uppercase tracking-widest text-slate-400">Conflicts</p>
            <p className="mt-1 text-sm font-black text-slate-900">{conflictCount} session{conflictCount === 1 ? '' : 's'} need movement</p>
            <p className="mt-0.5 text-[11px] text-slate-500">{conflictCount > 0 ? 'See details tab list below.' : 'No blocked-date conflicts right now.'}</p>
          </div>
          <div className="rounded border border-slate-100 bg-slate-50 px-3.5 py-3">
            <p className="text-[10px] font-bold uppercase tracking-widest text-slate-400">Time off</p>
            <p className="mt-1 text-sm font-black text-slate-900">{timeOffCount} blocked day{timeOffCount === 1 ? '' : 's'}</p>
            <p className="mt-0.5 text-[11px] text-slate-500">{upcomingTimeOff ? `Next: ${formatDateLabel(upcomingTimeOff.date)}` : 'No upcoming blocks'}</p>
          </div>
        </div>

        <div className="mt-3 flex flex-wrap gap-2 border-t border-slate-100 pt-3">
          {(['details', 'timeoff'] as const).map(currentTab => (
            <button
              key={currentTab}
              onClick={() => setTab(currentTab)}
              className="rounded px-2.5 py-1 text-[11px] font-semibold transition-colors"
              style={tab === currentTab
                ? { background: '#0f172a', color: 'white' }
                : { color: '#64748b' }}>
              {currentTab === 'details' ? 'Details' : `Time Off${timeOffCount > 0 ? ` · ${timeOffCount}` : ''}`}
            </button>
          ))}
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-4 py-4 md:px-5">
        {tab === 'details' ? (
          <div className="space-y-5">
            <div className="grid gap-4 xl:grid-cols-[1.05fr_0.95fr]">
              <div className="space-y-3 rounded-xl border border-slate-200 bg-slate-50 p-3.5">
                {isEditing && (
                  <div className="grid gap-4 md:grid-cols-2">
                    <div className={fieldCardCls}>
                      <label className={fieldLabelCls}>Name</label>
                      <input type="text" value={draft.name} onChange={e => setDraft({ ...draft, name: e.target.value })} className={`${inputCls} mt-1.5`} />
                    </div>
                    <div className={fieldCardCls}>
                      <label className={fieldLabelCls}>Category</label>
                      <div className="mt-2 flex gap-2">
                        {(['math', 'english'] as const).map(currentCat => (
                          <button key={currentCat} onClick={() => setDraft({ ...draft, cat: currentCat })}
                            className="flex-1 rounded-md py-2 text-[10px] font-black uppercase tracking-[0.12em]"
                            style={draft.cat === currentCat
                              ? { background: '#0f172a', color: 'white', border: '1.5px solid #0f172a' }
                              : { background: 'white', color: '#475569', border: '1.5px solid #cbd5e1' }}>
                            {currentCat === 'math' ? 'Math / Sci' : 'Eng / Hist'}
                          </button>
                        ))}
                      </div>
                    </div>
                    <div className={fieldCardCls}>
                      <label className={fieldLabelCls}>Email</label>
                      <input type="email" value={draft.email ?? ''} onChange={e => setDraft({ ...draft, email: e.target.value })} className={`${inputCls} mt-1.5`} placeholder="tutor@email.com" />
                    </div>
                    <div className={fieldCardCls}>
                      <label className={fieldLabelCls}>Phone</label>
                      <input type="tel" value={draft.phone ?? ''} onChange={e => setDraft({ ...draft, phone: e.target.value })} className={`${inputCls} mt-1.5`} placeholder="(555) 000-0000" />
                    </div>
                  </div>
                )}

                <div className="rounded-xl border border-slate-200 bg-white p-3.5">
                  {isEditing ? (
                    <SubjectCheckboxes selected={draft.subjects} onChange={subjects => setDraft({ ...draft, subjects })} />
                  ) : (
                    <>
                      <div className="flex items-center justify-between gap-3">
                        <div>
                          <p className="text-[10px] font-bold uppercase tracking-widest text-slate-400">Subjects</p>
                          <p className="mt-1 text-[11px] text-slate-500">Core teaching coverage.</p>
                        </div>
                        <span className="rounded border border-slate-200 bg-slate-100 px-2 py-0.5 text-[10px] font-semibold text-slate-600">{draft.subjects.length}</span>
                      </div>
                      <div className="mt-3 flex flex-wrap gap-2">
                        {draft.subjects.length > 0 ? draft.subjects.map(subject => (
                          <span key={subject} className="rounded border border-blue-200 bg-blue-50 px-2 py-0.5 text-[10px] font-semibold text-blue-700">{subject}</span>
                        )) : <span className="text-[12px] text-slate-400">No subjects assigned</span>}
                      </div>
                    </>
                  )}
                </div>
              </div>

              <div className="rounded-xl border border-slate-200 bg-white p-3.5">
                {selectedTermId && (
                  <div className={`mb-3 rounded border px-3 py-2 text-[11px] font-medium ${hasTermOverride ? 'border-indigo-200 bg-indigo-50 text-indigo-700' : 'border-amber-200 bg-amber-50 text-amber-700'}`}>
                    {hasTermOverride ? '✓ Showing term-specific availability' : 'No term override yet — saving will create one for this term'}
                  </div>
                )}
                {isEditing ? (
                  <AvailabilityGrid
                    blocks={draft.availabilityBlocks}
                    sessionTimesByDay={sessionTimesByDay}
                    onChange={blocks => setDraft({
                      ...draft,
                      availabilityBlocks: blocks,
                      availability: Array.from(new Set(blocks.map(value => parseInt(value.split('-')[0])))).sort((left, right) => left - right),
                    })}
                  />
                ) : (
                  <>
                    <div className="flex items-center justify-between gap-3">
                      <div>
                        <p className="text-[10px] font-bold uppercase tracking-widest text-slate-400">Schedule conflicts</p>
                        <p className="mt-1 text-[12px] text-slate-500">Booked sessions currently overlapping blocked dates.</p>
                      </div>
                      {conflictCount > 0 ? (
                        <span className="flex items-center gap-1.5 rounded-full bg-[#fee2e2] px-2.5 py-1 text-[10px] font-black uppercase tracking-[0.16em] text-[#b91c1c]">
                          <span className="flex h-4 w-4 items-center justify-center rounded-full bg-[#dc2626] text-[10px] text-white">!</span>
                          Needs attention
                        </span>
                      ) : (
                        <span className="rounded-full bg-[#dcfce7] px-2.5 py-1 text-[10px] font-black uppercase tracking-[0.16em] text-[#166534]">Ready</span>
                      )}
                    </div>
                    {conflictSessions.length > 0 ? (
                      <div className="mt-3 space-y-2">
                        {conflictSessions.map(session => (
                          <div key={session.id} className="rounded-xl border border-[#fecaca] bg-[#fff7f7] px-3 py-2.5">
                            <div className="flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between">
                              <p className="text-[12px] font-black text-slate-900">{formatDateLabel(session.date)} · {formatSessionTimeLabel(session.time)}</p>
                              <p className="text-[10px] font-black uppercase tracking-[0.16em] text-[#b91c1c]">!
                                {' '}Move {session.students.length}
                              </p>
                            </div>
                            <p className="mt-1 text-[11px] text-slate-500">{summarizeStudentNames(session.students)}</p>
                          </div>
                        ))}
                      </div>
                    ) : (
                      <div className="mt-3 rounded-xl border border-[#d1fae5] bg-[#f0fdf4] px-3 py-2.5 text-[12px] font-medium text-[#166534]">
                        No conflict sessions right now.
                      </div>
                    )}
                  </>
                )}
              </div>
            </div>
          </div>
        ) : (
          <TimeOffPanel tutor={tutor} timeOffList={timeOffList} onRefetch={onRefetch} />
        )}
      </div>

      {confirmDelete && (
        <div className="border-t border-red-200 bg-red-50 px-5 py-4 md:px-6">
          <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
            <div>
              <p className="text-sm font-black text-slate-900">Delete {draft.name}?</p>
              <p className="text-[12px] text-slate-500">This action cannot be undone.</p>
            </div>
            <div className="flex items-center gap-2">
              <button onClick={() => setConfirmDelete(false)} className="rounded border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-slate-600 hover:bg-slate-50">
                Cancel
              </button>
              <button onClick={async () => { await onDelete(tutor.id); setConfirmDelete(false); }} className="rounded bg-red-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-red-700">
                Confirm delete
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ── Tutor Row ─────────────────────────────────────────────────────────────────
function TutorRow({ tutor, selected, onToggle, timeOffList, scheduledSessions, onSave, onDelete, onRefetch }: {
  tutor: TutorWithContact; selected: boolean; onToggle: () => void;
  timeOffList: TimeOff[];
  scheduledSessions: ScheduledSession[];
  onSave: (u: TutorWithContact) => Promise<void>;
  onDelete: (id: string) => Promise<void>;
  onRefetch: () => Promise<void>;
}) {
  const [expanded, setExpanded] = useState(false);
  const [tab, setTab] = useState<'details' | 'timeoff'>('details');
  const [isEditing, setIsEditing] = useState(false);
  const [draft, setDraft] = useState<TutorWithContact>(tutor);
  const [saving, setSaving] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);

  const dirty =
    tutor.name !== draft.name || tutor.cat !== draft.cat ||
    tutor.email !== draft.email || tutor.phone !== draft.phone ||
    JSON.stringify(tutor.subjects) !== JSON.stringify(draft.subjects) ||
    JSON.stringify(tutor.availabilityBlocks) !== JSON.stringify(draft.availabilityBlocks);

  const timeOffCount = timeOffList.filter(t => t.tutor_id === tutor.id).length;
  const availabilitySummary = summarizeAvailability(draft.availabilityBlocks);
  const bookedConflictCount = getConflictingSessions(
    tutor.id,
    timeOffList.filter(t => t.tutor_id === tutor.id).map(entry => entry.date),
    scheduledSessions,
  ).length;
  const upcomingTimeOff = timeOffList
    .filter(t => t.tutor_id === tutor.id)
    .sort((left, right) => left.date.localeCompare(right.date))
    .find(entry => entry.date >= toISODate(new Date()));
  const catLabel = draft.cat === 'math' ? 'Math / Sci' : 'Eng / Hist';
  const catColor = draft.cat === 'math' ? '#1d4ed8' : '#be185d';
  const catBg = draft.cat === 'math' ? '#dbeafe' : '#fce7f3';

  return (
    <>
      <div className="overflow-hidden rounded-2xl border shadow-[0_12px_28px_rgba(15,23,42,0.07)] transition-all"
        style={{
          borderColor: selected ? '#fda4af' : expanded ? '#c7d2fe' : '#dbe4ee',
          background: selected
            ? 'linear-gradient(135deg, #fff8f8 0%, #ffffff 55%)'
            : expanded
              ? 'linear-gradient(135deg, #ffffff 0%, #f8fbff 58%, #eef2ff 100%)'
              : '#ffffff',
        }}>
        <div className="p-3.5 md:p-4">
          <div className="flex flex-col gap-3 xl:flex-row xl:items-start xl:justify-between">
            <div className="flex min-w-0 flex-1 gap-3">
              <div className="pt-1" onClick={e => e.stopPropagation()}>
                <button onClick={onToggle} className="rounded-xl border border-[#cbd5e1] bg-white p-2 text-[#64748b] transition-colors hover:border-[#fda4af] hover:text-[#dc2626]">
                  {selected ? <CheckSquare size={15} style={{ color: '#dc2626' }} /> : <Square size={15} />}
                </button>
              </div>

              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl text-xs font-black text-white"
                style={{ background: '#dc2626', boxShadow: '0 8px 16px rgba(220,38,38,0.18)' }}>{initials(draft.name)}</div>

              <div className="min-w-0 flex-1">
                <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
                  <div className="min-w-0 cursor-pointer" onClick={() => !isEditing && setExpanded(e => !e)}>
                    <div className="flex flex-wrap items-center gap-2">
                      {isEditing ? (
                        <input type="text" value={draft.name} onChange={e => setDraft({ ...draft, name: e.target.value })}
                          className={`${inputCls} max-w-sm`} placeholder="Full name" autoFocus onClick={e => e.stopPropagation()} />
                      ) : (
                        <h3 className="truncate text-base font-black text-[#0f172a]">{draft.name || 'Unnamed tutor'}</h3>
                      )}
                      <span className="rounded-full px-2.5 py-1 text-[10px] font-black uppercase tracking-[0.16em]" style={{ background: catBg, color: catColor }}>
                        {catLabel}
                      </span>
                      {dirty && <span className="rounded-full bg-[#fef3c7] px-2.5 py-1 text-[10px] font-black uppercase tracking-[0.16em] text-[#b45309]">Unsaved</span>}
                      {bookedConflictCount > 0 && <span className="rounded-full bg-[#fee2e2] px-2.5 py-1 text-[10px] font-black uppercase tracking-[0.16em] text-[#b91c1c]">{bookedConflictCount} to rearrange</span>}
                    </div>

                    <div className="mt-2 flex flex-wrap gap-2">
                      {draft.subjects.length > 0 ? draft.subjects.slice(0, 4).map(subject => (
                        <span key={subject} className="rounded-full border border-[#dbeafe] bg-[#eff6ff] px-2.5 py-1 text-[10px] font-bold text-[#1d4ed8]">
                          {subject}
                        </span>
                      )) : (
                        <span className="rounded-full border border-[#e2e8f0] bg-[#f8fafc] px-2.5 py-1 text-[10px] font-semibold text-[#94a3b8]">No subjects assigned</span>
                      )}
                      {draft.subjects.length > 4 && (
                        <span className="rounded-full border border-[#e2e8f0] bg-[#f8fafc] px-2.5 py-1 text-[10px] font-semibold text-[#64748b]">+{draft.subjects.length - 4} more</span>
                      )}
                    </div>

                    <div className="mt-2.5 flex flex-wrap gap-x-3 gap-y-1.5 text-[11px] text-[#475569]">
                      <span className="flex items-center gap-1.5">
                        <Mail size={12} className="text-[#94a3b8]" /> {draft.email || 'No email on file'}
                      </span>
                      <span className="flex items-center gap-1.5">
                        <Phone size={12} className="text-[#94a3b8]" /> {draft.phone || 'No phone on file'}
                      </span>
                    </div>
                  </div>

                  <div className="flex items-center gap-1.5" onClick={e => e.stopPropagation()}>
                    <button onClick={() => { setIsEditing(true); setExpanded(true); setTab('details'); }}
                      className="rounded-xl border px-3 py-2 text-[10px] font-black uppercase tracking-[0.16em] transition-all"
                      style={{ background: '#fff', borderColor: '#cbd5e1', color: '#475569' }}>
                      Edit tutor
                    </button>
                    <button onClick={() => setConfirmDelete(true)}
                      className={`rounded-xl border p-2 transition-all ${confirmDelete ? 'border-[#fecaca] bg-red-50 text-red-500' : 'border-[#e2e8f0] text-[#94a3b8] hover:border-[#fecaca] hover:text-red-400'}`}>
                      {confirmDelete ? '?' : <Trash2 size={12} />}
                    </button>
                    <button onClick={() => setExpanded(e => !e)} className="rounded-xl border border-[#e2e8f0] p-2 text-[#94a3b8] transition-colors hover:text-[#475569]">
                      {expanded ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
                    </button>
                  </div>
                </div>

                <div className="mt-3 grid gap-2.5 xl:grid-cols-3">
                  <div className="rounded-xl border border-[#e2e8f0] bg-white px-3.5 py-3">
                    <p className="text-[10px] font-black uppercase tracking-[0.16em] text-[#64748b]">Availability</p>
                    <p className="mt-1 text-sm font-black text-[#0f172a]">{availabilitySummary.slotCount} slots across {availabilitySummary.dayCount || 0} day{availabilitySummary.dayCount === 1 ? '' : 's'}</p>
                    <p className="mt-0.5 text-[11px] text-[#64748b]">{availabilitySummary.dayLabels.length > 0 ? availabilitySummary.dayLabels.join(' • ') : 'No weekly availability set'}</p>
                  </div>
                  <div className="rounded-xl border border-[#e2e8f0] bg-white px-3.5 py-3">
                    <p className="text-[10px] font-black uppercase tracking-[0.16em] text-[#64748b]">Time off</p>
                    <p className="mt-1 text-sm font-black text-[#0f172a]">{timeOffCount} blocked day{timeOffCount === 1 ? '' : 's'}</p>
                    <p className="mt-0.5 text-[11px] text-[#64748b]">{bookedConflictCount > 0 ? `${bookedConflictCount} booked session${bookedConflictCount === 1 ? '' : 's'} need rearranging` : upcomingTimeOff ? `Next: ${formatDateLabel(upcomingTimeOff.date)}` : 'No upcoming blocks'}</p>
                  </div>
                  <div className="rounded-xl border border-[#e2e8f0] bg-white px-3.5 py-3">
                    <p className="text-[10px] font-black uppercase tracking-[0.16em] text-[#64748b]">Profile status</p>
                    <p className="mt-1 text-sm font-black text-[#0f172a]">{draft.subjects.length > 0 && availabilitySummary.slotCount > 0 ? 'Ready for scheduling' : 'Needs setup'}</p>
                    <p className="mt-0.5 text-[11px] text-[#64748b]">{draft.subjects.length > 0 && availabilitySummary.slotCount > 0 ? 'Subjects and weekly slots are in place.' : 'Add subjects and availability for cleaner scheduling.'}</p>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>

        {expanded && (
        <div style={{ borderTop: '1px solid #e2e8f0', background: '#fafbfd', boxShadow: 'inset 0 3px 10px rgba(15,23,42,0.04)' }}>
          {/* Tab bar */}
          <div className="flex items-center gap-0 px-6" style={{ borderBottom: '1px solid #e2e8f0', background: '#f8fafc' }}>
            {(['details', 'timeoff'] as const).map(t => (
              <button key={t} onClick={() => setTab(t)}
                className="relative mr-6 py-3 text-[11px] font-bold transition-colors"
                style={tab === t
                  ? { color: '#4f46e5', borderBottom: '2px solid #4f46e5', marginBottom: -1 }
                  : { color: '#94a3b8', borderBottom: '2px solid transparent', marginBottom: -1 }}>
                {t === 'details' ? 'Details & Availability' : `Time Off${timeOffCount > 0 ? ` · ${timeOffCount}` : ''}`}
              </button>
            ))}
            <div className="ml-auto flex items-center gap-2 pb-2 pt-2">
              {isEditing ? (
                <>
                  <button onClick={() => { setIsEditing(false); setDraft(tutor); }}
                    className="rounded-md border px-3 py-1.5 text-[10px] font-bold transition-all"
                    style={{ background: '#fff', borderColor: '#cbd5e1', color: '#475569' }}>
                    Cancel
                  </button>
                  <button onClick={async () => { setSaving(true); await onSave(draft); setSaving(false); setIsEditing(false); }} disabled={!dirty || saving}
                    className="flex items-center gap-1.5 rounded-md px-3 py-1.5 text-[10px] font-bold text-white disabled:opacity-40 transition-all"
                    style={{ background: '#4f46e5' }}>
                    {saving ? <Loader2 size={10} className="animate-spin" /> : <Save size={10} />} Save
                  </button>
                </>
              ) : (
                <button onClick={() => { setIsEditing(true); setTab('details'); }}
                  className="flex items-center gap-1.5 rounded-md border px-3 py-1.5 text-[10px] font-bold transition-all"
                  style={{ background: '#fff', borderColor: '#cbd5e1', color: '#475569' }}>
                  Edit Tutor
                </button>
              )}
            </div>
          </div>

          <div className="px-5 py-4 ">
            {tab === 'details' ? (
              <div className="space-y-6">
                {/* Contact info row */}
                <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                  {/* Identity */}
                  <div>
                    <p className="mb-3 text-[9px] font-black uppercase tracking-[0.22em] text-[#94a3b8]">Profile</p>
                    <div className="space-y-2.5">
                      {isEditing ? (
                        <div className={fieldCardCls}>
                          <label className={fieldLabelCls}>Name</label>
                          <input type="text" value={draft.name} onChange={e => setDraft({ ...draft, name: e.target.value })} className={`${inputCls} mt-1.5`} />
                        </div>
                      ) : (
                        <p className="text-[13px] font-bold text-[#0f172a]">{draft.name || <span className="italic text-[#94a3b8]">Unnamed</span>}</p>
                      )}
                      {isEditing ? (
                        <div className="flex gap-2 mt-1">
                          {(['math', 'english'] as const).map(c => (
                            <button key={c} onClick={() => setDraft({ ...draft, cat: c })}
                              className="flex-1 rounded-md py-2 text-[10px] font-bold uppercase tracking-[0.12em] transition-all"
                              style={draft.cat === c
                                ? { background: '#4f46e5', color: 'white', border: '1.5px solid #4f46e5' }
                                : { background: 'white', color: '#475569', border: '1.5px solid #cbd5e1' }}>
                              {c === 'math' ? 'Math / Sci' : 'Eng / Hist'}
                            </button>
                          ))}
                        </div>
                      ) : (
                        <span className="inline-block rounded-md px-2.5 py-1 text-[10px] font-bold"
                          style={{ background: catBg, color: catColor }}>{catLabel}</span>
                      )}
                    </div>
                  </div>

                  {/* Contact */}
                  <div style={{ borderLeft: '1px solid #e2e8f0', paddingLeft: '1.5rem' }}>
                    <p className="mb-3 text-[9px] font-black uppercase tracking-[0.22em] text-[#94a3b8]">Contact</p>
                    {isEditing ? (
                      <div className="space-y-3">
                        <div className={fieldCardCls}>
                          <label className={fieldLabelCls}>Email</label>
                          <input type="email" value={draft.email ?? ''} onChange={e => setDraft({ ...draft, email: e.target.value })} className={`${inputCls} mt-1.5`} placeholder="tutor@email.com" />
                        </div>
                        <div className={fieldCardCls}>
                          <label className={fieldLabelCls}>Phone</label>
                          <input type="tel" value={draft.phone ?? ''} onChange={e => setDraft({ ...draft, phone: e.target.value })} className={`${inputCls} mt-1.5`} placeholder="(555) 000-0000" />
                        </div>
                      </div>
                    ) : (
                      <div className="space-y-2.5">
                        {draft.email ? (
                          <div className="flex items-center gap-2.5">
                            <Mail size={12} style={{ color: '#94a3b8' }} className="shrink-0" />
                            <span className="text-[12px] font-medium text-[#334155] truncate">{draft.email}</span>
                          </div>
                        ) : null}
                        {draft.phone ? (
                          <div className="flex items-center gap-2.5">
                            <Phone size={12} style={{ color: '#94a3b8' }} className="shrink-0" />
                            <span className="text-[12px] font-medium text-[#334155]">{draft.phone}</span>
                          </div>
                        ) : null}
                        {!draft.email && !draft.phone && (
                          <p className="text-[11px] italic text-[#cbd5e1]">No contact on file</p>
                        )}
                      </div>
                    )}
                  </div>

                  {/* Subjects preview */}
                  <div style={{ borderLeft: '1px solid #e2e8f0', paddingLeft: '1.5rem' }}>
                    <p className="mb-3 text-[9px] font-black uppercase tracking-[0.22em] text-[#94a3b8]">Subjects · {draft.subjects.length}</p>
                    {draft.subjects.length > 0 ? (
                      <div className="flex flex-wrap gap-1.5">
                        {draft.subjects.map(s => (
                          <span key={s} className="rounded-md px-2 py-0.5 text-[10px] font-semibold"
                            style={{ background: '#dbeafe', color: '#1d4ed8' }}>{s}</span>
                        ))}
                      </div>
                    ) : (
                      <p className="text-[11px] italic text-[#cbd5e1]">No subjects assigned</p>
                    )}
                    {!isEditing && draft.availabilityBlocks.length > 0 && (
                      <p className="mt-3 text-[10px] text-[#64748b]">
                        <span className="font-bold text-[#0f172a]">{draft.availabilityBlocks.length}</span> availability slots
                      </p>
                    )}
                  </div>
                </div>

                {/* Edit-mode full controls */}
                {isEditing && (
                  <div className="space-y-5 pt-2 border-t border-[#e2e8f0]">
                    <SubjectCheckboxes selected={draft.subjects} onChange={subjects => setDraft({ ...draft, subjects })} />
                    <AvailabilityGrid
                      blocks={draft.availabilityBlocks}
                      onChange={b => setDraft({
                        ...draft,
                        availabilityBlocks: b,
                        availability: Array.from(new Set(b.map(x => parseInt(x.split('-')[0])))).sort((a, b) => a - b),
                      })}
                    />
                  </div>
                )}
              </div>
            ) : (
              <TimeOffPanel tutor={tutor} timeOffList={timeOffList} onRefetch={onRefetch} />
            )}
          </div>
        </div>
        )}
      </div>
      {confirmDelete && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{ background: 'rgba(15,23,42,0.6)', backdropFilter: 'blur(4px)' }} onClick={() => setConfirmDelete(false)}>
          <div className="max-w-sm rounded-xl border border-[#cbd5e1] bg-white p-5 shadow-[0_24px_50px_rgba(15,23,42,0.22)]" onClick={e => e.stopPropagation()}>
            <p className="text-sm font-bold text-[#0f172a] mb-4">Delete {draft.name}?</p>
            <p className="text-[13px] text-[#64748b] mb-5">This action cannot be undone.</p>
            <div className="flex gap-2">
              <button onClick={() => setConfirmDelete(false)} className="rounded-xl border border-[#94a3b8] px-4 py-2 text-xs font-black uppercase tracking-[0.16em]" style={{ background: '#e2e8f0', color: '#475569' }}>Cancel</button>
              <button onClick={async () => { await onDelete(tutor.id); setConfirmDelete(false); }} className="rounded-xl px-4 py-2 text-xs font-black uppercase tracking-[0.16em] text-white" style={{ background: '#dc2626' }}>Delete</button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

// ── Main Page ─────────────────────────────────────────────────────────────────
export default function TutorManagementPage() {
  const [tutors, setTutors] = useState<TutorWithContact[]>([]);
  const [timeOffList, setTimeOffList] = useState<TimeOff[]>([]);
  const [scheduledSessions, setScheduledSessions] = useState<ScheduledSession[]>([]);
  const [loading, setLoading] = useState(true);
  const [adding, setAdding] = useState(false);
  const [newTutor, setNewTutor] = useState<Omit<TutorWithContact, 'id'>>(EMPTY_TUTOR);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [bulkDeleting, setBulkDeleting] = useState(false);
  const [confirmBulk, setConfirmBulk] = useState(false);
  const [activeTutorId, setActiveTutorId] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [terms, setTerms] = useState<TermOption[]>([]);
  const [selectedTermId, setSelectedTermId] = useState<string>('');
  const [termAvailabilityByTutor, setTermAvailabilityByTutor] = useState<Record<string, string[]>>({});
  const [loadingTermAvailability, setLoadingTermAvailability] = useState(false);
  const [sendScheduleOpen, setSendScheduleOpen] = useState(false);
  const [sendWeekDate, setSendWeekDate] = useState(() => getMondayOfCurrentWeek());
  const [sendingSched, setSendingSched] = useState(false);
  const [sendResult, setSendResult] = useState<{ sent: number; failed: number; errors: string[]; mode?: string; redirectedTo?: string | null } | null>(null);

  const fetchAll = async () => {
    setLoading(true);
    setError(null);
    const todayIso = toISODate(new Date());
    const [tutorRes, timeOffRes, sessionRes] = await Promise.all([
      withCenter(supabase.from(TUTORS).select('*')).order('name'),
      withCenter(supabase.from(TIME_OFF).select('*')).order('date'),
      (withCenter(supabase
        .from(SESSIONS)
        .select(`id, session_date, tutor_id, time, ${SS} ( id, student_id, name, status, series_id )`)
        .gte('session_date', todayIso)
        .order('session_date'))
        .order('time') as any),
    ]);
    if (!tutorRes.error) {
      const tutorRows = (tutorRes.data ?? []) as any[];
      setTutors(tutorRows.map(row => ({
        id: row.id, name: row.name, subjects: row.subjects ?? [], cat: row.cat,
        availability: row.availability ?? [], availabilityBlocks: row.availability_blocks ?? [],
        email: row.email ?? null, phone: row.phone ?? null,
      })));
    }
    if (!timeOffRes.error) setTimeOffList(timeOffRes.data ?? []);
    if (!sessionRes.error) {
      setScheduledSessions((sessionRes.data ?? []).map((row: any) => ({
        id: row.id,
        tutorId: row.tutor_id,
        date: row.session_date,
        time: row.time,
        students: (row[SS] ?? []).map((student: any) => ({
          id: student.student_id,
          name: student.name,
          status: student.status,
          seriesId: student.series_id ?? null,
        })),
      })));
    }
    if (tutorRes.error) setError(tutorRes.error.message);
    else if (timeOffRes.error) setError(timeOffRes.error.message);
    else if (sessionRes.error) setError(sessionRes.error.message);
    setLoading(false);
  };

  useEffect(() => { fetchAll(); }, []);

  useEffect(() => {
    fetch('/api/terms', { cache: 'no-store' })
      .then(r => r.json())
      .then(d => {
        const rows: TermOption[] = Array.isArray(d?.terms) ? d.terms : [];
        setTerms(rows);
        const active = rows.find(t => (t.status ?? '').trim().toLowerCase() === 'active');
        if (active) setSelectedTermId(active.id);
      })
      .catch(() => {});
  }, []);

  useEffect(() => {
    if (!selectedTermId) { setTermAvailabilityByTutor({}); return; }
    setLoadingTermAvailability(true);
    fetch(`/api/tutor-availability?termId=${encodeURIComponent(selectedTermId)}`, { cache: 'no-store' })
      .then(r => r.json())
      .then(d => {
        const rows = Array.isArray(d?.overrides) ? d.overrides : [];
        const map = rows.reduce((acc: Record<string, string[]>, row: any) => {
          if (row?.tutor_id && Array.isArray(row?.availability_blocks)) {
            acc[row.tutor_id] = row.availability_blocks;
          }
          return acc;
        }, {});
        setTermAvailabilityByTutor(map);
      })
      .catch(() => setTermAvailabilityByTutor({}))
      .finally(() => setLoadingTermAvailability(false));
  }, [selectedTermId]);

  useEffect(() => {
    if (tutors.length === 0) {
      setActiveTutorId(null);
      return;
    }

    if (!activeTutorId || !tutors.some(tutor => tutor.id === activeTutorId)) {
      setActiveTutorId(tutors[0].id);
    }
  }, [tutors, activeTutorId]);

  const handleSave = async (updated: TutorWithContact) => {
    setError(null);
    const baseUpdate: Record<string, unknown> = {
      name: updated.name, subjects: updated.subjects, cat: updated.cat,
      email: updated.email || null, phone: updated.phone || null,
    };
    if (!selectedTermId) {
      baseUpdate.availability = updated.availability;
      baseUpdate.availability_blocks = updated.availabilityBlocks;
    }
    const { error } = await withCenter(supabase.from(TUTORS).update(baseUpdate)).eq('id', updated.id);
    if (error) { setError(error.message); return; }
    if (selectedTermId) {
      const res = await fetch('/api/tutor-availability', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tutorId: updated.id, termId: selectedTermId, availabilityBlocks: updated.availabilityBlocks }),
      });
      const payload = await res.json().catch(() => ({}));
      if (!res.ok) { setError(payload?.error || 'Failed to save term availability'); return; }
      setTermAvailabilityByTutor(prev => ({ ...prev, [updated.id]: updated.availabilityBlocks }));
    }
    fetchAll();
  };

  const handleDelete = async (id: string) => {
    setError(null);
    const { error } = await withCenter(supabase.from(TUTORS).delete()).eq('id', id);
    if (error) setError(error.message);
    else fetchAll();
  };

  const handleBulkDelete = async () => {
    if (!confirmBulk) { setConfirmBulk(true); setTimeout(() => setConfirmBulk(false), 3000); return; }
    setBulkDeleting(true);
    await withCenter(supabase.from(TUTORS).delete()).in('id', Array.from(selected));
    logEvent('tutors_bulk_deleted', { count: selected.size });
    setSelected(new Set());
    setConfirmBulk(false);
    setBulkDeleting(false);
    fetchAll();
  };

  const handleAdd = async () => {
    if (!newTutor.name.trim()) return;
    setSaving(true); setError(null);
    const { error } = await supabase.from(TUTORS).insert([withCenterPayload({
      name: newTutor.name, subjects: newTutor.subjects, cat: newTutor.cat,
      availability: newTutor.availability, availability_blocks: newTutor.availabilityBlocks,
      email: newTutor.email || null, phone: newTutor.phone || null,
    })]);
    setSaving(false);
    if (error) setError(error.message);
    else { setAdding(false); setNewTutor(EMPTY_TUTOR); fetchAll(); logEvent('tutor_created', { tutorName: newTutor.name }); }
  };

  const handleSendSchedules = async () => {
    setSendingSched(true);
    setSendResult(null);
    try {
      const ids = tutors.filter(t => t.email).map(t => t.id);
      const res = await fetch('/api/send-tutor-schedule', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tutorIds: ids, mode: 'weekly', date: sendWeekDate }),
      });
      const data = await res.json();
      if (!res.ok) setSendResult({ sent: 0, failed: ids.length, errors: [data.error ?? 'Request failed'] });
      else setSendResult(data);
    } catch (e: any) {
      setSendResult({ sent: 0, failed: 0, errors: [e?.message ?? 'Unknown error'] });
    } finally {
      setSendingSched(false);
    }
  };

  const allSelected = tutors.length > 0 && tutors.every(t => selected.has(t.id));
  const selectedTermSessionTimes = terms.find(t => t.id === selectedTermId)?.session_times_by_day ?? null;
  const tutorsWithEmail = tutors.filter(t => !!t.email);
  const tutorsWithContact = tutors.filter(t => t.email || t.phone).length;
  const tutorsWithTimeOff = new Set(timeOffList.map(entry => entry.tutor_id)).size;
  const filteredTutors = tutors.filter(tutor => {
    const query = searchQuery.trim().toLowerCase();
    if (!query) return true;

    return [tutor.name, tutor.email ?? '', tutor.phone ?? '', tutor.subjects.join(' ')].some(value =>
      value.toLowerCase().includes(query)
    );
  });
  const activeTutor = filteredTutors.find(tutor => tutor.id === activeTutorId)
    ?? tutors.find(tutor => tutor.id === activeTutorId)
    ?? filteredTutors[0]
    ?? tutors[0]
    ?? null;
  const toggleAll = () => {
    if (allSelected) { setSelected(new Set()); }
    else { setSelected(new Set(tutors.map(t => t.id))); }
  };

  if (loading) return (
    <div className="min-h-screen bg-slate-50 px-4 py-5 text-slate-900" style={{ fontFamily: 'Inter, Segoe UI, ui-sans-serif, system-ui, sans-serif' }}>
      <div className="mx-auto flex h-[calc(100vh-2.5rem)] w-full max-w-7xl items-center justify-center overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
        <div className="flex flex-col items-center gap-3">
          <Loader2 size={24} className="animate-spin" style={{ color: '#dc2626' }} />
          <p className="text-[10px] font-black uppercase tracking-widest" style={{ color: '#94a3b8' }}>Loading tutors…</p>
        </div>
      </div>
    </div>
  );

  return (
    <div className="min-h-screen bg-slate-50 px-4 py-5 text-slate-900" style={{ fontFamily: 'Inter, Segoe UI, ui-sans-serif, system-ui, sans-serif' }}>
      <div className="mx-auto flex h-[calc(100vh-2.5rem)] w-full max-w-7xl flex-col overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
      <div className="tutor-admin flex h-full flex-col overflow-hidden overscroll-contain bg-white">

      {/* Top bar */}
      <div className="sticky top-0 z-40 border-b border-slate-200 bg-white">
        <div className="mx-auto flex h-16 max-w-7xl items-center justify-between gap-4 px-5">
          <div className="flex items-center gap-3">
            <div className="flex h-8 w-8 items-center justify-center rounded bg-slate-900 text-white">
              <UserPlus size={15} />
            </div>
            <div>
              <p className="text-[10px] font-bold uppercase tracking-widest text-slate-400">Tutor Admin</p>
              <div className="flex items-center gap-2">
                <span className="text-base font-black text-slate-900">Tutors</span>
                {!loading && <span className="rounded bg-slate-100 px-2 py-0.5 text-[10px] font-bold text-slate-500">{tutors.length}</span>}
              </div>
            </div>
          </div>
          <div className="flex items-center gap-2">
            {selected.size > 0 && (
              <button onClick={handleBulkDelete} disabled={bulkDeleting}
                className={`flex items-center gap-1.5 rounded border px-3 py-1.5 text-xs font-semibold transition-colors disabled:opacity-50 ${confirmBulk ? 'border-red-300 bg-red-50 text-red-600' : 'border-slate-200 text-slate-600 hover:border-red-200 hover:text-red-500'}`}>
                {bulkDeleting ? <Loader2 size={11} className="animate-spin" /> : <Trash2 size={11} />}
                {confirmBulk ? `Confirm delete ${selected.size}` : `Delete ${selected.size}`}
              </button>
            )}
            <button
              onClick={() => { setSendScheduleOpen(o => !o); setAdding(false); setSendResult(null); }}
              className={`flex items-center gap-1.5 rounded border px-3 py-1.5 text-xs font-semibold transition-colors ${sendScheduleOpen ? 'border-indigo-300 bg-indigo-50 text-indigo-700' : 'border-slate-200 text-slate-600 hover:bg-slate-50'}`}>
              <Mail size={13} />
              {sendScheduleOpen ? 'Close' : 'Send Schedules'}
            </button>
            <button
              onClick={() => { setAdding(a => !a); setNewTutor(EMPTY_TUTOR); setSendScheduleOpen(false); }}
              className={`flex items-center gap-1.5 rounded px-3 py-1.5 text-xs font-semibold text-white transition-colors ${adding ? 'bg-slate-700 hover:bg-slate-600' : 'bg-slate-900 hover:bg-slate-800'}`}>
              {adding ? <><X size={13} /> Cancel</> : <><UserPlus size={13} /> Add Tutor</>}
            </button>
          </div>
        </div>
      </div>

      <div className="mx-auto flex min-h-0 w-full max-w-7xl flex-1 flex-col px-5 py-4">

        {error && (
          <div className="flex items-center gap-2 rounded-lg p-3 text-sm shadow-[0_12px_26px_rgba(15,23,42,0.08)]"
            style={{ background: '#fff1f2', border: '1px solid #fda4af', color: '#991b1b' }}>
            <AlertTriangle size={14} className="shrink-0" /> {error}
          </div>
        )}

        {/* Add new tutor */}
        {adding && (
          <div className="max-h-[72dvh] overflow-y-auto pr-1">
            <div className="space-y-4 rounded-xl bg-white p-4 shadow-[0_16px_32px_rgba(15,23,42,0.08)]"
              style={{ border: '1px solid #cbd5e1' }}>
              <div className="flex items-center gap-2">
                <div className="h-4 w-1 rounded-full" style={{ background: '#4f46e5' }} />
                <p className="text-[10px] font-black uppercase tracking-[0.22em]" style={{ color: '#4f46e5' }}>New Tutor</p>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className={fieldCardCls}>
                  <label className={fieldLabelCls}>Name</label>
                  <input value={newTutor.name} onChange={e => setNewTutor({ ...newTutor, name: e.target.value })}
                    placeholder="Full name" className={inputCls} />
                </div>
                <div className={fieldCardCls}>
                  <label className={fieldLabelCls}>Category</label>
                  <div className="mt-2 flex gap-2">
                    {(['math', 'english'] as const).map(c => (
                      <button key={c} onClick={() => setNewTutor({ ...newTutor, cat: c })}
                        className="flex-1 rounded-md py-2.5 text-xs font-black uppercase tracking-[0.16em] transition-all"
                        style={newTutor.cat === c
                          ? { background: '#4f46e5', color: 'white', border: '1.5px solid #4f46e5', boxShadow: '0 10px 20px rgba(79,70,229,0.18)' }
                          : { background: 'white', color: '#475569', border: '1.5px solid #cbd5e1' }}>
                        {c === 'math' ? 'Math / Sci' : 'Eng / Hist'}
                      </button>
                    ))}
                  </div>
                </div>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className={fieldCardCls}>
                  <label className={fieldLabelCls}>Email</label>
                  <div className="relative">
                    <Mail size={13} className="absolute left-3 top-1/2 -translate-y-1/2 text-[#94a3b8]" />
                    <input type="email" value={newTutor.email ?? ''} onChange={e => setNewTutor({ ...newTutor, email: e.target.value })}
                      placeholder="tutor@email.com"
                      className="w-full rounded-lg border border-[#94a3b8] bg-white py-2.5 pl-8 pr-3 text-sm font-medium text-[#0f172a] placeholder:text-[#64748b] focus:outline-none focus:border-[#4f46e5] focus:ring-4 focus:ring-[#e0e7ff] transition-all" />
                  </div>
                </div>
                <div className={fieldCardCls}>
                  <label className={fieldLabelCls}>Phone</label>
                  <div className="relative">
                    <Phone size={13} className="absolute left-3 top-1/2 -translate-y-1/2 text-[#94a3b8]" />
                    <input type="tel" value={newTutor.phone ?? ''} onChange={e => setNewTutor({ ...newTutor, phone: e.target.value })}
                      placeholder="(555) 000-0000"
                      className="w-full rounded-lg border border-[#94a3b8] bg-white py-2.5 pl-8 pr-3 text-sm font-medium text-[#0f172a] placeholder:text-[#64748b] focus:outline-none focus:border-[#4f46e5] focus:ring-4 focus:ring-[#e0e7ff] transition-all" />
                  </div>
                </div>
              </div>

              <SubjectCheckboxes selected={newTutor.subjects} onChange={subjects => setNewTutor({ ...newTutor, subjects })} />
              <AvailabilityGrid
                blocks={newTutor.availabilityBlocks}
                onChange={b => setNewTutor({
                  ...newTutor,
                  availabilityBlocks: b,
                  availability: Array.from(new Set(b.map(x => parseInt(x.split('-')[0])))).sort((a, b) => a - b),
                })}
              />

              <div className="flex gap-2 border-t border-[#cbd5e1] pt-3">
                <button onClick={() => { setAdding(false); setNewTutor(EMPTY_TUTOR); }}
                  className="rounded-xl border border-[#94a3b8] px-4 py-2.5 text-xs font-black uppercase tracking-[0.16em] transition-all"
                  style={{ background: '#e2e8f0', color: '#475569' }}>
                  Cancel
                </button>
                <button onClick={handleAdd} disabled={saving || !newTutor.name.trim()}
                  className="flex-1 flex items-center justify-center gap-2 rounded-md py-2.5 text-xs font-black uppercase tracking-[0.16em] transition-all active:scale-95"
                  style={{
                    background: newTutor.name.trim() ? '#4f46e5' : '#f1f5f9',
                    color: newTutor.name.trim() ? 'white' : '#94a3b8',
                    boxShadow: newTutor.name.trim() ? '0 12px 24px rgba(79,70,229,0.22)' : 'none',
                  }}>
                  {saving ? <><Loader2 size={12} className="animate-spin" /> Adding…</> : <><UserPlus size={12} /> Add to Database</>}
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Send schedules panel */}
        {sendScheduleOpen && !adding && (
          <div className="rounded-xl border border-indigo-100 bg-white p-4 shadow-sm">
            <div className="flex items-center gap-2 mb-4">
              <div className="h-4 w-1 rounded-full bg-indigo-500" />
              <p className="text-[10px] font-black uppercase tracking-[0.22em] text-indigo-600">Send Weekly Schedules</p>
            </div>
            <div className="flex flex-wrap items-end gap-4">
              <div>
                <label className="block text-[10px] font-semibold text-slate-400 mb-1">Week starting</label>
                <input type="date" value={sendWeekDate} onChange={e => setSendWeekDate(e.target.value)}
                  className="rounded border border-slate-200 bg-white px-2.5 py-1.5 text-xs font-medium text-slate-800 outline-none focus:border-indigo-400" />
              </div>
              <div className="flex-1">
                <p className="text-[10px] font-semibold text-slate-400 mb-1">Recipients</p>
                <p className="text-xs font-medium text-slate-700">
                  {tutorsWithEmail.length} tutor{tutorsWithEmail.length !== 1 ? 's' : ''} with email
                  {tutors.length - tutorsWithEmail.length > 0 && (
                    <span className="ml-2 text-slate-400">({tutors.length - tutorsWithEmail.length} without email will be skipped)</span>
                  )}
                </p>
              </div>
              <button onClick={handleSendSchedules} disabled={sendingSched || tutorsWithEmail.length === 0}
                className="flex items-center gap-1.5 rounded px-4 py-2 text-xs font-black uppercase tracking-[0.1em] text-white transition-all disabled:opacity-50"
                style={{ background: '#4f46e5' }}>
                {sendingSched ? <><Loader2 size={12} className="animate-spin" /> Sending…</> : <><Mail size={12} /> Send All</>}
              </button>
            </div>
            {sendResult && (
              <div className={`mt-3 rounded-lg border px-3 py-2 text-xs font-medium ${
                sendResult.mode === 'disabled' ? 'border-slate-200 bg-slate-50 text-slate-600' :
                sendResult.failed > 0 ? 'border-red-200 bg-red-50 text-red-700' :
                'border-green-200 bg-green-50 text-green-700'
              }`}>
                {sendResult.mode === 'disabled'
                  ? 'Email sending is disabled (EMAIL_SEND_MODE=disabled).'
                  : (
                    <>
                      Sent {sendResult.sent}, failed {sendResult.failed}.
                      {sendResult.redirectedTo && <span className="ml-2 text-slate-500">Redirected to {sendResult.redirectedTo}.</span>}
                      {sendResult.errors.length > 0 && (
                        <ul className="mt-1 list-disc pl-4 space-y-0.5">
                          {sendResult.errors.map((e, i) => <li key={i}>{e}</li>)}
                        </ul>
                      )}
                    </>
                  )}
              </div>
            )}
          </div>
        )}

        {/* Term availability scope selector */}
        <div className="mb-3 flex flex-wrap items-center gap-3 rounded-xl border border-slate-200 bg-white px-4 py-2.5">
          <span className="shrink-0 text-[10px] font-black uppercase tracking-[0.18em] text-slate-400">Term</span>
          <select
            value={selectedTermId}
            onChange={e => setSelectedTermId(e.target.value)}
            className="rounded border border-slate-200 bg-white px-2.5 py-1.5 text-xs font-medium text-slate-800 outline-none focus:border-indigo-400 focus:ring-2 focus:ring-indigo-100"
          >
            <option value="">Default (no term override)</option>
            {terms.map(t => (
              <option key={t.id} value={t.id}>
                {t.name}{(t.status ?? '').trim().toLowerCase() === 'active' ? ' · Active' : (t.status ?? '').trim().toLowerCase() === 'upcoming' ? ' · Upcoming' : ''}
              </option>
            ))}
          </select>
          {loadingTermAvailability && <Loader2 size={12} className="animate-spin text-slate-400" />}
          {selectedTermId && !loadingTermAvailability && (
            <span className="text-[11px] text-slate-500">
              {Object.keys(termAvailabilityByTutor).length > 0
                ? `${Object.keys(termAvailabilityByTutor).length} tutor${Object.keys(termAvailabilityByTutor).length === 1 ? '' : 's'} with term overrides`
                : 'No term overrides saved yet'}
            </span>
          )}
        </div>

        {/* Tutors list */}
        {tutors.length === 0 && !adding ? (
          <div className="rounded-xl bg-white py-20 text-center shadow-[0_16px_32px_rgba(15,23,42,0.07)]" style={{ border: '1.5px dashed #cbd5e1' }}>
            <UserPlus size={28} className="mx-auto mb-3 text-[#cbd5e1]" />
            <p className="text-sm font-bold text-[#94a3b8]">No tutors yet</p>
            <p className="text-xs text-[#cbd5e1] mt-1">Add one above to get started</p>
          </div>
        ) : (
          <div className="grid min-h-0 flex-1 gap-4 xl:grid-cols-[290px_minmax(0,1fr)]">
            <div className="flex min-h-0 flex-col space-y-2.5 rounded-xl border border-slate-200 bg-slate-50 p-2.5">
              <div className="rounded border border-slate-200 bg-white p-2.5">
                <p className="text-[10px] font-bold uppercase tracking-widest text-slate-400">Roster</p>
                <div className="mt-1 flex items-center justify-between gap-2">
                  <p className="text-sm font-black text-slate-900">{tutors.length} tutors</p>
                  <span className="rounded border border-slate-200 bg-slate-100 px-2 py-0.5 text-[10px] font-semibold text-slate-600">{tutorsWithTimeOff} off</span>
                </div>
                <input
                  value={searchQuery}
                  onChange={event => setSearchQuery(event.target.value)}
                  placeholder="Search name, subject, email"
                  className="mt-2.5 h-7 w-full rounded border border-slate-200 bg-slate-50 px-3 text-xs text-slate-700 outline-none focus:border-slate-400"
                />
              </div>

              <div className="flex items-center justify-between rounded border border-slate-200 bg-white px-3 py-2">
                <button onClick={toggleAll} className="flex items-center gap-2 text-[10px] font-bold uppercase tracking-widest text-slate-500">
                  {allSelected ? <CheckSquare size={14} className="text-slate-900" /> : <Square size={14} />}
                  {allSelected ? 'Clear selection' : 'Select all'}
                </button>
                <span className="rounded bg-slate-100 px-2 py-0.5 text-[10px] font-semibold text-slate-600">
                  {selected.size} selected
                </span>
              </div>

              <div className="min-h-0 space-y-2 overflow-y-auto pr-1">
                {filteredTutors.length > 0 ? filteredTutors.map(tutor => {
                  const conflictCount = getConflictingSessions(
                    tutor.id,
                    timeOffList.filter(entry => entry.tutor_id === tutor.id).map(entry => entry.date),
                    scheduledSessions,
                  ).length;

                  return (
                    <TutorListItem
                      key={tutor.id}
                      tutor={tutor}
                      isActive={activeTutor?.id === tutor.id}
                      isSelected={selected.has(tutor.id)}
                      conflictCount={conflictCount}
                      onClick={() => setActiveTutorId(tutor.id)}
                      onToggle={() => {
                        const newSelected = new Set(selected);
                        if (newSelected.has(tutor.id)) newSelected.delete(tutor.id);
                        else newSelected.add(tutor.id);
                        setSelected(newSelected);
                      }}
                    />
                  );
                }) : (
                  <div className="rounded-2xl border border-dashed border-[#cbd5e1] bg-white px-4 py-8 text-center">
                    <p className="text-sm font-bold text-[#0f172a]">No tutors match this search.</p>
                    <p className="mt-1 text-[11px] text-[#64748b]">Try a name, subject, email, or phone.</p>
                  </div>
                )}
              </div>
            </div>

            <div className="min-h-0">
              {activeTutor ? (
                <TutorDetailPanel
                  key={`${activeTutor.id}-${selectedTermId}${loadingTermAvailability ? '-loading' : ''}`}
                  tutor={activeTutor}
                  timeOffList={timeOffList}
                  scheduledSessions={scheduledSessions}
                  onSave={handleSave}
                  onDelete={handleDelete}
                  onRefetch={fetchAll}
                  selectedTermId={selectedTermId}
                  termAvailabilityBlocks={termAvailabilityByTutor[activeTutor.id]}
                  sessionTimesByDay={selectedTermSessionTimes}
                />
              ) : (
                <div className="rounded-[28px] border border-[#cbd5e1] bg-white px-6 py-16 text-center shadow-[0_24px_60px_rgba(15,23,42,0.12)]">
                  <p className="text-lg font-black text-[#0f172a]">Pick a tutor</p>
                  <p className="mt-2 text-[12px] text-[#64748b]">Select someone from the roster to manage availability, contact details, and time off.</p>
                </div>
              )}
            </div>
          </div>
        )}
      </div>
      </div>
      <style>{`
        .tutor-admin button {
          border-radius: 8px !important;
        }
      `}</style>
    </div>
    </div>
  );
}

