"use client"
import { useState, useEffect, useCallback } from 'react';
import { PlusCircle, Check, Clock, Calendar as CalendarIcon, X, Loader2 } from 'lucide-react';
import { updateAttendance, toISODate, dayOfWeek, type Tutor } from '@/lib/useScheduleData';
import { getSessionsForDay } from '@/components/constants';
import { MAX_CAPACITY } from '@/components/constants';
import { ACTIVE_DAYS, DAY_NAMES, TUTOR_PALETTES } from './scheduleConstants';
import { isTutorAvailable } from './scheduleUtils';

// ─── Topic options (mirrors BookingForm) ────────────────────────────────────
const MATH_TOPICS = ['Algebra', 'Geometry', 'Pre-Calculus', 'Calculus', 'Statistics', 'SAT Math', 'ACT Math', 'Math'];
const ENG_TOPICS  = ['Reading', 'Writing', 'Grammar', 'Essay', 'SAT English', 'ACT English', 'English'];

// ─── Inline form state ───────────────────────────────────────────────────────
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

// unique per tutor + date + time block
const slotKey = (tutorId: string, date: string, time: string) => `${tutorId}|${date}|${time}`;

// ─── Props ───────────────────────────────────────────────────────────────────
interface TodayViewProps {
  tutors: Tutor[];
  sessions: any[];
  timeOff: any[];
  students: any[];
  selectedTutorFilter: string | null;
  tutorPaletteMap: Record<string, number>;
  setSelectedSessionWithNotes: (s: any) => void;
  handleGridSlotClick: (tutor: Tutor, date: string, dayName: string, block: any) => void;
  /** Called when the user confirms an inline booking.
   *  Receives the same shape as bookStudent() in useScheduleData — minus recurring. */
  onInlineBook: (params: {
    tutorId: string;
    date: string;
    time: string;
    student: any;
    topic: string;
  }) => Promise<void>;
  refetch: () => void;
  /** Controlled date — owned by MasterDeployment so weekStart stays in sync */
  selectedDate: Date;
  onDateChange: (date: Date) => void;
}

