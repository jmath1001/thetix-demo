"use client";

import React, { useState, useMemo, useRef, useEffect } from 'react';
import { Search, X, Repeat, Check, Clock, BookOpen, ChevronRight, ChevronDown } from "lucide-react";

import { formatTime } from '@/components/constants';

export interface PrefilledSlot {
  tutor: any;
  dayName: string;
  dayNum: number;
  date: string;
  time: string;
  seatsLeft: number;
  block?: { label: string; display: string; };
}

export interface BookingConfirmData {
  student: any;
  slot: PrefilledSlot;
  recurring: boolean;
  recurringWeeks: number;
  subject: string;
  topic: string;
  notes: string;
}

export interface BookingFormProps {
  prefilledSlot?: PrefilledSlot | null;
  onConfirm: (data: BookingConfirmData) => void;
  onCancel: () => void;
  enrollCat: string;
  setEnrollCat: (c: string) => void;
  allAvailableSeats: any[];
  studentDatabase: any[];
  initialStudentId?: string | null;
  sessions?: any[];
}

function StudentRow({ student, selected, onSelect, isUnassigned }: {
  student: any; selected: boolean; onSelect: (s: any) => void; isUnassigned?: boolean;
}) {
  return (
    <button onClick={() => onSelect(student)}
      className="w-full p-3 text-left transition-all flex items-center gap-3 border-b border-[#f0ece8]"
      style={{ background: selected ? '#eef2ff' : 'transparent' }}>
      <div className="w-8 h-8 rounded-full flex items-center justify-center shrink-0 text-xs font-bold"
        style={{ background: selected ? '#4f46e5' : '#f0ece8', color: selected ? 'white' : '#78716c' }}>
        {student.name.charAt(0)}
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <p className="text-sm font-semibold truncate text-[#1c1917]">{student.name}</p>
          {isUnassigned && !selected && (
            <span className="text-[9px] font-black px-1.5 py-0.5 rounded-full bg-[#eef2ff] text-[#4f46e5] border border-[#a5b4fc] shrink-0">NEW</span>
          )}
        </div>
        <p className="text-[10px] text-[#a8a29e] uppercase font-medium">Grade {student.grade || 'N/A'}</p>
      </div>
      {selected && <Check size={14} className="text-[#4f46e5] shrink-0" strokeWidth={3} />}
    </button>
  );
}

