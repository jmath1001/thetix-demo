"use client";

import { useState, useEffect } from 'react';
import { PlusCircle, Check, X, Loader2 } from 'lucide-react';
import { updateAttendance, toISODate, dayOfWeek, type Tutor } from '@/lib/useScheduleData';
import { getSessionsForDay } from '@/components/constants';
import { MAX_CAPACITY } from '@/components/constants';
import { ACTIVE_DAYS, DAY_NAMES, TUTOR_PALETTES } from './scheduleConstants';
import { isTutorAvailable } from './scheduleUtils';

// ─── Topic options ────────────────────────────────────────────────────────────
const MATH_TOPICS = ['Algebra', 'Geometry', 'Pre-Calculus', 'Calculus', 'Statistics', 'SAT Math', 'ACT Math', 'Math'];
const ENG_TOPICS  = ['Reading', 'Writing', 'Grammar', 'Essay', 'SAT English', 'ACT English', 'English'];

// ─── Inline form state ────────────────────────────────────────────────────────
interface InlineForm {
  query: string;
  student: any | null;
  topic: string;
  saving: boolean;
  error: string | null;
}

const emptyForm = (tutor: Tutor): InlineForm => ({
  query: '',
  student: null,
  topic: tutor.cat === 'math' ? 'Math' : 'English',
  saving: false,
  error: null,
});

const slotKey = (tutorId: string, date: string, time: string) => `${tutorId}|${date}|${time}`;

