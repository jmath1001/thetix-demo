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
  hoursLeft: number
}

export type SessionStudent = {
  rowId: string
  id: string
  name: string
  topic: string
  status: string
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
              slake_session_students ( id, student_id, name, topic, status )
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
          students: (r.slake_session_students ?? []).map((ss: any) => ({
            id:     ss.student_id,
            rowId:  ss.id,
            name:   ss.name,
            topic:  ss.topic,
            status: ss.status,
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
  recurring = false,
  recurringWeeks = 1,
}: {
  tutorId: string
  date: string
  time: string
  student: Student
  topic: string
  recurring?: boolean
  recurringWeeks?: number
}) {
  const weeks = recurring ? recurringWeeks : 1
  const MAX_CAPACITY = 3

  for (let w = 0; w < weeks; w++) {
    const d = new Date(date + 'T00:00:00')
    d.setDate(d.getDate() + w * 7)
    const isoDate = toISODate(d)

    // 1. CHECK FOR STUDENT DOUBLE-BOOKING
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

    // 2. FIND OR CREATE SESSION & CHECK CAPACITY
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

    // 3. FINAL ENROLLMENT
    const { error: enrollErr } = await supabase
      .from('slake_session_students')
      .insert({
        session_id: sessionId,
        student_id: student.id,
        name:       student.name,
        topic,
        status:     'scheduled',
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