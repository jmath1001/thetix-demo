"use client"
import React, { useState, useMemo, useEffect } from 'react';
import { Check, ChevronRight, Loader2, X, Calendar, Clock, User } from 'lucide-react';

// ─── Types ────────────────────────────────────────────────────────────────────

type Step = 'info' | 'slot' | 'confirm' | 'done';

type Slot = {
  tutorId: string;
  tutorName: string;
  date: string;       // YYYY-MM-DD
  dayName: string;
  time: string;       // HH:MM
  sessionId?: string; // existing session id if any
  blockLabel: string; // 'Session 1'
  blockDisplay: string; // '3:30 – 5:20 PM'
  seatsLeft: number;
};

// ─── Helpers ──────────────────────────────────────────────────────────────────

function getWeekStart(d: Date): Date {
  const date = new Date(d);
  const day = date.getDay();
  const diff = day === 0 ? -6 : 1 - day;
  date.setDate(date.getDate() + diff);
  date.setHours(0, 0, 0, 0);
  return date;
}

function toISODate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

const ACTIVE_DAYS = [1, 2, 3, 4, 6];
const DAY_NAMES = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Saturday'];

const SESSION_BLOCKS = [
  { id: 'S1', label: 'Session 1', time: '13:30', display: '1:30 – 3:20 PM', days: [1,2,3,4] },
  { id: 'S2', label: 'Session 2', time: '15:30', display: '3:30 – 5:20 PM', days: [1,2,3,4] },
  { id: 'S3', label: 'Session 3', time: '17:30', display: '5:30 – 7:20 PM', days: [1,2,3,4] },
  { id: 'S4', label: 'Session 4', time: '19:30', display: '7:30 – 9:20 PM', days: [1,2,3,4] },
  { id: 'S5', label: 'Session 1', time: '09:00', display: '9:00 – 10:50 AM', days: [6] },
  { id: 'S6', label: 'Session 2', time: '11:00', display: '11:00 AM – 12:50 PM', days: [6] },
  { id: 'S7', label: 'Session 3', time: '13:30', display: '1:30 – 3:20 PM', days: [6] },
  { id: 'S8', label: 'Session 4', time: '15:30', display: '3:30 – 5:20 PM', days: [6] },
];

const MAX_CAPACITY = 3;

// ─── Step Indicator ───────────────────────────────────────────────────────────

function StepDots({ step }: { step: Step }) {
  const steps: Step[] = ['info', 'slot', 'confirm'];
  return (
    <div className="flex items-center gap-2 justify-center mb-8">
      {steps.map((s, i) => {
        const idx = steps.indexOf(step);
        const done = i < idx;
        const active = s === step;
        return (
          <React.Fragment key={s}>
            <div className={`w-8 h-8 rounded-full flex items-center justify-center text-xs font-bold transition-all ${
              done ? 'bg-[#6d28d9] text-white' : active ? 'bg-[#6d28d9] text-white ring-4 ring-[#ede9fe]' : 'bg-[#f0ece8] text-[#a8a29e]'
            }`}>
              {done ? <Check size={14} strokeWidth={3} /> : i + 1}
            </div>
            {i < steps.length - 1 && <div className={`h-0.5 w-8 rounded-full ${i < idx ? 'bg-[#6d28d9]' : 'bg-[#f0ece8]'}`} />}
          </React.Fragment>
        );
      })}
    </div>
  );
}

// ─── Main Page ────────────────────────────────────────────────────────────────

