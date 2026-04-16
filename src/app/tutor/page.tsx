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
  const [date, setDate] = useState('');
  const [note, setNote] = useState('');
  const [saving, setSaving] = useState(false);

  const tutorTimeOff = timeOffList.filter(t => t.tutor_id === tutor.id).sort((a, b) => a.date.localeCompare(b.date));

  const handleAdd = async () => {
    if (!date) return;
    setSaving(true);
    await supabase.from(TIME_OFF).insert({ tutor_id: tutor.id, date, note });
    setSaving(false);
    setDate(''); setNote(''); onRefetch();
  };

  const handleDelete = async (id: string) => {
    await supabase.from(TIME_OFF).delete().eq('id', id);
    onRefetch();
  };

  return (
    <div className="space-y-4">
      <div className="grid items-end gap-3 md:grid-cols-[1fr_2fr_auto]">
        <div className={fieldCardCls}>
          <label className={fieldLabelCls}>Date</label>
          <input type="date" value={date} onChange={e => setDate(e.target.value)} className={inputCls} />
        </div>
        <div className={fieldCardCls}>
          <label className={fieldLabelCls}>Reason (optional)</label>
          <input value={note} onChange={e => setNote(e.target.value)} placeholder="e.g. Sick, vacation" className={inputCls} />
        </div>
        <button onClick={handleAdd} disabled={!date || saving}
          className="mb-0.5 flex items-center gap-1.5 rounded-md px-4 py-2.5 text-xs font-black uppercase tracking-[0.16em] transition-all active:scale-95"
          style={{ background: date ? '#4f46e5' : '#e2e8f0', color: date ? 'white' : '#94a3b8', cursor: date ? 'pointer' : 'not-allowed', boxShadow: date ? '0 12px 24px rgba(79,70,229,0.22)' : 'none' }}>
          {saving ? <Loader2 size={12} className="animate-spin" /> : <Plus size={13} />} Add
        </button>
      </div>

      {tutorTimeOff.length === 0 ? (
        <div className="rounded-xl border-2 border-dashed border-[#cbd5e1] bg-[#f8fafc] py-10 text-center">
          <CalendarOff size={18} className="mx-auto mb-2 text-[#cbd5e1]" />
          <p className="text-[10px] font-black uppercase tracking-[0.18em] text-[#64748b]">No time off scheduled</p>
        </div>
      ) : (
        <div className="space-y-2">
          {tutorTimeOff.map(entry => (
            <div key={entry.id} className="flex items-center justify-between rounded-lg px-4 py-3"
              style={{ background: '#ffffff', border: '1px solid #cbd5e1', boxShadow: '0 10px 24px rgba(15,23,42,0.06)' }}>
              <div className="flex items-center gap-3">
                <div className="flex h-9 w-9 items-center justify-center rounded-xl" style={{ background: '#fff1f2' }}>
                  <CalendarOff size={12} style={{ color: '#dc2626' }} />
                </div>
                <div>
                  <p className="text-xs font-bold text-[#0f172a]">
                    {new Date(entry.date + 'T00:00:00').toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })}
                  </p>
                  {entry.note && <p className="text-[10px] text-[#64748b]">{entry.note}</p>}
                </div>
              </div>
              <button onClick={() => handleDelete(entry.id)}
                className="flex h-8 w-8 items-center justify-center rounded-xl text-[#94a3b8] transition-all hover:bg-[#fff1f2] hover:text-[#dc2626]">
                <X size={13} />
              </button>
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
  const catLabel = draft.cat === 'math' ? 'Math / Sci' : 'Eng / Hist';
  const catColor = draft.cat === 'math' ? '#1d4ed8' : '#be185d';
  const catBg = draft.cat === 'math' ? '#dbeafe' : '#fce7f3';

  return (
    <>
      {/* Main row */}
      <div className="grid items-center transition-all"
        style={{
          gridTemplateColumns: '32px 34px minmax(150px,2.2fr) minmax(86px,0.9fr) minmax(140px,1.3fr) minmax(120px,1.2fr) 70px 110px',
          borderBottom: expanded ? 'none' : '1px solid #dbe4ee',
          background: selected ? '#fff1f2' : expanded ? '#f8fbff' : '#fff',
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
          <div className="flex h-8 w-8 items-center justify-center rounded-xl text-[10px] font-black text-white shrink-0"
            style={{ background: '#dc2626' }}>{initials(draft.name)}</div>
        </div>

        {/* Name */}
        <div className="flex items-center gap-2 min-w-0 cursor-pointer pr-2" onClick={() => !isEditing && setExpanded(e => !e)}>
          {isEditing ? (
            <input type="text" value={draft.name} onChange={e => setDraft({ ...draft, name: e.target.value })}
              className={inputCls} placeholder="Full name" autoFocus onClick={e => e.stopPropagation()} />
          ) : (
            <span className="text-[13px] font-black text-[#0f172a] truncate">{draft.name || 'Unnamed'}</span>
          )}
        </div>

        {/* Category */}
        <div className="flex items-center">
            <span className="rounded-lg px-2.5 py-1 text-[9px] font-black uppercase tracking-[0.16em] whitespace-nowrap"
            style={{ background: catBg, color: catColor }}>
            {catLabel}
          </span>
        </div>

        {/* Subjects */}
        <div>
          {draft.subjects.length > 0 ? (
            <span className="text-[10px] text-[#64748b] truncate block">{draft.subjects.slice(0, 2).join(', ')}{draft.subjects.length > 2 ? `, +${draft.subjects.length - 2}` : ''}</span>
          ) : (
            <span className="text-[10px] text-[#cbd5e1] italic">No subjects</span>
          )}
        </div>

        {/* Contact */}
        <div>
          {draft.email ? (
            <span className="text-[10px] text-[#64748b] truncate flex items-center gap-1"><Mail size={9} /> {draft.email}</span>
          ) : (
            <span className="text-[10px] text-[#cbd5e1] italic">No contact</span>
          )}
        </div>

        {/* Time off count */}
        <div className="flex items-center justify-center">
          {timeOffCount > 0 ? (
            <span className="rounded-full px-2.5 py-1 text-[9px] font-black uppercase tracking-[0.16em]"
              style={{ background: '#fef3c7', color: '#d97706' }}>{timeOffCount}</span>
          ) : (
            <span className="text-[10px] text-[#cbd5e1]">—</span>
          )}
        </div>

        {/* Actions */}
        <div className="flex items-center justify-end gap-1.5 pr-3" onClick={e => e.stopPropagation()}>
          <button onClick={() => { setIsEditing(true); setExpanded(true); setTab('details'); }}
            className="rounded-md border px-2.5 py-1.5 text-[10px] font-bold transition-all"
            style={{ background: '#fff', borderColor: '#cbd5e1', color: '#475569' }}>
            Edit
          </button>
          <button onClick={() => setConfirmDelete(true)}
            className={`p-1.5 rounded-md transition-all ${confirmDelete ? 'bg-red-50 text-red-500' : 'text-[#cbd5e1] hover:text-red-400'}`}>
            {confirmDelete ? '?' : <Trash2 size={11} />}
          </button>
          <button onClick={() => setExpanded(e => !e)} className="p-1 text-[#94a3b8] hover:text-[#475569] transition-colors">
            {expanded ? <ChevronUp size={13} /> : <ChevronDown size={13} />}
          </button>
        </div>
      </div>

      {/* Expanded panel */}
      {expanded && (
        <div style={{ borderBottom: '1px solid #e2e8f0', background: '#fafbfd', boxShadow: 'inset 0 3px 10px rgba(15,23,42,0.04)' }}>
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
          <div className="overflow-hidden rounded-xl bg-white shadow-[0_20px_44px_rgba(15,23,42,0.1)]" style={{ border: '1px solid #cbd5e1' }}>
            {/* Table header - hidden on mobile */}
            <div className="hidden md:grid px-4 py-3" style={{ gridTemplateColumns: '32px 34px minmax(150px,2.2fr) minmax(86px,0.9fr) minmax(140px,1.3fr) minmax(120px,1.2fr) 70px 110px', background: '#f8fafc', borderBottom: '1px solid #e2e8f0' }}>
              <div className="flex items-center justify-center">
                <button onClick={toggleAll} className="text-[#94a3b8] hover:text-[#dc2626] transition-colors">
                  {allSelected ? <CheckSquare size={14} style={{ color: '#dc2626' }} /> : <Square size={14} />}
                </button>
              </div>
              {['', 'Name', 'Category', 'Subjects', 'Contact', 'Time Off', 'Actions'].map((h, i) => (
                <div key={i} className={`flex items-center text-[9px] font-black uppercase tracking-[0.2em] text-[#64748b] ${h === 'Actions' ? 'justify-end pr-3' : ''}`}>{h}</div>
              ))}
            </div>

            {/* Table rows */}
            <div style={{ background: '#fff' }}>
              {tutors.map((t, i) => (
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