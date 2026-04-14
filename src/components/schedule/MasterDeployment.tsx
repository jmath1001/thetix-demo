"use client"
import React, { useState, useMemo, useEffect, useCallback, useRef } from 'react';
import { useSearchParams } from 'next/navigation';
import { Loader2, Zap } from 'lucide-react';

import { MAX_CAPACITY, getSessionsForDay, type SessionBlock } from '@/components/constants';
import {
  useScheduleData,
  bookStudent,
  removeStudentFromSession,
  moveStudentSession,
  clearWeekNonRecurring,
  getWeekStart,
  getWeekDates,
  toISODate,
  dayOfWeek,
  getCentralTimeNow,
  type BookStudentResult,
  type Tutor,
  type Student,
} from '@/lib/useScheduleData';
import { BookingForm, BookingToast } from '@/components/BookingForm';
import { TutorManagementModal } from '@/components/TutorManagementModal';
import OptimizationPreview from '@/components/OptimizationPreview';
import { useOptimizer } from '@/hooks/useOptimizer';
import type { PrefilledSlot, BookingConfirmData } from '@/components/BookingForm';

import { ACTIVE_DAYS, DAY_NAMES, TUTOR_PALETTES } from './scheduleConstants';
import { isTutorAvailable } from './scheduleUtils';
import { ScheduleNav } from './ScheduleNav';
import { TodayView } from './TodayView';
import { WeekView } from './WeekView';
import { AttendanceModal } from './AttendanceModal';
import { logEvent } from '@/lib/analytics';
import { CommandBar } from '@/components/CommandBar';
import { ScheduleBuilder } from '@/components/ScheduleBuilder';
import { ScheduleOptimizerController, type OptimizerScope } from '@/components/optimizer/ScheduleOptimizerController';