export function TodayView({
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
  selectedDate,
  onDateChange,
}: TodayViewProps) {

  // one InlineForm per slot key
  const [forms, setForms]               = useState<Record<string, InlineForm>>({});
  // which slot's student-suggestion dropdown is open
  const [openDropdown, setOpenDropdown] = useState<string | null>(null);

  const todayIso  = toISODate(selectedDate);
  const todayDow  = dayOfWeek(todayIso);
  const dayIdx    = ACTIVE_DAYS.indexOf(todayDow);
  const isToday   = toISODate(new Date()) === todayIso;
  const dayLabel  = isToday ? (DAY_NAMES[dayIdx] ?? 'Today') : (DAY_NAMES[dayIdx] ?? 'Selected Day');
  const isWeekend = !ACTIVE_DAYS.includes(todayDow);

  const daySessions = getSessionsForDay(todayDow);
  const todayTutors = tutors.filter(t =>
    t.availability.includes(todayDow) &&
    (selectedTutorFilter === null || t.id === selectedTutorFilter)
  );

  const pendingStudents = sessions
    .filter(s => s.date === todayIso)
    .flatMap(s => s.students
      .filter((st: any) => !st.confirmationStatus || st.confirmationStatus === 'pending')
      .map((st: any) => ({
        ...st,
        sessionTime: s.time,
        tutorName: tutors.find(t => t.id === s.tutorId)?.name ?? '',
        session: s,
      }))
    )
    .sort((a: any, b: any) => a.sessionTime.localeCompare(b.sessionTime));

  // ── form helpers ──────────────────────────────────────────────────────────

  const openForm = (tutor: Tutor, time: string) => {
    const key = slotKey(tutor.id, todayIso, time);
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

  // ── save ─────────────────────────────────────────────────────────────────

  const handleSave = async (key: string, tutor: Tutor, block: any) => {
    const form = forms[key];
    if (!form?.student || !form.topic) return;
    patchForm(key, { saving: true, error: null });
    try {
      await onInlineBook({
        tutorId: tutor.id,
        date:    todayIso,
        time:    block.time,
        student: form.student,
        topic:   form.topic,
      });
      closeForm(key);
      refetch();
    } catch (err: any) {
      patchForm(key, { saving: false, error: err?.message || 'Booking failed — please try again.' });
    }
  };

  // close suggestion dropdown on outside click
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (!(e.target as Element).closest('[data-inline-form]')) {
        setOpenDropdown(null);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  const handleDateChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.value) {
      onDateChange(new Date(e.target.value + 'T00:00:00'));
      setForms({});
      setOpenDropdown(null);
    }
  };

  // ── inline form (desktop) ─────────────────────────────────────────────────

  const renderInlineForm = (tutor: Tutor, block: any, palette: any) => {
    const key     = slotKey(tutor.id, todayIso, block.time);
    const form    = forms[key];
    if (!form) return null;

    const hints   = getSuggestions(key);
    const canSave = !!form.student && !!form.topic && !form.saving;
    const topics  = topicsFor(tutor);

    return (
      <div
        data-inline-form
        className="flex flex-col gap-2 p-2.5 rounded-xl"
        style={{
          background:  'white',
          border:      '1.5px solid #6366f1',
          boxShadow:   '0 2px 14px rgba(99,102,241,0.13)',
          minHeight:   100,
        }}
      >
        {/* header row */}
        <div className="flex items-center justify-between">
          <span className="text-[9px] font-black uppercase tracking-widest" style={{ color: '#6366f1' }}>Quick Add</span>
          <button
            onClick={() => closeForm(key)}
            className="w-4 h-4 flex items-center justify-center rounded hover:bg-gray-100"
            style={{ color: '#9ca3af' }}
          >
            <X size={10} />
          </button>
        </div>

        {/* student name input */}
        <div className="relative" data-inline-form>
          <input
            autoFocus
            type="text"
            placeholder="Student name…"
            value={form.student ? form.student.name : form.query}
            onChange={e => {
              patchForm(key, { query: e.target.value, student: null });
              setOpenDropdown(key);
            }}
            onFocus={() => setOpenDropdown(key)}
            className="w-full text-xs font-semibold rounded-lg px-2.5 py-1.5 outline-none"
            style={{ background: '#f3f4f6', border: '1px solid #e5e7eb', color: '#111827' }}
          />
          {form.student && (
            <button
              onMouseDown={e => { e.preventDefault(); patchForm(key, { student: null, query: '' }); }}
              className="absolute right-2 top-1/2 -translate-y-1/2"
              style={{ color: '#9ca3af' }}
            >
              <X size={9} />
            </button>
          )}

          {/* suggestions dropdown */}
          {openDropdown === key && hints.length > 0 && !form.student && (
            <div
              data-inline-form
              className="absolute z-50 left-0 right-0 rounded-lg overflow-hidden"
              style={{ top: 'calc(100% + 3px)', background: 'white', border: '1px solid #e5e7eb', boxShadow: '0 6px 20px rgba(0,0,0,0.12)' }}
            >
              {hints.map(s => (
                <button
                  key={s.id}
                  className="w-full text-left px-3 py-2 text-xs font-semibold transition-colors"
                  style={{ color: '#111827', borderBottom: '1px solid #f3f4f6' }}
                  onMouseEnter={e => (e.currentTarget.style.background = '#f3f4f6')}
                  onMouseLeave={e => (e.currentTarget.style.background = 'white')}
                  onMouseDown={e => {
                    e.preventDefault();
                    // auto-match topic from student's subject if possible
                    const allTopics = [...MATH_TOPICS, ...ENG_TOPICS];
                    const autoTopic = s.subject
                      ? (allTopics.find(t => t.toLowerCase() === s.subject?.toLowerCase()) ?? form.topic)
                      : form.topic;
                    patchForm(key, { student: s, query: s.name, topic: autoTopic });
                    setOpenDropdown(null);
                  }}
                >
                  <span>{s.name}</span>
                  {s.grade   && <span className="ml-2 text-[9px] font-normal" style={{ color: '#9ca3af' }}>Gr.{s.grade}</span>}
                  {s.subject && <span className="ml-2 text-[9px] font-normal" style={{ color: '#a5b4fc' }}>{s.subject}</span>}
                </button>
              ))}
            </div>
          )}
        </div>

        {/* topic select */}
        <select
          value={form.topic}
          onChange={e => patchForm(key, { topic: e.target.value })}
          className="w-full text-xs font-semibold rounded-lg px-2.5 py-1.5 outline-none"
          style={{ background: '#f3f4f6', border: '1px solid #e5e7eb', color: '#374151' }}
        >
          {topics.map(t => <option key={t} value={t}>{t}</option>)}
          <option value="Other">Other</option>
        </select>

        {/* inline error */}
        {form.error && (
          <p className="text-[9px] font-semibold" style={{ color: '#dc2626' }}>{form.error}</p>
        )}

        {/* save */}
        <button
          onClick={() => handleSave(key, tutor, block)}
          disabled={!canSave}
          className="w-full py-1.5 rounded-lg text-[10px] font-black uppercase tracking-wider flex items-center justify-center gap-1.5 transition-all"
          style={{
            background: canSave ? '#6366f1' : '#e5e7eb',
            color:      canSave ? 'white'   : '#9ca3af',
            cursor:     canSave ? 'pointer' : 'not-allowed',
          }}
        >
          {form.saving ? <><Loader2 size={10} className="animate-spin" /> Saving…</> : 'Book'}
        </button>
      </div>
    );
  };

  // ── available slot wrapper ────────────────────────────────────────────────

  const renderAvailableSlot = (tutor: Tutor, block: any, palette: any, minH = 100) => {
    const key = slotKey(tutor.id, todayIso, block.time);
    if (forms[key]) return renderInlineForm(tutor, block, palette);
    return (
      <div
        onClick={() => openForm(tutor, block.time)}
        className="flex-1 rounded-xl flex flex-col items-center justify-center gap-2 cursor-pointer transition-all"
        style={{ minHeight: minH, background: '#eaf7ef', border: '2px dashed #86efac' }}
        onMouseEnter={e => { e.currentTarget.style.background = '#d4f2e3'; e.currentTarget.style.borderColor = '#4ade80'; }}
        onMouseLeave={e => { e.currentTarget.style.background = '#eaf7ef'; e.currentTarget.style.borderColor = '#86efac'; }}
      >
        <PlusCircle size={14} style={{ color: '#22c55e' }} />
        <span className="text-[9px] font-bold uppercase tracking-widest" style={{ color: '#22c55e' }}>Available</span>
      </div>
    );
  };

  // ── "add more" button for partially-filled slots ──────────────────────────

  const renderAddMore = (tutor: Tutor, block: any, session: any, palette: any) => {
    const key = slotKey(tutor.id, todayIso, block.time);
    if (forms[key]) return renderInlineForm(tutor, block, palette);
    return (
      <button
        onClick={() => openForm(tutor, block.time)}
        className="py-1.5 rounded-xl text-[10px] font-bold uppercase tracking-wider transition-all w-full"
        style={{ background: 'transparent', border: '1.5px dashed #d1d5db', color: '#9ca3af' }}
        onMouseEnter={e => { e.currentTarget.style.background = '#1f2937'; e.currentTarget.style.color = 'white'; e.currentTarget.style.borderColor = '#1f2937'; }}
        onMouseLeave={e => { e.currentTarget.style.background = 'transparent'; e.currentTarget.style.color = '#9ca3af'; e.currentTarget.style.borderColor = '#d1d5db'; }}
      >
        + ADD ({MAX_CAPACITY - session.students.length})
      </button>
    );
  };

  // ─────────────────────────────────────────────────────────────────────────
  // Weekend guard
  // ─────────────────────────────────────────────────────────────────────────

  if (isWeekend) {
    return (
      <div className="max-w-[1600px] mx-auto p-2 md:p-6" style={{ background: '#fafafa', minHeight: '100%' }}>
        <div className="flex justify-end mb-4">
          <input type="date" value={todayIso} onChange={handleDateChange}
            className="text-xs font-bold border rounded-lg px-2 py-1 outline-none"
            style={{ borderColor: '#d1d5db', color: '#374151' }} />
        </div>
        <div className="flex flex-col items-center justify-center py-24 gap-3">
          <p className="text-4xl">🎉</p>
          <p className="text-lg font-bold" style={{ color: '#111827', fontFamily: 'ui-serif, Georgia, serif' }}>No sessions for this day</p>
          <p className="text-xs" style={{ color: '#9ca3af' }}>Enjoy the day off</p>
        </div>
      </div>
    );
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Main render
  // ─────────────────────────────────────────────────────────────────────────

  return (
    <div style={{ position: 'fixed', top: 108, left: 0, right: 0, bottom: 0, display: 'flex', flexDirection: 'column', overflow: 'hidden', background: '#fafafa', colorScheme: 'light' } as React.CSSProperties}>
      <div style={{ maxWidth: 1600, width: '100%', margin: '0 auto', padding: '12px 24px 24px', display: 'flex', flexDirection: 'column', flex: 1, minHeight: 0 }}>

        {/* Day header — desktop */}
        <div className="hidden md:flex items-center gap-3 mb-4 shrink-0">
          <div className="flex items-center gap-4">
            <div>
              <h2 className="text-2xl font-bold" style={{ color: '#dc2626', fontFamily: 'ui-serif, Georgia, serif' }}>{dayLabel}</h2>
              <p className="text-xs font-semibold" style={{ color: '#9ca3af' }}>
                {selectedDate.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })}
              </p>
            </div>
            <div className="flex items-center gap-2 px-3 py-1.5 rounded-xl border bg-white" style={{ borderColor: '#e5e7eb' }}>
              <CalendarIcon size={14} style={{ color: '#9ca3af' }} />
              <input type="date" value={todayIso} onChange={handleDateChange}
                className="text-xs font-bold outline-none bg-transparent"
                style={{ color: '#374151', cursor: 'pointer' }} />
            </div>
          </div>
          <div className="h-px flex-1 rounded-full" style={{ background: 'linear-gradient(90deg, #e5e7eb, transparent)' }} />
        </div>

        {/* Day header — mobile */}
        <div className="flex md:hidden items-center justify-between mb-3 shrink-0">
          <div>
            <h2 className="text-lg font-bold" style={{ color: '#dc2626', fontFamily: 'ui-serif, Georgia, serif' }}>{dayLabel}</h2>
            <p className="text-[10px] font-semibold" style={{ color: '#9ca3af' }}>
              {selectedDate.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}
            </p>
          </div>
          <div className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-xl border bg-white" style={{ borderColor: '#e5e7eb' }}>
            <CalendarIcon size={12} style={{ color: '#9ca3af' }} />
            <input type="date" value={todayIso} onChange={handleDateChange}
              className="text-xs font-bold outline-none bg-transparent"
              style={{ color: '#374151', cursor: 'pointer' }} />
          </div>
        </div>

        {todayTutors.length === 0 ? (
          <div className="rounded-xl p-8 text-center border border-dashed" style={{ borderColor: '#e5e7eb', background: 'white' }}>
            <p className="text-sm italic" style={{ color: '#9ca3af' }}>No tutors available for the selected day</p>
          </div>
        ) : (
          <div style={{ display: 'flex', gap: 16, flex: 1, minHeight: 0 }}>

            {/* ── GRID ── */}
            <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', minHeight: 0 }}>

              {/* Desktop table */}
              <div className="hidden md:block rounded-xl" style={{ background: 'white', border: '1px solid #e5e7eb', boxShadow: '0 1px 8px rgba(0,0,0,0.06)', flex: 1, minHeight: 0, overflow: 'auto' }}>
                <div style={{ minWidth: 'max-content', width: '100%' }}>
                  <table className="border-collapse w-full">
                    <thead>
                      <tr style={{ background: '#1f2937', borderBottom: '1px solid #111827' }}>
                        <th className="px-3 py-2.5 text-left text-xs font-bold uppercase tracking-wider"
                          style={{ color: 'rgba(255,255,255,0.5)', borderRight: '1px solid rgba(255,255,255,0.08)', width: 1, whiteSpace: 'nowrap', position: 'sticky', left: 0, top: 0, zIndex: 4, background: '#1f2937' }}>
                          Instructor
                        </th>
                        {daySessions.map(block => (
                          <th key={block.id} className="px-4 py-2.5 text-center"
                            style={{ borderRight: '1px solid rgba(255,255,255,0.08)', minWidth: 200, position: 'sticky', top: 0, zIndex: 3, background: '#1f2937' }}>
                            <div className="text-sm font-black uppercase tracking-wider" style={{ color: 'rgba(255,255,255,0.9)' }}>{block.label}</div>
                            <div className="text-xs font-semibold mt-0.5" style={{ color: 'rgba(255,255,255,0.45)' }}>{block.display}</div>
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {todayTutors.map(tutor => {
                        const palette     = TUTOR_PALETTES[tutorPaletteMap[tutor.id] ?? 0];
                        const isOnTimeOff = timeOff.some(t => t.tutorId === tutor.id && t.date === todayIso);
                        return (
                          <tr key={tutor.id} style={{ borderBottom: '1px solid #e5e7eb' }}>

                            {/* Tutor name cell */}
                            <td className="px-3 py-3 align-middle"
                              style={{ background: '#f0f2f5', borderRight: '1px solid #d1d5db', position: 'sticky', left: 0, zIndex: 1, width: 1, whiteSpace: 'nowrap' }}>
                              <div className="flex items-center gap-2.5">
                                <div className="w-8 h-8 rounded-full flex items-center justify-center text-xs font-bold shrink-0"
                                  style={{ background: palette.bg, color: palette.text, border: `1.5px solid ${palette.border}` }}>
                                  {tutor.name.split(' ').map((n: string) => n[0]).join('').slice(0, 2).toUpperCase()}
                                </div>
                                <div>
                                  <p className="text-sm font-bold leading-tight" style={{ color: '#1f2937' }}>{tutor.name}</p>
                                  <span className="text-[8px] font-bold px-1.5 py-0.5 rounded mt-0.5 inline-block"
                                    style={{ background: tutor.cat === 'math' ? '#dbeafe' : '#fce7f3', color: tutor.cat === 'math' ? '#1d4ed8' : '#be185d' }}>
                                    {tutor.cat === 'math' ? 'Math' : 'English'}
                                  </span>
                                </div>
                              </div>
                            </td>

                            {/* Time block cells */}
                            {daySessions.map(block => {
                              const session    = sessions.find(s => s.date === todayIso && s.tutorId === tutor.id && s.time === block.time);
                              const hasStudents = session && session.students.length > 0;
                              const isFull     = hasStudents && session!.students.length >= MAX_CAPACITY;
                              const isOutside  = !isTutorAvailable(tutor, todayDow, block.time) || isOnTimeOff;
                              const isAvail    = !isOutside && !hasStudents;
                              const timeOffNote = isOnTimeOff ? timeOff.find(t => t.tutorId === tutor.id && t.date === todayIso)?.note : null;

                              return (
                                <td key={block.id} className="p-2 align-top"
                                  style={{ background: isOutside ? 'repeating-linear-gradient(45deg,#e9ebee,#e9ebee 4px,#dfe2e6 4px,#dfe2e6 8px)' : '#f3f4f6', borderRight: '1px solid #e5e7eb', minWidth: 200 }}>
                                  <div className="flex flex-col gap-1.5 min-h-[100px]">

                                    {/* booked students */}
                                    {hasStudents && !isOnTimeOff && session!.students.map((student: any) => (
                                      <div key={student.rowId || student.id}
                                        className="p-2.5 rounded-xl cursor-pointer transition-all hover:shadow-md"
                                        style={
                                          student.status === 'no-show'  ? { background: 'transparent', border: '1.5px solid #d1d5db', opacity: 0.45 }
                                          : student.status === 'present' ? { background: '#edfaf3',     border: '1.5px solid #6ee7b7' }
                                          :                               { background: palette.bg,      border: `1.5px solid ${palette.border}` }
                                        }
                                        onClick={() => setSelectedSessionWithNotes({ ...session, activeStudent: student, dayName: dayLabel, date: todayIso, tutorName: tutor.name, block })}>
                                        <div className="flex justify-between items-start mb-1">
                                          <p className="text-sm font-bold leading-tight" style={{ color: '#111827' }}>{student.name}</p>
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
                                              className="shrink-0 w-5 h-5 rounded-md flex items-center justify-center transition-all"
                                              style={student.status === 'present'
                                                ? { background: '#059669', border: '1.5px solid #059669' }
                                                : { background: 'white', border: '1.5px solid #d1d5db' }}>
                                              {student.status === 'present' && <Check size={11} strokeWidth={3} color="white" />}
                                            </button>
                                          </div>
                                        </div>
                                        <p className="text-[10px] font-semibold uppercase tracking-tight" style={{ color: palette.tag }}>{student.topic}</p>
                                        {student.grade && <p className="text-[10px] mt-0.5" style={{ color: '#9ca3af' }}>Grade {student.grade}</p>}
                                        {student.notes && <p className="text-[10px] mt-1 italic truncate" style={{ color: '#9ca3af' }}>📝 {student.notes}</p>}
                                      </div>
                                    ))}

                                    {/* add-more / available / blocked */}
                                    {hasStudents && !isOnTimeOff && !isFull && renderAddMore(tutor, block, session, palette)}
                                    {isAvail && renderAvailableSlot(tutor, block, palette)}
                                    {isOutside && (
                                      <div className="flex-1 rounded-xl flex flex-col items-center justify-center gap-1"
                                        style={{ minHeight: 100, background: 'repeating-linear-gradient(45deg,#e9ebee,#e9ebee 4px,#dfe2e6 4px,#dfe2e6 8px)' }}>
                                        {isOnTimeOff ? (
                                          <>
                                            <span className="text-[10px] font-black uppercase tracking-widest" style={{ color: '#dc2626' }}>OFF</span>
                                            {timeOffNote && <span className="text-[9px] font-medium text-center px-2" style={{ color: '#9ca3af' }}>{timeOffNote}</span>}
                                          </>
                                        ) : (
                                          <span className="text-[10px] font-semibold uppercase tracking-wider" style={{ color: '#d1d5db' }}>—</span>
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
              <div className="md:hidden space-y-2 overflow-y-auto flex-1 min-h-0">
                {todayTutors.map(tutor => {
                  const palette     = TUTOR_PALETTES[tutorPaletteMap[tutor.id] ?? 0];
                  const isOnTimeOff = timeOff.some(t => t.tutorId === tutor.id && t.date === todayIso);
                  return (
                    <div key={tutor.id} className="rounded-xl overflow-hidden"
                      style={{ background: 'white', border: '1px solid #e5e7eb', boxShadow: '0 1px 6px rgba(0,0,0,0.06)' }}>
                      <div className="p-2.5" style={{ background: '#1f2937', borderBottom: '1px solid #111827' }}>
                        <p className="text-xs font-bold" style={{ color: 'rgba(255,255,255,0.85)' }}>{tutor.name}</p>
                      </div>
                      <div className="overflow-x-auto">
                        <div className="flex">
                          {daySessions.map(block => {
                            const session     = sessions.find(s => s.date === todayIso && s.tutorId === tutor.id && s.time === block.time);
                            const hasStudents = session && session.students.length > 0;
                            const isFull      = hasStudents && session!.students.length >= MAX_CAPACITY;
                            const isOutside   = !isTutorAvailable(tutor, todayDow, block.time) || isOnTimeOff;
                            const isAvail     = !isOutside && !hasStudents;

                            return (
                              <div key={block.id} className="flex-shrink-0 w-40 p-1.5"
                                style={{ background: isOutside ? 'repeating-linear-gradient(45deg,#e9ebee,#e9ebee 4px,#dfe2e6 4px,#dfe2e6 8px)' : '#f3f4f6', borderRight: '1px solid #e5e7eb' }}>
                                <div className="text-center mb-1.5">
                                  <div className="text-[10px] font-black uppercase tracking-widest" style={{ color: '#374151' }}>{block.label}</div>
                                  <div className="text-[9px] font-semibold" style={{ color: '#9ca3af' }}>{block.display}</div>
                                </div>
                                <div className="space-y-1" style={{ minHeight: 64 }}>
                                  {hasStudents && !isOnTimeOff && (
                                    <>
                                      {session!.students.map((student: any) => (
                                        <div key={student.rowId || student.id}
                                          className="flex items-center gap-1.5 px-1.5 py-1.5 rounded-lg transition-all"
                                          style={
                                            student.status === 'no-show'  ? { background: 'transparent', border: '1.5px solid #e5e7eb', opacity: 0.4 }
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
                                            onClick={() => setSelectedSessionWithNotes({ ...session, activeStudent: student, dayName: dayLabel, date: todayIso, tutorName: tutor.name, block })}>
                                            <p className="text-[10px] font-bold leading-none truncate" style={{ color: '#111827' }}>{student.name}</p>
                                            <p className="text-[8px] leading-none mt-0.5 truncate" style={{ color: palette.tag }}>
                                              {student.topic}{student.grade ? ` · Gr.${student.grade}` : ''}
                                            </p>
                                          </div>
                                        </div>
                                      ))}
                                      {!isFull && (
                                        <button onClick={() => openForm(tutor, block.time)}
                                          className="w-full py-1 rounded-lg text-[7px] font-bold uppercase transition-all"
                                          style={{ background: 'transparent', border: '1.5px dashed #d1d5db', color: '#9ca3af' }}>
                                          + ADD
                                        </button>
                                      )}
                                    </>
                                  )}
                                  {isAvail && (
                                    <div onClick={() => openForm(tutor, block.time)}
                                      className="w-full h-full rounded-lg flex flex-col items-center justify-center gap-1 cursor-pointer active:scale-95 transition-all"
                                      style={{ minHeight: 56, background: '#eaf7ef', border: '2px dashed #86efac' }}>
                                      <PlusCircle size={12} style={{ color: '#22c55e' }} />
                                      <span className="text-[8px] font-bold uppercase tracking-wider" style={{ color: '#22c55e' }}>Available</span>
                                    </div>
                                  )}
                                  {isOutside && (
                                    <div className="w-full rounded-lg flex flex-col items-center justify-center gap-1"
                                      style={{ minHeight: 56, background: 'repeating-linear-gradient(45deg,#e9ebee,#e9ebee 4px,#dfe2e6 4px,#dfe2e6 8px)' }}>
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

              {/* ── Mobile bottom-sheet for inline booking ── */}
              {(() => {
                // Find any open form that belongs to a mobile slot
                const openKey = Object.keys(forms).find(k => forms[k]);
                if (!openKey) return null;
                const [tutorId, , blockTime] = openKey.split('|');
                const tutor = todayTutors.find(t => t.id === tutorId);
                const block = daySessions.find(b => b.time === blockTime);
                if (!tutor || !block) return null;
                const form = forms[openKey];
                const hints = getSuggestions(openKey);
                const canSave = !!form.student && !!form.topic && !form.saving;
                const topics = topicsFor(tutor);
                return (
                  <div className="md:hidden fixed inset-0 z-50 flex flex-col justify-end"
                    style={{ background: 'rgba(0,0,0,0.4)' }}
                    onMouseDown={e => { if (e.target === e.currentTarget) closeForm(openKey); }}>
                    <div className="rounded-t-2xl overflow-hidden"
                      style={{ background: 'white', boxShadow: '0 -4px 24px rgba(0,0,0,0.15)' }}>
                      {/* Handle */}
                      <div className="flex justify-center pt-3 pb-1">
                        <div className="w-10 h-1 rounded-full" style={{ background: '#e5e7eb' }} />
                      </div>
                      {/* Header */}
                      <div className="flex items-center justify-between px-4 pb-3 pt-1">
                        <div>
                          <p className="text-xs font-black uppercase tracking-widest" style={{ color: '#6366f1' }}>Quick Add</p>
                          <p className="text-[11px] font-semibold mt-0.5" style={{ color: '#6b7280' }}>
                            {tutor.name} · {block.label} ({block.display})
                          </p>
                        </div>
                        <button onClick={() => closeForm(openKey)}
                          className="w-8 h-8 flex items-center justify-center rounded-full"
                          style={{ background: '#f3f4f6', color: '#6b7280' }}>
                          <X size={14} />
                        </button>
                      </div>
                      {/* Form body */}
                      <div className="px-4 pb-6 space-y-3" data-inline-form>
                        {/* Student input */}
                        <div className="relative" data-inline-form>
                          <input
                            autoFocus
                            type="text"
                            placeholder="Student name…"
                            value={form.student ? form.student.name : form.query}
                            onChange={e => {
                              patchForm(openKey, { query: e.target.value, student: null });
                              setOpenDropdown(openKey);
                            }}
                            onFocus={() => setOpenDropdown(openKey)}
                            className="w-full text-sm font-semibold rounded-xl px-4 py-3 outline-none"
                            style={{ background: '#f3f4f6', border: '1.5px solid #e5e7eb', color: '#111827' }}
                          />
                          {form.student && (
                            <button
                              onMouseDown={e => { e.preventDefault(); patchForm(openKey, { student: null, query: '' }); }}
                              className="absolute right-3 top-1/2 -translate-y-1/2"
                              style={{ color: '#9ca3af' }}>
                              <X size={14} />
                            </button>
                          )}
                          {/* Suggestions — render above the input on mobile */}
                          {openDropdown === openKey && hints.length > 0 && !form.student && (
                            <div
                              data-inline-form
                              className="absolute left-0 right-0 rounded-xl overflow-hidden"
                              style={{ bottom: 'calc(100% + 4px)', background: 'white', border: '1px solid #e5e7eb', boxShadow: '0 -4px 16px rgba(0,0,0,0.1)' }}>
                              {hints.map(s => (
                                <button
                                  key={s.id}
                                  className="w-full text-left px-4 py-3 text-sm font-semibold transition-colors"
                                  style={{ color: '#111827', borderBottom: '1px solid #f3f4f6' }}
                                  onMouseDown={e => {
                                    e.preventDefault();
                                    const allTopics = [...MATH_TOPICS, ...ENG_TOPICS];
                                    const autoTopic = s.subject
                                      ? (allTopics.find(t => t.toLowerCase() === s.subject?.toLowerCase()) ?? form.topic)
                                      : form.topic;
                                    patchForm(openKey, { student: s, query: s.name, topic: autoTopic });
                                    setOpenDropdown(null);
                                  }}>
                                  <span>{s.name}</span>
                                  {s.grade && <span className="ml-2 text-xs font-normal" style={{ color: '#9ca3af' }}>Gr.{s.grade}</span>}
                                  {s.subject && <span className="ml-2 text-xs font-normal" style={{ color: '#a5b4fc' }}>{s.subject}</span>}
                                </button>
                              ))}
                            </div>
                          )}
                        </div>
                        {/* Topic */}
                        <select
                          value={form.topic}
                          onChange={e => patchForm(openKey, { topic: e.target.value })}
                          className="w-full text-sm font-semibold rounded-xl px-4 py-3 outline-none"
                          style={{ background: '#f3f4f6', border: '1.5px solid #e5e7eb', color: '#374151' }}>
                          {topics.map(t => <option key={t} value={t}>{t}</option>)}
                          <option value="Other">Other</option>
                        </select>
                        {/* Error */}
                        {form.error && (
                          <p className="text-xs font-semibold" style={{ color: '#dc2626' }}>{form.error}</p>
                        )}
                        {/* Book button */}
                        <button
                          onClick={() => handleSave(openKey, tutor, block)}
                          disabled={!canSave}
                          className="w-full py-3.5 rounded-xl text-sm font-black uppercase tracking-wider flex items-center justify-center gap-2 transition-all"
                          style={{
                            background: canSave ? '#6366f1' : '#e5e7eb',
                            color: canSave ? 'white' : '#9ca3af',
                          }}>
                          {form.saving ? <><Loader2 size={14} className="animate-spin" /> Saving…</> : 'Book Student'}
                        </button>
                      </div>
                    </div>
                  </div>
                );
              })()}
            </div>

            {/* ── PENDING PANEL ── */}
            <div className="hidden md:flex flex-col shrink-0" style={{ width: 220, minHeight: 0 }}>
              <div className="rounded-xl overflow-hidden flex flex-col"
                style={{ background: 'white', border: '1px solid #e5e7eb', boxShadow: '0 1px 8px rgba(0,0,0,0.06)', flex: 1, minHeight: 0 }}>
                <div className="px-3 py-2.5 shrink-0" style={{ background: '#f3f4f6', borderBottom: '1px solid #e5e7eb' }}>
                  <div className="flex items-center justify-between">
                    <p className="text-[10px] font-black uppercase tracking-widest" style={{ color: '#374151' }}>Needs Confirmation</p>
                    {pendingStudents.length > 0 && (
                      <span className="text-[9px] font-black px-1.5 py-0.5 rounded-full" style={{ background: '#dc2626', color: 'white' }}>
                        {pendingStudents.length}
                      </span>
                    )}
                  </div>
                </div>
                <div className="overflow-y-auto flex-1 p-2">
                  {pendingStudents.length === 0 ? (
                    <div className="flex flex-col items-center justify-center h-full gap-2 py-8">
                      <div className="w-8 h-8 rounded-full flex items-center justify-center" style={{ background: '#dcfce7' }}>
                        <Check size={14} style={{ color: '#16a34a' }} />
                      </div>
                      <p className="text-[10px] font-semibold text-center" style={{ color: '#9ca3af' }}>All confirmed</p>
                    </div>
                  ) : (
                    <div className="space-y-1.5">
                      {pendingStudents.map((student: any, idx: number) => (
                        <div key={`${student.rowId || student.id}-${idx}`}
                          className="p-2.5 rounded-lg cursor-pointer transition-all hover:shadow-sm"
                          style={{ background: '#f9fafb', border: '1px solid #e5e7eb' }}
                          onClick={() => setSelectedSessionWithNotes({
                            ...student.session,
                            activeStudent: student,
                            dayName: dayLabel,
                            date: todayIso,
                            tutorName: student.tutorName,
                            block: daySessions.find(b => b.time === student.sessionTime),
                          })}>
                          <p className="text-xs font-bold leading-tight" style={{ color: '#111827' }}>{student.name}</p>
                          <div className="flex items-center gap-1 mt-1">
                            <Clock size={9} style={{ color: '#4b5563' }} />
                            <span className="text-[9px] font-semibold" style={{ color: '#4b5563' }}>
                              {daySessions.find(b => b.time === student.sessionTime)?.label ?? student.sessionTime}
                            </span>
                          </div>
                          <p className="text-[9px] mt-0.5 font-medium truncate" style={{ color: '#6b7280' }}>{student.tutorName}</p>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            </div>

          </div>
        )}
      </div>
    </div>
  );
}