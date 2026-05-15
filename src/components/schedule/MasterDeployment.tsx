"use client"
import React, { useState, useMemo, useEffect, useCallback, useRef } from 'react';
import { useSearchParams } from 'next/navigation';
import { Loader2, Zap } from 'lucide-react';

import { MAX_CAPACITY, getSessionsForDay, type SessionBlock, type SessionTimesByDay } from '@/components/constants';
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
import OptimizationPreview from '../OptimizationPreview';
import { useOptimizer } from '@/hooks/useOptimizer';
import type { PrefilledSlot, BookingConfirmData } from '@/components/BookingForm';

import { ACTIVE_DAYS, DAY_NAMES } from './scheduleConstants';
import { isTutorAvailable } from './scheduleUtils';
import { ScheduleNav } from './ScheduleNav';
import { TodayView } from './TodayView';
import { WeekView } from './WeekView';
import { AttendanceModal } from './AttendanceModal';
import { logEvent } from '@/lib/analytics';
import { CommandBar } from '@/components/CommandBar';
import { ScheduleBuilder } from '@/components/ScheduleBuilder';
import { ScheduleOptimizerController, type OptimizerScope } from '@/components/optimizer/ScheduleOptimizerController';
import { ConfirmWeekModal } from './ConfirmWeekModal';

const SCHEDULE_VIEW_STORAGE_KEY = 'schedule:viewMode';

type TermOption = {
  id: string;
  name: string;
  status: string;
  start_date: string;
  end_date: string;
  session_times_by_day: SessionTimesByDay | null;
};

