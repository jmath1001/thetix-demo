"use client"
import { ChevronLeft, ChevronRight, CalendarDays, ChevronDown, PlusCircle, X } from 'lucide-react';
import { type Tutor } from '@/lib/useScheduleData';
import { formatWeekRange } from './scheduleConstants';

interface ScheduleNavProps {
  todayView: boolean;
  setTodayView: (v: boolean) => void;
  weekStart: Date;
  isCurrentWeek: boolean;
  goToPrevWeek: () => void;
  goToNextWeek: () => void;
  goToThisWeek: () => void;
  tutors: Tutor[];
  selectedTutorFilter: string | null;
  setSelectedTutorFilter: (v: string | null) => void;
  onOpenTutorModal: () => void;
  onOpenEnrollModal: () => void;
}

export function ScheduleNav({
  todayView,
  setTodayView,
  weekStart,
  isCurrentWeek,
  goToPrevWeek,
  goToNextWeek,
  goToThisWeek,
  tutors,
  selectedTutorFilter,
  setSelectedTutorFilter,
  onOpenTutorModal,
  onOpenEnrollModal,
}: ScheduleNavProps) {
  return (
    <div className="fixed top-16 left-0 right-0 z-30 border-b"
      style={{ background: 'rgba(255,255,255,0.98)', backdropFilter: 'blur(16px)', borderColor: '#fde8e8' }}>
      <div className="max-w-[1600px] mx-auto px-2 md:px-6 h-10 md:h-11 flex items-center gap-1.5 md:gap-2">

        {/* Week/Today toggle */}
        <div className="flex gap-0.5 p-0.5 rounded-lg shrink-0" style={{ background: '#fee2e2' }}>
          <button onClick={() => setTodayView(false)}
            className="px-2 md:px-2.5 py-1 rounded-md text-[10px] font-black uppercase tracking-wider transition-all"
            style={!todayView ? { background: 'white', color: '#dc2626', boxShadow: '0 1px 3px rgba(220,38,38,0.15)' } : { color: '#f87171' }}>
            Week
          </button>
          <button onClick={() => setTodayView(true)}
            className="px-2 md:px-2.5 py-1 rounded-md text-[10px] font-black uppercase tracking-wider transition-all"
            style={todayView ? { background: '#dc2626', color: 'white', boxShadow: '0 1px 3px rgba(220,38,38,0.3)' } : { color: '#f87171' }}>
            Today
          </button>
        </div>

        {/* Week navigator */}
        {!todayView && (
          <>
            <div className="w-px h-5 shrink-0 hidden md:block" style={{ background: '#fca5a5' }} />
            <button onClick={goToPrevWeek} className="w-6 h-6 md:w-7 md:h-7 rounded-lg flex items-center justify-center transition-all shrink-0"
              style={{ background: 'white', border: '1px solid #fca5a5', color: '#dc2626' }}>
              <ChevronLeft size={12} />
            </button>
            <div className="hidden sm:flex flex-col items-center shrink-0">
              <div className="text-xs font-bold leading-none" style={{ color: '#111827', fontFamily: 'ui-serif, Georgia, serif' }}>{formatWeekRange(weekStart)}</div>
              {isCurrentWeek && <div className="text-[8px] font-bold uppercase tracking-widest mt-0.5" style={{ color: '#dc2626' }}>This Week</div>}
            </div>
            <button onClick={goToNextWeek} className="w-6 h-6 md:w-7 md:h-7 rounded-lg flex items-center justify-center transition-all shrink-0"
              style={{ background: 'white', border: '1px solid #fca5a5', color: '#dc2626' }}>
              <ChevronRight size={12} />
            </button>
            {!isCurrentWeek && (
              <button onClick={goToThisWeek}
                className="flex items-center gap-1 px-1.5 py-1 rounded-lg text-[9px] font-bold uppercase transition-all shrink-0"
                style={{ background: '#fee2e2', border: '1px solid #fca5a5', color: '#dc2626' }}>
                <CalendarDays size={9} />
                <span className="hidden sm:inline">Now</span>
              </button>
            )}
          </>
        )}

        <div className="flex-1 min-w-0" />

        {/* Tutor filter */}
        <div className="relative shrink-0">
          <select
            value={selectedTutorFilter ?? ''}
            onChange={e => setSelectedTutorFilter(e.target.value || null)}
            className="appearance-none pl-2 pr-6 py-1 rounded-lg text-[10px] font-semibold uppercase tracking-wider cursor-pointer"
            style={{
              background: selectedTutorFilter ? '#fef2f2' : 'white',
              border: `1px solid ${selectedTutorFilter ? '#fca5a5' : '#e5e7eb'}`,
              color: selectedTutorFilter ? '#dc2626' : '#6b7280',
              outline: 'none', maxWidth: 110,
            }}>
            <option value="">All Tutors</option>
            {tutors.map(t => <option key={t.id} value={t.id}>{t.name.split(' ')[0]}</option>)}
          </select>
          <ChevronDown size={10} className="absolute right-1.5 top-1/2 -translate-y-1/2 pointer-events-none"
            style={{ color: selectedTutorFilter ? '#dc2626' : '#f87171' }} />
        </div>
        {selectedTutorFilter && (
          <button onClick={() => setSelectedTutorFilter(null)}
            className="w-5 h-5 md:w-6 md:h-6 rounded-md flex items-center justify-center shrink-0"
            style={{ background: '#fee2e2', border: '1px solid #fca5a5', color: '#dc2626' }}>
            <X size={9} />
          </button>
        )}

        <div className="w-px h-5 shrink-0" style={{ background: '#fca5a5' }} />

        <button onClick={onOpenTutorModal}
          className="w-7 h-7 md:w-auto md:h-auto md:px-2.5 md:py-1.5 flex items-center justify-center md:gap-1 rounded-lg text-xs font-semibold transition-all shrink-0"
          style={{ background: 'white', border: '1px solid #fca5a5', color: '#dc2626' }}>
          <PlusCircle size={12} />
          <span className="hidden md:inline">Tutors</span>
        </button>
        <button onClick={onOpenEnrollModal}
          className="w-7 h-7 md:w-auto md:h-auto md:px-3 md:py-1.5 flex items-center justify-center md:gap-1 rounded-lg text-xs font-bold text-white transition-all active:scale-95 shrink-0"
          style={{ background: '#dc2626', boxShadow: '0 1px 4px rgba(220,38,38,0.35)' }}>
          <PlusCircle size={12} />
          <span className="hidden md:inline">Book</span>
        </button>
      </div>
    </div>
  );
}