"use client"
import React, { useState, useMemo } from 'react';
import { PlusCircle, RefreshCw, Check, AlertCircle, XCircle, UserX, X, CalendarClock, Loader2, ChevronLeft, ChevronRight, CalendarDays } from "lucide-react";

import { TIME_SLOTS, MAX_CAPACITY, formatTime } from '@/components/constants';
import {
  useScheduleData,
  bookStudent,
  updateAttendance,
  removeStudentFromSession,
  getWeekStart,
  getWeekDates,
  toISODate,
  formatDate,
  dayOfWeek,
  getOccupiedBlocks,
  type Tutor,
} from '@/lib/useScheduleData';
import { BookingForm, BookingToast } from '@/components/BookingForm';
import { TutorManagementModal } from '@/components/TutorManagementModal';
import type { PrefilledSlot, BookingConfirmData } from '@/components/BookingForm';

// ─── Helpers ──────────────────────────────────────────────────────────────────

const isTutorAvailable = (tutor: Tutor, dow: number, time: string) =>
  tutor.availabilityBlocks.includes(`${dow}-${time}`);

const DAY_NAMES = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];

function formatWeekRange(weekStart: Date): string {
  const end = new Date(weekStart);
  end.setDate(end.getDate() + 6);
  const opts: Intl.DateTimeFormatOptions = { month: 'short', day: 'numeric' };
  const s = weekStart.toLocaleDateString('en-US', opts);
  const e = end.toLocaleDateString('en-US', { ...opts, year: 'numeric' });
  return `${s} – ${e}`;
}

// ─── Tutor color palette — warm, distinct ─────────────────────────────────────
const TUTOR_PALETTES = [
  { bg: '#fdf4e3', border: '#f5c842', text: '#7a4f00', tag: '#e8a000' },
  { bg: '#e8f4fd', border: '#7ec8e3', text: '#0d4f72', tag: '#1a8abf' },
  { bg: '#f0e8fd', border: '#b98de0', text: '#4a1d8f', tag: '#7c3aed' },
  { bg: '#e6f9f1', border: '#5dd4a0', text: '#0e5c3a', tag: '#10a870' },
  { bg: '#fde8e8', border: '#f08080', text: '#7a1f1f', tag: '#d94f4f' },
  { bg: '#e8f9f9', border: '#4dc8c8', text: '#0e5a5a', tag: '#0f9898' },
];

// ─── Component ────────────────────────────────────────────────────────────────

