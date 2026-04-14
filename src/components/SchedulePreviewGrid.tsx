'use client'
import { useState } from 'react'
import { AlertTriangle, ArrowRight, Sparkles, X } from 'lucide-react'
import { getSessionsForDay } from '@/components/constants'
import { dayOfWeek } from '@/lib/useScheduleData'

interface AvailableSeat {
  tutor: { id: string; name: string; subjects: string[]; cat: string }
  dayName: string
  date: string
  time: string
  seatsLeft: number
  block?: { label: string; display: string }
  dayNum: number
}

type ProposalStatus = 'matched' | 'fallback' | 'unmatched'

interface Proposal {
  needId: string
  student: { id: string; name: string; grade?: string | null; availabilityBlocks?: string[] }
  subject: string
  slot: AvailableSeat | null
  status: ProposalStatus
  reason: string
}

interface MoveStep {
  type: 'place' | 'move'
  studentName: string
  subject: string
  fromSlot?: { dayName: string; label: string; tutorName: string }
  toSlot: { dayName: string; label: string; tutorName: string }
}

interface SuggestionOption {
  title: string
  detail: string
  steps: string[]
  moves?: MoveStep[]
  explanation?: {
    scoringFactors: Array<{ label: string; value: string; impact: 'positive' | 'negative' | 'neutral' }>
    constraintsChecked: Array<{ name: string; status: 'pass' | 'fail'; detail: string }>
    alternatives: Array<{ label: string; reason: string }>
    confidence: { level: 'high' | 'medium' | 'low'; reason: string }
  }
}

interface ExistingEntry {
  studentName: string
  topic: string
  status: string
  seriesId?: string | null
}

interface ExistingSession {
  date: string
  tutorId: string
  time: string
  students: ExistingEntry[]
}

interface SchedulePreviewGridProps {
  proposals: Proposal[]
  suggestionsByNeed?: Record<string, SuggestionOption[]>
  allAvailableSeats: AvailableSeat[]
  existingSessions: ExistingSession[]
  onSwap: (needId: string, slotIndex: number) => { success: boolean; reason?: string }
  onRemove: (needId: string) => void
}

function SlotChip({ dayName, label, tutorName, variant }: { dayName: string; label: string; tutorName: string; variant: 'from' | 'to' }) {
  const isFrom = variant === 'from'
  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-start', gap: 1 }}>
      <span style={{
        fontSize: 10, fontWeight: 800, padding: '2px 7px', borderRadius: 6, whiteSpace: 'nowrap',
        background: isFrom ? '#fee2e2' : '#dbeafe',
        color: isFrom ? '#b91c1c' : '#1d4ed8',
        border: `1px solid ${isFrom ? '#fca5a5' : '#93c5fd'}`,
      }}>
        {dayName} · {label}
      </span>
      <span style={{ fontSize: 9, color: '#64748b', fontWeight: 600, paddingLeft: 4 }}>{tutorName}</span>
    </div>
  )
}

const TUTOR_PALETTES = [
  { bg: '#eff6ff', border: '#bfdbfe', text: '#1e40af', initials: '#dbeafe' },
  { bg: '#fdf4ff', border: '#e9d5ff', text: '#6b21a8', initials: '#f3e8ff' },
  { bg: '#fff7ed', border: '#fed7aa', text: '#9a3412', initials: '#ffedd5' },
  { bg: '#f0fdf4', border: '#bbf7d0', text: '#166534', initials: '#dcfce7' },
  { bg: '#fff1f2', border: '#fecdd3', text: '#9f1239', initials: '#ffe4e6' },
  { bg: '#f0f9ff', border: '#bae6fd', text: '#075985', initials: '#e0f2fe' },
]

