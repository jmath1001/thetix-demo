"use client";

import { useState, useEffect, useMemo, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { PlusCircle, Check, X, Loader2, Trash2, Search, ChevronDown } from 'lucide-react';
import { createInlineStudent, updateAttendance, removeStudentFromSession, updateSessionTopic, toISODate, dayOfWeek, getCentralTimeNow, type Tutor } from '@/lib/useScheduleData';
import { getSessionsForDay, type SessionTimesByDay } from '@/components/constants';
import { MAX_CAPACITY } from '@/components/constants';
import { ACTIVE_DAYS, DAY_NAMES, getTutorPaletteByIndex } from './scheduleConstants';
import { isTutorAvailable } from './scheduleUtils';
import { logEvent } from '@/lib/analytics';

interface InlineForm {
  query: string;
  student: any | null;
  topic: string;
  notes: string;
  recurring: boolean;
  recurringWeeks: number;
  creating: boolean;
  saving: boolean;
  error: string | null;
}

const emptyForm = (tutor: Tutor): InlineForm => ({
  query: '',
  student: null,
  topic: tutor.subjects?.[0] ?? '',
  notes: '',
  recurring: false,
  recurringWeeks: 4,
  creating: false,
  saving: false,
  error: null,
});

const slotKey = (tutorId: string, date: string, time: string) => `${tutorId}|${date}|${time}`;

interface WeekViewProps {
  activeDates: Date[];
  tutors: Tutor[];
  sessions: any[];
  timeOff: any[];
  students: any[];
  selectedTutorFilter: string | null;
  tutorPaletteMap: Record<string, number>;
  setSelectedSessionWithNotes: (s: any) => void;
  handleGridSlotClick: (tutor: Tutor, date: string, dayName: string, block: any) => void;
  onInlineBook: (params: {
    tutorId: string;
    date: string;
    time: string;
    student: any;
    topic: string;
    notes: string;
    recurring: boolean;
    recurringWeeks: number;
  }) => Promise<void>;
  bulkRemoveMode: boolean;
  selectedRemovals: Record<string, { sessionId: string; studentId: string; name: string }>;
  setSelectedRemovals: (value: Record<string, { sessionId: string; studentId: string; name: string }> | ((prev: Record<string, { sessionId: string; studentId: string; name: string }>) => Record<string, { sessionId: string; studentId: string; name: string }>)) => void;
  refetch: () => void;
  sessionTimesByDay?: SessionTimesByDay | null;
  onMoveStudent: (params: {
    rowId: string;
    studentId: string;
    fromSessionId: string;
    toTutorId: string;
    toDate: string;
    toTime: string;
  }) => Promise<void>;
  termName?: string | null;
  dateExceptions?: Array<{ date: string; closed: boolean; label?: string }> | null;
}

export function WeekView({
  activeDates,
  tutors,
  sessions,
  timeOff,
  students,
  selectedTutorFilter,
  tutorPaletteMap,
  setSelectedSessionWithNotes,
  handleGridSlotClick,
  onInlineBook,
  bulkRemoveMode,
  selectedRemovals,
  setSelectedRemovals,
  refetch,
  onMoveStudent,
  sessionTimesByDay,
  termName,
  dateExceptions,
}: WeekViewProps) {
  const [forms, setForms]               = useState<Record<string, InlineForm>>({});
  const [openDropdown, setOpenDropdown] = useState<string | null>(null);
  const [draggingTopic, setDraggingTopic] = useState<string | null>(null);
  const [removingId, setRemovingId] = useState<string | null>(null);
  const [topicEditRowId, setTopicEditRowId] = useState<string | null>(null);
  const [topicEditValue, setTopicEditValue] = useState('');
  const [topicDropdownRowId, setTopicDropdownRowId] = useState<string | null>(null);
  const [topicDropdownPos, setTopicDropdownPos] = useState<{ top?: number; bottom?: number; left: number } | null>(null);
  const [topicDropdownOptions, setTopicDropdownOptions] = useState<string[]>([]);
  const [topicDropdownCurrent, setTopicDropdownCurrent] = useState('');
  const [topicDropdownTutorRowId, setTopicDropdownTutorRowId] = useState<string | null>(null);
  const [slotFilterQuery, setSlotFilterQuery] = useState('');

  const normalizedSlotFilter = slotFilterQuery.trim().toLowerCase();
  const hasSlotFilter = normalizedSlotFilter.length > 0;
  const slotFilterTerms = useMemo(
    () => normalizedSlotFilter.split(/\s+/).filter(Boolean),
    [normalizedSlotFilter]
  );

  const slotTextMatchesFilter = useCallback((parts: Array<string | null | undefined>) => {
    if (!hasSlotFilter) return true;
    const searchable = parts.filter(Boolean).join(' ').toLowerCase();
    return slotFilterTerms.every(term => searchable.includes(term));
  }, [hasSlotFilter, slotFilterTerms]);

  const selectionKey = (sessionId: string, studentId: string) => `${sessionId}|${studentId}`;
  type DragStudentPayload = { rowId: string; studentId: string; fromSessionId: string; topic: string | null };

  const toggleRemovalSelection = (sessionId: string, studentId: string, name: string) => {
    const key = selectionKey(sessionId, studentId);
    setSelectedRemovals(prev => {
      const next = { ...prev };
      if (next[key]) delete next[key]; else next[key] = { sessionId, studentId, name };
      return next;
    });
  };

  const clearSelection = () => setSelectedRemovals({});
  const selectedCount = Object.keys(selectedRemovals).length;

  const openForm = (tutor: Tutor, date: string, time: string) => {
    const key = slotKey(tutor.id, date, time);
    setForms(p => ({ ...p, [key]: emptyForm(tutor) }));
    setOpenDropdown(key);
  };

  const closeForm = (key: string) => {
    setForms(p => { const n = { ...p }; delete n[key]; return n; });
    setOpenDropdown(prev => prev === key ? null : prev);
  };

  const patchForm = (key: string, patch: Partial<InlineForm>) =>
    setForms(p => ({ ...p, [key]: { ...p[key], ...patch } }));

  const clampWeeks = (value: number) => Math.max(2, Math.min(24, Number.isFinite(value) ? Math.floor(value) : 2));

  const getSuggestions = (key: string) => {
    const q = forms[key]?.query?.trim().toLowerCase();
    if (!q || forms[key]?.student) return [];
    return students.filter(s => s.name?.toLowerCase().includes(q)).slice(0, 7);
  };

  const topicsFor = (tutor: Tutor) =>
    Array.from(new Set((tutor.subjects ?? []).map((s: string) => s?.trim()).filter(Boolean)));

  const topicMatchesTutor = (_tutor: Tutor, _topic: string | null) => true;

  const dropStateFor = (tutor: Tutor, isOutside: boolean): 'valid' | 'invalid' | null => {
    if (isOutside || !draggingTopic) return null;
    return topicMatchesTutor(tutor, draggingTopic) ? 'valid' : 'invalid';
  };

  const handleSave = async (key: string, tutor: Tutor, date: string, block: any) => {
    const form = forms[key];
    if (!form?.student || !form.topic) return;
    patchForm(key, { saving: true, error: null });
    try {
      await onInlineBook({
        tutorId: tutor.id,
        date,
        time: block.time,
        student: form.student,
        topic: form.topic,
        notes: form.notes,
        recurring: form.recurring,
        recurringWeeks: form.recurring ? clampWeeks(form.recurringWeeks) : 1,
      });
      closeForm(key);
      logEvent('session_booked', { studentName: form.student.name, date, recurring: form.recurring, source: 'inline_week' });
    } catch (err: any) {
      patchForm(key, { saving: false, error: err?.message || 'Booking failed — please try again.' });
    }
  };

  const handleCreateStudent = async (key: string, tutor: Tutor) => {
    const form = forms[key];
    const name = form?.query?.trim();
    if (!name || form?.creating) return;

    const existing = students.find(
      (s: any) => String(s?.name ?? '').trim().toLowerCase() === name.toLowerCase()
    );

    if (existing) {
      patchForm(key, { student: existing, query: existing.name, error: null });
      setOpenDropdown(null);
      return;
    }

    patchForm(key, { creating: true, error: null });
    try {
      const created = await createInlineStudent({
        name,
        subject: form.topic || tutor.subjects?.[0] || null,
      });
      patchForm(key, {
        creating: false,
        student: created,
        query: created.name,
        topic: form.topic || tutor.subjects?.[0] || created.subject || '',
      });
      setOpenDropdown(null);
      refetch();
    } catch (err: any) {
      patchForm(key, { creating: false, error: err?.message || 'Could not create student.' });
    }
  };

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (!(e.target as Element).closest('[data-inline-form]')) setOpenDropdown(null);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  useEffect(() => {
    if (!topicDropdownRowId) return;
    const handler = (e: MouseEvent) => setTopicDropdownRowId(null);
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [topicDropdownRowId]);

  useEffect(() => {
    if (!bulkRemoveMode) clearSelection();
  }, [bulkRemoveMode]);

  const handleDropOnSlot = async (
    e: React.DragEvent,
    targetTutor: Tutor,
    targetDate: string,
    targetTime: string,
  ) => {
    e.preventDefault();
    if (draggingTopic && !topicMatchesTutor(targetTutor, draggingTopic)) {
      alert(`${targetTutor.name} does not teach ${draggingTopic}.`);
      return;
    }
    const raw = e.dataTransfer.getData('application/x-schedule-student');
    if (!raw) return;
    try {
      const payload = JSON.parse(raw) as DragStudentPayload;
      await onMoveStudent({
        rowId: payload.rowId,
        studentId: payload.studentId,
        fromSessionId: payload.fromSessionId,
        toTutorId: targetTutor.id,
        toDate: targetDate,
        toTime: targetTime,
      });
    } catch (err: any) {
      alert(err?.message || 'Unable to move student to that slot.');
    }
  };

  const attendanceBadge = (status: string) => {
    if (status === 'present') {
      return { label: 'P', bg: '#dcfce7', color: '#166534', border: '#86efac' };
    }
    if (status === 'no-show') {
      return { label: 'NO-SHOW', bg: '#fee2e2', color: '#b91c1c', border: '#fca5a5' };
    }
    return null;
  };

  const renderInlineForm = (tutor: Tutor, date: string, block: any, palette: any) => {
    const key   = slotKey(tutor.id, date, block.time);
    const form  = forms[key];
    if (!form) return null;
    const hints   = getSuggestions(key);
    const normalizedQuery = (form.query ?? '').trim();
    const hasExactMatch = hints.some((s: any) => String(s?.name ?? '').trim().toLowerCase() === normalizedQuery.toLowerCase());
    const canCreate = !!normalizedQuery && !form.student && !hasExactMatch && !form.saving;
    const canSave = !!form.student && !!form.topic && !form.saving && !form.creating && (!form.recurring || form.recurringWeeks >= 2);
    const topics  = topicsFor(tutor);
    const selectedTopicOption = topics.includes(form.topic) ? form.topic : '__custom__';

    return (
      <div data-inline-form className="flex flex-col gap-2 p-2.5 rounded-xl"
        style={{ background: 'white', border: '1.5px solid #94a3b8', boxShadow: '0 2px 10px rgba(15,23,42,0.08)', minHeight: 110 }}>
        <div className="flex items-center justify-between">
          <span className="text-[9px] font-black uppercase tracking-widest" style={{ color: '#334155' }}>Quick Add</span>
          <button onClick={() => closeForm(key)} className="w-4 h-4 flex items-center justify-center rounded hover:bg-gray-100" style={{ color: '#9ca3af' }}>
            <X size={10} />
          </button>
        </div>
        <div className="relative" data-inline-form>
          <input autoFocus type="text" placeholder="Student name…"
            value={form.student ? form.student.name : form.query}
            onChange={e => { patchForm(key, { query: e.target.value, student: null, error: null }); setOpenDropdown(key); }}
            onFocus={() => setOpenDropdown(key)}
            className="w-full text-xs font-semibold rounded-lg px-2.5 py-1.5 outline-none"
            style={{ background: '#f3f4f6', border: '1px solid #e5e7eb', color: '#111827' }} />
          {form.student && (
            <button onMouseDown={e => { e.preventDefault(); patchForm(key, { student: null, query: '' }); }}
              className="absolute right-2 top-1/2 -translate-y-1/2" style={{ color: '#9ca3af' }}>
              <X size={9} />
            </button>
          )}
          {openDropdown === key && !form.student && (hints.length > 0 || canCreate) && (
            <div data-inline-form className="absolute z-50 left-0 right-0 rounded-lg overflow-hidden"
              style={{ top: 'calc(100% + 3px)', background: 'white', border: '1px solid #e5e7eb', boxShadow: '0 6px 20px rgba(0,0,0,0.12)' }}>
              {hints.map(s => (
                <button key={s.id} className="w-full text-left px-3 py-2 text-xs font-semibold transition-colors"
                  style={{ color: '#111827', borderBottom: '1px solid #f3f4f6' }}
                  onMouseEnter={e => (e.currentTarget.style.background = '#f3f4f6')}
                  onMouseLeave={e => (e.currentTarget.style.background = 'white')}
                  onMouseDown={e => {
                    e.preventDefault();
                    const autoTopic = s.subject ?? form.topic;
                    patchForm(key, { student: s, query: s.name, topic: autoTopic });
                    setOpenDropdown(null);
                  }}>
                  <span>{s.name}{s.grade ? ` (${s.grade})` : ''}</span>
                  {s.subject && <span className="ml-2 text-[9px] font-normal" style={{ color: '#a5b4fc' }}>{s.subject}</span>}
                </button>
              ))}
              {canCreate && (
                <button
                  className="w-full text-left px-3 py-2 text-xs font-bold transition-colors"
                  style={{ color: '#2563eb', background: '#eff6ff' }}
                  onMouseDown={e => {
                    e.preventDefault();
                    void handleCreateStudent(key, tutor);
                  }}
                >
                  {form.creating ? 'Adding new student…' : `+ Add "${normalizedQuery}" as new student`}
                </button>
              )}
            </div>
          )}
        </div>
        <div className="relative">
          <select value={selectedTopicOption} onChange={e => patchForm(key, { topic: e.target.value === '__custom__' ? '' : e.target.value })}
            className="w-full text-xs font-semibold rounded-lg px-2.5 py-1.5 outline-none"
            style={{ background: '#f3f4f6', border: '1px solid #e5e7eb', color: '#374151', appearance: 'none', paddingRight: 22 }}>
            {topics.map(t => <option key={t} value={t}>{t}</option>)}
            <option value="__custom__">Custom topic...</option>
          </select>
          <ChevronDown size={11} style={{ position: 'absolute', right: 7, top: '50%', transform: 'translateY(-50%)', color: '#9ca3af', pointerEvents: 'none' }} />
        </div>
        {selectedTopicOption === '__custom__' && (
          <input
            type="text"
            value={form.topic}
            onChange={e => patchForm(key, { topic: e.target.value })}
            placeholder="Type custom topic"
            className="w-full text-xs font-semibold rounded-lg px-2.5 py-1.5 outline-none"
            style={{ background: '#fefefe', border: '1px solid #cbd5e1', color: '#374151' }}
          />
        )}
        <textarea
          value={form.notes}
          onChange={e => patchForm(key, { notes: e.target.value })}
          rows={2}
          placeholder="Session notes (optional)"
          className="w-full text-xs font-medium rounded-lg px-2.5 py-1.5 outline-none resize-y"
          style={{ background: '#f8fafc', border: '1px solid #e5e7eb', color: '#334155' }}
        />
        <div className="rounded-lg p-2" style={{ background: '#f8fafc', border: '1px solid #e5e7eb' }}>
          <div className="flex items-center justify-between gap-2">
            <span className="text-[10px] font-black uppercase tracking-wider" style={{ color: '#475569' }}>Recurring</span>
            <div className="flex gap-1">
              <button
                type="button"
                onClick={() => patchForm(key, { recurring: false })}
                className="px-2 py-1 rounded text-[9px] font-bold uppercase tracking-wide"
                style={form.recurring ? { background: 'white', border: '1px solid #d1d5db', color: '#6b7280' } : { background: '#334155', border: '1px solid #334155', color: 'white' }}>
                No
              </button>
              <button
                type="button"
                onClick={() => patchForm(key, { recurring: true, recurringWeeks: form.recurringWeeks < 2 ? 4 : form.recurringWeeks })}
                className="px-2 py-1 rounded text-[9px] font-bold uppercase tracking-wide"
                style={form.recurring ? { background: '#334155', border: '1px solid #334155', color: 'white' } : { background: 'white', border: '1px solid #d1d5db', color: '#6b7280' }}>
                Yes
              </button>
            </div>
          </div>
          {form.recurring && (
            <div className="mt-2 flex items-center gap-2">
              <span className="text-[9px] font-bold uppercase tracking-wide" style={{ color: '#64748b' }}>Weeks</span>
              <input
                type="number"
                min={2}
                max={24}
                value={form.recurringWeeks}
                onChange={e => patchForm(key, { recurringWeeks: clampWeeks(Number(e.target.value || 2)) })}
                className="w-16 text-[10px] font-bold rounded px-2 py-1 outline-none"
                style={{ background: 'white', border: '1px solid #d1d5db', color: '#334155' }}
              />
            </div>
          )}
        </div>
        {form.error && (
          <p className="text-[9px] font-semibold" style={{ color: '#dc2626' }}>
            {form.error}
          </p>
        )}
        <button onClick={() => handleSave(key, tutor, date, block)} disabled={!canSave}
          className="w-full py-1.5 rounded-lg text-[10px] font-black uppercase tracking-wider flex items-center justify-center gap-1.5 transition-all"
          style={{ background: canSave ? '#0f172a' : '#e5e7eb', color: canSave ? 'white' : '#9ca3af', cursor: canSave ? 'pointer' : 'not-allowed' }}>
          {form.saving ? <><Loader2 size={10} className="animate-spin" /> Saving…</> : 'Book'}
        </button>
      </div>
    );
  };

  const renderAvailableSlot = (tutor: Tutor, date: string, block: any, palette: any) => {
    const key = slotKey(tutor.id, date, block.time);
    if (forms[key]) return renderInlineForm(tutor, date, block, palette);
    return (
      <div onClick={() => openForm(tutor, date, block.time)}
        className="w-full h-full min-h-20 rounded-xl flex flex-col items-center justify-center gap-1 cursor-pointer transition-all"
        style={{ background: '#eff6ff', border: '2px dashed #60a5fa' }}
        onMouseEnter={e => { e.currentTarget.style.background = '#dbeafe'; e.currentTarget.style.borderColor = '#2563eb'; }}
        onMouseLeave={e => { e.currentTarget.style.background = '#eff6ff'; e.currentTarget.style.borderColor = '#60a5fa'; }}>
        <PlusCircle size={14} style={{ color: '#2563eb' }} />
        <span className="text-[8px] font-bold uppercase tracking-widest" style={{ color: '#2563eb' }}>Available</span>
      </div>
    );
  };

  const renderAddMore = (tutor: Tutor, date: string, block: any, session: any, palette: any) => {
    const key = slotKey(tutor.id, date, block.time);
    if (forms[key]) return renderInlineForm(tutor, date, block, palette);
    return (
      <button onClick={() => openForm(tutor, date, block.time)}
        className="mt-auto py-1 rounded-xl text-[9px] font-bold uppercase tracking-wider transition-all w-full"
        style={{ background: 'transparent', border: '1.5px dashed #d1d5db', color: '#9ca3af' }}
        onMouseEnter={e => { e.currentTarget.style.background = '#1f2937'; e.currentTarget.style.color = 'white'; e.currentTarget.style.borderColor = '#1f2937'; }}
        onMouseLeave={e => { e.currentTarget.style.background = 'transparent'; e.currentTarget.style.color = '#9ca3af'; e.currentTarget.style.borderColor = '#d1d5db'; }}>
        + ADD ({MAX_CAPACITY - session.students.length})
      </button>
    );
  };

  return (
    <div className="mx-auto w-full p-2 md:p-4 space-y-6 md:space-y-8" style={{ maxWidth: 1600 }}>

      {/* Live slot filter bar — single compact row, sticks under nav */}
      <div className="sticky z-20 rounded-xl overflow-hidden"
        style={{
          top: 44,
          border: hasSlotFilter ? '2px solid #6366f1' : '2px solid #e2e8f0',
          boxShadow: hasSlotFilter ? '0 0 0 3px rgba(99,102,241,0.12)' : '0 2px 8px rgba(15,23,42,0.06)',
        }}>
        <div className="flex items-center" style={{ background: hasSlotFilter ? 'linear-gradient(90deg,#4f46e5,#7c3aed)' : '#1e293b' }}>
          {/* Label */}
          <div className="flex items-center gap-1.5 px-2.5 shrink-0 self-stretch">
            <Search size={11} style={{ color: 'rgba(255,255,255,0.75)' }} />
            <span className="text-[8px] font-black uppercase tracking-widest whitespace-nowrap" style={{ color: 'rgba(255,255,255,0.8)' }}>Filter</span>
          </div>
          {/* Input */}
          <div className="relative flex-1">
            <input
              type="text"
              value={slotFilterQuery}
              onChange={(e) => setSlotFilterQuery(e.target.value)}
              placeholder="Subject, student, tutor, or time…"
              className="w-full py-2 text-xs font-semibold outline-none"
              style={{
                background: hasSlotFilter ? '#f5f3ff' : 'white',
                color: '#1f2937',
                paddingLeft: 10,
                paddingRight: slotFilterQuery ? 32 : 10,
                borderLeft: '1px solid rgba(255,255,255,0.15)',
              }}
            />
            {slotFilterQuery && (
              <button
                onMouseDown={(e) => { e.preventDefault(); setSlotFilterQuery(''); }}
                className="absolute right-2 top-1/2 -translate-y-1/2 w-5 h-5 rounded-full flex items-center justify-center"
                style={{ background: '#6366f1', color: 'white' }}
                aria-label="Clear filter"
              >
                <X size={10} />
              </button>
            )}
          </div>
          {/* Count badge */}
          {hasSlotFilter && (
            <span className="shrink-0 text-[9px] font-black px-2 mx-2 py-0.5 rounded-full"
              style={{ background: 'rgba(255,255,255,0.2)', color: 'white', whiteSpace: 'nowrap' }}>
              filtering
            </span>
          )}
          {!hasSlotFilter && (
            <span className="shrink-0 text-[9px] px-2 mr-1" style={{ color: 'rgba(255,255,255,0.35)', whiteSpace: 'nowrap' }}>all days</span>
          )}
        </div>
      </div>

      {activeDates.map((date) => {
        const isoDate   = toISODate(date);
        const dow       = dayOfWeek(isoDate);
        const dayIdx    = ACTIVE_DAYS.indexOf(dow);
        const dayLabel  = DAY_NAMES[dayIdx];
        const dateLabel = date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
        const isToday   = isoDate === toISODate(getCentralTimeNow());
        const dateException = dateExceptions?.find(e => e.date === isoDate) ?? null;
        const activeTutors = tutors.filter(t =>
          t.availability.includes(dow) &&
          (selectedTutorFilter === null || t.id === selectedTutorFilter)
        );
        const activeTutorIdSet = new Set(activeTutors.map(t => t.id));
        const visibleDaySessions = sessions
          .filter(s => s.date === isoDate && activeTutorIdSet.has(s.tutorId));
        const dayStudentCount = visibleDaySessions
          .reduce((total, session) => total + (session.students ?? []).filter((st: any) => st.status !== 'cancelled').length, 0);
        const scheduledSessionCount = visibleDaySessions.filter(
          (session) => (session.students ?? []).some((st: any) => st.status !== 'cancelled')
        ).length;
        const studentsPerSession = scheduledSessionCount > 0 ? (dayStudentCount / scheduledSessionCount) : 0;
        const daySessions = getSessionsForDay(dow, sessionTimesByDay);

        const filteredActiveTutors = hasSlotFilter
          ? activeTutors.filter((tutor) =>
              daySessions.some((block) => {
                const session = sessions.find(s => s.date === isoDate && s.tutorId === tutor.id && s.time === block.time);
                const activeStudents = (session?.students ?? []).filter((st: any) => st.status !== 'cancelled');
                const studentBlob = activeStudents.map((st: any) => [st.name, st.topic, st.notes, st.grade ? `grade ${st.grade}` : ''].filter(Boolean).join(' ')).join(' ');
                return slotTextMatchesFilter([
                    dayLabel,
                    dateLabel,
                    isoDate,
                  tutor.name,
                  tutor.cat,
                  (tutor.subjects ?? []).join(' '),
                  block.label,
                  block.display,
                  block.time,
                  studentBlob,
                ]);
              })
            )
          : activeTutors;

        const filteredDaySessions = hasSlotFilter
          ? daySessions.filter((block) =>
              filteredActiveTutors.some((tutor) => {
                const session = sessions.find(s => s.date === isoDate && s.tutorId === tutor.id && s.time === block.time);
                const activeStudents = (session?.students ?? []).filter((st: any) => st.status !== 'cancelled');
                const studentBlob = activeStudents.map((st: any) => [st.name, st.topic, st.notes, st.grade ? `grade ${st.grade}` : ''].filter(Boolean).join(' ')).join(' ');
                return slotTextMatchesFilter([
                  dayLabel,
                  dateLabel,
                  isoDate,
                  tutor.name,
                  tutor.cat,
                  (tutor.subjects ?? []).join(' '),
                  block.label,
                  block.display,
                  block.time,
                  studentBlob,
                ]);
              })
            )
          : daySessions;

        return (
          <div key={isoDate} className="space-y-2.5 md:space-y-3">
            <div className="flex items-center gap-2.5 md:gap-3 px-1">
              <div className="flex items-baseline gap-3">
                <h2 className="text-2xl md:text-3xl font-bold tracking-tight leading-none"
                  style={isToday
                    ? { color: '#4338ca', textShadow: '0 1px 10px rgba(79,70,229,0.18)' }
                    : { color: '#0f172a' }}>
                  {dayLabel}
                </h2>
                <span className="text-sm md:text-base font-semibold" style={{ color: '#64748b' }}>
                  {dateLabel}
                  {isToday && (
                    <span className="ml-2 text-[9px] font-bold px-2 py-0.5 rounded-full align-middle uppercase tracking-wider"
                      style={{ background: '#e2e8f0', border: '1px solid #cbd5e1', color: '#334155' }}>Today</span>
                  )}
                </span>
              </div>
              <div className="h-px grow rounded-full"
                style={{ background: 'linear-gradient(90deg, #cbd5e1, transparent)' }} />
            </div>

            {dateException && (
              <div className="rounded-xl border px-4 py-3 flex items-center gap-3"
                style={{ background: dateException.closed ? '#fef2f2' : '#fffbeb', borderColor: dateException.closed ? '#fca5a5' : '#fcd34d' }}>
                <span className="text-lg">{dateException.closed ? '🚫' : '⚠️'}</span>
                <div>
                  <p className="text-sm font-bold" style={{ color: dateException.closed ? '#991b1b' : '#92400e' }}>
                    {dateException.closed ? 'Closed' : 'Special Day'}{dateException.label ? ` — ${dateException.label}` : ''}
                  </p>
                  {dateException.closed && <p className="text-xs mt-0.5" style={{ color: '#b91c1c' }}>No sessions scheduled for this date.</p>}
                </div>
              </div>
            )}

            {filteredActiveTutors.length === 0 ? (
              <div className="rounded-xl p-6 text-center border border-dashed" style={{ borderColor: '#e5e7eb' }}>
                <p className="text-xs font-medium italic" style={{ color: '#9ca3af' }}>
                  {hasSlotFilter ? 'No slots match your filter' : 'No tutors available'}
                </p>
              </div>
            ) : (
              <>
                {/* Desktop table */}
                <div className="hidden md:block rounded-xl overflow-hidden"
                  style={{ background: 'white', border: '2px solid #94a3b8', boxShadow: '0 1px 8px rgba(0,0,0,0.06)' }}>
                  <div className="overflow-x-auto">
                    <table className="border-collapse" style={{ minWidth: '100%', width: 'max-content', borderCollapse: 'separate', borderSpacing: 0 }}>
                      <thead>
                        <tr style={{ background: '#1f2937', borderBottom: '1px solid #111827' }}>
                          <th className="px-2 py-1.5 text-left text-[11px] font-bold uppercase tracking-wider"
                            style={{ color: 'rgba(255,255,255,0.5)', borderRight: '1px solid rgba(255,255,255,0.08)', width: 1, whiteSpace: 'nowrap', position: 'sticky', left: 0, top: 0, zIndex: 4, background: '#1f2937' }}>
                            Instructor
                            {termName && <div style={{ color: '#fbbf24', fontSize: 9, fontWeight: 700, marginTop: 2, textTransform: 'none', letterSpacing: 0 }}>{termName}</div>}
                          </th>
                          {filteredDaySessions.map(block => (
                            <th key={block.id} className="px-3 py-1.5 text-center"
                              style={{ borderRight: '1px solid rgba(255,255,255,0.08)', minWidth: 172, position: 'sticky', top: 0, background: '#1f2937', zIndex: 3 }}>
                              <div className="text-xs font-black uppercase tracking-wider" style={{ color: 'rgba(255,255,255,0.9)' }}>{block.label}</div>
                              <div className="text-[11px] font-semibold mt-0.5" style={{ color: 'rgba(255,255,255,0.45)' }}>{block.display}</div>
                            </th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {filteredActiveTutors.map(tutor => {
                          const palette = getTutorPaletteByIndex(tutorPaletteMap[tutor.id] ?? 0);
                          return (
                            <tr key={tutor.id} style={{ borderBottom: '1px solid #e5e7eb' }}>
                              <td className="px-2 py-1.5 align-middle"
                                style={{ background: '#e2e8f0', borderRight: '1px solid #94a3b8', borderBottom: '1px solid #cbd5e1', position: 'sticky', left: 0, zIndex: 1, width: 1, whiteSpace: 'nowrap' }}>
                                <div className="flex items-center gap-1.5">
                                  <div className="w-5 h-5 rounded-md flex items-center justify-center text-[8px] font-bold shrink-0"
                                    style={{ background: palette.bg, color: palette.text, border: `1px solid ${palette.border}` }}>
                                    {tutor.name.split(' ').map((n: string) => n[0]).join('').slice(0, 2).toUpperCase()}
                                  </div>
                                  <div>
                                    <p className="text-[11px] font-bold leading-tight whitespace-nowrap" style={{ color: '#1f2937' }}>{tutor.name}</p>
                                    <span className="text-[8px] font-bold px-1 py-0.5 rounded mt-0.5 inline-block"
                                      style={{ background: tutor.cat === 'math' ? '#dbeafe' : '#fce7f3', color: tutor.cat === 'math' ? '#1d4ed8' : '#be185d' }}>
                                      {tutor.cat === 'math' ? 'Math' : 'English'}
                                    </span>
                                  </div>
                                </div>
                              </td>

                              {filteredDaySessions.map(block => {
                                const session     = sessions.find(s => s.date === isoDate && s.tutorId === tutor.id && s.time === block.time);
                                const hasStudents = session && session.students.length > 0;
                                const isOnTimeOff = timeOff.some(t => t.tutorId === tutor.id && t.date === isoDate);
                                const isFull      = hasStudents && session!.students.length >= MAX_CAPACITY;
                                const isOutside   = !isTutorAvailable(tutor, dow, block.time) || isOnTimeOff;
                                const isAvail     = !isOutside && !hasStudents;
                                const dropState   = dropStateFor(tutor, isOutside);
                                const timeOffNote = isOnTimeOff ? timeOff.find(t => t.tutorId === tutor.id && t.date === isoDate)?.note : null;

                                return (
                                  <td key={block.id} className="p-1.5 align-top"
                                    style={{
                                      background: isOutside
                                        ? 'repeating-linear-gradient(45deg,#e9ebee,#e9ebee 4px,#dfe2e6 4px,#dfe2e6 8px)'
                                        : dropState === 'valid'
                                          ? '#dbeafe'
                                          : dropState === 'invalid'
                                            ? '#fee2e2'
                                            : '#f3f4f6',
                                      borderRight: dropState === 'invalid' ? '2px solid #ef4444' : '1px solid #e5e7eb',
                                      borderBottom: '1px solid #cbd5e1',
                                      minWidth: 172,
                                    }}
                                    onDragOver={(e) => { if (!isOutside && dropState !== 'invalid') e.preventDefault(); }}
                                    onDrop={(e) => { if (!isOutside && dropState !== 'invalid') void handleDropOnSlot(e, tutor, isoDate, block.time); }}>
                                    <div className="flex flex-col gap-1.5 h-full min-h-20">

                                      {/* Booked students — same card style as TodayView */}
                                      {hasStudents && session!.students.map((student: any) => {
                                        const key = selectionKey(session.id, student.id);
                                        const isSelected = !!selectedRemovals[key];
                                        return (
                                          <div key={student.rowId || student.id}
                                            className="p-2 rounded-xl cursor-pointer transition-all hover:shadow-md"
                                            draggable={!!student.rowId && !bulkRemoveMode}
                                            onDragStart={(e) => {
                                              if (!student.rowId || bulkRemoveMode) return;
                                              const payload: DragStudentPayload = {
                                                rowId: student.rowId,
                                                studentId: student.id,
                                                fromSessionId: session.id,
                                                topic: student.topic ?? null,
                                              };
                                              e.dataTransfer.setData('application/x-schedule-student', JSON.stringify(payload));
                                              e.dataTransfer.effectAllowed = 'move';
                                              setDraggingTopic(student.topic ?? null);
                                            }}
                                            onDragEnd={() => setDraggingTopic(null)}
                                            style={
                                              student.status === 'no-show'  ? { background: '#f8fafc', border: '1.5px solid #94a3b8', opacity: 0.65, boxShadow: '0 4px 10px rgba(148,163,184,0.16), inset 0 0 0 1px rgba(148,163,184,0.2)' }
                                              : student.status === 'present' ? { background: '#dcfce7', border: '1.5px solid #16a34a', boxShadow: '0 6px 14px rgba(22,163,74,0.16), 0 1px 0 rgba(22,163,74,0.18), inset 0 0 0 1px rgba(255,255,255,0.5)' }
                                              :                               { background: palette.bg, border: `1.5px solid ${palette.border}`, boxShadow: '0 5px 12px rgba(99,102,241,0.1), 0 1px 0 rgba(17,24,39,0.12)' }
                                            }
                                            onClick={(e) => {
                                              e.stopPropagation();
                                              if (bulkRemoveMode) {
                                                toggleRemovalSelection(session.id, student.id, student.name);
                                                return;
                                              }
                                              setSelectedSessionWithNotes({ ...session, activeStudent: student, dayName: dayLabel, date: isoDate, tutorName: tutor.name, block });
                                            }}>
                                            <div className="flex justify-between items-start mb-1">
                                              <div className="flex items-center gap-1.5 min-w-0">
                                                <p className="text-xs font-bold leading-tight truncate" style={{ color: '#111827', textDecoration: student.status === 'no-show' ? 'line-through' : 'none' }}>{student.name}{student.grade ? ` (${student.grade})` : ''}</p>
                                                {attendanceBadge(student.status) && (
                                                  <span
                                                    className="text-[8px] font-black px-1.5 py-0.5 rounded-full uppercase tracking-wider"
                                                    style={{
                                                      background: attendanceBadge(student.status)!.bg,
                                                      color: attendanceBadge(student.status)!.color,
                                                      border: `1px solid ${attendanceBadge(student.status)!.border}`,
                                                    }}
                                                  >
                                                    {attendanceBadge(student.status)!.label}
                                                  </span>
                                                )}
                                              </div>
                                              <div className="flex items-center gap-1 shrink-0 ml-1">
                                                {student.confirmationStatus === 'confirmed'            && <span style={{ color: '#15803d', fontSize: 10 }}>✓</span>}
                                                {student.confirmationStatus === 'cancelled'            && <span style={{ color: '#dc2626', fontSize: 10 }}>✕</span>}
                                                {student.confirmationStatus === 'reschedule_requested' && <span style={{ color: '#334155', fontSize: 10 }}>↗</span>}
                                                <button
                                                  onClick={async e => {
                                                    e.stopPropagation();
                                                    const next = student.status === 'present' ? 'scheduled' : 'present';
                                                    await updateAttendance({ sessionId: session.id, studentId: student.id, status: next });
                                                    logEvent('attendance_marked', { status: next, studentName: student.name, source: 'week_grid' });
                                                    refetch();
                                                  }}
                                                  className="shrink-0 w-4 h-4 rounded-md flex items-center justify-center transition-all"
                                                  style={student.status === 'present'
                                                    ? { background: '#16a34a', border: '1.5px solid #16a34a' }
                                                    : { background: 'white', border: '1.5px solid #d1d5db' }}>
                                                  {student.status === 'present' && <Check size={9} strokeWidth={3} color="white" />}
                                                </button>
                                                <button
                                                  title={removingId === (student.rowId || student.id) ? 'Tap again to confirm' : 'Remove student'}
                                                  onClick={async e => {
                                                    e.stopPropagation();
                                                    const sid = student.rowId || student.id;
                                                    if (removingId !== sid) { setRemovingId(sid); return; }
                                                    setRemovingId(null);
                                                    await removeStudentFromSession({ sessionId: session.id, studentId: student.id });
                                                    logEvent('student_removed', { source: 'week_grid', sessionId: session.id, studentId: student.id });
                                                    refetch();
                                                  }}
                                                  onBlur={() => setRemovingId(null)}
                                                  className="shrink-0 w-4 h-4 rounded-md flex items-center justify-center transition-all"
                                                  style={removingId === (student.rowId || student.id)
                                                    ? { background: '#fee2e2', color: '#dc2626' }
                                                    : { background: 'transparent', color: '#6b7280' }}>
                                                  <Trash2 size={9} strokeWidth={2} />
                                                </button>
                                              </div>
                                            </div>
                                            <div className="flex items-center gap-1.5 mt-0.5" onClick={e => e.stopPropagation()}>
                                              {topicEditRowId === student.rowId ? (
                                                <input
                                                  autoFocus
                                                  type="text"
                                                  value={topicEditValue}
                                                  onChange={e => setTopicEditValue(e.target.value)}
                                                  onBlur={async () => {
                                                    if (topicEditValue.trim()) {
                                                      await updateSessionTopic({ rowId: student.rowId, topic: topicEditValue.trim() });
                                                      refetch();
                                                    }
                                                    setTopicEditRowId(null);
                                                  }}
                                                  onKeyDown={e => {
                                                    if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
                                                    if (e.key === 'Escape') setTopicEditRowId(null);
                                                  }}
                                                  className="text-[10px] font-semibold rounded px-1.5 py-0.5 outline-none"
                                                  style={{ background: '#f3f4f6', border: `1px solid ${palette.tag}`, color: '#374151', width: 110 }}
                                                />
                                              ) : (
                                                <button
                                                  onClick={e => { const r = (e.currentTarget as HTMLElement).getBoundingClientRect(); const spaceBelow = window.innerHeight - r.bottom; const pos = spaceBelow < 200 ? { bottom: window.innerHeight - r.top + 4, left: r.left } : { top: r.bottom + 4, left: r.left }; setTopicDropdownPos(pos); setTopicDropdownOptions(topicsFor(tutor)); setTopicDropdownCurrent(student.topic); setTopicDropdownTutorRowId(student.rowId); setTopicDropdownRowId(topicDropdownRowId === student.rowId ? null : student.rowId); }}
                                                  className="inline-flex items-center gap-0.5 outline-none"
                                                  style={{ background: 'transparent', border: 'none', cursor: 'pointer', padding: 0, color: palette.tag }}>
                                                  <span className="text-[10px] font-semibold uppercase tracking-tight">{student.topic}</span>
                                                  <ChevronDown size={9} style={{ opacity: 0.7, flexShrink: 0 }} />
                                                </button>
                                              )}
                                              {student.seriesId && (
                                                <span className="text-[8px] font-black px-1 py-0.5 rounded" style={{ background: '#ede9fe', color: '#7c3aed', letterSpacing: '0.02em' }}>↺ REC</span>
                                              )}
                                            </div>
                                            {student.notes && <p className="text-[10px] mt-1 italic truncate" style={{ color: '#6b7280' }}>📝 {student.notes}</p>}
                                            {bulkRemoveMode && (
                                              <div className="mt-2 inline-flex items-center gap-2 text-[10px] font-semibold uppercase tracking-[0.16em]" style={{ color: isSelected ? '#7c3aed' : '#6b7280' }}>
                                                <span style={{ width: 10, height: 10, borderRadius: 999, display: 'inline-block', background: isSelected ? '#7c3aed' : '#d1d5db' }} />
                                                {isSelected ? 'Selected' : 'Tap to select'}
                                              </div>
                                            )}
                                          </div>
                                        );
                                      })}

                                      {hasStudents && !isOnTimeOff && !isFull && renderAddMore(tutor, isoDate, block, session, palette)}
                                      {isAvail && renderAvailableSlot(tutor, isoDate, block, palette)}
                                      {isOutside && (
                                        <div className="w-full h-full min-h-20 rounded-xl flex flex-col items-center justify-center gap-1"
                                          style={{ background: 'repeating-linear-gradient(45deg,#e9ebee,#e9ebee 4px,#dfe2e6 4px,#dfe2e6 8px)' }}>
                                          {isOnTimeOff ? (
                                            <>
                                              <span className="text-[9px] font-black uppercase tracking-widest" style={{ color: hasStudents ? '#b91c1c' : '#475569' }}>
                                                {hasStudents ? 'OFF + BOOKED' : 'OFF'}
                                              </span>
                                              {timeOffNote && <span className="text-[8px] font-medium text-center px-2 leading-tight" style={{ color: '#9ca3af' }}>{timeOffNote}</span>}
                                            </>
                                          ) : (
                                            <span className="text-[9px] font-semibold uppercase tracking-wider" style={{ color: '#d1d5db' }}>—</span>
                                          )}
                                        </div>
                                      )}
                                    </div>
                                  </td>
                                );
                              })}
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                </div>

                {/* Mobile cards */}
                <div className="md:hidden space-y-2">
                  {filteredActiveTutors.map(tutor => {
                    const palette = getTutorPaletteByIndex(tutorPaletteMap[tutor.id] ?? 0);
                    const isOnTimeOff = timeOff.some(t => t.tutorId === tutor.id && t.date === isoDate);
                    return (
                      <div key={tutor.id} className="rounded-xl overflow-hidden"
                        style={{ background: 'white', border: '1px solid #e5e7eb', boxShadow: '0 1px 6px rgba(0,0,0,0.06)' }}>
                        <div className="p-2.5" style={{ background: '#1f2937', borderBottom: '1px solid #111827' }}>
                          <p className="text-xs font-bold" style={{ color: 'white' }}>{tutor.name}</p>
                        </div>
                        <div className="overflow-x-auto">
                          <div className="flex">
                            {filteredDaySessions.map(block => {
                              const session     = sessions.find(s => s.date === isoDate && s.tutorId === tutor.id && s.time === block.time);
                              const hasStudents = session && session.students.length > 0;
                              const isFull      = hasStudents && session!.students.length >= MAX_CAPACITY;
                              const isOutside   = !isTutorAvailable(tutor, dow, block.time) || isOnTimeOff;
                              const isAvail     = !isOutside && !hasStudents;
                              const dropState   = dropStateFor(tutor, isOutside);

                              return (
                                <div key={block.id} className="shrink-0 w-36 p-1.5"
                                  style={{
                                    background: isOutside
                                      ? 'repeating-linear-gradient(45deg,#e9ebee,#e9ebee 4px,#dfe2e6 4px,#dfe2e6 8px)'
                                      : dropState === 'valid'
                                        ? '#dbeafe'
                                        : dropState === 'invalid'
                                          ? '#fee2e2'
                                          : '#f3f4f6',
                                    borderRight: dropState === 'invalid' ? '2px solid #ef4444' : '1px solid #e5e7eb',
                                  }}
                                  onDragOver={(e) => { if (!isOutside && dropState !== 'invalid') e.preventDefault(); }}
                                  onDrop={(e) => { if (!isOutside && dropState !== 'invalid') void handleDropOnSlot(e, tutor, isoDate, block.time); }}>
                                  <div className="text-center mb-1.5">
                                    <div className="text-[10px] font-black uppercase tracking-widest" style={{ color: '#374151' }}>{block.label}</div>
                                    <div className="text-[9px] font-semibold" style={{ color: '#9ca3af' }}>{block.display}</div>
                                  </div>
                                  <div className="space-y-1" style={{ minHeight: 90 }}>
                                    {hasStudents && (
                                      <>
                                        {session!.students.map((student: any) => {
                                          const key = selectionKey(session.id, student.id);
                                          const isSelected = !!selectedRemovals[key];
                                          return (
                                            <div key={student.rowId || student.id}
                                              className="flex items-center gap-1.5 px-1.5 py-1.5 rounded-lg transition-all"
                                              draggable={!!student.rowId && !bulkRemoveMode}
                                              onDragStart={(e) => {
                                                if (!student.rowId || bulkRemoveMode) return;
                                                const payload: DragStudentPayload = {
                                                  rowId: student.rowId,
                                                  studentId: student.id,
                                                  fromSessionId: session.id,
                                                  topic: student.topic ?? null,
                                                };
                                                e.dataTransfer.setData('application/x-schedule-student', JSON.stringify(payload));
                                                e.dataTransfer.effectAllowed = 'move';
                                                setDraggingTopic(student.topic ?? null);
                                              }}
                                              onDragEnd={() => setDraggingTopic(null)}
                                              style={{
                                                ...(student.status === 'no-show'
                                                  ? { background: '#f8fafc', border: '1.5px solid #94a3b8', opacity: 0.65, boxShadow: '0 4px 10px rgba(148,163,184,0.16), inset 0 0 0 1px rgba(148,163,184,0.2)' }
                                                  : student.status === 'present'
                                                    ? { background: '#dcfce7', border: '1.5px solid #16a34a', boxShadow: '0 6px 14px rgba(22,163,74,0.16), 0 1px 0 rgba(22,163,74,0.18), inset 0 0 0 1px rgba(255,255,255,0.5)' }
                                                    : { background: palette.bg, border: `1.5px solid ${palette.border}`, boxShadow: '0 5px 12px rgba(99,102,241,0.1), 0 1px 0 rgba(17,24,39,0.12)' }),
                                                ...(bulkRemoveMode ? { outline: isSelected ? '2px solid rgba(124,58,237,0.32)' : 'none', outlineOffset: 0 } : {}),
                                              }}
                                              onClick={(e) => {
                                                e.stopPropagation();
                                                if (bulkRemoveMode) {
                                                  toggleRemovalSelection(session.id, student.id, student.name);
                                                  return;
                                                }
                                                setSelectedSessionWithNotes({ ...session, activeStudent: student, dayName: dayLabel, date: isoDate, tutorName: tutor.name, block });
                                              }}>
                                              <button
                                                onClick={async e => {
                                                  e.stopPropagation();
                                                  const next = student.status === 'present' ? 'scheduled' : 'present';
                                                  await updateAttendance({ sessionId: session.id, studentId: student.id, status: next });
                                                  logEvent('attendance_marked', { status: next, studentName: student.name, source: 'week_grid' });
                                                  refetch();
                                                }}
                                                className="shrink-0 w-3 h-3 rounded flex items-center justify-center"
                                                style={student.status === 'present'
                                                  ? { background: '#16a34a', border: '1.5px solid #16a34a' }
                                                  : { background: 'white', border: '1.5px solid #d1d5db' }}>
                                                {student.status === 'present' && <Check size={7} strokeWidth={3} color="white" />}
                                              </button>
                                              <button
                                                onClick={async e => {
                                                  e.stopPropagation();
                                                  const sid = student.rowId || student.id;
                                                  if (removingId !== sid) { setRemovingId(sid); return; }
                                                  setRemovingId(null);
                                                  await removeStudentFromSession({ sessionId: session.id, studentId: student.id });
                                                  logEvent('student_removed', { source: 'week_grid_mobile', sessionId: session.id, studentId: student.id });
                                                  refetch();
                                                }}
                                                onBlur={() => setRemovingId(null)}
                                                className="shrink-0 w-3 h-3 rounded flex items-center justify-center transition-all"
                                                style={removingId === (student.rowId || student.id)
                                                  ? { background: '#fee2e2', color: '#dc2626' }
                                                  : { background: 'transparent', color: '#6b7280' }}>
                                                <Trash2 size={7} strokeWidth={2} />
                                              </button>
                                              <div className="flex-1 min-w-0"
                                                style={{ cursor: bulkRemoveMode ? 'pointer' : 'default' }}>
                                                <div className="flex items-center gap-1">
                                                  <p className="text-[10px] font-bold leading-none truncate" style={{ color: '#111827', textDecoration: student.status === 'no-show' ? 'line-through' : 'none' }}>{student.name}</p>
                                                  {attendanceBadge(student.status) && (
                                                    <span
                                                      className="text-[7px] font-black px-1 py-0.5 rounded uppercase tracking-wider"
                                                      style={{
                                                        background: attendanceBadge(student.status)!.bg,
                                                        color: attendanceBadge(student.status)!.color,
                                                        border: `1px solid ${attendanceBadge(student.status)!.border}`,
                                                      }}
                                                    >
                                                      {student.status === 'present' ? 'P' : 'NS'}
                                                    </span>
                                                  )}
                                                </div>
                                                <p className="text-[8px] leading-none mt-0.5 truncate" style={{ color: palette.tag }}>
                                                  {student.topic}{student.grade ? ` · Gr.${student.grade}` : ''}{student.seriesId ? ' ↺' : ''}
                                                </p>
                                              </div>
                                              {bulkRemoveMode && (
                                                <div className="flex items-center gap-1 text-[9px] font-semibold uppercase tracking-[0.16em]" style={{ color: isSelected ? '#7c3aed' : '#6b7280' }}>
                                                  <span style={{ width: 8, height: 8, borderRadius: 999, display: 'inline-block', background: isSelected ? '#7c3aed' : '#d1d5db' }} />
                                                  {isSelected ? 'Selected' : 'Tap to select'}
                                                </div>
                                              )}
                                            </div>
                                          );
                                        })}
                                        {!isFull && (
                                          <button onClick={() => openForm(tutor, isoDate, block.time)}
                                            className="w-full py-1 rounded-lg text-[7px] font-bold uppercase transition-all"
                                            style={{ background: 'transparent', border: '1.5px dashed #d1d5db', color: '#9ca3af' }}>
                                            + ADD
                                          </button>
                                        )}
                                      </>
                                    )}
                                    {isAvail && (
                                      <div onClick={() => openForm(tutor, isoDate, block.time)}
                                        className="w-full h-full min-h-24 rounded-lg flex flex-col items-center justify-center gap-1 cursor-pointer active:scale-95 transition-all"
                                        style={{ background: '#eff6ff', border: '2px dashed #60a5fa' }}>
                                        <PlusCircle size={14} style={{ color: '#2563eb' }} />
                                        <span className="text-[8px] font-bold uppercase tracking-wider" style={{ color: '#2563eb' }}>Available</span>
                                      </div>
                                    )}
                                    {isOutside && (
                                      <div className="w-full h-full min-h-24 rounded-lg flex flex-col items-center justify-center gap-1"
                                        style={{ background: 'repeating-linear-gradient(45deg,#e9ebee,#e9ebee 4px,#dfe2e6 4px,#dfe2e6 8px)' }}>
                                        {isOnTimeOff
                                          ? <span className="text-[8px] font-black uppercase tracking-widest" style={{ color: '#dc2626' }}>{hasStudents ? 'OFF+BOOKED' : 'OFF'}</span>
                                          : <span className="text-[8px] font-semibold uppercase tracking-wider" style={{ color: '#d1d5db' }}>—</span>}
                                      </div>
                                    )}
                                  </div>
                                </div>
                              );
                            })}
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </>
            )}
          </div>
        );
      })}
      {topicDropdownRowId && topicDropdownPos && typeof document !== 'undefined' && createPortal(
        <div
          onMouseDown={e => e.stopPropagation()}
          style={{ position: 'fixed', top: topicDropdownPos.top, bottom: topicDropdownPos.bottom, left: topicDropdownPos.left, zIndex: 9999, background: 'white', border: '1px solid #e5e7eb', borderRadius: 8, boxShadow: '0 4px 16px rgba(0,0,0,0.14)', minWidth: 160, overflow: 'hidden' }}
        >
          {topicDropdownOptions.map(t => (
            <button key={t}
              onMouseDown={async () => { await updateSessionTopic({ rowId: topicDropdownRowId, topic: t }); refetch(); setTopicDropdownRowId(null); }}
              style={{ display: 'block', width: '100%', textAlign: 'left', padding: '7px 14px', fontSize: 11, fontWeight: 600, color: t === topicDropdownCurrent ? '#4f46e5' : '#111827', background: 'white', border: 'none', cursor: 'pointer' }}
              onMouseEnter={e => (e.currentTarget.style.background = '#f3f4f6')}
              onMouseLeave={e => (e.currentTarget.style.background = 'white')}
            >{t}</button>
          ))}
          {!topicDropdownOptions.includes(topicDropdownCurrent) && (
            <div style={{ padding: '7px 14px', fontSize: 11, fontWeight: 600, color: '#4f46e5', borderTop: '1px solid #f3f4f6' }}>{topicDropdownCurrent}</div>
          )}
          <button
            onMouseDown={() => { setTopicDropdownRowId(null); setTopicEditRowId(topicDropdownRowId); setTopicEditValue(topicDropdownCurrent); }}
            style={{ display: 'block', width: '100%', textAlign: 'left', padding: '7px 14px', fontSize: 11, fontWeight: 600, color: '#6b7280', background: 'white', border: 'none', borderTop: '1px solid #f3f4f6', cursor: 'pointer' }}
            onMouseEnter={e => (e.currentTarget.style.background = '#f3f4f6')}
            onMouseLeave={e => (e.currentTarget.style.background = 'white')}
          >Custom…</button>
        </div>,
        document.body
      )}
    </div>
  );
}