export default function MasterDeployment() {
  const [weekStart, setWeekStart] = useState<Date>(() => getWeekStart(new Date()));
  const weekDates = useMemo(() => getWeekDates(weekStart), [weekStart]);

  const { tutors, students, sessions, loading, error, refetch } = useScheduleData(weekStart);

  const [selectedSession, setSelectedSession] = useState<any>(null);
  const [isEnrollModalOpen, setIsEnrollModalOpen] = useState(false);
  const [gridSlotToBook, setGridSlotToBook] = useState<PrefilledSlot | null>(null);
  const [enrollCat, setEnrollCat] = useState('math');
  const [bookingToast, setBookingToast] = useState<BookingConfirmData | null>(null);
  const [isTutorModalOpen, setIsTutorModalOpen] = useState(false);

  const tutorPaletteMap = useMemo(() => {
    const map: Record<string, number> = {};
    tutors.forEach((t, i) => { map[t.id] = i % TUTOR_PALETTES.length; });
    return map;
  }, [tutors]);

  const goToPrevWeek = () => {
    setWeekStart(prev => { const d = new Date(prev); d.setDate(d.getDate() - 7); return d; });
  };
  const goToNextWeek = () => {
    setWeekStart(prev => { const d = new Date(prev); d.setDate(d.getDate() + 7); return d; });
  };
  const goToThisWeek = () => setWeekStart(getWeekStart(new Date()));

  const isCurrentWeek = toISODate(weekStart) === toISODate(getWeekStart(new Date()));

  // Build a set of "continuation" cells: tutor+date+time blocks that are covered by a longer session starting earlier
  // Returns a map of `tutorId|date|time` -> { session, student } for continuation cells
  const continuationMap = useMemo(() => {
    const map: Record<string, { session: any; student: any }> = (() => {
      const m: Record<string, { session: any; student: any }> = {};
      sessions.forEach(session => {
        session.students.forEach(student => {
          const dur = student.durationMinutes ?? 30;
          if (dur <= 30) return;
          const blocks = getOccupiedBlocks(session.time, dur);
          // Skip the first block (that's the actual session cell), mark the rest as continuations
          blocks.slice(1).forEach(blockTime => {
            const key = `${session.tutorId}|${session.date}|${blockTime}`;
            m[key] = { session, student };
          });
        });
      });
      return m;
    })();
    return map;
  }, [sessions]);

  const allAvailableSeats = useMemo(() => {
    let seats: any[] = [];
    tutors.filter(t => t.cat === enrollCat).forEach(tutor => {
      weekDates.forEach(date => {
        const isoDate = toISODate(date);
        const dow = dayOfWeek(isoDate);
        if (!tutor.availability.includes(dow)) return;
        TIME_SLOTS.forEach(time => {
          if (!isTutorAvailable(tutor, dow, time)) return;
          // Skip continuation blocks
          const contKey = `${tutor.id}|${isoDate}|${time}`;
          if (continuationMap[contKey]) return;
          const session = sessions.find(s => s.date === isoDate && s.tutorId === tutor.id && s.time === time);
          const count = session ? session.students.length : 0;
          if (count < MAX_CAPACITY) {
            seats.push({
              tutor,
              dayName: DAY_NAMES[dow - 1],
              date: isoDate,
              time,
              count,
              seatsLeft: MAX_CAPACITY - count,
              dayNum: dow,
            });
          }
        });
      });
    });
    return seats.sort((a, b) => {
      const dd = a.date.localeCompare(b.date);
      return dd !== 0 ? dd : a.time.localeCompare(b.time);
    });
  }, [enrollCat, tutors, sessions, weekDates, continuationMap]);

  const handleGridSlotClick = (tutor: Tutor, date: string, dayName: string, time: string) => {
    setGridSlotToBook({ tutor, dayNum: dayOfWeek(date), dayName, time, date });
  };

  const handleConfirmBooking = async (data: BookingConfirmData) => {
    try {
      await bookStudent({
        tutorId: data.slot.tutor.id,
        date: (data.slot as any).date,
        time: data.slot.time,
        student: data.student,
        topic: data.subject || data.student.subject,
        durationMinutes: data.durationMinutes,
        recurring: data.recurring,
        recurringWeeks: data.recurringWeeks,
      });
      refetch();
      setBookingToast(data);
      setIsEnrollModalOpen(false);
      setGridSlotToBook(null);
      setTimeout(() => setBookingToast(null), 4000);
    } catch (err) {
      console.error('Booking failed:', err);
    }
  };

  const handleAttendance = async (status: 'scheduled' | 'present' | 'no-show') => {
    if (!selectedSession) return;
    try {
      await updateAttendance({ sessionId: selectedSession.id, studentId: selectedSession.activeStudent.id, status });
      refetch();
      setSelectedSession(null);
    } catch (err) {
      console.error('Attendance update failed:', err);
    }
  };

  const handleRemove = async () => {
    if (!selectedSession) return;
    try {
      await removeStudentFromSession({ sessionId: selectedSession.id, studentId: selectedSession.activeStudent.id });
      refetch();
      setSelectedSession(null);
    } catch (err) {
      console.error('Remove failed:', err);
    }
  };

  const closeAllModals = () => { setIsEnrollModalOpen(false); setGridSlotToBook(null); };

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
    <div className="w-full min-h-screen pb-12 overflow-x-hidden" style={{ background: '#f7f4ef', fontFamily: 'ui-sans-serif, system-ui, sans-serif' }}>

      {/* ── HEADER ── */}
      <div
        className="sticky top-0 z-40 flex justify-between items-center px-4 md:px-8 py-3 border-b"
        style={{ background: 'rgba(247,244,239,0.95)', backdropFilter: 'blur(16px)', borderColor: '#e2d9cc' }}
      >
        <div>
          <h1 className="text-lg md:text-xl font-bold tracking-tight leading-none" style={{ color: '#1c1008', fontFamily: 'ui-serif, Georgia, serif' }}>Weekly Schedule</h1>
          <p className="text-[9px] font-semibold uppercase tracking-widest mt-0.5" style={{ color: '#c27d38' }}>Tutor Management</p>
        </div>
        <div className="flex items-center gap-2 md:gap-3">
          <button
            onClick={() => setIsTutorModalOpen(true)}
            className="flex items-center gap-2 px-4 py-2 rounded-lg text-xs font-semibold uppercase tracking-wider transition-all"
            style={{ background: 'white', border: '1px solid #ddd4c8', color: '#7a6a5a' }}
            onMouseEnter={e => { e.currentTarget.style.background = '#f0ebe3'; e.currentTarget.style.color = '#3d2f1f'; }}
            onMouseLeave={e => { e.currentTarget.style.background = 'white'; e.currentTarget.style.color = '#7a6a5a'; }}
          >
            Manage Tutors
          </button>
          <button
            onClick={() => setIsEnrollModalOpen(true)}
            className="flex items-center gap-2 px-5 md:px-7 py-2 md:py-2.5 rounded-lg text-xs md:text-sm font-bold uppercase tracking-wider text-white transition-all active:scale-95"
            style={{ background: '#2d2318', boxShadow: '0 2px 8px rgba(0,0,0,0.25)' }}
            onMouseEnter={e => e.currentTarget.style.background = '#4a3828'}
            onMouseLeave={e => e.currentTarget.style.background = '#2d2318'}
          >
            <PlusCircle size={14} />
            Schedule Student
          </button>
        </div>
      </div>

      {/* ── WEEK NAVIGATION ── */}
      <div className="max-w-[1600px] mx-auto px-3 md:px-6 pt-6 pb-2 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <button onClick={goToPrevWeek}
            className="w-9 h-9 rounded-lg flex items-center justify-center transition-all"
            style={{ background: 'white', border: '1px solid #ddd4c8', color: '#9e8e7e' }}
            onMouseEnter={e => { e.currentTarget.style.background = '#f0ebe3'; e.currentTarget.style.color = '#3d2f1f'; }}
            onMouseLeave={e => { e.currentTarget.style.background = 'white'; e.currentTarget.style.color = '#9e8e7e'; }}
          >
            <ChevronLeft size={16} />
          </button>

          <div>
            <div className="text-base md:text-lg font-bold tracking-tight leading-none" style={{ color: '#1c1008', fontFamily: 'ui-serif, Georgia, serif' }}>
              {formatWeekRange(weekStart)}
            </div>
            {isCurrentWeek && (
              <span className="text-[9px] font-semibold uppercase tracking-widest" style={{ color: '#c27d38' }}>Current Week</span>
            )}
          </div>

          <button onClick={goToNextWeek}
            className="w-9 h-9 rounded-lg flex items-center justify-center transition-all"
            style={{ background: 'white', border: '1px solid #ddd4c8', color: '#9e8e7e' }}
            onMouseEnter={e => { e.currentTarget.style.background = '#f0ebe3'; e.currentTarget.style.color = '#3d2f1f'; }}
            onMouseLeave={e => { e.currentTarget.style.background = 'white'; e.currentTarget.style.color = '#9e8e7e'; }}
          >
            <ChevronRight size={16} />
          </button>
        </div>

        {!isCurrentWeek && (
          <button onClick={goToThisWeek}
            className="flex items-center gap-1.5 px-3 py-2 rounded-lg text-[10px] font-bold uppercase tracking-wider transition-all"
            style={{ background: '#fef3e2', border: '1px solid #f5d08a', color: '#a06020' }}
            onMouseEnter={e => e.currentTarget.style.background = '#fde8c0'}
            onMouseLeave={e => e.currentTarget.style.background = '#fef3e2'}
          >
            <CalendarDays size={12} /> Today
          </button>
        )}
      </div>

      {/* ── MAIN GRID ── */}
      <div className="max-w-[1600px] mx-auto p-3 md:p-6 space-y-10 md:space-y-14">
        {weekDates.map((date, idx) => {
          const isoDate = toISODate(date);
          const dow = idx + 1;
          const activeTutors = tutors.filter(t => t.availability.includes(dow));
          const isToday = isoDate === toISODate(new Date());
          const dayLabel = DAY_NAMES[idx];
          const dateLabel = date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });

          return (
            <div key={isoDate} className="space-y-3 md:space-y-4">

              {/* Day heading */}
              <div className="flex items-center gap-3 md:gap-4 px-1">
                <div className="flex items-baseline gap-3">
                  <h2 className="text-3xl md:text-4xl font-bold tracking-tight leading-none" style={{ color: isToday ? '#c27d38' : '#1c1008', fontFamily: 'ui-serif, Georgia, serif' }}>
                    {dayLabel}
                  </h2>
                  <span className="text-base md:text-lg font-semibold" style={{ color: isToday ? '#c27d38' : '#9e8e7e' }}>
                    {dateLabel}
                    {isToday && (
                      <span className="ml-2 text-[9px] font-bold px-2 py-0.5 rounded-full align-middle uppercase tracking-wider" style={{ background: '#fef3e2', border: '1px solid #f5d08a', color: '#a06020' }}>Today</span>
                    )}
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
                  <div
                    className="hidden md:block rounded-xl overflow-hidden"
                    style={{ background: 'white', border: '1px solid #ddd4c8', boxShadow: '0 2px 12px rgba(0,0,0,0.07)' }}
                  >
                    <div className="overflow-x-auto">
                      <table className="border-collapse" style={{ minWidth: '100%', width: 'max-content' }}>
                        <thead>
                          <tr style={{ background: '#f7f2eb', borderBottom: '1px solid #ddd4c8' }}>
                            <th
                              className="p-4 text-left text-xs font-bold uppercase tracking-wider"
                              style={{ color: '#9e8e7e', borderRight: '1px solid #ddd4c8', minWidth: 160, position: 'sticky', left: 0, zIndex: 2, background: '#f7f2eb' }}
                            >
                              Instructor
                            </th>
                            {TIME_SLOTS.map(t => (
                              <th key={t} className="p-2 text-center text-xs font-bold uppercase tracking-wider" style={{ color: '#9e8e7e', borderRight: '1px solid #ddd4c8', minWidth: 90 }}>
                                {formatTime(t).replace(' AM', 'a').replace(' PM', 'p')}
                              </th>
                            ))}
                          </tr>
                        </thead>
                        <tbody>
                          {activeTutors.map(tutor => {
                            const palette = TUTOR_PALETTES[tutorPaletteMap[tutor.id] ?? 0];
                            return (
                              <tr key={tutor.id} style={{ borderBottom: '1px solid #ede6db' }}>

                                {/* Tutor cell — sticky */}
                                <td
                                  className="p-4 align-top"
                                  style={{ background: 'white', borderRight: '1px solid #ddd4c8', position: 'sticky', left: 0, zIndex: 1 }}
                                >
                                  <div className="flex items-center gap-2.5">
                                    <div
                                      className="w-8 h-8 rounded-full flex items-center justify-center text-xs font-bold shrink-0"
                                      style={{ background: palette.bg, color: palette.text, border: `1px solid ${palette.border}` }}
                                    >
                                      {tutor.name.split(' ').map((n: string) => n[0]).join('').slice(0, 2).toUpperCase()}
                                    </div>
                                    <div>
                                      <p className="text-sm font-bold leading-none mb-1.5" style={{ color: '#1c1008' }}>{tutor.name}</p>
                                      <div className="flex flex-wrap gap-1">
                                        {tutor.subjects.map((s: string) => (
                                          <span key={s} className="text-[9px] font-semibold px-1.5 py-0.5 rounded uppercase tracking-tight" style={{ background: palette.bg, color: palette.text, border: `1px solid ${palette.border}` }}>{s}</span>
                                        ))}
                                      </div>
                                    </div>
                                  </div>
                                </td>

                                {TIME_SLOTS.map(time => {
                                  const contKey = `${tutor.id}|${isoDate}|${time}`;
                                  const continuation = continuationMap[contKey];

                                  // ── CONTINUATION CELL ──
                                  if (continuation) {
                                    const contPalette = TUTOR_PALETTES[tutorPaletteMap[tutor.id] ?? 0];
                                    return (
                                      <td
                                        key={time}
                                        className="p-0 align-top h-[160px]"
                                        style={{ borderRight: '1px solid #ede6db' }}
                                      >
                                        <div
                                          className="w-full h-full flex items-center justify-center"
                                          style={{
                                            background: `repeating-linear-gradient(45deg, ${contPalette.bg}, ${contPalette.bg} 6px, white 6px, white 12px)`,
                                            borderLeft: `3px solid ${contPalette.border}`,
                                            opacity: 0.7,
                                          }}
                                        >
                                          <span className="text-[9px] font-bold uppercase tracking-wider" style={{ color: contPalette.text, writingMode: 'horizontal-tb' }}>cont.</span>
                                        </div>
                                      </td>
                                    );
                                  }

                                  const session = sessions.find(s => s.date === isoDate && s.tutorId === tutor.id && s.time === time);
                                  const hasStudents = session && session.students.length > 0;
                                  const isAvailable = isTutorAvailable(tutor, dow, time) && !hasStudents;
                                  const isFull = hasStudents && session!.students.length >= MAX_CAPACITY;
                                  const isOutside = !isTutorAvailable(tutor, dow, time);

                                  return (
                                    <td
                                      key={time}
                                      className="p-2 align-top h-[160px]"
                                      style={{
                                        background: isOutside
                                          ? 'repeating-linear-gradient(45deg, #f7f2eb, #f7f2eb 4px, #f0e8d8 4px, #f0e8d8 8px)'
                                          : 'white',
                                        borderRight: '1px solid #ede6db',
                                      }}
                                    >
                                      <div className="flex flex-col gap-1.5 h-full">
                                        {hasStudents ? (
                                          <>
                                            {session!.students.map(student => {
                                              const dur = student.durationMinutes ?? 30;
                                              const durLabel = dur > 30 ? `${dur >= 60 ? `${dur / 60}hr` : `${dur}min`}` : null;
                                              return (
                                                <div
                                                  key={student.rowId || student.id}
                                                  onClick={() => setSelectedSession({ ...session, activeStudent: student, dayName: dayLabel, date: isoDate, tutorName: tutor.name })}
                                                  className="group relative p-2.5 rounded-lg transition-all hover:shadow-md cursor-pointer"
                                                  style={student.status === 'no-show' ? {
                                                    background: 'transparent', border: '1.5px solid #ddd4c8', opacity: 0.45,
                                                  } : student.status === 'present' ? {
                                                    background: '#edfaf3', border: '1.5px solid #6ee7b7',
                                                  } : {
                                                    background: palette.bg, border: `1.5px solid ${palette.border}`,
                                                  }}
                                                >
                                                  <div className="flex justify-between items-start mb-0.5">
                                                    <p className="text-xs font-bold leading-tight" style={{ color: '#1c1008' }}>{student.name}</p>
                                                    <RefreshCw size={9} className="opacity-0 group-hover:opacity-60 transition-opacity shrink-0 mt-0.5" style={{ color: palette.tag }} />
                                                  </div>
                                                  <p className="text-[10px] font-semibold uppercase tracking-tight" style={{ color: palette.tag }}>{student.topic}</p>
                                                  {durLabel && (
                                                    <span className="text-[9px] font-bold px-1.5 py-0.5 rounded mt-1 inline-block" style={{ background: palette.border + '33', color: palette.text }}>
                                                      {durLabel}
                                                    </span>
                                                  )}
                                                  {student.status === 'present' && (
                                                    <div className="flex items-center gap-1 mt-1">
                                                      <Check size={9} style={{ color: '#059669' }} strokeWidth={3} />
                                                      <span className="text-[9px] font-semibold" style={{ color: '#059669' }}>Present</span>
                                                    </div>
                                                  )}
                                                </div>
                                              );
                                            })}
                                            {!isFull && (
                                              <button
                                                onClick={() => handleGridSlotClick(tutor, isoDate, dayLabel, time)}
                                                className="mt-auto py-1.5 rounded-lg text-[10px] font-bold uppercase tracking-wider transition-all"
                                                style={{ background: 'transparent', border: '1.5px dashed #c8b89a', color: '#9e8e7e' }}
                                                onMouseEnter={e => { e.currentTarget.style.background = '#2d2318'; e.currentTarget.style.color = 'white'; e.currentTarget.style.borderColor = '#2d2318'; }}
                                                onMouseLeave={e => { e.currentTarget.style.background = 'transparent'; e.currentTarget.style.color = '#9e8e7e'; e.currentTarget.style.borderColor = '#c8b89a'; }}
                                              >
                                                + ADD ({MAX_CAPACITY - session!.students.length})
                                              </button>
                                            )}
                                          </>
                                        ) : isAvailable ? (
                                          <div
                                            onClick={() => handleGridSlotClick(tutor, isoDate, dayLabel, time)}
                                            className="w-full h-full rounded-lg flex flex-col items-center justify-center gap-1.5 cursor-pointer transition-all group"
                                            style={{ background: 'white', border: '1.5px dashed #c8b89a' }}
                                            onMouseEnter={e => { e.currentTarget.style.background = '#fef9f0'; e.currentTarget.style.borderColor = '#c27d38'; }}
                                            onMouseLeave={e => { e.currentTarget.style.background = 'white'; e.currentTarget.style.borderColor = '#c8b89a'; }}
                                          >
                                            <PlusCircle size={16} style={{ color: '#c8b89a' }} className="group-hover:text-amber-600 transition-colors" />
                                            <span className="text-[9px] font-bold uppercase tracking-widest" style={{ color: '#c8b89a' }}>Open</span>
                                          </div>
                                        ) : (
                                          <div className="w-full h-full rounded-lg flex items-center justify-center" style={{ background: 'repeating-linear-gradient(45deg, #f7f2eb, #f7f2eb 4px, #f0e8d8 4px, #f0e8d8 8px)' }}>
                                            <span className="text-[9px] font-semibold text-stone-300 uppercase tracking-wider">—</span>
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
                          <div className="p-3" style={{ background: '#f7f2eb', borderBottom: '1px solid #ddd4c8' }}>
                            <p className="text-xs font-bold leading-none mb-1" style={{ color: '#1c1008' }}>{tutor.name}</p>
                            <div className="flex flex-wrap gap-1">
                              {tutor.subjects.slice(0, 2).map((s: string) => (
                                <span key={s} className="text-[7px] font-semibold px-1.5 py-0.5 rounded uppercase" style={{ background: palette.bg, color: palette.text, border: `1px solid ${palette.border}` }}>{s}</span>
                              ))}
                            </div>
                          </div>
                          <div className="overflow-x-auto">
                            <div className="flex">
                              {TIME_SLOTS.map(time => {
                                const contKey = `${tutor.id}|${isoDate}|${time}`;
                                const continuation = continuationMap[contKey];

                                if (continuation) {
                                  return (
                                    <div key={time} className="flex-shrink-0 w-40 p-0" style={{ borderRight: '1px solid #ede6db' }}>
                                      <div className="text-[9px] font-bold uppercase tracking-widest text-center py-2" style={{ color: '#9e8e7e' }}>{time}</div>
                                      <div
                                        className="mx-2 rounded-lg flex items-center justify-center"
                                        style={{
                                          minHeight: 100,
                                          background: `repeating-linear-gradient(45deg, ${palette.bg}, ${palette.bg} 6px, white 6px, white 12px)`,
                                          borderLeft: `3px solid ${palette.border}`,
                                          opacity: 0.7,
                                        }}
                                      >
                                        <span className="text-[9px] font-bold" style={{ color: palette.text }}>cont.</span>
                                      </div>
                                    </div>
                                  );
                                }

                                const session = sessions.find(s => s.date === isoDate && s.tutorId === tutor.id && s.time === time);
                                const hasStudents = session && session.students.length > 0;
                                const isAvailable = isTutorAvailable(tutor, dow, time) && !hasStudents;
                                const isFull = hasStudents && session!.students.length >= MAX_CAPACITY;
                                const isOutside = !isTutorAvailable(tutor, dow, time);
                                return (
                                  <div key={time} className="flex-shrink-0 w-40 p-2" style={{
                                    background: isOutside ? 'repeating-linear-gradient(45deg, #f7f2eb, #f7f2eb 4px, #f0e8d8 4px, #f0e8d8 8px)' : 'white',
                                    borderRight: '1px solid #ede6db',
                                  }}>
                                    <div className="text-[9px] font-bold uppercase tracking-widest text-center mb-2" style={{ color: '#9e8e7e' }}>{time}</div>
                                    <div className="space-y-1.5 min-h-[100px]">
                                      {hasStudents ? (
                                        <>
                                          {session!.students.map(student => (
                                            <div key={student.rowId || student.id}
                                              onClick={() => setSelectedSession({ ...session, activeStudent: student, dayName: dayLabel, date: isoDate, tutorName: tutor.name })}
                                              className="p-2 rounded-lg cursor-pointer transition-all active:scale-95"
                                              style={student.status === 'no-show' ? { background: 'transparent', border: '1.5px solid #ddd4c8', opacity: 0.45 } : { background: palette.bg, border: `1.5px solid ${palette.border}` }}
                                            >
                                              <p className="text-[10px] font-bold leading-tight mb-0.5" style={{ color: '#1c1008' }}>{student.name}</p>
                                              <p className="text-[7px] font-semibold uppercase tracking-tight" style={{ color: palette.tag }}>{student.topic}</p>
                                            </div>
                                          ))}
                                          {!isFull && (
                                            <button onClick={() => handleGridSlotClick(tutor, isoDate, dayLabel, time)}
                                              className="w-full py-1.5 rounded-lg text-[7px] font-bold uppercase transition-all"
                                              style={{ background: 'transparent', border: '1.5px dashed #c8b89a', color: '#9e8e7e' }}>
                                              + {MAX_CAPACITY - session!.students.length}
                                            </button>
                                          )}
                                        </>
                                      ) : isAvailable ? (
                                        <div
                                          onClick={() => handleGridSlotClick(tutor, isoDate, dayLabel, time)}
                                          className="w-full h-20 rounded-lg flex flex-col items-center justify-center gap-1.5 cursor-pointer active:scale-95 transition-all"
                                          style={{ background: 'white', border: '1.5px dashed #c8b89a' }}
                                          onMouseEnter={e => { e.currentTarget.style.background = '#fef9f0'; e.currentTarget.style.borderColor = '#c27d38'; }}
                                          onMouseLeave={e => { e.currentTarget.style.background = 'white'; e.currentTarget.style.borderColor = '#c8b89a'; }}
                                        >
                                          <PlusCircle size={18} style={{ color: '#c8b89a' }} />
                                          <span className="text-[8px] font-bold uppercase tracking-wider" style={{ color: '#c8b89a' }}>Open</span>
                                        </div>
                                      ) : (
                                        <div className="w-full h-20 rounded-lg" style={{ background: 'repeating-linear-gradient(45deg, #f7f2eb, #f7f2eb 4px, #f0e8d8 4px, #f0e8d8 8px)' }} />
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

      {/* ATTENDANCE MODAL */}
      {selectedSession && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{ background: 'rgba(20,14,8,0.75)', backdropFilter: 'blur(8px)' }}>
          <div className="w-full max-w-md md:max-w-lg rounded-2xl overflow-hidden" style={{ background: 'white', border: '1px solid #ddd4c8', boxShadow: '0 24px 64px rgba(0,0,0,0.2)' }}>

            <div className="h-1 w-full" style={{ background: 'linear-gradient(90deg, #c27d38, #f5c842, #c27d38)' }} />

            <div className="p-6 md:p-8 pb-4 md:pb-5">
              <div className="flex items-start justify-between mb-5">
                <div className="flex-1">
                  <div className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full mb-3" style={{ background: '#fef3e2', border: '1px solid #f5d08a' }}>
                    <span className="w-1.5 h-1.5 rounded-full" style={{ background: '#c27d38' }} />
                    <span className="text-[9px] font-bold uppercase tracking-widest" style={{ color: '#a06020' }}>{selectedSession.activeStudent.topic}</span>
                  </div>
                  <h3 className="text-2xl md:text-3xl font-bold leading-none mb-2" style={{ color: '#1c1008', fontFamily: 'ui-serif, Georgia, serif' }}>{selectedSession.activeStudent.name}</h3>
                  <p className="text-xs font-medium" style={{ color: '#9e8e7e' }}>
                    {selectedSession.dayName} &nbsp;·&nbsp; {formatDate(selectedSession.date)} &nbsp;·&nbsp; {selectedSession.time} &nbsp;·&nbsp; {selectedSession.tutorName}
                    {selectedSession.activeStudent.durationMinutes > 30 && (
                      <span className="ml-2 font-bold" style={{ color: '#c27d38' }}>
                        · {selectedSession.activeStudent.durationMinutes / 60 >= 1 ? `${selectedSession.activeStudent.durationMinutes / 60}hr` : `${selectedSession.activeStudent.durationMinutes}min`}
                      </span>
                    )}
                  </p>
                </div>
                <button
                  onClick={() => setSelectedSession(null)}
                  className="ml-4 mt-1 w-8 h-8 rounded-lg flex items-center justify-center shrink-0 transition-all"
                  style={{ background: '#f7f2eb', border: '1px solid #ddd4c8', color: '#9e8e7e' }}
                  onMouseEnter={e => { e.currentTarget.style.background = '#ede6db'; e.currentTarget.style.color = '#1c1008'; }}
                  onMouseLeave={e => { e.currentTarget.style.background = '#f7f2eb'; e.currentTarget.style.color = '#9e8e7e'; }}
                >
                  <X size={14} />
                </button>
              </div>
            </div>

            <div className="px-6 md:px-8 pb-5">
              <p className="text-[10px] font-bold uppercase tracking-widest mb-3" style={{ color: '#b0a090' }}>Mark Attendance</p>
              <div className="grid grid-cols-2 gap-2.5 mb-3">
                <button onClick={() => handleAttendance('present')}
                  className="flex items-center justify-center gap-2 py-3.5 rounded-xl font-bold text-sm uppercase tracking-wider text-white transition-all active:scale-95"
                  style={{ background: '#16a34a', boxShadow: '0 2px 8px rgba(22,163,74,0.3)' }}
                  onMouseEnter={e => e.currentTarget.style.background = '#15803d'}
                  onMouseLeave={e => e.currentTarget.style.background = '#16a34a'}
                >
                  <Check size={15} strokeWidth={2.5} /> Present
                </button>
                <button onClick={() => handleAttendance('scheduled')}
                  className="flex items-center justify-center gap-2 py-3.5 rounded-xl font-bold text-sm uppercase tracking-wider text-white transition-all active:scale-95"
                  style={{ background: '#c27d38', boxShadow: '0 2px 8px rgba(194,125,56,0.3)' }}
                  onMouseEnter={e => e.currentTarget.style.background = '#a06020'}
                  onMouseLeave={e => e.currentTarget.style.background = '#c27d38'}
                >
                  <AlertCircle size={15} strokeWidth={2.5} /> Excused
                </button>
                <button onClick={() => handleAttendance('no-show')}
                  className="flex items-center justify-center gap-2 py-3.5 rounded-xl font-bold text-sm uppercase tracking-wider text-white transition-all active:scale-95"
                  style={{ background: '#dc2626', boxShadow: '0 2px 8px rgba(220,38,38,0.3)' }}
                  onMouseEnter={e => e.currentTarget.style.background = '#b91c1c'}
                  onMouseLeave={e => e.currentTarget.style.background = '#dc2626'}
                >
                  <XCircle size={15} strokeWidth={2.5} /> Unexcused
                </button>
                <button onClick={handleRemove}
                  className="flex items-center justify-center gap-2 py-3.5 rounded-xl font-bold text-sm uppercase tracking-wider transition-all active:scale-95"
                  style={{ background: '#f7f2eb', border: '1px solid #ddd4c8', color: '#7a6a5a' }}
                  onMouseEnter={e => { e.currentTarget.style.background = '#ede6db'; e.currentTarget.style.color = '#3d2f1f'; }}
                  onMouseLeave={e => { e.currentTarget.style.background = '#f7f2eb'; e.currentTarget.style.color = '#7a6a5a'; }}
                >
                  <UserX size={15} strokeWidth={2} /> Remove
                </button>
              </div>
              <button
                className="w-full flex items-center justify-center gap-2 py-3 rounded-xl font-semibold text-sm uppercase tracking-wider transition-all active:scale-95"
                style={{ background: '#f7f2eb', border: '1px solid #ddd4c8', color: '#7a6a5a' }}
                onMouseEnter={e => { e.currentTarget.style.background = '#ede6db'; }}
                onMouseLeave={e => { e.currentTarget.style.background = '#f7f2eb'; }}
              >
                <CalendarClock size={14} strokeWidth={2} /> Reschedule Appointment
              </button>
            </div>

            <div className="mx-6 md:mx-8 h-px" style={{ background: '#ede6db' }} />

            <div className="max-h-[32vh] overflow-y-auto">
              <div className="p-6 md:p-8 pt-5">
                <p className="text-[10px] font-bold uppercase tracking-widest mb-3" style={{ color: '#b0a090' }}>
                  Alternative Coverage &nbsp;·&nbsp; {selectedSession.time}
                </p>
                {tutors.filter(t =>
                  t.id !== selectedSession.tutorId &&
                  isTutorAvailable(t, dayOfWeek(selectedSession.date), selectedSession.time) &&
                  t.availability.includes(dayOfWeek(selectedSession.date)) &&
                  t.cat === tutors.find(ot => ot.id === selectedSession.tutorId)?.cat
                ).map(t => (
                  <div key={t.id}
                    className="flex items-center justify-between mb-2.5 p-3.5 rounded-xl transition-all cursor-pointer"
                    style={{ background: '#faf7f3', border: '1px solid #ddd4c8' }}
                    onMouseEnter={e => { e.currentTarget.style.background = '#f0ebe3'; e.currentTarget.style.borderColor = '#c8b89a'; }}
                    onMouseLeave={e => { e.currentTarget.style.background = '#faf7f3'; e.currentTarget.style.borderColor = '#ddd4c8'; }}
                  >
                    <div>
                      <p className="text-sm font-bold leading-none mb-0.5" style={{ color: '#1c1008' }}>{t.name}</p>
                      <p className="text-[9px] font-medium uppercase tracking-wider" style={{ color: '#9e8e7e' }}>{t.subjects.join(', ')}</p>
                    </div>
                    <button
                      className="px-4 py-2 rounded-lg text-[9px] font-bold uppercase tracking-wider text-white transition-all active:scale-95"
                      style={{ background: '#2d2318' }}
                      onMouseEnter={e => e.currentTarget.style.background = '#4a3828'}
                      onMouseLeave={e => e.currentTarget.style.background = '#2d2318'}
                    >Reassign</button>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      )}

      {bookingToast && <BookingToast data={bookingToast} onClose={() => setBookingToast(null)} />}

      {isTutorModalOpen && (
        <TutorManagementModal tutors={tutors} onClose={() => setIsTutorModalOpen(false)} onRefetch={refetch} />
      )}
    </div>
  );
}