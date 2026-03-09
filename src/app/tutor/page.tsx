"use client";

import React, { useState, useEffect } from 'react';
import { X, Trash2, UserPlus, ChevronDown, ChevronUp, AlertTriangle, CalendarOff, Plus, Loader2 } from 'lucide-react';
import { SESSION_BLOCKS } from '@/components/constants';
import { supabase } from '@/lib/supabaseClient';
import type { Tutor } from '@/lib/useScheduleData';

// ─── Subject definitions ──────────────────────────────────────────────────────

export const SUBJECT_GROUPS = [
  { group: 'Math & Science', subjects: ['Algebra', 'Geometry', 'Precalculus', 'Calculus', 'Statistics', 'Biology', 'Chemistry', 'Physics'] },
  { group: 'English & Humanities', subjects: ['English/Writing', 'Literature', 'History', 'Geography'] },
  { group: 'Test Prep', subjects: ['SAT Math', 'SAT Reading', 'ACT Math', 'ACT English', 'ACT Science'] },
];
export const ALL_SUBJECTS = SUBJECT_GROUPS.flatMap(g => g.subjects);

const ACTIVE_DAYS_INFO = [
  { dow: 1, label: 'Mon' }, { dow: 2, label: 'Tue' }, { dow: 3, label: 'Wed' },
  { dow: 4, label: 'Thu' }, { dow: 6, label: 'Sat' },
];

// ─── Types ────────────────────────────────────────────────────────────────────

type TimeOff = {
  id: string;
  tutor_id: string;
  date: string;
  note: string;
};

// ─── Subject Checkboxes ───────────────────────────────────────────────────────

function SubjectCheckboxes({ selected, onChange }: { selected: string[]; onChange: (s: string[]) => void }) {
  const toggle = (subject: string) =>
    onChange(selected.includes(subject) ? selected.filter(s => s !== subject) : [...selected, subject]);

  return (
    <div className="space-y-3">
      <p className="text-[10px] font-black uppercase tracking-widest text-[#a8a29e]">Subjects</p>
      {SUBJECT_GROUPS.map(group => (
        <div key={group.group}>
          <p className="text-[9px] font-bold uppercase tracking-widest mb-2 text-[#78716c]">{group.group}</p>
          <div className="flex flex-wrap gap-1.5">
            {group.subjects.map(subject => {
              const active = selected.includes(subject);
              return (
                <button key={subject} type="button" onClick={() => toggle(subject)}
                  className="px-2.5 py-1 rounded-lg text-[11px] font-semibold transition-all"
                  style={active ? { background: '#6d28d9', color: 'white', border: '1px solid #6d28d9' } : { background: 'white', color: '#78716c', border: '1px solid #e7e3dd' }}>
                  {subject}
                </button>
              );
            })}
          </div>
        </div>
      ))}
    </div>
  );
}

// ─── Availability Grid ────────────────────────────────────────────────────────

