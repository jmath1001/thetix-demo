'use client';

import React from 'react';
import { Check, X, Clock, Calendar } from 'lucide-react';
import { toISODate, dayOfWeek, type Tutor } from '@/lib/useScheduleData';
import { getSessionsForDay } from '@/components/constants';
import { MAX_CAPACITY } from '@/components/constants';
import { ACTIVE_DAYS, DAY_NAMES, getTutorPaletteByIndex } from './schedule/scheduleConstants';
import { isTutorAvailable } from './schedule/scheduleUtils';

interface CalendarPreviewProps {
  activeDates: Date[];
  tutors: Tutor[];
  sessions: any[];
  timeOff: any[];
  students: any[];
  tutorPaletteMap: Record<string, number>;
  proposal: any;
}

export function CalendarPreview({
  activeDates,
  tutors,
  sessions,
  timeOff,
  students,
  tutorPaletteMap,
  proposal
}: CalendarPreviewProps) {
  // Apply proposed changes to create preview sessions
  const previewSessions = React.useMemo(() => {
    const baseSessions = [...sessions];
    
    if (proposal?.changes) {
      proposal.changes.forEach((change: any) => {
        const action = change?.action ?? 'place';

        if (action === 'move') {
          const fromSessionId = change?.fromSessionId;
          const studentId = change?.studentId;
          if (fromSessionId && studentId) {
            const fromIdx = baseSessions.findIndex(s => s.id === fromSessionId);
            if (fromIdx >= 0) {
              baseSessions[fromIdx] = {
                ...baseSessions[fromIdx],
                students: (baseSessions[fromIdx].students ?? []).filter((st: any) => st.id !== studentId),
              };
            }
          }
        }

        if (change.newSlot?.date && change.newSlot?.time && change.newSlot?.tutorName) {
          // Find the tutor
          const tutor = tutors.find(t => t.id === change.newSlot.tutorId) ?? tutors.find(t => t.name === change.newSlot.tutorName);
          if (!tutor) return;
          
          // Find or create the session
          let session = baseSessions.find(s => 
            s.date === change.newSlot.date && 
            s.tutorId === tutor.id && 
            s.time === change.newSlot.time
          );
          
          if (!session) {
            session = {
              id: `preview-${tutor.id}-${change.newSlot.date}-${change.newSlot.time}`,
              date: change.newSlot.date,
              tutorId: tutor.id,
              time: change.newSlot.time,
              students: []
            };
            baseSessions.push(session);
          }
          
          // Find the student
          const student = students.find(s => s.id === change.studentId) ?? students.find(s => s.name === change.studentName);
          if (student && !session.students.find((st: any) => st.id === student.id)) {
            session.students.push({
              id: student.id,
              name: student.name,
              topic: change.newSlot.topic || student.subject,
              status: 'preview', // Mark as preview
              confirmationStatus: 'confirmed'
            });
          }
        }
      });
    }
    
    return baseSessions;
  }, [sessions, proposal, tutors, students]);

  const getSessionForSlot = (tutorId: string, date: string, time: string) => {
    return previewSessions.find(s => s.date === date && s.tutorId === tutorId && s.time === time);
  };

  const isTimeOff = (tutorId: string, date: string) => {
    return timeOff.some(t => t.tutorId === tutorId && t.date === date);
  };

  // Use proposal's week range to filter displayed dates
  const weekStart = proposal?.context?.weekStart;
  const weekEnd = proposal?.context?.weekEnd;
  const datesInWeek = React.useMemo(() => {
    if (!weekStart || !weekEnd) return activeDates;
    return activeDates.filter(date => {
      const dateStr = toISODate(date);
      return dateStr >= weekStart && dateStr <= weekEnd;
    });
  }, [activeDates, weekStart, weekEnd]);

  return (
    <div className="bg-white rounded-2xl border border-slate-200 overflow-hidden">
      {/* Header */}
      <div className="bg-slate-50 border-b border-slate-200 px-6 py-4">
        <div className="flex items-center gap-3">
          <Calendar size={20} className="text-slate-600" />
          <div>
            <h3 className="text-lg font-semibold text-slate-900">Calendar Preview</h3>
            <p className="text-sm text-slate-600">
              Week view {weekStart && weekEnd ? `(${weekStart} to ${weekEnd})` : ''} with proposed changes
            </p>
          </div>
        </div>
      </div>

      {/* Calendar Grid */}
      <div className="overflow-x-auto">
        <div className="min-w-200 p-6">
          <div className="mb-5 grid gap-3 sm:grid-cols-3">
            <div className="rounded-3xl bg-white p-4 shadow-sm">
              <p className="text-xs uppercase tracking-[0.24em] text-slate-400">Booked sessions</p>
              <p className="mt-2 text-2xl font-semibold text-slate-900">{previewSessions.filter(s => s.students?.length > 0).length}</p>
            </div>
            <div className="rounded-3xl bg-white p-4 shadow-sm">
              <p className="text-xs uppercase tracking-[0.24em] text-slate-400">Preview changes</p>
              <p className="mt-2 text-2xl font-semibold text-slate-900">{previewSessions.filter(s => s.students?.some((st: any) => st.status === 'preview')).length}</p>
            </div>
            <div className="rounded-3xl bg-white p-4 shadow-sm">
              <p className="text-xs uppercase tracking-[0.24em] text-slate-400">Available tutor-days</p>
              <p className="mt-2 text-2xl font-semibold text-slate-900">{datesInWeek.length * tutors.length}</p>
            </div>
          </div>

          {/* Days header */}
          <div className="grid grid-cols-[120px_repeat(5,1fr)] gap-2 mb-4">
            <div className="text-xs font-semibold text-slate-500 uppercase tracking-wider">Tutor</div>
            {datesInWeek.map((date) => (
              <div key={toISODate(date)} className="text-center">
                <div className="text-sm font-semibold text-slate-900">
                  {new Intl.DateTimeFormat('en-US', { weekday: 'short' }).format(date)}
                </div>
                <div className="text-xs text-slate-500">
                  {date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
                </div>
              </div>
            ))}
          </div>

          {/* Tutor rows */}
          {tutors.map((tutor) => {
            const tutorPalette = getTutorPaletteByIndex(tutorPaletteMap[tutor.id] || 0);
            return (
            <div key={tutor.id} className="grid grid-cols-[120px_repeat(5,1fr)] gap-2 mb-2">
              <div className="flex items-center gap-2 py-2">
                <div 
                  className="w-8 h-8 rounded-lg flex items-center justify-center text-xs font-bold"
                  style={{ backgroundColor: tutorPalette.bg, color: tutorPalette.text, border: `1px solid ${tutorPalette.border}` }}
                >
                  {tutor.name[0]}
                </div>
                <span className="text-sm font-medium text-slate-900 truncate">{tutor.name}</span>
              </div>

              {datesInWeek.map((date) => {
                const dateStr = toISODate(date);
                const dow = dayOfWeek(dateStr);
                
                return (
                  <div key={dateStr} className="space-y-1">
                    {getSessionsForDay(dow).map((block) => {
                      const session = getSessionForSlot(tutor.id, dateStr, block.time);
                      const isOff = isTimeOff(tutor.id, dateStr);
                      const isAvailable = !isOff && tutor.availability.includes(dow) && isTutorAvailable(tutor, dow, block.time);
                      
                      if (!isAvailable) {
                        return (
                          <div key={block.time} className="h-12 bg-slate-100 rounded-lg border border-slate-200 flex items-center justify-center">
                            <span className="text-xs text-slate-400">—</span>
                          </div>
                        );
                      }

                      const studentCount = session?.students?.length || 0;
                      const hasPreviewStudents = session?.students?.some((s: any) => s.status === 'preview') || false;

                      return (
                        <div 
                          key={block.time}
                          className={`h-12 rounded-lg border flex items-center justify-center text-xs font-medium transition-colors ${
                            hasPreviewStudents 
                              ? 'bg-indigo-50 border-indigo-300 text-indigo-700' 
                              : studentCount > 0 
                                ? 'bg-green-50 border-green-300 text-green-700'
                                : 'bg-white border-slate-200 text-slate-600'
                          }`}
                        >
                          <div className="flex items-center gap-1">
                            <Clock size={12} />
                            <span>{block.label}</span>
                            {studentCount > 0 && (
                              <span className="ml-1 bg-slate-200 text-slate-700 px-1.5 py-0.5 rounded text-[10px]">
                                {studentCount}/{MAX_CAPACITY}
                              </span>
                            )}
                            {hasPreviewStudents && (
                              <div className="ml-1 w-2 h-2 bg-indigo-500 rounded-full" title="Preview booking" />
                            )}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                );
              })}
            </div>
          )})}
        </div>
      </div>

      {/* Legend */}
      <div className="border-t border-slate-200 bg-slate-50 px-6 py-4">
        <div className="flex items-center gap-6 text-xs">
          <div className="flex items-center gap-2">
            <div className="w-3 h-3 bg-green-100 border border-green-300 rounded"></div>
            <span className="text-slate-600">Booked slots</span>
          </div>
          <div className="flex items-center gap-2">
            <div className="w-3 h-3 bg-indigo-50 border border-indigo-300 rounded"></div>
            <span className="text-slate-600">Preview changes</span>
          </div>
          <div className="flex items-center gap-2">
            <div className="w-3 h-3 bg-slate-100 border border-slate-200 rounded"></div>
            <span className="text-slate-600">Available slots</span>
          </div>
        </div>
      </div>
    </div>
  );
}