export default function MasterDeployment() {
  const searchParams = useSearchParams();
  const lastHandledActionRef = useRef<string | null>(null);
  const optimizerRunRef = useRef<(scope?: OptimizerScope) => void>(() => {});
  const [todayDate, setTodayDate] = useState<Date>(() => getCentralTimeNow());
  const [weekStart, setWeekStart] = useState<Date>(() => getWeekStart(getCentralTimeNow()));
  const [isScheduleBuilderOpen, setIsScheduleBuilderOpen] = useState(false);
  const [scheduleBuilderMode, setScheduleBuilderMode] = useState<'batch' | 'single'>('batch');
  const [isSchedulerMenuOpen, setIsSchedulerMenuOpen] = useState(false);

  const weekDates = useMemo(() => getWeekDates(weekStart), [weekStart]);
  const { tutors, students, sessions, timeOff, loading, error, refetch } = useScheduleData(weekStart);
  const nextWeekStart = useMemo(() => {
    const d = new Date(weekStart);
    d.setDate(d.getDate() + 7);
    return d;
  }, [weekStart]);
  const { sessions: nextWeekSessions } = useScheduleData(nextWeekStart);

  const [selectedSession, setSelectedSession] = useState<any>(null);
  const [isEnrollModalOpen, setIsEnrollModalOpen] = useState(false);
  const [aiPrefilledStudentId, setAiPrefilledStudentId] = useState<string | null>(null);
  const [gridSlotToBook, setGridSlotToBook] = useState<PrefilledSlot | null>(null);
  const [enrollCat, setEnrollCat] = useState('math');
  const [bookingToast, setBookingToast] = useState<BookingConfirmData | null>(null);
  const [isTutorModalOpen, setIsTutorModalOpen] = useState(false);
  const [selectedTutorFilter, setSelectedTutorFilter] = useState<string | null>(null);
  const [todayView, setTodayView] = useState(true);
  const [modalTab, setModalTab] = useState<'attendance' | 'confirmation' | 'notes'>('attendance');
  const [bulkRemoveMode, setBulkRemoveMode] = useState(false);
  const [selectedRemovals, setSelectedRemovals] = useState<Record<string, { sessionId: string; studentId: string; name: string }>>({});
  const [isBulkRemoving, setIsBulkRemoving] = useState(false);
  const [isClearingWeek, setIsClearingWeek] = useState(false);
  const [localSessions, setLocalSessions] = useState(sessions);
  const [infoToast, setInfoToast] = useState<string | null>(null);

  useEffect(() => {
    setLocalSessions(sessions);
  }, [sessions]);

  const applyInlineBookingOptimistic = useCallback((
    current: typeof localSessions,
    args: {
      tutorId: string;
      date: string;
      time: string;
      student: Student;
      topic: string;
      notes: string;
      recurring: boolean;
      recurringWeeks: number;
    }
  ) => {
    const { tutorId, date, time, student, topic, notes, recurring, recurringWeeks } = args;
    const weeks = recurring ? recurringWeeks : 1;
    const next = [...current];

    for (let w = 0; w < weeks; w++) {
      const d = new Date(date + 'T00:00:00');
      d.setDate(d.getDate() + (w * 7));
      const isoDate = toISODate(d);

      const studentRow = {
        rowId: `temp-${Date.now()}-${w}-${Math.random().toString(16).slice(2)}`,
        id: student.id,
        name: student.name,
        topic,
        status: 'scheduled',
        grade: student.grade ?? null,
        notes: notes || null,
        confirmationStatus: null,
        seriesId: null,
      };

      const existingIdx = next.findIndex(s => s.date === isoDate && s.tutorId === tutorId && s.time === time);
      if (existingIdx >= 0) {
        const existing = next[existingIdx];
        if (existing.students.some(st => st.id === student.id && st.status !== 'cancelled')) continue;
        next[existingIdx] = {
          ...existing,
          students: [...existing.students, studentRow],
        };
      } else {
        next.push({
          id: `temp-session-${Date.now()}-${w}-${Math.random().toString(16).slice(2)}`,
          date: isoDate,
          tutorId,
          time,
          students: [studentRow],
        });
      }
    }

    next.sort((a, b) => a.date.localeCompare(b.date) || a.time.localeCompare(b.time));
    return next;
  }, []);

  const reconcileInlineBooking = useCallback((
    current: typeof localSessions,
    bookedRows: BookStudentResult[],
    student: Student,
  ) => {
    const next = [...current];

    for (const row of bookedRows) {
      const idx = next.findIndex(s => s.date === row.date && s.tutorId === row.tutorId && s.time === row.time);
      const normalizedStudent = {
        rowId: row.rowId,
        id: row.studentId,
        name: student.name,
        topic: row.topic,
        status: 'scheduled',
        grade: student.grade ?? null,
        notes: row.notes,
        confirmationStatus: null,
        seriesId: row.seriesId,
      };

      if (idx >= 0) {
        const existing = next[idx];
        const studentIdx = existing.students.findIndex(st => st.id === row.studentId);
        const studentsForSession = studentIdx >= 0
          ? existing.students.map((st, sIdx) => (sIdx === studentIdx ? normalizedStudent : st))
          : [...existing.students, normalizedStudent];
        next[idx] = {
          ...existing,
          id: row.sessionId,
          students: studentsForSession,
        };
      } else {
        next.push({
          id: row.sessionId,
          date: row.date,
          tutorId: row.tutorId,
          time: row.time,
          students: [normalizedStudent],
        });
      }
    }

    next.sort((a, b) => a.date.localeCompare(b.date) || a.time.localeCompare(b.time));
    return next;
  }, []);

  const handleTodayDateChange = useCallback((date: Date) => {
    setTodayDate(date);
    setWeekStart(getWeekStart(date));
  }, []);

  useEffect(() => {
    const fromQuery = searchParams.get('date');
    if (!fromQuery || !/^\d{4}-\d{2}-\d{2}$/.test(fromQuery)) return;
    const parsed = new Date(fromQuery + 'T00:00:00');
    if (Number.isNaN(parsed.getTime())) return;
    if (toISODate(parsed) === toISODate(todayDate)) return;
    setTodayDate(parsed);
    setWeekStart(getWeekStart(parsed));
  }, [searchParams, todayDate]);

  useEffect(() => {
    if (!todayView) return;
    const selectedWeek = getWeekStart(todayDate);
    if (toISODate(selectedWeek) !== toISODate(weekStart)) {
      setWeekStart(selectedWeek);
    }
  }, [todayView, todayDate, weekStart]);

  const handleScheduleBuilderConfirm = useCallback(async (
    bookings: { student: Student; slot: any; topic: string }[]
  ) => {
    for (const booking of bookings) {
      await bookStudent({
        tutorId: booking.slot.tutor.id,
        date: booking.slot.date,
        time: booking.slot.time,
        student: booking.student,
        topic: booking.topic,
        notes: '',
        recurring: false,
        recurringWeeks: 1,
      });
    }
    refetch();
    setIsScheduleBuilderOpen(false);
    logEvent('schedule_builder_confirmed', { count: bookings.length });
  }, [refetch]);

  useEffect(() => {
    if (todayView) {
      document.documentElement.style.overflow = 'hidden';
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
  const selectedBulkCount = useMemo(() => Object.keys(selectedRemovals).length, [selectedRemovals]);

  useEffect(() => {
    if (!bulkRemoveMode) setSelectedRemovals({});
  }, [bulkRemoveMode]);

  const handleBulkRemove = useCallback(async () => {
    if (!selectedBulkCount) return;
    if (!window.confirm(`Remove ${selectedBulkCount} selected booking${selectedBulkCount === 1 ? '' : 's'}?`)) return;
    setIsBulkRemoving(true);
    try {
      await Promise.all(Object.values(selectedRemovals).map(item =>
        removeStudentFromSession({ sessionId: item.sessionId, studentId: item.studentId })
      ));
      setSelectedRemovals({});
      setBulkRemoveMode(false);
      refetch();
      logEvent('bulk_remove_sessions', { count: selectedBulkCount, source: 'schedule_nav' });
    } catch (err: any) {
      console.error('Bulk removal failed', err);
      alert(err?.message || 'Bulk removal failed. Please try again.');
    } finally {
      setIsBulkRemoving(false);
    }
  }, [selectedBulkCount, selectedRemovals, refetch]);

  const handleClearWeekNonRecurring = useCallback(async () => {
    const from = toISODate(weekStart);
    if (!window.confirm(`Clear all non-recurring bookings for the week starting ${from}? Recurring bookings will be preserved.`)) {
      return;
    }

    setIsClearingWeek(true);
    try {
      const result = await clearWeekNonRecurring({ weekStart: from });
      setSelectedRemovals({});
      setBulkRemoveMode(false);
      refetch();
      logEvent('week_cleared_non_recurring', { weekStart: from, ...result });
      alert(`Cleared ${result.deletedBookings} non-recurring booking${result.deletedBookings === 1 ? '' : 's'} for this week.`);
    } catch (err: any) {
      console.error('Clear week failed', err);
      alert(err?.message || 'Failed to clear this week. Please try again.');
    } finally {
      setIsClearingWeek(false);
    }
  }, [weekStart, refetch]);

  // Filtered by enrollCat — for BookingForm
  const allAvailableSeats = useMemo(() => {
    const seats: any[] = [];
    tutors.filter(t => t.cat === enrollCat).forEach(tutor => {
      activeDates.forEach(date => {
        const isoDate = toISODate(date);
        const dow = dayOfWeek(isoDate);
        if (!tutor.availability.includes(dow)) return;
        if (timeOff.some(t => t.tutorId === tutor.id && t.date === isoDate)) return;
        getSessionsForDay(dow).forEach(block => {
          if (!isTutorAvailable(tutor, dow, block.time)) return;
          const session = localSessions.find(s => s.date === isoDate && s.tutorId === tutor.id && s.time === block.time);
          const count = session ? session.students.filter((s: any) => s.status !== 'cancelled').length : 0;
          if (count < MAX_CAPACITY) {
            seats.push({ tutor, dayName: DAY_NAMES[ACTIVE_DAYS.indexOf(dow)], date: isoDate, time: block.time, block, count, seatsLeft: MAX_CAPACITY - count, dayNum: dow });
          }
        });
      });
    });
    return seats.sort((a, b) => { const dd = a.date.localeCompare(b.date); return dd !== 0 ? dd : a.time.localeCompare(b.time); });
  }, [enrollCat, tutors, localSessions, activeDates, timeOff]);

  // All tutors regardless of category — for ScheduleBuilder
  const allSeatsForBuilder = useMemo(() => {
    const seats: any[] = [];
    tutors.forEach(tutor => {
      activeDates.forEach(date => {
        const isoDate = toISODate(date);
        const dow = dayOfWeek(isoDate);
        if (!tutor.availability.includes(dow)) return;
        if (timeOff.some(t => t.tutorId === tutor.id && t.date === isoDate)) return;
        getSessionsForDay(dow).forEach(block => {
          if (!isTutorAvailable(tutor, dow, block.time)) return;
          const session = localSessions.find(s => s.date === isoDate && s.tutorId === tutor.id && s.time === block.time);
          const count = session ? session.students.filter((s: any) => s.status !== 'cancelled').length : 0;
          if (count < MAX_CAPACITY) {
            seats.push({ tutor, dayName: DAY_NAMES[ACTIVE_DAYS.indexOf(dow)], date: isoDate, time: block.time, block, count, seatsLeft: MAX_CAPACITY - count, dayNum: dow });
          }
        });
      });
    });
    return seats.sort((a, b) => { const dd = a.date.localeCompare(b.date); return dd !== 0 ? dd : a.time.localeCompare(b.time); });
  }, [tutors, localSessions, activeDates, timeOff]);

  const handleInlineBook = useCallback(async ({ tutorId, date, time, student, topic, notes, recurring, recurringWeeks }: {
    tutorId: string;
    date: string;
    time: string;
    student: Student;
    topic: string;
    notes: string;
    recurring: boolean;
    recurringWeeks: number;
  }) => {
    let previousSessions = localSessions;
    setLocalSessions(curr => {
      previousSessions = curr;
      return applyInlineBookingOptimistic(curr, { tutorId, date, time, student, topic, notes, recurring, recurringWeeks });
    });

    try {
      const bookedRows = await bookStudent({ tutorId, date, time, student, topic, notes: notes || '', recurring, recurringWeeks });
      setLocalSessions(curr => reconcileInlineBooking(curr, bookedRows, student));
    } catch (err) {
      setLocalSessions(previousSessions);
      throw err;
    }
  }, [localSessions, applyInlineBookingOptimistic, reconcileInlineBooking]);

  // Week range strings for ScheduleBuilder
  const weekStartIso = toISODate(weekStart);
  const weekEndIso = useMemo(() => {
    const d = new Date(weekStart);
    d.setDate(d.getDate() + 6);
    return toISODate(d);
  }, [weekStart]);

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

  const handleAIBookingAction = useCallback(({
    studentId, slotDate, slotTime, tutorId, topic,
  }: {
    studentId?: string
    slotDate?: string
    slotTime?: string
    tutorId?: string
    topic?: string
  }) => {
    if (studentId && !slotDate && !slotTime && !tutorId) {
      setAiPrefilledStudentId(studentId);
      setIsEnrollModalOpen(true);
      logEvent('ai_booking_initiated', { studentId });
      return;
    }
    if (!slotDate || !slotTime || !tutorId) return;
    const tutor = tutors.find(t => t.id === tutorId);
    if (!tutor) return;
    const dow = dayOfWeek(slotDate);
    const block = getSessionsForDay(dow).find(b => b.time === slotTime);
    const dayName = DAY_NAMES[ACTIVE_DAYS.indexOf(dow)];
    setGridSlotToBook({ tutor, dayNum: dow, dayName, time: slotTime, date: slotDate, block } as any);
    setEnrollCat(tutor.cat);
    setAiPrefilledStudentId(studentId ?? null);
    setIsEnrollModalOpen(true);
    logEvent('ai_booking_initiated', { studentId, tutorId, slotDate, slotTime, topic });
  }, [tutors]);

  const setSelectedSessionWithNotes = (s: any) => {
    setSelectedSession(s);
    setModalTab('attendance');
  };

  const patchSelectedSession = useCallback((patch: Record<string, any>) => {
    setSelectedSession((prev: any) => {
      if (!prev) return prev;
      return { ...prev, activeStudent: { ...prev.activeStudent, ...patch } };
    });
  }, []);

  const closeAllModals = () => {
    setIsEnrollModalOpen(false);
    setGridSlotToBook(null);
    setAiPrefilledStudentId(null);
  };

  const applyOptimizerChanges = useCallback(async (changes: any[]) => {
    let applied = 0;
    let moved = 0;
    let placed = 0;
    const failed: string[] = [];

    for (const change of changes ?? []) {
      const action = change?.action ?? 'place';

      if (action === 'move') {
        const rowId = change?.rowId;
        const studentId = change?.studentId;
        const fromSessionId = change?.fromSessionId;
        const slot = change?.newSlot;
        const toTutorId = slot?.tutorId;
        const toDate = slot?.date;
        const toTime = slot?.time;

        if (!rowId || !studentId || !fromSessionId || !toTutorId || !toDate || !toTime) {
          failed.push(`Skipped ${change?.studentName || 'student'}: missing move data.`);
          continue;
        }

        try {
          await moveStudentSession({ rowId, studentId, fromSessionId, toTutorId, toDate, toTime });
          applied += 1;
          moved += 1;
        } catch (err: any) {
          const msg = err?.message || 'move failed';
          failed.push(`Failed move ${change?.studentName || studentId}: ${msg}`);
        }
        continue;
      }

      const studentName = change?.studentName;
      const slot = change?.newSlot;
      if (!studentName || !slot?.date || !slot?.time || !slot?.tutorName) {
        failed.push('Skipped one suggestion with missing student/slot data.');
        continue;
      }

      const student = students.find((s: any) => s.id === change?.studentId) ?? students.find((s: any) => s.name === studentName);
      const tutor = tutors.find((t: any) => t.id === slot?.tutorId) ?? tutors.find((t: any) => t.name === slot.tutorName);
      const topic = slot.topic || change.subject || student?.subject;

      if (!student || !tutor || !topic) {
        failed.push(`Skipped ${studentName}: missing ${!student ? 'student' : !tutor ? 'tutor' : 'topic'} data.`);
        continue;
      }

      try {
        await bookStudent({
          tutorId: tutor.id,
          date: slot.date,
          time: slot.time,
          student,
          topic,
          notes: '',
          recurring: false,
          recurringWeeks: 1,
        });
        applied += 1;
        placed += 1;
      } catch (err: any) {
        const msg = err?.message || 'booking failed';
        failed.push(`Failed ${studentName}: ${msg}`);
      }
    }

    if (applied > 0) {
      refetch();
      if (placed > 0) logEvent('session_booked', { source: 'optimizer', count: placed });
      if (moved > 0) logEvent('reassign_used', { source: 'optimizer', count: moved });
    }

    if (failed.length > 0) {
      alert(`${applied} optimization booking${applied === 1 ? '' : 's'} applied. ${failed.length} issue${failed.length === 1 ? '' : 's'}:\n\n${failed.slice(0, 5).join('\n')}`);
    } else if (applied === 0) {
      alert('No optimizer changes were applied.');
    }
  }, [refetch, students, tutors]);

  const { proposal, isApplying, openPreview, confirmChanges, closePreview } = useOptimizer(refetch, applyOptimizerChanges);

  const openOptimizerFromCurrentSchedule = useCallback((scope: OptimizerScope = 'weekly') => {
    optimizerRunRef.current(scope);
  }, []);

  useEffect(() => {
    const action = searchParams.get('action');
    const key = action ? `${action}` : null;

    if (!action) {
      lastHandledActionRef.current = null;
      return;
    }
    if (lastHandledActionRef.current === key) return;

    if (action === 'build' || action === 'schedule-batch') {
      setScheduleBuilderMode('batch');
      setIsScheduleBuilderOpen(true);
      setIsSchedulerMenuOpen(false);
      lastHandledActionRef.current = key;
      return;
    }

    if (action === 'schedule-single') {
      setScheduleBuilderMode('single');
      setIsScheduleBuilderOpen(true);
      setIsSchedulerMenuOpen(false);
      lastHandledActionRef.current = key;
      return;
    }

    if (action === 'optimized-scheduler') {
      setScheduleBuilderMode('batch');
      setIsScheduleBuilderOpen(true);
      setIsSchedulerMenuOpen(false);
      lastHandledActionRef.current = key;
      return;
    }

    if (action === 'optimize') {
      openOptimizerFromCurrentSchedule('weekly');
      lastHandledActionRef.current = key;
      return;
    }

    if (action === 'optimize-daily') {
      openOptimizerFromCurrentSchedule('daily');
      lastHandledActionRef.current = key;
      return;
    }

    if (action === 'optimize-weekly') {
      openOptimizerFromCurrentSchedule('weekly');
      lastHandledActionRef.current = key;
    }
  }, [openOptimizerFromCurrentSchedule, searchParams]);

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
    <div className={`w-full ${todayView ? '' : 'min-h-screen pb-12'}`} style={{ background: '#fafafa', fontFamily: 'ui-sans-serif, system-ui, sans-serif' }}>

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
        onOpenEnrollModal={() => setIsEnrollModalOpen(true)}
        bulkRemoveMode={bulkRemoveMode}
        selectedBulkCount={selectedBulkCount}
        isBulkRemoving={isBulkRemoving}
        onToggleBulkRemoveMode={() => setBulkRemoveMode(prev => !prev)}
        onBulkRemove={handleBulkRemove}
        onClearBulkSelection={() => setSelectedRemovals({})}
        onClearWeekNonRecurring={handleClearWeekNonRecurring}
        isClearingWeek={isClearingWeek}
        commandBarSlot={
          <>
            <CommandBar
              sessions={[...localSessions, ...(nextWeekSessions ?? [])]}
              students={students}
              tutors={tutors}
              onBookingAction={handleAIBookingAction}
              onOpenProposal={openPreview}
              onOpenAttendanceModal={(session) => setSelectedSession(session)}
              allAvailableSeats={allAvailableSeats}
              weekStart={weekStartIso}
              nextWeekStart={toISODate(nextWeekStart)}
            />
            <div style={{ position: 'relative', display: 'inline-flex', alignItems: 'center' }}>
              <button
                onClick={() => setIsSchedulerMenuOpen(prev => !prev)}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 6,
                  padding: '5px 12px',
                  borderRadius: 9,
                  background: '#1e293b',
                  border: '1px solid #0f172a',
                  color: '#f8fafc',
                  fontSize: 12,
                  fontWeight: 800,
                  cursor: 'pointer',
                  whiteSpace: 'nowrap',
                  boxShadow: '0 4px 10px rgba(15,23,42,0.35)',
                }}
              >
                <Zap size={12} /> Optimized Scheduler
              </button>

              {isSchedulerMenuOpen && (
                <div
                  style={{
                    position: 'absolute',
                    top: 'calc(100% + 8px)',
                    right: 0,
                    width: 280,
                    borderRadius: 12,
                    border: '1px solid #94a3b8',
                    background: '#ffffff',
                    boxShadow: '0 16px 34px rgba(15,23,42,0.26)',
                    padding: 10,
                    zIndex: 50,
                  }}
                >
                  <p style={{ margin: '0 0 6px', fontSize: 11, fontWeight: 800, color: '#0f172a', letterSpacing: '0.03em' }}>Scheduler Actions</p>
                  <div style={{ display: 'grid', gap: 6 }}>
                    <button onClick={() => { setScheduleBuilderMode('batch'); setIsScheduleBuilderOpen(true); setIsSchedulerMenuOpen(false); }} style={{ textAlign: 'left', borderRadius: 8, border: '1px solid #cbd5e1', background: '#f8fafc', color: '#0f172a', padding: '7px 10px', fontSize: 12, fontWeight: 700, cursor: 'pointer' }}>Plan Week</button>
                    <button onClick={() => { setScheduleBuilderMode('single'); setIsScheduleBuilderOpen(true); setIsSchedulerMenuOpen(false); }} style={{ textAlign: 'left', borderRadius: 8, border: '1px solid #cbd5e1', background: '#f8fafc', color: '#0f172a', padding: '7px 10px', fontSize: 12, fontWeight: 700, cursor: 'pointer' }}>Book One Session</button>
                    <button onClick={() => { openOptimizerFromCurrentSchedule('daily'); setIsSchedulerMenuOpen(false); }} style={{ textAlign: 'left', borderRadius: 8, border: '1px solid #67e8f9', background: '#ecfeff', color: '#0e7490', padding: '7px 10px', fontSize: 12, fontWeight: 800, cursor: 'pointer' }}>Optimize Day (Max Pack)</button>
                    <button onClick={() => { openOptimizerFromCurrentSchedule('weekly'); setIsSchedulerMenuOpen(false); }} style={{ textAlign: 'left', borderRadius: 8, border: '1px solid #93c5fd', background: '#eff6ff', color: '#1d4ed8', padding: '7px 10px', fontSize: 12, fontWeight: 800, cursor: 'pointer' }}>Optimize Week (Max Pack)</button>
                  </div>

                  <div style={{ marginTop: 8, borderRadius: 8, border: '1px solid #cbd5e1', background: '#f8fafc', padding: 8 }}>
                    <p style={{ margin: '0 0 4px', fontSize: 10, fontWeight: 800, color: '#334155', letterSpacing: '0.04em', textTransform: 'uppercase' }}>Constraints Used</p>
                    <p style={{ margin: 0, fontSize: 11, color: '#0f172a', lineHeight: 1.5 }}>Primary objective is max session packing. Subject fit, student availability, tutor availability/time-off, no double-booking, and seat limits are enforced.</p>
                  </div>
                </div>
              )}
            </div>
          </>
        }
      />

      {todayView && (
        <TodayView
          tutors={tutors}
          sessions={localSessions}
          timeOff={timeOff}
          students={students}
          selectedTutorFilter={selectedTutorFilter}
          tutorPaletteMap={tutorPaletteMap}
          setSelectedSessionWithNotes={setSelectedSessionWithNotes}
          handleGridSlotClick={handleGridSlotClick}
          refetch={refetch}
          selectedDate={todayDate}
          onDateChange={handleTodayDateChange}
          onInlineBook={handleInlineBook}
          onMoveStudent={async ({ rowId, studentId, fromSessionId, toTutorId, toDate, toTime }) => {
            await moveStudentSession({ rowId, studentId, fromSessionId, toTutorId, toDate, toTime });
            refetch();
          }}
        />
      )}

      {!todayView && (
        <WeekView
          activeDates={activeDates}
          tutors={tutors}
          sessions={localSessions}
          timeOff={timeOff}
          students={students}
          selectedTutorFilter={selectedTutorFilter}
          tutorPaletteMap={tutorPaletteMap}
          setSelectedSessionWithNotes={setSelectedSessionWithNotes}
          handleGridSlotClick={handleGridSlotClick}
          refetch={refetch}
          bulkRemoveMode={bulkRemoveMode}
          selectedRemovals={selectedRemovals}
          setSelectedRemovals={setSelectedRemovals}
          onInlineBook={handleInlineBook}
          onMoveStudent={async ({ rowId, studentId, fromSessionId, toTutorId, toDate, toTime }) => {
            await moveStudentSession({ rowId, studentId, fromSessionId, toTutorId, toDate, toTime });
            refetch();
          }}
        />
      )}

      {isEnrollModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{ background: 'rgba(20,14,8,0.75)', backdropFilter: 'blur(8px)' }}>
          <BookingForm
            prefilledSlot={null}
            onConfirm={handleConfirmBooking}
            onCancel={closeAllModals}
            enrollCat={enrollCat}
            setEnrollCat={setEnrollCat}
            allAvailableSeats={allAvailableSeats}
            studentDatabase={students}
            initialStudentId={aiPrefilledStudentId}
            sessions={localSessions}
          />
        </div>
      )}
      {gridSlotToBook && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{ background: 'rgba(20,14,8,0.75)', backdropFilter: 'blur(8px)' }}>
          <BookingForm
            prefilledSlot={gridSlotToBook}
            onConfirm={handleConfirmBooking}
            onCancel={closeAllModals}
            enrollCat={enrollCat}
            setEnrollCat={setEnrollCat}
            allAvailableSeats={allAvailableSeats}
            studentDatabase={students}
            initialStudentId={aiPrefilledStudentId}
            sessions={localSessions}
          />
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
        sessions={localSessions}
        refetch={refetch}
      />

      {bookingToast && <BookingToast data={bookingToast} onClose={() => setBookingToast(null)} />}
            {infoToast && (
              <div className="fixed bottom-6 left-1/2 z-60 flex min-w-75 max-w-[90vw] -translate-x-1/2 items-center gap-3 rounded-2xl border border-slate-200 bg-white px-5 py-4 shadow-2xl">
                <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-slate-100 text-slate-500">
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>
                </div>
                <p className="flex-1 text-sm font-medium text-slate-700">{infoToast}</p>
                <button onClick={() => setInfoToast(null)} className="shrink-0 text-slate-400 hover:text-slate-600">
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
                </button>
              </div>
            )}
      {isTutorModalOpen && <TutorManagementModal tutors={tutors} onClose={() => setIsTutorModalOpen(false)} onRefetch={refetch} />}

      <ScheduleOptimizerController
        students={students}
        tutors={tutors}
        localSessions={localSessions}
        allSeatsForBuilder={allSeatsForBuilder}
        onOpenProposal={openPreview}
        onNoSuggestions={(scope) => {
          const msg = scope === 'daily'
            ? 'No available swaps today — sessions are already as packed as availability allows.'
            : 'No available swaps this week — the schedule is already at maximum consolidation.';
          setInfoToast(msg);
          setTimeout(() => setInfoToast(null), 4500);
        }}
        onBindRun={(run) => {
          optimizerRunRef.current = run;
        }}
      />

      <OptimizationPreview
        proposal={proposal}
        onConfirm={confirmChanges}
        onCancel={closePreview}
        isApplying={isApplying}
        activeDates={activeDates}
        tutors={tutors}
        sessions={localSessions}
        timeOff={timeOff}
        students={students}
        tutorPaletteMap={tutorPaletteMap}
      />

      {isScheduleBuilderOpen && (
        <ScheduleBuilder
          students={students}
          tutors={tutors}
          sessions={localSessions}
          allAvailableSeats={allSeatsForBuilder}
          weekStart={weekStartIso}
          weekEnd={weekEndIso}
          initialMode={scheduleBuilderMode}
          onConfirm={handleScheduleBuilderConfirm}
          onClose={() => setIsScheduleBuilderOpen(false)}
        />
      )}
    </div>
  );
}