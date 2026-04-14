import { NextRequest, NextResponse } from 'next/server'

// ── Types ─────────────────────────────────────────────────────────────────────

interface SeatInput {
  index: number
  tutorId: string
  tutorName: string
  tutorSubjects: string[]
  tutorCat: string
  day: string
  dayNum: number
  date: string
  time: string
  seatsLeft: number
  occupied?: number
  maxCapacity?: number
  label?: string
}

interface StudentNeed {
  studentId: string
  studentName: string
  subject: string
  availabilityBlocks: string[]   // "dayNum-HH:MM" format
  allowSameDayDouble?: boolean   // default false
}

interface ExistingBooking {
  studentId: string
  existingSlots: string[]        // "date-HH:MM" format
}

interface RequestBody {
  needs: StudentNeed[]           // one entry per subject per student
  availableSeats: SeatInput[]
  existingBookings: ExistingBooking[]
  weekStart: string
  weekEnd: string
}

interface Assignment {
  studentId: string
  subject: string
  slotIndex: number | null
  status: 'matched' | 'fallback' | 'unmatched'
  reason: string
}

// ── Subject matching ──────────────────────────────────────────────────────────

function subjectMatches(subject: string, tutorSubjects: string[]): boolean {
  if (!subject) return false
  const s = subject.toLowerCase().trim()
  return tutorSubjects.some(ts => {
    const t = ts.toLowerCase().trim()
    return t === s || t.includes(s) || s.includes(t)
  })
}

// ── Availability check ────────────────────────────────────────────────────────

function studentAvailable(availabilityBlocks: string[], dayNum: number, time: string): boolean {
  if (!availabilityBlocks || availabilityBlocks.length === 0) return true
  return availabilityBlocks.includes(`${dayNum}-${time}`)
}

// ── No-gap check ──────────────────────────────────────────────────────────────
// Given a tutor's already-assigned times on a day (sorted), check if adding
// a new time would create a gap. C2 session times: 11:00, 13:30, 15:30, 17:30, 19:30
// A gap = two assigned times with an unassigned time between them.

const SESSION_ORDER = ['11:00', '13:30', '15:30', '17:30', '19:30']

function wouldCreateGap(
  existingTimesOnDay: string[],
  newTime: string,
  allSeatTimesOnDay: string[] // all times that have a seat (assigned or available)
): boolean {
  if (existingTimesOnDay.length === 0) return false

  const assigned = [...existingTimesOnDay, newTime]
  const occupied = SESSION_ORDER.filter(t => assigned.includes(t))
  if (occupied.length < 2) return false

  const min = occupied[0]
  const max = occupied[occupied.length - 1]
  const minIdx = SESSION_ORDER.indexOf(min)
  const maxIdx = SESSION_ORDER.indexOf(max)

  // Every session slot between min and max must be either assigned or available
  for (let i = minIdx + 1; i < maxIdx; i++) {
    const t = SESSION_ORDER[i]
    if (!assigned.includes(t) && !allSeatTimesOnDay.includes(t)) {
      // There's a gap that can't be filled
      return true
    }
  }
  return false
}

// ── Scoring ───────────────────────────────────────────────────────────────────

function scoreSlot(
  seat: SeatInput,
  need: StudentNeed,
  capacityMap: Record<number, number>,
  assignedCounts: Record<number, number>,
  daysAlreadyBookedThisRun: Set<number>, // days already assigned to this student in this run
): number {
  let score = 0
  const remaining = (capacityMap[seat.index] ?? 0) - (assignedCounts[seat.index] ?? 0)

  // Availability match
  const hasAvail = studentAvailable(need.availabilityBlocks, seat.dayNum, seat.time)
  if (hasAvail) score += 10

  // Prefer filling existing sessions over opening new ones.
  const baseOccupied = typeof seat.occupied === 'number'
    ? seat.occupied
    : Math.max(0, (seat.maxCapacity ?? 3) - seat.seatsLeft)
  score += baseOccupied * 10

  // Small bonus for extra fill created during this run.
  const runAssignedHere = assignedCounts[seat.index] ?? 0
  score += runAssignedHere * 4

  // Prefer different days from already-assigned sessions this run
  if (!daysAlreadyBookedThisRun.has(seat.dayNum)) score += 8
  else score -= 15  // strong penalty for same day (still allowed as fallback)

  // Prefer mid-week (Tue/Wed/Thu) over Mon/Sat for balance
  const dayBalance: Record<number, number> = { 1: 0, 2: 3, 3: 4, 4: 3, 6: 1 }
  score += dayBalance[seat.dayNum] ?? 0

  return score
}

// ── Main engine ───────────────────────────────────────────────────────────────