export default function MasterDeployment() {
  const searchParams = useSearchParams();
  const lastHandledActionRef = useRef<string | null>(null);
  const optimizerRunRef = useRef<(scope?: OptimizerScope) => void>(() => {});
  const weekBeforeTodayRef = useRef<Date | null>(null);
  const [todayDate, setTodayDate] = useState<Date>(() => getCentralTimeNow());
  const [weekStart, setWeekStart] = useState<Date>(() => getWeekStart(getCentralTimeNow()));
  const [isScheduleBuilderOpen, setIsScheduleBuilderOpen] = useState(false);
  const [scheduleBuilderMode, setScheduleBuilderMode] = useState<'batch' | 'single'>('batch');
  const [builderTerms, setBuilderTerms] = useState<TermOption[]>([]);
  const [selectedBuilderTermId, setSelectedBuilderTermId] = useState<string>('');

  const weekDates = useMemo(() => getWeekDates(weekStart), [weekStart]);
  const { tutors, students, sessions, timeOff, activeTermSessionTimesByDay, activeStudentIds, loading, error, refetch } = useScheduleData(weekStart, {
    termId: selectedBuilderTermId || null,
  });
  const nextWeekStart = useMemo(() => {
    const d = new Date(weekStart);
    d.setDate(d.getDate() + 7);
    return d;
  }, [weekStart]);
  const { sessions: nextWeekSessions } = useScheduleData(nextWeekStart, {
    termId: selectedBuilderTermId || null,
  });

  const [selectedSession, setSelectedSession] = useState<any>(null);
  const [isEnrollModalOpen, setIsEnrollModalOpen] = useState(false);
  const [aiPrefilledStudentId, setAiPrefilledStudentId] = useState<string | null>(null);
  const [gridSlotToBook, setGridSlotToBook] = useState<PrefilledSlot | null>(null);
  const [enrollCat, setEnrollCat] = useState('math');
  const [bookingToast, setBookingToast] = useState<BookingConfirmData | null>(null);
  const [isTutorModalOpen, setIsTutorModalOpen] = useState(false);
  const [selectedTutorFilter, setSelectedTutorFilter] = useState<string | null>(null);
  const [todayView, setTodayView] = useState<boolean>(() => {
    if (typeof window === 'undefined') return false;
    const stored = window.localStorage.getItem(SCHEDULE_VIEW_STORAGE_KEY);
    if (stored === 'today') return true;
    if (stored === 'week') return false;
    return false;
  });
  const [modalTab, setModalTab] = useState<'attendance' | 'confirmation' | 'notes'>('attendance');
  const [bulkRemoveMode, setBulkRemoveMode] = useState(false);
  const [selectedRemovals, setSelectedRemovals] = useState<Record<string, { sessionId: string; studentId: string; name: string }>>({});
  const [isBulkRemoving, setIsBulkRemoving] = useState(false);
  const [isClearingWeek, setIsClearingWeek] = useState(false);
  const [localSessions, setLocalSessions] = useState(sessions);
  const [isConfirmWeekOpen, setIsConfirmWeekOpen] = useState(false);
  const [weekConfirmedAt, setWeekConfirmedAt] = useState<string | null>(null);

  useEffect(() => {
    setLocalSessions(sessions);
  }, [sessions]);

  useEffect(() => {
    const iso = toISODate(weekStart);
    const key = `week-confirmed-${iso}`;
    try {
      const stored = localStorage.getItem(key);
      setWeekConfirmedAt(stored ?? null);
    } catch {
      setWeekConfirmedAt(null);
    }
  }, [weekStart]);

  useEffect(() => {
    let cancelled = false;
    async function loadTermsForBuilder() {
      try {
        const res = await fetch('/api/terms', { cache: 'no-store' });
        const payload = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(payload?.error || 'Failed to load terms');
        const rows = (Array.isArray(payload?.terms) ? payload.terms : []) as TermOption[];
        if (cancelled) return;
        setBuilderTerms(rows);
        setSelectedBuilderTermId(prev => {
          if (prev && rows.some(t => t.id === prev)) return prev;
          const active = rows.find(t => (t.status ?? '').trim().toLowerCase() === 'active');
          const chosen = active ?? rows[0];
          // Jump weekStart into the chosen term so the builder opens on the right week
          if (chosen?.start_date && /^\d{4}-\d{2}-\d{2}$/.test(chosen.start_date)) {
            const parsed = new Date(chosen.start_date + 'T00:00:00');
            if (!Number.isNaN(parsed.getTime())) {
              setWeekStart(getWeekStart(parsed));
            }
          }
          return chosen?.id ?? '';
        });
      } catch {
        if (!cancelled) {
          setBuilderTerms([]);
          setSelectedBuilderTermId('');
        }
      }
    }
    loadTermsForBuilder();
    return () => { cancelled = true; };
  }, []);

  const selectedBuilderTerm = useMemo(
    () => builderTerms.find(t => t.id === selectedBuilderTermId) ?? null,
    [builderTerms, selectedBuilderTermId]
  );

  const handleBuilderTermChange = useCallback((termId: string) => {
    setSelectedBuilderTermId(termId);

    const term = builderTerms.find(t => t.id === termId);
    const startDate = term?.start_date;
    if (!startDate || !/^\d{4}-\d{2}-\d{2}$/.test(startDate)) return;

    const parsed = new Date(startDate + 'T00:00:00');
    if (Number.isNaN(parsed.getTime())) return;

    setTodayDate(parsed);
    setWeekStart(getWeekStart(parsed));
  }, [builderTerms]);

  // Keep the term dropdown in sync with the week being viewed.
  // When the user navigates to a different week, auto-select the term that covers it.
  useEffect(() => {
    if (builderTerms.length === 0) return;
    const weekStartIso = toISODate(weekStart);
    const weekEndLocal = new Date(weekStart);
    weekEndLocal.setDate(weekEndLocal.getDate() + 6);
    const weekEndIso = toISODate(weekEndLocal);
    const covering = builderTerms.find(t =>
      t.start_date && t.end_date &&
      t.start_date <= weekEndIso && t.end_date >= weekStartIso
    );
    if (covering && covering.id !== selectedBuilderTermId) {
      setSelectedBuilderTermId(covering.id);
    }
  }, [weekStart, builderTerms]);

  const builderSessionTimesByDay = useMemo<SessionTimesByDay | null>(() => {
    const raw = selectedBuilderTerm?.session_times_by_day;
    if (raw && typeof raw === 'object') return raw as SessionTimesByDay;
    return activeTermSessionTimesByDay ?? null;
  }, [selectedBuilderTerm, activeTermSessionTimesByDay]);

  // Session times for the displayed week should come from whichever term covers
  // the current weekStart — not from the nav dropdown selection or the DB-active term.
  // This way switching terms navigates to that term's dates AND shows its session times,
  // while days from a different term keep their own session times.
  const weekDisplayTerm = useMemo(() => {
    const weekStartIso = toISODate(weekStart);
    const weekEnd = new Date(weekStart);
    weekEnd.setDate(weekEnd.getDate() + 6);
    const weekEndIso = toISODate(weekEnd);
    return builderTerms.find(t =>
      t.start_date && t.end_date &&
      t.start_date <= weekEndIso && t.end_date >= weekStartIso
    ) ?? null;
  }, [builderTerms, weekStart]);

  const weekDisplaySessionTimesByDay = useMemo<SessionTimesByDay | null>(() => {
    const raw = weekDisplayTerm?.session_times_by_day;
    if (raw && typeof raw === 'object') return raw as SessionTimesByDay;
    return activeTermSessionTimesByDay ?? null;
  }, [weekDisplayTerm, activeTermSessionTimesByDay]);

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

  const handleSetTodayView = useCallback((v: boolean) => {
    if (v) {
      // Save current week before jumping to today
      weekBeforeTodayRef.current = weekStart;
      const now = getCentralTimeNow();
      setTodayDate(now);
      setWeekStart(getWeekStart(now));
    } else {
      // Restore week position from before Today view was entered
      if (weekBeforeTodayRef.current) {
        setWeekStart(weekBeforeTodayRef.current);
        weekBeforeTodayRef.current = null;
      }
    }
    setTodayView(v);
  }, [weekStart]);

  const handleScheduleBuilderConfirm = useCallback(async (
    bookings: { student: Student; slot: any; topic: string }[],
    options: { recurring: boolean; scheduleMode: 'add' | 'redo' }
  ) => {
    // In redo mode: cancel existing bookings for the affected students during this week
    if (options.scheduleMode === 'redo' && bookings.length > 0) {
      const studentIds = new Set(bookings.map(b => b.student.id))
      const weekIsos = weekDates.map(d => toISODate(d))
      const sessionsThisWeek = localSessions.filter(s => weekIsos.includes(s.date))
      for (const session of sessionsThisWeek) {
        for (const ss of (session.students ?? []) as any[]) {
          if (ss.status !== 'cancelled' && studentIds.has(ss.student_id ?? ss.student?.id)) {
            try {
              await fetch('/api/confirm', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ sessionStudentId: ss.id, status: 'cancelled' }),
              })
            } catch { /* continue */ }
          }
        }
      }
    }

    for (const booking of bookings) {
      let recurring = false;
      let recurringWeeks = 1;
      if (options.recurring && selectedBuilderTerm?.end_date) {
        const slotDate = new Date(booking.slot.date + 'T00:00:00');
        const termEnd = new Date(selectedBuilderTerm.end_date + 'T00:00:00');
        const diffDays = Math.round((termEnd.getTime() - slotDate.getTime()) / (1000 * 60 * 60 * 24));
        const weeks = Math.floor(diffDays / 7) + 1;
        if (weeks > 1) {
          recurring = true;
          recurringWeeks = weeks;
        }
      }
      await bookStudent({
        tutorId: booking.slot.tutor.id,
        date: booking.slot.date,
        time: booking.slot.time,
        student: booking.student,
        topic: booking.topic,
        notes: '',
        recurring,
        recurringWeeks,
      });
    }
    refetch();
    setIsScheduleBuilderOpen(false);
    logEvent('schedule_builder_confirmed', { count: bookings.length, scheduleMode: options.scheduleMode });
  }, [refetch, selectedBuilderTerm, weekDates, localSessions]);

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

  useEffect(() => {
    if (typeof window === 'undefined') return;
    window.localStorage.setItem(SCHEDULE_VIEW_STORAGE_KEY, todayView ? 'today' : 'week');
  }, [todayView]);

  const tutorPaletteMap = useMemo(() => {
    const map: Record<string, number> = {};
    tutors.forEach((t, i) => { map[t.id] = i; });
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

  const activeDateIsos = useMemo(() => new Set(activeDates.map(d => toISODate(d))), [activeDates]);
  const weeklyStudents = useMemo(() =>
    localSessions
      .filter(s => activeDateIsos.has(s.date))
      .reduce((sum, s) => sum + (s.students ?? []).filter((st: any) => st.status !== 'cancelled').length, 0),
    [localSessions, activeDateIsos]
  );
  const weeklySessions = useMemo(() =>
    localSessions
      .filter(s => activeDateIsos.has(s.date) && (s.students ?? []).some((st: any) => st.status !== 'cancelled'))
      .length,
    [localSessions, activeDateIsos]
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
        getSessionsForDay(dow, activeTermSessionTimesByDay).forEach(block => {
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
  }, [enrollCat, tutors, localSessions, activeDates, timeOff, activeTermSessionTimesByDay]);

  // All tutors regardless of category — for ScheduleBuilder
  const allSeatsForBuilder = useMemo(() => {
    const seats: any[] = [];
    tutors.forEach(tutor => {
      activeDates.forEach(date => {
        const isoDate = toISODate(date);
        const dow = dayOfWeek(isoDate);
        if (!tutor.availability.includes(dow)) return;
        if (timeOff.some(t => t.tutorId === tutor.id && t.date === isoDate)) return;
        getSessionsForDay(dow, builderSessionTimesByDay).forEach(block => {
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
  }, [tutors, localSessions, activeDates, timeOff, builderSessionTimesByDay]);

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

  // Builder week: clamp to the selected term so we never book on the wrong term's dates.
  // Use the term's start week if the current view week is before the term starts,
  // or the term's end week if the current view week is after the term ends.
  const builderWeekStartIso = useMemo(() => {
    const term = selectedBuilderTerm;
    if (!term?.start_date || !term?.end_date) return weekStartIso;
    if (weekStartIso < term.start_date) return toISODate(getWeekStart(new Date(term.start_date + 'T00:00:00')));
    if (weekStartIso > term.end_date) return toISODate(getWeekStart(new Date(term.end_date + 'T00:00:00')));
    return weekStartIso;
  }, [weekStartIso, selectedBuilderTerm]);

  const builderWeekEndIso = useMemo(() => {
    const d = new Date(builderWeekStartIso + 'T00:00:00');
    d.setDate(d.getDate() + 6);
    return toISODate(d);
  }, [builderWeekStartIso]);

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
    const block = getSessionsForDay(dow, activeTermSessionTimesByDay).find(b => b.time === slotTime);
    const dayName = DAY_NAMES[ACTIVE_DAYS.indexOf(dow)];
    setGridSlotToBook({ tutor, dayNum: dow, dayName, time: slotTime, date: slotDate, block } as any);
    setEnrollCat(tutor.cat);
    setAiPrefilledStudentId(studentId ?? null);
    setIsEnrollModalOpen(true);
    logEvent('ai_booking_initiated', { studentId, tutorId, slotDate, slotTime, topic });
  }, [tutors, activeTermSessionTimesByDay]);

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
      lastHandledActionRef.current = key;
      return;
    }

    if (action === 'schedule-single') {
      setScheduleBuilderMode('single');
      setIsScheduleBuilderOpen(true);
      lastHandledActionRef.current = key;
      return;
    }

    if (action === 'optimized-scheduler') {
      setScheduleBuilderMode('batch');
      setIsScheduleBuilderOpen(true);
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
      logEvent('auto_book_used', { action: 'optimize_day', source: 'url_action' });
      lastHandledActionRef.current = key;
      return;
    }

    if (action === 'optimize-weekly') {
      openOptimizerFromCurrentSchedule('weekly');
      logEvent('auto_book_used', { action: 'optimize_week', source: 'url_action' });
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
        setTodayView={handleSetTodayView}
        weekStart={weekStart}
        isCurrentWeek={isCurrentWeek}
        goToPrevWeek={goToPrevWeek}
        goToNextWeek={goToNextWeek}
        goToThisWeek={goToThisWeek}
        terms={builderTerms.map(t => ({ id: t.id, name: t.name, status: t.status }))}
        selectedTermId={selectedBuilderTermId}
        setSelectedTermId={handleBuilderTermChange}
        bulkRemoveMode={bulkRemoveMode}
        selectedBulkCount={selectedBulkCount}
        isBulkRemoving={isBulkRemoving}
        onToggleBulkRemoveMode={() => setBulkRemoveMode(prev => !prev)}
        onBulkRemove={handleBulkRemove}
        onClearBulkSelection={() => setSelectedRemovals({})}
        onClearWeekNonRecurring={handleClearWeekNonRecurring}
        isClearingWeek={isClearingWeek}
        weeklyStudents={weeklyStudents}
        weeklySessions={weeklySessions}
        onConfirmWeek={() => setIsConfirmWeekOpen(true)}
        weekConfirmedAt={weekConfirmedAt}
        commandBarSlot={
          <>
            <CommandBar
              sessions={[...localSessions, ...(nextWeekSessions ?? [])]}
              students={students}
              tutors={tutors}
              timeOff={timeOff}
              onDataChanged={refetch}
              onBookingAction={handleAIBookingAction}
              onOpenProposal={openPreview}
              onOpenAttendanceModal={(session) => setSelectedSession(session)}
              allAvailableSeats={allSeatsForBuilder}
              weekStart={weekStartIso}
              nextWeekStart={toISODate(nextWeekStart)}
            />
                        <button
                onClick={() => {
                  logEvent('auto_book_used', { action: 'batch_book', source: 'schedule_header' });
                  setScheduleBuilderMode('batch');
                  setIsScheduleBuilderOpen(true);
                }}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 8,
                  padding: '7px 14px',
                  borderRadius: 11,
                  background: 'linear-gradient(135deg, #0ea5e9 0%, #2563eb 100%)',
                  border: '1px solid #1d4ed8',
                  color: '#ffffff',
                  fontSize: 12,
                  fontWeight: 800,
                  letterSpacing: '0.01em',
                  cursor: 'pointer',
                  whiteSpace: 'nowrap',
                  boxShadow: '0 10px 20px rgba(37,99,235,0.32), 0 2px 6px rgba(14,116,144,0.3)',
                }}
              >
                <span
                  style={{
                    width: 18,
                    height: 18,
                    borderRadius: 999,
                    display: 'inline-flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    background: 'rgba(255,255,255,0.22)',
                    border: '1px solid rgba(255,255,255,0.38)',
                  }}
                >
                  <Zap size={11} />
                </span>
                <span>Schedule Builder</span>
              </button>
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
          sessionTimesByDay={weekDisplaySessionTimesByDay}
          termName={weekDisplayTerm?.name ?? null}
          dateExceptions={(weekDisplayTerm as any)?.date_exceptions ?? null}
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
          sessionTimesByDay={weekDisplaySessionTimesByDay}
          termName={weekDisplayTerm?.name ?? null}
          dateExceptions={(weekDisplayTerm as any)?.date_exceptions ?? null}
          onMoveStudent={async ({ rowId, studentId, fromSessionId, toTutorId, toDate, toTime }) => {
            await moveStudentSession({ rowId, studentId, fromSessionId, toTutorId, toDate, toTime });
            refetch();
          }}
        />
      )}

      {isEnrollModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{ background: 'rgba(20,14,8,0.75)', backdropFilter: 'blur(8px)' }}
          onClick={e => { if (e.target === e.currentTarget) closeAllModals(); }}>
          <div onClick={e => e.stopPropagation()}>
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
        </div>
      )}
      {gridSlotToBook && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{ background: 'rgba(20,14,8,0.75)', backdropFilter: 'blur(8px)' }}
          onClick={e => { if (e.target === e.currentTarget) closeAllModals(); }}>
          <div onClick={e => e.stopPropagation()}>
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
      {isTutorModalOpen && (
        <TutorManagementModal
          tutors={tutors}
          terms={builderTerms.map(t => ({ id: t.id, name: t.name, status: t.status }))}
          selectedTermId={selectedBuilderTermId}
          onSelectTerm={handleBuilderTermChange}
          onClose={() => setIsTutorModalOpen(false)}
          onRefetch={refetch}
        />
      )}

      <ScheduleOptimizerController
        students={students}
        tutors={tutors}
        localSessions={localSessions}
        activeDates={activeDates}
        allSeatsForBuilder={allSeatsForBuilder}
        onOpenProposal={openPreview}
        onNoSuggestions={(scope) => {
          if (scope === 'daily') {
            alert('No daily optimizer suggestions right now. This day may already be near maximum consolidation under availability constraints.');
            return;
          }
          alert('No weekly optimizer suggestions right now. Current schedule may already be near maximum consolidation under availability constraints.');
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
          students={students.map(s => {
            // Normalize subjects and availabilityBlocks like students page
            const normalizeStringArray = (value: any): string[] => {
              if (Array.isArray(value)) {
                return value.map(v => String(v).trim()).filter(Boolean);
              }
              if (typeof value === 'string') {
                const trimmed = value.trim();
                if (!trimmed) return [];
                try {
                  const parsed = JSON.parse(trimmed);
                  if (Array.isArray(parsed)) {
                    return parsed.map(v => String(v).trim()).filter(Boolean);
                  }
                } catch {}
                return trimmed.split(',').map(v => v.trim()).filter(Boolean);
              }
              return [];
            };
            const subjects = normalizeStringArray(s.subjects);
            const availabilityBlocks = normalizeStringArray(s.availabilityBlocks);
            return {
              ...s,
              subjects: subjects.length > 0 ? subjects : (s.subject ? [String(s.subject)] : []),
              availabilityBlocks,
            };
          })}
          tutors={tutors}
          sessions={localSessions}
          allAvailableSeats={allSeatsForBuilder}
          sessionTimesByDay={(builderSessionTimesByDay ?? undefined) as SessionTimesByDay | undefined}
          terms={builderTerms.map(t => ({ id: t.id, name: t.name, status: t.status }))}
          selectedTermId={selectedBuilderTermId}
          onChangeTerm={handleBuilderTermChange}
          weekStart={builderWeekStartIso}
          weekEnd={builderWeekEndIso}
          onConfirm={handleScheduleBuilderConfirm}
          onClose={() => setIsScheduleBuilderOpen(false)}
        />
      )}

      {isConfirmWeekOpen && (
        <ConfirmWeekModal
          weekStart={weekStart}
          tutors={tutors}
          sessions={localSessions}
          weekConfirmedAt={weekConfirmedAt}
          onConfirmed={(confirmedAt) => setWeekConfirmedAt(confirmedAt)}
          onClose={() => setIsConfirmWeekOpen(false)}
        />
      )}
    </div>
  );
}