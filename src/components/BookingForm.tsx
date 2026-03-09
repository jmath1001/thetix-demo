"use client";

import React, { useState, useMemo } from 'react';
import { Search, X, Repeat, Check, Clock, BookOpen } from "lucide-react";

import { formatTime } from '@/components/constants';
import { SUBJECT_GROUPS } from '@/components/TutorManagementModal';

// ─── Types ───────────────────────────────────────────────────────────────────

export interface PrefilledSlot {
  tutor: any;
  dayName: string;
  dayNum: number;
  date: string;
  time: string;
  seatsLeft: number; 
  block?: {
    label: string;
    display: string;
  };
}

export interface BookingConfirmData {
  student: any;
  slot: PrefilledSlot;
  recurring: boolean;
  recurringWeeks: number;
  subject: string;
  topic: string; 
}

export interface BookingFormProps {
  prefilledSlot?: PrefilledSlot | null;
  onConfirm: (data: BookingConfirmData) => void;
  onCancel: () => void;
  enrollCat: string;
  setEnrollCat: (c: string) => void;
  allAvailableSeats: any[];
  studentDatabase: any[];
  sessions?: any[];
}

// ─── StudentRow ───────────────────────────────────────────────────────────────

function StudentRow({ student, selected, onSelect, isUnassigned }: {
  student: any;
  selected: boolean;
  onSelect: (s: any) => void;
  isUnassigned?: boolean;
}) {
  return (
    <button
      onClick={() => onSelect(student)}
      className="w-full p-3 text-left transition-all flex items-center gap-3 border-b border-[#f0ece8]"
      style={{ background: selected ? '#ede9fe' : 'transparent' }}
    >
      <div className="w-8 h-8 rounded-full flex items-center justify-center shrink-0 text-xs font-bold"
        style={{ background: selected ? '#6d28d9' : '#f0ece8', color: selected ? 'white' : '#78716c' }}>
        {student.name.charAt(0)}
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <p className="text-sm font-semibold truncate text-[#1c1917]">{student.name}</p>
          {isUnassigned && !selected && (
            <span className="text-[9px] font-black px-1.5 py-0.5 rounded-full bg-[#fef3c7] text-[#92400e] border border-[#fcd34d]">NEW</span>
          )}
        </div>
        <p className="text-[10px] text-[#a8a29e] uppercase font-medium">Grade {student.grade || 'N/A'}</p>
      </div>
      {selected && <Check size={14} className="text-[#6d28d9]" strokeWidth={3} />}
    </button>
  );
}

// ─── Main BookingForm ─────────────────────────────────────────────────────────

