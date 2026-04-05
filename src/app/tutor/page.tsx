"use client";

import React, { useState, useEffect } from 'react';
import { X, Trash2, UserPlus, ChevronDown, ChevronUp, AlertTriangle, CalendarOff, Plus, Loader2, Mail, Phone, Save } from 'lucide-react';
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
  { group: 'Math & Science', subjects: ['Algebra', 'Geometry', 'Precalculus', 'Calculus', 'Statistics', 'Biology', 'Chemistry', 'Physics'] },
  { group: 'English & Humanities', subjects: ['English/Writing', 'Literature', 'History', 'Geography'] },
  { group: 'Test Prep', subjects: ['SAT Math', 'SAT Reading', 'ACT Math', 'ACT English', 'ACT Science'] },
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

const inputCls = "w-full px-3 py-2.5 rounded-xl text-sm border border-[#e2e8f0] bg-[#f8fafc] text-[#0f172a] placeholder:text-[#94a3b8] focus:outline-none focus:border-[#dc2626] focus:ring-2 focus:ring-[#fecdd3] transition-all";

function initials(name: string) {
  return name.split(' ').map(n => n[0]).join('').slice(0, 2).toUpperCase() || '?';
}

// ── Subject Pills ─────────────────────────────────────────────────────────────
function SubjectCheckboxes({ selected, onChange }: { selected: string[]; onChange: (s: string[]) => void }) {
  const toggle = (s: string) =>
    onChange(selected.includes(s) ? selected.filter(x => x !== s) : [...selected, s]);

  return (
    <div className="space-y-1.5">
      <label className="block text-[10px] font-black uppercase tracking-widest text-[#64748b]">Subjects</label>
      <div className="space-y-3">
        {SUBJECT_GROUPS.map(group => (
          <div key={group.group}>
            <p className="text-[9px] font-bold uppercase tracking-widest mb-2 text-[#94a3b8]">{group.group}</p>
            <div className="flex flex-wrap gap-1.5">
              {group.subjects.map(subject => {
                const active = selected.includes(subject);
                return (
                  <button key={subject} type="button" onClick={() => toggle(subject)}
                    className="px-2.5 py-1 rounded-lg text-[11px] font-semibold transition-all"
                    style={active
                      ? { background: '#dc2626', color: 'white', border: '1.5px solid #dc2626' }
                      : { background: 'white', color: '#475569', border: '1.5px solid #e2e8f0' }}>
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
    <div className="space-y-1.5">
      <label className="block text-[10px] font-black uppercase tracking-widest text-[#64748b]">Availability</label>
      <div className="rounded-xl border border-[#e2e8f0] overflow-hidden">
        <table className="w-full border-collapse">
          <thead>
            <tr style={{ background: '#1e293b' }}>
              <th className="px-3 py-2.5 text-left text-[10px] font-black uppercase tracking-widest text-[#94a3b8] border-r border-[#334155]">Session</th>
              {ACTIVE_DAYS_INFO.map(d => (
                <th key={d.dow} className="px-2 py-2.5 text-center text-[10px] font-black uppercase tracking-widest text-[#94a3b8]">{d.label}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {SESSION_BLOCKS.map((block, bi) => (
              <tr key={block.id} style={{ borderBottom: bi < SESSION_BLOCKS.length - 1 ? '1px solid #f1f5f9' : 'none', background: bi % 2 === 0 ? 'white' : '#fafafa' }}>
                <td className="px-3 py-2.5 border-r border-[#e2e8f0]">
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
                          className="w-8 h-8 rounded-lg mx-auto flex items-center justify-center transition-all"
                          style={{
                            background: active ? '#dc2626' : 'white',
                            border: `1.5px solid ${active ? '#dc2626' : '#e2e8f0'}`,
                          }}>
                          {active && <span className="text-white text-[10px] font-black">✓</span>}
                        </button>
                      ) : (
                        <div className="w-8 h-8 rounded-lg mx-auto" style={{ background: '#f1f5f9' }} />
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
      <div className="flex gap-2 items-end">
        <div className="flex-1 space-y-1.5">
          <label className="block text-[10px] font-black uppercase tracking-widest text-[#64748b]">Date</label>
          <input type="date" value={date} onChange={e => setDate(e.target.value)} className={inputCls} />
        </div>
        <div className="flex-[2] space-y-1.5">
          <label className="block text-[10px] font-black uppercase tracking-widest text-[#64748b]">Reason (optional)</label>
          <input value={note} onChange={e => setNote(e.target.value)} placeholder="e.g. Sick, vacation" className={inputCls} />
        </div>
        <button onClick={handleAdd} disabled={!date || saving}
          className="flex items-center gap-1.5 px-4 py-2.5 rounded-xl text-xs font-black mb-0.5 transition-all active:scale-95"
          style={{ background: date ? '#dc2626' : '#e2e8f0', color: date ? 'white' : '#94a3b8', cursor: date ? 'pointer' : 'not-allowed' }}>
          {saving ? <Loader2 size={12} className="animate-spin" /> : <Plus size={13} />} Add
        </button>
      </div>

      {tutorTimeOff.length === 0 ? (
        <div className="py-8 rounded-xl border-2 border-dashed border-[#e2e8f0] text-center bg-[#f8fafc]">
          <CalendarOff size={18} className="mx-auto mb-2 text-[#cbd5e1]" />
          <p className="text-[10px] font-semibold text-[#94a3b8]">No time off scheduled</p>
        </div>
      ) : (
        <div className="space-y-2">
          {tutorTimeOff.map(entry => (
            <div key={entry.id} className="flex items-center justify-between px-4 py-3 rounded-xl"
              style={{ background: '#f8fafc', border: '1px solid #e2e8f0' }}>
              <div className="flex items-center gap-3">
                <div className="w-7 h-7 rounded-lg flex items-center justify-center" style={{ background: '#fef2f2' }}>
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
                className="w-7 h-7 rounded-lg flex items-center justify-center text-[#cbd5e1] hover:text-[#dc2626] hover:bg-[#fef2f2] transition-all">
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
function TutorRow({ tutor, timeOffList, onSave, onDelete, onRefetch }: {
  tutor: TutorWithContact; timeOffList: TimeOff[];
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
    tutor.name !== draft.name || tutor.cat !== draft.cat ||
    tutor.email !== draft.email || tutor.phone !== draft.phone ||
    JSON.stringify(tutor.subjects) !== JSON.stringify(draft.subjects) ||
    JSON.stringify(tutor.availabilityBlocks) !== JSON.stringify(draft.availabilityBlocks);

  const timeOffCount = timeOffList.filter(t => t.tutor_id === tutor.id).length;

  return (
    <div className="rounded-2xl overflow-hidden transition-all"
      style={{ border: expanded ? '1.5px solid #fca5a5' : '1.5px solid #e2e8f0', boxShadow: expanded ? '0 4px 16px rgba(220,38,38,0.08)' : '0 1px 4px rgba(0,0,0,0.04)' }}>

      {/* Header */}
      <div className="px-5 py-4 flex items-center gap-3 cursor-pointer select-none bg-white"
        style={{ background: expanded ? '#fff5f5' : 'white' }}
        onClick={() => setExpanded(e => !e)}>

        <div className="w-10 h-10 rounded-xl flex items-center justify-center text-sm font-black text-white shrink-0"
          style={{ background: '#dc2626' }}>
          {initials(draft.name)}
        </div>

        <div className="flex-1 min-w-0">
          <p className="text-sm font-black text-[#0f172a] leading-none">{draft.name || 'Unnamed'}</p>
          <div className="flex items-center gap-2 mt-1.5 flex-wrap">
            <span className="text-[9px] font-black px-2 py-0.5 rounded-md"
              style={draft.cat === 'math'
                ? { background: '#dbeafe', color: '#1d4ed8' }
                : { background: '#fce7f3', color: '#be185d' }}>
              {draft.cat === 'math' ? 'Math / Sci' : 'Eng / Hist'}
            </span>
            {draft.subjects.length > 0 && (
              <span className="text-[10px] text-[#64748b] truncate max-w-[240px]">{draft.subjects.join(', ')}</span>
            )}
          </div>
          {draft.email && (
            <p className="text-[10px] text-[#94a3b8] mt-0.5 flex items-center gap-1">
              <Mail size={9} /> {draft.email}
            </p>
          )}
        </div>

        <div className="flex items-center gap-2 shrink-0">
          {timeOffCount > 0 && (
            <span className="text-[9px] font-black px-2 py-0.5 rounded-full"
              style={{ background: '#fef3c7', color: '#d97706', border: '1px solid #fde68a' }}>
              {timeOffCount} off
            </span>
          )}
          {dirty && (
            <span className="text-[9px] font-black px-2 py-0.5 rounded-full"
              style={{ background: '#fef2f2', color: '#dc2626', border: '1px solid #fecaca' }}>
              Unsaved
            </span>
          )}
          {expanded ? <ChevronUp size={14} className="text-[#94a3b8]" /> : <ChevronDown size={14} className="text-[#94a3b8]" />}
        </div>
      </div>

      {expanded && (
        <div style={{ borderTop: '1px solid #f1f5f9' }}>
          {/* Tabs */}
          <div className="flex" style={{ background: '#f8fafc', borderBottom: '1px solid #e2e8f0' }}>
            {(['details', 'timeoff'] as const).map(t => (
              <button key={t} onClick={() => setTab(t)}
                className="flex-1 py-3 text-[10px] font-black uppercase tracking-widest transition-all"
                style={{
                  color: tab === t ? '#dc2626' : '#94a3b8',
                  borderBottom: tab === t ? '2px solid #dc2626' : '2px solid transparent',
                  background: 'transparent',
                }}>
                {t === 'details' ? 'Details & Availability' : `Time Off${timeOffCount > 0 ? ` (${timeOffCount})` : ''}`}
              </button>
            ))}
          </div>

          <div className="p-5 bg-white space-y-5">
            {tab === 'details' ? (
              <>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div className="space-y-1.5">
                    <label className="block text-[10px] font-black uppercase tracking-widest text-[#64748b]">Name</label>
                    <input value={draft.name} onChange={e => setDraft({ ...draft, name: e.target.value })}
                      placeholder="Full name" className={inputCls} />
                  </div>
                  <div className="space-y-1.5">
                    <label className="block text-[10px] font-black uppercase tracking-widest text-[#64748b]">Category</label>
                    <div className="flex gap-2">
                      {(['math', 'english'] as const).map(c => (
                        <button key={c} onClick={() => setDraft({ ...draft, cat: c })}
                          className="flex-1 py-2.5 rounded-xl text-xs font-black transition-all"
                          style={draft.cat === c
                            ? { background: '#dc2626', color: 'white', border: '1.5px solid #dc2626' }
                            : { background: 'white', color: '#475569', border: '1.5px solid #e2e8f0' }}>
                          {c === 'math' ? 'Math / Sci' : 'Eng / Hist'}
                        </button>
                      ))}
                    </div>
                  </div>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div className="space-y-1.5">
                    <label className="block text-[10px] font-black uppercase tracking-widest text-[#64748b]">Email</label>
                    <div className="relative">
                      <Mail size={13} className="absolute left-3 top-1/2 -translate-y-1/2 text-[#94a3b8]" />
                      <input type="email" value={draft.email ?? ''} onChange={e => setDraft({ ...draft, email: e.target.value })}
                        placeholder="tutor@email.com"
                        className="w-full pl-8 pr-3 py-2.5 rounded-xl text-sm border border-[#e2e8f0] bg-[#f8fafc] text-[#0f172a] placeholder:text-[#94a3b8] focus:outline-none focus:border-[#dc2626] focus:ring-2 focus:ring-[#fecdd3] transition-all" />
                    </div>
                  </div>
                  <div className="space-y-1.5">
                    <label className="block text-[10px] font-black uppercase tracking-widest text-[#64748b]">Phone</label>
                    <div className="relative">
                      <Phone size={13} className="absolute left-3 top-1/2 -translate-y-1/2 text-[#94a3b8]" />
                      <input type="tel" value={draft.phone ?? ''} onChange={e => setDraft({ ...draft, phone: e.target.value })}
                        placeholder="(555) 000-0000"
                        className="w-full pl-8 pr-3 py-2.5 rounded-xl text-sm border border-[#e2e8f0] bg-[#f8fafc] text-[#0f172a] placeholder:text-[#94a3b8] focus:outline-none focus:border-[#dc2626] focus:ring-2 focus:ring-[#fecdd3] transition-all" />
                    </div>
                  </div>
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

                <div className="flex justify-between items-center pt-2 border-t border-[#f1f5f9]">
                  <button
                    onClick={() => confirmDelete ? onDelete(tutor.id) : setConfirmDelete(true)}
                    onBlur={() => setConfirmDelete(false)}
                    className="flex items-center gap-1.5 text-xs font-semibold transition-all px-3 py-2 rounded-lg"
                    style={{ color: confirmDelete ? '#dc2626' : '#94a3b8', background: confirmDelete ? '#fef2f2' : 'transparent' }}>
                    <Trash2 size={12} />
                    {confirmDelete ? 'Confirm delete?' : 'Delete tutor'}
                  </button>
                  <button
                    disabled={!dirty || saving}
                    onClick={async () => { setSaving(true); await onSave(draft); setSaving(false); }}
                    className="flex items-center gap-2 px-5 py-2.5 rounded-xl text-xs font-black transition-all active:scale-95"
                    style={dirty
                      ? { background: '#dc2626', color: 'white', boxShadow: '0 2px 8px rgba(220,38,38,0.25)' }
                      : { background: '#f1f5f9', color: '#94a3b8', cursor: 'not-allowed' }}>
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

// ── Main Page ─────────────────────────────────────────────────────────────────
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

  if (loading) return (
    <div className="w-full min-h-screen flex items-center justify-center" style={{ background: '#f8fafc' }}>
      <div className="flex flex-col items-center gap-3">
        <Loader2 size={24} className="animate-spin" style={{ color: '#dc2626' }} />
        <p className="text-[10px] font-black uppercase tracking-widest" style={{ color: '#94a3b8' }}>Loading tutors…</p>
      </div>
    </div>
  );

  return (
    <div className="w-full min-h-screen pb-20" style={{ background: '#f8fafc' }}>

      {/* Header */}
      <div className="sticky top-0 z-40 bg-white border-b border-[#f1f5f9]"
        style={{ boxShadow: '0 1px 3px rgba(0,0,0,0.06)' }}>
        <div className="max-w-3xl mx-auto flex items-center justify-between px-6 py-4">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-xl flex items-center justify-center" style={{ background: '#dc2626' }}>
              <UserPlus size={15} className="text-white" />
            </div>
            <div>
              <h1 className="text-sm font-black text-[#0f172a] leading-none">Tutors</h1>
              <p className="text-[9px] font-bold uppercase tracking-widest mt-0.5" style={{ color: '#dc2626' }}>
                {tutors.length} tutor{tutors.length !== 1 ? 's' : ''}
              </p>
            </div>
          </div>
          <button
            onClick={() => { setAdding(a => !a); setNewTutor(EMPTY_TUTOR); }}
            className="flex items-center gap-2 px-4 py-2.5 rounded-xl text-xs font-black text-white transition-all active:scale-95"
            style={{ background: adding ? '#64748b' : '#dc2626', boxShadow: adding ? 'none' : '0 2px 8px rgba(220,38,38,0.25)' }}>
            {adding ? <><X size={13} /> Cancel</> : <><UserPlus size={13} /> Add Tutor</>}
          </button>
        </div>
      </div>

      <div className="max-w-3xl mx-auto px-6 pt-6 space-y-3">

        {error && (
          <div className="p-3 rounded-xl flex items-center gap-2 text-sm"
            style={{ background: '#fef2f2', border: '1px solid #fecaca', color: '#dc2626' }}>
            <AlertTriangle size={14} className="shrink-0" /> {error}
          </div>
        )}

        {/* Add new tutor */}
        {adding && (
          <div className="p-6 rounded-2xl bg-white space-y-5"
            style={{ border: '1.5px solid #fca5a5', boxShadow: '0 4px 16px rgba(220,38,38,0.08)' }}>
            <div className="flex items-center gap-2">
              <div className="w-1 h-4 rounded-full" style={{ background: '#dc2626' }} />
              <p className="text-[10px] font-black uppercase tracking-widest" style={{ color: '#dc2626' }}>New Tutor</p>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <label className="block text-[10px] font-black uppercase tracking-widest text-[#64748b]">Name</label>
                <input value={newTutor.name} onChange={e => setNewTutor({ ...newTutor, name: e.target.value })}
                  placeholder="Full name" className={inputCls} />
              </div>
              <div className="space-y-1.5">
                <label className="block text-[10px] font-black uppercase tracking-widest text-[#64748b]">Category</label>
                <div className="flex gap-2">
                  {(['math', 'english'] as const).map(c => (
                    <button key={c} onClick={() => setNewTutor({ ...newTutor, cat: c })}
                      className="flex-1 py-2.5 rounded-xl text-xs font-black transition-all"
                      style={newTutor.cat === c
                        ? { background: '#dc2626', color: 'white', border: '1.5px solid #dc2626' }
                        : { background: 'white', color: '#475569', border: '1.5px solid #e2e8f0' }}>
                      {c === 'math' ? 'Math / Sci' : 'Eng / Hist'}
                    </button>
                  ))}
                </div>
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <label className="block text-[10px] font-black uppercase tracking-widest text-[#64748b]">Email</label>
                <div className="relative">
                  <Mail size={13} className="absolute left-3 top-1/2 -translate-y-1/2 text-[#94a3b8]" />
                  <input type="email" value={newTutor.email ?? ''} onChange={e => setNewTutor({ ...newTutor, email: e.target.value })}
                    placeholder="tutor@email.com"
                    className="w-full pl-8 pr-3 py-2.5 rounded-xl text-sm border border-[#e2e8f0] bg-[#f8fafc] text-[#0f172a] placeholder:text-[#94a3b8] focus:outline-none focus:border-[#dc2626] focus:ring-2 focus:ring-[#fecdd3] transition-all" />
                </div>
              </div>
              <div className="space-y-1.5">
                <label className="block text-[10px] font-black uppercase tracking-widest text-[#64748b]">Phone</label>
                <div className="relative">
                  <Phone size={13} className="absolute left-3 top-1/2 -translate-y-1/2 text-[#94a3b8]" />
                  <input type="tel" value={newTutor.phone ?? ''} onChange={e => setNewTutor({ ...newTutor, phone: e.target.value })}
                    placeholder="(555) 000-0000"
                    className="w-full pl-8 pr-3 py-2.5 rounded-xl text-sm border border-[#e2e8f0] bg-[#f8fafc] text-[#0f172a] placeholder:text-[#94a3b8] focus:outline-none focus:border-[#dc2626] focus:ring-2 focus:ring-[#fecdd3] transition-all" />
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

            <div className="flex gap-2 pt-2 border-t border-[#f1f5f9]">
              <button onClick={() => { setAdding(false); setNewTutor(EMPTY_TUTOR); }}
                className="px-4 py-2.5 rounded-xl text-xs font-semibold transition-all"
                style={{ background: '#f1f5f9', color: '#475569', border: '1px solid #e2e8f0' }}>
                Cancel
              </button>
              <button onClick={handleAdd} disabled={saving || !newTutor.name.trim()}
                className="flex-1 flex items-center justify-center gap-2 py-2.5 rounded-xl text-xs font-black transition-all active:scale-95"
                style={{
                  background: newTutor.name.trim() ? '#dc2626' : '#f1f5f9',
                  color: newTutor.name.trim() ? 'white' : '#94a3b8',
                  boxShadow: newTutor.name.trim() ? '0 2px 8px rgba(220,38,38,0.2)' : 'none',
                }}>
                {saving ? <><Loader2 size={12} className="animate-spin" /> Adding…</> : <><UserPlus size={12} /> Add to Database</>}
              </button>
            </div>
          </div>
        )}

        {/* Tutor list */}
        {tutors.length === 0 && !adding ? (
          <div className="py-24 text-center bg-white rounded-2xl" style={{ border: '1.5px dashed #e2e8f0' }}>
            <UserPlus size={28} className="mx-auto mb-3 text-[#cbd5e1]" />
            <p className="text-sm font-bold text-[#94a3b8]">No tutors yet</p>
            <p className="text-xs text-[#cbd5e1] mt-1">Add one above to get started</p>
          </div>
        ) : (
          tutors.map(t => (
            <TutorRow key={t.id} tutor={t} timeOffList={timeOffList}
              onSave={handleSave} onDelete={handleDelete} onRefetch={fetchAll} />
          ))
        )}
      </div>
    </div>
  );
}