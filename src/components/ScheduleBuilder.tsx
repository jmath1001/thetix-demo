'use client'
import { useState, useCallback, useMemo, useEffect, useRef } from 'react'
import { X, Sparkles, Loader2, Check, AlertTriangle, ChevronDown, RotateCcw, Calendar, User, Clock, ArrowRight, Plus, Trash2 } from 'lucide-react'
import type { Student, Tutor } from '@/lib/useScheduleData'
import { SchedulePreviewGrid } from '@/components/SchedulePreviewGrid'
import { getSessionsForDay, type SessionBlock, type SessionTimesByDay } from '@/components/constants'

interface AvailableSeat {
  tutor: { id: string; name: string; subjects: string[]; cat: string }
  dayName: string
  date: string
  time: string
  seatsLeft: number
  occupied?: number
  maxCapacity?: number
  block?: { label: string; display: string }
  dayNum: number
}

// One subject need per student — a student with 2 subjects = 2 needs
interface StudentNeed {
  student: Student
  subject: string
  needId: string  // local unique key: studentId + index
  allowSameDayDouble: boolean
}

type ProposalStatus = 'matched' | 'fallback' | 'unmatched'

interface Proposal {
  needId: string
  student: Student
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

interface ScheduleBuilderProps {
  students: Student[]
  tutors: Tutor[]
  sessions: any[]
  allAvailableSeats: AvailableSeat[]
  sessionTimesByDay?: SessionTimesByDay
  terms?: Array<{ id: string; name: string; status: string }>
  selectedTermId?: string
  onChangeTerm?: (termId: string) => void
  weekStart: string
  weekEnd: string
  initialMode?: 'batch' | 'single'
  onConfirm: (bookings: { student: Student; slot: AvailableSeat; topic: string }[], options: { recurring: boolean; scheduleMode: 'add' | 'redo' }) => Promise<void>
  onClose: () => void
}

const ALL_SUBJECTS = [
  'Algebra', 'Geometry', 'Precalculus', 'Calculus', 'Statistics',
  'IB Math', 'Physics', 'Chemistry', 'Biology', 'Psychology',
  'SAT Math', 'ACT Math', 'ACT Science', 'ACT English', 'SAT R/W',
  'English/Writing', 'Literature', 'History',
  'AP Physics C Mechanics', 'AP Physics C E&M', 'AP Environmental Science', 'AP Statistics',
]

const AVAILABILITY_DAYS = [
  { dow: 1, label: 'Mon' },
  { dow: 2, label: 'Tue' },
  { dow: 3, label: 'Wed' },
  { dow: 4, label: 'Thu' },
  { dow: 6, label: 'Sat' },
]

function getStudentSubjects(student?: Student | null): string[] {
  if (!student) return []
  if (Array.isArray(student.subjects) && student.subjects.length > 0) {
    return student.subjects.filter(Boolean)
  }
  return student.subject ? [student.subject] : []
}

function subjectMatchesTutor(subject: string, tutor: { subjects: string[] }): boolean {
  if (!subject) return false
  const s = subject.toLowerCase().trim()
  return tutor.subjects.some(ts => {
    const t = ts.toLowerCase().trim()
    return t === s || t.includes(s) || s.includes(t)
  })
}

function bookingConflict(
  studentId: string,
  slot: AvailableSeat,
  bookedSlots: Record<string, Set<string>>
): boolean {
  return bookedSlots[studentId]?.has(`${slot.date}-${slot.time}`) ?? false
}

function toMinutes(time: string): number | null {
  const match = /^(\d{1,2}):(\d{2})$/.exec(time)
  if (!match) return null
  const h = Number(match[1])
  const m = Number(match[2])
  if (Number.isNaN(h) || Number.isNaN(m)) return null
  return h * 60 + m
}

// Prioritize clean placements first so conflict-heavy needs do not block easy wins.
function prioritizeNeeds(
  needs: StudentNeed[],
  seats: AvailableSeat[],
  existingBooked: Record<string, Set<string>>
): StudentNeed[] {
  return [...needs]
    .map((need, originalIndex) => {
      const matchingSeats = seats.filter(seat => {
        if (!subjectMatchesTutor(need.subject, seat.tutor)) return false
        if (seat.seatsLeft <= 0) return false
        if ((need.student.availabilityBlocks?.length ?? 0) > 0 && !need.student.availabilityBlocks?.includes(`${seat.dayNum}-${seat.time}`)) {
          return false
        }
        return true
      })

      const directSeats = matchingSeats.filter(seat =>
        !bookingConflict(need.student.id, seat, existingBooked)
      )

      return {
        need,
        originalIndex,
        hasDirect: directSeats.length > 0,
        directCount: directSeats.length,
        totalCount: matchingSeats.length,
      }
    })
    .sort((a, b) => {
      // 1) Direct non-conflict needs first.
      if (a.hasDirect !== b.hasDirect) return a.hasDirect ? -1 : 1
      // 2) Within each bucket, place tighter constraints first.
      if (a.directCount !== b.directCount) return a.directCount - b.directCount
      if (a.totalCount !== b.totalCount) return a.totalCount - b.totalCount
      // 3) Stable fallback.
      return a.originalIndex - b.originalIndex
    })
    .map(x => x.need)
}

// Client-side fallback — mirrors engine logic, with improved gap-filling
function clientSideMatch(
  needs: StudentNeed[],
  allAvailableSeats: AvailableSeat[],
  existingBooked: Record<string, Set<string>>
): Proposal[] {
  const assignedCounts: Record<number, number> = {}
  const studentDaysThisRun: Record<string, Set<number>> = {}
  const studentSlotsThisRun: Record<string, Set<string>> = {}
  // Track consecutive times per day per student (for adjacency bonus)
  const studentTimesPerDay: Record<string, Record<number, string[]>> = {}

  const getRem = (i: number, seat: AvailableSeat) =>
    seat.seatsLeft - (assignedCounts[i] ?? 0)

  return needs.map(need => {
    const daysBooked = studentDaysThisRun[need.student.id] ?? new Set<number>()
    const slotsBooked = studentSlotsThisRun[need.student.id] ?? new Set<string>()
    const existing = existingBooked[need.student.id] ?? new Set<string>()

    const baseCandidates = allAvailableSeats
      .map((s, i) => ({ seat: s, index: i }))
      .filter(({ seat, index }) =>
        subjectMatchesTutor(need.subject, seat.tutor) &&
        getRem(index, seat) > 0 &&
        !existing.has(`${seat.date}-${seat.time}`) &&
        !slotsBooked.has(`${seat.date}-${seat.time}`)
      )

    const candidates = baseCandidates.filter(({ seat }) => {
      if (!need.student.availabilityBlocks?.length) return true
      return need.student.availabilityBlocks.includes(`${seat.dayNum}-${seat.time}`)
    })

    if (candidates.length === 0) {
      const hasAvailability = (need.student.availabilityBlocks?.length ?? 0) > 0
      const reason = hasAvailability && baseCandidates.length > 0
        ? `No ${need.subject} slot matches student availability this week`
        : `No ${need.subject} tutor available with capacity this week`
      return { needId: need.needId, student: need.student, subject: need.subject, slot: null, status: 'unmatched' as ProposalStatus, reason }
    }

    const scored = candidates
      .map(({ seat, index }) => {
        let score = 0

        // Strongly prefer adding into already-running sessions before opening new ones.
        const baseOccupied = typeof seat.occupied === 'number'
          ? seat.occupied
          : Math.max(0, (seat.maxCapacity ?? 3) - seat.seatsLeft)
        score += baseOccupied * 10

        // Small bonus for additional fill created during this run.
        const runAssignedHere = assignedCounts[index] ?? 0
        score += runAssignedHere * 4

        // Tutor gap penalty — penalize placements that would leave holes in tutor's day
const tutorDaySlots = Object.entries(assignedCounts)
  .filter(([idxStr, count]) => {
    const s = allAvailableSeats[Number(idxStr)]
    return s && s.tutor.id === seat.tutor.id && s.date === seat.date && count > 0
  })
  .map(([idxStr]) => toMinutes(allAvailableSeats[Number(idxStr)].time) ?? 0)

if (tutorDaySlots.length > 0) {
  const currMin = toMinutes(seat.time)
  if (currMin != null) {
    const min = Math.min(...tutorDaySlots)
    const max = Math.max(...tutorDaySlots)
    if (currMin > min && currMin < max) {
      // Filling a gap between existing slots — big bonus
      score += 30
    } else if (currMin === max || currMin === min) {
      // Adjacent to existing block — good
      score += 15
    } else {
      // Would extend the range and potentially create a gap — small penalty
      score -= 8
    }
  }
}

        if (!daysBooked.has(seat.dayNum)) score += 8
        else score -= 15
        
        const dayBalance: Record<number, number> = { 1: 0, 2: 3, 3: 4, 4: 3, 6: 1 }
        score += dayBalance[seat.dayNum] ?? 0

        // Adjacency bonus: if student already has a time on this day, prefer adjacent session times
        const dayKey = `${need.student.id}-${seat.date}`
        if (!studentTimesPerDay[dayKey]) studentTimesPerDay[dayKey] = {}
        if (!studentTimesPerDay[dayKey][seat.dayNum]) studentTimesPerDay[dayKey][seat.dayNum] = []
        const timesOnDay = studentTimesPerDay[dayKey][seat.dayNum]
        if (timesOnDay.length > 0) {
          // Prefer tighter adjacent times without assuming fixed hardcoded session slots.
          const curr = toMinutes(seat.time)
          const last = toMinutes(timesOnDay[timesOnDay.length - 1])
          if (curr != null && last != null) {
            const diff = Math.abs(curr - last)
            if (diff <= 70) score += 12
            else score -= Math.max(1, Math.floor((diff - 1) / 30)) * 2
          }
        }

        return { seat, index, score }
      })
      .sort((a, b) => b.score - a.score)

    const best = scored[0]
    assignedCounts[best.index] = (assignedCounts[best.index] ?? 0) + 1

    if (!studentDaysThisRun[need.student.id]) studentDaysThisRun[need.student.id] = new Set()
    studentDaysThisRun[need.student.id].add(best.seat.dayNum)

    if (!studentSlotsThisRun[need.student.id]) studentSlotsThisRun[need.student.id] = new Set()
    studentSlotsThisRun[need.student.id].add(`${best.seat.date}-${best.seat.time}`)

    // Track time for adjacency
    const dayKey = `${need.student.id}-${best.seat.date}`
    if (!studentTimesPerDay[dayKey]) studentTimesPerDay[dayKey] = {}
    if (!studentTimesPerDay[dayKey][best.seat.dayNum]) studentTimesPerDay[dayKey][best.seat.dayNum] = []
    studentTimesPerDay[dayKey][best.seat.dayNum].push(best.seat.time)

    return {
      needId: need.needId,
      student: need.student,
      subject: need.subject,
      slot: best.seat,
      status: 'matched' as ProposalStatus,
      reason: 'Subject and availability match',
    }
  })
}

export function ScheduleBuilder({
  students, tutors, sessions, allAvailableSeats, sessionTimesByDay, terms = [], selectedTermId = '', onChangeTerm, weekStart, weekEnd, initialMode = 'batch', onConfirm, onClose
}: ScheduleBuilderProps) {
  const [builderMode, setBuilderMode] = useState<'batch' | 'single'>(initialMode)
  const [step, setStep] = useState<'select' | 'preview'>('select')
  // Map of studentId → list of subjects needed (with local needId)
  const [studentNeeds, setStudentNeeds] = useState<Record<string, { subject: string; needId: string; allowSameDayDouble: boolean }[]>>({})
  useEffect(() => {
  if (builderMode !== 'batch') return
  const needs: Record<string, { subject: string; needId: string; allowSameDayDouble: boolean }[]> = {}
  students.forEach(s => {
    const subjects = getStudentSubjects(s)
    needs[s.id] = subjects.length > 0
      ? subjects.map((subject, idx) => ({ subject, needId: `${s.id}-${idx}`, allowSameDayDouble: false }))
      : [{ subject: '', needId: `${s.id}-0`, allowSameDayDouble: false }]
  })
  setStudentNeeds(needs)
}, [students, builderMode])
  // Prefill: no students selected by default in batch mode
  const initialSelectedIds = useMemo<Set<string>>(() => {
    return new Set<string>();
  }, [students, builderMode]);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(initialSelectedIds);
  const [proposals, setProposals] = useState<Proposal[]>([])
  const [generating, setGenerating] = useState(false)
  const [confirming, setConfirming] = useState(false)
  const [suggestionsByNeed, setSuggestionsByNeed] = useState<Record<string, SuggestionOption[]>>({})
  const [previewSeatPool, setPreviewSeatPool] = useState<AvailableSeat[]>(allAvailableSeats)

  const [makeRecurring, setMakeRecurring] = useState(true)
  const [scheduleMode, setScheduleMode] = useState<'add' | 'redo'>('add')
  const [singleStudentId, setSingleStudentId] = useState('')
  const [singleSubject, setSingleSubject] = useState('')
  const [singleSessionBlocks, setSingleSessionBlocks] = useState<string[]>([])
  const [search, setSearch] = useState('')
  const [hideBooked, setHideBooked] = useState(false)
  const [studentAvailability, setStudentAvailability] = useState<Record<string, string[]>>({})
  const [centerSubjects, setCenterSubjects] = useState<string[]>(ALL_SUBJECTS)

  useEffect(() => {
    let cancelled = false
    fetch('/api/center-subjects')
      .then(r => r.json())
      .then(d => { if (!cancelled && Array.isArray(d?.subjects) && d.subjects.length > 0) setCenterSubjects(d.subjects) })
      .catch(() => {})
    return () => { cancelled = true }
  }, [])
  const [persistedAvailability, setPersistedAvailability] = useState<Record<string, string[]>>({})
  const [availabilityOpenFor, setAvailabilityOpenFor] = useState<string | null>(null)
  const [savingAvailability, setSavingAvailability] = useState<Set<string>>(new Set())
  const [dirtyAvailability, setDirtyAvailability] = useState<Set<string>>(new Set())
  const persistedAvailabilityRef = useRef<Record<string, string[]>>({})
  const availabilitySaveVersionRef = useRef<Record<string, number>>({})

  const builderSessionBlocks = useMemo<SessionBlock[]>(() => {
    const byTime = new Map<string, SessionBlock>()
    AVAILABILITY_DAYS.forEach(({ dow }) => {
      const dayBlocks = getSessionsForDay(dow, sessionTimesByDay ?? null)
      dayBlocks.forEach(block => {
        const existing = byTime.get(block.time)
        if (!existing) {
          byTime.set(block.time, { ...block, days: [dow] })
          return
        }
        if (!existing.days.includes(dow)) {
          byTime.set(block.time, { ...existing, days: [...existing.days, dow] })
        }
      })
    })

    return Array.from(byTime.values())
      .sort((a, b) => a.time.localeCompare(b.time))
      .map((block, idx) => ({
        ...block,
        label: `Session ${idx + 1}`,
        days: [...block.days].sort((a, b) => a - b),
      }))
  }, [sessionTimesByDay])

  const normalizeBlocks = useCallback((blocks: string[]) => {
    return Array.from(new Set(blocks)).sort()
  }, [])

  const hasAvailabilityChanges = useCallback((studentId: string, nextBlocks: string[]) => {
    const current = normalizeBlocks(nextBlocks)
    const saved = normalizeBlocks(persistedAvailabilityRef.current[studentId] ?? [])
    if (current.length !== saved.length) return true
    for (let i = 0; i < current.length; i++) {
      if (current[i] !== saved[i]) return true
    }
    return false
  }, [normalizeBlocks])

  useEffect(() => {
    const next: Record<string, string[]> = {}
    students.forEach(s => {
      next[s.id] = [...(s.availabilityBlocks ?? [])]
    })
    setPersistedAvailability(next)
    persistedAvailabilityRef.current = next
  }, [students])

  // Existing bookings this week by student
  const bookedSlotsByStudent = useMemo(() => {
    const map: Record<string, Set<string>> = {}
    sessions.forEach(s =>
      s.students?.forEach((st: any) => {
        if (st.status === 'cancelled' || !st.id) return
        map[st.id] = map[st.id] ?? new Set()
        map[st.id].add(`${s.date}-${s.time}`)
      })
    )
    return map
  }, [sessions])

  const bookedStudentIds = useMemo(() => {
    const ids = new Set<string>()
    sessions.forEach(s =>
      s.students?.forEach((st: any) => {
        if (st.status !== 'cancelled' && st.id) ids.add(st.id)
      })
    )
    return ids
  }, [sessions])

  // Map of studentId → Set of normalized subject names already booked this week
  const bookedSubjectsByStudent = useMemo(() => {
    const map: Record<string, Set<string>> = {}
    sessions.forEach(s =>
      s.students?.forEach((st: any) => {
        if (st.status === 'cancelled' || !st.id) return
        const topic = typeof st.topic === 'string' ? st.topic.trim().toLowerCase() : ''
        if (!topic) return
        map[st.id] = map[st.id] ?? new Set()
        map[st.id].add(topic)
      })
    )
    return map
  }, [sessions])

  const recurringTopicsByStudent = useMemo(() => {
    const topicsByStudent = new Map<string, Map<string, number>>()

    sessions.forEach((s: any) => {
      s.students?.forEach((st: any) => {
        if (st.status === 'cancelled' || !st.id || !st.seriesId) return
        const topic = typeof st.topic === 'string' ? st.topic.trim() : ''
        if (!topic) return

        if (!topicsByStudent.has(st.id)) topicsByStudent.set(st.id, new Map<string, number>())
        const studentTopics = topicsByStudent.get(st.id)!
        studentTopics.set(topic, (studentTopics.get(topic) ?? 0) + 1)
      })
    })

    const result: Record<string, string[]> = {}
    topicsByStudent.forEach((topicCounts, studentId) => {
      result[studentId] = Array.from(topicCounts.entries())
        .sort((a, b) => {
          if (b[1] !== a[1]) return b[1] - a[1]
          return a[0].localeCompare(b[0])
        })
        .map(([topic]) => topic)
    })

    return result
  }, [sessions])

  const subjectOptions = useMemo(() => {
    const dynamicSubjects = new Set<string>()

    centerSubjects.forEach(subject => {
      if (typeof subject === 'string' && subject.trim()) dynamicSubjects.add(subject.trim())
    })

    students.forEach(student => {
      getStudentSubjects(student).forEach(subject => {
        if (typeof subject === 'string' && subject.trim()) dynamicSubjects.add(subject.trim())
      })
    })

    tutors.forEach(tutor => {
      ;(tutor.subjects ?? []).forEach(subject => {
        if (typeof subject === 'string' && subject.trim()) dynamicSubjects.add(subject.trim())
      })
    })

    Object.values(recurringTopicsByStudent).forEach(topics => {
      topics.forEach(subject => {
        if (typeof subject === 'string' && subject.trim()) dynamicSubjects.add(subject.trim())
      })
    })

    return Array.from(dynamicSubjects).sort((a, b) => a.localeCompare(b))
  }, [students, tutors, recurringTopicsByStudent])

  const existingSeatCounts = useMemo(() => {
    const counts: Record<string, number> = {}
    sessions.forEach((s: any) => {
      const activeStudents = (s.students ?? []).filter((st: any) => st.status !== 'cancelled').length
      if (activeStudents <= 0 || !s.tutorId || !s.date || !s.time) return
      const key = `${s.tutorId}|${s.date}|${s.time}`
      counts[key] = (counts[key] ?? 0) + activeStudents
    })
    return counts
  }, [sessions])

  const studentById = useMemo(() => {
    const map: Record<string, Student> = {}
    students.forEach(s => { map[s.id] = s })
    return map
  }, [students])

  const tutorById = useMemo(() => {
    const map: Record<string, Tutor> = {}
    tutors.forEach(t => { map[t.id] = t })
    return map
  }, [tutors])

  const buildSuggestionsForNeed = useCallback((
    need: StudentNeed,
    currentProposals: Proposal[],
    candidateSeats: AvailableSeat[] = allAvailableSeats
  ): SuggestionOption[] => {
    const options: SuggestionOption[] = []
    const studentExisting = bookedSlotsByStudent[need.student.id] ?? new Set<string>()
    const studentRunBooked = new Set(
      currentProposals
        .filter(p => p.student.id === need.student.id && p.slot)
        .map(p => `${p.slot!.date}-${p.slot!.time}`)
    )

    const proposalLoadBySeat = new Map<string, number>()
    currentProposals.forEach(p => {
      if (!p.slot) return
      const key = `${p.slot.tutor.id}|${p.slot.date}|${p.slot.time}`
      proposalLoadBySeat.set(key, (proposalLoadBySeat.get(key) ?? 0) + 1)
    })

    const seatRemaining = (seat: AvailableSeat) => {
      const key = `${seat.tutor.id}|${seat.date}|${seat.time}`
      return seat.seatsLeft - (proposalLoadBySeat.get(key) ?? 0)
    }

    const directCandidates = candidateSeats
      .filter(seat =>
        subjectMatchesTutor(need.subject, seat.tutor) &&
        seatRemaining(seat) > 0 &&
        !studentExisting.has(`${seat.date}-${seat.time}`) &&
        !studentRunBooked.has(`${seat.date}-${seat.time}`) &&
        (
          !(need.student.availabilityBlocks?.length) ||
          need.student.availabilityBlocks?.includes(`${seat.dayNum}-${seat.time}`)
        )
      )
      .sort((a, b) => {
        const aOccupied = typeof a.occupied === 'number' ? a.occupied : Math.max(0, (a.maxCapacity ?? 3) - a.seatsLeft)
        const bOccupied = typeof b.occupied === 'number' ? b.occupied : Math.max(0, (b.maxCapacity ?? 3) - b.seatsLeft)
        if (bOccupied !== aOccupied) return bOccupied - aOccupied
        return a.seatsLeft - b.seatsLeft
      })
      .slice(0, 3)

    // Calculate all candidates for confidence assessment
    const allValidCandidates = candidateSeats
      .filter(seat =>
        subjectMatchesTutor(need.subject, seat.tutor) &&
        seatRemaining(seat) > 0 &&
        !studentExisting.has(`${seat.date}-${seat.time}`) &&
        !studentRunBooked.has(`${seat.date}-${seat.time}`) &&
        (
          !(need.student.availabilityBlocks?.length) ||
          need.student.availabilityBlocks?.includes(`${seat.dayNum}-${seat.time}`)
        )
      )

    directCandidates.forEach((seat, idx) => {
      const scoringFactors: Array<{ label: string; value: string; impact: 'positive' | 'negative' | 'neutral' }> = []
      const occupied = typeof seat.occupied === 'number' ? seat.occupied : Math.max(0, (seat.maxCapacity ?? 3) - seat.seatsLeft)
      
      if (occupied > 0) {
        scoringFactors.push({ label: 'Fills existing session', value: `${occupied} already booked`, impact: 'positive' })
      } else {
        scoringFactors.push({ label: 'Opens new session', value: 'No students yet', impact: 'neutral' })
      }
      
      scoringFactors.push({ label: 'Availability match', value: 'Matches student preferences', impact: 'positive' })
      scoringFactors.push({ label: 'Subject expertise', value: `${seat.tutor.name} teaches ${need.subject}`, impact: 'positive' })
      scoringFactors.push({ label: 'Capacity available', value: `${seatRemaining(seat)} open seat${seatRemaining(seat) !== 1 ? 's' : ''}`, impact: 'positive' })

      const constraintsChecked: Array<{ name: string; status: 'pass' | 'fail'; detail: string }> = [
        { name: 'Subject Match', status: 'pass', detail: `${seat.tutor.name} teaches ${need.subject}` },
        { name: 'Time Available', status: 'pass', detail: `${seat.dayName} ${seat.block?.label ?? seat.time}` },
        { name: 'Capacity', status: 'pass', detail: `${seatRemaining(seat)} of ${seat.maxCapacity ?? 3} seats open` },
        { name: 'Student Availability', status: 'pass', detail: need.student.availabilityBlocks?.length ? 'Matches student blocks' : 'No restrictions' },
        { name: 'No Double Booking', status: 'pass', detail: 'Student not already booked this time' },
      ]

      const alternatives = allValidCandidates
        .filter(s => !(s.tutor.id === seat.tutor.id && s.date === seat.date && s.time === seat.time))
        .slice(0, 2)
        .map((alt, i) => {
          const reason = i === 0 ? 'Second best ranked option' : 'Third option considered'
          return { label: `${alt.dayName} ${alt.block?.label ?? alt.time} w/ ${alt.tutor.name}`, reason }
        })

      const confidenceLevel = allValidCandidates.length > 5 ? 'high' : allValidCandidates.length > 2 ? 'medium' : 'low'
      const confidenceReason = allValidCandidates.length > 5 
        ? `Many options available (${allValidCandidates.length}) — consistent scheduling` 
        : allValidCandidates.length > 2 
        ? `Moderate flexibility (${allValidCandidates.length} options)` 
        : `Limited options (${allValidCandidates.length}) — fewer alternatives if changes needed`

      options.push({
        title: `Option ${idx + 1}: Direct placement`,
        detail: `${seat.dayName} ${seat.block?.label ?? seat.time} with ${seat.tutor.name}`,
        steps: [
          `Book ${need.student.name} into ${seat.dayName} ${seat.block?.label ?? seat.time}`,
          `Tutor: ${seat.tutor.name} · Subject: ${need.subject}`,
        ],
        moves: [{
          type: 'place',
          studentName: need.student.name,
          subject: need.subject,
          toSlot: { dayName: seat.dayName, label: seat.block?.label ?? seat.time, tutorName: seat.tutor.name },
        }],
        explanation: {
          scoringFactors,
          constraintsChecked,
          alternatives,
          confidence: { level: confidenceLevel as 'high' | 'medium' | 'low', reason: confidenceReason },
        },
      })
    })

    const conflictSeats = candidateSeats
      .filter(seat =>
        subjectMatchesTutor(need.subject, seat.tutor) &&
        seatRemaining(seat) > 0 &&
        (
          !(need.student.availabilityBlocks?.length) ||
          need.student.availabilityBlocks?.includes(`${seat.dayNum}-${seat.time}`)
        ) &&
        (studentExisting.has(`${seat.date}-${seat.time}`) || studentRunBooked.has(`${seat.date}-${seat.time}`))
      )
      .slice(0, 3)

    for (const conflictSeat of conflictSeats) {
      const conflictingSession = (sessions ?? []).find((s: any) =>
        s.date === conflictSeat.date &&
        s.time === conflictSeat.time &&
        (s.students ?? []).some((st: any) => st.id === need.student.id && st.status !== 'cancelled')
      )

      const conflictTopic = conflictingSession
        ? ((conflictingSession.students ?? []).find((st: any) => st.id === need.student.id && st.status !== 'cancelled')?.topic || need.subject)
        : need.subject

      const moveTarget = candidateSeats.find(seat => {
        if (!subjectMatchesTutor(conflictTopic, seat.tutor)) return false
        if (seatRemaining(seat) <= 0) return false
        if (seat.date === conflictSeat.date && seat.time === conflictSeat.time) return false
        if ((need.student.availabilityBlocks?.length ?? 0) > 0 && !need.student.availabilityBlocks?.includes(`${seat.dayNum}-${seat.time}`)) return false
        if (studentExisting.has(`${seat.date}-${seat.time}`)) return false
        if (studentRunBooked.has(`${seat.date}-${seat.time}`)) return false
        return true
      })

      if (!moveTarget) continue

      const scoringFactors: Array<{ label: string; value: string; impact: 'positive' | 'negative' | 'neutral' }> = [
        { label: 'Resolves conflict', value: `Moves ${conflictTopic} to clear slot`, impact: 'positive' },
        { label: 'Maintains subject', value: `Keeps ${conflictTopic} with qualified tutor`, impact: 'positive' },
        { label: 'Adds new subject', value: `Books ${need.subject} in freed slot`, impact: 'positive' },
        { label: 'Two-step process', value: 'Requires moving existing session', impact: 'negative' },
      ]

      const constraintsChecked: Array<{ name: string; status: 'pass' | 'fail'; detail: string }> = [
        { name: 'Subject Match (original)', status: 'pass', detail: `Existing ${conflictTopic} can be moved` },
        { name: 'Subject Match (new)', status: 'pass', detail: `${conflictSeat.tutor.name} teaches ${need.subject}` },
        { name: 'Move Destination', status: 'pass', detail: `${moveTarget.dayName} ${moveTarget.block?.label ?? moveTarget.time}` },
        { name: 'No Double Booking', status: 'pass', detail: 'Clear all time conflicts' },
      ]

      options.push({
        title: `Option ${options.length + 1}: Resolve double booking`,
        detail: `Move ${need.student.name}'s conflicting session, then place ${need.subject}`,
        steps: [
          `Move existing ${conflictTopic} session from ${conflictSeat.dayName} ${conflictSeat.block?.label ?? conflictSeat.time} to ${moveTarget.dayName} ${moveTarget.block?.label ?? moveTarget.time} with ${moveTarget.tutor.name}`,
          `Then book ${need.student.name} for ${need.subject} at ${conflictSeat.dayName} ${conflictSeat.block?.label ?? conflictSeat.time} with ${conflictSeat.tutor.name}`,
        ],
        moves: [
          {
            type: 'move',
            studentName: need.student.name,
            subject: conflictTopic,
            fromSlot: { dayName: conflictSeat.dayName, label: conflictSeat.block?.label ?? conflictSeat.time, tutorName: conflictSeat.tutor.name },
            toSlot: { dayName: moveTarget.dayName, label: moveTarget.block?.label ?? moveTarget.time, tutorName: moveTarget.tutor.name },
          },
          {
            type: 'place',
            studentName: need.student.name,
            subject: need.subject,
            toSlot: { dayName: conflictSeat.dayName, label: conflictSeat.block?.label ?? conflictSeat.time, tutorName: conflictSeat.tutor.name },
          },
        ],
        explanation: {
          scoringFactors,
          constraintsChecked,
          alternatives: [],
          confidence: { level: 'medium', reason: 'Requires moving existing booking — verify student availability' },
        },
      })

      if (options.length >= 4) break
    }

    const fullSessions = (sessions ?? []).filter((s: any) => ((s.students ?? []).filter((st: any) => st.status !== 'cancelled').length >= 3))
    for (const full of fullSessions) {
      const tutor = tutorById[full.tutorId]
      if (!tutor || !subjectMatchesTutor(need.subject, { subjects: tutor.subjects } as any)) continue

      const dayNum = new Date(full.date + 'T00:00:00').getDay()
      if ((need.student.availabilityBlocks?.length ?? 0) > 0 && !need.student.availabilityBlocks?.includes(`${dayNum}-${full.time}`)) continue
      if (studentExisting.has(`${full.date}-${full.time}`)) continue

      const fullStudents = (full.students ?? []).filter((st: any) => st.status !== 'cancelled')
      for (const st of fullStudents) {
        const movingStudent = studentById[st.id]
        if (!movingStudent) continue
        const movingTopic = st.topic || getStudentSubjects(movingStudent)[0] || need.subject

        const destination = candidateSeats.find(seat => {
          if (!subjectMatchesTutor(movingTopic, seat.tutor)) return false
          if (seatRemaining(seat) <= 0) return false
          if (seat.date === full.date && seat.time === full.time) return false
          const movingExisting = bookedSlotsByStudent[movingStudent.id] ?? new Set<string>()
          if (movingExisting.has(`${seat.date}-${seat.time}`)) return false
          if ((movingStudent.availabilityBlocks?.length ?? 0) > 0 && !movingStudent.availabilityBlocks?.includes(`${seat.dayNum}-${seat.time}`)) return false
          return true
        })

        if (!destination) continue

        const matchedSeat = candidateSeats.find(seat => seat.date === full.date && seat.time === full.time)
        const fullDayName = matchedSeat?.dayName ?? ((['Sun','Mon','Tue','Wed','Thu','Fri','Sat'])[new Date(full.date + 'T00:00:00').getDay()] ?? full.date)
        const fullBlockLabel = matchedSeat?.block?.label ?? full.time

        const scoringFactors: Array<{ label: string; value: string; impact: 'positive' | 'negative' | 'neutral' }> = [
          { label: 'Opens full session', value: 'Session has 3 students — making room optimizes class', impact: 'positive' },
          { label: 'Maintains balance', value: `${movingStudent.name} still gets ${movingTopic}`, impact: 'positive' },
          { label: 'Adds capacity', value: `${need.student.name} fills needed ${need.subject} slot`, impact: 'positive' },
          { label: 'More complex', value: 'Requires rearranging current students', impact: 'negative' },
        ]

        options.push({
          title: `Option ${options.length + 1}: Rearrangement`,
          detail: `Move ${movingStudent.name} out, then place ${need.student.name}`,
          steps: [
            `Move ${movingStudent.name} (${movingTopic}) to ${destination.dayName} ${destination.block?.label ?? destination.time} with ${destination.tutor.name}`,
            `Then book ${need.student.name} (${need.subject}) into ${full.date} ${full.time} with ${tutor.name}`,
          ],
          moves: [
            {
              type: 'move',
              studentName: movingStudent.name,
              subject: movingTopic,
              fromSlot: { dayName: fullDayName, label: fullBlockLabel, tutorName: tutor.name },
              toSlot: { dayName: destination.dayName, label: destination.block?.label ?? destination.time, tutorName: destination.tutor.name },
            },
            {
              type: 'place',
              studentName: need.student.name,
              subject: need.subject,
              toSlot: { dayName: fullDayName, label: fullBlockLabel, tutorName: tutor.name },
            },
          ],
          explanation: {
            scoringFactors,
            constraintsChecked: [
              { name: 'Session Capacity Check', status: 'pass', detail: 'Current session is full (3/3 students)' },
              { name: 'Availability', status: 'pass', detail: `${movingStudent.name} available at destination` },
              { name: 'No Double Booking', status: 'pass', detail: `${need.student.name} can take freed slot` },
            ],
            alternatives: [],
            confidence: { level: 'medium', reason: 'Works best if stakeholders approve moving an existing student' },
          },
        })
        break
      }

      if (options.length >= 4) break
    }

    return options.slice(0, 4)
  }, [allAvailableSeats, bookedSlotsByStudent, sessions, studentById, tutorById])

  // Sort students: those with availability and subjects filled in first
  const filteredStudents = useMemo(() => {
    const scored = students.map(s => {
      const hasAvail = Array.isArray(s.availabilityBlocks) && s.availabilityBlocks.length > 0;
      const hasSubjects = Array.isArray(s.subjects) && s.subjects.length > 0;
      return {
        ...s,
        _score: (hasAvail ? 2 : 0) + (hasSubjects ? 1 : 0),
      };
    });
    return scored
      .filter(s => s.name.toLowerCase().includes(search.toLowerCase()))
      .filter(s => !hideBooked || !bookedStudentIds.has(s.id))
      .sort((a, b) => b._score - a._score || a.name.localeCompare(b.name));
  }, [students, search, hideBooked, bookedStudentIds]);

  const toggleStudent = useCallback((id: string) => {
    setSelectedIds(prev => {
      const next = new Set(prev)
      if (next.has(id)) {
        next.delete(id)
        setStudentNeeds(sn => { const n = { ...sn }; delete n[id]; return n })
        if (availabilityOpenFor === id) setAvailabilityOpenFor(null)
      } else {
        next.add(id)
        const selectedStudent = students.find(s => s.id === id)
        const savedSubjects = getStudentSubjects(selectedStudent)
        setStudentNeeds(sn => ({
          ...sn,
          [id]: savedSubjects.length > 0
            ? savedSubjects.map((subject, idx) => ({ subject, needId: `${id}-${idx}`, allowSameDayDouble: false }))
            : [{ subject: '', needId: `${id}-0`, allowSameDayDouble: false }]
        }))
        setStudentAvailability(sa => ({
          ...sa,
          [id]: [...(selectedStudent?.availabilityBlocks ?? [])],
        }))
      }
      return next
    })
  }, [students, availabilityOpenFor])

  const saveStudentAvailability = useCallback(async (studentId: string, availabilityBlocks: string[]) => {
    const saveVersion = (availabilitySaveVersionRef.current[studentId] ?? 0) + 1
    availabilitySaveVersionRef.current[studentId] = saveVersion

    const res = await fetch('/api/student-availability', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        studentId,
        availabilityBlocks,
        termId: selectedTermId || undefined,
      })
    })

