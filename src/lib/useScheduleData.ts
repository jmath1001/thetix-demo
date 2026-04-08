import { useEffect, useState } from 'react'
import { supabase } from '@/lib/supabaseClient'

// ── Table names — swap prefix via NEXT_PUBLIC_TABLE_PREFIX env var ────────────
const p              = process.env.NEXT_PUBLIC_TABLE_PREFIX ?? 'slake'
const TUTORS         = `${p}_tutors`
const STUDENTS       = `${p}_students`
const SESSIONS       = `${p}_sessions`
const SS             = `${p}_session_students`   // short alias used in nested selects
const RECURRING      = `${p}_recurring_series`
const TIME_OFF       = `${p}_tutor_time_off`
const MATH_TOPICS    = ['Algebra', 'Geometry', 'Pre-Calculus', 'Calculus', 'Statistics', 'SAT Math', 'ACT Math', 'Math']
const ENG_TOPICS     = ['Reading', 'Writing', 'Grammar', 'Essay', 'SAT English', 'ACT English', 'English']

// ── Types ─────────────────────────────────────────────────────────────────────

export type Tutor = {
  id: string
  name: string
  subjects: string[]
  cat: string
  availability: number[]
  availabilityBlocks: string[]
}

export type Student = {
  id: string
  name: string
  subject: string
  grade: string | null
  hoursLeft: number
  availabilityBlocks: string[]
  email: string | null
  phone: string | null
  parent_name: string | null
  parent_email: string | null
  parent_phone: string | null
  bluebook_url: string | null
}

export type SessionStudent = {
  rowId: string
  id: string
  name: string
  topic: string
  status: string
  grade: string | null
  notes: string | null
  confirmationStatus: string | null
  seriesId: string | null
}

export type Session = {
  id: string
  date: string
  tutorId: string
  time: string
  students: SessionStudent[]
}

export type TimeOff = {
  id: string
  tutorId: string
  date: string
  note: string
}

export type RecurringSeries = {
  id: string
  createdAt: string
  studentId: string
  studentName: string
  tutorId: string
  tutorName: string
  dayOfWeek: number
  time: string
  topic: string
  notes: string | null
  startDate: string
  endDate: string
  totalWeeks: number
  status: 'active' | 'completed' | 'cancelled'
}

export type ScheduleData = {
  tutors: Tutor[]
  students: Student[]
  sessions: Session[]
  timeOff: TimeOff[]
  loading: boolean
  error: string | null
  refetch: () => void
}

// ── Date helpers ──────────────────────────────────────────────────────────────

export function getCentralTimeNow(): Date {
  return new Date(new Date().toLocaleString('en-US', { timeZone: 'America/Chicago' }))
}

export function getWeekStart(d: Date): Date {
  const date = new Date(d)
  const day = date.getDay()
  const diff = day === 0 ? -6 : 1 - day
  date.setDate(date.getDate() + diff)
  date.setHours(0, 0, 0, 0)
  return date
}

