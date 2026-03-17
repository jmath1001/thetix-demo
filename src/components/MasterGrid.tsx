"use client"
import React, { useState, useMemo } from 'react';
import { PlusCircle, Check, XCircle, UserX, X, CalendarClock, Loader2, ChevronLeft, ChevronRight, CalendarDays, ChevronDown } from "lucide-react";

import { MAX_CAPACITY, getSessionsForDay, type SessionBlock } from '@/components/constants';
import {
  useScheduleData,
  bookStudent,
  updateAttendance,
  removeStudentFromSession,
  updateSessionNotes,
  getWeekStart,
  getWeekDates,
  toISODate,
  formatDate,
  dayOfWeek,
  getCentralTimeNow,
  type Tutor,
} from '@/lib/useScheduleData';
import { BookingForm, BookingToast } from '@/components/BookingForm';
import { TutorManagementModal } from '@/components/TutorManagementModal';
import type { PrefilledSlot, BookingConfirmData } from '@/components/BookingForm';

const isTutorAvailable = (tutor: Tutor, dow: number, time: string) =>
  tutor.availabilityBlocks.includes(`${dow}-${time}`);

const ACTIVE_DAYS = [1, 2, 3, 4, 6];
const DAY_NAMES = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Saturday'];

function formatWeekRange(weekStart: Date): string {
  const end = new Date(weekStart);
  end.setDate(end.getDate() + 6);
  const opts: Intl.DateTimeFormatOptions = { month: 'short', day: 'numeric' };
  const s = weekStart.toLocaleDateString('en-US', opts);
  const e = end.toLocaleDateString('en-US', { ...opts, year: 'numeric' });
  return `${s} – ${e}`;
}

const TUTOR_PALETTES = [
  { bg: '#fdf4e3', border: '#f5c842', text: '#7a4f00', tag: '#e8a000' },
  { bg: '#e8f4fd', border: '#7ec8e3', text: '#0d4f72', tag: '#1a8abf' },
  { bg: '#f0e8fd', border: '#b98de0', text: '#4a1d8f', tag: '#7c3aed' },
  { bg: '#e6f9f1', border: '#5dd4a0', text: '#0e5c3a', tag: '#10a870' },
  { bg: '#fde8e8', border: '#f08080', text: '#7a1f1f', tag: '#d94f4f' },
  { bg: '#e8f9f9', border: '#4dc8c8', text: '#0e5a5a', tag: '#0f9898' },
];

function NotesEditor({ rowId, initialNotes, onSaved }: { rowId: any; initialNotes: string; onSaved: () => void }) {
  const [notes, setNotes] = useState(initialNotes);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  const handleSave = async () => {
    setSaving(true);
    try {
      await updateSessionNotes({ rowId, notes: notes || null });
      onSaved();
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    } catch (err) { console.error(err); }
    setSaving(false);
  };

  return (
    <div className="p-4 border-b border-[#f0ece8]">
      <div className="flex items-center justify-between mb-2">
        <p className="text-[9px] font-black text-[#a8a29e] uppercase tracking-widest">Session Notes</p>
        {saved && <span className="text-[9px] font-bold text-[#16a34a] uppercase tracking-wider">Saved ✓</span>}
      </div>
      <textarea
        className="w-full px-3 py-2.5 rounded-xl text-sm text-[#1c1917] border-2 border-[#e7e3dd] focus:border-[#6d28d9] outline-none transition-all resize-none"
        placeholder="Add notes about this session…"
        rows={notes ? 4 : 2}
        value={notes}
        onChange={e => { setNotes(e.target.value); setSaved(false); }}
      />
      <button
        onClick={handleSave}
        disabled={saving}
        className="mt-2 w-full py-2 rounded-xl text-[10px] font-black uppercase tracking-wider transition-all"
        style={{ background: saving ? '#e7e3dd' : '#6d28d9', color: saving ? '#a8a29e' : 'white' }}>
        {saving ? 'Saving…' : saved ? '✓ Saved' : 'Save Notes'}
      </button>
    </div>
  );
}

