"use client"
import React, { useEffect, useMemo, useState } from 'react';
import { X, Trash2, UserPlus, ChevronDown, ChevronUp, AlertTriangle } from 'lucide-react';
import { SESSION_BLOCKS } from '@/components/constants';
import { supabase } from '@/lib/supabaseClient';
import { DB } from '@/lib/db';
import type { Tutor } from '@/lib/useScheduleData';

type TermOption = {
  id: string;
  name: string;
  status?: string | null;
}




// ─── Subject definitions (fallback defaults) ─────────────────────────────────

const DEFAULT_SUBJECTS = [
  'Algebra', 'Geometry', 'Precalculus', 'Calculus', 'Statistics', 'IB Math', 'Biology', 'Chemistry', 'Physics',
  'English/Writing', 'Literature', 'History', 'Geography', 'Psychology',
  'SAT Math', 'SAT R/W', 'ACT Math', 'ACT English', 'ACT Science',
  'AP Physics C Mechanics', 'AP Physics C E&M', 'AP Environmental Science', 'AP Statistics',
];

export const SUBJECT_GROUPS = [
  {
    group: 'Math & Science',
    subjects: ['Algebra', 'Geometry', 'Precalculus', 'Calculus', 'Statistics', 'IB Math', 'Biology', 'Chemistry', 'Physics'],
  },
  {
    group: 'English & Humanities',
    subjects: ['English/Writing', 'Literature', 'History', 'Geography', 'Psychology'],
  },
  {
    group: 'Test Prep',
    subjects: ['SAT Math', 'SAT R/W', 'ACT Math', 'ACT English', 'ACT Science'],
  },
  {
    group: 'AP',
    subjects: ['AP Physics C Mechanics', 'AP Physics C E&M', 'AP Environmental Science', 'AP Statistics'],
  },
];

export const ALL_SUBJECTS = SUBJECT_GROUPS.flatMap(g => g.subjects);

// ─── Subject Checkboxes ───────────────────────────────────────────────────────

function SubjectCheckboxes({ selected, onChange, subjects }: { selected: string[]; onChange: (s: string[]) => void; subjects: string[] }) {
  const toggle = (subject: string) => {
    onChange(selected.includes(subject)
      ? selected.filter(s => s !== subject)
      : [...selected, subject]
    );
  };

  return (
    <div className="space-y-2">
      <p className="text-xs font-semibold uppercase tracking-wider" style={{ color: '#a8a29e' }}>Subjects</p>
      <div className="flex flex-wrap gap-2">
        {subjects.map(subject => {
          const active = selected.includes(subject);
          return (
            <button
              key={subject}
              type="button"
              onClick={() => toggle(subject)}
              className="px-2.5 py-1 rounded-lg text-[11px] font-semibold transition-all"
              style={active
                ? { background: '#6d28d9', color: 'white', border: '1px solid #6d28d9' }
                : { background: 'white', color: '#78716c', border: '1px solid #e7e3dd' }
              }
            >
              {subject}
            </button>
          );
        })}
      </div>
    </div>
  );
}

// ─── Availability Grid (session-based) ───────────────────────────────────────

const ACTIVE_DAYS_INFO = [
  { dow: 1, label: 'Mon' },
  { dow: 2, label: 'Tue' },
  { dow: 3, label: 'Wed' },
  { dow: 4, label: 'Thu' },
  { dow: 6, label: 'Sat' },
];