export function toISODate(d: Date): string {
  const year = d.getFullYear()
  const month = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

export function getWeekDates(weekStart: Date): Date[] {
  return Array.from({ length: 7 }, (_, i) => {
    const d = new Date(weekStart)
    d.setDate(d.getDate() + i)
    return d
  })
}

export function dayOfWeek(isoDate: string): number {
  const d = new Date(isoDate + 'T00:00:00')
  const js = d.getDay()
  return js === 0 ? 7 : js
}

export function formatDate(isoDate: string): string {
  return new Date(isoDate + 'T00:00:00').toLocaleDateString('en-US', {
    weekday: 'short', month: 'short', day: 'numeric',
  })
}

export function getOccupiedBlocks(startTime: string, durationMinutes: number): string[] {
  const [h, m] = startTime.split(':').map(Number)
  const blocks: string[] = []
  const totalMinutes = h * 60 + m
  const numBlocks = Math.ceil(durationMinutes / 30)
  for (let i = 0; i < numBlocks; i++) {
    const blockMinutes = totalMinutes + i * 30
    const bh = Math.floor(blockMinutes / 60)
    const bm = blockMinutes % 60
    blocks.push(`${String(bh).padStart(2, '0')}:${String(bm).padStart(2, '0')}`)
  }
  return blocks
}

// ── Hook ──────────────────────────────────────────────────────────────────────

export function useScheduleData(weekStart: Date): ScheduleData {
  const [tutors,   setTutors]   = useState<Tutor[]>([])
  const [students, setStudents] = useState<Student[]>([])
  const [sessions, setSessions] = useState<Session[]>([])
  const [timeOff,  setTimeOff]  = useState<TimeOff[]>([])
  const [loading,  setLoading]  = useState(true)
  const [error,    setError]    = useState<string | null>(null)
  const [tick,     setTick]     = useState(0)

  const refetch = () => setTick(t => t + 1)

  useEffect(() => {
    let cancelled = false

    async function load() {
      setLoading(true)
      setError(null)

      const weekEnd = new Date(weekStart)
      weekEnd.setDate(weekEnd.getDate() + 6)
      const from = toISODate(weekStart)
      const to   = toISODate(weekEnd)

      try {
        const [tutorRes, studentRes, sessionRes, timeOffRes] = await Promise.all([
          supabase.from(TUTORS).select('*').order('name'),
          supabase.from(STUDENTS).select('*').order('name'),
          (supabase
            .from(SESSIONS)
            .select(`id, session_date, tutor_id, time, ${SS} ( id, student_id, name, topic, status, notes, confirmation_status, series_id )`)
            .gte('session_date', from)
            .lte('session_date', to)
            .order('session_date')
            .order('time') as any),
          supabase
            .from(TIME_OFF)
            .select('*')
            .gte('date', from)
            .lte('date', to),
        ])

        if (tutorRes.error)   throw tutorRes.error
        if (studentRes.error) throw studentRes.error
        if (sessionRes.error) throw sessionRes.error
        if (timeOffRes.error) throw timeOffRes.error

        const tutors: Tutor[] = (tutorRes.data ?? []).map((r: any) => ({
          id:                 r.id,
          name:               r.name,
          subjects:           r.subjects ?? [],
          cat:                r.cat,
          availability:       r.availability ?? [],
          availabilityBlocks: r.availability_blocks ?? [],
        }))

        const students: Student[] = (studentRes.data ?? []).map((r: any) => ({
          id:                 r.id,
          name:               r.name,
          subject:            r.subject,
          grade:              r.grade ?? null,
          hoursLeft:          r.hours_left,
          availabilityBlocks: r.availability_blocks ?? [],
          email:              r.email ?? null,
          phone:              r.phone ?? null,
          parent_name:        r.parent_name ?? null,
          parent_email:       r.parent_email ?? null,
          parent_phone:       r.parent_phone ?? null,
          bluebook_url:       r.bluebook_url ?? null,
        }))

        const gradeMap: Record<string, string | null> = {}
        students.forEach(s => { gradeMap[s.id] = s.grade })

        const sessions: Session[] = (sessionRes.data ?? []).map((r: any) => ({
          id:       r.id,
          date:     r.session_date,
          tutorId:  r.tutor_id,
          time:     r.time,
          students: (r[SS] ?? []).map((ss: any) => ({
            id:                 ss.student_id,
            rowId:              ss.id,
            name:               ss.name,
            topic:              ss.topic,
            status:             ss.status,
            grade:              gradeMap[ss.student_id] ?? null,
            notes:              ss.notes ?? null,
            confirmationStatus: ss.confirmation_status ?? null,
            seriesId:           ss.series_id ?? null,
          })),
        }))

        const timeOffMapped: TimeOff[] = (timeOffRes.data ?? []).map((r: any) => ({
          id:      r.id,
          tutorId: r.tutor_id,
          date:    r.date,
          note:    r.note ?? '',
        }))

        if (!cancelled) {
          setTutors(tutors)
          setStudents(students)
          setSessions(sessions)
          setTimeOff(timeOffMapped)
        }
      } catch (err: any) {
        if (!cancelled) setError(err.message ?? 'Failed to load schedule')
      } finally {
        if (!cancelled) setLoading(false)
      }
    }

    load()
    return () => { cancelled = true }
  }, [toISODate(weekStart), tick])

  return { tutors, students, sessions, timeOff, loading, error, refetch }
}

// ── Write helpers ─────────────────────────────────────────────────────────────

export function createConfirmationToken(): string {
  return globalThis.crypto?.randomUUID?.()
    ?? `${Date.now()}-${Math.random().toString(16).slice(2)}-${Math.random().toString(16).slice(2)}`
}

export async function bookStudent({
  tutorId, date, time, student, topic,
  notes = '', recurring = false, recurringWeeks = 1,
}: {
  tutorId: string
  date: string
  time: string
  student: Student
  topic: string
  notes?: string
  recurring?: boolean
  recurringWeeks?: number
}) {
  const weeks = recurring ? recurringWeeks : 1
  const MAX_CAPACITY = 3

  let seriesId: string | null = null
  if (recurring && recurringWeeks > 1) {
    const endDate = new Date(date + 'T00:00:00')
    endDate.setDate(endDate.getDate() + (recurringWeeks - 1) * 7)
    const { data: series, error: seriesErr } = await supabase
      .from(RECURRING)
      .insert({
        student_id: student.id, tutor_id: tutorId, day_of_week: dayOfWeek(date),
        time, topic, notes: notes || null, start_date: date,
        end_date: toISODate(endDate), total_weeks: recurringWeeks, status: 'active',
      })
      .select('id').single()
    if (seriesErr) throw seriesErr
    seriesId = series.id
  }

  for (let w = 0; w < weeks; w++) {
    const d = new Date(date + 'T00:00:00')
    d.setDate(d.getDate() + w * 7)
    const isoDate = toISODate(d)

    const { data: sessionsAtTime } = await supabase
      .from(SESSIONS).select('id').eq('session_date', isoDate).eq('time', time)

    if (sessionsAtTime && sessionsAtTime.length > 0) {
      const sessionIds = sessionsAtTime.map((s: any) => s.id)
      const { data: alreadyBooked } = await supabase
        .from(SS).select('id').in('session_id', sessionIds)
        .eq('student_id', student.id).neq('status', 'cancelled').maybeSingle()
      if (alreadyBooked) throw new Error(`${student.name} is already booked at ${time} on ${isoDate}`)
    }

    const { data: existing, error: fetchErr } = await (supabase
      .from(SESSIONS)
      .select(`id, ${SS}(id)`)
      .eq('session_date', isoDate).eq('tutor_id', tutorId).eq('time', time)
      .maybeSingle() as any)
    if (fetchErr) throw fetchErr

    let sessionId: string
    if (existing) {
      if (existing[SS] && existing[SS].length >= MAX_CAPACITY)
        throw new Error(`This session with the tutor is full for ${isoDate}`)
      sessionId = existing.id
    } else {
      const { data: created, error: createErr } = await supabase
        .from(SESSIONS).insert({ session_date: isoDate, tutor_id: tutorId, time }).select('id').single()
      if (createErr) throw createErr
      sessionId = created.id
    }

    const { error: enrollErr } = await supabase.from(SS).insert({
      session_id: sessionId, student_id: student.id, name: student.name,
      topic, notes: notes || null, status: 'scheduled', series_id: seriesId,
      confirmation_token: createConfirmationToken(),
    })
    if (enrollErr) throw enrollErr
  }
}

export async function updateAttendance({ sessionId, studentId, status }: {
  sessionId: string; studentId: string; status: 'scheduled' | 'present' | 'no-show'
}) {
  const { error } = await supabase.from(SS).update({ status })
    .eq('session_id', sessionId).eq('student_id', studentId)
  if (error) throw error
}

export async function removeStudentFromSession({ sessionId, studentId }: {
  sessionId: string; studentId: string
}) {
  const { error } = await supabase.from(SS).delete()
    .eq('session_id', sessionId).eq('student_id', studentId)
  if (error) throw error
}

export async function updateSessionNotes({ rowId, notes }: {
  rowId: string; notes: string | null
}) {
  const { error } = await supabase.from(SS).update({ notes }).eq('id', rowId)
  if (error) throw error
}

export async function moveStudentSession({
  rowId,
  studentId,
  fromSessionId,
  toTutorId,
  toDate,
  toTime,
}: {
  rowId: string
  studentId: string
  fromSessionId: string
  toTutorId: string
  toDate: string
  toTime: string
}) {
  const MOVE_MAX_CAPACITY = 3

  // Fast no-op: same slot
  const { data: fromSession, error: fromErr } = await supabase
    .from(SESSIONS)
    .select('id, tutor_id, session_date, time')
    .eq('id', fromSessionId)
    .single()
  if (fromErr) throw fromErr

  if (
    fromSession.tutor_id === toTutorId &&
    fromSession.session_date === toDate &&
    fromSession.time === toTime
  ) {
    return
  }

  const { data: sessionsAtTime, error: satErr } = await supabase
    .from(SESSIONS)
    .select('id')
    .eq('session_date', toDate)
    .eq('time', toTime)
  if (satErr) throw satErr

  const targetSessionIds = (sessionsAtTime ?? []).map((s: any) => s.id)
  if (targetSessionIds.length > 0) {
    const { data: dup, error: dupErr } = await supabase
      .from(SS)
      .select('id')
      .in('session_id', targetSessionIds)
      .eq('student_id', studentId)
      .neq('status', 'cancelled')
      .neq('id', rowId)
      .maybeSingle()
    if (dupErr) throw dupErr
    if (dup) throw new Error('Student is already booked at that date/time.')
  }

  const { data: existing, error: existingErr } = await (supabase
    .from(SESSIONS)
    .select(`id, ${SS}(id)`)
    .eq('session_date', toDate)
    .eq('tutor_id', toTutorId)
    .eq('time', toTime)
    .maybeSingle() as any)
  if (existingErr) throw existingErr

  let targetSessionId: string
  if (existing) {
    if ((existing[SS] ?? []).length >= MOVE_MAX_CAPACITY) {
      throw new Error('Target session is full.')
    }
    targetSessionId = existing.id
  } else {
    const { data: created, error: createErr } = await supabase
      .from(SESSIONS)
      .insert({ session_date: toDate, tutor_id: toTutorId, time: toTime })
      .select('id')
      .single()
    if (createErr) throw createErr
    targetSessionId = created.id
  }

  const { error: moveErr } = await supabase
    .from(SS)
    .update({ session_id: targetSessionId })
    .eq('id', rowId)
    .eq('student_id', studentId)
  if (moveErr) throw moveErr
}

// ── Recurring series helpers ──────────────────────────────────────────────────

export async function fetchAllSeries(): Promise<RecurringSeries[]> {
  const { data, error } = await (supabase
    .from(RECURRING)
    .select(`id, created_at, student_id, tutor_id, day_of_week, time, topic, notes, start_date, end_date, total_weeks, status, ${STUDENTS} ( name ), ${TUTORS} ( name )`)
    .order('start_date', { ascending: false }) as any)
  if (error) throw error
  return (data ?? []).map((r: any) => ({
    id: r.id, createdAt: r.created_at, studentId: r.student_id,
    studentName: r[STUDENTS]?.name ?? 'Unknown',
    tutorId: r.tutor_id, tutorName: r[TUTORS]?.name ?? 'Unknown',
    dayOfWeek: r.day_of_week, time: r.time, topic: r.topic,
    notes: r.notes ?? null, startDate: r.start_date, endDate: r.end_date,
    totalWeeks: r.total_weeks, status: r.status,
  }))
}

export async function fetchSeriesSessions(seriesId: string) {
  const { data, error } = await (supabase
    .from(SS)
    .select(`id, status, notes, ${SESSIONS} ( id, session_date, time, tutor_id )`)
    .eq('series_id', seriesId) as any)
  if (error) throw error
  return data ?? []
}

export async function cancelSeries(seriesId: string): Promise<void> {
  const today = toISODate(new Date())
  const { data: futureSessions, error: fetchErr } = await (supabase
    .from(SS)
    .select(`id, ${SESSIONS}!inner ( session_date )`)
    .eq('series_id', seriesId) as any)
  if (fetchErr) throw fetchErr

  const futureRowIds = (futureSessions ?? [])
    .filter((r: any) => {
      const s = Array.isArray(r[SESSIONS]) ? r[SESSIONS][0] : r[SESSIONS]
      return s?.session_date >= today
    })
    .map((r: any) => r.id)

  if (futureRowIds.length > 0) {
    const { error: deleteErr } = await supabase.from(SS).delete().in('id', futureRowIds)
    if (deleteErr) throw deleteErr
  }

  const { error: updateErr } = await supabase.from(RECURRING)
    .update({ status: 'cancelled' }).eq('id', seriesId)
  if (updateErr) throw updateErr
}

function jsDayToIso(jsDay: number): number { return jsDay === 0 ? 7 : jsDay }

function nextOccurrenceOfDay(fromDateStr: string, targetIsoDow: number): string {
  const from = new Date(fromDateStr + 'T00:00:00')
  const fromDow = jsDayToIso(from.getDay())
  let delta = targetIsoDow - fromDow
  if (delta < 0) delta += 7
  const result = new Date(from)
  result.setDate(result.getDate() + delta)
  return toISODate(result)
}

export async function rescheduleSeries({ seriesId, newTutorId, newTime, student, topic, overrideDayOfWeek }: {
  seriesId: string; newTutorId: string; newTime: string
  student: Student; topic: string; overrideDayOfWeek?: number
}): Promise<void> {
  const today = toISODate(new Date())
  const MAX_CAPACITY = 3

  const { data: seriesRow, error: seriesErr } = await supabase
    .from(RECURRING).select('end_date, day_of_week').eq('id', seriesId).single()
  if (seriesErr) throw seriesErr

  const seriesEndDate: string = seriesRow.end_date
  const currentDow: number   = seriesRow.day_of_week
  const targetDow: number    = overrideDayOfWeek ?? currentDow
  const isDayChange           = overrideDayOfWeek !== undefined && overrideDayOfWeek !== currentDow

  const { data: futureSessions, error: fetchErr } = await (supabase
    .from(SS)
    .select(`id, ${SESSIONS}!inner ( id, session_date )`)
    .eq('series_id', seriesId) as any)
  if (fetchErr) throw fetchErr

  const futureRows = (futureSessions ?? []).filter((r: any) => {
    const s = Array.isArray(r[SESSIONS]) ? r[SESSIONS][0] : r[SESSIONS]
    return s?.session_date >= today
  })

  if (futureRows.length > 0) {
    const { error: deleteErr } = await supabase.from(SS).delete()
      .in('id', futureRows.map((r: any) => r.id))
    if (deleteErr) throw deleteErr
  }

  let targetDates: string[]
  if (isDayChange) {
    targetDates = []
    let cursor = nextOccurrenceOfDay(today, targetDow)
    while (cursor <= seriesEndDate) {
      targetDates.push(cursor)
      const next = new Date(cursor + 'T00:00:00')
      next.setDate(next.getDate() + 7)
      cursor = toISODate(next)
    }
  } else {
    targetDates = futureRows
      .map((r: any) => {
        const s = Array.isArray(r[SESSIONS]) ? r[SESSIONS][0] : r[SESSIONS]
        return s?.session_date as string
      })
      .filter(Boolean).sort()
  }

  for (const isoDate of targetDates) {
    const { data: existing } = await (supabase
      .from(SESSIONS)
      .select(`id, ${SS}(id)`)
      .eq('session_date', isoDate).eq('tutor_id', newTutorId).eq('time', newTime)
      .maybeSingle() as any)

    let sessionId: string
    if (existing) {
      if (existing[SS] && existing[SS].length >= MAX_CAPACITY)
        throw new Error(`Session is full on ${isoDate} — cannot reschedule to this slot`)
      sessionId = existing.id
    } else {
      const { data: created, error: createErr } = await supabase
        .from(SESSIONS).insert({ session_date: isoDate, tutor_id: newTutorId, time: newTime })
        .select('id').single()
      if (createErr) throw createErr
      sessionId = created.id
    }

    const { error: enrollErr } = await supabase.from(SS).insert({
      session_id: sessionId, student_id: student.id, name: student.name,
      topic, status: 'scheduled', series_id: seriesId,
      confirmation_token: createConfirmationToken(),
    })
    if (enrollErr) throw enrollErr
  }

  const seriesUpdate: Record<string, any> = { tutor_id: newTutorId, time: newTime, topic }
  if (isDayChange) seriesUpdate.day_of_week = targetDow
  const { error: updateErr } = await supabase.from(RECURRING).update(seriesUpdate).eq('id', seriesId)
  if (updateErr) throw updateErr
}

export async function markCompletedSeries(): Promise<void> {
  const today = toISODate(new Date())
  const { error } = await supabase.from(RECURRING)
    .update({ status: 'completed' }).eq('status', 'active').lt('end_date', today)
  if (error) throw error
}

export async function updateConfirmationStatus({ rowId, status }: {
  rowId: string; status: 'confirmed' | 'unconfirmed' | null
}) {
  const { error } = await supabase.from(SS)
    .update({ confirmation_status: status }).eq('id', rowId)
  if (error) throw error
}