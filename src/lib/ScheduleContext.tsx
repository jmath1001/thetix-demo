'use client';
import React, { createContext, useContext, useState, useMemo, useEffect } from 'react';
import { getWeekStart, getWeekDates, toISODate, getCentralTimeNow } from '@/lib/useScheduleData';

interface ScheduleContextValue {
  weekStart: Date;
  weekDates: Date[];
  isCurrentWeek: boolean;
  todayView: boolean;
  selectedTutorFilter: string | null;
  goToPrevWeek: () => void;
  goToNextWeek: () => void;
  goToThisWeek: () => void;
  setTodayView: (v: boolean) => void;
  setSelectedTutorFilter: (v: string | null) => void;
}

const ScheduleContext = createContext<ScheduleContextValue | null>(null);

export function ScheduleProvider({ children }: { children: React.ReactNode }) {
  const [weekStart, setWeekStart] = useState<Date>(() => getWeekStart(getCentralTimeNow()));
  const [todayView, setTodayView] = useState(false);
  const [selectedTutorFilter, setSelectedTutorFilter] = useState<string | null>(null);

  // On first client mount, restore the saved week from sessionStorage.
  useEffect(() => {
    try {
      const saved = sessionStorage.getItem('scheduleWeekStart');
      if (saved) {
        const d = new Date(saved + 'T00:00:00');
        if (!isNaN(d.getTime())) setWeekStart(getWeekStart(d));
      }
    } catch {}
  }, []);

  // Persist weekStart whenever it changes.
  useEffect(() => {
    try { sessionStorage.setItem('scheduleWeekStart', toISODate(weekStart)); } catch {}
  }, [weekStart]);

  const weekDates = useMemo(() => getWeekDates(weekStart), [weekStart]);
  const isCurrentWeek = toISODate(weekStart) === toISODate(getWeekStart(new Date()));

  const goToPrevWeek = () => setWeekStart(prev => { const d = new Date(prev); d.setDate(d.getDate() - 7); return d; });
  const goToNextWeek = () => setWeekStart(prev => { const d = new Date(prev); d.setDate(d.getDate() + 7); return d; });
  const goToThisWeek = () => setWeekStart(getWeekStart(new Date()));

  return (
    <ScheduleContext.Provider value={{
      weekStart, weekDates, isCurrentWeek, todayView, selectedTutorFilter,
      goToPrevWeek, goToNextWeek, goToThisWeek, setTodayView, setSelectedTutorFilter,
    }}>
      {children}
    </ScheduleContext.Provider>
  );
}

export function useScheduleContext() {
  const ctx = useContext(ScheduleContext);
  if (!ctx) throw new Error('useScheduleContext must be used within ScheduleProvider');
  return ctx;
}

// Returns null safely — for Navbar which renders on all pages
export function useScheduleContextSafe() {
  return useContext(ScheduleContext);
}