export function SchedulePreviewGrid({
  proposals, suggestionsByNeed, allAvailableSeats, existingSessions, onSwap, onRemove,
}: SchedulePreviewGridProps) {
  const [swapOpen, setSwapOpen] = useState<string | null>(null)
  const [expandedExplanation, setExpandedExplanation] = useState<string | null>(null)

  const placedProposals = proposals.filter(p => p.slot)
  const unmatchedProposals = proposals.filter(p => !p.slot)

  const allDates = Array.from(new Set([
    ...placedProposals.map(p => p.slot!.date),
    ...existingSessions.filter(s => s.students.length > 0).map(s => s.date),
  ])).sort()

  const tutorMap: Record<string, AvailableSeat['tutor']> = {}
  for (const s of allAvailableSeats) tutorMap[s.tutor.id] = s.tutor
  for (const p of placedProposals) tutorMap[p.slot!.tutor.id] = p.slot!.tutor

  const dayNameMap: Record<string, string> = {}
  for (const s of allAvailableSeats) dayNameMap[s.date] = s.dayName
  for (const p of placedProposals) dayNameMap[p.slot!.date] = p.slot!.dayName

  const allTutorIds = Array.from(new Set(Object.keys(tutorMap)))
  const tutorColorMap: Record<string, typeof TUTOR_PALETTES[0]> = {}
  allTutorIds.forEach((id, i) => { tutorColorMap[id] = TUTOR_PALETTES[i % TUTOR_PALETTES.length] })

  const getTutorsForDay = (date: string) => {
    const ids = new Set<string>()
    placedProposals.forEach(p => { if (p.slot!.date === date) ids.add(p.slot!.tutor.id) })
    existingSessions.forEach(s => { if (s.date === date && s.students.length > 0) ids.add(s.tutorId) })
    return Array.from(ids)
  }

  const getTimesForDay = (date: string) => {
    // Use the canonical session blocks for each day.
    return getSessionsForDay(dayOfWeek(date)).map(s => s.time)
  }

  const getProposalsAt = (tutorId: string, date: string, time: string) =>
    placedProposals.filter(p => p.slot!.tutor.id === tutorId && p.slot!.date === date && p.slot!.time === time)

  const getExistingAt = (tutorId: string, date: string, time: string) =>
    existingSessions
      .filter(s => s.tutorId === tutorId && s.date === date && s.time === time)
      .flatMap(s => s.students)

  const hasSeatAt = (tutorId: string, date: string, time: string) =>
    allAvailableSeats.some(s => s.tutor.id === tutorId && s.date === date && s.time === time)

  const getSwapOptions = (p: Proposal) => {
    // Check which times this student is already booked (in existing sessions or other proposals)
    const studentBookedTimes = new Set<string>()
    existingSessions.forEach(s => {
      if (s.students.some(st => st.studentName === p.student.name)) {
        studentBookedTimes.add(`${s.date}-${s.time}`)
      }
    })
    placedProposals.forEach(proposal => {
      if (proposal.student.id === p.student.id && proposal.slot) {
        studentBookedTimes.add(`${proposal.slot.date}-${proposal.slot.time}`)
      }
    })

    return allAvailableSeats
      .map((s, i) => ({ seat: s, index: i }))
      .filter(({ seat }) => {
        // 1. Subject match
        const sub = p.subject.toLowerCase().trim()
        const subjectMatch = seat.tutor.subjects.some(ts => {
          const t = ts.toLowerCase().trim()
          return t === sub || t.includes(sub) || sub.includes(t)
        })
        if (!subjectMatch) return false

        // 2. Has actual capacity
        if (seat.seatsLeft <= 0) return false

        // 3. Student availability
        if (p.student.availabilityBlocks?.length) {
          const key = `${seat.dayNum}-${seat.time}`
          if (!p.student.availabilityBlocks.includes(key)) return false
        }

        // 4. Student not already booked at this time
        if (studentBookedTimes.has(`${seat.date}-${seat.time}`)) return false

        // 5. Not the current slot
        return !(seat.tutor.id === p.slot?.tutor.id && seat.date === p.slot?.date && seat.time === p.slot?.time)
      })
      .slice(0, 14)
  }

  if (allDates.length === 0 && unmatchedProposals.length === 0) {
    return <div style={{ padding: 40, textAlign: 'center', color: '#475569', fontSize: 13 }}>No proposals to preview</div>
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 28 }}>
      {allDates.map(date => {
        const dayName = dayNameMap[date] ?? date
        const dateLabel = new Date(date + 'T00:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
        const tutorIds = getTutorsForDay(date)
        const sessionBlocks = getSessionsForDay(dayOfWeek(date))
        const sessionByTime = Object.fromEntries(sessionBlocks.map(s => [s.time, s])) as Record<string, { label: string; display: string }>
        const times = getTimesForDay(date)
        if (tutorIds.length === 0) return null

        return (
          <div key={date}>
            {/* Day header — identical to WeekView */}
            <div style={{ display: 'flex', alignItems: 'baseline', gap: 12, marginBottom: 12, paddingLeft: 2 }}>
              <h3 style={{ fontSize: 32, fontWeight: 800, color: '#1f2937', fontFamily: 'ui-serif, Georgia, serif', margin: 0, lineHeight: 1 }}>
                {dayName}
              </h3>
              <span style={{ fontSize: 16, fontWeight: 600, color: '#6b7280' }}>{dateLabel}</span>
              <div style={{ flex: 1, height: 1, background: 'linear-gradient(90deg,#e5e7eb,transparent)', borderRadius: 999 }} />
            </div>

            {/* Table: tutors = rows (left), sessions = columns (top) */}
            <div style={{ borderRadius: 12, overflow: 'hidden', border: '2px solid #94a3b8', background: 'white', boxShadow: '0 1px 8px rgba(0,0,0,0.06)' }}>
              <div style={{ overflowX: 'auto' }}>
                <table style={{ width: '100%', borderCollapse: 'separate', borderSpacing: 0, minWidth: times.length * 210 + 170 }}>
                  <thead>
                    <tr style={{ background: '#1f2937', borderBottom: '1px solid #111827' }}>
                      {/* Sticky instructor column header */}
                      <th style={{
                        padding: '9px 14px', textAlign: 'left',
                        fontSize: 10, fontWeight: 700, color: 'rgba(255,255,255,0.72)',
                        textTransform: 'uppercase', letterSpacing: '0.08em',
                        borderRight: '1px solid rgba(255,255,255,0.08)',
                        width: 1, whiteSpace: 'nowrap',
                        position: 'sticky', left: 0, top: 0, zIndex: 4, background: '#1f2937',
                      }}>
                        Instructor
                      </th>
                      {/* Session column headers */}
                      {times.map(time => (
                        <th key={time} style={{
                          padding: '9px 16px', textAlign: 'center',
                          borderRight: '1px solid rgba(255,255,255,0.08)',
                          minWidth: 210,
                          position: 'sticky', top: 0, zIndex: 3, background: '#1f2937',
                        }}>
                          <div style={{ fontSize: 13, fontWeight: 800, color: 'rgba(255,255,255,0.92)', textTransform: 'uppercase', letterSpacing: '0.04em' }}>
                            {sessionByTime[time]?.label ?? time}
                          </div>
                          <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.72)', marginTop: 2, fontWeight: 600 }}>
                            {sessionByTime[time]?.display ?? time}
                          </div>
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {tutorIds.map((tutorId, rowIdx) => {
                      const tutor = tutorMap[tutorId]
                      const palette = tutorColorMap[tutorId]
                      if (!tutor) return null

                      return (
                        <tr key={tutorId} style={{ borderBottom: rowIdx < tutorIds.length - 1 ? '1px solid #e5e7eb' : 'none' }}>
                          {/* Tutor cell — sticky left, matches WeekView exactly */}
                          <td style={{
                            padding: '10px 12px', verticalAlign: 'middle',
                            background: '#e2e8f0',
                            borderRight: '1px solid #94a3b8',
                            borderBottom: '1px solid #cbd5e1',
                            position: 'sticky', left: 0, zIndex: 1,
                            width: 1, whiteSpace: 'nowrap',
                          }}>
                            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                              <div style={{
                                width: 26, height: 26, borderRadius: '50%', flexShrink: 0,
                                background: palette.initials, border: `1px solid ${palette.border}`,
                                display: 'flex', alignItems: 'center', justifyContent: 'center',
                                fontSize: 9, fontWeight: 800, color: palette.text,
                              }}>
                                {tutor.name.split(' ').map((n: string) => n[0]).join('').slice(0, 2).toUpperCase()}
                              </div>
                              <div>
                                <div style={{ fontSize: 12, fontWeight: 700, color: '#1f2937' }}>{tutor.name}</div>
                                <span style={{
                                  fontSize: 8, fontWeight: 700, padding: '1px 5px', borderRadius: 4,
                                  display: 'inline-block', marginTop: 2,
                                  background: tutor.cat === 'math' ? '#dbeafe' : '#fce7f3',
                                  color: tutor.cat === 'math' ? '#1d4ed8' : '#be185d',
                                }}>
                                  {tutor.cat === 'math' ? 'Math' : 'English'}
                                </span>
                              </div>
                            </div>
                          </td>

                          {/* Session cells */}
                          {times.map(time => {
                            const proposed = getProposalsAt(tutorId, date, time)
                            const existing = getExistingAt(tutorId, date, time)
                            const hasAnything = proposed.length > 0 || existing.length > 0
                            const availableNow = hasSeatAt(tutorId, date, time)

                            return (
                              <td key={time} style={{
                                padding: 8, verticalAlign: 'top',
                                borderRight: '1px solid #e5e7eb',
                                borderBottom: '1px solid #cbd5e1',
                                background: hasAnything
                                  ? '#f3f4f6'
                                  : availableNow
                                  ? '#ffffff'
                                  : 'repeating-linear-gradient(45deg,#eef1f5,#eef1f5 4px,#e3e7ec 4px,#e3e7ec 8px)',
                                minWidth: 210,
                              }}>
                                <div style={{ display: 'flex', flexDirection: 'column', gap: 5, minHeight: 80 }}>

                                  {!hasAnything && availableNow && (
                                    <div style={{
                                      marginTop: 4,
                                      alignSelf: 'flex-start',
                                      fontSize: 9,
                                      fontWeight: 700,
                                      textTransform: 'uppercase',
                                      letterSpacing: '0.08em',
                                      color: '#16a34a',
                                      background: '#f0fdf4',
                                      border: '1px solid #bbf7d0',
                                      borderRadius: 999,
                                      padding: '2px 7px',
                                    }}>
                                      Available
                                    </div>
                                  )}

                                  {/* Existing booked students — same card style as WeekView, slightly muted */}
                                  {existing.map((st, i) => (
                                    <div key={i} style={{
                                      padding: '6px 9px', borderRadius: 10,
                                      background: palette.bg,
                                      border: `1.5px solid ${palette.border}`,
                                      boxShadow: '0 1px 0 rgba(17,24,39,0.1)',
                                      opacity: 0.88,
                                    }}>
                                      <div style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
                                        <span style={{ fontSize: 12, fontWeight: 700, color: '#111827' }}>{st.studentName}</span>
                                        {st.seriesId && <span style={{ fontSize: 8, fontWeight: 800, padding: '1px 4px', borderRadius: 4, background: '#ede9fe', color: '#7c3aed' }}>↺</span>}
                                      </div>
                                      <div style={{ fontSize: 10, color: palette.text, marginTop: 2, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.04em' }}>{st.topic}</div>
                                    </div>
                                  ))}

                                  {/* Proposed new students — vivid, clearly "new" */}
                                  {proposed.map(p => {
                                    const isOpen = swapOpen === p.needId
                                    const swaps = getSwapOptions(p)
                                    const sc = p.status === 'fallback'
                                      ? { ring: '#d97706', bg: 'white', badgeBg: '#fef3c7', badgeText: '#92400e', label: 'Fallback' }
                                      : { ring: '#7c3aed', bg: 'white', badgeBg: '#ede9fe', badgeText: '#5b21b6', label: 'New' }

                                    return (
                                      <div key={p.needId} style={{
                                        padding: '8px 10px', borderRadius: 10,
                                        background: sc.bg,
                                        border: `2px solid ${sc.ring}`,
                                        boxShadow: `0 0 0 3px ${sc.ring}1a, 0 2px 6px rgba(0,0,0,0.1)`,
                                        position: 'relative',
                                      }}>
                                        <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 6 }}>
                                          <div style={{ flex: 1, minWidth: 0 }}>
                                            <div style={{ display: 'flex', alignItems: 'center', gap: 5, flexWrap: 'wrap', marginBottom: 2 }}>
                                              <span style={{ fontSize: 13, fontWeight: 800, color: '#0f172a' }}>{p.student.name}</span>
                                              <span style={{
                                                fontSize: 9, fontWeight: 700, padding: '1px 6px', borderRadius: 20,
                                                background: sc.badgeBg, color: sc.badgeText,
                                                display: 'inline-flex', alignItems: 'center', gap: 2,
                                              }}>
                                                <Sparkles size={7} />{sc.label}
                                              </span>
                                            </div>
                                            <div style={{ fontSize: 10, fontWeight: 700, color: '#1e293b' }}>{p.subject}</div>
                                            {p.student.grade && <div style={{ fontSize: 9, color: '#475569', marginTop: 1 }}>Gr. {p.student.grade}</div>}
                                          </div>

                                          {/* Actions */}
                                          <div style={{ display: 'flex', flexDirection: 'column', gap: 3, flexShrink: 0 }}>
                                            {swaps.length > 0 && (
                                              <div style={{ position: 'relative' }}>
                                                <button
                                                  onClick={() => setSwapOpen(isOpen ? null : p.needId)}
                                                  style={{
                                                    fontSize: 9, fontWeight: 700, padding: '3px 8px', borderRadius: 6,
                                                    border: `1.5px solid ${sc.ring}`, background: 'white', color: sc.ring,
                                                    cursor: 'pointer', whiteSpace: 'nowrap', display: 'block',
                                                  }}
                                                >
                                                  Swap ↓
                                                </button>
                                                {isOpen && (
                                                  <div style={{
                                                    position: 'absolute', right: 0, top: 'calc(100% + 4px)', zIndex: 50,
                                                    background: 'white', border: '1.5px solid #cbd5e1', borderRadius: 10,
                                                    boxShadow: '0 8px 28px rgba(0,0,0,0.15)', width: 230, maxWidth: 'calc(100vw - 56px)', maxHeight: 260, overflowY: 'auto',
                                                  }}>
                                                    <div style={{ padding: '8px 12px', borderBottom: '1px solid #e2e8f0', fontSize: 9, fontWeight: 800, color: '#475569', textTransform: 'uppercase', letterSpacing: '0.1em' }}>
                                                      Move to…
                                                    </div>
                                                    {swaps.map(({ seat, index }) => (
                                                      <button
                                                        key={index}
                                                        onClick={() => {
                                                          const result = onSwap(p.needId, index)
                                                          if (result.success) setSwapOpen(null)
                                                        }}
                                                        style={{
                                                          display: 'flex', width: '100%', textAlign: 'left', alignItems: 'center',
                                                          padding: '8px 12px', fontSize: 11, fontWeight: 600,
                                                          color: '#1e293b', background: 'white', border: 'none',
                                                          borderBottom: '1px solid #f8fafc', cursor: 'pointer', gap: 6,
                                                        }}
                                                        onMouseEnter={e => (e.currentTarget.style.background = '#f5f3ff')}
                                                        onMouseLeave={e => (e.currentTarget.style.background = 'white')}
                                                        title={`Move ${p.student.name} to ${seat.dayName} ${seat.block?.display ?? seat.time} with ${seat.tutor.name}`}
                                                      >
                                                        <span style={{ fontWeight: 700, color: '#0f172a' }}>{seat.dayName}</span>
                                                        <span style={{ color: '#cbd5e1' }}>·</span>
                                                        <span>{seat.block?.label ?? seat.time}</span>
                                                        <span style={{ color: '#cbd5e1' }}>·</span>
                                                        <span style={{ color: '#7c3aed', fontWeight: 700 }}>{seat.tutor.name}</span>
                                                        <span style={{ color: '#94a3b8', fontSize: 9, marginLeft: 'auto' }}>{seat.seatsLeft} left</span>
                                                      </button>
                                                    ))}
                                                  </div>
                                                )}
                                              </div>
                                            )}
                                            <button
                                              onClick={() => onRemove(p.needId)}
                                              style={{
                                                width: 22, height: 22, borderRadius: 5,
                                                border: '1.5px solid #fecdd3', background: '#fff1f2',
                                                cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#e11d48',
                                              }}
                                            >
                                              <X size={10} />
                                            </button>
                                          </div>
                                        </div>
                                      </div>
                                    )
                                  })}
                                </div>
                              </td>
                            )
                          })}
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        )
      })}

      {/* Unmatched */}
      {unmatchedProposals.length > 0 && (
        <div style={{ padding: '14px 16px', borderRadius: 12, border: '1.5px solid #fecdd3', background: '#fff1f2' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 }}>
            <AlertTriangle size={13} style={{ color: '#e11d48' }} />
            <span style={{ fontSize: 12, fontWeight: 700, color: '#9f1239' }}>Couldn't place — book these manually</span>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            {unmatchedProposals.map(p => (
              <div key={p.needId} style={{ padding: '10px 12px', borderRadius: 8, background: 'white', border: '1px solid #fecdd3' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                  <div style={{ flex: 1 }}>
                    <span style={{ fontSize: 13, fontWeight: 700, color: '#0f172a' }}>{p.student.name}</span>
                    <span style={{ fontSize: 11, color: '#94a3b8', marginLeft: 8 }}>{p.subject}</span>
                  </div>
                  <span style={{ fontSize: 11, color: '#e11d48' }}>{p.reason}</span>
                  <button onClick={() => onRemove(p.needId)} style={{ width: 22, height: 22, borderRadius: 5, border: '1px solid #fecdd3', background: 'white', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#e11d48', flexShrink: 0 }}>
                    <X size={10} />
                  </button>
                </div>

                {(suggestionsByNeed?.[p.needId]?.length ?? 0) > 0 && (
                  <div style={{ marginTop: 12, display: 'flex', flexDirection: 'column', gap: 8 }}>
                    <div style={{ fontSize: 10, fontWeight: 800, color: '#64748b', textTransform: 'uppercase', letterSpacing: '0.08em' }}>Suggestions</div>
                    {suggestionsByNeed?.[p.needId]?.map((opt, i) => {
                      const isDirectPlacement = opt.title.includes('Direct')
                      const isDoubleBooking   = opt.title.includes('double')
                      const accentColor = isDirectPlacement ? '#2563eb' : isDoubleBooking ? '#ea580c' : '#7c3aed'
                      const accentBg    = isDirectPlacement ? '#dbeafe'  : isDoubleBooking ? '#fff7ed'  : '#f5f3ff'
                      const accentBorder= isDirectPlacement ? '#bfdbfe'  : isDoubleBooking ? '#fed7aa'  : '#e9d5ff'

                      return (
                        <div key={`${p.needId}-opt-${i}`} style={{ border: `1.5px solid ${accentBorder}`, borderRadius: 10, background: accentBg, overflow: 'hidden' }}>
                          {/* Option header */}
                          <div style={{ padding: '7px 10px', borderBottom: `1px solid ${accentBorder}`, display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 6 }}>
                            <div style={{ display: 'flex', alignItems: 'center', gap: 6, flex: 1 }}>
                              <span style={{ fontSize: 9, fontWeight: 800, padding: '2px 7px', borderRadius: 20, background: accentColor, color: 'white' }}>
                                {isDirectPlacement ? 'DIRECT' : isDoubleBooking ? 'DOUBLE BOOKING' : 'REARRANGE'}
                              </span>
                              <span style={{ fontSize: 11, fontWeight: 700, color: '#1e293b' }}>{opt.detail}</span>
                            </div>
                            {opt.explanation && (
                              <button
                                onClick={() => setExpandedExplanation(expandedExplanation === `${p.needId}-${i}` ? null : `${p.needId}-${i}`)}
                                style={{ fontSize: 9, fontWeight: 600, padding: '2px 8px', borderRadius: 6, border: `1.5px solid ${accentBorder}`, background: 'white', color: accentColor, cursor: 'pointer', whiteSpace: 'nowrap', flexShrink: 0 }}
                              >
                                {expandedExplanation === `${p.needId}-${i}` ? 'Hide' : 'Explain'}
                              </button>
                            )}
                          </div>

                          {/* Visual move steps */}
                          <div style={{ padding: '8px 10px', display: 'flex', flexDirection: 'column', gap: 6 }}>
                            {(opt.moves ?? []).map((move, mi) => {
                              const isMove = move.type === 'move'
                              const stepBg = isMove ? '#fff7ed' : '#f0fdf4'
                              const stepBorder = isMove ? '#fed7aa' : '#bbf7d0'
                              const iconBg = isMove ? '#ea580c' : '#16a34a'

                              return (
                                <div key={mi}>
                                  {mi > 0 && (
                                    <div style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '2px 0', marginBottom: 4 }}>
                                      <div style={{ width: 1, height: 12, background: '#cbd5e1', marginLeft: 8 }} />
                                      <span style={{ fontSize: 9, fontWeight: 700, color: '#94a3b8', textTransform: 'uppercase', letterSpacing: '0.06em' }}>then</span>
                                    </div>
                                  )}
                                  <div style={{ display: 'flex', alignItems: 'flex-start', gap: 8, padding: '8px 10px', borderRadius: 8, background: stepBg, border: `1.5px solid ${stepBorder}` }}>
                                    {/* Icon */}
                                    <div style={{ width: 20, height: 20, borderRadius: '50%', background: iconBg, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, marginTop: 1 }}>
                                      <span style={{ color: 'white', fontSize: 11, fontWeight: 900, lineHeight: 1 }}>{isMove ? '↔' : '+'}</span>
                                    </div>

                                    <div style={{ flex: 1, minWidth: 0 }}>
                                      {/* Student + subject */}
                                      <div style={{ display: 'flex', alignItems: 'center', gap: 5, flexWrap: 'wrap', marginBottom: 6 }}>
                                        <span style={{ fontSize: 12, fontWeight: 800, color: '#0f172a' }}>{move.studentName}</span>
                                        <span style={{ fontSize: 9, fontWeight: 700, padding: '2px 6px', borderRadius: 20, background: 'white', border: `1px solid ${stepBorder}`, color: '#475569' }}>{move.subject}</span>
                                        <span style={{ fontSize: 9, fontWeight: 700, color: '#94a3b8' }}>{isMove ? 'MOVE' : 'PLACE'}</span>
                                      </div>

                                      {/* Slot flow */}
                                      <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
                                        {isMove && move.fromSlot && (
                                          <>
                                            <SlotChip dayName={move.fromSlot.dayName} label={move.fromSlot.label} tutorName={move.fromSlot.tutorName} variant='from' />
                                            <ArrowRight size={12} style={{ color: '#94a3b8', flexShrink: 0 }} />
                                          </>
                                        )}
                                        <SlotChip dayName={move.toSlot.dayName} label={move.toSlot.label} tutorName={move.toSlot.tutorName} variant='to' />
                                      </div>
                                    </div>
                                  </div>
                                </div>
                              )
                            })}

                            {/* Fallback to text steps if no moves */}
                            {(!opt.moves || opt.moves.length === 0) && (
                              <ul style={{ margin: '0 0 0 16px', padding: 0, color: '#334155', fontSize: 11 }}>
                                {opt.steps.map((step, si) => <li key={si}>{step}</li>)}
                              </ul>
                            )}
                          </div>

                          {/* Detailed Explanation Panel */}
                          {expandedExplanation === `${p.needId}-${i}` && opt.explanation && (
                            <div style={{ padding: '10px', borderTop: `1px solid ${accentBorder}`, background: 'white', fontSize: 11, display: 'flex', flexDirection: 'column', gap: 10 }}>
                              {/* Confidence */}
                              <div style={{ padding: '8px', borderRadius: 8, background: opt.explanation.confidence.level === 'high' ? '#f0fdf4' : opt.explanation.confidence.level === 'medium' ? '#fffbeb' : '#fff1f2', border: `1px solid ${opt.explanation.confidence.level === 'high' ? '#bbf7d0' : opt.explanation.confidence.level === 'medium' ? '#fde68a' : '#fecdd3'}` }}>
                                <div style={{ fontSize: 9, fontWeight: 800, textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 3, color: opt.explanation.confidence.level === 'high' ? '#166534' : opt.explanation.confidence.level === 'medium' ? '#92400e' : '#9f1239' }}>
                                  Confidence: {opt.explanation.confidence.level.toUpperCase()}
                                </div>
                                <div style={{ fontSize: 10, color: opt.explanation.confidence.level === 'high' ? '#166534' : opt.explanation.confidence.level === 'medium' ? '#92400e' : '#9f1239', lineHeight: 1.4 }}>
                                  {opt.explanation.confidence.reason}
                                </div>
                              </div>

                              {/* Scoring Factors */}
                              <div>
                                <div style={{ fontSize: 9, fontWeight: 800, color: '#64748b', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 6 }}>Scoring Factors</div>
                                <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                                  {opt.explanation.scoringFactors.map((factor, fi) => (
                                    <div key={fi} style={{ display: 'flex', alignItems: 'flex-start', gap: 6, padding: '5px 8px', borderRadius: 6, background: factor.impact === 'positive' ? '#f0fdf4' : factor.impact === 'negative' ? '#fff1f2' : '#f8fafc', border: `1px solid ${factor.impact === 'positive' ? '#dcfce7' : factor.impact === 'negative' ? '#ffe4e6' : '#e2e8f0'}` }}>
                                      <div style={{ fontSize: 10, fontWeight: 700, color: factor.impact === 'positive' ? '#15803d' : factor.impact === 'negative' ? '#b91c1c' : '#64748b', marginTop: 1 }}>
                                        {factor.impact === 'positive' ? '✓' : factor.impact === 'negative' ? '⚠' : '→'}
                                      </div>
                                      <div style={{ flex: 1 }}>
                                        <div style={{ fontWeight: 700, color: '#0f172a', fontSize: 9 }}>{factor.label}</div>
                                        <div style={{ fontSize: 9, color: '#64748b', marginTop: 1 }}>{factor.value}</div>
                                      </div>
                                    </div>
                                  ))}
                                </div>
                              </div>

                              {/* Constraints Checked */}
                              <div>
                                <div style={{ fontSize: 9, fontWeight: 800, color: '#64748b', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 6 }}>Constraints Verified</div>
                                <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
                                  {opt.explanation.constraintsChecked.map((constraint, ci) => (
                                    <div key={ci} style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '5px 8px', borderRadius: 6, background: constraint.status === 'pass' ? '#f0fdf4' : '#fff1f2' }}>
                                      <span style={{ fontSize: 8, fontWeight: 900, color: constraint.status === 'pass' ? '#16a34a' : '#e11d48' }}>
                                        {constraint.status === 'pass' ? '✓' : '✗'}
                                      </span>
                                      <div style={{ flex: 1 }}>
                                        <div style={{ fontWeight: 700, color: '#0f172a', fontSize: 9 }}>{constraint.name}</div>
                                        <div style={{ fontSize: 8, color: '#64748b', marginTop: 1 }}>{constraint.detail}</div>
                                      </div>
                                    </div>
                                  ))}
                                </div>
                              </div>

                              {/* Alternatives Considered */}
                              {opt.explanation.alternatives.length > 0 && (
                                <div>
                                  <div style={{ fontSize: 9, fontWeight: 800, color: '#64748b', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 6 }}>Other Options Considered</div>
                                  <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
                                    {opt.explanation.alternatives.map((alt, ai) => (
                                      <div key={ai} style={{ padding: '6px 8px', borderRadius: 6, background: '#f8fafc', border: '1px solid #e2e8f0' }}>
                                        <div style={{ fontWeight: 700, color: '#0f172a', fontSize: 9 }}>{alt.label}</div>
                                        <div style={{ fontSize: 8, color: '#64748b', marginTop: 2 }}>{alt.reason}</div>
                                      </div>
                                    ))}
                                  </div>
                                </div>
                              )}
                            </div>
                          )}
                        </div>
                      )
                    })}
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}