export async function POST(req: NextRequest) {
  const body: RequestBody = await req.json()
  const { needs, availableSeats, existingBookings, weekStart, weekEnd } = body

  if (!needs?.length || !availableSeats?.length) {
    return NextResponse.json({ assignments: [] })
  }

  // Build existing booking lookup: studentId → Set<"date-time">
  const existingByStudent: Record<string, Set<string>> = {}
  for (const eb of existingBookings ?? []) {
    existingByStudent[eb.studentId] = new Set(eb.existingSlots)
  }

  // Capacity map: slotIndex → remaining seats
  const capacityMap: Record<number, number> = {}
  for (const s of availableSeats) {
    capacityMap[s.index] = s.seatsLeft
  }

  // Track how many we've assigned to each slot this run
  const assignedCounts: Record<number, number> = {}

  // Track which tutor+day combos have assigned times (for no-gap check)
  // key: "tutorId-date" → string[]
  const tutorDayAssigned: Record<string, string[]> = {}

  // Track all available times per tutor+day (for gap feasibility check)
  // key: "tutorId-date" → string[]
  const tutorDayAvailable: Record<string, string[]> = {}
  for (const s of availableSeats) {
    const key = `${s.tutorId}-${s.date}`
    if (!tutorDayAvailable[key]) tutorDayAvailable[key] = []
    if (!tutorDayAvailable[key].includes(s.time)) tutorDayAvailable[key].push(s.time)
  }

  // Track days booked per student in THIS run (for spread preference)
  // key: studentId → Set<dayNum>
  const studentDaysThisRun: Record<string, Set<number>> = {}

  // Track date+time booked per student in THIS run (for same-slot conflict)
  // key: studentId → Set<"date-time">
  const studentSlotsThisRun: Record<string, Set<string>> = {}

  // Sort needs: most constrained first (fewest valid slots)
  const getRemainingCapacity = (index: number) =>
    (capacityMap[index] ?? 0) - (assignedCounts[index] ?? 0)

  const sortedNeeds = [...needs].sort((a, b) => {
    const aValid = availableSeats.filter(s =>
      subjectMatches(a.subject, s.tutorSubjects) && getRemainingCapacity(s.index) > 0
    ).length
    const bValid = availableSeats.filter(s =>
      subjectMatches(b.subject, s.tutorSubjects) && getRemainingCapacity(s.index) > 0
    ).length
    return aValid - bValid
  })

  const assignments: Assignment[] = []

  for (const need of sortedNeeds) {
    const daysBooked = studentDaysThisRun[need.studentId] ?? new Set<number>()
    const slotsBooked = studentSlotsThisRun[need.studentId] ?? new Set<string>()
    const existingSlots = existingByStudent[need.studentId] ?? new Set<string>()

    // Filter to base candidates (ignoring student availability first)
    const baseCandidates = availableSeats
      .filter(s => {
        // Subject must match
        if (!subjectMatches(need.subject, s.tutorSubjects)) return false

        // Must have remaining capacity
        if (getRemainingCapacity(s.index) <= 0) return false

        // Cannot conflict with existing DB bookings (same date+time)
        if (existingSlots.has(`${s.date}-${s.time}`)) return false

        // Cannot conflict with other assignments in this run (same date+time)
        if (slotsBooked.has(`${s.date}-${s.time}`)) return false

        // No-gap check
        const tutorDayKey = `${s.tutorId}-${s.date}`
        const alreadyOnDay = tutorDayAssigned[tutorDayKey] ?? []
        const availableOnDay = tutorDayAvailable[tutorDayKey] ?? []
        if (wouldCreateGap(alreadyOnDay, s.time, availableOnDay)) return false

        return true
      })

    // Student availability is a hard constraint when blocks are provided
    const candidates = baseCandidates.filter(s =>
      studentAvailable(need.availabilityBlocks, s.dayNum, s.time)
    )

    if (candidates.length === 0) {
      assignments.push({
        studentId: need.studentId,
        subject: need.subject,
        slotIndex: null,
        status: 'unmatched',
        reason: baseCandidates.length > 0 && (need.availabilityBlocks?.length ?? 0) > 0
          ? `No ${need.subject} slot matches student availability this week`
          : `No available ${need.subject} tutor with capacity this week`,
      })
      continue
    }

    // Score and pick best
    const scored = candidates
      .map(s => ({
        seat: s,
        score: scoreSlot(s, need, capacityMap, assignedCounts, daysBooked),
      }))
      .sort((a, b) => b.score - a.score)

    const best = scored[0].seat

    // Claim the slot
    assignedCounts[best.index] = (assignedCounts[best.index] ?? 0) + 1

    // Update tutor-day tracking for gap constraint
    const tutorDayKey = `${best.tutorId}-${best.date}`
    if (!tutorDayAssigned[tutorDayKey]) tutorDayAssigned[tutorDayKey] = []
    tutorDayAssigned[tutorDayKey].push(best.time)

    // Update student tracking
    if (!studentDaysThisRun[need.studentId]) studentDaysThisRun[need.studentId] = new Set()
    studentDaysThisRun[need.studentId].add(best.dayNum)

    if (!studentSlotsThisRun[need.studentId]) studentSlotsThisRun[need.studentId] = new Set()
    studentSlotsThisRun[need.studentId].add(`${best.date}-${best.time}`)

    assignments.push({
      studentId: need.studentId,
      subject: need.subject,
      slotIndex: best.index,
      status: 'matched',
      reason: 'Subject and availability match',
    })
  }

  return NextResponse.json({ assignments })
}