// ─── Props ────────────────────────────────────────────────────────────────────
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
  }) => Promise<void>;
  refetch: () => void;
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
  refetch,
}: WeekViewProps) {
  const [forms, setForms]               = useState<Record<string, InlineForm>>({});
  const [openDropdown, setOpenDropdown] = useState<string | null>(null);

  // ── form helpers ──────────────────────────────────────────────────────────

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

  const getSuggestions = (key: string) => {
    const q = forms[key]?.query?.trim().toLowerCase();
    if (!q || forms[key]?.student) return [];
    return students.filter(s => s.name?.toLowerCase().includes(q)).slice(0, 7);
  };

  const topicsFor = (tutor: Tutor) =>
    tutor.cat === 'math' ? MATH_TOPICS : ENG_TOPICS;

  const handleSave = async (key: string, tutor: Tutor, date: string, block: any) => {
    const form = forms[key];
    if (!form?.student || !form.topic) return;
    patchForm(key, { saving: true, error: null });
    try {
      await onInlineBook({ tutorId: tutor.id, date, time: block.time, student: form.student, topic: form.topic });
      closeForm(key);
      refetch();
    } catch (err: any) {
      patchForm(key, { saving: false, error: err?.message || 'Booking failed — please try again.' });
    }
  };

  // Close dropdown on outside click
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (!(e.target as Element).closest('[data-inline-form]')) setOpenDropdown(null);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  // ── inline form renderer ──────────────────────────────────────────────────

  const renderInlineForm = (tutor: Tutor, date: string, block: any, palette: any) => {
    const key   = slotKey(tutor.id, date, block.time);
    const form  = forms[key];
    if (!form) return null;
    const hints   = getSuggestions(key);
    const canSave = !!form.student && !!form.topic && !form.saving;
    const topics  = topicsFor(tutor);

    return (
      <div
        data-inline-form
        className="flex flex-col gap-2 p-2.5 rounded-xl"
        style={{ background: 'white', border: '1.5px solid #6366f1', boxShadow: '0 2px 14px rgba(99,102,241,0.13)', minHeight: 110 }}
      >
        {/* header */}
        <div className="flex items-center justify-between">
          <span className="text-[9px] font-black uppercase tracking-widest" style={{ color: '#6366f1' }}>Quick Add</span>
          <button onClick={() => closeForm(key)} className="w-4 h-4 flex items-center justify-center rounded hover:bg-gray-100" style={{ color: '#9ca3af' }}>
            <X size={10} />
          </button>
        </div>

        {/* student input */}
        <div className="relative" data-inline-form>
          <input
            autoFocus
            type="text"
            placeholder="Student name…"
            value={form.student ? form.student.name : form.query}
            onChange={e => { patchForm(key, { query: e.target.value, student: null }); setOpenDropdown(key); }}
            onFocus={() => setOpenDropdown(key)}
            className="w-full text-xs font-semibold rounded-lg px-2.5 py-1.5 outline-none"
            style={{ background: '#f3f4f6', border: '1px solid #e5e7eb', color: '#111827' }}
          />
          {form.student && (
            <button onMouseDown={e => { e.preventDefault(); patchForm(key, { student: null, query: '' }); }} className="absolute right-2 top-1/2 -translate-y-1/2" style={{ color: '#9ca3af' }}>
              <X size={9} />
            </button>
          )}
          {/* suggestions */}
          {openDropdown === key && hints.length > 0 && !form.student && (
            <div data-inline-form className="absolute z-50 left-0 right-0 rounded-lg overflow-hidden"
              style={{ top: 'calc(100% + 3px)', background: 'white', border: '1px solid #e5e7eb', boxShadow: '0 6px 20px rgba(0,0,0,0.12)' }}>
              {hints.map(s => (
                <button key={s.id} className="w-full text-left px-3 py-2 text-xs font-semibold transition-colors"
                  style={{ color: '#111827', borderBottom: '1px solid #f3f4f6' }}
                  onMouseEnter={e => (e.currentTarget.style.background = '#f3f4f6')}
                  onMouseLeave={e => (e.currentTarget.style.background = 'white')}
                  onMouseDown={e => {
                    e.preventDefault();
                    const allTopics = [...MATH_TOPICS, ...ENG_TOPICS];
                    const autoTopic = s.subject
                      ? (allTopics.find(t => t.toLowerCase() === s.subject?.toLowerCase()) ?? form.topic)
                      : form.topic;
                    patchForm(key, { student: s, query: s.name, topic: autoTopic });
                    setOpenDropdown(null);
                  }}>
                  <span>{s.name}</span>
                  {s.grade   && <span className="ml-2 text-[9px] font-normal" style={{ color: '#9ca3af' }}>Gr.{s.grade}</span>}
                  {s.subject && <span className="ml-2 text-[9px] font-normal" style={{ color: '#a5b4fc' }}>{s.subject}</span>}
                </button>
              ))}
            </div>
          )}
        </div>

        {/* topic */}
        <select value={form.topic} onChange={e => patchForm(key, { topic: e.target.value })}
          className="w-full text-xs font-semibold rounded-lg px-2.5 py-1.5 outline-none"
          style={{ background: '#f3f4f6', border: '1px solid #e5e7eb', color: '#374151' }}>
          {topics.map(t => <option key={t} value={t}>{t}</option>)}
          <option value="Other">Other</option>
        </select>

        {form.error && <p className="text-[9px] font-semibold" style={{ color: '#dc2626' }}>{form.error}</p>}

        <button onClick={() => handleSave(key, tutor, date, block)} disabled={!canSave}
          className="w-full py-1.5 rounded-lg text-[10px] font-black uppercase tracking-wider flex items-center justify-center gap-1.5 transition-all"
          style={{ background: canSave ? '#6366f1' : '#e5e7eb', color: canSave ? 'white' : '#9ca3af', cursor: canSave ? 'pointer' : 'not-allowed' }}>
          {form.saving ? <><Loader2 size={10} className="animate-spin" /> Saving…</> : 'Book'}
        </button>
      </div>
    );
  };

  // ── available slot / add-more wrappers ────────────────────────────────────

  const renderAvailableSlot = (tutor: Tutor, date: string, block: any, palette: any) => {
    const key = slotKey(tutor.id, date, block.time);
    if (forms[key]) return renderInlineForm(tutor, date, block, palette);
    return (
      <div onClick={() => openForm(tutor, date, block.time)}
        className="w-full h-full min-h-[110px] rounded-lg flex flex-col items-center justify-center gap-1 cursor-pointer transition-all"
        style={{ background: '#eaf7ef', border: '2px dashed #86efac' }}
        onMouseEnter={e => { e.currentTarget.style.background = '#d4f2e3'; e.currentTarget.style.borderColor = '#4ade80'; }}
        onMouseLeave={e => { e.currentTarget.style.background = '#eaf7ef'; e.currentTarget.style.borderColor = '#86efac'; }}>
        <PlusCircle size={14} style={{ color: '#22c55e' }} />
        <span className="text-[9px] font-bold uppercase tracking-widest" style={{ color: '#22c55e' }}>Available</span>
      </div>
    );
  };

  const renderAddMore = (tutor: Tutor, date: string, block: any, session: any, palette: any) => {
    const key = slotKey(tutor.id, date, block.time);
    if (forms[key]) return renderInlineForm(tutor, date, block, palette);
    return (
      <button onClick={() => openForm(tutor, date, block.time)}
        className="mt-auto py-1 rounded-lg text-[10px] font-bold uppercase tracking-wider transition-all w-full"
        style={{ background: 'transparent', border: '1.5px dashed #d1d5db', color: '#9ca3af' }}
        onMouseEnter={e => { e.currentTarget.style.background = '#1f2937'; e.currentTarget.style.color = 'white'; e.currentTarget.style.borderColor = '#1f2937'; }}
        onMouseLeave={e => { e.currentTarget.style.background = 'transparent'; e.currentTarget.style.color = '#9ca3af'; e.currentTarget.style.borderColor = '#d1d5db'; }}>
        + ADD ({MAX_CAPACITY - session.students.length})
      </button>
    );
  };

  // ─────────────────────────────────────────────────────────────────────────
  // Render
  // ─────────────────────────────────────────────────────────────────────────

  return (
    <div className="max-w-[1600px] mx-auto p-3 md:p-6 space-y-10 md:space-y-14">
      {activeDates.map((date) => {
        const isoDate  = toISODate(date);
        const dow      = dayOfWeek(isoDate);
        const dayIdx   = ACTIVE_DAYS.indexOf(dow);
        const dayLabel = DAY_NAMES[dayIdx];
        const dateLabel = date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
        const isToday  = isoDate === toISODate(new Date());
        const activeTutors = tutors.filter(t =>
          t.availability.includes(dow) &&
          (selectedTutorFilter === null || t.id === selectedTutorFilter)
        );
        const daySessions = getSessionsForDay(dow);

        return (
          <div key={isoDate} className="space-y-3 md:space-y-4">
            {/* Day header */}
            <div className="flex items-center gap-3 md:gap-4 px-1">
              <div className="flex items-baseline gap-3">
                <h2 className="text-3xl md:text-4xl font-bold tracking-tight leading-none"
                  style={{ color: isToday ? '#dc2626' : '#1f2937', fontFamily: 'ui-serif, Georgia, serif' }}>
                  {dayLabel}
                </h2>
                <span className="text-base md:text-lg font-semibold" style={{ color: isToday ? '#dc2626' : '#6b7280' }}>
                  {dateLabel}
                  {isToday && (
                    <span className="ml-2 text-[9px] font-bold px-2 py-0.5 rounded-full align-middle uppercase tracking-wider"
                      style={{ background: '#fef2f2', border: '1px solid #fca5a5', color: '#dc2626' }}>Today</span>
                  )}
                </span>
              </div>
              <div className="h-px grow rounded-full"
                style={{ background: isToday ? 'linear-gradient(90deg, #fca5a5, transparent)' : 'linear-gradient(90deg, #e5e7eb, transparent)' }} />
            </div>

            {activeTutors.length === 0 ? (
              <div className="rounded-xl p-6 text-center border border-dashed" style={{ borderColor: '#e5e7eb' }}>
                <p className="text-xs font-medium italic" style={{ color: '#9ca3af' }}>No tutors available</p>
              </div>
            ) : (
              <>
                {/* Desktop table */}
                <div className="hidden md:block rounded-xl overflow-hidden"
                  style={{ background: 'white', border: '1px solid #e5e7eb', boxShadow: '0 1px 8px rgba(0,0,0,0.06)' }}>
                  <div className="overflow-x-auto">
                    <table className="border-collapse" style={{ minWidth: '100%', width: 'max-content', borderCollapse: 'separate', borderSpacing: 0 }}>
                      <thead>
                        <tr style={{ background: '#1f2937', borderBottom: '1px solid #111827' }}>
                          <th className="px-2 py-2 text-left text-xs font-bold uppercase tracking-wider"
                            style={{ color: 'rgba(255,255,255,0.5)', borderRight: '1px solid rgba(255,255,255,0.08)', width: 1, whiteSpace: 'nowrap', position: 'sticky', left: 0, top: 0, zIndex: 4, background: '#1f2937' }}>
                            Instructor
                          </th>
                          {daySessions.map(block => (
                            <th key={block.id} className="px-3 py-2 text-center"
                              style={{ borderRight: '1px solid rgba(255,255,255,0.08)', minWidth: 160, position: 'sticky', top: 0, background: '#1f2937', zIndex: 3 }}>
                              <div className="text-sm font-black uppercase tracking-wider" style={{ color: 'rgba(255,255,255,0.9)' }}>{block.label}</div>
                              <div className="text-xs font-semibold mt-0.5" style={{ color: 'rgba(255,255,255,0.45)' }}>{block.display}</div>
                            </th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {activeTutors.map(tutor => {
                          const palette = TUTOR_PALETTES[tutorPaletteMap[tutor.id] ?? 0];
                          return (
                            <tr key={tutor.id} style={{ borderBottom: '1px solid #e5e7eb' }}>
                              <td className="px-2 py-2 align-middle"
                                style={{ background: '#f0f2f5', borderRight: '1px solid #d1d5db', borderBottom: '1px solid #e5e7eb', position: 'sticky', left: 0, zIndex: 1, width: 1, whiteSpace: 'nowrap' }}>
                                <div className="flex items-center gap-2">
                                  <div className="w-6 h-6 rounded-full flex items-center justify-center text-[9px] font-bold shrink-0"
                                    style={{ background: palette.bg, color: palette.text, border: `1px solid ${palette.border}` }}>
                                    {tutor.name.split(' ').map((n: string) => n[0]).join('').slice(0, 2).toUpperCase()}
                                  </div>
                                  <div>
                                    <p className="text-xs font-bold leading-tight whitespace-nowrap" style={{ color: '#1f2937' }}>{tutor.name}</p>
                                    <span className="text-[8px] font-bold px-1 py-0.5 rounded mt-0.5 inline-block"
                                      style={{ background: tutor.cat === 'math' ? '#dbeafe' : '#fce7f3', color: tutor.cat === 'math' ? '#1d4ed8' : '#be185d' }}>
                                      {tutor.cat === 'math' ? 'Math' : 'English'}
                                    </span>
                                  </div>
                                </div>
                              </td>

                              {daySessions.map(block => {
                                const session     = sessions.find(s => s.date === isoDate && s.tutorId === tutor.id && s.time === block.time);
                                const hasStudents = session && session.students.length > 0;
                                const isOnTimeOff = timeOff.some(t => t.tutorId === tutor.id && t.date === isoDate);
                                const isFull      = hasStudents && session!.students.length >= MAX_CAPACITY;
                                const isOutside   = !isTutorAvailable(tutor, dow, block.time) || isOnTimeOff;
                                const isAvail     = !isOutside && !hasStudents;
                                const timeOffNote = isOnTimeOff ? timeOff.find(t => t.tutorId === tutor.id && t.date === isoDate)?.note : null;

                                return (
                                  <td key={block.id} className="p-1.5 align-top"
                                    style={{ background: isOutside ? 'repeating-linear-gradient(45deg,#e9ebee,#e9ebee 4px,#dfe2e6 4px,#dfe2e6 8px)' : '#f3f4f6', borderRight: '1px solid #e5e7eb', borderBottom: '1px solid #e5e7eb' }}>
                                    <div className="flex flex-col gap-1 h-full min-h-[110px]">

                                      {/* Booked students */}
                                      {hasStudents && !isOnTimeOff && session!.students.map((student: any) => (
                                        <div key={student.rowId || student.id}
                                          className="p-2 rounded-lg transition-all hover:shadow-md cursor-pointer"
                                          style={
                                            student.status === 'no-show'  ? { background: 'transparent', border: '1.5px solid #d1d5db', opacity: 0.45 }
                                            : student.status === 'present' ? { background: '#edfaf3',     border: '1.5px solid #6ee7b7' }
                                            :                               { background: palette.bg,      border: `1.5px solid ${palette.border}` }
                                          }
                                          onClick={() => setSelectedSessionWithNotes({ ...session, activeStudent: student, dayName: dayLabel, date: isoDate, tutorName: tutor.name, block })}>
                                          <div className="flex justify-between items-start mb-0.5">
                                            <p className="text-xs font-bold leading-tight" style={{ color: '#111827' }}>{student.name}</p>
                                            <div className="flex items-center gap-1">
                                              {student.confirmationStatus === 'confirmed'            && <span style={{ color: '#15803d', fontSize: 10 }}>✓</span>}
                                              {student.confirmationStatus === 'cancelled'            && <span style={{ color: '#dc2626', fontSize: 10 }}>✕</span>}
                                              {student.confirmationStatus === 'reschedule_requested' && <span style={{ color: '#6d28d9', fontSize: 10 }}>↗</span>}
                                              <button
                                                onClick={async e => {
                                                  e.stopPropagation();
                                                  const next = student.status === 'present' ? 'scheduled' : 'present';
                                                  await updateAttendance({ sessionId: session.id, studentId: student.id, status: next });
                                                  refetch();
                                                }}
                                                className="shrink-0 w-4 h-4 rounded flex items-center justify-center transition-all"
                                                style={student.status === 'present'
                                                  ? { background: '#059669', border: '1.5px solid #059669' }
                                                  : { background: 'white', border: '1.5px solid #d1d5db' }}>
                                                {student.status === 'present' && <Check size={9} strokeWidth={3} color="white" />}
                                              </button>
                                            </div>
                                          </div>
                                          <p className="text-[10px] font-semibold uppercase tracking-tight" style={{ color: palette.tag }}>{student.topic}</p>
                                          {student.grade && <p className="text-[9px] font-medium mt-0.5" style={{ color: '#9ca3af' }}>Grade {student.grade}</p>}
                                          {student.notes && <p className="text-[9px] mt-1 italic truncate" style={{ color: '#9ca3af' }}>📝 {student.notes}</p>}
                                        </div>
                                      ))}

                                      {/* Add-more / available / blocked */}
                                      {hasStudents && !isOnTimeOff && !isFull && renderAddMore(tutor, isoDate, block, session, palette)}
                                      {isAvail && renderAvailableSlot(tutor, isoDate, block, palette)}
                                      {isOutside && (
                                        <div className="w-full h-full min-h-[110px] rounded-lg flex flex-col items-center justify-center gap-1"
                                          style={{ background: 'repeating-linear-gradient(45deg,#e9ebee,#e9ebee 4px,#dfe2e6 4px,#dfe2e6 8px)' }}>
                                          {isOnTimeOff ? (
                                            <>
                                              <span className="text-[9px] font-black uppercase tracking-widest" style={{ color: '#dc2626' }}>OFF</span>
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
                  {activeTutors.map(tutor => {
                    const palette = TUTOR_PALETTES[tutorPaletteMap[tutor.id] ?? 0];
                    const isOnTimeOff = timeOff.some(t => t.tutorId === tutor.id && t.date === isoDate);
                    return (
                      <div key={tutor.id} className="rounded-xl overflow-hidden"
                        style={{ background: 'white', border: '1px solid #e5e7eb', boxShadow: '0 1px 6px rgba(0,0,0,0.06)' }}>
                        <div className="p-2.5" style={{ background: '#1f2937', borderBottom: '1px solid #111827' }}>
                          <p className="text-xs font-bold" style={{ color: 'white' }}>{tutor.name}</p>
                        </div>
                        <div className="overflow-x-auto">
                          <div className="flex">
                            {daySessions.map(block => {
                              const session     = sessions.find(s => s.date === isoDate && s.tutorId === tutor.id && s.time === block.time);
                              const hasStudents = session && session.students.length > 0;
                              const isFull      = hasStudents && session!.students.length >= MAX_CAPACITY;
                              const isOutside   = !isTutorAvailable(tutor, dow, block.time) || isOnTimeOff;
                              const isAvail     = !isOutside && !hasStudents;

                              return (
                                <div key={block.id} className="flex-shrink-0 w-40 p-1.5"
                                  style={{ background: isOutside ? 'repeating-linear-gradient(45deg,#e9ebee,#e9ebee 4px,#dfe2e6 4px,#dfe2e6 8px)' : '#f3f4f6', borderRight: '1px solid #e5e7eb' }}>
                                  <div className="text-center mb-1.5">
                                    <div className="text-[10px] font-black uppercase tracking-widest" style={{ color: '#374151' }}>{block.label}</div>
                                    <div className="text-[9px] font-semibold" style={{ color: '#9ca3af' }}>{block.display}</div>
                                  </div>
                                  <div className="space-y-1" style={{ minHeight: 110 }}>
                                    {hasStudents && !isOnTimeOff && (
                                      <>
                                        {session!.students.map((student: any) => (
                                          <div key={student.rowId || student.id}
                                            className="flex items-center gap-1.5 px-1.5 py-1.5 rounded-lg transition-all"
                                            style={
                                              student.status === 'no-show'  ? { background: 'transparent', border: '1.5px solid #d1d5db', opacity: 0.4 }
                                              : student.status === 'present' ? { background: '#edfaf3', border: '1.5px solid #6ee7b7' }
                                              :                               { background: palette.bg, border: `1.5px solid ${palette.border}` }
                                            }>
                                            <button
                                              onClick={async e => {
                                                e.stopPropagation();
                                                const next = student.status === 'present' ? 'scheduled' : 'present';
                                                await updateAttendance({ sessionId: session.id, studentId: student.id, status: next });
                                                refetch();
                                              }}
                                              className="shrink-0 w-3 h-3 rounded flex items-center justify-center"
                                              style={student.status === 'present'
                                                ? { background: '#059669', border: '1.5px solid #059669' }
                                                : { background: 'white', border: '1.5px solid #d1d5db' }}>
                                              {student.status === 'present' && <Check size={7} strokeWidth={3} color="white" />}
                                            </button>
                                            <div className="flex-1 min-w-0 cursor-pointer"
                                              onClick={() => setSelectedSessionWithNotes({ ...session, activeStudent: student, dayName: dayLabel, date: isoDate, tutorName: tutor.name, block })}>
                                              <p className="text-[10px] font-bold leading-none truncate" style={{ color: '#111827' }}>{student.name}</p>
                                              <p className="text-[8px] leading-none mt-0.5 truncate" style={{ color: palette.tag }}>
                                                {student.topic}{student.grade ? ` · Gr.${student.grade}` : ''}
                                              </p>
                                            </div>
                                          </div>
                                        ))}
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
                                        className="w-full h-full min-h-[110px] rounded-lg flex flex-col items-center justify-center gap-1 cursor-pointer active:scale-95 transition-all"
                                        style={{ background: '#eaf7ef', border: '2px dashed #86efac' }}>
                                        <PlusCircle size={14} style={{ color: '#22c55e' }} />
                                        <span className="text-[8px] font-bold uppercase tracking-wider" style={{ color: '#22c55e' }}>Available</span>
                                      </div>
                                    )}
                                    {isOutside && (
                                      <div className="w-full h-full min-h-[110px] rounded-lg flex flex-col items-center justify-center gap-1"
                                        style={{ background: 'repeating-linear-gradient(45deg,#e9ebee,#e9ebee 4px,#dfe2e6 4px,#dfe2e6 8px)' }}>
                                        {isOnTimeOff
                                          ? <span className="text-[8px] font-black uppercase tracking-widest" style={{ color: '#dc2626' }}>OFF</span>
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
    </div>
  );
}