function AvailabilityGrid({ blocks, onChange }: { blocks: string[]; onChange: (b: string[]) => void }) {
  const toggle = (d: number, t: string) => {
    const key = `${d}-${t}`;
    onChange(blocks.includes(key) ? blocks.filter(b => b !== key) : [...blocks, key]);
  };

  return (
    <div className="space-y-2">
      <p className="text-xs font-semibold uppercase tracking-wider" style={{ color: '#a8a29e' }}>Availability</p>
      <div className="rounded-xl border overflow-hidden" style={{ borderColor: '#e7e3dd' }}>
        <table className="w-full border-collapse">
          <thead>
            <tr style={{ background: '#faf9f7', borderBottom: '1px solid #e7e3dd' }}>
              <th className="p-2 text-left text-[10px] font-bold uppercase" style={{ color: '#78716c', borderRight: '1px solid #e7e3dd', minWidth: 120 }}>Session</th>
              {ACTIVE_DAYS_INFO.map(d => (
                <th key={d.dow} className="p-2 text-center text-[10px] font-bold uppercase" style={{ color: '#78716c', borderLeft: '1px solid #f0ece8' }}>{d.label}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {SESSION_BLOCKS.map((block, bi) => (
              <tr key={block.id} style={{ borderBottom: bi < SESSION_BLOCKS.length - 1 ? '1px solid #f0ece8' : 'none' }}>
                <td className="px-3 py-2" style={{ background: '#faf9f7', borderRight: '1px solid #e7e3dd' }}>
                  <div className="text-[10px] font-bold" style={{ color: '#1c1917' }}>{block.label}</div>
                  <div className="text-[9px]" style={{ color: '#a8a29e' }}>{block.display}</div>
                </td>
                {ACTIVE_DAYS_INFO.map(d => {
                  // Only show a cell if this session block runs on this day
                  const applicable = block.days.includes(d.dow);
                  const active = applicable && blocks.includes(`${d.dow}-${block.time}`);
                  return (
                    <td key={d.dow} className="p-1 text-center" style={{ borderLeft: '1px solid #f0ece8' }}>
                      {applicable ? (
                        <button type="button" onClick={() => toggle(d.dow, block.time)}
                          className="w-8 h-8 rounded-lg mx-auto flex items-center justify-center transition-all"
                          style={{ background: active ? '#6d28d9' : 'white', border: `1.5px solid ${active ? '#6d28d9' : '#e7e3dd'}` }}
                          onMouseEnter={e => { if (!active) e.currentTarget.style.background = '#f5f3ff'; }}
                          onMouseLeave={e => { if (!active) e.currentTarget.style.background = 'white'; }}
                        >
                          {active && <span style={{ color: 'white', fontSize: 10, fontWeight: 700 }}>✓</span>}
                        </button>
                      ) : (
                        <div className="w-8 h-8 rounded-lg mx-auto" style={{ background: '#f0ece8' }} />
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

// ─── Tutor Row ────────────────────────────────────────────────────────────────

const EMPTY_TUTOR: Omit<Tutor, 'id'> = {
  name: '', subjects: [], cat: 'math', availability: [], availabilityBlocks: [], email: null,
};

function TutorRow({ tutor, onSave, onDelete, centerSubjects }: { tutor: Tutor; onSave: (u: Tutor) => Promise<void>; onDelete: (id: string) => Promise<void>; centerSubjects: string[] }) {
  const [expanded, setExpanded] = useState(false);
  const [draft, setDraft] = useState<Tutor>(tutor);
  const [saving, setSaving] = useState(false);
  const [confirm, setConfirm] = useState(false);

  const dirty = JSON.stringify(tutor.availabilityBlocks) !== JSON.stringify(draft.availabilityBlocks) ||
    tutor.name !== draft.name || tutor.cat !== draft.cat ||
    JSON.stringify(tutor.subjects) !== JSON.stringify(draft.subjects);

  return (
    <div className="rounded-xl border overflow-hidden transition-all" style={{ borderColor: expanded ? '#c4b5fd' : '#e7e3dd', background: expanded ? '#faf9ff' : 'white' }}>
      <div className="px-4 py-3.5 flex items-center gap-3 cursor-pointer select-none" onClick={() => setExpanded(!expanded)}>
        <div className="w-8 h-8 rounded-full flex items-center justify-center text-xs font-bold shrink-0" style={{ background: '#ede9fe', color: '#6d28d9' }}>
          {tutor.name.split(' ').map(n => n[0]).join('').slice(0, 2).toUpperCase() || '?'}
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-sm font-semibold leading-none" style={{ color: '#1c1917' }}>{draft.name || 'Unnamed'}</p>
          <div className="flex items-center gap-2 mt-1">
            <span className="text-[9px] font-semibold px-1.5 py-0.5 rounded" style={{ background: draft.cat === 'math' ? '#dbeafe' : '#fce7f3', color: draft.cat === 'math' ? '#1d4ed8' : '#be185d' }}>
              {draft.cat === 'math' ? 'Math/Sci' : 'Eng/Hist'}
            </span>
            <span className="text-[10px] truncate max-w-[200px]" style={{ color: '#a8a29e' }}>{draft.subjects.join(', ') || 'No subjects'}</span>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {dirty && <span className="text-[9px] font-semibold px-2 py-0.5 rounded-full" style={{ background: '#fef3c7', color: '#92400e' }}>Unsaved</span>}
          {expanded ? <ChevronUp size={14} style={{ color: '#a8a29e' }} /> : <ChevronDown size={14} style={{ color: '#a8a29e' }} />}
        </div>
      </div>

      {expanded && (
        <div className="px-4 pb-4 space-y-4 border-t" style={{ borderColor: '#e7e3dd' }}>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3 pt-4">
            <div className="space-y-1.5">
              <label className="text-xs font-medium" style={{ color: '#78716c' }}>Name</label>
              <input value={draft.name} onChange={e => setDraft({ ...draft, name: e.target.value })}
                className="w-full px-3 py-2.5 rounded-xl text-sm focus:outline-none"
                style={{ background: 'white', border: '1px solid #e7e3dd', color: '#1c1917' }}
                onFocus={e => e.currentTarget.style.borderColor = '#6d28d9'}
                onBlur={e => e.currentTarget.style.borderColor = '#e7e3dd'}
              />
            </div>
            <div className="space-y-1.5">
              <label className="text-xs font-medium" style={{ color: '#78716c' }}>Category</label>
              <div className="flex gap-2">
                {(['math', 'english'] as const).map(c => (
                  <button key={c} onClick={() => setDraft({ ...draft, cat: c })}
                    className="flex-1 py-2.5 rounded-xl text-xs font-semibold transition-all"
                    style={draft.cat === c ? { background: '#6d28d9', color: 'white', border: '1px solid #6d28d9' } : { background: 'white', color: '#78716c', border: '1px solid #e7e3dd' }}
                  >{c === 'math' ? 'Math / Sci' : 'Eng / Hist'}</button>
                ))}
              </div>
            </div>
          </div>

          <SubjectCheckboxes
            selected={draft.subjects}
            onChange={subjects => setDraft({ ...draft, subjects })}
            subjects={centerSubjects}
          />

          <AvailabilityGrid blocks={draft.availabilityBlocks}
            onChange={b => setDraft({ ...draft, availabilityBlocks: b, availability: Array.from(new Set(b.map(x => parseInt(x.split('-')[0])))).sort((a, b) => a - b) })}
          />

          <div className="flex justify-between items-center pt-1">
            <button onClick={() => confirm ? onDelete(tutor.id) : setConfirm(true)}
              className="flex items-center gap-1.5 text-xs font-medium transition-colors"
              style={{ color: confirm ? '#dc2626' : '#a8a29e' }}
            >
              <Trash2 size={13} /> {confirm ? 'Click to confirm' : 'Delete tutor'}
            </button>
            <button disabled={!dirty || saving} onClick={async () => { setSaving(true); await onSave(draft); setSaving(false); }}
              className="px-5 py-2 rounded-xl text-xs font-semibold transition-all"
              style={dirty ? { background: '#6d28d9', color: 'white', border: '1px solid #6d28d9' } : { background: '#f9f7f4', color: '#c4b9b2', border: '1px solid #e7e3dd', cursor: 'not-allowed' }}
            >{saving ? 'Saving…' : 'Save Changes'}</button>
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Main Modal ───────────────────────────────────────────────────────────────

export function TutorManagementModal({
  tutors,
  terms,
  selectedTermId,
  onSelectTerm,
  onClose,
  onRefetch,
}: {
  tutors: Tutor[];
  terms: TermOption[];
  selectedTermId: string;
  onSelectTerm: (termId: string) => void;
  onClose: () => void;
  onRefetch: () => void;
}) {
  const [adding, setAdding] = useState(false);
  const [newTutor, setNewTutor] = useState<Omit<Tutor, 'id'>>(EMPTY_TUTOR);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loadingTermAvailability, setLoadingTermAvailability] = useState(false);
  const [termAvailabilityByTutor, setTermAvailabilityByTutor] = useState<Record<string, string[]>>({});
  const [centerSubjects, setCenterSubjects] = useState<string[]>(DEFAULT_SUBJECTS);

  useEffect(() => {
    let cancelled = false;
    fetch('/api/center-subjects')
      .then(r => r.json())
      .then(d => { if (!cancelled && Array.isArray(d?.subjects)) setCenterSubjects(d.subjects); })
      .catch(() => {});
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    let cancelled = false;

    async function loadTermAvailability() {
      if (!selectedTermId) {
        setTermAvailabilityByTutor({});
        return;
      }

      setLoadingTermAvailability(true);
      try {
        const res = await fetch(`/api/tutor-availability?termId=${encodeURIComponent(selectedTermId)}`, {
          cache: 'no-store',
        });
        const payload = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(payload?.error || 'Failed to load term tutor availability');

        const rows = Array.isArray(payload?.overrides) ? payload.overrides : [];
        const map = rows.reduce((acc: Record<string, string[]>, row: any) => {
          if (row?.tutor_id && Array.isArray(row?.availability_blocks)) {
            acc[row.tutor_id] = row.availability_blocks;
          }
          return acc;
        }, {});

        if (!cancelled) setTermAvailabilityByTutor(map);
      } catch (err: any) {
        if (!cancelled) {
          setTermAvailabilityByTutor({});
          setError(err?.message || 'Failed to load term tutor availability');
        }
      } finally {
        if (!cancelled) setLoadingTermAvailability(false);
      }
    }

    void loadTermAvailability();
    return () => { cancelled = true; };
  }, [selectedTermId]);

  const effectiveTutors = useMemo(() => {
    return tutors.map(tutor => {
      const termBlocks = termAvailabilityByTutor[tutor.id];
      if (!selectedTermId || !Array.isArray(termBlocks)) return tutor;

      const availability = Array.from(new Set(
        termBlocks
          .map(block => {
            const [dow] = block.split('-');
            const parsed = Number(dow);
            return Number.isFinite(parsed) ? parsed : null;
          })
          .filter((value): value is number => value !== null)
      )).sort((a, b) => a - b);

      return {
        ...tutor,
        availabilityBlocks: termBlocks,
        availability,
      };
    });
  }, [tutors, selectedTermId, termAvailabilityByTutor]);

  const handleSave = async (updated: Tutor) => {
    setError(null);
    const { error: tutorUpdateError } = await supabase
      .from(DB.tutors)
      .update({
        name: updated.name,
        subjects: updated.subjects,
        cat: updated.cat,
        ...(selectedTermId
          ? {}
          : {
              availability: updated.availability,
              availability_blocks: updated.availabilityBlocks,
            }),
      })
      .eq('id', updated.id);

    if (tutorUpdateError) {
      setError(tutorUpdateError.message);
      return;
    }

    if (selectedTermId) {
      const res = await fetch('/api/tutor-availability', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          tutorId: updated.id,
          termId: selectedTermId,
          availabilityBlocks: updated.availabilityBlocks,
        }),
      });

      const payload = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(payload?.error || 'Failed to save tutor availability for term');
        return;
      }

      setTermAvailabilityByTutor(prev => ({
        ...prev,
        [updated.id]: updated.availabilityBlocks,
      }));
    }

    onRefetch();
  };

  const handleDelete = async (id: string) => {
    setError(null);
    const { error } = await supabase.from(DB.tutors).delete().eq('id', id);
    if (error) setError(error.message);
    else onRefetch();
  };

  const handleAdd = async () => {
    if (!newTutor.name.trim()) return;
    setSaving(true); setError(null);
    const { error } = await supabase.from(DB.tutors).insert([{
      name: newTutor.name,
      subjects: newTutor.subjects,
      cat: newTutor.cat,
      availability: newTutor.availability,
      availability_blocks: newTutor.availabilityBlocks,
    }]);
    setSaving(false);
    if (error) setError(error.message);
    else { setAdding(false); setNewTutor(EMPTY_TUTOR); onRefetch(); }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{ background: 'rgba(28,25,23,0.5)', backdropFilter: 'blur(4px)' }}
      onClick={e => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="w-full max-w-2xl rounded-2xl flex flex-col overflow-hidden" style={{ background: 'white', border: '1px solid #e7e3dd', boxShadow: '0 24px 64px rgba(0,0,0,0.15)', maxHeight: '90vh' }}
        onClick={e => e.stopPropagation()}>

        <div className="px-6 py-5 flex items-center justify-between border-b" style={{ borderColor: '#f0ece8' }}>
          <div>
            <h2 className="text-lg font-bold" style={{ color: '#1c1917' }}>Manage Tutors</h2>
            <p className="text-xs mt-0.5" style={{ color: '#a8a29e' }}>{tutors.length} tutor{tutors.length !== 1 ? 's' : ''}</p>
            {selectedTermId && (
              <p className="text-[10px] mt-1 font-semibold" style={{ color: '#6d28d9' }}>Editing availability for selected term</p>
            )}
          </div>
          <div className="flex items-center gap-2">
            {terms.length > 0 && (
              <div className="relative">
                <select
                  value={selectedTermId}
                  onChange={e => onSelectTerm(e.target.value)}
                  className="appearance-none pl-2.5 pr-6 py-1.5 rounded-lg text-[11px] font-semibold"
                  style={{ border: '1px solid #d6d3d1', color: '#57534e', background: 'white' }}
                >
                  {terms.map(term => (
                    <option key={term.id} value={term.id}>{term.name}</option>
                  ))}
                </select>
                <ChevronDown size={12} className="absolute right-2 top-1/2 -translate-y-1/2 pointer-events-none" style={{ color: '#a8a29e' }} />
              </div>
            )}
            {!adding && (
              <button onClick={() => setAdding(true)} className="flex items-center gap-1.5 px-4 py-2 rounded-lg text-xs font-semibold text-white"
                style={{ background: '#6d28d9', boxShadow: '0 1px 3px rgba(109,40,217,0.4)' }}
                onMouseEnter={e => e.currentTarget.style.background = '#5b21b6'}
                onMouseLeave={e => e.currentTarget.style.background = '#6d28d9'}
              >
                <UserPlus size={13} /> Add Tutor
              </button>
            )}
            <button onClick={onClose} className="w-8 h-8 flex items-center justify-center rounded-lg transition-colors hover:bg-stone-100" style={{ color: '#a8a29e' }}>
              <X size={15} />
            </button>
          </div>
        </div>

        <div className="flex-1 overflow-y-auto p-4 space-y-3" style={{ background: '#faf9f7' }}>
          {loadingTermAvailability && (
            <div className="p-3 rounded-xl text-xs font-semibold" style={{ background: '#eef2ff', border: '1px solid #c7d2fe', color: '#4338ca' }}>
              Loading tutor availability for selected term...
            </div>
          )}

          {error && (
            <div className="p-3 rounded-xl flex items-center gap-2 text-sm" style={{ background: '#fee2e2', border: '1px solid #fca5a5', color: '#991b1b' }}>
              <AlertTriangle size={14} /> {error}
            </div>
          )}

          {adding && (
            <div className="p-5 rounded-xl border space-y-4" style={{ background: 'white', borderColor: '#c4b5fd' }}>
              <p className="text-xs font-semibold uppercase tracking-wider" style={{ color: '#6d28d9' }}>New Tutor</p>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                <input value={newTutor.name} onChange={e => setNewTutor({ ...newTutor, name: e.target.value })} placeholder="Full name"
                  className="px-3 py-2.5 rounded-xl text-sm focus:outline-none"
                  style={{ background: '#faf9f7', border: '1px solid #e7e3dd', color: '#1c1917' }}
                  onFocus={e => e.currentTarget.style.borderColor = '#6d28d9'}
                  onBlur={e => e.currentTarget.style.borderColor = '#e7e3dd'}
                />
                <div className="flex gap-2">
                  {(['math', 'english'] as const).map(c => (
                    <button key={c} onClick={() => setNewTutor({ ...newTutor, cat: c })}
                      className="flex-1 py-2.5 rounded-xl text-xs font-semibold transition-all"
                      style={newTutor.cat === c ? { background: '#6d28d9', color: 'white', border: '1px solid #6d28d9' } : { background: 'white', color: '#78716c', border: '1px solid #e7e3dd' }}
                    >{c === 'math' ? 'Math / Sci' : 'Eng / Hist'}</button>
                  ))}
                </div>
              </div>

              <SubjectCheckboxes
                selected={newTutor.subjects}
                onChange={subjects => setNewTutor({ ...newTutor, subjects })}
                subjects={centerSubjects}
              />

              <AvailabilityGrid blocks={newTutor.availabilityBlocks}
                onChange={b => setNewTutor({ ...newTutor, availabilityBlocks: b, availability: Array.from(new Set(b.map(x => parseInt(x.split('-')[0])))).sort((a, b) => a - b) })}
              />
              <div className="flex gap-2">
                <button onClick={() => setAdding(false)} className="flex-1 py-2.5 rounded-xl text-xs font-medium" style={{ background: '#f9f7f4', color: '#78716c', border: '1px solid #e7e3dd' }}>Cancel</button>
                <button onClick={handleAdd} disabled={saving || !newTutor.name} className="flex-[2] py-2.5 rounded-xl text-xs font-semibold text-white" style={{ background: '#6d28d9', opacity: !newTutor.name ? 0.5 : 1 }}>
                  {saving ? 'Adding…' : 'Add to Database'}
                </button>
              </div>
            </div>
          )}

          {effectiveTutors.map(t => (
            <TutorRow key={t.id} tutor={t} onSave={handleSave} onDelete={handleDelete} centerSubjects={centerSubjects} />
          ))}

          {tutors.length === 0 && !adding && (
            <div className="py-16 text-center">
              <p className="text-sm" style={{ color: '#c4b9b2' }}>No tutors yet</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}