"use client";

import React, { useState, useEffect } from 'react';
import { X, Trash2, UserPlus, ChevronDown, ChevronUp, AlertTriangle, CalendarOff, Plus, Loader2, Mail, Phone, Save } from 'lucide-react';
import { SESSION_BLOCKS } from '@/components/constants';
import { supabase } from '@/lib/supabaseClient';
import type { Tutor } from '@/lib/useScheduleData';

// ─── Subject definitions ──────────────────────────────────────────────────────

export const SUBJECT_GROUPS = [
  { group: 'Math & Science', subjects: ['Algebra', 'Geometry', 'Precalculus', 'Calculus', 'Statistics', 'Biology', 'Chemistry', 'Physics'] },
  { group: 'English & Humanities', subjects: ['English/Writing', 'Literature', 'History', 'Geography'] },
  { group: 'Test Prep', subjects: ['SAT Math', 'SAT Reading', 'ACT Math', 'ACT English', 'ACT Science'] },
];

const ACTIVE_DAYS_INFO = [
  { dow: 1, label: 'Mon' }, { dow: 2, label: 'Tue' }, { dow: 3, label: 'Wed' },
  { dow: 4, label: 'Thu' }, { dow: 6, label: 'Sat' },
];

// ─── Extended Tutor type with contact ────────────────────────────────────────

type TutorWithContact = Tutor & {
  email: string | null;
  phone: string | null;
};

type TimeOff = {
  id: string;
  tutor_id: string;
  date: string;
  note: string;
};

// ─── Helpers ──────────────────────────────────────────────────────────────────

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1.5">
      <label className="block text-[10px] font-black uppercase tracking-widest text-[#a8a29e]">{label}</label>
      {children}
    </div>
  );
}

function Input({ value, onChange, placeholder, type = 'text' }: {
  value: string; onChange: (v: string) => void; placeholder?: string; type?: string;
}) {
  return (
    <input
      type={type}
      value={value}
      onChange={e => onChange(e.target.value)}
      placeholder={placeholder}
      className="w-full px-3 py-2.5 rounded-xl text-sm border border-[#e7e3dd] bg-white text-[#1c1917] placeholder:text-[#d6d3d1] focus:outline-none focus:border-[#6d28d9] focus:ring-2 focus:ring-[#ede9fe] transition-all"
    />
  );
}

// ─── Subject Pills ────────────────────────────────────────────────────────────

function SubjectCheckboxes({ selected, onChange }: { selected: string[]; onChange: (s: string[]) => void }) {
  const toggle = (s: string) =>
    onChange(selected.includes(s) ? selected.filter(x => x !== s) : [...selected, s]);

  return (
    <Field label="Subjects">
      <div className="space-y-3 pt-0.5">
        {SUBJECT_GROUPS.map(group => (
          <div key={group.group}>
            <p className="text-[9px] font-bold uppercase tracking-widest mb-2 text-[#c4b9b2]">{group.group}</p>
            <div className="flex flex-wrap gap-1.5">
              {group.subjects.map(subject => {
                const active = selected.includes(subject);
                return (
                  <button key={subject} type="button" onClick={() => toggle(subject)}
                    className="px-2.5 py-1 rounded-lg text-[11px] font-semibold transition-all"
                    style={active
                      ? { background: '#6d28d9', color: 'white', border: '1.5px solid #6d28d9' }
                      : { background: '#faf9f7', color: '#78716c', border: '1.5px solid #e7e3dd' }}>
                    {subject}
                  </button>
                );
              })}
            </div>
          </div>
        ))}
      </div>
    </Field>
  );
}

// ─── Availability Grid ────────────────────────────────────────────────────────