function AvailabilityGrid({ blocks, onChange }: { blocks: string[]; onChange: (b: string[]) => void }) {
  const toggle = (d: number, t: string) => {
    const key = `${d}-${t}`;
    onChange(blocks.includes(key) ? blocks.filter(b => b !== key) : [...blocks, key]);
  };

  return (
    <div className="space-y-2">
      <p className="text-[10px] font-black uppercase tracking-widest text-[#a8a29e]">Availability</p>
      <div className="rounded-xl border overflow-hidden border-[#e7e3dd]">
        <table className="w-full border-collapse">
          <thead>
            <tr className="bg-[#faf9f7] border-b border-[#e7e3dd]">
              <th className="p-2 text-left text-[10px] font-bold uppercase text-[#78716c] border-r border-[#e7e3dd] min-w-[120px]">Session</th>
              {ACTIVE_DAYS_INFO.map(d => (
                <th key={d.dow} className="p-2 text-center text-[10px] font-bold uppercase text-[#78716c] border-l border-[#f0ece8]">{d.label}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {SESSION_BLOCKS.map((block, bi) => (
              <tr key={block.id} style={{ borderBottom: bi < SESSION_BLOCKS.length - 1 ? '1px solid #f0ece8' : 'none' }}>
                <td className="px-3 py-2 bg-[#faf9f7] border-r border-[#e7e3dd]">
                  <div className="text-[10px] font-bold text-[#1c1917]">{block.label}</div>
                  <div className="text-[9px] text-[#a8a29e]">{block.display}</div>
                </td>
                {ACTIVE_DAYS_INFO.map(d => {
                  const applicable = block.days.includes(d.dow);
                  const active = applicable && blocks.includes(`${d.dow}-${block.time}`);
                  return (
                    <td key={d.dow} className="p-1 text-center border-l border-[#f0ece8]">
                      {applicable ? (
                        <button type="button" onClick={() => toggle(d.dow, block.time)}
                          className="w-8 h-8 rounded-lg mx-auto flex items-center justify-center transition-all"
                          style={{ background: active ? '#6d28d9' : 'white', border: `1.5px solid ${active ? '#6d28d9' : '#e7e3dd'}` }}
                          onMouseEnter={e => { if (!active) e.currentTarget.style.background = '#f5f3ff'; }}
                          onMouseLeave={e => { if (!active) e.currentTarget.style.background = 'white'; }}>
                          {active && <span className="text-white text-[10px] font-bold">✓</span>}
                        </button>
                      ) : (
                        <div className="w-8 h-8 rounded-lg mx-auto bg-[#f0ece8]" />
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

// ─── Time Off Panel ───────────────────────────────────────────────────────────

function TimeOffPanel({ tutor, timeOffList, onRefetch }: { tutor: Tutor; timeOffList: TimeOff[]; onRefetch: () => void }) {
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
    <div className="space-y-3">
      <p className="text-[10px] font-black uppercase tracking-widest text-[#a8a29e]">Time Off / Overrides</p>

      {/* Add new */}
      <div className="flex gap-2 items-end">
        <div className="flex-1 space-y-1">
          <label className="text-[9px] font-bold uppercase tracking-wider text-[#78716c]">Date</label>
          <input type="date" value={date} onChange={e => setDate(e.target.value)}
            className="w-full px-3 py-2 rounded-xl text-sm focus:outline-none border border-[#e7e3dd] focus:border-[#6d28d9] text-[#1c1917] bg-white transition-all" />
        </div>
        <div className="flex-[2] space-y-1">
          <label className="text-[9px] font-bold uppercase tracking-wider text-[#78716c]">Reason (optional)</label>
          <input type="text" value={note} onChange={e => setNote(e.target.value)} placeholder="e.g. Sick, vacation, personal"
            className="w-full px-3 py-2 rounded-xl text-sm focus:outline-none border border-[#e7e3dd] focus:border-[#6d28d9] text-[#1c1917] bg-white transition-all" />
        </div>
        <button onClick={handleAdd} disabled={!date || saving}
          className="flex items-center gap-1.5 px-4 py-2 rounded-xl text-xs font-bold text-white transition-all active:scale-95 shrink-0"
          style={{ background: date ? '#6d28d9' : '#e7e3dd', color: date ? 'white' : '#a8a29e', cursor: date ? 'pointer' : 'not-allowed' }}>
          <Plus size={13} /> Add
        </button>
      </div>

      {error && <p className="text-xs text-red-600">{error}</p>}

      {/* List */}
      {tutorTimeOff.length === 0 ? (
        <div className="py-6 rounded-xl border-2 border-dashed border-[#e7e3dd] text-center">
          <CalendarOff size={18} className="mx-auto mb-1.5 text-[#d6d3d1]" />
          <p className="text-[10px] text-[#c4b9b2] font-medium">No time off scheduled</p>
        </div>
      ) : (
        <div className="space-y-2">
          {tutorTimeOff.map(entry => (
            <div key={entry.id} className="flex items-center justify-between px-3 py-2.5 rounded-xl bg-[#faf9f7] border border-[#e7e3dd]">
              <div className="flex items-center gap-3">
                <div className="w-8 h-8 rounded-lg bg-[#ede9fe] flex items-center justify-center shrink-0">
                  <CalendarOff size={13} className="text-[#6d28d9]" />
                </div>
                <div>
                  <p className="text-xs font-bold text-[#1c1917]">
                    {new Date(entry.date + 'T00:00:00').toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })}
                  </p>
                  {entry.note && <p className="text-[10px] text-[#a8a29e]">{entry.note}</p>}
                </div>
              </div>
              <button onClick={() => handleDelete(entry.id)}
                className="w-7 h-7 rounded-lg flex items-center justify-center text-[#a8a29e] hover:text-red-500 hover:bg-red-50 transition-all">
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

const EMPTY_TUTOR: Omit<Tutor, 'id'> = { name: '', subjects: [], cat: 'math', availability: [], availabilityBlocks: [] };

function TutorRow({ tutor, timeOffList, onSave, onDelete, onRefetch }: {
  tutor: Tutor;
  timeOffList: TimeOff[];
  onSave: (u: Tutor) => Promise<void>;
  onDelete: (id: string) => Promise<void>;
  onRefetch: () => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const [tab, setTab] = useState<'details' | 'timeoff'>('details');
  const [draft, setDraft] = useState<Tutor>(tutor);
  const [saving, setSaving] = useState(false);
  const [confirm, setConfirm] = useState(false);

  const dirty = JSON.stringify(tutor.availabilityBlocks) !== JSON.stringify(draft.availabilityBlocks) ||
    tutor.name !== draft.name || tutor.cat !== draft.cat ||
    JSON.stringify(tutor.subjects) !== JSON.stringify(draft.subjects);

  const timeOffCount = timeOffList.filter(t => t.tutor_id === tutor.id).length;

  return (
    <div className="rounded-2xl border overflow-hidden transition-all"
      style={{ borderColor: expanded ? '#c4b5fd' : '#e7e3dd', background: expanded ? '#faf9ff' : 'white' }}>

      {/* Header row */}
      <div className="px-5 py-4 flex items-center gap-3 cursor-pointer select-none" onClick={() => setExpanded(!expanded)}>
        <div className="w-9 h-9 rounded-xl flex items-center justify-center text-xs font-black shrink-0"
          style={{ background: '#ede9fe', color: '#6d28d9' }}>
          {tutor.name.split(' ').map(n => n[0]).join('').slice(0, 2).toUpperCase() || '?'}
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-sm font-bold leading-none text-[#1c1917]">{draft.name || 'Unnamed'}</p>
          <div className="flex items-center gap-2 mt-1">
            <span className="text-[9px] font-bold px-1.5 py-0.5 rounded"
              style={{ background: draft.cat === 'math' ? '#dbeafe' : '#fce7f3', color: draft.cat === 'math' ? '#1d4ed8' : '#be185d' }}>
              {draft.cat === 'math' ? 'Math/Sci' : 'Eng/Hist'}
            </span>
            <span className="text-[10px] truncate max-w-[200px] text-[#a8a29e]">{draft.subjects.join(', ') || 'No subjects'}</span>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {timeOffCount > 0 && (
            <span className="text-[9px] font-bold px-2 py-0.5 rounded-full bg-[#fef3c7] text-[#92400e] border border-[#fcd34d]">
              {timeOffCount} off
            </span>
          )}
          {dirty && <span className="text-[9px] font-semibold px-2 py-0.5 rounded-full bg-[#fef3c7] text-[#92400e]">Unsaved</span>}
          {expanded ? <ChevronUp size={14} className="text-[#a8a29e]" /> : <ChevronDown size={14} className="text-[#a8a29e]" />}
        </div>
      </div>

      {expanded && (
        <div className="border-t border-[#e7e3dd]">
          {/* Tabs */}
          <div className="flex border-b border-[#e7e3dd] bg-white">
            {(['details', 'timeoff'] as const).map(t => (
              <button key={t} onClick={() => setTab(t)}
                className="flex-1 py-3 text-[10px] font-black uppercase tracking-widest transition-all"
                style={{ color: tab === t ? '#6d28d9' : '#a8a29e', borderBottom: tab === t ? '2px solid #6d28d9' : '2px solid transparent' }}>
                {t === 'details' ? 'Details & Availability' : `Time Off ${timeOffCount > 0 ? `(${timeOffCount})` : ''}`}
              </button>
            ))}
          </div>

          <div className="p-5 space-y-5">
            {tab === 'details' ? (
              <>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                  <div className="space-y-1.5">
                    <label className="text-[10px] font-bold uppercase tracking-wider text-[#78716c]">Name</label>
                    <input value={draft.name} onChange={e => setDraft({ ...draft, name: e.target.value })}
                      className="w-full px-3 py-2.5 rounded-xl text-sm focus:outline-none border border-[#e7e3dd] focus:border-[#6d28d9] text-[#1c1917] bg-white transition-all" />
                  </div>
                  <div className="space-y-1.5">
                    <label className="text-[10px] font-bold uppercase tracking-wider text-[#78716c]">Category</label>
                    <div className="flex gap-2">
                      {(['math', 'english'] as const).map(c => (
                        <button key={c} onClick={() => setDraft({ ...draft, cat: c })}
                          className="flex-1 py-2.5 rounded-xl text-xs font-semibold transition-all"
                          style={draft.cat === c ? { background: '#6d28d9', color: 'white', border: '1px solid #6d28d9' } : { background: 'white', color: '#78716c', border: '1px solid #e7e3dd' }}>
                          {c === 'math' ? 'Math / Sci' : 'Eng / Hist'}
                        </button>
                      ))}
                    </div>
                  </div>
                </div>

                <SubjectCheckboxes selected={draft.subjects} onChange={subjects => setDraft({ ...draft, subjects })} />

                <AvailabilityGrid blocks={draft.availabilityBlocks}
                  onChange={b => setDraft({
                    ...draft, availabilityBlocks: b,
                    availability: Array.from(new Set(b.map(x => parseInt(x.split('-')[0])))).sort((a, b) => a - b)
                  })} />

                <div className="flex justify-between items-center pt-1">
                  <button onClick={() => confirm ? onDelete(tutor.id) : setConfirm(true)}
                    className="flex items-center gap-1.5 text-xs font-medium transition-colors"
                    style={{ color: confirm ? '#dc2626' : '#a8a29e' }}>
                    <Trash2 size={13} /> {confirm ? 'Click to confirm delete' : 'Delete tutor'}
                  </button>
                  <button disabled={!dirty || saving}
                    onClick={async () => { setSaving(true); await onSave(draft); setSaving(false); }}
                    className="px-5 py-2 rounded-xl text-xs font-bold transition-all"
                    style={dirty ? { background: '#6d28d9', color: 'white' } : { background: '#f9f7f4', color: '#c4b9b2', cursor: 'not-allowed' }}>
                    {saving ? 'Saving…' : 'Save Changes'}
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
  const [tutors, setTutors] = useState<Tutor[]>([]);
  const [timeOffList, setTimeOffList] = useState<TimeOff[]>([]);
  const [loading, setLoading] = useState(true);
  const [adding, setAdding] = useState(false);
  const [newTutor, setNewTutor] = useState<Omit<Tutor, 'id'>>(EMPTY_TUTOR);
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
        id: r.id, name: r.name, subjects: r.subjects ?? [],
        cat: r.cat, availability: r.availability ?? [], availabilityBlocks: r.availability_blocks ?? [],
      })));
    }
    if (!timeOffRes.error) setTimeOffList(timeOffRes.data ?? []);
    setLoading(false);
  };

  useEffect(() => { fetchAll(); }, []);

  const handleSave = async (updated: Tutor) => {
    setError(null);
    const { error } = await supabase.from('slake_tutors').update({
      name: updated.name, subjects: updated.subjects, cat: updated.cat,
      availability: updated.availability, availability_blocks: updated.availabilityBlocks,
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
      name: newTutor.name, subjects: newTutor.subjects, cat: newTutor.cat,
      availability: newTutor.availability, availability_blocks: newTutor.availabilityBlocks,
    }]);
    setSaving(false);
    if (error) setError(error.message);
    else { setAdding(false); setNewTutor(EMPTY_TUTOR); fetchAll(); }
  };

  if (loading) return (
    <div className="w-full min-h-screen flex items-center justify-center bg-[#faf9f7]">
      <div className="flex flex-col items-center gap-3">
        <Loader2 size={28} className="animate-spin text-[#6d28d9]" />
        <p className="text-[10px] font-black uppercase tracking-widest text-[#a8a29e]">Loading tutors…</p>
      </div>
    </div>
  );

  return (
    <div className="w-full min-h-screen bg-[#faf9f7] pb-20">

      {/* Header */}
      <div className="sticky top-0 z-40 bg-white/90 backdrop-blur-md border-b border-[#e7e3dd]">
        <div className="max-w-3xl mx-auto flex items-center justify-between px-6 py-4">
          <div>
            <h1 className="text-xl font-black uppercase tracking-tighter text-[#1c1917] leading-none">Tutors</h1>
            <p className="text-[9px] font-black text-[#6d28d9] uppercase tracking-widest mt-0.5">
              {tutors.length} tutor{tutors.length !== 1 ? 's' : ''} · Management & Scheduling
            </p>
          </div>
          {!adding && (
            <button onClick={() => setAdding(true)}
              className="flex items-center gap-2 px-4 py-2.5 rounded-xl text-xs font-bold text-white transition-all active:scale-95 shadow-lg shadow-violet-100"
              style={{ background: '#6d28d9' }}
              onMouseEnter={e => e.currentTarget.style.background = '#5b21b6'}
              onMouseLeave={e => e.currentTarget.style.background = '#6d28d9'}>
              <UserPlus size={14} /> Add Tutor
            </button>
          )}
        </div>
      </div>

      <div className="max-w-3xl mx-auto px-6 pt-8 space-y-4">

        {error && (
          <div className="p-3 rounded-xl flex items-center gap-2 text-sm bg-red-50 border border-red-200 text-red-700">
            <AlertTriangle size={14} /> {error}
          </div>
        )}

        {/* Add new tutor form */}
        {adding && (
          <div className="p-6 rounded-2xl border-2 border-[#c4b5fd] bg-white space-y-5">
            <div className="flex items-center justify-between">
              <p className="text-xs font-black uppercase tracking-widest text-[#6d28d9]">New Tutor</p>
              <button onClick={() => { setAdding(false); setNewTutor(EMPTY_TUTOR); }}
                className="w-7 h-7 rounded-lg flex items-center justify-center text-[#a8a29e] hover:bg-[#f0ece8] transition-all">
                <X size={14} />
              </button>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <label className="text-[10px] font-bold uppercase tracking-wider text-[#78716c]">Name</label>
                <input value={newTutor.name} onChange={e => setNewTutor({ ...newTutor, name: e.target.value })}
                  placeholder="Full name"
                  className="w-full px-3 py-2.5 rounded-xl text-sm focus:outline-none border border-[#e7e3dd] focus:border-[#6d28d9] text-[#1c1917] bg-[#faf9f7] transition-all" />
              </div>
              <div className="space-y-1.5">
                <label className="text-[10px] font-bold uppercase tracking-wider text-[#78716c]">Category</label>
                <div className="flex gap-2">
                  {(['math', 'english'] as const).map(c => (
                    <button key={c} onClick={() => setNewTutor({ ...newTutor, cat: c })}
                      className="flex-1 py-2.5 rounded-xl text-xs font-semibold transition-all"
                      style={newTutor.cat === c ? { background: '#6d28d9', color: 'white', border: '1px solid #6d28d9' } : { background: 'white', color: '#78716c', border: '1px solid #e7e3dd' }}>
                      {c === 'math' ? 'Math / Sci' : 'Eng / Hist'}
                    </button>
                  ))}
                </div>
              </div>
            </div>
            <SubjectCheckboxes selected={newTutor.subjects} onChange={subjects => setNewTutor({ ...newTutor, subjects })} />
            <AvailabilityGrid blocks={newTutor.availabilityBlocks}
              onChange={b => setNewTutor({
                ...newTutor, availabilityBlocks: b,
                availability: Array.from(new Set(b.map(x => parseInt(x.split('-')[0])))).sort((a, b) => a - b)
              })} />
            <div className="flex gap-2 pt-1">
              <button onClick={() => { setAdding(false); setNewTutor(EMPTY_TUTOR); }}
                className="flex-1 py-2.5 rounded-xl text-xs font-medium text-[#78716c] border border-[#e7e3dd] bg-[#faf9f7]">
                Cancel
              </button>
              <button onClick={handleAdd} disabled={saving || !newTutor.name}
                className="flex-[2] py-2.5 rounded-xl text-xs font-bold text-white transition-all active:scale-95"
                style={{ background: newTutor.name ? '#6d28d9' : '#e7e3dd', color: newTutor.name ? 'white' : '#a8a29e' }}>
                {saving ? 'Adding…' : 'Add to Database'}
              </button>
            </div>
          </div>
        )}

        {/* Tutor list */}
        {tutors.map(t => (
          <TutorRow key={t.id} tutor={t} timeOffList={timeOffList} onSave={handleSave} onDelete={handleDelete} onRefetch={fetchAll} />
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