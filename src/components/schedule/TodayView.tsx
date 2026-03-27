"use client"
import { useState } from 'react';
import { PlusCircle, Check, Clock, Calendar as CalendarIcon } from 'lucide-react';
import { updateAttendance, toISODate, dayOfWeek, type Tutor } from '@/lib/useScheduleData';
import { getSessionsForDay } from '@/components/constants';
import { MAX_CAPACITY } from '@/components/constants';
import { ACTIVE_DAYS, DAY_NAMES, TUTOR_PALETTES } from './scheduleConstants';
import { isTutorAvailable } from './scheduleUtils';

interface TodayViewProps {
  tutors: Tutor[];
  sessions: any[];
  timeOff: any[];
  students: any[];
  selectedTutorFilter: string | null;
  tutorPaletteMap: Record<string, number>;
  setSelectedSessionWithNotes: (s: any) => void;
  handleGridSlotClick: (tutor: Tutor, date: string, dayName: string, block: any) => void;
  refetch: () => void;
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
  refetch,
}: TodayViewProps) {
  const [selectedDate, setSelectedDate] = useState(new Date());

  const todayIso = toISODate(selectedDate);
  const todayDow = dayOfWeek(todayIso);
  const dayIdx = ACTIVE_DAYS.indexOf(todayDow);

  const isActuallyToday = toISODate(new Date()) === todayIso;
  const dayLabel = isActuallyToday ? (DAY_NAMES[dayIdx] ?? 'Today') : DAY_NAMES[dayIdx] ?? 'Selected Day';

  const daySessions = getSessionsForDay(todayDow);
  const todayTutors = tutors.filter(t =>
    t.availability.includes(todayDow) &&
    (selectedTutorFilter === null || t.id === selectedTutorFilter)
  );
  const isWeekend = !ACTIVE_DAYS.includes(todayDow);

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

  const handleDateChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.value) {
      setSelectedDate(new Date(e.target.value + 'T00:00:00'));
    }
  };

  if (isWeekend) {
    return (
      <div className="max-w-[1600px] mx-auto p-2 md:p-6" style={{ background: '#fafafa', minHeight: '100%' }}>
        <div className="flex justify-end mb-4">
          <input
            type="date"
            value={todayIso}
            onChange={handleDateChange}
            className="text-xs font-bold border rounded-lg px-2 py-1 outline-none"
            style={{ borderColor: '#d1d5db', color: '#374151' }}
          />
        </div>
        <div className="flex flex-col items-center justify-center py-24 gap-3">
          <p className="text-4xl">🎉</p>
          <p className="text-lg font-bold" style={{ color: '#111827', fontFamily: 'ui-serif, Georgia, serif' }}>No sessions for this day</p>
          <p className="text-xs" style={{ color: '#9ca3af' }}>Enjoy the day off</p>
        </div>
      </div>
    );
  }

  return (
    <div style={{ position: 'fixed', top: 108, left: 0, right: 0, bottom: 0, display: 'flex', flexDirection: 'column', overflow: 'hidden', background: '#fafafa', colorScheme: 'light' } as React.CSSProperties}>
      <div style={{ maxWidth: 1600, width: '100%', margin: '0 auto', padding: '12px 24px 24px', display: 'flex', flexDirection: 'column', flex: 1, minHeight: 0 }}>

        {/* Day header — desktop */}
        <div className="hidden md:flex items-center gap-3 mb-4 shrink-0">
          <div className="flex items-center gap-4">
            <div>
              {/* Red kept only for the day name — brand accent */}
              <h2 className="text-2xl font-bold" style={{ color: '#dc2626', fontFamily: 'ui-serif, Georgia, serif' }}>{dayLabel}</h2>
              <p className="text-xs font-semibold" style={{ color: '#9ca3af' }}>
                {selectedDate.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })}
              </p>
            </div>
            <div className="flex items-center gap-2 px-3 py-1.5 rounded-xl border bg-white" style={{ borderColor: '#e5e7eb' }}>
              <CalendarIcon size={14} style={{ color: '#9ca3af' }} />
              <input
                type="date"
                value={todayIso}
                onChange={handleDateChange}
                className="text-xs font-bold outline-none bg-transparent"
                style={{ color: '#374151', cursor: 'pointer' }}
              />
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
            <input
              type="date"
              value={todayIso}
              onChange={handleDateChange}
              className="text-xs font-bold outline-none bg-transparent"
              style={{ color: '#374151', cursor: 'pointer' }}
            />
          </div>
        </div>

        {todayTutors.length === 0 ? (
          <div className="rounded-xl p-8 text-center border border-dashed" style={{ borderColor: '#e5e7eb', background: 'white' }}>
            <p className="text-sm italic" style={{ color: '#9ca3af' }}>No tutors available for the selected day</p>
          </div>
        ) : (
          <div style={{ display: 'flex', gap: 16, flex: 1, minHeight: 0 }}>

            {/* Grid */}
            <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', minHeight: 0 }}>

              {/* Desktop table */}
              <div className="hidden md:block rounded-xl" style={{ background: 'white', border: '1px solid #e5e7eb', boxShadow: '0 1px 8px rgba(0,0,0,0.06)', flex: 1, minHeight: 0, overflow: 'auto' }}>
                <div style={{ minWidth: 'max-content', width: '100%' }}>
                  <table className="border-collapse w-full">
                    <thead>
                      {/* Charcoal header — red no longer spans the full width */}
                      <tr style={{ background: '#1f2937', borderBottom: '1px solid #111827' }}>
                        <th className="px-3 py-2.5 text-left text-xs font-bold uppercase tracking-wider"
                          style={{ color: 'rgba(255,255,255,0.5)', borderRight: '1px solid rgba(255,255,255,0.08)', width: 1, whiteSpace: 'nowrap', position: 'sticky', left: 0, top: 0, zIndex: 4, background: '#1f2937' }}>
                          Instructor
                        </th>
                        {daySessions.map(block => (
                          <th key={block.id} className="px-4 py-2.5 text-center" style={{ borderRight: '1px solid rgba(255,255,255,0.08)', minWidth: 200, position: 'sticky', top: 0, zIndex: 3, background: '#1f2937' }}>
                            <div className="text-sm font-black uppercase tracking-wider" style={{ color: 'rgba(255,255,255,0.9)' }}>{block.label}</div>
                            <div className="text-xs font-semibold mt-0.5" style={{ color: 'rgba(255,255,255,0.45)' }}>{block.display}</div>
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {todayTutors.map(tutor => {
                        const palette = TUTOR_PALETTES[tutorPaletteMap[tutor.id] ?? 0];
                        const isOnTimeOff = timeOff.some(t => t.tutorId === tutor.id && t.date === todayIso);
                        return (
                          <tr key={tutor.id} style={{ borderBottom: '1px solid #e5e7eb' }}>
                            {/* Neutral instructor column — no pink tint */}
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
                            {daySessions.map(block => {
                              const session = sessions.find(s => s.date === todayIso && s.tutorId === tutor.id && s.time === block.time);
                              const hasStudents = session && session.students.length > 0;
                              const isAvailable = isTutorAvailable(tutor, todayDow, block.time) && !hasStudents && !isOnTimeOff;
                              const isFull = hasStudents && session!.students.length >= MAX_CAPACITY;
                              const isOutside = !isTutorAvailable(tutor, todayDow, block.time) || isOnTimeOff;
                              const timeOffNote = isOnTimeOff ? timeOff.find(t => t.tutorId === tutor.id && t.date === todayIso)?.note : null;
                              return (
                                <td key={block.id} className="p-2 align-top"
                                  style={{ background: isOutside ? 'repeating-linear-gradient(45deg, #e9ebee, #e9ebee 4px, #dfe2e6 4px, #dfe2e6 8px)' : '#f3f4f6', borderRight: '1px solid #e5e7eb', minWidth: 200 }}>
                                  <div className="flex flex-col gap-1.5 min-h-[100px]">
                                    {hasStudents && !isOnTimeOff ? (
                                      <>
                                        {session!.students.map((student: any) => (
                                          <div key={student.rowId || student.id}
                                            className="p-2.5 rounded-xl cursor-pointer transition-all hover:shadow-md"
                                            style={student.status === 'no-show'
                                              ? { background: 'transparent', border: '1.5px solid #d1d5db', opacity: 0.45 }
                                              : student.status === 'present'
                                                ? { background: '#edfaf3', border: '1.5px solid #6ee7b7' }
                                                : { background: palette.bg, border: `1.5px solid ${palette.border}` }}
                                            onClick={() => setSelectedSessionWithNotes({ ...session, activeStudent: student, dayName: dayLabel, date: todayIso, tutorName: tutor.name, block })}>
                                            <div className="flex justify-between items-start mb-1">
                                              <p className="text-sm font-bold leading-tight" style={{ color: '#111827' }}>{student.name}</p>
                                              <div className="flex items-center gap-1">
                                                {student.confirmationStatus === 'confirmed' && <span style={{ color: '#15803d', fontSize: 10 }}>✓</span>}
                                                {student.confirmationStatus === 'cancelled' && <span style={{ color: '#dc2626', fontSize: 10 }}>✕</span>}
                                                {student.confirmationStatus === 'reschedule_requested' && <span style={{ color: '#6d28d9', fontSize: 10 }}>↗</span>}
                                                <button onClick={async e => {
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
                                        {!isFull && (
                                          <button onClick={() => handleGridSlotClick(tutor, todayIso, dayLabel, block)}
                                            className="py-1.5 rounded-xl text-[10px] font-bold uppercase tracking-wider transition-all"
                                            style={{ background: 'transparent', border: '1.5px dashed #d1d5db', color: '#9ca3af' }}
                                            onMouseEnter={e => { e.currentTarget.style.background = '#1f2937'; e.currentTarget.style.color = 'white'; e.currentTarget.style.borderColor = '#1f2937'; }}
                                            onMouseLeave={e => { e.currentTarget.style.background = 'transparent'; e.currentTarget.style.color = '#9ca3af'; e.currentTarget.style.borderColor = '#d1d5db'; }}>
                                            + ADD ({MAX_CAPACITY - session!.students.length})
                                          </button>
                                        )}
                                      </>
                                    ) : isAvailable ? (
                                      <div onClick={() => handleGridSlotClick(tutor, todayIso, dayLabel, block)}
                                        className="flex-1 rounded-xl flex flex-col items-center justify-center gap-2 cursor-pointer transition-all"
                                        style={{ minHeight: 100, background: '#eaf7ef', border: '2px dashed #86efac' }}
                                        onMouseEnter={e => { e.currentTarget.style.background = '#d4f2e3'; e.currentTarget.style.borderColor = '#4ade80'; }}
                                        onMouseLeave={e => { e.currentTarget.style.background = '#eaf7ef'; e.currentTarget.style.borderColor = '#86efac'; }}>
                                        <PlusCircle size={14} style={{ color: '#22c55e' }} />
                                        <span className="text-[9px] font-bold uppercase tracking-widest" style={{ color: '#22c55e' }}>Available</span>
                                      </div>
                                    ) : (
                                      <div className="flex-1 rounded-xl flex flex-col items-center justify-center gap-1"
                                        style={{ minHeight: 100, background: 'repeating-linear-gradient(45deg, #e9ebee, #e9ebee 4px, #dfe2e6 4px, #dfe2e6 8px)' }}>
                                        {isOnTimeOff ? (
                                          <>
                                            {/* Red kept for OFF — signals an exception clearly */}
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

              {/* Mobile */}
              <div className="md:hidden space-y-2 overflow-y-auto flex-1 min-h-0">
                {todayTutors.map(tutor => {
                  const palette = TUTOR_PALETTES[tutorPaletteMap[tutor.id] ?? 0];
                  const isOnTimeOff = timeOff.some(t => t.tutorId === tutor.id && t.date === todayIso);
                  return (
                    <div key={tutor.id} className="rounded-xl overflow-hidden" style={{ background: 'white', border: '1px solid #e5e7eb', boxShadow: '0 1px 6px rgba(0,0,0,0.06)' }}>
                      {/* Charcoal mobile card header */}
                      <div className="p-2.5" style={{ background: '#1f2937', borderBottom: '1px solid #111827' }}>
                        <p className="text-xs font-bold" style={{ color: 'rgba(255,255,255,0.85)' }}>{tutor.name}</p>
                      </div>
                      <div className="overflow-x-auto">
                        <div className="flex">
                          {daySessions.map(block => {
                            const session = sessions.find(s => s.date === todayIso && s.tutorId === tutor.id && s.time === block.time);
                            const hasStudents = session && session.students.length > 0;
                            const isAvailable = isTutorAvailable(tutor, todayDow, block.time) && !hasStudents && !isOnTimeOff;
                            const isFull = hasStudents && session!.students.length >= MAX_CAPACITY;
                            const isOutside = !isTutorAvailable(tutor, todayDow, block.time) || isOnTimeOff;
                            return (
                              <div key={block.id} className="flex-shrink-0 w-40 p-1.5"
                                style={{ background: isOutside ? 'repeating-linear-gradient(45deg, #e9ebee, #e9ebee 4px, #dfe2e6 4px, #dfe2e6 8px)' : '#f3f4f6', borderRight: '1px solid #e5e7eb' }}>
                                <div className="text-center mb-1.5">
                                  <div className="text-[10px] font-black uppercase tracking-widest" style={{ color: '#374151', fontWeight: 800 }}>{block.label}</div>
                                  <div className="text-[9px] font-semibold" style={{ color: '#9ca3af' }}>{block.display}</div>
                                </div>
                                <div className="space-y-1" style={{ minHeight: 64 }}>
                                  {hasStudents && !isOnTimeOff ? (
                                    <>
                                      {session!.students.map((student: any) => (
                                        <div key={student.rowId || student.id}
                                          className="flex items-center gap-1.5 px-1.5 py-1.5 rounded-lg transition-all"
                                          style={student.status === 'no-show'
                                            ? { background: 'transparent', border: '1.5px solid #e5e7eb', opacity: 0.4 }
                                            : student.status === 'present'
                                              ? { background: '#edfaf3', border: '1.5px solid #6ee7b7' }
                                              : { background: palette.bg, border: `1.5px solid ${palette.border}` }}>
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
                                        <button onClick={() => handleGridSlotClick(tutor, todayIso, dayLabel, block)}
                                          className="w-full py-1 rounded-lg text-[7px] font-bold uppercase transition-all"
                                          style={{ background: 'transparent', border: '1.5px dashed #d1d5db', color: '#9ca3af' }}>
                                          + ADD
                                        </button>
                                      )}
                                    </>
                                  ) : isAvailable ? (
                                    <div onClick={() => handleGridSlotClick(tutor, todayIso, dayLabel, block)}
                                      className="w-full h-full rounded-lg flex flex-col items-center justify-center gap-1 cursor-pointer active:scale-95 transition-all"
                                      style={{ minHeight: 56, background: '#eaf7ef', border: '2px dashed #86efac' }}>
                                      <PlusCircle size={12} style={{ color: '#22c55e' }} />
                                      <span className="text-[8px] font-bold uppercase tracking-wider" style={{ color: '#22c55e' }}>Available</span>
                                    </div>
                                  ) : (
                                    <div className="w-full rounded-lg flex flex-col items-center justify-center gap-1"
                                      style={{ minHeight: 56, background: 'repeating-linear-gradient(45deg, #e9ebee, #e9ebee 4px, #dfe2e6 4px, #dfe2e6 8px)' }}>
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
            </div>

            {/* ── PENDING PANEL ── */}
            <div className="hidden md:flex flex-col shrink-0" style={{ width: 220, minHeight: 0 }}>
              <div className="rounded-xl overflow-hidden flex flex-col" style={{ background: 'white', border: '1px solid #e5e7eb', boxShadow: '0 1px 8px rgba(0,0,0,0.06)', flex: 1, minHeight: 0 }}>
                {/* Charcoal panel header — red badge only when there are pending items */}
                <div className="px-3 py-2.5 shrink-0" style={{ background: '#1f2937', borderBottom: '1px solid #111827' }}>
                  <div className="flex items-center justify-between">
                    <p className="text-[10px] font-black uppercase tracking-widest text-white">Needs Confirmation</p>
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
                            <Clock size={9} style={{ color: '#9ca3af' }} />
                            <span className="text-[9px] font-semibold" style={{ color: '#6b7280' }}>
                              {daySessions.find(b => b.time === student.sessionTime)?.label ?? student.sessionTime}
                            </span>
                          </div>
                          <p className="text-[9px] mt-0.5 truncate" style={{ color: '#9ca3af' }}>{student.tutorName}</p>
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