export default function BookingPage() {
  const [step, setStep] = useState<Step>('info');
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [subject, setSubject] = useState('');
  const [selectedSlot, setSelectedSlot] = useState<Slot | null>(null);
  const [slots, setSlots] = useState<Slot[]>([]);
  const [loadingSlots, setLoadingSlots] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');

  // Load available slots when moving to slot step
  useEffect(() => {
    if (step !== 'slot') return;
    setLoadingSlots(true);
    fetch('/api/available-slots')
      .then(r => r.json())
      .then(data => { setSlots(data.slots || []); setLoadingSlots(false); })
      .catch(() => { setError('Failed to load slots'); setLoadingSlots(false); });
  }, [step]);

  const slotsByDay = useMemo(() => {
    const groups: Record<string, Slot[]> = {};
    slots.forEach(slot => {
      if (!groups[slot.dayName]) groups[slot.dayName] = [];
      groups[slot.dayName].push(slot);
    });
    return groups;
  }, [slots]);

  const handleInfoSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim() || !email.trim()) return;
    setStep('slot');
  };

  const handleBook = async () => {
    if (!selectedSlot) return;
    setSubmitting(true);
    setError('');
    try {
      const res = await fetch('/api/book', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, email, phone, subject, slot: selectedSlot }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Booking failed');
      setStep('done');
    } catch (err: any) {
      setError(err.message);
    } finally {
      setSubmitting(false);
    }
  };

  // ── DONE ──
  if (step === 'done') {
    return (
      <div className="min-h-screen bg-[#faf9f7] flex items-center justify-center p-6">
        <div className="w-full max-w-md text-center">
          <div className="w-20 h-20 rounded-full bg-[#d1fae5] flex items-center justify-center mx-auto mb-6">
            <Check size={36} className="text-[#059669]" strokeWidth={3} />
          </div>
          <h1 className="text-2xl font-black text-[#1c1917] mb-2">You're booked!</h1>
          <p className="text-sm text-[#78716c] mb-2">A confirmation has been sent to <strong>{email}</strong>.</p>
          <p className="text-xs text-[#a8a29e]">Check your inbox for session details and a cancellation link.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#faf9f7] py-12 px-4">
      <div className="w-full max-w-2xl mx-auto">

        {/* Header */}
        <div className="text-center mb-10">
          <h1 className="text-3xl font-black text-[#1c1917] tracking-tight mb-1">Book a Session</h1>
          <p className="text-sm text-[#78716c]">Find an available tutor and reserve your spot</p>
        </div>

        <StepDots step={step} />

        {error && (
          <div className="mb-6 p-4 rounded-xl bg-red-50 border border-red-200 text-red-700 text-sm flex items-center gap-2">
            <X size={16} /> {error}
          </div>
        )}

        {/* ── STEP 1: INFO ── */}
        {step === 'info' && (
          <div className="bg-white rounded-2xl border border-[#e7e3dd] shadow-sm p-8">
            <h2 className="text-lg font-bold text-[#1c1917] mb-1">Your Information</h2>
            <p className="text-xs text-[#a8a29e] mb-6">We'll use this to confirm your booking</p>
            <form onSubmit={handleInfoSubmit} className="space-y-4">
              <div>
                <label className="text-[10px] font-bold text-[#a8a29e] uppercase tracking-widest block mb-1.5">Full Name *</label>
                <input required value={name} onChange={e => setName(e.target.value)}
                  className="w-full px-4 py-3 rounded-xl border border-[#e7e3dd] text-sm focus:border-[#6d28d9] focus:ring-2 focus:ring-[#ede9fe] outline-none transition-all"
                  placeholder="e.g. Alex Johnson" />
              </div>
              <div>
                <label className="text-[10px] font-bold text-[#a8a29e] uppercase tracking-widest block mb-1.5">Email *</label>
                <input required type="email" value={email} onChange={e => setEmail(e.target.value)}
                  className="w-full px-4 py-3 rounded-xl border border-[#e7e3dd] text-sm focus:border-[#6d28d9] focus:ring-2 focus:ring-[#ede9fe] outline-none transition-all"
                  placeholder="you@example.com" />
              </div>
              <div>
                <label className="text-[10px] font-bold text-[#a8a29e] uppercase tracking-widest block mb-1.5">Phone <span className="normal-case font-normal">(optional)</span></label>
                <input type="tel" value={phone} onChange={e => setPhone(e.target.value)}
                  className="w-full px-4 py-3 rounded-xl border border-[#e7e3dd] text-sm focus:border-[#6d28d9] focus:ring-2 focus:ring-[#ede9fe] outline-none transition-all"
                  placeholder="(555) 000-0000" />
              </div>
              <div>
                <label className="text-[10px] font-bold text-[#a8a29e] uppercase tracking-widest block mb-1.5">Subject / What you need help with <span className="normal-case font-normal">(optional)</span></label>
                <input value={subject} onChange={e => setSubject(e.target.value)}
                  className="w-full px-4 py-3 rounded-xl border border-[#e7e3dd] text-sm focus:border-[#6d28d9] focus:ring-2 focus:ring-[#ede9fe] outline-none transition-all"
                  placeholder="e.g. Algebra, SAT Prep" />
              </div>
              <button type="submit"
                className="w-full py-4 rounded-xl bg-[#6d28d9] text-white font-black text-sm uppercase tracking-widest hover:bg-[#5b21b6] transition-all active:scale-[0.98] flex items-center justify-center gap-2 mt-2">
                Find Available Sessions <ChevronRight size={16} />
              </button>
            </form>
          </div>
        )}

        {/* ── STEP 2: SLOT PICKER ── */}
        {step === 'slot' && (
          <div className="bg-white rounded-2xl border border-[#e7e3dd] shadow-sm p-8">
            <div className="flex items-center justify-between mb-6">
              <div>
                <h2 className="text-lg font-bold text-[#1c1917] mb-1">Pick a Session</h2>
                <p className="text-xs text-[#a8a29e]">Showing available slots for this week</p>
              </div>
              <button onClick={() => setStep('info')} className="text-xs text-[#a8a29e] hover:text-[#6d28d9] underline underline-offset-2">← Back</button>
            </div>

            {loadingSlots ? (
              <div className="py-20 flex flex-col items-center gap-3 text-[#a8a29e]">
                <Loader2 size={28} className="animate-spin" />
                <p className="text-xs">Loading available sessions…</p>
              </div>
            ) : slots.length === 0 ? (
              <div className="py-20 text-center">
                <p className="text-sm text-[#a8a29e] italic">No available sessions this week. Please check back later.</p>
              </div>
            ) : (
              <div className="space-y-8">
                {Object.entries(slotsByDay).map(([day, daySlots]) => (
                  <div key={day}>
                    <div className="flex items-center gap-3 mb-3">
                      <div className="px-3 py-1 rounded-full bg-[#1c1917] text-white text-[10px] font-black uppercase tracking-widest">{day}</div>
                      <div className="h-px flex-1 bg-[#f0ece8]" />
                    </div>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                      {daySlots.map((slot, idx) => {
                        const isSelected = selectedSlot?.tutorId === slot.tutorId && selectedSlot?.date === slot.date && selectedSlot?.time === slot.time;
                        return (
                          <button key={idx} onClick={() => setSelectedSlot(slot)}
                            className={`p-4 rounded-xl border-2 text-left transition-all relative ${isSelected ? 'border-[#6d28d9] bg-[#faf9ff] shadow-lg shadow-violet-100' : 'border-[#f0ece8] hover:border-[#c4b5fd]'}`}>
                            <div className="flex items-center gap-2 mb-1">
                              <Clock size={12} className={isSelected ? 'text-[#6d28d9]' : 'text-[#a8a29e]'} />
                              <span className={`text-sm font-bold ${isSelected ? 'text-[#6d28d9]' : 'text-[#1c1917]'}`}>{slot.blockLabel}</span>
                            </div>
                            <p className="text-[10px] text-[#a8a29e] mb-2">{slot.blockDisplay}</p>
                            <div className="flex items-center gap-1.5">
                              <User size={10} className="text-[#a8a29e]" />
                              <p className="text-xs font-bold text-[#1c1917]">{slot.tutorName}</p>
                            </div>
                            {slot.seatsLeft < 3 && (
                              <p className="text-[9px] font-bold mt-1.5" style={{ color: '#c27d38' }}>{slot.seatsLeft} seat{slot.seatsLeft !== 1 ? 's' : ''} left</p>
                            )}
                            {isSelected && <div className="absolute top-3 right-3"><Check size={16} className="text-[#6d28d9]" strokeWidth={3} /></div>}
                          </button>
                        );
                      })}
                    </div>
                  </div>
                ))}
              </div>
            )}

            {selectedSlot && (
              <button onClick={() => setStep('confirm')}
                className="w-full mt-8 py-4 rounded-xl bg-[#6d28d9] text-white font-black text-sm uppercase tracking-widest hover:bg-[#5b21b6] transition-all active:scale-[0.98] flex items-center justify-center gap-2">
                Continue <ChevronRight size={16} />
              </button>
            )}
          </div>
        )}

        {/* ── STEP 3: CONFIRM ── */}
        {step === 'confirm' && selectedSlot && (
          <div className="bg-white rounded-2xl border border-[#e7e3dd] shadow-sm p-8">
            <div className="flex items-center justify-between mb-6">
              <h2 className="text-lg font-bold text-[#1c1917]">Confirm Booking</h2>
              <button onClick={() => setStep('slot')} className="text-xs text-[#a8a29e] hover:text-[#6d28d9] underline underline-offset-2">← Back</button>
            </div>

            <div className="space-y-4 mb-8">
              <div className="p-5 rounded-2xl bg-[#faf9ff] border-2 border-[#6d28d9]">
                <p className="text-[10px] font-black text-[#6d28d9] uppercase tracking-widest mb-3">Session Details</p>
                <div className="space-y-2">
                  <div className="flex items-center gap-2">
                    <Calendar size={14} className="text-[#6d28d9]" />
                    <span className="text-sm font-bold text-[#1c1917]">{selectedSlot.dayName} · {new Date(selectedSlot.date + 'T00:00:00').toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })}</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <Clock size={14} className="text-[#6d28d9]" />
                    <span className="text-sm font-bold text-[#1c1917]">{selectedSlot.blockLabel} · {selectedSlot.blockDisplay}</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <User size={14} className="text-[#6d28d9]" />
                    <span className="text-sm font-bold text-[#1c1917]">{selectedSlot.tutorName}</span>
                  </div>
                </div>
              </div>

              <div className="p-5 rounded-2xl bg-[#faf9f7] border border-[#e7e3dd]">
                <p className="text-[10px] font-black text-[#a8a29e] uppercase tracking-widest mb-3">Your Info</p>
                <p className="text-sm font-bold text-[#1c1917]">{name}</p>
                <p className="text-xs text-[#78716c]">{email}</p>
                {phone && <p className="text-xs text-[#78716c]">{phone}</p>}
                {subject && <p className="text-xs text-[#78716c] mt-1">Subject: {subject}</p>}
              </div>
            </div>

            <button onClick={handleBook} disabled={submitting}
              className="w-full py-4 rounded-xl bg-[#6d28d9] text-white font-black text-sm uppercase tracking-widest hover:bg-[#5b21b6] transition-all active:scale-[0.98] flex items-center justify-center gap-2 disabled:opacity-60 disabled:cursor-not-allowed">
              {submitting ? <><Loader2 size={16} className="animate-spin" /> Booking…</> : <><Check size={16} strokeWidth={3} /> Confirm Booking</>}
            </button>
            <p className="text-center text-[10px] text-[#a8a29e] mt-3">A confirmation email will be sent to {email}</p>
          </div>
        )}
      </div>
    </div>
  );
}