import { useEffect, useState } from 'react'
import { supabase } from '@/lib/supabaseClient'

// ── Types ─────────────────────────────────────────────────────────────────────

export type Tutor = {
  id: string
  name: string
  subjects: string[]
  cat: string
  availability: number[]        // 1=Mon … 5=Fri — which weekdays they work
  availabilityBlocks: string[]  // e.g. '1-14:00'
}

export type Student = {
  id: string
  name: string
  subject: string
  hoursLeft: number
}

export type SessionStudent = {
  rowId: string
  id: string
  name: string
  topic: string
  status: string
  durationMinutes: number   // NEW
}

export type Session = {
  id: string
  date: string      // ISO date string e.g. '2026-02-25'
  tutorId: string
  time: string
  students: SessionStudent[]
}

export type ScheduleData = {
  tutors: Tutor[]
  students: Student[]
  sessions: Session[]
  loading: boolean
  error: string | null
  refetch: () => void
}

// ── Date helpers ──────────────────────────────────────────────────────────────

/** Returns the Monday of the week containing `d` */
export function getWeekStart(d: Date): Date {
  const date = new Date(d)
  const day = date.getDay()                     // 0=Sun … 6=Sat
  const diff = day === 0 ? -6 : 1 - day         // shift to Monday
  date.setDate(date.getDate() + diff)
  date.setHours(0, 0, 0, 0)
  return date
}

/** Returns ISO date string 'YYYY-MM-DD' for a Date */
export function toISODate(d: Date): string {
  return d.toISOString().slice(0, 10)
}

/** Returns the 7 Mon-Sun dates for a given week start (Monday) */
export function getWeekDates(weekStart: Date): Date[] {
  return Array.from({ length: 7 }, (_, i) => {
    const d = new Date(weekStart)
    d.setDate(d.getDate() + i)
    return d
  })
}

/** Day-of-week number (1=Mon … 7=Sun) from an ISO date string */
export function dayOfWeek(isoDate: string): number {
  const d = new Date(isoDate + 'T00:00:00')
  const js = d.getDay()                         // 0=Sun
  return js === 0 ? 7 : js                      // Mon=1 … Sun=7
}

/** Format a date nicely e.g. 'Mon Feb 25' */
export function formatDate(isoDate: string): string {
  return new Date(isoDate + 'T00:00:00').toLocaleDateString('en-US', {
    weekday: 'short', month: 'short', day: 'numeric',
  })
}

/** Given a time string like '14:00' and duration in minutes, return all 30-min block times it occupies */
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
  const [loading,  setLoading]  = useState(true)
  const [error,    setError]    = useState<string | null>(null)
  const [tick,     setTick]     = useState(0)

  const refetch = () => setTick(t => t + 1)

  useEffect(() => {
    let cancelled = false

    async function load() {
      setLoading(true)
      setError(null)

      // Week date range
      const weekEnd = new Date(weekStart)
      weekEnd.setDate(weekEnd.getDate() + 5)
      const from = toISODate(weekStart)
      const to   = toISODate(weekEnd)

      try {
        const [tutorRes, studentRes, sessionRes] = await Promise.all([
          supabase.from('tutors').select('*').order('name'),
          supabase.from('students').select('*').order('name'),
          supabase
            .from('sessions')
            .select(`
              id, session_date, tutor_id, time,
              session_students ( id, student_id, name, topic, status, duration_minutes )
            `)
            .gte('session_date', from)
            .lt('session_date', to)
            .order('session_date')
            .order('time'),
        ])

        if (tutorRes.error)   throw tutorRes.error
        if (studentRes.error) throw studentRes.error
        if (sessionRes.error) throw sessionRes.error

        const tutors: Tutor[] = (tutorRes.data ?? []).map(r => ({
          id:                 r.id,
          name:               r.name,
          subjects:           r.subjects ?? [],
          cat:                r.cat,
          availability:       r.availability ?? [],
          availabilityBlocks: r.availability_blocks ?? [],
        }))

        const students: Student[] = (studentRes.data ?? []).map(r => ({
          id:        r.id,
          name:      r.name,
          subject:   r.subject,
          hoursLeft: r.hours_left,
        }))

        const sessions: Session[] = (sessionRes.data ?? []).map(r => ({
          id:       r.id,
          date:     r.session_date,
          tutorId:  r.tutor_id,
          time:     r.time,
          students: (r.session_students ?? []).map((ss: any) => ({
            id:              ss.student_id,
            rowId:           ss.id,
            name:            ss.name,
            topic:           ss.topic,
            status:          ss.status,
            durationMinutes: ss.duration_minutes ?? 30,  // NEW
          })),
        }))

        if (!cancelled) {
          setTutors(tutors)
          setStudents(students)
          setSessions(sessions)
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

  return { tutors, students, sessions, loading, error, refetch }
}

// ── Write helpers ─────────────────────────────────────────────────────────────

/**
 * Book a student into a slot.
 * If recurring=true, creates one session per week for `recurringWeeks` weeks.
 */
export async function bookStudent({
  tutorId,
  date,
  time,
  student,
  topic,
  durationMinutes = 30,
  recurring = false,
  recurringWeeks = 1,
}: {
  tutorId: string
  date: string
  time: string
  student: Student
  topic: string
  durationMinutes?: number
  recurring?: boolean
  recurringWeeks?: number
}) {
  const weeks = recurring ? recurringWeeks : 1

  for (let w = 0; w < weeks; w++) {
    const d = new Date(date + 'T00:00:00')
    d.setDate(d.getDate() + w * 7)
    const isoDate = toISODate(d)

    // Find or create session
    let { data: existing, error: fetchErr } = await supabase
      .from('sessions')
      .select('id')
      .eq('session_date', isoDate)
      .eq('tutor_id', tutorId)
      .eq('time', time)
      .maybeSingle()

    if (fetchErr) throw fetchErr

    let sessionId: string

    if (existing) {
      sessionId = existing.id
    } else {
      const { data: created, error: createErr } = await supabase
        .from('sessions')
        .insert({ session_date: isoDate, tutor_id: tutorId, time, duration_minutes: durationMinutes })
        .select('id')
        .single()
      if (createErr) throw createErr
      sessionId = created.id
    }

    const { error: enrollErr } = await supabase
      .from('session_students')
      .insert({
        session_id:       sessionId,
        student_id:       student.id,
        name:             student.name,
        topic,
        status:           'scheduled',
        duration_minutes: durationMinutes,  // NEW
      })

    if (enrollErr) throw enrollErr
  }
}

/** Update attendance status for a student in a session */
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
    .from('session_students')
    .update({ status })
    .eq('session_id', sessionId)
    .eq('student_id', studentId)

  if (error) throw error
}

/** Remove a student from a session */
export async function removeStudentFromSession({
  sessionId,
  studentId,
}: {
  sessionId: string
  studentId: string
}) {
  const { error } = await supabase
    .from('session_students')
    .delete()
    .eq('session_id', sessionId)
    .eq('student_id', studentId)

  if (error) throw error
}