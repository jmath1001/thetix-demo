"use client";

import React, { useState, useEffect } from 'react';
import { X, Trash2, UserPlus, ChevronDown, ChevronUp, AlertTriangle, CalendarOff, Plus, Loader2, Mail, Phone, Save, CheckSquare, Square } from 'lucide-react';
import { SESSION_BLOCKS } from '@/components/constants';
import { supabase } from '@/lib/supabaseClient';
import type { Tutor } from '@/lib/useScheduleData';
import { logEvent } from '@/lib/analytics';

// ── Table names ───────────────────────────────────────────────────────────────
const p        = process.env.NEXT_PUBLIC_TABLE_PREFIX ?? 'slake'
const TUTORS   = `${p}_tutors`
const TIME_OFF = `${p}_tutor_time_off`

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

const EMPTY_TUTOR: Omit<TutorWithContact, 'id'> = {
  name: '', subjects: [], cat: 'math', availability: [], availabilityBlocks: [],
  email: '', phone: '',
};

const inputCls = "w-full rounded-lg border border-[#94a3b8] bg-white px-3.5 py-2.5 text-sm font-medium text-[#0f172a] placeholder:text-[#64748b] shadow-[0_1px_2px_rgba(15,23,42,0.06)] focus:outline-none focus:border-[#4f46e5] focus:ring-4 focus:ring-[#e0e7ff] transition-all";
const fieldCardCls = "rounded-lg border border-[#cbd5e1] bg-white px-3.5 py-3 shadow-[0_1px_2px_rgba(15,23,42,0.06)]";
const fieldLabelCls = "block text-[9px] font-black uppercase tracking-[0.22em] text-[#64748b]";

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

