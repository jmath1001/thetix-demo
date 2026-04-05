"use client"
import React, { useState, useMemo, useEffect, useCallback } from 'react';
import { Loader2 } from 'lucide-react';

import { MAX_CAPACITY, getSessionsForDay, type SessionBlock } from '@/components/constants';
import {
  useScheduleData,
  bookStudent,
  getWeekStart,
  getWeekDates,
  toISODate,
  dayOfWeek,
  getCentralTimeNow,
  type Tutor,
} from '@/lib/useScheduleData';
import { BookingForm, BookingToast } from '@/components/BookingForm';
import { TutorManagementModal } from '@/components/TutorManagementModal';
import type { PrefilledSlot, BookingConfirmData } from '@/components/BookingForm';

import { ACTIVE_DAYS, DAY_NAMES, TUTOR_PALETTES } from './scheduleConstants';
import { isTutorAvailable } from './scheduleUtils';
import { ScheduleNav } from './ScheduleNav';
import { TodayView } from './TodayView';
import { WeekView } from './WeekView';
import { AttendanceModal } from './AttendanceModal';
import { logEvent } from '@/lib/analytics';
import { CommandBar } from '@/components/CommandBar';

export default function MasterDeployment() {
  const [todayDate, setTodayDate] = useState<Date>(() => getCentralTimeNow());
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
  const [todayView, setTodayView] = useState(true);
  const [modalTab, setModalTab] = useState<'session' | 'notes'>('session');

  const handleTodayDateChange = useCallback((date: Date) => {
    setTodayDate(date);
    setWeekStart(getWeekStart(date));
  }, []);

  useEffect(() => {
  if (todayView) {
    document.documentElement.style.overflow = 'hidden'; // <-- html element, not body
    document.body.style.background = '#fafafa';
  } else {
    document.documentElement.style.overflow = '';
    document.body.style.background = '';
  }
  return () => {
    document.documentElement.style.overflow = '';
    document.body.style.background = '';
  };
}, [todayView]);

  const tutorPaletteMap = useMemo(() => {
    const map: Record<string, number> = {};
    tutors.forEach((t, i) => { map[t.id] = i % TUTOR_PALETTES.length; });
    return map;
  }, [tutors]);

  const goToPrevWeek = () => setWeekStart(prev => { const d = new Date(prev); d.setDate(d.getDate() - 7); return d; });
  const goToNextWeek = () => setWeekStart(prev => { const d = new Date(prev); d.setDate(d.getDate() + 7); return d; });
  const goToThisWeek = () => {
    const now = getCentralTimeNow();
    setTodayDate(now);
    setWeekStart(getWeekStart(now));
  };
  const isCurrentWeek = toISODate(weekStart) === toISODate(getWeekStart(new Date()));

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
        if (timeOff.some(t => t.tutorId === tutor.id && t.date === isoDate)) return;
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
  }, [enrollCat, tutors, sessions, activeDates, timeOff]);

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
      logEvent('session_booked', {
        studentName: data.student.name,
        tutorName: data.slot.tutor.name,
        date: (data.slot as any).date,
        recurring: data.recurring,
        source: gridSlotToBook ? 'grid_slot' : 'booking_form',
      });
      setTimeout(() => setBookingToast(null), 4000);
    } catch (err: any) {
      alert(err.message || "Something went wrong with the booking.");
      console.error('Booking failed:', err);
    }
  };

  // ── Called when CommandBar AI resolves a booking intent ──────────────────
  const handleAIBookingAction = useCallback(({
    studentId, slotDate, slotTime, tutorId, topic,
  }: {
    studentId: string
    slotDate: string
    slotTime: string
    tutorId: string
    topic: string
  }) => {
    const tutor = tutors.find(t => t.id === tutorId)
    if (!tutor) return
    const dow = dayOfWeek(slotDate)
    const block = getSessionsForDay(dow).find(b => b.time === slotTime)
    const dayName = DAY_NAMES[ACTIVE_DAYS.indexOf(dow)]
    // Pre-fill the slot — same as clicking a green cell in the grid
    setGridSlotToBook({ tutor, dayNum: dow, dayName, time: slotTime, date: slotDate, block } as any)
    // Pre-select student cat so the right tab is shown in BookingForm
    setEnrollCat(tutor.cat)
    logEvent('ai_booking_initiated', { studentId, tutorId, slotDate, slotTime, topic })
  }, [tutors])

  const setSelectedSessionWithNotes = (s: any) => {
    setSelectedSession(s);
    setModalTab('session');
  };

  const patchSelectedSession = useCallback((patch: Record<string, any>) => {
    setSelectedSession((prev: any) => {
      if (!prev) return prev;
      return {
        ...prev,
        activeStudent: {
          ...prev.activeStudent,
          ...patch,
        },
      };
    });
  }, []);

  const closeAllModals = () => { setIsEnrollModalOpen(false); setGridSlotToBook(null); };

  if (loading) return (
    <div className="w-full min-h-screen flex items-center justify-center" style={{ background: '#fafafa' }}>
      <div className="flex flex-col items-center gap-3">
        <Loader2 size={28} className="animate-spin" style={{ color: '#c27d38' }} />
        <p className="text-xs font-semibold uppercase tracking-widest" style={{ color: '#a07850', fontFamily: 'ui-serif, Georgia, serif' }}>Loading schedule…</p>
      </div>
    </div>
  );

  if (error) return (
    <div className="w-full min-h-screen flex items-center justify-center" style={{ background: '#fafafa' }}>
      <div className="text-center">
        <p className="text-sm font-bold mb-2" style={{ color: '#c0392b' }}>Failed to load</p>
        <p className="text-xs mb-6" style={{ color: '#9e8e7e' }}>{error}</p>
        <button onClick={refetch} className="px-5 py-2.5 rounded-lg text-xs font-bold uppercase tracking-wider text-white" style={{ background: '#c27d38' }}>Retry</button>
      </div>
    </div>
  );

  return (
    <div className={`w-full pt-11 ${todayView ? '' : 'min-h-screen pb-12'}`} style={{ background: '#fafafa', fontFamily: 'ui-sans-serif, system-ui, sans-serif' }}>

      <ScheduleNav
        todayView={todayView}
        setTodayView={setTodayView}
        weekStart={weekStart}
        isCurrentWeek={isCurrentWeek}
        goToPrevWeek={goToPrevWeek}
        goToNextWeek={goToNextWeek}
        goToThisWeek={goToThisWeek}
        tutors={tutors}
        selectedTutorFilter={selectedTutorFilter}
        setSelectedTutorFilter={setSelectedTutorFilter}
        onOpenTutorModal={() => setIsTutorModalOpen(true)}
        onOpenEnrollModal={() => setIsEnrollModalOpen(true)}
        // ── CommandBar sits inside ScheduleNav as a button in the header ──
        commandBarSlot={
          <CommandBar
            sessions={sessions}
            students={students}
            tutors={tutors}
            onBookingAction={handleAIBookingAction}
            allAvailableSeats={allAvailableSeats}
          />
        }
      />

      {todayView && (
        <TodayView
          tutors={tutors}
          sessions={sessions}
          timeOff={timeOff}
          students={students}
          selectedTutorFilter={selectedTutorFilter}
          tutorPaletteMap={tutorPaletteMap}
          setSelectedSessionWithNotes={setSelectedSessionWithNotes}
          handleGridSlotClick={handleGridSlotClick}
          refetch={refetch}
          selectedDate={todayDate}
          onDateChange={handleTodayDateChange}
          onInlineBook={async ({ tutorId, date, time, student, topic }) => {
            await bookStudent({
              tutorId, date, time, student, topic,
              notes: '', recurring: false, recurringWeeks: 1,
            });
          }}
        />
      )}

      {!todayView && (
        <WeekView
          activeDates={activeDates}
          tutors={tutors}
          sessions={sessions}
          timeOff={timeOff}
          students={students}
          selectedTutorFilter={selectedTutorFilter}
          tutorPaletteMap={tutorPaletteMap}
          setSelectedSessionWithNotes={setSelectedSessionWithNotes}
          handleGridSlotClick={handleGridSlotClick}
          refetch={refetch}
          onInlineBook={async ({ tutorId, date, time, student, topic }) => {
            await bookStudent({
              tutorId, date, time, student, topic,
              notes: '', recurring: false, recurringWeeks: 1,
            });
          }}
        />
      )}

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

      <AttendanceModal
        selectedSession={selectedSession}
        setSelectedSession={setSelectedSession}
        patchSelectedSession={patchSelectedSession}
        modalTab={modalTab}
        setModalTab={setModalTab}
        tutors={tutors}
        students={students}
        sessions={sessions}
        refetch={refetch}
      />

      {bookingToast && <BookingToast data={bookingToast} onClose={() => setBookingToast(null)} />}
      {isTutorModalOpen && <TutorManagementModal tutors={tutors} onClose={() => setIsTutorModalOpen(false)} onRefetch={refetch} />}
    </div>
  );
}