'use client'
import { useState, useEffect, useRef, useCallback } from 'react'
import { X, Loader2, Sparkles, CornerDownLeft, Clock, Calendar, ChevronRight, CheckCircle2, AlertCircle } from 'lucide-react'
import { toISODate } from '@/lib/useScheduleData'

interface CommandBarProps {
  sessions: any[]
  students: any[]
  tutors: any[]
  allAvailableSeats: any[]
  onBookingAction: (params: {
    studentId: string
    slotDate: string
    slotTime: string
    tutorId: string
    topic: string
  }) => void
}

type Result =
  | { type: 'answer'; text: string }
  | { type: 'list'; title: string; items: string[] }
  | { type: 'slots'; slotIndices: number[]; reason: string }
  | { type: 'action'; action: string; studentId: string; slotDate: string; slotTime: string; tutorId: string; topic: string }
  | { type: 'error'; text: string }

const SUGGESTIONS = [
  'Optimize schedule for Sarah Miller (SAT)',
  'Auto-assign open Math slots for tomorrow',
  'Who is over-scheduled this week?',
  'Find best-fit tutor for Chemistry',
]

export function CommandBar({ sessions, students, tutors, allAvailableSeats, onBookingAction }: CommandBarProps) {
  const [query, setQuery] = useState('')
  const [loading, setLoading] = useState(false)
  const [result, setResult] = useState<Result | null>(null)
  const [isFocused, setIsFocused] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
        e.preventDefault()
        inputRef.current?.focus()
      }
      if (e.key === 'Escape') {
        inputRef.current?.blur()
        setResult(null)
        setIsFocused(false)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  const buildContext = useCallback(() => {
    const today = toISODate(new Date())
    const compactSessions = sessions.map(s => ({
      id: s.id,
      date: s.date,
      tutorId: s.tutorId,
      tutorName: tutors.find(t => t.id === s.tutorId)?.name ?? 'Unknown',
      time: s.time,
      students: s.students.map((st: any) => ({
        id: st.id,
        name: st.name,
        topic: st.topic,
        status: st.status,
        confirmationStatus: st.confirmationStatus,
      })),
    }))

    return {
      today,
      pastSessions: compactSessions.filter(s => s.date < today),
      upcomingSessions: compactSessions.filter(s => s.date >= today),
      availableSeats: allAvailableSeats.map(s => ({
        tutor: { name: s.tutor.name, subjects: s.tutor.subjects, id: s.tutor.id },
        dayName: s.dayName,
        date: s.date,
        time: s.time,
        seatsLeft: s.seatsLeft,
        block: s.block,
      })),
      students: students.map(s => ({
        id: s.id,
        name: s.name,
        subject: s.subject,
        grade: s.grade,
        hoursLeft: s.hoursLeft,
        parent_name: s.parent_name,
        parent_phone: s.parent_phone,
      })),
    }
  }, [sessions, students, tutors, allAvailableSeats])

  const runQuery = useCallback(async (q: string) => {
    if (!q.trim()) return
    setLoading(true)
    setResult(null)
    try {
      const res = await fetch('/api/command', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ query: q, context: buildContext() }),
      })
      const data: Result = await res.json()
      setResult(data)
      if (data.type === 'action' && data.action === 'open_booking') {
        setTimeout(() => {
          onBookingAction({ studentId: data.studentId, slotDate: data.slotDate, slotTime: data.slotTime, tutorId: data.tutorId, topic: data.topic })
          setResult(null)
          setQuery('')
        }, 800)
      }
    } catch {
      setResult({ type: 'error', text: 'Optimization engine unreachable. Check network.' })
    } finally {
      setLoading(false)
    }
  }, [buildContext, onBookingAction])

  const handleSlotClick = (slot: any) => {
    setResult(null)
    setQuery('')
    onBookingAction({ studentId: '', slotDate: slot.date, slotTime: slot.time, tutorId: slot.tutor.id, topic: '' })
  }

  const matchedSlots = result?.type === 'slots'
    ? (result.slotIndices ?? []).map((i: number) => allAvailableSeats[i]).filter(Boolean)
    : []

  const showDropdown = result || loading || (isFocused && !query);

  return (
    <div style={{ position: 'relative', width: '100%', maxWidth: '550px' }}>
      {/* Search Input Bar - Graphite Theme */}
      <div 
        style={{ 
          display: 'flex', 
          alignItems: 'center', 
          gap: 10, 
          padding: '0 14px', 
          height: '36px',
          background: isFocused ? '#ffffff' : '#f8fafc', 
          borderRadius: '10px', 
          border: isFocused ? '1.5px solid #6366f1' : '1.5px solid #e2e8f0',
          transition: 'all 0.2s cubic-bezier(0.4, 0, 0.2, 1)',
          boxShadow: isFocused ? '0 0 0 3px rgba(99, 102, 241, 0.1)' : 'none'
        }}
      >
        <Sparkles 
          size={16} 
          style={{ color: loading ? '#6366f1' : '#94a3b8', animation: loading ? 'pulse 2s infinite' : 'none' }} 
        />
        <input
          ref={inputRef}
          value={query}
          onFocus={() => setIsFocused(true)}
          onBlur={() => setTimeout(() => setIsFocused(false), 200)}
          onChange={e => setQuery(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter') runQuery(query) }}
          placeholder="Command schedule or auto-assign..."
          style={{ 
            flex: 1, 
            fontSize: '13px', 
            border: 'none', 
            outline: 'none', 
            background: 'transparent', 
            color: '#1e293b',
            fontWeight: 500
          }}
        />
        {!query && (
          <kbd style={{ fontSize: '10px', padding: '2px 5px', borderRadius: '4px', background: '#f1f5f9', color: '#64748b', border: '1px solid #e2e8f0', fontWeight: 600 }}>
            ⌘K
          </kbd>
        )}
        {query && !loading && (
           <div 
             onClick={() => runQuery(query)}
             style={{ cursor: 'pointer', display: 'flex', alignItems: 'center', color: '#6366f1', fontWeight: 700, fontSize: '11px', gap: 4 }}
           >
             RUN <CornerDownLeft size={12} />
           </div>
        )}
        {loading && <Loader2 size={14} className="animate-spin" style={{ color: '#6366f1' }} />}
      </div>

      {/* Floating Results Panel - Floating Overlay */}
      {showDropdown && (
        <div 
          style={{ 
            position: 'fixed',
            top: '118px', 
            left: '50%',
            transform: 'translateX(-50%)',
            width: '95%',
            maxWidth: '850px',
            background: 'white',
            borderRadius: '16px',
            border: '1px solid #e2e8f0',
            boxShadow: '0 25px 50px -12px rgba(0, 0, 0, 0.15), 0 0 0 1px rgba(0,0,0,0.02)',
            zIndex: 1000,
            overflow: 'hidden',
            maxHeight: 'calc(100vh - 160px)',
            display: 'flex',
            flexDirection: 'column'
          }}
        >
          <div style={{ overflowY: 'auto', flex: 1 }}>
            {/* Quick Actions / Intent Detection */}
            {isFocused && !query && !result && !loading && (
              <div style={{ padding: '20px' }}>
                <p style={{ fontSize: '11px', fontWeight: 700, color: '#94a3b8', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: '14px' }}>Smart Scheduling Actions</p>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px' }}>
                  {SUGGESTIONS.map(s => (
                    <button key={s} onClick={() => { setQuery(s); runQuery(s) }}
                      style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '12px 16px', borderRadius: '12px', background: '#f8fafc', border: '1px solid #f1f5f9', textAlign: 'left', cursor: 'pointer', transition: 'all 0.2s' }}
                      onMouseEnter={e => { e.currentTarget.style.borderColor = '#6366f1'; e.currentTarget.style.background = '#f5f3ff' }}
                      onMouseLeave={e => { e.currentTarget.style.borderColor = '#f1f5f9'; e.currentTarget.style.background = '#f8fafc' }}>
                      <span style={{ fontSize: '13px', color: '#334155', fontWeight: 600 }}>{s}</span>
                      <ChevronRight size={14} style={{ color: '#cbd5e1' }} />
                    </button>
                  ))}
                </div>
              </div>
            )}

            {/* Answer Content */}
            {result?.type === 'answer' && (
              <div style={{ padding: '28px', fontSize: '15px', color: '#334155', lineHeight: '1.6' }}>
                <div style={{ display: 'flex', gap: 12 }}>
                  <CheckCircle2 size={20} style={{ color: '#10b981', flexShrink: 0 }} />
                  {result.text}
                </div>
              </div>
            )}

            {/* Optimized Slots Grid */}
            {result?.type === 'slots' && (
              <div style={{ padding: '24px' }}>
                <div style={{ marginBottom: '20px', display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end' }}>
                  <div>
                    <h3 style={{ fontSize: '16px', fontWeight: 800, color: '#0f172a', margin: 0 }}>Optimization Match Found</h3>
                    <p style={{ fontSize: '13px', color: '#64748b', marginTop: 4 }}>{result.reason}</p>
                  </div>
                  <div style={{ fontSize: '11px', fontWeight: 700, color: '#6366f1', background: '#eef2ff', padding: '4px 10px', borderRadius: '20px' }}>
                    {matchedSlots.length} Suggestions
                  </div>
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(250px, 1fr))', gap: '14px' }}>
                  {matchedSlots.map((slot: any, i: number) => (
                    <button
                      key={i}
                      onClick={() => handleSlotClick(slot)}
                      style={{ textAlign: 'left', padding: '16px', borderRadius: '14px', border: '1px solid #e2e8f0', background: 'white', cursor: 'pointer', transition: 'all 0.2s' }}
                      onMouseEnter={e => { e.currentTarget.style.borderColor = '#6366f1'; e.currentTarget.style.boxShadow = '0 10px 15px -3px rgba(0, 0, 0, 0.05)' }}
                      onMouseLeave={e => { e.currentTarget.style.borderColor = '#e2e8f0'; e.currentTarget.style.boxShadow = 'none' }}
                    >
                      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '12px' }}>
                        <span style={{ fontSize: '12px', fontWeight: 700, color: '#4338ca', background: '#eef2ff', padding: '3px 8px', borderRadius: '6px' }}>
                          <Clock size={12} style={{ display: 'inline', marginRight: 4, verticalAlign: 'middle' }} />
                          {slot.block?.label ?? slot.time}
                        </span>
                        <div style={{ display: 'flex', gap: 2 }}>
                          {[...Array(3)].map((_, idx) => (
                            <div key={idx} style={{ width: 4, height: 12, borderRadius: 2, background: idx < (3 - slot.seatsLeft) ? '#cbd5e1' : '#6366f1' }} />
                          ))}
                        </div>
                      </div>
                      <div style={{ fontWeight: 700, fontSize: '14px', color: '#1e293b' }}>{slot.tutor.name}</div>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: '11px', color: '#64748b', marginTop: 6 }}>
                        <Calendar size={12} /> {slot.dayName} • {slot.date}
                      </div>
                    </button>
                  ))}
                </div>
              </div>
            )}

            {/* Error Message */}
            {result?.type === 'error' && (
              <div style={{ padding: '24px', display: 'flex', gap: 12, alignItems: 'center', color: '#ef4444' }}>
                <AlertCircle size={20} />
                <span style={{ fontSize: '14px', fontWeight: 600 }}>{result.text}</span>
              </div>
            )}

            {/* AI Action Overlay */}
            {result?.type === 'action' && (
              <div style={{ padding: '50px 24px', textAlign: 'center' }}>
                <div style={{ position: 'relative', width: '40px', height: '40px', margin: '0 auto 16px' }}>
                   <Loader2 size={40} className="animate-spin" style={{ color: '#6366f1' }} />
                   <div style={{ position: 'absolute', top: '50%', left: '50%', transform: 'translate(-50%, -50%)', width: '20px', height: '20px', background: '#6366f1', borderRadius: '50%', opacity: 0.2 }} />
                </div>
                <p style={{ fontWeight: 700, color: '#0f172a', fontSize: '15px' }}>Applying Constraint-Based Optimization...</p>
                <p style={{ fontSize: '13px', color: '#64748b', marginTop: 4 }}>Validating tutor subjects and student hours...</p>
              </div>
            )}
          </div>

          {/* Indigo Footer Controls */}
          {result && (
            <div style={{ padding: '12px 24px', borderTop: '1px solid #f1f5f9', background: '#f8fafc', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <button 
                onClick={() => { setResult(null); setQuery(''); inputRef.current?.focus() }}
                style={{ background: 'none', border: 'none', color: '#6366f1', fontSize: '11px', cursor: 'pointer', fontWeight: 700, display: 'flex', alignItems: 'center', gap: 4 }}
              >
                ← NEW SEARCH
              </button>
              <div style={{ display: 'flex', gap: '16px', fontSize: '10px', color: '#94a3b8', fontWeight: 700, textTransform: 'uppercase' }}>
                <span>ESC to Close</span>
                <span>Enter to Recalculate</span>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  )
}