"use client"
import React, { useState, useMemo } from 'react';
import { User, X, Check, ChevronDown, ChevronLeft, ChevronRight, CalendarDays, Loader2 } from "lucide-react";

import { MAX_CAPACITY, getSessionsForDay } from '@/components/constants';
import { supabase } from '@/lib/supabaseClient';
import { withCenter } from '@/lib/db';
import {
  useScheduleData,
  updateAttendance,
  getWeekStart,
  getWeekDates,
  toISODate,
  dayOfWeek,
  type Tutor,
  type Session,
} from '@/lib/useScheduleData';

// ─── Helpers ──────────────────────────────────────────────────────────────────

const isTutorAvailable = (tutor: Tutor, dow: number, time: string) =>
  tutor.availabilityBlocks.includes(`${dow}-${time}`);

const ACTIVE_DAYS = [1, 2, 3, 4, 6];
const DAY_NAMES = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Saturday'];

function formatWeekRange(weekStart: Date): string {
  const end = new Date(weekStart);
  end.setDate(end.getDate() + 5);
  const opts: Intl.DateTimeFormatOptions = { month: 'short', day: 'numeric' };
  return `${weekStart.toLocaleDateString('en-US', opts)} – ${end.toLocaleDateString('en-US', { ...opts, year: 'numeric' })}`;
}

// ─── Tutor Dropdown ───────────────────────────────────────────────────────────

function TutorDropdown({ tutors, selected, onSelect }: {
  tutors: Tutor[];
  selected: Tutor | null;
  onSelect: (t: Tutor) => void;
}) {
  const [open, setOpen] = useState(false);

  return (
    <div className="relative">
      <button
        onClick={() => setOpen(o => !o)}
        className="flex items-center gap-3 px-4 py-2.5 rounded-xl border border-[#e7e3dd] bg-white hover:bg-[#faf9f7] transition-all shadow-sm min-w-[200px]"
      >
        <div className="w-7 h-7 rounded-lg flex items-center justify-center shrink-0" style={{ background: selected ? '#6d28d9' : '#f0ece8' }}>
          <User size={13} className={selected ? 'text-white' : '#78716c'} />
        </div>
        <p className="text-sm font-bold text-[#1c1917] leading-none flex-1 text-left truncate">{selected?.name ?? 'Select Tutor'}</p>
        <ChevronDown size={13} className={`text-[#a8a29e] transition-transform shrink-0 ${open ? 'rotate-180' : ''}`} />
      </button>

      {open && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} />
          <div className="absolute top-full right-0 mt-2 rounded-2xl overflow-hidden z-50 min-w-[220px] bg-white border border-[#e7e3dd] shadow-2xl">
            {tutors.map(tutor => (
              <button key={tutor.id} onClick={() => { onSelect(tutor); setOpen(false); }}
                className="w-full flex items-center gap-3 px-4 py-3 text-left transition-colors border-b border-[#f0ece8] last:border-0 hover:bg-[#faf9f7]"
                style={{ background: selected?.id === tutor.id ? '#ede9fe' : 'transparent' }}
              >
                <div className="w-7 h-7 rounded-lg flex items-center justify-center shrink-0" style={{ background: selected?.id === tutor.id ? '#6d28d9' : '#f0ece8' }}>
                  <User size={12} />
                </div>
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-bold text-[#1c1917] leading-none">{tutor.name}</p>
                  <p className="text-[9px] font-bold text-[#a8a29e] uppercase mt-0.5 truncate">{tutor.subjects.slice(0, 2).join(' · ')}</p>
                </div>
                {selected?.id === tutor.id && <Check size={12} className="text-[#6d28d9] shrink-0" strokeWidth={3} />}
              </button>
            ))}
          </div>
        </>
      )}
    </div>
  );
}

// ─── Main ─────────────────────────────────────────────────────────────────────