export function BookingForm({
  prefilledSlot,
  onConfirm,
  onCancel,
  enrollCat,
  setEnrollCat,
  allAvailableSeats,
  studentDatabase,
  sessions = [],
}: BookingFormProps) {
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedStudent, setSelectedStudent] = useState<any>(null);
  const [topic, setTopic] = useState(''); 
  const [recurring, setRecurring] = useState(false);
  const [recurringWeeks, setRecurringWeeks] = useState(4);
  const [selectedSlot, setSelectedSlot] = useState<any>(prefilledSlot || null);
  const [subjectFilter, setSubjectFilter] = useState<string | null>(null);

  const assignedStudentIds = useMemo(() => {
    const ids = new Set<string>();
    sessions.forEach((session: any) => {
      // Logic adjusted for slake_ session structure
      session.students?.forEach((s: any) => ids.add(s.id));
    });
    return ids;
  }, [sessions]);

  const filteredStudents = useMemo(() => {
    const filtered = studentDatabase.filter(s =>
      s.name.toLowerCase().includes(searchQuery.toLowerCase())
    );
    return filtered.sort((a, b) => {
      const aU = !assignedStudentIds.has(a.id);
      const bU = !assignedStudentIds.has(b.id);
      if (aU && !bU) return -1;
      if (!aU && bU) return 1;
      return a.name.localeCompare(b.name);
    });
  }, [searchQuery, studentDatabase, assignedStudentIds]);

  const filteredSeats = useMemo(() => {
    if (!subjectFilter) return allAvailableSeats;
    return allAvailableSeats.filter(slot => slot.tutor.subjects?.includes(subjectFilter));
  }, [subjectFilter, allAvailableSeats]);

  const slotsByDay = useMemo(() => {
    const groups: Record<string, any[]> = {};
    filteredSeats.forEach(slot => {
      if (!groups[slot.dayName]) groups[slot.dayName] = [];
      groups[slot.dayName].push(slot);
    });
    return groups;
  }, [filteredSeats]);

  const selectStudent = (student: any) => {
    setSelectedStudent(student);
    setTopic(''); 
  };

  const canConfirm = selectedStudent && (selectedSlot || prefilledSlot) && topic.trim() !== '';

  return (
    <div className="w-full max-w-5xl bg-white rounded-2xl flex flex-col md:flex-row overflow-hidden border border-[#e7e3dd] shadow-2xl" style={{ maxHeight: '85vh' }}>

      <div className="w-full md:w-72 bg-[#faf9f7] border-r border-[#e7e3dd] flex flex-col">
        <div className="p-5 bg-white border-b border-[#e7e3dd]">
          <h3 className="text-lg font-bold text-[#1c1917] mb-1">Slake Scheduler</h3>
          <p className="text-xs text-[#a8a29e] mb-4">Select a student to schedule</p>
          <div className="relative">
            <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-[#a8a29e]" />
            <input
              className="w-full pl-9 pr-3 py-2.5 bg-[#f0ece8]/50 border-none rounded-xl text-sm focus:ring-2 focus:ring-[#6d28d9] outline-none"
              placeholder="Search students..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
            />
          </div>
        </div>

        <div className="flex-1 overflow-y-auto">
          {filteredStudents.length > 0 ? (
            filteredStudents.map(student => (
              <StudentRow
                key={student.id}
                student={student}
                selected={selectedStudent?.id === student.id}
                onSelect={selectStudent}
                isUnassigned={!assignedStudentIds.has(student.id)}
              />
            ))
          ) : (
            <div className="p-10 text-center text-xs text-[#a8a29e] italic">No students found</div>
          )}
        </div>

        {selectedStudent && (
          <div className="p-4 bg-white border-t border-[#e7e3dd]">
            <label className="text-[10px] font-black text-[#6d28d9] uppercase tracking-widest mb-1.5 flex items-center gap-1.5">
              <BookOpen size={10} /> Session Topic
            </label>
            <input
              className="w-full px-3 py-2.5 rounded-xl text-sm border-2 border-[#100903] focus:border-[#6d28d9] outline-none transition-all text-black"
              placeholder="e.g. Geometry, SAT Prep"
              value={topic}
              onChange={(e) => setTopic(e.target.value)}
            />
          </div>
        )}
      </div>

      <div className="flex-1 flex flex-col bg-white overflow-hidden">
        <div className="px-6 py-4 border-b border-[#f0ece8] flex justify-between items-center sticky top-0 bg-white z-10">
          <div className="flex items-center gap-4">
            <h4 className="font-bold text-[#1c1917]">
              {prefilledSlot ? 'Confirm Details' : 'Available Openings'}
            </h4>
            {!prefilledSlot && (
              <div className="flex gap-1 bg-[#f0ece8] p-1 rounded-lg">
                {(['math', 'english'] as const).map(cat => (
                  <button key={cat} onClick={() => setEnrollCat(cat)}
                    className={`px-3 py-1 rounded-md text-[10px] font-bold uppercase transition-all ${enrollCat === cat ? 'bg-white text-[#6d28d9] shadow-sm' : 'text-[#78716c]'}`}>
                    {cat}
                  </button>
                ))}
              </div>
            )}
          </div>
          <button onClick={onCancel} className="p-1.5 hover:bg-[#f9f7f4] rounded-full text-[#a8a29e] transition-colors"><X size={20} /></button>
        </div>

        {!prefilledSlot && (
          <div className="px-6 py-3 flex flex-wrap gap-1.5 border-b border-[#f0ece8]">
            <button onClick={() => setSubjectFilter(null)}
              className={`px-2.5 py-1 rounded-lg text-[10px] font-bold transition-all ${!subjectFilter ? 'bg-[#1c1917] text-white' : 'bg-[#f0ece8] text-[#78716c] hover:bg-[#e7e3dd]'}`}>
              All
            </button>
            {SUBJECT_GROUPS.map(group => (
              <React.Fragment key={group.group}>
                {group.subjects.map(subj => (
                  <button key={subj}
                    onClick={() => setSubjectFilter(subjectFilter === subj ? null : subj)}
                    className={`px-2.5 py-1 rounded-lg text-[10px] font-semibold transition-all ${subjectFilter === subj ? 'bg-[#6d28d9] text-white' : 'bg-[#f0ece8] text-[#78716c] hover:bg-[#e7e3dd]'}`}>
                    {subj}
                  </button>
                ))}
              </React.Fragment>
            ))}
          </div>
        )}

        <div className="flex-1 overflow-y-auto p-6">
          {prefilledSlot ? (
            <div className="max-w-md mx-auto py-10">
              <div className="p-6 rounded-2xl border-2 border-[#6d28d9] bg-[#faf9ff] flex items-center gap-5">
                <div className="w-16 h-16 rounded-2xl bg-[#6d28d9] flex flex-col items-center justify-center text-white">
                  <span className="text-[10px] font-bold uppercase opacity-80">{prefilledSlot.dayName.slice(0, 3)}</span>
                  <span className="text-sm font-black text-center px-1">{(prefilledSlot as any).block?.label ?? formatTime(prefilledSlot.time)}</span>
                </div>
                <div>
                  <p className="text-lg font-bold text-[#1c1917]">{prefilledSlot.tutor.name}</p>
                  <p className="text-sm text-[#6d28d9] font-medium">{prefilledSlot.dayName} · {(prefilledSlot as any).block?.display ?? formatTime(prefilledSlot.time)}</p>
                </div>
              </div>
            </div>
          ) : (
            <div className="space-y-8">
              {Object.entries(slotsByDay).length > 0 ? Object.entries(slotsByDay).map(([day, slots]) => (
                <div key={day} className="space-y-4">
                  <div className="flex items-center gap-3">
                    <div className="px-3 py-1 rounded-full bg-[#1c1917] text-white text-[10px] font-black uppercase tracking-widest">{day}</div>
                    <div className="h-[1px] flex-1 bg-[#f0ece8]" />
                  </div>
                  <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                    {slots.map((slot, idx) => {
                      const isSelected = selectedSlot?.tutor.id === slot.tutor.id && selectedSlot?.time === slot.time && selectedSlot?.dayName === slot.dayName;
                      const maxSpots = 3;
                      const assignedCount = maxSpots - slot.seatsLeft;
                      
                      return (
                        <button key={idx} onClick={() => setSelectedSlot(slot)}
                          className={`p-4 rounded-xl border-2 text-left transition-all relative ${isSelected ? 'border-[#6d28d9] bg-[#faf9ff] shadow-lg shadow-violet-100' : 'border-[#f0ece8] hover:border-[#c4b5fd]'}`}>
                          <div className="flex items-center justify-between mb-2">
                            <div className="flex items-center gap-2">
                              <Clock size={12} className={isSelected ? 'text-[#6d28d9]' : 'text-[#a8a29e]'} />
                              <span className={`text-sm font-bold ${isSelected ? 'text-[#6d28d9]' : 'text-[#1c1917]'}`}>
                                {slot.block?.label ?? formatTime(slot.time)}
                              </span>
                            </div>
                            <span className={`text-[10px] font-black px-1.5 py-0.5 rounded ${isSelected ? 'bg-[#6d28d9] text-white' : 'bg-[#f0ece8] text-[#78716c]'}`}>
                              {assignedCount} / {maxSpots}
                            </span>
                          </div>
                          <p className="text-xs font-bold text-[#1c1917] truncate">{slot.tutor.name}</p>
                          <p className="text-[10px] text-[#a8a29e] uppercase mt-0.5">{slot.tutor.subjects[0]}</p>
                          
                          <div className="mt-3 pt-2 border-t border-[#f0ece8]">
                            <p className="text-[9px] font-bold uppercase" style={{ color: slot.seatsLeft === 1 ? '#c27d38' : '#a8a29e' }}>
                              {slot.seatsLeft === 0 ? 'Full' : `${slot.seatsLeft} spot${slot.seatsLeft !== 1 ? 's' : ''} left`}
                            </p>
                          </div>

                          {isSelected && <div className="absolute top-2 right-2"><Check size={16} className="text-[#6d28d9]" strokeWidth={3} /></div>}
                        </button>
                      );
                    })}
                  </div>
                </div>
              )) : (
                <div className="text-center py-20">
                  <p className="text-sm text-[#a8a29e] italic">No available slots this week.</p>
                </div>
              )}
            </div>
          )}
        </div>

        <div className="p-6 border-t border-[#f0ece8] bg-[#faf9f7]">
          <div className="flex flex-col md:flex-row items-center gap-4">
            <div className="flex items-center gap-4 bg-white px-4 py-2.5 rounded-xl border border-[#e7e3dd] w-full md:w-auto">
              <div className="flex items-center gap-2">
                <Repeat size={14} className={recurring ? 'text-[#6d28d9]' : 'text-[#a8a29e]'} />
                <span className="text-xs font-bold text-[#1c1917]">Recurring</span>
              </div>
              <div className="flex gap-1">
                {[2, 4, 8].map(w => (
                  <button key={w} onClick={() => { setRecurring(true); setRecurringWeeks(w); }}
                    className={`px-2 py-1 rounded text-[10px] font-bold border ${recurring && recurringWeeks === w ? 'bg-[#6d28d9] border-[#6d28d9] text-white' : 'bg-white border-[#e7e3dd] text-[#78716c]'}`}>
                    {w}w
                  </button>
                ))}
                {recurring && (
                  <button onClick={() => setRecurring(false)} className="ml-1 p-1 text-[#ef4444] hover:bg-red-50 rounded"><X size={12} /></button>
                )}
              </div>
            </div>

            <button
              disabled={!canConfirm}
              onClick={() => onConfirm({
                student: selectedStudent,
                slot: prefilledSlot || selectedSlot,
                recurring,
                recurringWeeks,
                subject: selectedStudent?.subject,
                topic: topic,
              })}
              className={`flex-1 py-4 rounded-xl font-black text-sm uppercase tracking-widest transition-all active:scale-[0.98] shadow-xl ${
                canConfirm
                  ? 'bg-[#6d28d9] text-white shadow-[#6d28d9]/20 hover:bg-[#5b21b6]'
                  : 'bg-[#e7e3dd] text-[#a8a29e] cursor-not-allowed shadow-none'
              }`}
            >
              {canConfirm ? `Confirm ${topic} for ${selectedStudent.name}` : 'Select Student, Topic & Slot'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

export function BookingToast({ data, onClose }: { data: BookingConfirmData; onClose: () => void }) {
  return (
    <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-[60] bg-white border border-[#e7e3dd] px-5 py-4 rounded-2xl flex items-center gap-4 shadow-2xl min-w-[320px]">
      <div className="w-10 h-10 rounded-full bg-[#d1fae5] flex items-center justify-center text-[#059669]">
        <Check size={20} strokeWidth={3} />
      </div>
      <div className="flex-1">
        <p className="text-sm font-bold text-[#1c1917]">{data.student.name} Booked!</p>
        <p className="text-[11px] text-[#a8a29e]">
          {data.slot.dayName} · {data.topic} · {data.slot.tutor.name}
          {data.recurring && ` · Repeated ${data.recurringWeeks} weeks`}
        </p>
      </div>
      <button onClick={onClose} className="text-[#a8a29e] hover:text-[#1c1917]"><X size={16} /></button>
    </div>
  );
}