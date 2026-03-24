"use client"
import { PlusCircle, Check } from 'lucide-react';
import { updateAttendance, toISODate, dayOfWeek, type Tutor } from '@/lib/useScheduleData';
import { getSessionsForDay } from '@/components/constants';
import { MAX_CAPACITY } from '@/components/constants';
import { ACTIVE_DAYS, DAY_NAMES, TUTOR_PALETTES } from './scheduleConstants';
import { isTutorAvailable } from './scheduleUtils';

interface WeekViewProps {
  activeDates: Date[];
  tutors: Tutor[];
  sessions: any[];
  timeOff: any[];
  selectedTutorFilter: string | null;
  tutorPaletteMap: Record<string, number>;
  setSelectedSessionWithNotes: (s: any) => void;
  handleGridSlotClick: (tutor: Tutor, date: string, dayName: string, block: any) => void;
  refetch: () => void;
}

export function WeekView({
  activeDates,
  tutors,
  sessions,
  timeOff,
  selectedTutorFilter,
  tutorPaletteMap,
  setSelectedSessionWithNotes,
  handleGridSlotClick,
  refetch,
}: WeekViewProps) {
  return (
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
                {/* Desktop Table */}
                <div className="hidden md:block rounded-xl overflow-hidden"
                  style={{ background: 'white', border: '1px solid #ddd4c8', boxShadow: '0 2px 12px rgba(0,0,0,0.07)' }}>
                  <div className="overflow-x-auto">
                    <table className="border-collapse" style={{ minWidth: '100%', width: 'max-content', borderCollapse: 'separate', borderSpacing: 0 }}>
                      <thead>
                        <tr style={{ background: '#f7f2eb', borderBottom: '1px solid #ddd4c8' }}>
                          <th className="px-2 py-2 text-left text-xs font-bold uppercase tracking-wider"
                            style={{ color: '#9e8e7e', borderRight: '1px solid #ddd4c8', width: 1, whiteSpace: 'nowrap', position: 'sticky', left: 0, top: 0, zIndex: 4, background: '#f7f2eb' }}>
                            Instructor
                          </th>
                          {daySessions.map(block => (
                            <th key={block.id} className="px-3 py-2 text-center" style={{ color: '#9e8e7e', borderRight: '1px solid #ddd4c8', minWidth: 160, position: 'sticky', top: 0, background: '#f7f2eb', zIndex: 3 }}>
                              <div className="text-sm font-black uppercase tracking-wider" style={{ color: '#1c1008' }}>{block.label}</div>
                              <div className="text-xs font-semibold mt-0.5" style={{ color: '#57534e' }}>{block.display}</div>
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
                                          {session!.students.map((student: any) => (
                                            <div key={student.rowId || student.id}
                                              className="group relative p-2 rounded-lg transition-all hover:shadow-md cursor-pointer"
                                              style={student.status === 'no-show'
                                                ? { background: 'transparent', border: '1.5px solid #ddd4c8', opacity: 0.45 }
                                                : student.status === 'present'
                                                  ? { background: '#edfaf3', border: '1.5px solid #6ee7b7' }
                                                  : { background: palette.bg, border: `1.5px solid ${palette.border}` }}
                                              onClick={() => setSelectedSessionWithNotes({ ...session, activeStudent: student, dayName: dayLabel, date: isoDate, tutorName: tutor.name, block })}>
                                              <div className="flex justify-between items-start mb-0.5">
                                                <p className="text-xs font-bold leading-tight" style={{ color: '#1c1008' }}>{student.name}</p>
                                                <div className="flex items-center gap-1">
                                                  {student.confirmationStatus === 'confirmed' && <span style={{ color: '#15803d', fontSize: 10 }}>✓</span>}
                                                  {student.confirmationStatus === 'cancelled' && <span style={{ color: '#dc2626', fontSize: 10 }}>✕</span>}
                                                  {student.confirmationStatus === 'reschedule_requested' && <span style={{ color: '#6d28d9', fontSize: 10 }}>↗</span>}
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
                                              </div>
                                              <p className="text-[10px] font-semibold uppercase tracking-tight" style={{ color: palette.tag }}>{student.topic}</p>
                                              {student.grade && <p className="text-[9px] font-medium mt-0.5" style={{ color: '#b0a090' }}>Grade {student.grade}</p>}
                                              {student.notes && (
                                                <p className="text-[9px] mt-1 italic truncate" style={{ color: '#b0a090' }}>📝 {student.notes}</p>
                                              )}
                                            </div>
                                          ))}
                                          {!isFull && (
                                            <button onClick={() => handleGridSlotClick(tutor, isoDate, dayLabel, block)}
                                              className="mt-auto py-1 rounded-lg text-[10px] font-bold uppercase tracking-wider transition-all"
                                              style={{ background: 'transparent', border: '1.5px dashed #c8b89a', color: '#9e8e7e' }}
                                              onMouseEnter={e => { e.currentTarget.style.background = '#2d2318'; e.currentTarget.style.color = 'white'; e.currentTarget.style.borderColor = '#2d2318'; }}
                                              onMouseLeave={e => { e.currentTarget.style.background = 'transparent'; e.currentTarget.style.color = '#9e8e7e'; e.currentTarget.style.borderColor = '#86efac'; }}>
                                              + ADD ({MAX_CAPACITY - session!.students.length})
                                            </button>
                                          )}
                                        </>
                                      ) : isAvailable ? (
                                        <div onClick={() => handleGridSlotClick(tutor, isoDate, dayLabel, block)}
                                          className="w-full rounded-lg flex flex-col items-center justify-center gap-1 cursor-pointer transition-all"
                                          style={{ minHeight: 64, background: 'transparent', border: '2px dashed #86efac' }}
                                          onMouseEnter={e => { e.currentTarget.style.background = 'rgba(134,239,172,0.08)'; e.currentTarget.style.borderColor = '#4ade80'; }}
                                          onMouseLeave={e => { e.currentTarget.style.background = 'transparent'; e.currentTarget.style.borderColor = '#86efac'; }}>
                                          <PlusCircle size={14} style={{ color: '#4ade80' }} />
                                          <span className="text-[9px] font-bold uppercase tracking-widest" style={{ color: '#4ade80' }}>Available</span>
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

                {/* Mobile View */}
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
                                    <div className="text-[10px] font-black uppercase tracking-widest" style={{ color: '#3d2f1f' }}>{block.label}</div>
                                    <div className="text-[9px] font-semibold" style={{ color: '#78716c' }}>{block.display}</div>
                                  </div>
                                  <div className="space-y-1" style={{ minHeight: 64 }}>
                                    {hasStudents && !isOnTimeOff ? (
                                      <>
                                        {session!.students.map((student: any) => (
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
                                        style={{ minHeight: 56, background: 'transparent', border: '2px dashed #86efac' }}>
                                        <PlusCircle size={14} style={{ color: '#4ade80' }} />
                                        <span className="text-[8px] font-bold uppercase tracking-wider" style={{ color: '#4ade80' }}>Available</span>
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
  );
}