function AvailabilityGrid({ blocks, onChange }: { blocks: string[]; onChange: (b: string[]) => void }) {
  const toggle = (d: number, t: string) => {
    const key = `${d}-${t}`;
    onChange(blocks.includes(key) ? blocks.filter(b => b !== key) : [...blocks, key]);
  };

  return (
    <Field label="Availability">
      <div className="rounded-xl border border-[#e7e3dd] overflow-hidden">
        <table className="w-full border-collapse">
          <thead>
            <tr className="bg-[#faf9f7] border-b border-[#e7e3dd]">
              <th className="px-3 py-2.5 text-left text-[10px] font-black uppercase tracking-widest text-[#a8a29e] border-r border-[#e7e3dd]">Session</th>
              {ACTIVE_DAYS_INFO.map(d => (
                <th key={d.dow} className="px-2 py-2.5 text-center text-[10px] font-black uppercase tracking-widest text-[#a8a29e]">{d.label}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {SESSION_BLOCKS.map((block, bi) => (
              <tr key={block.id} className={bi < SESSION_BLOCKS.length - 1 ? 'border-b border-[#f0ece8]' : ''}>
                <td className="px-3 py-2 bg-[#faf9f7] border-r border-[#e7e3dd]">
                  <p className="text-[11px] font-bold text-[#1c1917] leading-none">{block.label}</p>
                  <p className="text-[9px] text-[#c4b9b2] mt-0.5">{block.display}</p>
                </td>
                {ACTIVE_DAYS_INFO.map(d => {
                  const applicable = block.days.includes(d.dow);
                  const active = applicable && blocks.includes(`${d.dow}-${block.time}`);
                  return (
                    <td key={d.dow} className="p-1.5 text-center">
                      {applicable ? (
                        <button type="button" onClick={() => toggle(d.dow, block.time)}
                          className="w-8 h-8 rounded-lg mx-auto flex items-center justify-center transition-all"
                          style={{
                            background: active ? '#6d28d9' : 'white',
                            border: `1.5px solid ${active ? '#6d28d9' : '#e7e3dd'}`,
                          }}>
                          {active && <span className="text-white text-[10px] font-black">✓</span>}
                        </button>
                      ) : (
                        <div className="w-8 h-8 rounded-lg mx-auto bg-[#f5f3f0]" />
                      )}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Field>
  );
}

// ─── Time Off Panel ───────────────────────────────────────────────────────────

function TimeOffPanel({ tutor, timeOffList, onRefetch }: {
  tutor: TutorWithContact; timeOffList: TimeOff[]; onRefetch: () => void;
}) {
  const [date, setDate] = useState('');
  const [note, setNote] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const tutorTimeOff = timeOffList.filter(t => t.tutor_id === tutor.id).sort((a, b) => a.date.localeCompare(b.date));

  const handleAdd = async () => {
    if (!date) return;
    setSaving(true); setError(null);
    const { error } = await supabase.from('slake_tutor_time_off').insert({ tutor_id: tutor.id, date, note });
    setSaving(false);
    if (error) setError(error.message);
    else { setDate(''); setNote(''); onRefetch(); }
  };

  const handleDelete = async (id: string) => {
    await supabase.from('slake_tutor_time_off').delete().eq('id', id);
    onRefetch();
  };

  return (
    <div className="space-y-4">
      <div className="flex gap-2 items-end">
        <div className="flex-1">
          <Field label="Date">
            <input type="date" value={date} onChange={e => setDate(e.target.value)}
              className="w-full px-3 py-2.5 rounded-xl text-sm border border-[#e7e3dd] bg-white text-[#1c1917] focus:outline-none focus:border-[#6d28d9] focus:ring-2 focus:ring-[#ede9fe] transition-all" />
          </Field>
        </div>
        <div className="flex-[2]">
          <Field label="Reason (optional)">
            <Input value={note} onChange={setNote} placeholder="e.g. Sick, vacation, personal" />
          </Field>
        </div>
        <button onClick={handleAdd} disabled={!date || saving}
          className="flex items-center gap-1.5 px-4 py-2.5 rounded-xl text-xs font-bold transition-all shrink-0 mb-0.5"
          style={{ background: date ? '#6d28d9' : '#f0ece8', color: date ? 'white' : '#c4b9b2', cursor: date ? 'pointer' : 'not-allowed' }}>
          <Plus size={13} /> Add
        </button>
      </div>

      {error && <p className="text-xs text-red-500">{error}</p>}

      {tutorTimeOff.length === 0 ? (
        <div className="py-8 rounded-xl border-2 border-dashed border-[#e7e3dd] text-center bg-[#faf9f7]">
          <CalendarOff size={18} className="mx-auto mb-2 text-[#d6d3d1]" />
          <p className="text-[10px] font-semibold text-[#c4b9b2]">No time off scheduled</p>
        </div>
      ) : (
        <div className="space-y-2">
          {tutorTimeOff.map(entry => (
            <div key={entry.id} className="flex items-center justify-between px-4 py-3 rounded-xl bg-[#faf9f7] border border-[#e7e3dd]">
              <div className="flex items-center gap-3">
                <div className="w-7 h-7 rounded-lg bg-[#ede9fe] flex items-center justify-center">
                  <CalendarOff size={12} className="text-[#6d28d9]" />
                </div>
                <div>
                  <p className="text-xs font-bold text-[#1c1917]">
                    {new Date(entry.date + 'T00:00:00').toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })}
                  </p>
                  {entry.note && <p className="text-[10px] text-[#a8a29e]">{entry.note}</p>}
                </div>
              </div>
              <button onClick={() => handleDelete(entry.id)}
                className="w-7 h-7 rounded-lg flex items-center justify-center text-[#c4b9b2] hover:text-red-500 hover:bg-red-50 transition-all">
                <X size={13} />
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ─── Tutor Row ────────────────────────────────────────────────────────────────

const EMPTY_TUTOR: Omit<TutorWithContact, 'id'> = {
  name: '', subjects: [], cat: 'math', availability: [], availabilityBlocks: [],
  email: '', phone: '',
};

function initials(name: string) {
  return name.split(' ').map(n => n[0]).join('').slice(0, 2).toUpperCase() || '?';
}

function TutorRow({ tutor, timeOffList, onSave, onDelete, onRefetch }: {
  tutor: TutorWithContact;
  timeOffList: TimeOff[];
  onSave: (u: TutorWithContact) => Promise<void>;
  onDelete: (id: string) => Promise<void>;
  onRefetch: () => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const [tab, setTab] = useState<'details' | 'timeoff'>('details');
  const [draft, setDraft] = useState<TutorWithContact>(tutor);
  const [saving, setSaving] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);

  const dirty =
    tutor.name !== draft.name ||
    tutor.cat !== draft.cat ||
    tutor.email !== draft.email ||
    tutor.phone !== draft.phone ||
    JSON.stringify(tutor.subjects) !== JSON.stringify(draft.subjects) ||
    JSON.stringify(tutor.availabilityBlocks) !== JSON.stringify(draft.availabilityBlocks);

  const timeOffCount = timeOffList.filter(t => t.tutor_id === tutor.id).length;

  return (
    <div className="rounded-2xl border overflow-hidden transition-all duration-200"
      style={{ borderColor: expanded ? '#c4b5fd' : '#e7e3dd', boxShadow: expanded ? '0 0 0 1px #c4b5fd' : 'none' }}>

      {/* Header */}
      <div className="px-5 py-4 flex items-center gap-3 cursor-pointer select-none bg-white hover:bg-[#faf9f7] transition-colors"
        onClick={() => setExpanded(e => !e)}>
        <div className="w-9 h-9 rounded-xl flex items-center justify-center text-xs font-black shrink-0 text-[#6d28d9] bg-[#ede9fe]">
          {initials(draft.name)}
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-sm font-bold text-[#1c1917] leading-none">{draft.name || 'Unnamed'}</p>
          <div className="flex items-center gap-2 mt-1 flex-wrap">
            <span className="text-[9px] font-bold px-1.5 py-0.5 rounded-md"
              style={draft.cat === 'math'
                ? { background: '#dbeafe', color: '#1d4ed8' }
                : { background: '#fce7f3', color: '#be185d' }}>
              {draft.cat === 'math' ? 'Math/Sci' : 'Eng/Hist'}
            </span>
            {draft.email && (
              <span className="text-[10px] text-[#a8a29e] flex items-center gap-1">
                <Mail size={9} /> {draft.email}
              </span>
            )}
            {!draft.email && draft.subjects.length > 0 && (
              <span className="text-[10px] text-[#c4b9b2] truncate max-w-[200px]">{draft.subjects.join(', ')}</span>
            )}
          </div>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          {timeOffCount > 0 && (
            <span className="text-[9px] font-bold px-2 py-0.5 rounded-full bg-amber-50 text-amber-700 border border-amber-200">
              {timeOffCount} off
            </span>
          )}
          {dirty && (
            <span className="text-[9px] font-bold px-2 py-0.5 rounded-full bg-violet-50 text-violet-600 border border-violet-200">
              Unsaved
            </span>
          )}
          {expanded
            ? <ChevronUp size={14} className="text-[#a8a29e]" />
            : <ChevronDown size={14} className="text-[#a8a29e]" />}
        </div>
      </div>

      {expanded && (
        <div className="border-t border-[#e7e3dd]">
          {/* Tabs */}
          <div className="flex bg-[#faf9f7] border-b border-[#e7e3dd]">
            {(['details', 'timeoff'] as const).map(t => (
              <button key={t} onClick={() => setTab(t)}
                className="flex-1 py-3 text-[10px] font-black uppercase tracking-widest transition-all"
                style={{
                  color: tab === t ? '#6d28d9' : '#a8a29e',
                  borderBottom: tab === t ? '2px solid #6d28d9' : '2px solid transparent',
                  background: 'transparent',
                }}>
                {t === 'details' ? 'Details & Availability' : `Time Off${timeOffCount > 0 ? ` (${timeOffCount})` : ''}`}
              </button>
            ))}
          </div>

          <div className="p-5 bg-white space-y-5">
            {tab === 'details' ? (
              <>
                {/* Name + Category */}
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <Field label="Name">
                    <Input value={draft.name} onChange={v => setDraft({ ...draft, name: v })} placeholder="Full name" />
                  </Field>
                  <Field label="Category">
                    <div className="flex gap-2">
                      {(['math', 'english'] as const).map(c => (
                        <button key={c} onClick={() => setDraft({ ...draft, cat: c })}
                          className="flex-1 py-2.5 rounded-xl text-xs font-bold transition-all"
                          style={draft.cat === c
                            ? { background: '#6d28d9', color: 'white', border: '1.5px solid #6d28d9' }
                            : { background: '#faf9f7', color: '#78716c', border: '1.5px solid #e7e3dd' }}>
                          {c === 'math' ? 'Math / Sci' : 'Eng / Hist'}
                        </button>
                      ))}
                    </div>
                  </Field>
                </div>

                {/* Contact */}
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <Field label="Email">
                    <div className="relative">
                      <Mail size={13} className="absolute left-3 top-1/2 -translate-y-1/2 text-[#c4b9b2]" />
                      <input
                        type="email"
                        value={draft.email ?? ''}
                        onChange={e => setDraft({ ...draft, email: e.target.value })}
                        placeholder="tutor@email.com"
                        className="w-full pl-8 pr-3 py-2.5 rounded-xl text-sm border border-[#e7e3dd] bg-white text-[#1c1917] placeholder:text-[#d6d3d1] focus:outline-none focus:border-[#6d28d9] focus:ring-2 focus:ring-[#ede9fe] transition-all"
                      />
                    </div>
                  </Field>
                  <Field label="Phone">
                    <div className="relative">
                      <Phone size={13} className="absolute left-3 top-1/2 -translate-y-1/2 text-[#c4b9b2]" />
                      <input
                        type="tel"
                        value={draft.phone ?? ''}
                        onChange={e => setDraft({ ...draft, phone: e.target.value })}
                        placeholder="(555) 000-0000"
                        className="w-full pl-8 pr-3 py-2.5 rounded-xl text-sm border border-[#e7e3dd] bg-white text-[#1c1917] placeholder:text-[#d6d3d1] focus:outline-none focus:border-[#6d28d9] focus:ring-2 focus:ring-[#ede9fe] transition-all"
                      />
                    </div>
                  </Field>
                </div>

                <SubjectCheckboxes selected={draft.subjects} onChange={subjects => setDraft({ ...draft, subjects })} />

                <AvailabilityGrid
                  blocks={draft.availabilityBlocks}
                  onChange={b => setDraft({
                    ...draft,
                    availabilityBlocks: b,
                    availability: Array.from(new Set(b.map(x => parseInt(x.split('-')[0])))).sort((a, b) => a - b),
                  })}
                />

                {/* Footer actions */}
                <div className="flex justify-between items-center pt-2 border-t border-[#f0ece8]">
                  <button
                    onClick={() => confirmDelete ? onDelete(tutor.id) : setConfirmDelete(true)}
                    onBlur={() => setConfirmDelete(false)}
                    className="flex items-center gap-1.5 text-xs font-semibold transition-colors px-3 py-2 rounded-lg"
                    style={{ color: confirmDelete ? '#dc2626' : '#c4b9b2', background: confirmDelete ? '#fef2f2' : 'transparent' }}>
                    <Trash2 size={12} />
                    {confirmDelete ? 'Confirm delete?' : 'Delete tutor'}
                  </button>
                  <button
                    disabled={!dirty || saving}
                    onClick={async () => { setSaving(true); await onSave(draft); setSaving(false); }}
                    className="flex items-center gap-2 px-5 py-2.5 rounded-xl text-xs font-bold transition-all active:scale-95"
                    style={dirty
                      ? { background: '#6d28d9', color: 'white', boxShadow: '0 2px 8px rgba(109,40,217,0.25)' }
                      : { background: '#f0ece8', color: '#c4b9b2', cursor: 'not-allowed' }}>
                    {saving ? <><Loader2 size={12} className="animate-spin" /> Saving…</> : <><Save size={12} /> Save Changes</>}
                  </button>
                </div>
              </>
            ) : (
              <TimeOffPanel tutor={tutor} timeOffList={timeOffList} onRefetch={onRefetch} />
            )}
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Main Page ────────────────────────────────────────────────────────────────

export default function TutorManagementPage() {
  const [tutors, setTutors] = useState<TutorWithContact[]>([]);
  const [timeOffList, setTimeOffList] = useState<TimeOff[]>([]);
  const [loading, setLoading] = useState(true);
  const [adding, setAdding] = useState(false);
  const [newTutor, setNewTutor] = useState<Omit<TutorWithContact, 'id'>>(EMPTY_TUTOR);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchAll = async () => {
    setLoading(true);
    const [tutorRes, timeOffRes] = await Promise.all([
      supabase.from('slake_tutors').select('*').order('name'),
      supabase.from('slake_tutor_time_off').select('*').order('date'),
    ]);
    if (!tutorRes.error) {
      setTutors((tutorRes.data ?? []).map(r => ({
        id: r.id,
        name: r.name,
        subjects: r.subjects ?? [],
        cat: r.cat,
        availability: r.availability ?? [],
        availabilityBlocks: r.availability_blocks ?? [],
        email: r.email ?? null,
        phone: r.phone ?? null,
      })));
    }
    if (!timeOffRes.error) setTimeOffList(timeOffRes.data ?? []);
    setLoading(false);
  };

  useEffect(() => { fetchAll(); }, []);

  const handleSave = async (updated: TutorWithContact) => {
    setError(null);
    const { error } = await supabase.from('slake_tutors').update({
      name: updated.name,
      subjects: updated.subjects,
      cat: updated.cat,
      availability: updated.availability,
      availability_blocks: updated.availabilityBlocks,
      email: updated.email || null,
      phone: updated.phone || null,
    }).eq('id', updated.id);
    if (error) setError(error.message);
    else fetchAll();
  };

  const handleDelete = async (id: string) => {
    setError(null);
    const { error } = await supabase.from('slake_tutors').delete().eq('id', id);
    if (error) setError(error.message);
    else fetchAll();
  };

  const handleAdd = async () => {
    if (!newTutor.name.trim()) return;
    setSaving(true); setError(null);
    const { error } = await supabase.from('slake_tutors').insert([{
      name: newTutor.name,
      subjects: newTutor.subjects,
      cat: newTutor.cat,
      availability: newTutor.availability,
      availability_blocks: newTutor.availabilityBlocks,
      email: newTutor.email || null,
      phone: newTutor.phone || null,
    }]);
    setSaving(false);
    if (error) setError(error.message);
    else { setAdding(false); setNewTutor(EMPTY_TUTOR); fetchAll(); }
  };

  if (loading) return (
    <div className="w-full min-h-screen flex items-center justify-center bg-[#faf9f7]">
      <div className="flex flex-col items-center gap-3">
        <Loader2 size={24} className="animate-spin text-[#6d28d9]" />
        <p className="text-[10px] font-black uppercase tracking-widest text-[#c4b9b2]">Loading tutors…</p>
      </div>
    </div>
  );

  return (
    <div className="w-full min-h-screen bg-[#faf9f7] pb-20">

      {/* Header */}
      <div className="sticky top-0 z-40 bg-white/95 backdrop-blur-md border-b border-[#e7e3dd]">
        <div className="max-w-3xl mx-auto flex items-center justify-between px-6 py-4">
          <div>
            <h1 className="text-lg font-black uppercase tracking-tight text-[#1c1917] leading-none">Tutors</h1>
            <p className="text-[9px] font-bold text-[#a8a29e] uppercase tracking-widest mt-0.5">
              {tutors.length} tutor{tutors.length !== 1 ? 's' : ''}
            </p>
          </div>
          <button
            onClick={() => { setAdding(a => !a); setNewTutor(EMPTY_TUTOR); }}
            className="flex items-center gap-2 px-4 py-2.5 rounded-xl text-xs font-bold text-white transition-all active:scale-95"
            style={{ background: adding ? '#e7e3dd' : '#6d28d9', color: adding ? '#78716c' : 'white' }}>
            {adding ? <><X size={13} /> Cancel</> : <><UserPlus size={13} /> Add Tutor</>}
          </button>
        </div>
      </div>

      <div className="max-w-3xl mx-auto px-6 pt-6 space-y-3">

        {error && (
          <div className="p-3 rounded-xl flex items-center gap-2 text-sm bg-red-50 border border-red-200 text-red-600">
            <AlertTriangle size={14} className="shrink-0" /> {error}
          </div>
        )}

        {/* Add new tutor form */}
        {adding && (
          <div className="p-6 rounded-2xl border-2 border-[#c4b5fd] bg-white space-y-5 shadow-sm">
            <p className="text-[10px] font-black uppercase tracking-widest text-[#6d28d9]">New Tutor</p>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <Field label="Name">
                <Input value={newTutor.name} onChange={v => setNewTutor({ ...newTutor, name: v })} placeholder="Full name" />
              </Field>
              <Field label="Category">
                <div className="flex gap-2">
                  {(['math', 'english'] as const).map(c => (
                    <button key={c} onClick={() => setNewTutor({ ...newTutor, cat: c })}
                      className="flex-1 py-2.5 rounded-xl text-xs font-bold transition-all"
                      style={newTutor.cat === c
                        ? { background: '#6d28d9', color: 'white', border: '1.5px solid #6d28d9' }
                        : { background: '#faf9f7', color: '#78716c', border: '1.5px solid #e7e3dd' }}>
                      {c === 'math' ? 'Math / Sci' : 'Eng / Hist'}
                    </button>
                  ))}
                </div>
              </Field>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <Field label="Email">
                <div className="relative">
                  <Mail size={13} className="absolute left-3 top-1/2 -translate-y-1/2 text-[#c4b9b2]" />
                  <input type="email" value={newTutor.email ?? ''} onChange={e => setNewTutor({ ...newTutor, email: e.target.value })}
                    placeholder="tutor@email.com"
                    className="w-full pl-8 pr-3 py-2.5 rounded-xl text-sm border border-[#e7e3dd] bg-white text-[#1c1917] placeholder:text-[#d6d3d1] focus:outline-none focus:border-[#6d28d9] focus:ring-2 focus:ring-[#ede9fe] transition-all" />
                </div>
              </Field>
              <Field label="Phone">
                <div className="relative">
                  <Phone size={13} className="absolute left-3 top-1/2 -translate-y-1/2 text-[#c4b9b2]" />
                  <input type="tel" value={newTutor.phone ?? ''} onChange={e => setNewTutor({ ...newTutor, phone: e.target.value })}
                    placeholder="(555) 000-0000"
                    className="w-full pl-8 pr-3 py-2.5 rounded-xl text-sm border border-[#e7e3dd] bg-white text-[#1c1917] placeholder:text-[#d6d3d1] focus:outline-none focus:border-[#6d28d9] focus:ring-2 focus:ring-[#ede9fe] transition-all" />
                </div>
              </Field>
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

            <div className="flex gap-2 pt-2 border-t border-[#f0ece8]">
              <button onClick={() => { setAdding(false); setNewTutor(EMPTY_TUTOR); }}
                className="px-4 py-2.5 rounded-xl text-xs font-semibold text-[#78716c] border border-[#e7e3dd] bg-[#faf9f7] transition-all hover:bg-[#f0ece8]">
                Cancel
              </button>
              <button onClick={handleAdd} disabled={saving || !newTutor.name.trim()}
                className="flex-1 flex items-center justify-center gap-2 py-2.5 rounded-xl text-xs font-bold transition-all active:scale-95"
                style={{
                  background: newTutor.name.trim() ? '#6d28d9' : '#f0ece8',
                  color: newTutor.name.trim() ? 'white' : '#c4b9b2',
                  cursor: newTutor.name.trim() ? 'pointer' : 'not-allowed',
                }}>
                {saving ? <><Loader2 size={12} className="animate-spin" /> Adding…</> : <><UserPlus size={12} /> Add to Database</>}
              </button>
            </div>
          </div>
        )}

        {/* Tutor list */}
        {tutors.map(t => (
          <TutorRow
            key={t.id}
            tutor={t}
            timeOffList={timeOffList}
            onSave={handleSave}
            onDelete={handleDelete}
            onRefetch={fetchAll}
          />
        ))}

        {tutors.length === 0 && !adding && (
          <div className="py-24 text-center">
            <p className="text-sm text-[#c4b9b2] italic">No tutors yet — add one above</p>
          </div>
        )}
      </div>
    </div>
  );
}