export default function MasterDeployment() {
  const [weekStart, setWeekStart] = useState<Date>(() => getWeekStart(getCentralTimeNow()));
  const weekDates = useMemo(() => getWeekDates(weekStart), [weekStart]);
  const { tutors, students, sessions, timeOff, loading, error, refetch } = useScheduleData(weekStart);

  const [selectedSession, setSelectedSession] = useState<any>(null);
  const [isEnrollModalOpen, setIsEnrollModalOpen] = useState(false);
  const [gridSlotToBook, setGridSlotToBook] = useState<PrefilledSlot | null>(null);
  const [enrollCat, setEnrollCat] = useState('math');
  const [bookingToast, setBookingToast] = useState<BookingConfirmData | null>(null);
  const [isTutorModalOpen, setIsTutorModalOpen] = useState(false);
  const [selectedTutorFilter, setSelectedTutorFilter] = useState<string | null>(null);
  const [localNotes, setLocalNotes] = useState<string>('');
  const [notesSaving, setNotesSaving] = useState(false);
  const [notesSaved, setNotesSaved] = useState(false);
  const [todayView, setTodayView] = useState(false);

  const goToPrevWeek = () => setWeekStart(prev => { const d = new Date(prev); d.setDate(d.getDate() - 7); return d; });
  const goToNextWeek = () => setWeekStart(prev => { const d = new Date(prev); d.setDate(d.getDate() + 7); return d; });
  const goToThisWeek = () => setWeekStart(getWeekStart(new Date()));
  const isCurrentWeek = toISODate(weekStart) === toISODate(getWeekStart(new Date()));

  const tutorPaletteMap = useMemo(() => {
    const map: Record<string, number> = {};
    tutors.forEach((t, i) => { map[t.id] = i % TUTOR_PALETTES.length; });
    return map;
  }, [tutors]);

  const activeDates = useMemo(() =>
    weekDates.filter(d => ACTIVE_DAYS.includes(dayOfWeek(toISODate(d)))),
    [weekDates]
  );

  const allAvailableSeats = useMemo(() => {
    let seats: any[] = [];
    tutors.filter(t => t.cat === enrollCat).forEach(tutor => {
      activeDates.forEach(date => {
        const isoDate = toISODate(date);
        const dow = dayOfWeek(isoDate);
        if (!tutor.availability.includes(dow)) return;
        getSessionsForDay(dow).forEach(block => {
          if (!isTutorAvailable(tutor, dow, block.time)) return;
          const session = sessions.find(s => s.date === isoDate && s.tutorId === tutor.id && s.time === block.time);
          const count = session ? session.students.length : 0;
          if (count < MAX_CAPACITY) {
            seats.push({ tutor, dayName: DAY_NAMES[ACTIVE_DAYS.indexOf(dow)], date: isoDate, time: block.time, block, count, seatsLeft: MAX_CAPACITY - count, dayNum: dow });
          }
        });
      });
    });
    return seats.sort((a, b) => { const dd = a.date.localeCompare(b.date); return dd !== 0 ? dd : a.time.localeCompare(b.time); });
  }, [enrollCat, tutors, sessions, activeDates]);

  const handleGridSlotClick = (tutor: Tutor, date: string, dayName: string, block: SessionBlock) => {
    setGridSlotToBook({ tutor, dayNum: dayOfWeek(date), dayName, time: block.time, date, block } as any);
  };

  const handleConfirmBooking = async (data: BookingConfirmData) => {
    try {
      await bookStudent({
        tutorId: data.slot.tutor.id, date: (data.slot as any).date, time: data.slot.time,
        student: data.student, topic: data.topic || data.subject || data.student.subject,
        notes: data.notes || '', recurring: data.recurring, recurringWeeks: data.recurringWeeks
      });
      refetch();
      setBookingToast(data);
      setIsEnrollModalOpen(false);
      setGridSlotToBook(null);
      setTimeout(() => setBookingToast(null), 4000);
    } catch (err: any) {
      alert(err.message || "Something went wrong with the booking.");
      console.error('Booking failed:', err);
    }
  };

  const handleAttendance = async (status: 'scheduled' | 'present' | 'no-show') => {
    if (!selectedSession) return;
    try {
      await updateAttendance({ sessionId: selectedSession.id, studentId: selectedSession.activeStudent.id, status });
      refetch(); setSelectedSession(null);
    } catch (err) { console.error(err); }
  };

  const handleRemove = async () => {
    if (!selectedSession) return;
    try {
      await removeStudentFromSession({ sessionId: selectedSession.id, studentId: selectedSession.activeStudent.id });
      refetch(); setSelectedSession(null);
    } catch (err) { console.error(err); }
  };

  const closeAllModals = () => { setIsEnrollModalOpen(false); setGridSlotToBook(null); };

  const setSelectedSessionWithNotes = (s: any) => {
    setSelectedSession(s);
    setLocalNotes(s?.activeStudent?.notes ?? '');
    setNotesSaved(false);
  };

  if (loading) return (
    <div className="w-full min-h-screen flex items-center justify-center" style={{ background: '#f7f4ef' }}>
      <div className="flex flex-col items-center gap-3">
        <Loader2 size={28} className="animate-spin" style={{ color: '#c27d38' }} />
        <p className="text-xs font-semibold uppercase tracking-widest" style={{ color: '#a07850', fontFamily: 'ui-serif, Georgia, serif' }}>Loading schedule…</p>
      </div>
    </div>
  );

  if (error) return (
    <div className="w-full min-h-screen flex items-center justify-center" style={{ background: '#f7f4ef' }}>
      <div className="text-center">
        <p className="text-sm font-bold mb-2" style={{ color: '#c0392b' }}>Failed to load</p>
        <p className="text-xs mb-6" style={{ color: '#9e8e7e' }}>{error}</p>
        <button onClick={refetch} className="px-5 py-2.5 rounded-lg text-xs font-bold uppercase tracking-wider text-white" style={{ background: '#c27d38' }}>Retry</button>
      </div>
    </div>
  );

  return (
    <div className="w-full min-h-screen overflow-x-hidden" style={{ background: '#f7f4ef', fontFamily: 'ui-sans-serif, system-ui, sans-serif', overflowY: todayView ? 'hidden' : undefined }}>

      {/* ── TODAY VIEW ── */}
      {todayView && (() => {
        const todayIso = toISODate(new Date());
        const todayDow = dayOfWeek(todayIso);
        const dayIdx = ACTIVE_DAYS.indexOf(todayDow);
        const dayLabel = DAY_NAMES[dayIdx] ?? 'Today';
        const daySessions = getSessionsForDay(todayDow);
        const todayTutors = tutors.filter(t =>
          t.availability.includes(todayDow) &&
          (selectedTutorFilter === null || t.id === selectedTutorFilter)
        );
        const isWeekend = !ACTIVE_DAYS.includes(todayDow);

        return (
          <div className="flex flex-col px-3 md:px-6 pb-3 md:pb-6" style={{ height: 'calc(100vh - 92px)' }}>
            {isWeekend ? (
              <div className="flex-1 flex flex-col items-center justify-center gap-3">
                <p className="text-4xl">🎉</p>
                <p className="text-lg font-bold" style={{ color: '#1c1008', fontFamily: 'ui-serif, Georgia, serif' }}>No sessions today</p>
                <p className="text-xs" style={{ color: '#a8a29e' }}>Enjoy your day off</p>
              </div>
            ) : (
              <div className="flex flex-col flex-1 min-h-0 pt-4">
                {/* Date header */}
                <div className="flex items-center gap-3 mb-4 shrink-0">
                  <div>
                    <h2 className="text-2xl font-bold leading-none" style={{ color: '#c27d38', fontFamily: 'ui-serif, Georgia, serif' }}>{dayLabel}</h2>
                    <p className="text-xs font-semibold mt-0.5" style={{ color: '#c27d38' }}>
                      {new Date().toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })}
                    </p>
                  </div>
                  <div className="h-px flex-1 rounded-full" style={{ background: 'linear-gradient(90deg, #f5d08a, transparent)' }} />
                  {/* Tutor filter */}
                  <div className="relative shrink-0">
                    <select value={selectedTutorFilter ?? ''} onChange={e => setSelectedTutorFilter(e.target.value || null)}
                      className="appearance-none pl-3 pr-8 py-2 rounded-lg text-xs font-semibold uppercase tracking-wider cursor-pointer outline-none"
                      style={{ background: selectedTutorFilter ? '#fef3e2' : 'white', border: `1px solid ${selectedTutorFilter ? '#f5d08a' : '#ddd4c8'}`, color: selectedTutorFilter ? '#a06020' : '#7a6a5a' }}>
                      <option value="">All Tutors</option>
                      {tutors.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
                    </select>
                    <ChevronDown size={11} className="absolute right-2.5 top-1/2 -translate-y-1/2 pointer-events-none" style={{ color: '#9e8e7e' }} />
                  </div>
                </div>

                {todayTutors.length === 0 ? (
                  <div className="rounded-xl p-8 text-center border border-dashed" style={{ borderColor: '#ddd4c8' }}>
                    <p className="text-sm italic" style={{ color: '#c4b5a0' }}>No tutors available today</p>
                  </div>
                ) : (
                  <div className="flex-1 min-h-0 rounded-2xl overflow-hidden flex flex-col" style={{ background: 'white', border: '1px solid #ddd4c8', boxShadow: '0 2px 12px rgba(0,0,0,0.07)' }}>
                    <div className="flex-1 overflow-auto">
                      <table className="border-collapse" style={{ width: '100%', minWidth: 'max-content' }}>
                        <thead>
                          <tr style={{ background: '#f7f2eb', borderBottom: '1px solid #ddd4c8' }}>
                            <th className="px-3 py-3 text-left text-xs font-bold uppercase tracking-wider"
                              style={{ color: '#9e8e7e', borderRight: '1px solid #ddd4c8', width: 1, whiteSpace: 'nowrap', position: 'sticky', left: 0, zIndex: 2, background: '#f7f2eb' }}>
                              Instructor
                            </th>
                            {daySessions.map(block => (
                              <th key={block.id} className="px-4 py-3 text-center" style={{ color: '#9e8e7e', borderRight: '1px solid #ddd4c8', minWidth: 200 }}>
                                <div className="text-sm font-bold uppercase tracking-wider">{block.label}</div>
                                <div className="text-[11px] font-medium mt-0.5" style={{ color: '#b0a090' }}>{block.display}</div>
                              </th>
                            ))}
                          </tr>
                        </thead>
                        <tbody>
                          {todayTutors.map(tutor => {
                            const palette = TUTOR_PALETTES[tutorPaletteMap[tutor.id] ?? 0];
                            const isOnTimeOff = timeOff.some(t => t.tutorId === tutor.id && t.date === todayIso);
                            return (
                              <tr key={tutor.id} style={{ borderBottom: '1px solid #ede6db' }}>
                                <td className="px-3 py-3 align-middle"
                                  style={{ background: 'white', borderRight: '1px solid #ddd4c8', position: 'sticky', left: 0, zIndex: 1, width: 1, whiteSpace: 'nowrap' }}>
                                  <div className="flex items-center gap-2.5">
                                    <div className="w-8 h-8 rounded-full flex items-center justify-center text-xs font-bold shrink-0"
                                      style={{ background: palette.bg, color: palette.text, border: `1.5px solid ${palette.border}` }}>
                                      {tutor.name.split(' ').map((n: string) => n[0]).join('').slice(0, 2).toUpperCase()}
                                    </div>
                                    <div>
                                      <p className="text-sm font-bold leading-tight" style={{ color: '#1c1008' }}>{tutor.name}</p>
                                      <span className="text-[8px] font-bold px-1.5 py-0.5 rounded mt-0.5 inline-block"
                                        style={{ background: tutor.cat === 'math' ? '#dbeafe' : '#fce7f3', color: tutor.cat === 'math' ? '#1d4ed8' : '#be185d' }}>
                                        {tutor.cat === 'math' ? 'Math' : 'English'}
                                      </span>
                                    </div>
                                  </div>
                                </td>
                                {daySessions.map(block => {
                                  const session = sessions.find(s => s.date === todayIso && s.tutorId === tutor.id && s.time === block.time);
                                  const hasStudents = session && session.students.length > 0;
                                  const isAvailable = isTutorAvailable(tutor, todayDow, block.time) && !hasStudents && !isOnTimeOff;
                                  const isFull = hasStudents && session!.students.length >= MAX_CAPACITY;
                                  const isOutside = !isTutorAvailable(tutor, todayDow, block.time) || isOnTimeOff;
                                  const timeOffNote = isOnTimeOff ? timeOff.find(t => t.tutorId === tutor.id && t.date === todayIso)?.note : null;

                                  return (
                                    <td key={block.id} className="p-2 align-top"
                                      style={{ background: isOutside ? 'repeating-linear-gradient(45deg, #f7f2eb, #f7f2eb 4px, #f0e8d8 4px, #f0e8d8 8px)' : 'white', borderRight: '1px solid #ede6db', minWidth: 200 }}>
                                      <div className="flex flex-col gap-1.5 min-h-[100px]">
                                        {hasStudents && !isOnTimeOff ? (
                                          <>
                                            {session!.students.map(student => (
                                              <div key={student.rowId || student.id}
                                                className="p-2.5 rounded-xl cursor-pointer transition-all hover:shadow-md"
                                                style={student.status === 'no-show'
                                                  ? { background: 'transparent', border: '1.5px solid #ddd4c8', opacity: 0.45 }
                                                  : student.status === 'present'
                                                    ? { background: '#edfaf3', border: '1.5px solid #6ee7b7' }
                                                    : { background: palette.bg, border: `1.5px solid ${palette.border}` }}
                                                onClick={() => setSelectedSessionWithNotes({ ...session, activeStudent: student, dayName: dayLabel, date: todayIso, tutorName: tutor.name, block })}>
                                                <div className="flex justify-between items-start mb-1">
                                                  <p className="text-sm font-bold leading-tight" style={{ color: '#1c1008' }}>{student.name}</p>
                                                  <button onClick={async e => {
                                                    e.stopPropagation();
                                                    const next = student.status === 'present' ? 'scheduled' : 'present';
                                                    await updateAttendance({ sessionId: session.id, studentId: student.id, status: next });
                                                    refetch();
                                                  }}
                                                    className="shrink-0 w-5 h-5 rounded-md flex items-center justify-center transition-all"
                                                    style={student.status === 'present'
                                                      ? { background: '#059669', border: '1.5px solid #059669' }
                                                      : { background: 'white', border: '1.5px solid #c8b89a' }}>
                                                    {student.status === 'present' && <Check size={11} strokeWidth={3} color="white" />}
                                                  </button>
                                                </div>
                                                <p className="text-[11px] font-semibold uppercase tracking-tight" style={{ color: palette.tag }}>{student.topic}</p>
                                                {student.grade && <p className="text-[10px] mt-0.5" style={{ color: '#b0a090' }}>Grade {student.grade}</p>}
                                                {student.notes && <p className="text-[10px] mt-1 italic truncate" style={{ color: '#b0a090' }}>📝 {student.notes}</p>}
                                              </div>
                                            ))}
                                            {!isFull && (
                                              <button onClick={() => handleGridSlotClick(tutor, todayIso, dayLabel, block)}
                                                className="py-1.5 rounded-xl text-[10px] font-bold uppercase tracking-wider transition-all"
                                                style={{ background: 'transparent', border: '1.5px dashed #c8b89a', color: '#9e8e7e' }}
                                                onMouseEnter={e => { e.currentTarget.style.background = '#2d2318'; e.currentTarget.style.color = 'white'; e.currentTarget.style.borderColor = '#2d2318'; }}
                                                onMouseLeave={e => { e.currentTarget.style.background = 'transparent'; e.currentTarget.style.color = '#9e8e7e'; e.currentTarget.style.borderColor = '#c8b89a'; }}>
                                                + ADD ({MAX_CAPACITY - session!.students.length})
                                              </button>
                                            )}
                                          </>
                                        ) : isAvailable ? (
                                          <div onClick={() => handleGridSlotClick(tutor, todayIso, dayLabel, block)}
                                            className="flex-1 rounded-xl flex flex-col items-center justify-center gap-1.5 cursor-pointer transition-all"
                                            style={{ minHeight: 100, background: '#f0fdf4', border: '1.5px dashed #86efac' }}
                                            onMouseEnter={e => { e.currentTarget.style.background = '#dcfce7'; e.currentTarget.style.borderColor = '#4ade80'; }}
                                            onMouseLeave={e => { e.currentTarget.style.background = '#f0fdf4'; e.currentTarget.style.borderColor = '#86efac'; }}>
                                            <PlusCircle size={18} style={{ color: '#16a34a' }} />
                                            <span className="text-[10px] font-bold uppercase tracking-widest" style={{ color: '#16a34a' }}>Open</span>
                                          </div>
                                        ) : (
                                          <div className="flex-1 rounded-xl flex flex-col items-center justify-center gap-1"
                                            style={{ minHeight: 100, background: 'repeating-linear-gradient(45deg, #f7f2eb, #f7f2eb 4px, #f0e8d8 4px, #f0e8d8 8px)' }}>
                                            {isOnTimeOff ? (
                                              <>
                                                <span className="text-[10px] font-black uppercase tracking-widest" style={{ color: '#c27d38' }}>OFF</span>
                                                {timeOffNote && <span className="text-[9px] font-medium text-center px-2" style={{ color: '#b0906a' }}>{timeOffNote}</span>}
                                              </>
                                            ) : (
                                              <span className="text-[10px] font-semibold text-stone-300 uppercase tracking-wider">—</span>
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
                )}
              </div>
            )}
          </div>
        );
      })()}

      {/* ── MAIN GRID ── */}
      {!todayView && (
      <div className="max-w-[1600px] mx-auto p-3 md:p-6 space-y-10 md:space-y-14">
        {activeDates.map((date) => {
          const isoDate = toISODate(date);
          const dow = dayOfWeek(isoDate);
          const dayIdx = ACTIVE_DAYS.indexOf(dow);
          const dayLabel = DAY_NAMES[dayIdx];
          const dateLabel = date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
          const isToday = isoDate === toISODate(new Date());
          const activeTutors = tutors.filter(t =>
            t.availability.includes(dow) &&
            (selectedTutorFilter === null || t.id === selectedTutorFilter)
          );
          const daySessions = getSessionsForDay(dow);

          return (
            <div key={isoDate} className="space-y-3 md:space-y-4">
              <div className="flex items-center gap-3 md:gap-4 px-1">
                <div className="flex items-baseline gap-3">
                  <h2 className="text-3xl md:text-4xl font-bold tracking-tight leading-none" style={{ color: isToday ? '#c27d38' : '#1c1008', fontFamily: 'ui-serif, Georgia, serif' }}>
                    {dayLabel}
                  </h2>
                  <span className="text-base md:text-lg font-semibold" style={{ color: isToday ? '#c27d38' : '#9e8e7e' }}>
                    {dateLabel}
                    {isToday && <span className="ml-2 text-[9px] font-bold px-2 py-0.5 rounded-full align-middle uppercase tracking-wider" style={{ background: '#fef3e2', border: '1px solid #f5d08a', color: '#a06020' }}>Today</span>}
                  </span>
                </div>
                <div className="h-px grow rounded-full" style={{ background: isToday ? 'linear-gradient(90deg, #f5d08a, transparent)' : 'linear-gradient(90deg, #ddd4c8, transparent)' }} />
              </div>

              {activeTutors.length === 0 ? (
                <div className="rounded-xl p-6 text-center border border-dashed" style={{ borderColor: '#ddd4c8' }}>
                  <p className="text-xs font-medium italic" style={{ color: '#c4b5a0' }}>No tutors available</p>
                </div>
              ) : (
                <>
                  {/* ── DESKTOP TABLE ── */}
                  <div className="hidden md:block rounded-xl overflow-hidden"
                    style={{ background: 'white', border: '1px solid #ddd4c8', boxShadow: '0 2px 12px rgba(0,0,0,0.07)' }}>
                    <div className="overflow-x-auto">
                      <table className="border-collapse" style={{ minWidth: '100%', width: 'max-content' }}>
                        <thead>
                          <tr style={{ background: '#f7f2eb', borderBottom: '1px solid #ddd4c8' }}>
                            <th className="px-2 py-2 text-left text-xs font-bold uppercase tracking-wider"
                              style={{ color: '#9e8e7e', borderRight: '1px solid #ddd4c8', width: 1, whiteSpace: 'nowrap', position: 'sticky', left: 0, zIndex: 2, background: '#f7f2eb' }}>
                              Instructor
                            </th>
                            {daySessions.map(block => (
                              <th key={block.id} className="px-3 py-2 text-center" style={{ color: '#9e8e7e', borderRight: '1px solid #ddd4c8', minWidth: 160 }}>
                                <div className="text-xs font-bold uppercase tracking-wider">{block.label}</div>
                                <div className="text-[10px] font-medium mt-0.5" style={{ color: '#b0a090' }}>{block.display}</div>
                              </th>
                            ))}
                          </tr>
                        </thead>
                        <tbody>
                          {activeTutors.map(tutor => {
                            const palette = TUTOR_PALETTES[tutorPaletteMap[tutor.id] ?? 0];
                            return (
                              <tr key={tutor.id} style={{ borderBottom: '1px solid #ede6db' }}>
                                <td className="px-2 py-2 align-middle"
                                  style={{ background: 'white', borderRight: '1px solid #ddd4c8', position: 'sticky', left: 0, zIndex: 1, width: 1, whiteSpace: 'nowrap' }}>
                                  <div className="flex items-center gap-2">
                                    <div className="w-6 h-6 rounded-full flex items-center justify-center text-[9px] font-bold shrink-0"
                                      style={{ background: palette.bg, color: palette.text, border: `1px solid ${palette.border}` }}>
                                      {tutor.name.split(' ').map((n: string) => n[0]).join('').slice(0, 2).toUpperCase()}
                                    </div>
                                    <div>
                                      <p className="text-xs font-bold leading-tight whitespace-nowrap" style={{ color: '#1c1008' }}>{tutor.name}</p>
                                      <span className="text-[8px] font-bold px-1 py-0.5 rounded mt-0.5 inline-block"
                                        style={{ background: tutor.cat === 'math' ? '#dbeafe' : '#fce7f3', color: tutor.cat === 'math' ? '#1d4ed8' : '#be185d' }}>
                                        {tutor.cat === 'math' ? 'Math' : 'English'}
                                      </span>
                                    </div>
                                  </div>
                                </td>
                                {daySessions.map(block => {
                                  const session = sessions.find(s => s.date === isoDate && s.tutorId === tutor.id && s.time === block.time);
                                  const hasStudents = session && session.students.length > 0;
                                  const isOnTimeOff = timeOff.some(t => t.tutorId === tutor.id && t.date === isoDate);
                                  const isAvailable = isTutorAvailable(tutor, dow, block.time) && !hasStudents && !isOnTimeOff;
                                  const isFull = hasStudents && session!.students.length >= MAX_CAPACITY;
                                  const isOutside = !isTutorAvailable(tutor, dow, block.time) || isOnTimeOff;
                                  const timeOffNote = isOnTimeOff ? timeOff.find(t => t.tutorId === tutor.id && t.date === isoDate)?.note : null;

                                  return (
                                    <td key={block.id} className="p-1.5 align-top"
                                      style={{ background: isOutside ? 'repeating-linear-gradient(45deg, #f7f2eb, #f7f2eb 4px, #f0e8d8 4px, #f0e8d8 8px)' : 'white', borderRight: '1px solid #ede6db' }}>
                                      <div className="flex flex-col gap-1 min-h-[110px]">
                                        {hasStudents && !isOnTimeOff ? (
                                          <>
                                            {session!.students.map(student => (
                                              <div key={student.rowId || student.id}
                                                className="group relative p-2 rounded-lg transition-all hover:shadow-md cursor-pointer"
                                                style={student.status === 'no-show'
                                                  ? { background: 'transparent', border: '1.5px solid #ddd4c8', opacity: 0.45 }
                                                  : student.status === 'present'
                                                    ? { background: '#edfaf3', border: '1.5px solid #6ee7b7' }
                                                    : { background: palette.bg, border: `1.5px solid ${palette.border}` }}
                                                onClick={() => setSelectedSessionWithNotes({ ...session, activeStudent: student, dayName: dayLabel, date: isoDate, tutorName: tutor.name, block })}>
                                                {/* Top row: name + present toggle */}
                                                <div className="flex justify-between items-start mb-0.5">
                                                  <p className="text-xs font-bold leading-tight" style={{ color: '#1c1008' }}>{student.name}</p>
                                                  <button
                                                    onClick={async (e) => {
                                                      e.stopPropagation();
                                                      const next = student.status === 'present' ? 'scheduled' : 'present';
                                                      await updateAttendance({ sessionId: session.id, studentId: student.id, status: next });
                                                      refetch();
                                                    }}
                                                    className="shrink-0 w-4 h-4 rounded flex items-center justify-center transition-all"
                                                    style={student.status === 'present'
                                                      ? { background: '#059669', border: '1.5px solid #059669' }
                                                      : { background: 'white', border: '1.5px solid #c8b89a' }}>
                                                    {student.status === 'present' && <Check size={9} strokeWidth={3} color="white" />}
                                                  </button>
                                                </div>
                                                <p className="text-[10px] font-semibold uppercase tracking-tight" style={{ color: palette.tag }}>{student.topic}</p>
                                                {student.grade && <p className="text-[9px] font-medium mt-0.5" style={{ color: '#b0a090' }}>Grade {student.grade}</p>}
                                                {student.notes && (
                                                  <p className="text-[9px] mt-1 italic truncate" style={{ color: '#b0a090' }}>📝 {student.notes}</p>
                                                )}
                                                {student.confirmationStatus && student.confirmationStatus !== 'pending' && (
                                                  <span className="text-[8px] font-black mt-1 inline-block px-1.5 py-0.5 rounded"
                                                    style={{
                                                      background: student.confirmationStatus === 'confirmed' ? '#dcfce7' : student.confirmationStatus === 'cancelled' ? '#fee2e2' : '#ede9fe',
                                                      color: student.confirmationStatus === 'confirmed' ? '#15803d' : student.confirmationStatus === 'cancelled' ? '#dc2626' : '#6d28d9',
                                                    }}>
                                                    {student.confirmationStatus === 'confirmed' ? '✓ Confirmed' : student.confirmationStatus === 'cancelled' ? '✕ Cancelled' : '↗ Reschedule'}
                                                  </span>
                                                )}
                                              </div>
                                            ))}
                                            {!isFull && (
                                              <button onClick={() => handleGridSlotClick(tutor, isoDate, dayLabel, block)}
                                                className="mt-auto py-1 rounded-lg text-[10px] font-bold uppercase tracking-wider transition-all"
                                                style={{ background: 'transparent', border: '1.5px dashed #c8b89a', color: '#9e8e7e' }}
                                                onMouseEnter={e => { e.currentTarget.style.background = '#2d2318'; e.currentTarget.style.color = 'white'; e.currentTarget.style.borderColor = '#2d2318'; }}
                                                onMouseLeave={e => { e.currentTarget.style.background = 'transparent'; e.currentTarget.style.color = '#9e8e7e'; e.currentTarget.style.borderColor = '#c8b89a'; }}>
                                                + ADD ({MAX_CAPACITY - session!.students.length})
                                              </button>
                                            )}
                                          </>
                                        ) : isAvailable ? (
                                          <div onClick={() => handleGridSlotClick(tutor, isoDate, dayLabel, block)}
                                            className="w-full rounded-lg flex flex-col items-center justify-center gap-1 cursor-pointer transition-all"
                                            style={{ minHeight: 64, background: '#f0fdf4', border: '1.5px dashed #86efac' }}
                                            onMouseEnter={e => { e.currentTarget.style.background = '#dcfce7'; e.currentTarget.style.borderColor = '#4ade80'; }}
                                            onMouseLeave={e => { e.currentTarget.style.background = '#f0fdf4'; e.currentTarget.style.borderColor = '#86efac'; }}>
                                            <PlusCircle size={14} style={{ color: '#16a34a' }} />
                                            <span className="text-[9px] font-bold uppercase tracking-widest" style={{ color: '#16a34a' }}>Open</span>
                                          </div>
                                        ) : (
                                          <div className="w-full rounded-lg flex flex-col items-center justify-center gap-1"
                                            style={{ minHeight: 64, background: 'repeating-linear-gradient(45deg, #f7f2eb, #f7f2eb 4px, #f0e8d8 4px, #f0e8d8 8px)' }}>
                                            {isOnTimeOff ? (
                                              <>
                                                <span className="text-[9px] font-black uppercase tracking-widest" style={{ color: '#c27d38' }}>OFF</span>
                                                {timeOffNote && <span className="text-[8px] font-medium text-center px-2 leading-tight" style={{ color: '#b0906a' }}>{timeOffNote}</span>}
                                              </>
                                            ) : (
                                              <span className="text-[9px] font-semibold text-stone-300 uppercase tracking-wider">—</span>
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

                  {/* ── MOBILE VIEW ── */}
                  <div className="md:hidden space-y-2">
                    {activeTutors.map(tutor => {
                      const palette = TUTOR_PALETTES[tutorPaletteMap[tutor.id] ?? 0];
                      return (
                        <div key={tutor.id} className="rounded-xl overflow-hidden" style={{ background: 'white', border: '1px solid #ddd4c8', boxShadow: '0 2px 8px rgba(0,0,0,0.07)' }}>
                          <div className="p-2.5" style={{ background: '#f7f2eb', borderBottom: '1px solid #ddd4c8' }}>
                            <p className="text-xs font-bold" style={{ color: '#1c1008' }}>{tutor.name}</p>
                          </div>
                          <div className="overflow-x-auto">
                            <div className="flex">
                              {daySessions.map(block => {
                                const session = sessions.find(s => s.date === isoDate && s.tutorId === tutor.id && s.time === block.time);
                                const hasStudents = session && session.students.length > 0;
                                const isOnTimeOff = timeOff.some(t => t.tutorId === tutor.id && t.date === isoDate);
                                const isAvailable = isTutorAvailable(tutor, dow, block.time) && !hasStudents && !isOnTimeOff;
                                const isFull = hasStudents && session!.students.length >= MAX_CAPACITY;
                                const isOutside = !isTutorAvailable(tutor, dow, block.time) || isOnTimeOff;

                                return (
                                  <div key={block.id} className="flex-shrink-0 w-40 p-1.5"
                                    style={{ background: isOutside ? 'repeating-linear-gradient(45deg, #f7f2eb, #f7f2eb 4px, #f0e8d8 4px, #f0e8d8 8px)' : 'white', borderRight: '1px solid #ede6db' }}>
                                    <div className="text-center mb-1.5">
                                      <div className="text-[9px] font-bold uppercase tracking-widest" style={{ color: '#9e8e7e' }}>{block.label}</div>
                                      <div className="text-[8px]" style={{ color: '#b0a090' }}>{block.display}</div>
                                    </div>
                                    <div className="space-y-1" style={{ minHeight: 64 }}>
                                      {hasStudents && !isOnTimeOff ? (
                                        <>
                                          {session!.students.map(student => (
                                            <div key={student.rowId || student.id}
                                              className="flex items-center gap-1.5 px-1.5 py-1.5 rounded-lg transition-all"
                                              style={student.status === 'no-show'
                                                ? { background: 'transparent', border: '1.5px solid #ddd4c8', opacity: 0.4 }
                                                : student.status === 'present'
                                                  ? { background: '#edfaf3', border: '1.5px solid #6ee7b7' }
                                                  : { background: palette.bg, border: `1.5px solid ${palette.border}` }}>
                                              <button
                                                onClick={async (e) => {
                                                  e.stopPropagation();
                                                  const next = student.status === 'present' ? 'scheduled' : 'present';
                                                  await updateAttendance({ sessionId: session.id, studentId: student.id, status: next });
                                                  refetch();
                                                }}
                                                className="shrink-0 w-3 h-3 rounded flex items-center justify-center"
                                                style={student.status === 'present'
                                                  ? { background: '#059669', border: '1.5px solid #059669' }
                                                  : { background: 'white', border: '1.5px solid #c8b89a' }}>
                                                {student.status === 'present' && <Check size={7} strokeWidth={3} color="white" />}
                                              </button>
                                              <div className="flex-1 min-w-0 cursor-pointer"
                                                onClick={() => setSelectedSessionWithNotes({ ...session, activeStudent: student, dayName: dayLabel, date: isoDate, tutorName: tutor.name, block })}>
                                                <p className="text-[10px] font-bold leading-none truncate" style={{ color: '#1c1008' }}>{student.name}</p>
                                                <p className="text-[8px] leading-none mt-0.5 truncate" style={{ color: palette.tag }}>
                                                  {student.topic}{student.grade ? ` · Gr.${student.grade}` : ''}
                                                </p>
                                              </div>
                                            </div>
                                          ))}
                                          {!isFull && (
                                            <button onClick={() => handleGridSlotClick(tutor, isoDate, dayLabel, block)}
                                              className="w-full py-1 rounded-lg text-[7px] font-bold uppercase transition-all"
                                              style={{ background: 'transparent', border: '1.5px dashed #c8b89a', color: '#9e8e7e' }}>
                                              + ADD
                                            </button>
                                          )}
                                        </>
                                      ) : isAvailable ? (
                                        <div onClick={() => handleGridSlotClick(tutor, isoDate, dayLabel, block)}
                                          className="w-full h-full rounded-lg flex flex-col items-center justify-center gap-1 cursor-pointer active:scale-95 transition-all"
                                          style={{ minHeight: 56, background: '#f0fdf4', border: '1.5px dashed #86efac' }}>
                                          <PlusCircle size={14} style={{ color: '#16a34a' }} />
                                          <span className="text-[8px] font-bold uppercase tracking-wider" style={{ color: '#16a34a' }}>Open</span>
                                        </div>
                                      ) : (
                                        <div className="w-full rounded-lg flex flex-col items-center justify-center gap-1"
                                          style={{ minHeight: 56, background: 'repeating-linear-gradient(45deg, #f7f2eb, #f7f2eb 4px, #f0e8d8 4px, #f0e8d8 8px)' }}>
                                          {isOnTimeOff
                                            ? <span className="text-[8px] font-black uppercase tracking-widest" style={{ color: '#c27d38' }}>OFF</span>
                                            : <span className="text-[8px] font-semibold text-stone-300 uppercase tracking-wider">—</span>}
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
      )}

      {/* ── MODALS ── */}
      {isEnrollModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{ background: 'rgba(20,14,8,0.75)', backdropFilter: 'blur(8px)' }}>
          <BookingForm prefilledSlot={null} onConfirm={handleConfirmBooking} onCancel={closeAllModals} enrollCat={enrollCat} setEnrollCat={setEnrollCat} allAvailableSeats={allAvailableSeats} studentDatabase={students} />
        </div>
      )}
      {gridSlotToBook && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{ background: 'rgba(20,14,8,0.75)', backdropFilter: 'blur(8px)' }}>
          <BookingForm prefilledSlot={gridSlotToBook} onConfirm={handleConfirmBooking} onCancel={closeAllModals} enrollCat={enrollCat} setEnrollCat={setEnrollCat} allAvailableSeats={allAvailableSeats} studentDatabase={students} />
        </div>
      )}

      {/* ── ATTENDANCE MODAL ── */}
      {selectedSession && (() => {
        const s = selectedSession;
        const student = s.activeStudent;
        const sessionDow = dayOfWeek(s.date);
        const sessionTime = s.time ?? s.block?.time;
        const originalTutor = tutors.find(t => t.id === s.tutorId);

        const altTutors = tutors.filter(t => {
          if (t.id === s.tutorId) return false;
          if (t.cat !== originalTutor?.cat) return false;
          if (!t.availability.includes(sessionDow)) return false;
          if (!isTutorAvailable(t, sessionDow, sessionTime)) return false;
          const altSession = sessions.find(ss => ss.date === s.date && ss.tutorId === t.id && ss.time === sessionTime);
          if (altSession && altSession.students.length >= MAX_CAPACITY) return false;
          return true;
        });

        const currentStatus = student.status;

        const handleReassign = async (newTutor: Tutor) => {
          try {
            await removeStudentFromSession({ sessionId: s.id, studentId: student.id });
            const studentObj = students.find(st => st.id === student.id) ?? { id: student.id, name: student.name, subject: student.topic, grade: student.grade ?? null, hoursLeft: 0, availabilityBlocks: [] };
            await bookStudent({ tutorId: newTutor.id, date: s.date, time: sessionTime, student: studentObj, topic: student.topic });
            refetch();
            setSelectedSession(null);
          } catch (err: any) {
            alert(err.message || 'Reassignment failed');
          }
        };

        // Shared inner content
        const modalJsx = (
          <>
            {/* Header */}
            <div className="p-4 bg-[#faf9f7] border-b border-[#e7e3dd] flex items-center justify-between shrink-0">
              <div className="flex items-center gap-3">
                <div className="w-9 h-9 rounded-full bg-[#ede9fe] flex items-center justify-center text-sm font-black text-[#6d28d9] shrink-0">
                  {student.name.charAt(0)}
                </div>
                <div>
                  <p className="text-sm font-black text-[#1c1917] leading-tight">{student.name}</p>
                  <p className="text-[10px] text-[#a8a29e] font-medium">{student.grade ? `Gr.${student.grade} · ` : ''}{student.topic}</p>
                </div>
              </div>
              <button onClick={() => setSelectedSession(null)} className="w-8 h-8 flex items-center justify-center rounded-full bg-white border border-[#e7e3dd] text-[#78716c] shrink-0">
                <X size={15} />
              </button>
            </div>
            {/* Session info */}
            <div className="px-4 py-2 bg-white border-b border-[#f0ece8] flex items-center gap-1.5 flex-wrap shrink-0">
              <span className="text-[10px] font-black px-2 py-0.5 rounded-md bg-[#1c1917] text-white uppercase tracking-wider">{s.dayName}</span>
              <span className="text-[10px] text-[#78716c]">{formatDate(s.date)}</span>
              <span className="text-[#d4cfc9]">·</span>
              <span className="text-[10px] text-[#78716c]">{s.block?.label ?? sessionTime}</span>
              <span className="text-[#d4cfc9]">·</span>
              <span className="text-[10px] font-semibold text-[#6d28d9]">{s.tutorName}</span>
              {student.confirmationStatus && student.confirmationStatus !== 'pending' && (
                <>
                  <span className="text-[#d4cfc9]">·</span>
                  <span className="text-[9px] font-black px-2 py-0.5 rounded-lg capitalize"
                    style={{
                      background: student.confirmationStatus === 'confirmed' ? '#dcfce7' : student.confirmationStatus === 'cancelled' ? '#fee2e2' : '#ede9fe',
                      color: student.confirmationStatus === 'confirmed' ? '#15803d' : student.confirmationStatus === 'cancelled' ? '#dc2626' : '#6d28d9',
                    }}>
                    {student.confirmationStatus === 'reschedule_requested' ? '↗ Reschedule Requested' : student.confirmationStatus === 'confirmed' ? '✓ Confirmed' : '✕ Cancelled'}
                  </span>
                </>
              )}
            </div>
            {/* Scrollable body */}
            <div className="overflow-y-auto flex-1">
              <div className="p-4 border-b border-[#f0ece8]">
                <p className="text-[9px] font-black text-[#a8a29e] uppercase tracking-widest mb-2">Attendance</p>
                <div className="flex gap-2 mb-2">
                  {([
                    { status: 'present', label: 'Present', activeStyle: { background: '#dcfce7', borderColor: '#16a34a', color: '#15803d' } },
                    { status: 'no-show', label: 'No-show', activeStyle: { background: '#fee2e2', borderColor: '#dc2626', color: '#b91c1c' } },
                    { status: 'scheduled', label: 'Scheduled', activeStyle: { background: '#fef3c7', borderColor: '#f59e0b', color: '#b45309' } },
                  ] as const).map(({ status, label, activeStyle }) => (
                    <button key={status} onClick={() => handleAttendance(status)}
                      className="flex-1 py-2.5 rounded-xl font-black text-[10px] uppercase tracking-wider transition-all active:scale-95 border-2"
                      style={currentStatus === status ? activeStyle : { background: 'white', borderColor: '#e7e3dd', color: '#a8a29e' }}>
                      {label}
                    </button>
                  ))}
                </div>
                <button onClick={handleRemove}
                  className="w-full flex items-center justify-center gap-2 py-2.5 rounded-xl text-xs font-bold uppercase tracking-wider border border-dashed border-[#fca5a5] text-[#ef4444] hover:bg-[#fff1f1] transition-all">
                  <UserX size={12} strokeWidth={2} /> Remove
                </button>
              </div>
              {/* Notes */}
              <NotesEditor rowId={student.rowId} initialNotes={student.notes ?? ''} onSaved={refetch} />
              {altTutors.length > 0 && (
                <div className="p-4">
                  <p className="text-[9px] font-black text-[#a8a29e] uppercase tracking-widest mb-2">Reassign to</p>
                  <div className="space-y-2">
                    {altTutors.map(t => {
                      const altSession = sessions.find(ss => ss.date === s.date && ss.tutorId === t.id && ss.time === sessionTime);
                      const spotsUsed = altSession ? altSession.students.length : 0;
                      return (
                        <div key={t.id} className="flex items-center justify-between p-3 rounded-xl border-2 border-[#f0ece8] hover:border-[#c4b5fd] hover:bg-[#faf9ff] transition-all">
                          <div className="flex items-center gap-2.5">
                            <div className="w-7 h-7 rounded-full bg-[#ede9fe] flex items-center justify-center text-xs font-black text-[#6d28d9]">
                              {t.name.charAt(0)}
                            </div>
                            <div>
                              <p className="text-xs font-bold text-[#1c1917]">{t.name}</p>
                              <p className="text-[9px] text-[#a8a29e] uppercase">{spotsUsed}/{MAX_CAPACITY} spots</p>
                            </div>
                          </div>
                          <button onClick={() => handleReassign(t)}
                            className="px-3 py-1.5 rounded-lg text-[10px] font-black uppercase tracking-wider text-white bg-[#6d28d9] hover:bg-[#5b21b6] transition-all active:scale-95">
                            Move
                          </button>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}
            </div>
          </>
        );

        return (
          <div className="fixed inset-0 z-50" style={{ background: 'rgba(28,16,8,0.7)', backdropFilter: 'blur(8px)' }}>
            {/* Desktop: centered modal */}
            <div className="hidden md:flex items-center justify-center h-full p-4">
              <div className="w-full max-w-md bg-white rounded-2xl overflow-hidden border border-[#e7e3dd] shadow-2xl flex flex-col" style={{ maxHeight: 'min(560px, 90vh)' }}>
                {modalJsx}
              </div>
            </div>
            {/* Mobile: bottom sheet — tap backdrop to close */}
            <div className="md:hidden flex flex-col h-full">
              <div className="flex-1" onClick={() => setSelectedSession(null)} />
              <div className="bg-white rounded-t-2xl border-t border-[#e7e3dd] shadow-2xl flex flex-col" style={{ maxHeight: '80vh' }}>
                <div className="flex justify-center pt-3 pb-1 shrink-0">
                  <div className="w-10 h-1 rounded-full bg-[#e7e3dd]" />
                </div>
                {modalJsx}
              </div>
            </div>
          </div>
        );
      })()}

      {bookingToast && <BookingToast data={bookingToast} onClose={() => setBookingToast(null)} />}
      {isTutorModalOpen && <TutorManagementModal tutors={tutors} onClose={() => setIsTutorModalOpen(false)} onRefetch={refetch} />}
    </div>
  );
}