function groupTimeOffEntries(entries: TimeOff[]) {
  const sorted = [...entries].sort((left, right) => left.date.localeCompare(right.date));

  return sorted.reduce<Array<{ ids: string[]; startDate: string; endDate: string; note: string; totalDays: number }>>((groups, entry) => {
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

function initials(name: string) {
  return name.split(' ').map(n => n[0]).join('').slice(0, 2).toUpperCase() || '?';
}

// ── Subject Pills ─────────────────────────────────────────────────────────────
function SubjectCheckboxes({ selected, onChange }: { selected: string[]; onChange: (s: string[]) => void }) {
  const toggle = (s: string) =>
    onChange(selected.includes(s) ? selected.filter(x => x !== s) : [...selected, s]);

  return (
    <div className="space-y-3">
      <label className="block text-[10px] font-black uppercase tracking-[0.2em] text-[#334155]">Subjects</label>
      <div className="space-y-3">
        {SUBJECT_GROUPS.map(group => (
          <div key={group.group} className="rounded-lg border border-[#cbd5e1] bg-[#f8fafc] p-4 shadow-[inset_0_1px_0_rgba(255,255,255,0.9)]">
            <p className="mb-3 text-[9px] font-black uppercase tracking-[0.18em] text-[#64748b]">{group.group}</p>
            <div className="flex flex-wrap gap-1.5">
              {group.subjects.map(subject => {
                const active = selected.includes(subject);
                return (
                  <button key={subject} type="button" onClick={() => toggle(subject)}
                    className="rounded-md px-3 py-1.5 text-[11px] font-black uppercase tracking-[0.08em] transition-all"
                    style={active
                      ? { background: '#4f46e5', color: 'white', border: '1.5px solid #4f46e5', boxShadow: '0 8px 18px rgba(79,70,229,0.18)' }
                      : { background: 'white', color: '#475569', border: '1.5px solid #cbd5e1' }}>
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
function AvailabilityGrid({ blocks, onChange }: { blocks: string[]; onChange: (b: string[]) => void }) {
  const toggle = (d: number, t: string) => {
    const key = `${d}-${t}`;
    onChange(blocks.includes(key) ? blocks.filter(b => b !== key) : [...blocks, key]);
  };

  return (
    <div className="space-y-3">
      <label className="block text-[10px] font-black uppercase tracking-[0.2em] text-[#334155]">Availability</label>
      <div className="overflow-hidden rounded-xl border border-[#cbd5e1] bg-white shadow-[0_12px_28px_rgba(15,23,42,0.08)]">
        <table className="w-full border-collapse">
          <thead>
            <tr style={{ background: '#1e293b' }}>
              <th className="border-r border-[#334155] px-3 py-3 text-left text-[10px] font-black uppercase tracking-[0.18em] text-[#cbd5e1]">Session</th>
              {ACTIVE_DAYS_INFO.map(d => (
                <th key={d.dow} className="px-2 py-3 text-center text-[10px] font-black uppercase tracking-[0.18em] text-[#cbd5e1]">{d.label}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {SESSION_BLOCKS.map((block, bi) => (
              <tr key={block.id} style={{ borderBottom: bi < SESSION_BLOCKS.length - 1 ? '1px solid #e2e8f0' : 'none', background: bi % 2 === 0 ? 'white' : '#f8fafc' }}>
                <td className="border-r border-[#e2e8f0] px-3 py-3">
                  <p className="text-[11px] font-black text-[#0f172a] leading-none">{block.label}</p>
                  <p className="text-[9px] text-[#94a3b8] mt-0.5">{block.display}</p>
                </td>
                {ACTIVE_DAYS_INFO.map(d => {
                  const applicable = block.days.includes(d.dow);
                  const active = applicable && blocks.includes(`${d.dow}-${block.time}`);
                  return (
                    <td key={d.dow} className="p-1.5 text-center">
                      {applicable ? (
                        <button type="button" onClick={() => toggle(d.dow, block.time)}
                          className="mx-auto flex h-9 w-9 items-center justify-center rounded-md transition-all"
                          style={{
                            background: active ? '#4f46e5' : 'white',
                            border: `1.5px solid ${active ? '#4f46e5' : '#cbd5e1'}`,
                            boxShadow: active ? '0 10px 20px rgba(79,70,229,0.18)' : 'none',
                          }}>
                          {active && <span className="text-white text-[10px] font-black">✓</span>}
                        </button>
                      ) : (
                        <div className="mx-auto h-9 w-9 rounded-xl" style={{ background: '#e2e8f0' }} />
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
  tutor: TutorWithContact; timeOffList: TimeOff[]; onRefetch: () => void;
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
    const datesToInsert = enumerateDateRange(startDate, finalEndDate).filter(date => !existingDateSet.has(date));

    if (datesToInsert.length === 0) {
      setError('That entire range is already blocked off.');
      return;
    }

    setError(null);
    setSaving(true);
    const { error: insertError } = await supabase.from(TIME_OFF).insert(
      datesToInsert.map(date => ({ tutor_id: tutor.id, date, note: note.trim() }))
    );
    setSaving(false);

    if (insertError) {
      setError(insertError.message);
      return;
    }

    setStartDate('');
    setEndDate('');
    setNote('');
    onRefetch();
  };

  const handleDelete = async (ids: string[]) => {
    await supabase.from(TIME_OFF).delete().in('id', ids);
    onRefetch();
  };

  return (
    <div className="space-y-4">
      <div className="grid gap-3 md:grid-cols-3">
        <div className="rounded-2xl border border-[#cbd5e1] bg-white px-4 py-4 shadow-[0_12px_28px_rgba(15,23,42,0.06)]">
          <p className="text-[10px] font-black uppercase tracking-[0.18em] text-[#64748b]">Blocked days</p>
          <p className="mt-2 text-2xl font-black text-[#0f172a]">{tutorTimeOff.length}</p>
          <p className="mt-1 text-[11px] text-[#64748b]">Individual dates currently unavailable</p>
        </div>
        <div className="rounded-2xl border border-[#cbd5e1] bg-white px-4 py-4 shadow-[0_12px_28px_rgba(15,23,42,0.06)]">
          <p className="text-[10px] font-black uppercase tracking-[0.18em] text-[#64748b]">Next time off</p>
          <p className="mt-2 text-sm font-black text-[#0f172a]">{upcomingTimeOff ? formatDateRangeLabel(upcomingTimeOff.startDate, upcomingTimeOff.endDate) : 'None scheduled'}</p>
          <p className="mt-1 text-[11px] text-[#64748b]">{upcomingTimeOff ? `${upcomingTimeOff.totalDays} day${upcomingTimeOff.totalDays === 1 ? '' : 's'} blocked` : 'This tutor is fully bookable right now.'}</p>
        </div>
        <div className="rounded-2xl border border-[#cbd5e1] bg-white px-4 py-4 shadow-[0_12px_28px_rgba(15,23,42,0.06)]">
          <p className="text-[10px] font-black uppercase tracking-[0.18em] text-[#64748b]">Longest range</p>
          <p className="mt-2 text-2xl font-black text-[#0f172a]">{longestRange || 0}</p>
          <p className="mt-1 text-[11px] text-[#64748b]">Consecutive days in one time-off block</p>
        </div>
      </div>

      <div className="rounded-3xl border border-[#cbd5e1] bg-[linear-gradient(135deg,#ffffff_0%,#f8fbff_55%,#eef2ff_100%)] p-5 shadow-[0_18px_36px_rgba(15,23,42,0.08)]">
        <div className="flex flex-col gap-5 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <p className="text-[10px] font-black uppercase tracking-[0.2em] text-[#4f46e5]">Schedule time off</p>
            <h3 className="mt-2 text-lg font-black text-[#0f172a]">Block a single day or an entire range</h3>
            <p className="mt-1 max-w-xl text-[12px] text-[#64748b]">The schedule still consumes individual dates, but you can now create them in bulk from one range.</p>
          </div>
          {requestedDates.length > 0 && (
            <div className="rounded-2xl border border-[#c7d2fe] bg-white px-4 py-3 text-right shadow-[0_10px_22px_rgba(79,70,229,0.1)]">
              <p className="text-[10px] font-black uppercase tracking-[0.18em] text-[#6366f1]">Pending block</p>
              <p className="mt-1 text-sm font-black text-[#0f172a]">{formatDateRangeLabel(startDate, endDate || startDate)}</p>
              <p className="mt-1 text-[11px] text-[#64748b]">{requestedDates.length} requested day{requestedDates.length === 1 ? '' : 's'}{overlappingDates > 0 ? ` · ${overlappingDates} already blocked` : ''}</p>
            </div>
          )}
        </div>

        <div className="mt-5 grid gap-3 lg:grid-cols-[1fr_1fr_1.7fr_auto]">
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
            className="flex items-center justify-center gap-1.5 rounded-2xl px-4 py-3 text-xs font-black uppercase tracking-[0.16em] transition-all active:scale-95"
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
          <div className="mt-4 rounded-2xl border border-[#fda4af] bg-[#fff1f2] px-4 py-3 text-[12px] font-medium text-[#991b1b]">
            {error}
          </div>
        )}
      </div>

      {groupedTimeOff.length === 0 ? (
        <div className="rounded-xl border-2 border-dashed border-[#cbd5e1] bg-[#f8fafc] py-10 text-center">
          <CalendarOff size={18} className="mx-auto mb-2 text-[#cbd5e1]" />
          <p className="text-[10px] font-black uppercase tracking-[0.18em] text-[#64748b]">No time off scheduled</p>
        </div>
      ) : (
        <div className="space-y-3">
          {groupedTimeOff.map(entry => (
            <div key={`${entry.startDate}-${entry.endDate}-${entry.note}`} className="rounded-[22px] border border-[#cbd5e1] bg-white px-4 py-4 shadow-[0_14px_30px_rgba(15,23,42,0.06)]">
              <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
                <div className="flex items-start gap-3">
                  <div className="mt-0.5 flex h-11 w-11 items-center justify-center rounded-2xl" style={{ background: '#fff1f2' }}>
                    <CalendarOff size={14} style={{ color: '#dc2626' }} />
                  </div>
                  <div>
                    <div className="flex flex-wrap items-center gap-2">
                      <p className="text-sm font-black text-[#0f172a]">{formatDateRangeLabel(entry.startDate, entry.endDate)}</p>
                      <span className="rounded-full bg-[#eef2ff] px-2.5 py-1 text-[10px] font-black uppercase tracking-[0.16em] text-[#4338ca]">
                        {entry.totalDays} day{entry.totalDays === 1 ? '' : 's'}
                      </span>
                    </div>
                    <p className="mt-1 text-[11px] text-[#64748b]">{entry.note || 'No reason added'}</p>
                  </div>
                </div>
                <button onClick={() => handleDelete(entry.ids)}
                  className="flex h-10 items-center justify-center gap-2 rounded-2xl border border-[#fecaca] px-4 text-[10px] font-black uppercase tracking-[0.16em] text-[#dc2626] transition-all hover:bg-[#fff1f2]">
                  <X size={13} /> Remove range
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ── Tutor Row ─────────────────────────────────────────────────────────────────
function TutorRow({ tutor, selected, onToggle, timeOffList, onSave, onDelete, onRefetch }: {
  tutor: TutorWithContact; selected: boolean; onToggle: () => void;
  timeOffList: TimeOff[];
  onSave: (u: TutorWithContact) => Promise<void>;
  onDelete: (id: string) => Promise<void>;
  onRefetch: () => void;
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
  const upcomingTimeOff = timeOffList
    .filter(t => t.tutor_id === tutor.id)
    .sort((left, right) => left.date.localeCompare(right.date))
    .find(entry => entry.date >= toISODate(new Date()));
  const catLabel = draft.cat === 'math' ? 'Math / Sci' : 'Eng / Hist';
  const catColor = draft.cat === 'math' ? '#1d4ed8' : '#be185d';
  const catBg = draft.cat === 'math' ? '#dbeafe' : '#fce7f3';

  return (
    <>
      <div className="overflow-hidden rounded-3xl border shadow-[0_18px_40px_rgba(15,23,42,0.08)] transition-all"
        style={{
          borderColor: selected ? '#fda4af' : expanded ? '#c7d2fe' : '#dbe4ee',
          background: selected
            ? 'linear-gradient(135deg, #fff8f8 0%, #ffffff 55%)'
            : expanded
              ? 'linear-gradient(135deg, #ffffff 0%, #f8fbff 58%, #eef2ff 100%)'
              : '#ffffff',
        }}>
        <div className="p-4 md:p-5">
          <div className="flex flex-col gap-4 xl:flex-row xl:items-start xl:justify-between">
            <div className="flex min-w-0 flex-1 gap-3">
              <div className="pt-1" onClick={e => e.stopPropagation()}>
                <button onClick={onToggle} className="rounded-xl border border-[#cbd5e1] bg-white p-2 text-[#64748b] transition-colors hover:border-[#fda4af] hover:text-[#dc2626]">
                  {selected ? <CheckSquare size={15} style={{ color: '#dc2626' }} /> : <Square size={15} />}
                </button>
              </div>

              <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl text-sm font-black text-white"
                style={{ background: '#dc2626', boxShadow: '0 12px 20px rgba(220,38,38,0.18)' }}>{initials(draft.name)}</div>

              <div className="min-w-0 flex-1">
                <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
                  <div className="min-w-0 cursor-pointer" onClick={() => !isEditing && setExpanded(e => !e)}>
                    <div className="flex flex-wrap items-center gap-2">
                      {isEditing ? (
                        <input type="text" value={draft.name} onChange={e => setDraft({ ...draft, name: e.target.value })}
                          className={`${inputCls} max-w-sm`} placeholder="Full name" autoFocus onClick={e => e.stopPropagation()} />
                      ) : (
                        <h3 className="truncate text-lg font-black text-[#0f172a]">{draft.name || 'Unnamed tutor'}</h3>
                      )}
                      <span className="rounded-full px-2.5 py-1 text-[10px] font-black uppercase tracking-[0.16em]" style={{ background: catBg, color: catColor }}>
                        {catLabel}
                      </span>
                      {dirty && <span className="rounded-full bg-[#fef3c7] px-2.5 py-1 text-[10px] font-black uppercase tracking-[0.16em] text-[#b45309]">Unsaved</span>}
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

                    <div className="mt-3 flex flex-wrap gap-x-4 gap-y-2 text-[12px] text-[#475569]">
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

                <div className="mt-4 grid gap-3 md:grid-cols-3">
                  <div className="rounded-2xl border border-[#e2e8f0] bg-white px-4 py-3">
                    <p className="text-[10px] font-black uppercase tracking-[0.16em] text-[#64748b]">Availability</p>
                    <p className="mt-1 text-sm font-black text-[#0f172a]">{availabilitySummary.slotCount} slots across {availabilitySummary.dayCount || 0} day{availabilitySummary.dayCount === 1 ? '' : 's'}</p>
                    <p className="mt-1 text-[11px] text-[#64748b]">{availabilitySummary.dayLabels.length > 0 ? availabilitySummary.dayLabels.join(' • ') : 'No weekly availability set'}</p>
                  </div>
                  <div className="rounded-2xl border border-[#e2e8f0] bg-white px-4 py-3">
                    <p className="text-[10px] font-black uppercase tracking-[0.16em] text-[#64748b]">Time off</p>
                    <p className="mt-1 text-sm font-black text-[#0f172a]">{timeOffCount} blocked day{timeOffCount === 1 ? '' : 's'}</p>
                    <p className="mt-1 text-[11px] text-[#64748b]">{upcomingTimeOff ? `Next: ${formatDateLabel(upcomingTimeOff.date)}` : 'No upcoming blocks'}</p>
                  </div>
                  <div className="rounded-2xl border border-[#e2e8f0] bg-white px-4 py-3">
                    <p className="text-[10px] font-black uppercase tracking-[0.16em] text-[#64748b]">Profile status</p>
                    <p className="mt-1 text-sm font-black text-[#0f172a]">{draft.subjects.length > 0 && availabilitySummary.slotCount > 0 ? 'Ready for scheduling' : 'Needs setup'}</p>
                    <p className="mt-1 text-[11px] text-[#64748b]">{draft.subjects.length > 0 && availabilitySummary.slotCount > 0 ? 'Subjects and weekly slots are in place.' : 'Add subjects and availability for cleaner scheduling.'}</p>
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

          <div className="px-6 py-5 max-h-[62vh] overflow-y-auto">
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
  const [loading, setLoading] = useState(true);
  const [adding, setAdding] = useState(false);
  const [newTutor, setNewTutor] = useState<Omit<TutorWithContact, 'id'>>(EMPTY_TUTOR);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [bulkDeleting, setBulkDeleting] = useState(false);
  const [confirmBulk, setConfirmBulk] = useState(false);

  const fetchAll = async () => {
    setLoading(true);
    const [tutorRes, timeOffRes] = await Promise.all([
      supabase.from(TUTORS).select('*').order('name'),
      supabase.from(TIME_OFF).select('*').order('date'),
    ]);
    if (!tutorRes.error) {
      setTutors((tutorRes.data ?? []).map(r => ({
        id: r.id, name: r.name, subjects: r.subjects ?? [], cat: r.cat,
        availability: r.availability ?? [], availabilityBlocks: r.availability_blocks ?? [],
        email: r.email ?? null, phone: r.phone ?? null,
      })));
    }
    if (!timeOffRes.error) setTimeOffList(timeOffRes.data ?? []);
    setLoading(false);
  };

  useEffect(() => { fetchAll(); }, []);

  const handleSave = async (updated: TutorWithContact) => {
    setError(null);
    const { error } = await supabase.from(TUTORS).update({
      name: updated.name, subjects: updated.subjects, cat: updated.cat,
      availability: updated.availability, availability_blocks: updated.availabilityBlocks,
      email: updated.email || null, phone: updated.phone || null,
    }).eq('id', updated.id);
    if (error) setError(error.message);
    else fetchAll();
  };

  const handleDelete = async (id: string) => {
    setError(null);
    const { error } = await supabase.from(TUTORS).delete().eq('id', id);
    if (error) setError(error.message);
    else fetchAll();
  };

  const handleBulkDelete = async () => {
    if (!confirmBulk) { setConfirmBulk(true); setTimeout(() => setConfirmBulk(false), 3000); return; }
    setBulkDeleting(true);
    await supabase.from(TUTORS).delete().in('id', Array.from(selected));
    logEvent('tutors_bulk_deleted', { count: selected.size });
    setSelected(new Set());
    setConfirmBulk(false);
    setBulkDeleting(false);
    fetchAll();
  };

  const handleAdd = async () => {
    if (!newTutor.name.trim()) return;
    setSaving(true); setError(null);
    const { error } = await supabase.from(TUTORS).insert([{
      name: newTutor.name, subjects: newTutor.subjects, cat: newTutor.cat,
      availability: newTutor.availability, availability_blocks: newTutor.availabilityBlocks,
      email: newTutor.email || null, phone: newTutor.phone || null,
    }]);
    setSaving(false);
    if (error) setError(error.message);
    else { setAdding(false); setNewTutor(EMPTY_TUTOR); fetchAll(); logEvent('tutor_created', { tutorName: newTutor.name }); }
  };

  const allSelected = tutors.length > 0 && tutors.every(t => selected.has(t.id));
  const tutorsWithContact = tutors.filter(t => t.email || t.phone).length;
  const tutorsWithTimeOff = new Set(timeOffList.map(entry => entry.tutor_id)).size;
  const toggleAll = () => {
    if (allSelected) { setSelected(new Set()); }
    else { setSelected(new Set(tutors.map(t => t.id))); }
  };

  if (loading) return (
    <div className="flex min-h-dvh w-full items-center justify-center" style={{ background: '#f8fafc' }}>
      <div className="flex flex-col items-center gap-3">
        <Loader2 size={24} className="animate-spin" style={{ color: '#dc2626' }} />
        <p className="text-[10px] font-black uppercase tracking-widest" style={{ color: '#94a3b8' }}>Loading tutors…</p>
      </div>
    </div>
  );

  return (
    <div className="tutor-admin h-[calc(100dvh-58px)] overflow-hidden md:h-dvh" style={{ background: 'linear-gradient(180deg, #dbe5f0 0%, #edf2f7 26%, #f6f8fb 100%)', fontFamily: 'ui-sans-serif, system-ui, sans-serif' }}>
      <div className="h-full overflow-y-auto overscroll-contain">

      {/* Top bar */}
      <div className="sticky top-0 z-40 border-b border-[#e2e8f0] backdrop-blur-xl" style={{ background: 'rgba(255,255,255,0.92)' }}>
        <div className="mx-auto flex h-16 max-w-7xl items-center justify-between gap-4 px-5">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-lg border border-[#c7d2fe] bg-[#eef2ff]">
              <UserPlus size={18} style={{ color: '#4f46e5' }} />
            </div>
            <div>
              <p className="text-[11px] font-black uppercase tracking-[0.22em] text-[#4f46e5]">Tutor Admin</p>
              <div className="flex items-center gap-2">
                <span className="text-base font-black text-[#0f172a]">Tutors</span>
                {!loading && <span className="rounded-full border border-[#c7d2fe] bg-[#eef2ff] px-2.5 py-1 text-[10px] font-black uppercase tracking-[0.16em] text-[#3730a3]">{tutors.length}</span>}
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
            <button
              onClick={() => { setAdding(a => !a); setNewTutor(EMPTY_TUTOR); }}
              className="flex items-center gap-1.5 rounded-md px-3.5 py-2 text-xs font-black uppercase tracking-[0.16em] text-white transition-all"
              style={{ background: adding ? '#334155' : '#4f46e5', boxShadow: adding ? 'none' : '0 12px 24px rgba(79,70,229,0.24)' }}>
              {adding ? <><X size={13} /> Cancel</> : <><UserPlus size={13} /> Add Tutor</>}
            </button>
          </div>
        </div>
      </div>

      <div className="mx-auto max-w-7xl px-5 py-5 space-y-4">

        <div className="grid gap-3 lg:grid-cols-3">
          <div className="rounded-[22px] border border-[#cbd5e1] bg-white px-5 py-4 shadow-[0_16px_34px_rgba(15,23,42,0.08)]">
            <p className="text-[10px] font-black uppercase tracking-[0.18em] text-[#64748b]">Tutor roster</p>
            <p className="mt-2 text-2xl font-black text-[#0f172a]">{tutors.length}</p>
            <p className="mt-1 text-[11px] text-[#64748b]">Active tutor profiles in this workspace.</p>
          </div>
          <div className="rounded-[22px] border border-[#cbd5e1] bg-white px-5 py-4 shadow-[0_16px_34px_rgba(15,23,42,0.08)]">
            <p className="text-[10px] font-black uppercase tracking-[0.18em] text-[#64748b]">Reachable tutors</p>
            <p className="mt-2 text-2xl font-black text-[#0f172a]">{tutorsWithContact}</p>
            <p className="mt-1 text-[11px] text-[#64748b]">Tutors with email or phone on file.</p>
          </div>
          <div className="rounded-[22px] border border-[#cbd5e1] bg-white px-5 py-4 shadow-[0_16px_34px_rgba(15,23,42,0.08)]">
            <p className="text-[10px] font-black uppercase tracking-[0.18em] text-[#64748b]">Time-off coverage</p>
            <p className="mt-2 text-2xl font-black text-[#0f172a]">{tutorsWithTimeOff}</p>
            <p className="mt-1 text-[11px] text-[#64748b]">Tutors with at least one blocked date scheduled.</p>
          </div>
        </div>

        {error && (
          <div className="flex items-center gap-2 rounded-lg p-3 text-sm shadow-[0_12px_26px_rgba(15,23,42,0.08)]"
            style={{ background: '#fff1f2', border: '1px solid #fda4af', color: '#991b1b' }}>
            <AlertTriangle size={14} className="shrink-0" /> {error}
          </div>
        )}

        {/* Add new tutor */}
        {adding && (
          <div className="space-y-5 rounded-xl bg-white p-6 shadow-[0_20px_44px_rgba(15,23,42,0.1)]"
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
        )}

        {/* Tutors list */}
        {tutors.length === 0 && !adding ? (
          <div className="rounded-xl bg-white py-24 text-center shadow-[0_20px_44px_rgba(15,23,42,0.08)]" style={{ border: '1.5px dashed #cbd5e1' }}>
            <UserPlus size={28} className="mx-auto mb-3 text-[#cbd5e1]" />
            <p className="text-sm font-bold text-[#94a3b8]">No tutors yet</p>
            <p className="text-xs text-[#cbd5e1] mt-1">Add one above to get started</p>
          </div>
        ) : (
          <div className="space-y-3">
            <div className="flex flex-col gap-3 rounded-[22px] border border-[#cbd5e1] bg-white px-5 py-4 shadow-[0_16px_34px_rgba(15,23,42,0.08)] md:flex-row md:items-center md:justify-between">
              <div>
                <p className="text-[10px] font-black uppercase tracking-[0.18em] text-[#64748b]">Bulk actions</p>
                <p className="mt-1 text-sm font-black text-[#0f172a]">Select tutors first, then delete in one pass.</p>
              </div>
              <div className="flex items-center gap-2">
                <button onClick={toggleAll} className="flex items-center gap-2 rounded-xl border border-[#cbd5e1] bg-[#f8fafc] px-3 py-2 text-[10px] font-black uppercase tracking-[0.16em] text-[#475569] transition-all hover:bg-white">
                  {allSelected ? <CheckSquare size={14} style={{ color: '#dc2626' }} /> : <Square size={14} />}
                  {allSelected ? 'Clear selection' : 'Select all'}
                </button>
                <span className="rounded-full bg-[#eef2ff] px-3 py-2 text-[10px] font-black uppercase tracking-[0.16em] text-[#3730a3]">
                  {selected.size} selected
                </span>
              </div>
            </div>

            <div className="space-y-3">
              {tutors.map(t => (
                <TutorRow
                  key={t.id}
                  tutor={t}
                  selected={selected.has(t.id)}
                  onToggle={() => {
                    const newSelected = new Set(selected);
                    if (newSelected.has(t.id)) newSelected.delete(t.id);
                    else newSelected.add(t.id);
                    setSelected(newSelected);
                  }}
                  timeOffList={timeOffList}
                  onSave={handleSave}
                  onDelete={handleDelete}
                  onRefetch={fetchAll}
                />
              ))}
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
  );
}