export function BookingForm({
  prefilledSlot, onConfirm, onCancel, enrollCat, setEnrollCat,
  allAvailableSeats, studentDatabase, sessions = [], initialStudentId = null,
}: BookingFormProps) {
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedStudent, setSelectedStudent] = useState<any>(null);
  const [topic, setTopic] = useState('');
  const [notes, setNotes] = useState('');
  const [recurring, setRecurring] = useState(false);
  const [recurringWeeks, setRecurringWeeks] = useState(4);
  const [selectedSlot, setSelectedSlot] = useState<any>(prefilledSlot || null);
  const [subjectFilter, setSubjectFilter] = useState<string | null>(null);
  const [showAllSlots, setShowAllSlots] = useState(false);
  const [showSubjectDropdown, setShowSubjectDropdown] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);

  const [mobileTab, setMobileTab] = useState(0);

  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setShowSubjectDropdown(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  const assignedStudentIds = useMemo(() => {
    const ids = new Set<string>();
    sessions.forEach((session: any) => { session.students?.forEach((s: any) => ids.add(s.id)); });
    return ids;
  }, [sessions]);

  const filteredStudents = useMemo(() => {
    return studentDatabase
      .filter(s => s.name.toLowerCase().includes(searchQuery.toLowerCase()))
      .sort((a, b) => {
        const aU = !assignedStudentIds.has(a.id), bU = !assignedStudentIds.has(b.id);
        if (aU && !bU) return -1; if (!aU && bU) return 1;
        return a.name.localeCompare(b.name);
      });
  }, [searchQuery, studentDatabase, assignedStudentIds]);

  const catSeats = useMemo(() =>
    allAvailableSeats.filter(s => s.tutor.cat === enrollCat),
    [allAvailableSeats, enrollCat]);

  const filteredSeats = useMemo(() =>
    !subjectFilter ? catSeats : catSeats.filter(s => s.tutor.subjects?.includes(subjectFilter)),
    [subjectFilter, catSeats]);

  const slotsByDay = useMemo(() => {
    const groups: Record<string, any[]> = {};
    filteredSeats.forEach(slot => { if (!groups[slot.dayName]) groups[slot.dayName] = []; groups[slot.dayName].push(slot); });
    return groups;
  }, [filteredSeats]);

  const catSubjects = useMemo(() => {
    const s = new Set<string>();
    catSeats.forEach(seat => seat.tutor.subjects?.forEach((subj: string) => s.add(subj)));
    return Array.from(s).sort();
  }, [catSeats]);

  const filteredSubjectOptions = useMemo(() => {
    return catSubjects.filter(s => s.toLowerCase().includes(topic.toLowerCase()));
  }, [catSubjects, topic]);

  React.useEffect(() => { setSubjectFilter(null); }, [enrollCat]);
  const studentHasAvailability = selectedStudent?.availabilityBlocks?.length > 0;
  
  const availableSlotsByDay = useMemo(() => {
    if (!studentHasAvailability || showAllSlots) return slotsByDay;
    const blocks: string[] = selectedStudent.availabilityBlocks;
    const filtered: Record<string, any[]> = {};
    Object.entries(slotsByDay).forEach(([day, slots]) => {
      const matching = slots.filter(slot => blocks.includes(`${slot.dayNum}-${slot.time}`));
      if (matching.length > 0) filtered[day] = matching;
    });
    return filtered;
  }, [slotsByDay, selectedStudent, studentHasAvailability, showAllSlots]);

  const selectStudent = (student: any) => { setSelectedStudent(student); setTopic(''); setNotes(''); setShowAllSlots(false); };

  // If parent passes an initial student id (AI flow), auto-select that student
  React.useEffect(() => {
    if (initialStudentId) {
      const s = studentDatabase.find(st => st.id === initialStudentId)
      if (s) selectStudent(s)
    }
  }, [initialStudentId, studentDatabase]);
  const canConfirm = selectedStudent && (selectedSlot || prefilledSlot) && topic.trim() !== '';

  const SlotPanel = () => (
    <div className="flex-1 overflow-y-auto p-4 md:p-6">
      {studentHasAvailability && !prefilledSlot && (
        <div className="flex items-center justify-between mb-4 px-3 py-2.5 rounded-xl border"
          style={{ background: showAllSlots ? '#f7f4ef' : '#f0fdf4', borderColor: showAllSlots ? '#e7e3dd' : '#86efac' }}>
          <p className="text-[11px] font-bold" style={{ color: showAllSlots ? '#78716c' : '#15803d' }}>
            {showAllSlots
              ? 'Showing all slots'
              : `Filtered to ${selectedStudent.name.split(' ')[0]}'s availability`}
          </p>
          <button onClick={() => setShowAllSlots(v => !v)}
            className="text-[10px] font-black uppercase tracking-wider px-2.5 py-1 rounded-lg transition-all"
            style={{ background: showAllSlots ? '#e7e3dd' : '#dcfce7', color: showAllSlots ? '#78716c' : '#15803d' }}>
            {showAllSlots ? 'Filter' : 'Show all'}
          </button>
        </div>
      )}
      {prefilledSlot ? (
        <div className="max-w-md mx-auto py-6">
          <div className="p-5 rounded-2xl border-2 border-[#4f46e5] bg-[#f5f3ff] flex items-center gap-4">
            <div className="w-14 h-14 rounded-2xl bg-[#4f46e5] flex flex-col items-center justify-center text-white shrink-0">
              <span className="text-[9px] font-bold uppercase opacity-80">{prefilledSlot.dayName.slice(0, 3)}</span>
              <span className="text-xs font-black text-center px-1">{(prefilledSlot as any).block?.label ?? formatTime(prefilledSlot.time)}</span>
            </div>
            <div>
              <p className="text-base font-bold text-[#1c1917]">{prefilledSlot.tutor.name}</p>
              <p className="text-sm text-[#4f46e5] font-medium">{prefilledSlot.dayName} · {(prefilledSlot as any).block?.display ?? formatTime(prefilledSlot.time)}</p>
            </div>
          </div>
        </div>
      ) : (
        <div className="space-y-6">
          {Object.entries(availableSlotsByDay).length > 0 ? Object.entries(availableSlotsByDay).map(([day, slots]) => (
            <div key={day} className="space-y-3">
              <div className="flex items-center gap-3">
                <div className="px-3 py-1 rounded-full bg-[#1c1917] text-white text-[10px] font-black uppercase tracking-widest">{day}</div>
                <div className="h-px flex-1 bg-[#f0ece8]" />
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2.5">
                {slots.map((slot, idx) => {
                  const isSelected = selectedSlot?.tutor.id === slot.tutor.id && selectedSlot?.time === slot.time && selectedSlot?.dayName === slot.dayName;
                  const assignedCount = 3 - slot.seatsLeft;
                  return (
                    <button key={idx} onClick={() => setSelectedSlot(slot)}
                      className={`p-3.5 rounded-xl border-2 text-left transition-all relative ${isSelected ? 'border-[#4f46e5] bg-[#f5f3ff] shadow-lg shadow-indigo-100' : 'border-[#f0ece8] hover:border-[#a5b4fc]'}`}>
                      <div className="flex items-center justify-between mb-1.5">
                        <div className="flex items-center gap-1.5">
                          <Clock size={11} className={isSelected ? 'text-[#4f46e5]' : 'text-[#a8a29e]'} />
                          <span className={`text-sm font-bold ${isSelected ? 'text-[#4f46e5]' : 'text-[#1c1917]'}`}>{slot.block?.label ?? formatTime(slot.time)}</span>
                        </div>
                        <span className={`text-[10px] font-black px-1.5 py-0.5 rounded ${isSelected ? 'bg-[#4f46e5] text-white' : 'bg-[#f0ece8] text-[#78716c]'}`}>{assignedCount}/3</span>
                      </div>
                      <p className="text-xs font-bold text-[#1c1917] truncate">{slot.tutor.name}</p>
                      <p className="text-[9px] text-[#a8a29e] uppercase mt-0.5">{slot.tutor.subjects?.[0]}</p>
                      <p className="text-[9px] font-bold mt-1.5" style={{ color: slot.seatsLeft === 1 ? '#4f46e5' : '#a8a29e' }}>
                        {slot.seatsLeft === 0 ? 'Full' : `${slot.seatsLeft} spot${slot.seatsLeft !== 1 ? 's' : ''} left`}
                      </p>
                      {isSelected && <div className="absolute top-2 right-2"><Check size={14} className="text-[#4f46e5]" strokeWidth={3} /></div>}
                    </button>
                  );
                })}
              </div>
            </div>
          )) : (
            <div className="text-center py-16">
              <p className="text-sm text-[#a8a29e] italic">
                {studentHasAvailability && !showAllSlots
                  ? `No slots match ${selectedStudent.name.split(' ')[0]}'s availability.`
                  : 'No available slots this week.'}
              </p>
              {studentHasAvailability && !showAllSlots && (
                <button onClick={() => setShowAllSlots(true)}
                  className="mt-3 text-xs font-bold text-[#4f46e5] underline underline-offset-2">
                  Show all slots anyway
                </button>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );

  const ConfirmFooter = () => (
    <div className="p-4 md:p-6 border-t border-[#f0ece8] bg-[#faf9f7]">
      <div className="flex flex-col gap-3">
        <div className="flex items-center gap-3 bg-white px-4 py-2.5 rounded-xl border border-[#e7e3dd]">
          <div className="flex items-center gap-2">
            <Repeat size={13} className={recurring ? 'text-[#4f46e5]' : 'text-[#a8a29e]'} />
            <span className="text-xs font-bold text-[#1c1917]">Recurring</span>
          </div>
          <div className="flex gap-1 ml-auto">
            {[2, 4, 8].map(w => (
              <button key={w} onClick={() => { setRecurring(true); setRecurringWeeks(w); }}
                className={`px-2.5 py-1 rounded text-[10px] font-bold border ${recurring && recurringWeeks === w ? 'bg-[#4f46e5] border-[#4f46e5] text-white' : 'bg-white border-[#e7e3dd] text-[#78716c]'}`}>
                {w}w
              </button>
            ))}
            {recurring && <button onClick={() => setRecurring(false)} className="ml-1 p-1 text-[#4f46e5] hover:bg-indigo-50 rounded"><X size={11} /></button>}
          </div>
        </div>
        <button disabled={!canConfirm}
          onClick={() => onConfirm({ student: selectedStudent, slot: prefilledSlot || selectedSlot, recurring, recurringWeeks, subject: selectedStudent?.subject, topic, notes })}
          className={`w-full py-3.5 rounded-xl font-black text-sm uppercase tracking-widest transition-all active:scale-[0.98] ${canConfirm ? 'bg-[#4f46e5] text-white hover:bg-[#3730a3] shadow-lg shadow-indigo-100' : 'bg-[#e7e3dd] text-[#a8a29e] cursor-not-allowed'}`}>
          {canConfirm ? `Book ${topic} · ${selectedStudent.name}` : 'Select Student, Topic & Slot'}
        </button>
      </div>
    </div>
  );

  return (
    <>
      <div className="hidden md:flex w-full max-w-5xl overflow-hidden rounded-[28px] border border-[#334155] bg-white shadow-[0_30px_80px_rgba(15,23,42,0.28)] flex-row" style={{ maxHeight: '85vh' }}>
        <div className="flex w-72 flex-col border-r border-[#cbd5e1] bg-[#f8fafc]">
          <div className="border-b border-[#cbd5e1] bg-[#0f172a] p-5">
            <h3 className="mb-1 text-lg font-black text-white">Center Scheduler</h3>
            <p className="mb-3 text-xs font-medium text-[#cbd5e1]">Select a student to schedule</p>
            <div className="relative">
              <Search size={13} className="absolute left-3 top-1/2 -translate-y-1/2 text-[#94a3b8]" />
              <input className="w-full rounded-xl border border-[#475569] bg-[#111827] py-2.5 pl-9 pr-3 text-sm font-medium text-white outline-none transition-all placeholder:text-[#94a3b8] focus:border-[#818cf8] focus:ring-4 focus:ring-[#312e81]/30"
                placeholder="Search students..." value={searchQuery} onChange={e => setSearchQuery(e.target.value)} />
            </div>
          </div>
          <div className="flex-1 overflow-y-auto">
            {filteredStudents.length > 0 ? filteredStudents.map(s => (
              <StudentRow key={s.id} student={s} selected={selectedStudent?.id === s.id} onSelect={selectStudent} isUnassigned={!assignedStudentIds.has(s.id)} />
            )) : <div className="p-10 text-center text-xs text-[#a8a29e] italic">No students found</div>}
          </div>
          {selectedStudent && (
            <div className="space-y-3 border-t border-[#cbd5e1] bg-white p-4">
              <div className="relative" ref={dropdownRef}>
                <label className="mb-1.5 flex items-center gap-1.5 text-[10px] font-black uppercase tracking-[0.18em] text-[#334155]"><BookOpen size={10} /> Subject / Topic</label>
                <div className="relative">
                  <input className="w-full rounded-xl border border-[#94a3b8] bg-[#f8fafc] px-3.5 py-2.5 pr-10 text-sm font-medium text-[#0f172a] outline-none transition-all placeholder:text-[#64748b] focus:border-[#4f46e5] focus:ring-4 focus:ring-[#eef2ff]"
                    placeholder="Search or type subject..." 
                    value={topic} 
                    onFocus={() => setShowSubjectDropdown(true)}
                    onChange={e => {setTopic(e.target.value); setShowSubjectDropdown(true);}} />
                  <ChevronDown size={14} className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-[#475569]" />
                </div>
                
                {showSubjectDropdown && (
                  <div className="absolute bottom-full left-0 z-50 mb-2 max-h-56 w-full overflow-y-auto rounded-2xl border border-[#cbd5e1] bg-white shadow-[0_24px_50px_rgba(15,23,42,0.22)]">
                    {filteredSubjectOptions.length > 0 ? (
                      filteredSubjectOptions.map(s => (
                        <button key={s} 
                          type="button"
                          onMouseDown={(e) => {
                            // Using onMouseDown to prevent focus loss before click
                            e.preventDefault(); 
                            setTopic(s); 
                            setShowSubjectDropdown(false);
                          }}
                          className="w-full border-b border-[#e2e8f0] px-3.5 py-3 text-left text-sm font-bold text-[#0f172a] transition-colors last:border-0 hover:bg-[#eef2ff] hover:text-[#312e81]">
                          {s}
                        </button>
                      ))
                    ) : (
                      <div className="px-3.5 py-3 text-[11px] font-bold italic text-[#475569]">Press Enter to use a custom topic</div>
                    )}
                  </div>
                )}
              </div>
              <div>
                <label className="mb-1.5 block text-[10px] font-black uppercase tracking-[0.18em] text-[#334155]">Notes</label>
                <textarea
                  className="w-full resize-none rounded-xl border border-[#94a3b8] bg-[#f8fafc] px-3.5 py-2.5 text-sm font-medium text-[#0f172a] outline-none transition-all placeholder:text-[#64748b] focus:border-[#4f46e5] focus:ring-4 focus:ring-[#eef2ff]"
                  placeholder="Any notes for this session…"
                  rows={2}
                  value={notes}
                  onChange={e => setNotes(e.target.value)}
                />
              </div>
            </div>
          )}
        </div>

        <div className="flex-1 flex flex-col overflow-hidden">
          <div className="flex items-center justify-between border-b border-[#1e293b] bg-[#0f172a] px-6 py-4">
            <div className="flex items-center gap-4">
              <h4 className="font-black text-white">{prefilledSlot ? 'Confirm Details' : 'Available Openings'}</h4>
              {!prefilledSlot && (
                <div className="flex gap-1 rounded-xl border border-[#334155] bg-[#111827] p-1">
                  {(['math', 'english'] as const).map(cat => (
                    <button key={cat} onClick={() => setEnrollCat(cat)}
                      className={`rounded-lg px-3 py-1.5 text-[10px] font-black uppercase tracking-[0.16em] transition-all ${enrollCat === cat ? 'bg-white text-[#312e81] shadow-sm' : 'text-[#cbd5e1]'}`}>
                      {cat}
                    </button>
                  ))}
                </div>
              )}
            </div>
            <button onClick={onCancel} className="rounded-full p-2 text-[#cbd5e1] transition-colors hover:bg-[rgba(255,255,255,0.08)] hover:text-white"><X size={20} /></button>
          </div>
          {!prefilledSlot && (
            <div className="flex gap-1.5 overflow-x-auto border-b border-[#cbd5e1] bg-[#f8fafc] px-6 py-3 no-scrollbar">
              <button onClick={() => setSubjectFilter(null)}
                className={`shrink-0 rounded-lg px-2.5 py-1.5 text-[10px] font-black uppercase tracking-[0.14em] transition-all ${!subjectFilter ? 'bg-[#0f172a] text-white' : 'bg-white text-[#475569] border border-[#cbd5e1]'}`}>All</button>
              {catSubjects.map(subj => (
                <button key={subj} onClick={() => setSubjectFilter(subjectFilter === subj ? null : subj)}
                  className={`shrink-0 rounded-lg px-2.5 py-1.5 text-[10px] font-black uppercase tracking-[0.14em] transition-all ${subjectFilter === subj ? 'bg-[#4f46e5] text-white' : 'border border-[#cbd5e1] bg-white text-[#475569]'}`}>
                  {subj}
                </button>
              ))}
            </div>
          )}
          <SlotPanel />
          <ConfirmFooter />
        </div>
      </div>

      <div className="md:hidden fixed inset-0 z-50 flex flex-col bg-white" style={{ paddingBottom: 'env(safe-area-inset-bottom)' }}>
        <div className="flex shrink-0 items-center justify-between border-b border-[#1e293b] bg-[#0f172a] px-4 py-3">
          <div>
            <p className="text-sm font-black text-white">Schedule Student</p>
            <p className="text-[10px] text-[#cbd5e1]">
              {mobileTab === 0 ? 'Pick a student' : mobileTab === 1 ? 'Pick a slot' : 'Confirm booking'}
            </p>
          </div>
          <button onClick={onCancel} className="flex h-9 w-9 items-center justify-center rounded-full border border-[#334155] bg-[#111827] text-[#e2e8f0]">
            <X size={18} />
          </button>
        </div>

        <div className="flex border-b border-[#e7e3dd] bg-white shrink-0">
          {['Student', 'Slot', 'Confirm'].map((label, i) => (
            <button key={i} onClick={() => setMobileTab(i)}
              className={`flex-1 py-2.5 text-[11px] font-black uppercase tracking-wider transition-all ${mobileTab === i ? 'text-[#4f46e5] border-b-2 border-[#4f46e5]' : 'text-[#a8a29e]'}`}>
              {i + 1}. {label}
            </button>
          ))}
        </div>

        <div className="flex-1 overflow-hidden flex flex-col">
          {mobileTab === 0 && (
            <>
              <div className="p-3 bg-[#faf9f7] border-b border-[#e7e3dd] shrink-0">
                <div className="relative">
                  <Search size={13} className="absolute left-3 top-1/2 -translate-y-1/2 text-[#a8a29e]" />
                  <input className="w-full pl-9 pr-3 py-2.5 bg-white rounded-xl text-sm text-[#1c1917] border border-[#e7e3dd] outline-none focus:border-[#4f46e5]"
                    placeholder="Search students..." value={searchQuery} onChange={e => setSearchQuery(e.target.value)} />
                </div>
              </div>
              <div className="flex-1 overflow-y-auto">
                {filteredStudents.map(s => (
                  <StudentRow key={s.id} student={s} selected={selectedStudent?.id === s.id} onSelect={selectStudent} isUnassigned={!assignedStudentIds.has(s.id)} />
                ))}
              </div>
              {selectedStudent && (
                <div className="p-3 bg-white border-t border-[#e7e3dd] shrink-0 space-y-2">
                  <div className="relative" ref={dropdownRef}>
                    <label className="flex items-center gap-1.5 text-[10px] font-black uppercase tracking-[0.18em] text-[#334155]"><BookOpen size={10} /> Session Topic</label>
                    <input className="w-full rounded-xl border border-[#94a3b8] bg-[#f8fafc] px-3.5 py-2.5 text-sm font-medium text-[#0f172a] outline-none transition-all placeholder:text-[#64748b] focus:border-[#4f46e5] focus:ring-4 focus:ring-[#eef2ff]"
                      placeholder="e.g. Geometry, SAT Prep" 
                      value={topic} 
                      onFocus={() => setShowSubjectDropdown(true)}
                      onChange={e => {setTopic(e.target.value); setShowSubjectDropdown(true);}} />
                    
                    {showSubjectDropdown && (
                      <div className="absolute bottom-full left-0 z-50 mb-2 max-h-40 w-full overflow-y-auto rounded-2xl border border-[#cbd5e1] bg-white shadow-[0_24px_50px_rgba(15,23,42,0.22)]">
                        {filteredSubjectOptions.map(s => (
                          <button key={s} 
                            onMouseDown={(e) => {
                                e.preventDefault();
                                setTopic(s); 
                                setShowSubjectDropdown(false);
                            }}
                            className="w-full border-b border-[#e2e8f0] px-3.5 py-3 text-left text-sm font-bold text-[#0f172a] last:border-0 active:bg-[#4f46e5] active:text-white">
                            {s}
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                  <button onClick={() => setMobileTab(1)}
                    className="w-full py-3 rounded-xl font-black text-sm text-white bg-[#4f46e5] flex items-center justify-center gap-2 active:scale-[0.98]">
                    Next: Pick Slot <ChevronRight size={16} />
                  </button>
                </div>
              )}
            </>
          )}

          {mobileTab === 1 && (
            <>
              {!prefilledSlot && (
                <div className="p-3 bg-white border-b border-[#e7e3dd] shrink-0 space-y-2">
                  <div className="flex gap-1 bg-[#f0ece8] p-1 rounded-lg self-start w-fit">
                    {(['math', 'english'] as const).map(cat => (
                      <button key={cat} onClick={() => setEnrollCat(cat)}
                        className={`px-3 py-1.5 rounded-md text-[11px] font-bold uppercase transition-all ${enrollCat === cat ? 'bg-white text-[#4f46e5] shadow-sm' : 'text-[#78716c]'}`}>
                        {cat}
                      </button>
                    ))}
                  </div>
                </div>
              )}
              <SlotPanel />
              {selectedSlot && (
                <div className="p-3 bg-white border-t border-[#e7e3dd] shrink-0">
                  <button onClick={() => setMobileTab(2)}
                    className="w-full py-3 rounded-xl font-black text-sm text-white bg-[#4f46e5] flex items-center justify-center gap-2 active:scale-[0.98]">
                    Next: Confirm <ChevronRight size={16} />
                  </button>
                </div>
              )}
            </>
          )}

          {mobileTab === 2 && (
            <div className="flex-1 overflow-y-auto flex flex-col">
              <div className="p-4 space-y-3 flex-1">
                <p className="text-[10px] font-black text-[#a8a29e] uppercase tracking-widest">Booking Summary</p>
                <div className="p-4 rounded-2xl bg-[#f5f3ff] border-2 border-[#4f46e5] space-y-2">
                  <div className="flex justify-between items-center">
                    <span className="text-[10px] text-[#a8a29e] uppercase font-bold">Student</span>
                    <span className="text-sm font-black text-[#1c1917]">{selectedStudent?.name ?? '—'}</span>
                  </div>
                  <div className="flex justify-between items-center">
                    <span className="text-[10px] text-[#a8a29e] uppercase font-bold">Topic</span>
                    <span className="text-sm font-bold text-[#4f46e5]">{topic || '—'}</span>
                  </div>
                  <div className="flex justify-between items-center">
                    <span className="text-[10px] text-[#a8a29e] uppercase font-bold">Slot</span>
                    <span className="text-sm font-bold text-[#1c1917]">
                      {(() => { const sl = prefilledSlot || selectedSlot; return sl ? `${sl.dayName} · ${sl.block?.label ?? formatTime(sl.time)}` : '—'; })()}
                    </span>
                  </div>
                </div>
              </div>
              <ConfirmFooter />
            </div>
          )}
        </div>
      </div>
    </>
  );
}

export function BookingToast({ data, onClose }: { data: BookingConfirmData; onClose: () => void }) {
  return (
    <div className="fixed bottom-6 left-1/2 z-60 flex min-w-75 max-w-[90vw] -translate-x-1/2 items-center gap-3 rounded-2xl border border-slate-100 bg-white px-4 py-3.5 shadow-[0_8px_30px_rgba(0,0,0,0.10)]">
      <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-emerald-50 text-emerald-600">
        <Check size={17} strokeWidth={2.5} />
      </div>
      <div className="flex-1 min-w-0">
        <p className="text-sm font-semibold text-slate-900 leading-snug">{data.student.name} booked</p>
        <p className="text-[11px] text-slate-400 truncate mt-0.5">{data.slot.dayName} · {data.topic} · {data.slot.tutor.name}{data.recurring ? ` · ${data.recurringWeeks} wk` : ''}</p>
      </div>
      <button onClick={onClose} className="shrink-0 text-slate-300 hover:text-slate-500 transition"><X size={15} /></button>
    </div>
  );
}