export default function TutorPortal() {
  const [weekStart, setWeekStart] = useState<Date>(() => getWeekStart(new Date()));
  const weekDates = useMemo(() => getWeekDates(weekStart), [weekStart]);
  const isCurrentWeek = toISODate(weekStart) === toISODate(getWeekStart(new Date()));

  const { tutors, sessions, loading, error, refetch } = useScheduleData(weekStart);
  const [selectedTutor, setSelectedTutor] = useState<Tutor | null>(null);
  const [portalMessage, setPortalMessage] = useState<string | null>(null);

  React.useEffect(() => {
    if (tutors.length > 0 && !selectedTutor) setSelectedTutor(tutors[0]);
  }, [tutors]);

  React.useEffect(() => {
    withCenter(supabase.from('slake_center_settings').select('tutor_portal_message').limit(1))
      .maybeSingle()
      .then(({ data }: { data: { tutor_portal_message: string | null } | null }) => {
        if (data?.tutor_portal_message) setPortalMessage(data.tutor_portal_message);
      })
      .catch(() => {});
  }, []);

  const goToPrevWeek = () => setWeekStart(p => { const d = new Date(p); d.setDate(d.getDate() - 7); return d; });
  const goToNextWeek = () => setWeekStart(p => { const d = new Date(p); d.setDate(d.getDate() + 7); return d; });
  const goToThisWeek = () => setWeekStart(getWeekStart(new Date()));

  const tutorSessions = useMemo(() =>
    selectedTutor ? sessions.filter(s => s.tutorId === selectedTutor.id) : [],
    [sessions, selectedTutor]
  );

  const totalStudents = tutorSessions.reduce((t, s) => t + s.students.length, 0);

  const handleAttendanceToggle = async (session: Session, studentId: string, currentStatus: string) => {
    const next = currentStatus === 'present' ? 'scheduled' : 'present';
    try {
      await updateAttendance({ sessionId: session.id, studentId, status: next as any });
      refetch();
    } catch (err) { console.error(err); }
  };

  // Only show Mon–Thu + Sat
  const activeDates = useMemo(() =>
    weekDates.filter(d => ACTIVE_DAYS.includes(dayOfWeek(toISODate(d)))),
    [weekDates]
  );

  if (loading) return (
    <div className="w-full min-h-screen flex items-center justify-center bg-[#faf9f7]">
      <div className="flex flex-col items-center gap-4">
        <Loader2 size={32} className="text-[#6d28d9] animate-spin" />
        <p className="text-[10px] font-black text-[#a8a29e] uppercase tracking-widest">Updating Schedule...</p>
      </div>
    </div>
  );

  return (
    <div className="relative w-full min-h-screen pb-12 font-sans bg-[#faf9f7] text-[#1c1917]">

      {/* HEADER */}
      <div className="sticky top-0 z-40 bg-white/80 backdrop-blur-md border-b border-[#e7e3dd]">
        <div className="max-w-[1600px] mx-auto flex justify-between items-center px-4 md:px-8 py-3">
          <div>
            <h1 className="text-xl font-black uppercase tracking-tighter text-[#1c1917] leading-none">Tutor View</h1>
            <p className="text-[9px] font-black text-[#6d28d9] uppercase tracking-widest mt-1">Attendance & Scheduling</p>
          </div>
          <TutorDropdown tutors={tutors} selected={selectedTutor} onSelect={setSelectedTutor} />
        </div>
        {portalMessage && (
          <div className="max-w-[1600px] mx-auto px-4 md:px-8 pb-2">
            <p className="text-xs text-[#78716c] leading-relaxed">{portalMessage}</p>
          </div>
        )}
      </div>

      <div className="relative z-10 max-w-[1600px] mx-auto px-4 md:px-8">

        {/* STATS STRIP */}
        {selectedTutor && (
          <div className="pt-6">
            <div className="rounded-2xl bg-white border border-[#e7e3dd] p-5 flex flex-col md:flex-row md:items-center justify-between gap-6 shadow-sm">
              <div className="flex items-center gap-4">
                <div className="w-12 h-12 rounded-2xl bg-[#6d28d9] flex items-center justify-center shrink-0 shadow-lg shadow-violet-100">
                  <User size={20} className="text-white" />
                </div>
                <div>
                  <h2 className="text-lg font-black text-[#1c1917] leading-none mb-2">{selectedTutor.name}</h2>
                  <div className="flex flex-wrap gap-1.5">
                    {selectedTutor.subjects.map(s => (
                      <span key={s} className="text-[9px] font-bold px-2 py-0.5 bg-[#f3f0ff] text-[#6d28d9] rounded-md uppercase border border-[#ddd6fe]">{s}</span>
                    ))}
                  </div>
                </div>
              </div>
              <div className="flex gap-10">
                <div className="text-left md:text-center">
                  <p className="text-[9px] font-black text-[#a8a29e] uppercase tracking-widest mb-1">Total Students</p>
                  <p className="text-3xl font-black text-[#1c1917] leading-none">{totalStudents}</p>
                </div>
                <div className="text-left md:text-center">
                  <p className="text-[9px] font-black text-[#a8a29e] uppercase tracking-widest mb-1">Active Sessions</p>
                  <p className="text-3xl font-black text-[#1c1917] leading-none">{tutorSessions.length}</p>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* WEEK NAVIGATION */}
        <div className="pt-8 pb-4 flex items-center justify-between">
          <div className="flex items-center gap-4">
            <div className="flex bg-white border border-[#e7e3dd] rounded-xl overflow-hidden shadow-sm">
              <button onClick={goToPrevWeek} className="p-2.5 hover:bg-[#faf9f7] text-[#78716c] transition-colors border-r border-[#e7e3dd]"><ChevronLeft size={18} /></button>
              <button onClick={goToNextWeek} className="p-2.5 hover:bg-[#faf9f7] text-[#78716c] transition-colors"><ChevronRight size={18} /></button>
            </div>
            <div>
              <div className="text-lg font-black text-[#1c1917] uppercase tracking-tight leading-none">{formatWeekRange(weekStart)}</div>
              {isCurrentWeek && <span className="text-[10px] font-bold text-[#6d28d9] uppercase tracking-widest">Active Week</span>}
            </div>
          </div>
          {!isCurrentWeek && (
            <button onClick={goToThisWeek} className="flex items-center gap-2 px-4 py-2 rounded-xl text-[10px] font-black uppercase tracking-wider bg-[#6d28d9] text-white shadow-lg shadow-violet-100 transition-transform active:scale-95">
              <CalendarDays size={14} /> Back to Today
            </button>
          )}
        </div>

        {/* DAY GRIDS */}
        <div className="space-y-12 pb-20">
          {!selectedTutor ? (
            <div className="rounded-3xl p-20 text-center bg-white border-2 border-dashed border-[#e7e3dd]">
              <p className="text-sm font-bold text-[#a8a29e] uppercase italic">Please select a tutor from the dropdown above</p>
            </div>
          ) : activeDates.map((date) => {
            const isoDate = toISODate(date);
            const dow = dayOfWeek(isoDate);
            const dayIdx = ACTIVE_DAYS.indexOf(dow);
            const dayLabel = DAY_NAMES[dayIdx];
            const isToday = isoDate === toISODate(new Date());
            const isAvailableDay = selectedTutor.availability.includes(dow);
            const dateLabel = date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
            const daySessions = getSessionsForDay(dow);

            return (
              <div key={isoDate} className="space-y-4">
                <div className="flex items-center gap-4">
                  <h2 className={`text-4xl font-black uppercase italic tracking-tighter leading-none ${isToday ? 'text-[#6d28d9]' : isAvailableDay ? 'text-[#1c1917]' : 'text-[#d6d3d1]'}`}>
                    {dayLabel}
                  </h2>
                  <span className={`text-sm font-bold uppercase tracking-widest ${isToday ? 'text-[#6d28d9]' : 'text-[#a8a29e]'}`}>
                    {dateLabel}
                  </span>
                  <div className={`h-[2px] grow rounded-full ${isToday ? 'bg-[#ede9fe]' : 'bg-[#f0ece8]'}`} />
                  {!isAvailableDay && <span className="text-[10px] font-black text-[#d6d3d1] uppercase tracking-widest">Off Schedule</span>}
                </div>

                {isAvailableDay && (
                  <div className="bg-white rounded-3xl border border-[#e7e3dd] shadow-sm overflow-hidden">
                    <div className="overflow-x-auto">
                      <table className="w-full border-collapse">
                        <thead>
                          <tr className="bg-[#faf9f7] border-b border-[#e7e3dd]">
                            {daySessions.map(block => (
                              <th key={block.id} className="p-3 text-center border-r border-[#e7e3dd] last:border-0 min-w-[160px]">
                                <div className="text-[10px] font-black text-[#78716c] uppercase tracking-tighter">{block.label}</div>
                                <div className="text-[9px] font-medium text-[#a8a29e] mt-0.5">{block.display}</div>
                              </th>
                            ))}
                          </tr>
                        </thead>
                        <tbody>
                          <tr>
                            {daySessions.map(block => {
                              const session = sessions.find(s => s.date === isoDate && s.tutorId === selectedTutor.id && s.time === block.time);
                              const hasStudents = session && session.students.length > 0;
                              const isAvail = isTutorAvailable(selectedTutor, dow, block.time);

                              return (
                                <td key={block.id} className="p-3 align-top h-[180px] border-r border-[#e7e3dd] last:border-0"
                                  style={{ background: isAvail ? 'white' : '#faf9f7' }}>
                                  <div className="flex flex-col gap-2 h-full">
                                    {hasStudents ? (
                                      session!.students.map(student => (
                                        <div key={student.rowId || student.id}
                                          className={`p-3 rounded-xl border-2 transition-all ${
                                            student.status === 'present'
                                            ? 'bg-[#f0fdf4] border-[#bcf0da] shadow-sm'
                                            : 'bg-white border-[#e7e3dd]'
                                          }`}
                                        >
                                          <div className="flex items-start justify-between gap-2">
                                            <div className="min-w-0">
                                              <p className="text-xs font-black text-[#1c1917] truncate">{student.name}</p>
                                              <p className="text-[10px] font-bold text-[#6d28d9] uppercase mt-0.5 truncate">{student.topic || 'General'}</p>
                                            </div>
                                            <button
                                              onClick={() => handleAttendanceToggle(session!, student.id, student.status)}
                                              className={`shrink-0 w-7 h-7 rounded-lg flex items-center justify-center transition-all active:scale-90 border shadow-sm ${
                                                student.status === 'present'
                                                ? 'bg-[#6d28d9] border-[#6d28d9] text-white'
                                                : 'bg-white border-[#e7e3dd] text-[#a8a29e]'
                                              }`}
                                            >
                                              <Check size={14} strokeWidth={3} />
                                            </button>
                                          </div>
                                        </div>
                                      ))
                                    ) : isAvail ? (
                                      <div className="w-full h-full rounded-xl border-2 border-dashed border-[#ede9fe] flex flex-col items-center justify-center gap-1">
                                        <span className="text-[9px] font-black uppercase text-[#c4b5fd]">Open Slot</span>
                                      </div>
                                    ) : (
                                      <div className="w-full h-full flex items-center justify-center opacity-20">
                                        <div className="w-8 h-[2px] bg-[#d6d3d1] rounded-full" />
                                      </div>
                                    )}
                                  </div>
                                </td>
                              );
                            })}
                          </tr>
                        </tbody>
                      </table>
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}