    if (!res.ok) {
      let message = 'Failed to save availability.'
      try {
        const payload = await res.json()
        if (payload?.error) message = payload.error
      } catch {
        // Ignore non-JSON response body.
      }
      throw new Error(message)
    }

    // Only let the latest in-flight save for this student win.
    if (availabilitySaveVersionRef.current[studentId] !== saveVersion) return

    setPersistedAvailability(prev => {
      const next = { ...prev, [studentId]: [...availabilityBlocks] }
      persistedAvailabilityRef.current = next
      return next
    })
  }, [selectedTermId])

  const persistAvailabilityChange = useCallback(async (studentId: string, availabilityBlocks: string[]) => {
    setSavingAvailability(s => new Set([...s, studentId]))
    try {
      await saveStudentAvailability(studentId, availabilityBlocks)
    } catch (err) {
      console.error('Failed to save availability:', err)
      const fallback = [...(persistedAvailabilityRef.current[studentId] ?? [])]
      setStudentAvailability(sa => ({
        ...sa,
        [studentId]: fallback,
      }))
      alert((err as Error).message || 'Failed to save availability.')
    } finally {
      setSavingAvailability(s => {
        const next = new Set(s)
        next.delete(studentId)
        return next
      })
    }
  }, [saveStudentAvailability])

  const saveAvailabilityEdits = useCallback(async (studentId: string) => {
    const blocksToSave = [...(studentAvailability[studentId] ?? persistedAvailabilityRef.current[studentId] ?? [])]
    await persistAvailabilityChange(studentId, blocksToSave)
    if (!hasAvailabilityChanges(studentId, blocksToSave)) {
      setDirtyAvailability(prev => {
        const next = new Set(prev)
        next.delete(studentId)
        return next
      })
    }
  }, [hasAvailabilityChanges, persistAvailabilityChange, studentAvailability])

  const toggleAvailabilityBlock = useCallback((studentId: string, dow: number, time: string) => {
    const key = `${dow}-${time}`
    setStudentAvailability(prev => {
      const current = prev[studentId] ?? []
      const next = current.includes(key)
        ? current.filter(b => b !== key)
        : [...current, key]
      const isDirty = hasAvailabilityChanges(studentId, next)
      setDirtyAvailability(prevDirty => {
        const nextDirty = new Set(prevDirty)
        if (isDirty) nextDirty.add(studentId)
        else nextDirty.delete(studentId)
        return nextDirty
      })
      return { ...prev, [studentId]: next }
    })
  }, [hasAvailabilityChanges])

  const resetAvailability = useCallback((studentId: string) => {
    const originalBlocks = [...(persistedAvailabilityRef.current[studentId] ?? [])]
    
    setStudentAvailability(prev => ({
      ...prev,
      [studentId]: originalBlocks,
    }))
    setDirtyAvailability(prev => {
      const next = new Set(prev)
      next.delete(studentId)
      return next
    })
  }, [])

  const addSubjectRow = useCallback((studentId: string) => {
    setStudentNeeds(prev => {
      const existing = prev[studentId] ?? []
      if (existing.length >= 3) return prev
      return {
        ...prev,
        [studentId]: [...existing, {
          subject: '',
          needId: `${studentId}-${existing.length}`,
          allowSameDayDouble: false,
        }]
      }
    })
  }, [])

  const removeSubjectRow = useCallback((studentId: string, needId: string) => {
    setStudentNeeds(prev => {
      const filtered = (prev[studentId] ?? []).filter(n => n.needId !== needId)
      return { ...prev, [studentId]: filtered }
    })
  }, [])

  const setSubject = useCallback((studentId: string, needId: string, subject: string) => {
    setStudentNeeds(prev => ({
      ...prev,
      [studentId]: (prev[studentId] ?? []).map(n => n.needId === needId ? { ...n, subject } : n)
    }))
  }, [])

  // Build flat list of needs for the engine
  const allNeeds: StudentNeed[] = useMemo(() => {
    const out: StudentNeed[] = []
    for (const id of selectedIds) {
      const s = students.find(st => st.id === id)
      if (!s) continue
      const effectiveAvailability = studentAvailability[id] ?? s.availabilityBlocks ?? []
      for (const n of (studentNeeds[id] ?? [])) {
        if (n.subject) {
          out.push({
            student: { ...s, availabilityBlocks: effectiveAvailability },
            subject: n.subject,
            needId: n.needId,
            allowSameDayDouble: n.allowSameDayDouble,
          })
        }
      }
    }
    return out
  }, [selectedIds, studentNeeds, students, studentAvailability])

  const selectedCount = selectedIds.size
  const missingSubject = [...selectedIds].some(id =>
    (studentNeeds[id] ?? []).some(n => !n.subject) ||
    (studentNeeds[id] ?? []).length === 0
  )
  const singleSelectedStudent = useMemo(() => students.find(s => s.id === singleStudentId) ?? null, [students, singleStudentId])
  const canGenerate = builderMode === 'batch'
    ? selectedCount > 0 && !missingSubject && !generating
    : !!singleSelectedStudent && !!singleSubject && !generating

  const generate = useCallback(async () => {
    if (!canGenerate) return
    const needsToRun: StudentNeed[] = builderMode === 'single'
      ? (() => {
          if (!singleSelectedStudent || !singleSubject) return []
          return [{
            student: {
              ...singleSelectedStudent,
              // Single-mode availability is ad-hoc for this booking only.
              availabilityBlocks: [],
            },
            subject: singleSubject,
            needId: `${singleSelectedStudent.id}-single`,
            allowSameDayDouble: false,
          }]
        })()
      : allNeeds

    // In 'add' mode: filter out needs where the student is already booked for that subject this week.
    // In 'redo' mode: include all needs so the scheduler can find new optimal placements.
    const alreadyBookedNeeds = scheduleMode === 'add' ? needsToRun.filter(n => {
      const booked = bookedSubjectsByStudent[n.student.id]
      return booked?.has(n.subject.trim().toLowerCase())
    }) : []
    const filteredNeeds = scheduleMode === 'add' ? needsToRun.filter(n => {
      const booked = bookedSubjectsByStudent[n.student.id]
      return !booked?.has(n.subject.trim().toLowerCase())
    }) : needsToRun
    if (scheduleMode === 'add' && alreadyBookedNeeds.length > 0 && filteredNeeds.length === 0) {
      // All needs are already booked — nothing to do
      setProposals([])
      setStep('preview')
      return
    }
    const activeNeeds = filteredNeeds.length > 0 ? filteredNeeds : needsToRun
    if (!activeNeeds.length) return

    const hasSingleBlocks = builderMode === 'single' && singleSessionBlocks.length > 0
    const seatsForRun = hasSingleBlocks
      ? allAvailableSeats.filter(seat => singleSessionBlocks.includes(`${seat.dayNum}-${seat.time}`))
      : allAvailableSeats

    const prioritizedNeeds = prioritizeNeeds(activeNeeds, seatsForRun, bookedSlotsByStudent)
    setPreviewSeatPool(seatsForRun)

    setGenerating(true)
    try {
      const needStudentIds = Array.from(new Set(activeNeeds.map(n => n.student.id)))
      const res = await fetch('/api/schedule-builder', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          needs: prioritizedNeeds.map(n => ({
            studentId: n.student.id,
            studentName: n.student.name,
            subject: n.subject,
            needId: n.needId,
            availabilityBlocks: n.student.availabilityBlocks ?? [],
            allowSameDayDouble: n.allowSameDayDouble,
          })),
          availableSeats: seatsForRun.map((s, i) => ({
            index: i,
            tutorId: s.tutor.id,
            tutorName: s.tutor.name,
            tutorSubjects: s.tutor.subjects,
            tutorCat: s.tutor.cat,
            day: s.dayName,
            dayNum: s.dayNum,
            date: s.date,
            time: s.time,
            seatsLeft: s.seatsLeft,
            occupied: typeof (s as any).count === 'number' ? (s as any).count : Math.max(0, 3 - s.seatsLeft),
            maxCapacity: 3,
            label: s.block?.label,
          })),
          existingBookings: scheduleMode === 'redo'
            ? [] // In redo mode, ignore existing bookings so engine can freely reassign slots
            : Array.from(new Set(activeNeeds.map(n => n.student.id))).map(id => ({
                studentId: id,
                existingSlots: Array.from(bookedSlotsByStudent[id] ?? []),
              })),
          weekStart,
          weekEnd,
          sessionTimesByDay,
        }),
      })

      if (!res.ok) throw new Error('API error')
      const data = await res.json()

      const built: Proposal[] = prioritizedNeeds.map(need => {
        const a = data.assignments?.find((x: any) => x.studentId === need.student.id && x.subject === need.subject)
        if (!a || a.slotIndex == null) {
          return { needId: need.needId, student: need.student, subject: need.subject, slot: null, status: 'unmatched' as ProposalStatus, reason: a?.reason ?? 'No valid slot found' }
        }
        const slot = seatsForRun[a.slotIndex]
        if (!slot) {
          return { needId: need.needId, student: need.student, subject: need.subject, slot: null, status: 'unmatched' as ProposalStatus, reason: 'Slot index invalid' }
        }
        return { needId: need.needId, student: need.student, subject: need.subject, slot, status: a.status ?? 'matched', reason: a.reason ?? '' }
      })

      setProposals(built)
      const nextSuggestions: Record<string, SuggestionOption[]> = {}
      prioritizedNeeds.forEach(need => {
        const placed = built.find(p => p.needId === need.needId)?.slot
        if (!placed) nextSuggestions[need.needId] = buildSuggestionsForNeed(need, built, seatsForRun)
      })
      setSuggestionsByNeed(nextSuggestions)
      setStep('preview')
    } catch {
      const fallbackBuilt = clientSideMatch(prioritizedNeeds, seatsForRun, bookedSlotsByStudent)
      setProposals(fallbackBuilt)
      const nextSuggestions: Record<string, SuggestionOption[]> = {}
      prioritizedNeeds.forEach(need => {
        const placed = fallbackBuilt.find(p => p.needId === need.needId)?.slot
        if (!placed) nextSuggestions[need.needId] = buildSuggestionsForNeed(need, fallbackBuilt, seatsForRun)
      })
      setSuggestionsByNeed(nextSuggestions)
      setStep('preview')
    } finally {
      setGenerating(false)
    }
  }, [canGenerate, builderMode, singleSelectedStudent, singleSubject, allNeeds, allAvailableSeats, weekStart, weekEnd, sessionTimesByDay, bookedSlotsByStudent, buildSuggestionsForNeed, singleSessionBlocks])

  const swapSlot = useCallback((needId: string, slotIndex: number) => {
    const slot = previewSeatPool[slotIndex]
    if (!slot) return { success: false, reason: 'Slot not found' }

    const proposal = proposals.find(p => p.needId === needId)
    if (!proposal) return { success: false, reason: 'Proposal not found' }

    // Check if student is already booked at this time (existing or other proposals)
    const isBooked = (
      bookedSlotsByStudent[proposal.student.id]?.has(`${slot.date}-${slot.time}`) ?? false
    ) || (
      proposals.some(
        p => p.student.id === proposal.student.id && p.needId !== needId && p.slot &&
        p.slot.date === slot.date && p.slot.time === slot.time
      )
    )

    if (isBooked) {
      return { success: false, reason: 'Student already booked at this time' }
    }

    // Check if slot has remaining capacity
    const currentBookings = proposals.filter(
      p => p.slot && p.slot.date === slot.date && p.slot.time === slot.time && p.slot.tutor.id === slot.tutor.id
    ).length + (sessions ?? []).filter((s: any) => 
      s.date === slot.date && s.time === slot.time && s.tutorId === slot.tutor.id
    ).flatMap((s: any) => s.students ?? []).filter((st: any) => st.status !== 'cancelled').length

    const slotCapacity = slot.maxCapacity ?? 3
    if (currentBookings >= slotCapacity) {
      return { success: false, reason: 'No capacity available' }
    }

    // Swap is valid
    setProposals(prev => prev.map(p => p.needId === needId ? { ...p, slot, status: 'matched', reason: 'Manually selected' } : p))
    return { success: true }
  }, [previewSeatPool, proposals, bookedSlotsByStudent, sessions])

  const computeRatioMetrics = useCallback((proposalList: Proposal[]) => {
    const counts: Record<string, number> = { ...existingSeatCounts }
    proposalList.forEach(p => {
      if (!p.slot) return
      const key = `${p.slot.tutor.id}|${p.slot.date}|${p.slot.time}`
      counts[key] = (counts[key] ?? 0) + 1
    })
    const activeSessions = Object.values(counts).filter(c => c > 0).length
    const totalStudents = Object.values(counts).reduce((sum, c) => sum + c, 0)
    const ratio = activeSessions > 0 ? totalStudents / activeSessions : 0
    return { counts, activeSessions, totalStudents, ratio }
  }, [existingSeatCounts])

  const currentRatioMetrics = useMemo(() => computeRatioMetrics(proposals), [computeRatioMetrics, proposals])

  const removeProposal = useCallback((needId: string) => {
    setProposals(prev => prev.filter(p => p.needId !== needId))
  }, [])

  const handleConfirm = async () => {
    const bookings = proposals.filter(p => p.slot).map(p => ({ student: p.student, slot: p.slot!, topic: p.subject }))
    if (!bookings.length) return
    setConfirming(true)
    try { await onConfirm(bookings, { recurring: makeRecurring, scheduleMode }) } finally { setConfirming(false) }
  }

  const placedCount    = proposals.filter(p => p.slot).length
  const unmatchedCount = proposals.filter(p => !p.slot).length

  const statusStyle = (s: ProposalStatus) =>
    s === 'matched'  ? { bg: '#f0fdf4', border: '#86efac', dot: '#16a34a', tag: '#dcfce7', tagText: '#166534', label: 'Matched' } :
    s === 'fallback' ? { bg: '#fffbeb', border: '#fde68a', dot: '#d97706', tag: '#fef3c7', tagText: '#92400e', label: 'Fallback' } :
                       { bg: '#fff1f2', border: '#fecdd3', dot: '#e11d48', tag: '#ffe4e6', tagText: '#9f1239', label: 'No slot' }

  const inputStyle: React.CSSProperties = { padding: '8px 12px', borderRadius: 10, border: '1.5px solid #94a3b8', fontSize: 13, outline: 'none', background: 'white', color: '#0f172a' }
  const btnSecondary: React.CSSProperties = { padding: '8px 14px', borderRadius: 10, border: '1.5px solid #94a3b8', fontSize: 12, fontWeight: 700, cursor: 'pointer', background: 'white', color: '#0f172a' }

  useEffect(() => {
  setStep('select');
  setProposals([]);
  setSuggestionsByNeed({});

  // Reset availability to whatever the new term's students have
  const next: Record<string, string[]> = {};
  students.forEach(s => {
    next[s.id] = [...(s.availabilityBlocks ?? [])];
  });
  setStudentAvailability(next);
  setPersistedAvailability(next);
  persistedAvailabilityRef.current = next;
  setDirtyAvailability(new Set());

  if (builderMode === 'batch') {
    setSelectedIds(new Set(
      students
        .filter(s =>
          Array.isArray(s.subjects) && s.subjects.length > 0 &&
          Array.isArray(s.availabilityBlocks) && s.availabilityBlocks.length > 0
        )
        .map(s => s.id)
    ));
  }
}, [selectedTermId, students, builderMode]);
  // Show a message if no students have subjects for the selected term
  const noSubjectsForTerm = students.every(s => !Array.isArray(s.subjects) || s.subjects.length === 0)

  return (
    <div
      style={{ position: 'fixed', inset: 0, zIndex: 9999, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20, background: 'rgba(2,6,23,0.72)', backdropFilter: 'blur(10px)' }}
      onClick={e => { if (e.target === e.currentTarget) onClose() }}
    >
      {generating && (
        <div style={{ position: 'absolute', inset: 0, zIndex: 20, background: 'rgba(248,250,252,0.88)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24, backdropFilter: 'blur(8px)' }}>
          <div style={{ width: '100%', maxWidth: 520, borderRadius: 28, background: 'white', border: '1px solid #e5e7eb', boxShadow: '0 24px 80px rgba(15,23,42,0.12)', padding: '32px', color: '#0f172a' }}>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
              <div>
                <p style={{ fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.28em', color: '#64748b', margin: 0 }}>{builderMode === 'single' ? 'Single book planner' : 'Batch book planner'}</p>
                <h2 style={{ fontSize: 26, fontWeight: 800, margin: '10px 0 0', lineHeight: 1.05 }}>{builderMode === 'single' ? 'Finding the best slot…' : 'Batch booking sessions…'}</h2>
              </div>
              <p style={{ margin: 0, color: '#475569', lineHeight: 1.75 }}>
                {builderMode === 'single'
                  ? 'Matching subject, tutor fit, and open seats for one booking.'
                  : 'Running placement engine — matching subjects, checking capacity, and optimizing batch assignments.'}
              </p>
              <div style={{ display: 'flex', gap: 10 }}>
                {[0, 1, 2, 3].map(i => (
                  <div key={i} style={{ flex: 1, height: 10, borderRadius: 999, background: '#e5e7eb', overflow: 'hidden' }}>
                    <div style={{ width: '100%', height: '100%', background: '#8b5cf6', animation: `growBar 1.2s ease-in-out ${i * 120}ms infinite alternate` }} />
                  </div>
                ))}
              </div>
            </div>
          </div>
          <style>{`@keyframes growBar { from { transform: scaleX(0.3); } to { transform: scaleX(1); } }`}</style>
        </div>
      )}

      <div style={{ width: '95vw', maxWidth: 1200, maxHeight: '92vh', background: 'white', borderRadius: 20, overflow: 'hidden', display: 'flex', flexDirection: 'column', border: '1px solid #cbd5e1', boxShadow: '0 36px 90px rgba(2,6,23,0.28)' }}>

        {/* Header */}
        <div style={{ padding: '18px 24px', borderBottom: '1px solid #e2e8f0', flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <div style={{ width: 36, height: 36, borderRadius: 10, background: '#ede9fe', border: '1px solid #c4b5fd', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <Sparkles size={16} style={{ color: '#5b21b6' }} />
            </div>
            <div>
              <p style={{ fontSize: 15, fontWeight: 700, color: '#0f172a', margin: 0 }}>{builderMode === 'single' ? 'Single Book' : 'Batch Book'}</p>
              <p style={{ fontSize: 11, fontWeight: 600, color: '#334155', margin: '3px 0 0' }}>
                {builderMode === 'single'
                  ? `Find the best open seat for one student · ${allAvailableSeats.length} options this week`
                  : `Week of ${weekStart} · ${allAvailableSeats.length} open seats`}
              </p>
            </div>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            {terms.length > 0 && (
              <div style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '5px 8px', borderRadius: 10, background: '#f8fafc', border: '1px solid #cbd5e1' }}>
                <span style={{ fontSize: 10, fontWeight: 800, letterSpacing: '0.04em', textTransform: 'uppercase', color: '#64748b' }}>Term</span>
                <div style={{ position: 'relative' }}>
                  <select
                    value={selectedTermId}
                    onChange={e => {
                      if (onChangeTerm) onChangeTerm(e.target.value);
                    }}
                    style={{ padding: '5px 26px 5px 8px', borderRadius: 8, border: '1px solid #cbd5e1', background: 'white', color: '#0f172a', fontSize: 11, fontWeight: 700, appearance: 'none', cursor: 'pointer', minWidth: 170 }}
                  >
                    {terms.map(term => (
                      <option key={term.id} value={term.id}>{term.name} ({term.status})</option>
                    ))}
                  </select>
                  <ChevronDown size={10} style={{ position: 'absolute', right: 8, top: '50%', transform: 'translateY(-50%)', color: '#64748b', pointerEvents: 'none' }} />
                </div>
              </div>
            )}
            <div style={{ display: 'flex', alignItems: 'center', gap: 4, padding: 4, borderRadius: 10, background: '#e2e8f0', border: '1px solid #94a3b8' }}>
              <button
                onClick={() => setBuilderMode('batch')}
                style={{ padding: '5px 10px', borderRadius: 8, border: 'none', cursor: 'pointer', fontSize: 11, fontWeight: 800, background: builderMode === 'batch' ? '#1d4ed8' : 'transparent', color: builderMode === 'batch' ? '#ffffff' : '#0f172a' }}>
                Batch Book
              </button>
              <button
                onClick={() => setBuilderMode('single')}
                style={{ padding: '5px 10px', borderRadius: 8, border: 'none', cursor: 'pointer', fontSize: 11, fontWeight: 800, background: builderMode === 'single' ? '#1d4ed8' : 'transparent', color: builderMode === 'single' ? '#ffffff' : '#0f172a' }}>
                Single Book
              </button>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '5px 8px', borderRadius: 10, background: '#f8fafc', border: '1px solid #cbd5e1' }}>
              {(['Select', 'Preview'] as const).map((label, i) => {
                const isActive = (i === 0 && step === 'select') || (i === 1 && step === 'preview')
                const isDone   = i === 0 && step === 'preview'
                return (
                  <div key={label} style={{ display: 'flex', alignItems: 'center', gap: 5, padding: '3px 8px', borderRadius: 7, background: isActive ? 'white' : 'transparent', boxShadow: isActive ? '0 1px 3px rgba(0,0,0,0.08)' : 'none' }}>
                    <div style={{ width: 16, height: 16, borderRadius: '50%', background: isDone || isActive ? '#7c3aed' : '#e2e8f0', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 9, fontWeight: 800, color: 'white' }}>
                      {isDone ? <Check size={9} /> : i + 1}
                    </div>
                    <span style={{ fontSize: 11, fontWeight: 600, color: isActive ? '#0f172a' : '#94a3b8' }}>{label}</span>
                  </div>
                )
              })}
            </div>
            <button onClick={onClose} style={{ width: 30, height: 30, borderRadius: 8, background: '#f8fafc', border: '1px solid #cbd5e1', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#475569' }}>
              <X size={14} />
            </button>
          </div>
        </div>

        {/* Step 1 — Select */}
        {step === 'select' && (
          <>
            {builderMode === 'batch' && (
              <div style={{ padding: '12px 24px', borderBottom: '1px solid #e2e8f0', flexShrink: 0, display: 'flex', alignItems: 'center', gap: 8, background: '#f8fafc' }}>
                <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search students…" style={{ ...inputStyle, flex: 1 }} />
                <button onClick={() => { students.forEach(s => { if (!selectedIds.has(s.id)) toggleStudent(s.id) }) }} style={btnSecondary}>All</button>
                <button onClick={() => { setSelectedIds(new Set()); setStudentNeeds({}) }} style={btnSecondary}>None</button>
                <button
                  onClick={() => setHideBooked(v => !v)}
                  title={hideBooked ? 'Show already-booked students' : 'Hide already-booked students'}
                  style={{ ...btnSecondary, background: hideBooked ? '#fef3c7' : 'white', borderColor: hideBooked ? '#fbbf24' : '#94a3b8', color: hideBooked ? '#92400e' : '#0f172a', whiteSpace: 'nowrap' }}>
                  {hideBooked ? 'Showing new only' : 'Hide booked'}
                </button>
              </div>
            )}



            <div style={{ overflowY: 'auto', flex: 1 }}>
              <div style={{ padding: '14px 24px 0' }}>
                <div style={{ borderRadius: 14, border: '1px solid #7c3aed', background: 'linear-gradient(180deg, #faf5ff 0%, #f8fafc 100%)', padding: 14, boxShadow: '0 10px 24px rgba(124,58,237,0.16)' }}>
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
                    <p style={{ margin: 0, fontSize: 11, fontWeight: 900, color: '#581c87', letterSpacing: '0.06em', textTransform: 'uppercase' }}>Constraints This Scheduler Uses</p>
                    <span style={{ fontSize: 10, fontWeight: 800, color: '#6d28d9', background: '#ede9fe', border: '1px solid #c4b5fd', borderRadius: 999, padding: '2px 8px' }}>Always enforced</span>
                  </div>
                  <div style={{ fontSize: 12, color: '#1e293b', lineHeight: 1.6 }}>
                    <span style={{ display: 'block' }}>1. Tutor subject compatibility.</span>
                    <span style={{ display: 'block' }}>2. Student availability blocks and no time collisions.</span>
                    <span style={{ display: 'block' }}>3. Tutor time-off and tutor availability windows.</span>
                    <span style={{ display: 'block' }}>4. Session seat capacity and consolidation priority.</span>
                  </div>
                </div>
              </div>

              {builderMode === 'single' ? (
                <div style={{ padding: 24, display: 'flex', flexDirection: 'column', gap: 16 }}>

                  {/* Student + Subject */}
                  <div style={{ background: 'white', border: '1.5px solid #e2e8f0', borderRadius: 14, padding: 20 }}>
                    <p style={{ margin: '0 0 14px', fontSize: 12, fontWeight: 700, color: '#64748b', textTransform: 'uppercase', letterSpacing: '0.06em' }}>Book a single session</p>
                    <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap' }}>
                      <div style={{ flex: 1, minWidth: 220 }}>
                        <label style={{ display: 'block', fontSize: 11, fontWeight: 700, color: '#64748b', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 6 }}>Student</label>
                        <div style={{ position: 'relative' }}>
                          <select
                            value={singleStudentId}
                            onChange={e => { setSingleStudentId(e.target.value) }}
                            style={{ width: '100%', padding: '9px 28px 9px 12px', borderRadius: 10, border: `1.5px solid ${singleStudentId ? '#7c3aed' : '#cbd5e1'}`, fontSize: 13, fontWeight: 600, color: singleStudentId ? '#0f172a' : '#94a3b8', background: 'white', outline: 'none', cursor: 'pointer', appearance: 'none' }}>
                            <option value="">Pick student…</option>
                            {students.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
                          </select>
                          <ChevronDown size={11} style={{ position: 'absolute', right: 10, top: '50%', transform: 'translateY(-50%)', color: '#94a3b8', pointerEvents: 'none' }} />
                        </div>
                      </div>
                      <div style={{ flex: 1, minWidth: 200 }}>
                        <label style={{ display: 'block', fontSize: 11, fontWeight: 700, color: '#64748b', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 6 }}>Subject</label>
                        <div style={{ position: 'relative' }}>
                          <select
                            value={singleSubject}
                            onChange={e => setSingleSubject(e.target.value)}
                            style={{ width: '100%', padding: '9px 28px 9px 12px', borderRadius: 10, border: `1.5px solid ${singleSubject ? '#7c3aed' : '#cbd5e1'}`, fontSize: 13, fontWeight: 600, color: singleSubject ? '#0f172a' : '#94a3b8', background: 'white', outline: 'none', cursor: 'pointer', appearance: 'none' }}>
                            <option value="">Pick subject…</option>
                            {subjectOptions.map(s => <option key={s} value={s}>{s}</option>)}
                          </select>
                          <ChevronDown size={11} style={{ position: 'absolute', right: 10, top: '50%', transform: 'translateY(-50%)', color: '#94a3b8', pointerEvents: 'none' }} />
                        </div>
                      </div>
                    </div>
                  </div>

                  {/* Single-session ad-hoc session blocks (does not modify stored availability) */}
                  {singleSelectedStudent && (
                    <div style={{ background: 'white', border: '1.5px solid #e2e8f0', borderRadius: 14, padding: 20 }}>
                      <p style={{ fontSize: 13, fontWeight: 700, color: '#0f172a', margin: 0 }}>
                        Session Preferences (optional)
                        {singleSessionBlocks.length === 0 && (
                          <span style={{ marginLeft: 8, fontSize: 11, fontWeight: 600, padding: '2px 8px', borderRadius: 20, background: '#fef9c3', color: '#854d0e', border: '1px solid #fde68a' }}>
                            Any session
                          </span>
                        )}
                        {singleSessionBlocks.length > 0 && (
                          <span style={{ marginLeft: 8, fontSize: 11, fontWeight: 700, padding: '2px 8px', borderRadius: 20, background: '#ede9fe', color: '#6d28d9', border: '1px solid #c4b5fd' }}>
                            {singleSessionBlocks.length} session block{singleSessionBlocks.length !== 1 ? 's' : ''}
                          </span>
                        )}
                      </p>
                      <p style={{ fontSize: 11, color: '#64748b', margin: '3px 0 12px' }}>
                        Pick specific day/session blocks for this one class only. If none selected, engine can place anywhere.
                      </p>

                      <div style={{ borderRadius: 10, border: '1px solid #e2e8f0', overflow: 'hidden', background: '#fff' }}>
                        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                          <thead>
                            <tr style={{ background: '#f8fafc', borderBottom: '1px solid #e2e8f0' }}>
                              <th style={{ textAlign: 'left', fontSize: 10, fontWeight: 800, color: '#64748b', padding: '7px 10px' }}>Session</th>
                              {AVAILABILITY_DAYS.map(d => (
                                <th key={d.dow} style={{ textAlign: 'center', fontSize: 10, fontWeight: 800, color: '#64748b', padding: '7px 6px' }}>{d.label}</th>
                              ))}
                            </tr>
                          </thead>
                          <tbody>
                            {builderSessionBlocks.map((block, i) => (
                              <tr key={block.id} style={{ borderBottom: i < builderSessionBlocks.length - 1 ? '1px solid #f1f5f9' : 'none' }}>
                                <td style={{ padding: '7px 10px' }}>
                                  <div style={{ fontSize: 11, fontWeight: 700, color: '#0f172a' }}>{block.label}</div>
                                  <div style={{ fontSize: 10, color: '#64748b' }}>{block.display}</div>
                                </td>
                                {AVAILABILITY_DAYS.map(d => {
                                  const applicable = block.days.includes(d.dow)
                                  const key = `${d.dow}-${block.time}`
                                  const active = applicable && singleSessionBlocks.includes(key)
                                  return (
                                    <td key={d.dow} style={{ padding: 6, textAlign: 'center' }}>
                                      {applicable ? (
                                        <button
                                          type="button"
                                          onClick={() => setSingleSessionBlocks(prev => prev.includes(key) ? prev.filter(x => x !== key) : [...prev, key])}
                                          style={{ width: 24, height: 24, borderRadius: 7, border: `1.5px solid ${active ? '#7c3aed' : '#cbd5e1'}`, background: active ? '#7c3aed' : 'white', color: active ? 'white' : '#94a3b8', fontSize: 11, fontWeight: 800, cursor: 'pointer' }}>
                                          {active ? '✓' : ''}
                                        </button>
                                      ) : (
                                        <div style={{ width: 24, height: 24, margin: '0 auto', borderRadius: 7, background: '#f1f5f9' }} />
                                      )}
                                    </td>
                                  )
                                })}
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>

                      <div style={{ marginTop: 10, display: 'flex', justifyContent: 'flex-end' }}>
                        <button
                          type="button"
                          onClick={() => setSingleSessionBlocks([])}
                          style={{ padding: '8px 10px', borderRadius: 8, border: '1.5px solid #cbd5e1', background: 'white', color: '#475569', fontSize: 11, fontWeight: 600, cursor: 'pointer' }}>
                          Clear selection
                        </button>
                      </div>
                    </div>
                  )}

                </div>
              ) : filteredStudents.length === 0 ? (
                <div style={{ padding: 24, textAlign: 'center', color: '#475569', fontSize: 13 }}>No students found</div>
              ) : filteredStudents.map(student => {
                const isSelected = selectedIds.has(student.id);
                const isBooked   = bookedStudentIds.has(student.id);
                const needs      = studentNeeds[student.id] ?? [];
                const hasEmpty   = needs.some(n => !n.subject);
                const selectedSubjects = Array.from(new Set(
                  needs
                    .map(need => need.subject?.trim())
                    .filter((subject): subject is string => Boolean(subject))
                ));
                const activeAvailability = studentAvailability[student.id] ?? student.availabilityBlocks ?? [];
                const hasUnsavedAvailability = dirtyAvailability.has(student.id);
                const isSavingAvailability = savingAvailability.has(student.id);
                // New: indicators for availability/subjects
                const hasAvail = Array.isArray(student.availabilityBlocks) && student.availabilityBlocks.length > 0;
                const hasSubjects = Array.isArray(student.subjects) && student.subjects.length > 0;

                return (
                  <div key={student.id} style={{ borderBottom: '1px solid #f1f5f9', background: isSelected ? '#fafafa' : 'white', transition: 'background 0.1s', borderLeft: isSelected ? '3px solid #7c3aed' : '3px solid transparent', padding: '6px 0' }}>
                    {/* Student row */}
                    <div
                      onClick={() => toggleStudent(student.id)}
                      style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 16px', cursor: 'pointer', opacity: isBooked ? 0.82 : 1, background: isSelected ? '#fafafa' : 'white', minHeight: 44 }}
                      onMouseEnter={e => { if (!isSelected) e.currentTarget.style.background = '#fafafa' }}
                      onMouseLeave={e => { if (!isSelected) e.currentTarget.style.background = 'white' }}
                    >
                      <div style={{ width: 18, height: 18, borderRadius: 5, border: `1.5px solid ${isSelected ? '#7c3aed' : '#cbd5e1'}`, background: isSelected ? '#7c3aed' : 'white', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, transition: 'all 0.15s' }}>
                        {isSelected && <Check size={11} color="white" strokeWidth={3} />}
                      </div>
                      <div style={{ width: 28, height: 28, borderRadius: 7, background: isSelected ? '#7c3aed' : '#1f2937', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 13, fontWeight: 800, color: 'white', flexShrink: 0 }}>
                        {student.name.charAt(0)}
                      </div>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <p style={{ fontSize: 13, fontWeight: 700, color: '#0f172a', margin: 0 }}>{student.name}</p>
                        {student.grade && <p style={{ fontSize: 11, color: '#6b7280', margin: 0 }}>Grade {student.grade}</p>}
                      </div>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                        {/* New: compact indicators */}
                        {hasAvail && <span style={{ fontSize: 10, fontWeight: 700, padding: '2px 7px', borderRadius: 20, background: '#ede9fe', color: '#6d28d9', border: '1px solid #c4b5fd' }}>Avail</span>}
                        {hasSubjects && <span style={{ fontSize: 10, fontWeight: 700, padding: '2px 7px', borderRadius: 20, background: '#dcfce7', color: '#15803d', border: '1px solid #86efac' }}>Subjects</span>}
                        {isBooked && <span style={{ fontSize: 10, fontWeight: 700, padding: '2px 7px', borderRadius: 20, background: '#f1f5f9', color: '#64748b', border: '1px solid #cbd5e1' }}>Booked</span>}
                        {hasUnsavedAvailability && <span style={{ fontSize: 10, fontWeight: 700, padding: '2px 7px', borderRadius: 20, background: '#fef3c7', color: '#92400e', border: '1px solid #fcd34d' }}>Unsaved</span>}
                        {isSelected && hasEmpty && <span style={{ fontSize: 10, fontWeight: 700, padding: '2px 7px', borderRadius: 20, background: '#fee2e2', color: '#dc2626', border: '1px solid #fca5a5' }}>Pick subject</span>}
                      </div>
                    </div>

                    {/* Subject rows — shown when selected */}
                    {isSelected && (
                      <div style={{ padding: '0 16px 10px 54px', display: 'flex', flexDirection: 'column', gap: 8 }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                          <button
                            type="button"
                            onClick={e => { e.stopPropagation(); setAvailabilityOpenFor(prev => prev === student.id ? null : student.id) }}
                            style={{ padding: '5px 9px', borderRadius: 8, border: '1.5px solid #c4b5fd', background: '#f5f3ff', color: '#6d28d9', fontSize: 11, fontWeight: 700, cursor: 'pointer' }}>
                            {availabilityOpenFor === student.id ? 'Hide availability' : 'Edit availability'}
                          </button>
                          {availabilityOpenFor === student.id && (
                            <>
                              <button
                                type="button"
                                onClick={e => { e.stopPropagation(); resetAvailability(student.id) }}
                                disabled={isSavingAvailability || !hasUnsavedAvailability}
                                style={{ padding: '5px 9px', borderRadius: 8, border: '1.5px solid #cbd5e1', background: 'white', color: '#475569', fontSize: 11, fontWeight: 600, cursor: isSavingAvailability || !hasUnsavedAvailability ? 'not-allowed' : 'pointer', opacity: isSavingAvailability || !hasUnsavedAvailability ? 0.55 : 1 }}>
                                Discard
                              </button>
                              <button
                                type="button"
                                onClick={e => { e.stopPropagation(); void saveAvailabilityEdits(student.id) }}
                                disabled={isSavingAvailability || !hasUnsavedAvailability}
                                style={{ padding: '5px 9px', borderRadius: 8, border: '1.5px solid #6d28d9', background: '#7c3aed', color: 'white', fontSize: 11, fontWeight: 700, cursor: isSavingAvailability || !hasUnsavedAvailability ? 'not-allowed' : 'pointer', opacity: isSavingAvailability || !hasUnsavedAvailability ? 0.55 : 1 }}>
                                {isSavingAvailability ? 'Saving...' : 'Save availability'}
                              </button>
                            </>
                          )}
                        </div>

                        {availabilityOpenFor === student.id && (
                          <div style={{ borderRadius: 10, border: '1px solid #e2e8f0', overflow: 'hidden', background: '#fff' }}>
                            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                              <thead>
                                <tr style={{ background: '#f8fafc', borderBottom: '1px solid #e2e8f0' }}>
                                  <th style={{ textAlign: 'left', fontSize: 10, fontWeight: 800, color: '#64748b', padding: '7px 10px', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                                    <span>Session</span>
                                    {isSavingAvailability && (
                                      <span style={{ fontSize: 9, color: '#7c3aed', fontWeight: 600, display: 'flex', alignItems: 'center', gap: 3 }}>
                                        <span style={{ display: 'inline-block', width: 8, height: 8, borderRadius: '50%', background: '#7c3aed', animation: 'pulse 1.5s infinite' }} />
                                        saving
                                      </span>
                                    )}
                                    {!isSavingAvailability && hasUnsavedAvailability && (
                                      <span style={{ fontSize: 9, color: '#92400e', fontWeight: 700 }}>
                                        unsaved edits
                                      </span>
                                    )}
                                  </th>
                                  {AVAILABILITY_DAYS.map(d => (
                                    <th key={d.dow} style={{ textAlign: 'center', fontSize: 10, fontWeight: 800, color: '#64748b', padding: '7px 6px' }}>{d.label}</th>
                                  ))}
                                </tr>
                              </thead>
                              <tbody>
                                {builderSessionBlocks.map((block, i) => (
                                  <tr key={block.id} style={{ borderBottom: i < builderSessionBlocks.length - 1 ? '1px solid #f1f5f9' : 'none' }}>
                                    <td style={{ padding: '7px 10px' }}>
                                      <div style={{ fontSize: 11, fontWeight: 700, color: '#0f172a' }}>{block.label}</div>
                                      <div style={{ fontSize: 10, color: '#64748b' }}>{block.display}</div>
                                    </td>
                                    {AVAILABILITY_DAYS.map(d => {
                                      const applicable = block.days.includes(d.dow);
                                      const active = applicable && activeAvailability.includes(`${d.dow}-${block.time}`);
                                      return (
                                        <td key={d.dow} style={{ padding: 6, textAlign: 'center' }}>
                                          {applicable ? (
                                            <button
                                              type="button"
                                              onClick={e => { e.stopPropagation(); toggleAvailabilityBlock(student.id, d.dow, block.time) }}
                                              style={{
                                                width: 24,
                                                height: 24,
                                                borderRadius: 7,
                                                border: `1.5px solid ${active ? '#7c3aed' : '#cbd5e1'}`,
                                                background: active ? '#7c3aed' : 'white',
                                                color: active ? 'white' : '#94a3b8',
                                                fontSize: 11,
                                                fontWeight: 800,
                                                cursor: 'pointer',
                                              }}>
                                              {active ? '✓' : ''}
                                            </button>
                                          ) : (
                                            <div style={{ width: 24, height: 24, margin: '0 auto', borderRadius: 7, background: '#f1f5f9' }} />
                                          )}
                                        </td>
                                      );
                                    })}
                                  </tr>
                                ))}
                              </tbody>
                            </table>
                          </div>
                        )}

                        {needs.map((need, idx) => {
                          const isAlreadyBooked = scheduleMode === 'add' && !!need.subject && (bookedSubjectsByStudent[student.id]?.has(need.subject.trim().toLowerCase()) ?? false)
                          return (
                          <div key={need.needId} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                            <div style={{ width: 20, height: 20, borderRadius: 6, background: '#f1f5f9', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 10, fontWeight: 700, color: '#64748b', flexShrink: 0 }}>
                              {idx + 1}
                            </div>
                            <div style={{ position: 'relative', flex: 1, maxWidth: 380 }}>
                              <select
                                value={need.subject}
                                onChange={e => setSubject(student.id, need.needId, e.target.value)}
                                onClick={e => e.stopPropagation()}
                                style={{ width: '100%', padding: '7px 28px 7px 12px', borderRadius: 10, border: `1.5px solid ${!need.subject ? '#ef4444' : isAlreadyBooked ? '#94a3b8' : '#7c3aed'}`, fontSize: 13, fontWeight: 600, color: need.subject ? (isAlreadyBooked ? '#64748b' : '#0f172a') : '#334155', background: isAlreadyBooked ? '#f8fafc' : 'white', outline: 'none', cursor: 'pointer', appearance: 'none' }}
                              >
                                <option value="">Pick subject…</option>
                                {subjectOptions.map(s => <option key={s} value={s}>{s}</option>)}
                              </select>
                              <ChevronDown size={11} style={{ position: 'absolute', right: 9, top: '50%', transform: 'translateY(-50%)', color: '#94a3b8', pointerEvents: 'none' }} />
                            </div>
                            {isAlreadyBooked && (
                              <span title="This student is already booked for this subject this week and will be skipped. Switch to Redo mode to reassign." style={{ fontSize: 10, fontWeight: 700, padding: '2px 7px', borderRadius: 20, background: '#f1f5f9', color: '#64748b', border: '1px solid #cbd5e1', flexShrink: 0, whiteSpace: 'nowrap' }}>
                                Already booked · skipped
                              </span>
                            )}
                            {needs.length > 1 && (
                              <button
                                onClick={e => { e.stopPropagation(); removeSubjectRow(student.id, need.needId) }}
                                style={{ width: 28, height: 28, borderRadius: 8, border: '1.5px solid #fecdd3', background: '#fff1f2', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#e11d48', flexShrink: 0 }}
                              >
                                <Trash2 size={11} />
                              </button>
                            )}
                          </div>
                          )
                        })}
                        {needs.length < 3 && (
                          <button
                            onClick={e => { e.stopPropagation(); addSubjectRow(student.id) }}
                            style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '6px 12px', borderRadius: 8, border: '1.5px dashed #c4b5fd', background: 'transparent', color: '#7c3aed', fontSize: 12, fontWeight: 600, cursor: 'pointer', width: 'fit-content' }}
                          >
                            <Plus size={11} /> Add subject
                          </button>
                        )}
                      </div>
                    )}
                  </div>
                )
              })}
            </div>

            <div style={{ padding: '14px 24px', borderTop: '1px solid #e2e8f0', background: '#f8fafc', flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <div style={{ fontSize: 12, color: missingSubject ? '#e11d48' : '#64748b', margin: 0 }}>
                {builderMode === 'single'
                  ? (!singleSelectedStudent || !singleSubject
                      ? 'Pick a student and subject to generate single-session suggestions'
                      : `Generate suggestions for ${singleSelectedStudent.name} · ${singleSubject}`)
                  : selectedCount === 0
                  ? 'Select students to schedule'
                  : missingSubject
                  ? 'Some students are missing a subject'
                  : (() => {
                      const skippedCount = scheduleMode === 'add' ? allNeeds.filter(n => bookedSubjectsByStudent[n.student.id]?.has(n.subject.trim().toLowerCase())).length : 0
                      const activeCount = allNeeds.length - skippedCount
                      return (
                        <span>
                          {activeCount} session{activeCount !== 1 ? 's' : ''} to book across {selectedCount} student{selectedCount !== 1 ? 's' : ''}
                          {skippedCount > 0 && (
                            <span style={{ marginLeft: 6, fontSize: 11, color: '#94a3b8' }}>
                              · {skippedCount} already booked (skipped)
                            </span>
                          )}
                        </span>
                      )
                    })()
                }
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                {/* Mode toggle: Add to schedule vs Redo */}
                <div style={{ display: 'flex', alignItems: 'center', borderRadius: 10, border: '1.5px solid #e2e8f0', overflow: 'hidden', background: 'white', fontSize: 11, fontWeight: 700 }}>
                  <button
                    type="button"
                    onClick={() => setScheduleMode('add')}
                    title="Add to existing schedule — already-booked students are skipped"
                    style={{ padding: '6px 11px', border: 'none', cursor: 'pointer', background: scheduleMode === 'add' ? '#0f172a' : 'white', color: scheduleMode === 'add' ? 'white' : '#64748b', transition: 'all 0.15s' }}
                  >
                    Add
                  </button>
                  <button
                    type="button"
                    onClick={() => setScheduleMode('redo')}
                    title="Redo the whole schedule — ignores existing bookings and reschedules everyone"
                    style={{ padding: '6px 11px', border: 'none', borderLeft: '1.5px solid #e2e8f0', cursor: 'pointer', background: scheduleMode === 'redo' ? '#dc2626' : 'white', color: scheduleMode === 'redo' ? 'white' : '#64748b', transition: 'all 0.15s' }}
                  >
                    Redo
                  </button>
                </div>
                <button
                  type="button"
                  onClick={() => setMakeRecurring(r => !r)}
                  title={makeRecurring ? 'Bookings will recur weekly through term end. Click to make one-time only.' : 'Bookings will be one-time only. Click to make recurring.'}
                  style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '7px 12px', borderRadius: 10, border: `1.5px solid ${makeRecurring ? '#7c3aed' : '#94a3b8'}`, background: makeRecurring ? '#ede9fe' : 'white', color: makeRecurring ? '#6d28d9' : '#64748b', fontSize: 11, fontWeight: 700, cursor: 'pointer', transition: 'all 0.15s' }}
                >
                  <div style={{ width: 14, height: 14, borderRadius: 4, border: `1.5px solid ${makeRecurring ? '#7c3aed' : '#94a3b8'}`, background: makeRecurring ? '#7c3aed' : 'white', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                    {makeRecurring && <Check size={9} color="white" strokeWidth={3} />}
                  </div>
                  Recurring
                </button>
                <button
                  onClick={generate}
                  disabled={!canGenerate}
                  style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '10px 22px', borderRadius: 12, border: 'none', cursor: canGenerate ? 'pointer' : 'not-allowed', background: canGenerate ? '#7c3aed' : '#e2e8f0', color: canGenerate ? 'white' : '#94a3b8', fontSize: 13, fontWeight: 700, boxShadow: canGenerate ? '0 4px 16px rgba(124,58,237,0.3)' : 'none', transition: 'all 0.2s' }}
                >
                  {generating ? <><Loader2 size={14} className="animate-spin" /> Generating…</> : <>Generate <ArrowRight size={13} /></>}
                </button>
              </div>
            </div>
          </>
        )}

        {/* Step 2 — Preview */}
        {step === 'preview' && (
          <>
            <div style={{ padding: '12px 24px', borderBottom: '1px solid #e2e8f0', background: '#f8fafc', flexShrink: 0, display: 'flex', alignItems: 'center', gap: 10 }}>
              <span style={{ fontSize: 11, fontWeight: 600, padding: '3px 10px', borderRadius: 20, background: '#f0fdf4', color: '#16a34a' }}>{placedCount} placed</span>
              {unmatchedCount > 0 && <span style={{ fontSize: 11, fontWeight: 600, padding: '3px 10px', borderRadius: 20, background: '#fff1f2', color: '#e11d48' }}>{unmatchedCount} unmatched</span>}
              <span style={{ fontSize: 11, fontWeight: 600, padding: '3px 10px', borderRadius: 20, background: '#e0f2fe', color: '#0369a1' }}>
                Ratio {currentRatioMetrics.ratio.toFixed(2)}
              </span>
              {builderMode === 'single' && singleSessionBlocks.length > 0 && (
                <span style={{ fontSize: 11, fontWeight: 700, padding: '3px 10px', borderRadius: 20, background: '#ede9fe', color: '#6d28d9', border: '1px solid #c4b5fd' }}>
                  Only showing selected session blocks ({singleSessionBlocks.length})
                </span>
              )}
              <span style={{ fontSize: 11, color: '#334155', fontWeight: 600, marginLeft: 4 }}>Week of {weekStart}</span>
              <button onClick={() => setStep('select')} style={{ ...btnSecondary, marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 6 }}>
                <RotateCcw size={11} /> Back
              </button>
            </div>

            <div style={{ overflowY: 'auto', flex: 1, padding: '20px 24px' }}>
              <SchedulePreviewGrid
                proposals={proposals}
                suggestionsByNeed={suggestionsByNeed}
                allAvailableSeats={previewSeatPool}
                sessionTimesByDay={sessionTimesByDay ?? null}
                existingSessions={sessions.map((s: any) => ({
                  date: s.date,
                  tutorId: s.tutorId,
                  time: s.time,
                  students: (s.students ?? [])
                    .filter((st: any) => st.status !== 'cancelled')
                    .map((st: any) => ({
                      studentName: st.name,
                      topic: st.topic,
                      status: st.status,
                      seriesId: st.seriesId ?? null,
                    })),
                }))}
                onSwap={swapSlot}
                onRemove={removeProposal}
              />
            </div>

            <div style={{ padding: '14px 24px', borderTop: '1px solid #e2e8f0', background: '#f8fafc', flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <p style={{ fontSize: 11, color: unmatchedCount > 0 ? '#e11d48' : '#64748b', margin: 0, display: 'flex', alignItems: 'center', gap: 5 }}>
                  {unmatchedCount > 0 && <AlertTriangle size={11} />}
                  {unmatchedCount > 0 ? `${unmatchedCount} couldn't be placed — book manually` : 'All sessions placed successfully'}
                </p>
                <span
                  style={{ fontSize: 10, fontWeight: 700, padding: '2px 8px', borderRadius: 20, background: makeRecurring ? '#ede9fe' : '#f1f5f9', color: makeRecurring ? '#6d28d9' : '#64748b', border: `1px solid ${makeRecurring ? '#c4b5fd' : '#cbd5e1'}`, cursor: 'pointer', flexShrink: 0 }}
                  onClick={() => setMakeRecurring(r => !r)}
                  title="Toggle recurring"
                >
                  {makeRecurring ? 'Recurring' : 'One-time'}
                </span>
              </div>
              <button
                onClick={handleConfirm}
                disabled={placedCount === 0 || confirming}
                style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '10px 22px', borderRadius: 12, border: 'none', cursor: placedCount === 0 ? 'not-allowed' : 'pointer', background: placedCount > 0 ? '#0f172a' : '#e2e8f0', color: placedCount > 0 ? 'white' : '#94a3b8', fontSize: 13, fontWeight: 700, boxShadow: placedCount > 0 ? '0 4px 12px rgba(0,0,0,0.15)' : 'none' }}
              >
                {confirming ? <><Loader2 size={14} className="animate-spin" /> Booking…</> : <><Check size={14} /> Confirm {placedCount} Booking{placedCount !== 1 ? 's' : ''}</>}
              </button>
            </div>
          </>
        )}
      </div>

      <style>{`
        @keyframes pulse {
          0%, 100% { opacity: 1; }
          50% { opacity: 0.5; }
        }
      `}</style>
    </div>
  )
}