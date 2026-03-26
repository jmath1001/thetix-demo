import { useEffect, useState } from 'react'
import { supabase } from '@/lib/supabaseClient'

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
  return new Date(new Date().toLocaleString("en-US", { timeZone: "America/Chicago" }));
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
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
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
          supabase.from('slake_tutors').select('*').order('name'),
          supabase.from('slake_students').select('*').order('name'),
          supabase
            .from('slake_sessions')
            .select(`
              id, session_date, tutor_id, time,
              slake_session_students ( id, student_id, name, topic, status, notes, confirmation_status, series_id )
            `)
            .gte('session_date', from)
            .lte('session_date', to)
            .order('session_date')
            .order('time'),
          supabase
            .from('slake_tutor_time_off')
            .select('*')
            .gte('date', from)
            .lte('date', to),
        ])

        if (tutorRes.error)   throw tutorRes.error
        if (studentRes.error) throw studentRes.error
        if (sessionRes.error) throw sessionRes.error
        if (timeOffRes.error) throw timeOffRes.error

        const tutors: Tutor[] = (tutorRes.data ?? []).map(r => ({
          id:                 r.id,
          name:               r.name,
          subjects:           r.subjects ?? [],
          cat:                r.cat,
          availability:       r.availability ?? [],
          availabilityBlocks: r.availability_blocks ?? [],
        }))

        const students: Student[] = (studentRes.data ?? []).map(r => ({
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

        const sessions: Session[] = (sessionRes.data ?? []).map(r => ({
          id:       r.id,
          date:     r.session_date,
          tutorId:  r.tutor_id,
          time:     r.time,
          students: (r.slake_session_students ?? []).map((ss: any) => ({
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

        const timeOffMapped: TimeOff[] = (timeOffRes.data ?? []).map(r => ({
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

export async function bookStudent({
  tutorId,
  date,
  time,
  student,
  topic,
  notes = '',
  recurring = false,
  recurringWeeks = 1,
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
      .from('slake_recurring_series')
      .insert({
        student_id:  student.id,
        tutor_id:    tutorId,
        day_of_week: dayOfWeek(date),
        time,
        topic,
        notes:       notes || null,
        start_date:  date,
        end_date:    toISODate(endDate),
        total_weeks: recurringWeeks,
        status:      'active',
      })
      .select('id')
      .single()

    if (seriesErr) throw seriesErr
    seriesId = series.id
  }

  for (let w = 0; w < weeks; w++) {
    const d = new Date(date + 'T00:00:00')
    d.setDate(d.getDate() + w * 7)
    const isoDate = toISODate(d)

    const { data: sessionAtTime } = await supabase
      .from('slake_sessions')
      .select('id')
      .eq('session_date', isoDate)
      .eq('time', time)
      .maybeSingle()

    if (sessionAtTime) {
      const { data: alreadyBooked } = await supabase
        .from('slake_session_students')
        .select('id')
        .eq('session_id', sessionAtTime.id)
        .eq('student_id', student.id)
        .maybeSingle()

      if (alreadyBooked) {
        throw new Error(`${student.name} is already booked at ${time} on ${isoDate}`)
      }
    }

    const { data: existing, error: fetchErr } = await supabase
      .from('slake_sessions')
      .select('id, slake_session_students(id)')
      .eq('session_date', isoDate)
      .eq('tutor_id', tutorId)
      .eq('time', time)
      .maybeSingle()

    if (fetchErr) throw fetchErr

    let sessionId: string

    if (existing) {
      if (existing.slake_session_students && existing.slake_session_students.length >= MAX_CAPACITY) {
        throw new Error(`This session with the tutor is full for ${isoDate}`)
      }
      sessionId = existing.id
    } else {
      const { data: created, error: createErr } = await supabase
        .from('slake_sessions')
        .insert({ session_date: isoDate, tutor_id: tutorId, time })
        .select('id')
        .single()
      if (createErr) throw createErr
      sessionId = created.id
    }

    const { error: enrollErr } = await supabase
      .from('slake_session_students')
      .insert({
        session_id: sessionId,
        student_id: student.id,
        name:       student.name,
        topic,
        notes:      notes || null,
        status:     'scheduled',
        series_id:  seriesId,
      })

    if (enrollErr) throw enrollErr
  }
}

export async function updateAttendance({
  sessionId,
  studentId,
  status,
}: {
  sessionId: string
  studentId: string
  status: 'scheduled' | 'present' | 'no-show'
}) {
  const { error } = await supabase
    .from('slake_session_students')
    .update({ status })
    .eq('session_id', sessionId)
    .eq('student_id', studentId)

  if (error) throw error
}

export async function removeStudentFromSession({
  sessionId,
  studentId,
}: {
  sessionId: string
  studentId: string
}) {
  const { error } = await supabase
    .from('slake_session_students')
    .delete()
    .eq('session_id', sessionId)
    .eq('student_id', studentId)

  if (error) throw error
}

export async function updateSessionNotes({
  rowId,
  notes,
}: {
  rowId: string
  notes: string | null
}) {
  const { error } = await supabase
    .from('slake_session_students')
    .update({ notes })
    .eq('id', rowId)

  if (error) throw error
}

// ── Recurring series helpers ──────────────────────────────────────────────────

export async function fetchAllSeries(): Promise<RecurringSeries[]> {
  const { data, error } = await supabase
    .from('slake_recurring_series')
    .select(`
      id, created_at, student_id, tutor_id, day_of_week, time,
      topic, notes, start_date, end_date, total_weeks, status,
      slake_students ( name ),
      slake_tutors ( name )
    `)
    .order('start_date', { ascending: false })

  if (error) throw error

  return (data ?? []).map((r: any) => ({
    id:          r.id,
    createdAt:   r.created_at,
    studentId:   r.student_id,
    studentName: r.slake_students?.name ?? 'Unknown',
    tutorId:     r.tutor_id,
    tutorName:   r.slake_tutors?.name ?? 'Unknown',
    dayOfWeek:   r.day_of_week,
    time:        r.time,
    topic:       r.topic,
    notes:       r.notes ?? null,
    startDate:   r.start_date,
    endDate:     r.end_date,
    totalWeeks:  r.total_weeks,
    status:      r.status,
  }))
}

export async function fetchSeriesSessions(seriesId: string) {
  const { data, error } = await supabase
    .from('slake_session_students')
    .select(`
      id, status, notes,
      slake_sessions ( id, session_date, time, tutor_id )
    `)
    .eq('series_id', seriesId)
    .order('slake_sessions(session_date)')

  if (error) throw error
  return data ?? []
}

export async function cancelSeries(seriesId: string): Promise<void> {
  const today = toISODate(new Date())

  const { data: futureSessions, error: fetchErr } = await supabase
    .from('slake_session_students')
    .select(`id, slake_sessions!inner ( session_date )`)
    .eq('series_id', seriesId)

  if (fetchErr) throw fetchErr

  const futureRowIds = (futureSessions ?? [])
    .filter((r: any) => {
      const session = Array.isArray(r.slake_sessions) ? r.slake_sessions[0] : r.slake_sessions
      return session?.session_date >= today
    })
    .map((r: any) => r.id)

  if (futureRowIds.length > 0) {
    const { error: deleteErr } = await supabase
      .from('slake_session_students')
      .delete()
      .in('id', futureRowIds)

    if (deleteErr) throw deleteErr
  }

  const { error: updateErr } = await supabase
    .from('slake_recurring_series')
    .update({ status: 'cancelled' })
    .eq('id', seriesId)

  if (updateErr) throw updateErr
}

// JS day (0=Sun…6=Sat) → ISO day-of-week (1=Mon…7=Sun)
function jsDayToIso(jsDay: number): number {
  return jsDay === 0 ? 7 : jsDay
}

// Find the next occurrence of targetIsoDow on or after fromDateStr
function nextOccurrenceOfDay(fromDateStr: string, targetIsoDow: number): string {
  const from = new Date(fromDateStr + 'T00:00:00')
  const fromDow = jsDayToIso(from.getDay())
  let delta = targetIsoDow - fromDow
  if (delta < 0) delta += 7
  const result = new Date(from)
  result.setDate(result.getDate() + delta)
  return toISODate(result)
}

export async function rescheduleSeries({
  seriesId,
  newTutorId,
  newTime,
  student,
  topic,
  overrideDayOfWeek,
}: {
  seriesId: string
  newTutorId: string
  newTime: string
  student: Student
  topic: string
  /** Provide to move the series to a different day of the week (1=Mon…7=Sun). */
  overrideDayOfWeek?: number
}): Promise<void> {
  const today = toISODate(new Date())
  const MAX_CAPACITY = 3

  // Fetch the series record to know current day and end date
  const { data: seriesRow, error: seriesErr } = await supabase
    .from('slake_recurring_series')
    .select('end_date, day_of_week')
    .eq('id', seriesId)
    .single()

  if (seriesErr) throw seriesErr

  const seriesEndDate: string = seriesRow.end_date
  const currentDow: number   = seriesRow.day_of_week
  const targetDow: number    = overrideDayOfWeek ?? currentDow
  const isDayChange           = overrideDayOfWeek !== undefined && overrideDayOfWeek !== currentDow

  // Cancel all future session_students
  const { data: futureSessions, error: fetchErr } = await supabase
    .from('slake_session_students')
    .select(`id, slake_sessions!inner ( id, session_date )`)
    .eq('series_id', seriesId)

  if (fetchErr) throw fetchErr

  const futureRows = (futureSessions ?? []).filter((r: any) => {
    const session = Array.isArray(r.slake_sessions) ? r.slake_sessions[0] : r.slake_sessions
    return session?.session_date >= today
  })

  if (futureRows.length > 0) {
    const { error: deleteErr } = await supabase
      .from('slake_session_students')
      .delete()
      .in('id', futureRows.map((r: any) => r.id))

    if (deleteErr) throw deleteErr
  }

  // Build target dates
  let targetDates: string[]

  if (isDayChange) {
    // Recalculate all dates on the new day of week from today through series end
    targetDates = []
    let cursor = nextOccurrenceOfDay(today, targetDow)
    while (cursor <= seriesEndDate) {
      targetDates.push(cursor)
      const next = new Date(cursor + 'T00:00:00')
      next.setDate(next.getDate() + 7)
      cursor = toISODate(next)
    }
  } else {
    // Same day — reuse the original cancelled dates
    targetDates = futureRows
      .map((r: any) => {
        const session = Array.isArray(r.slake_sessions) ? r.slake_sessions[0] : r.slake_sessions
        return session?.session_date as string
      })
      .filter(Boolean)
      .sort()
  }

  // Recreate sessions on target dates
  for (const isoDate of targetDates) {
    const { data: existing } = await supabase
      .from('slake_sessions')
      .select('id, slake_session_students(id)')
      .eq('session_date', isoDate)
      .eq('tutor_id', newTutorId)
      .eq('time', newTime)
      .maybeSingle()

    let sessionId: string

    if (existing) {
      if (existing.slake_session_students && existing.slake_session_students.length >= MAX_CAPACITY) {
        throw new Error(`Session is full on ${isoDate} — cannot reschedule to this slot`)
      }
      sessionId = existing.id
    } else {
      const { data: created, error: createErr } = await supabase
        .from('slake_sessions')
        .insert({ session_date: isoDate, tutor_id: newTutorId, time: newTime })
        .select('id')
        .single()
      if (createErr) throw createErr
      sessionId = created.id
    }

    const { error: enrollErr } = await supabase
      .from('slake_session_students')
      .insert({
        session_id: sessionId,
        student_id: student.id,
        name:       student.name,
        topic,
        status:     'scheduled',
        series_id:  seriesId,
      })

    if (enrollErr) throw enrollErr
  }

  // Update the series record
  const seriesUpdate: Record<string, any> = { tutor_id: newTutorId, time: newTime, topic }
  if (isDayChange) seriesUpdate.day_of_week = targetDow

  const { error: updateErr } = await supabase
    .from('slake_recurring_series')
    .update(seriesUpdate)
    .eq('id', seriesId)

  if (updateErr) throw updateErr
}

export async function markCompletedSeries(): Promise<void> {
  const today = toISODate(new Date())

  const { error } = await supabase
    .from('slake_recurring_series')
    .update({ status: 'completed' })
    .eq('status', 'active')
    .lt('end_date', today)

  if (error) throw error
}

// ── Confirmation helper ───────────────────────────────────────────────────────

export async function updateConfirmationStatus({
  rowId,
  status,
}: {
  rowId: string
  status: 'confirmed' | 'unconfirmed' | null
}) {
  const { error } = await supabase
    .from('slake_session_students')
    .update({ confirmation_status: status })
    .eq('id', rowId)

  if (error) throw error
}