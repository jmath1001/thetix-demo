import { useEffect, useState } from 'react'
import { supabase } from '@/lib/supabaseClient'
import { DB, withCenter, withCenterPayload } from '@/lib/db'
import type { SessionTimesByDay } from '@/components/constants'
import { logEvent } from '@/lib/analytics'

const TUTORS         = DB.tutors
const STUDENTS       = DB.students
const SESSIONS       = DB.sessions
const SS             = DB.sessionStudents
const RECURRING      = DB.recurringSeries
const TIME_OFF       = DB.timeOff
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
  email: string | null
}

export type Student = {
  id: string
  name: string
  subjects: string[]
  subject?: string | null
  grade: string | null
  hoursLeft: number
  sessionHours: number
  availabilityBlocks: string[]
  email: string | null
  phone: string | null
  parent_name: string | null
  parent_email: string | null
  parent_phone: string | null
  mom_name: string | null
  mom_email: string | null
  mom_phone: string | null
  dad_name: string | null
  dad_email: string | null
  dad_phone: string | null
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
  activeTermSessionTimesByDay: SessionTimesByDay | null
  activeStudentIds: Set<string>
  loading: boolean
  error: string | null
  refetch: () => void
}

export type BookStudentResult = {
  date: string
  time: string
  tutorId: string
  sessionId: string
  rowId: string
  studentId: string
  topic: string
  notes: string | null
  seriesId: string | null
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

export function useScheduleData(weekStart: Date, options?: { termId?: string | null }): ScheduleData {
  const [tutors,   setTutors]   = useState<Tutor[]>([])
  const [students, setStudents] = useState<Student[]>([])
  const [sessions, setSessions] = useState<Session[]>([])
  const [timeOff,  setTimeOff]  = useState<TimeOff[]>([])
  const [activeTermSessionTimesByDay, setActiveTermSessionTimesByDay] = useState<SessionTimesByDay | null>(null)
  const [activeStudentIds, setActiveStudentIds] = useState<Set<string>>(new Set())
  const [loading,  setLoading]  = useState(true)
  const [error,    setError]    = useState<string | null>(null)
  const [tick,     setTick]     = useState(0)

  const refetch = () => setTick(t => t + 1)

  const selectedTermId = options?.termId ?? null

  useEffect(() => {
    let cancelled = false

    async function load() {
      const isInitialLoad =
        tutors.length === 0 &&
        students.length === 0 &&
        sessions.length === 0 &&
        timeOff.length === 0

      if (isInitialLoad) setLoading(true)
      setError(null)

      const weekEnd = new Date(weekStart)
      weekEnd.setDate(weekEnd.getDate() + 6)
      const from = toISODate(weekStart)
      const to   = toISODate(weekEnd)

      try {
        const todayIso = toISODate(getCentralTimeNow())
        const thirtyDaysAgo = new Date(todayIso + 'T00:00:00')
        thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30)
        const thirtyDaysAgoIso = toISODate(thirtyDaysAgo)

        const [tutorRes, studentRes, sessionRes, timeOffRes, activeRes] = await Promise.all([
          withCenter(supabase.from(TUTORS).select('*')).order('name'),
          withCenter(supabase.from(STUDENTS).select('*')).order('name'),
          (withCenter(supabase
            .from(SESSIONS)
            .select(`id, session_date, tutor_id, time, ${SS} ( id, student_id, name, topic, status, notes, confirmation_status, series_id )`)
            .gte('session_date', from)
            .lte('session_date', to)
            .order('session_date'))
            .order('time') as any),
          withCenter(supabase
            .from(TIME_OFF)
            .select('*')
            .gte('date', from)
            .lte('date', to)),
          (withCenter(supabase
            .from(SESSIONS)
            .select(`id, ${SS}(student_id)`)
            .gte('session_date', thirtyDaysAgoIso)
            .lte('session_date', todayIso)) as any),
        ])

        if (tutorRes.error)   throw tutorRes.error
        if (studentRes.error) throw studentRes.error
        if (sessionRes.error) throw sessionRes.error
        if (timeOffRes.error) throw timeOffRes.error

        // Use the server route so schedule and center-settings read terms the same way.
        // This avoids client-side RLS mismatches where anon term reads can return empty.
        let terms: any[] = []
        try {
          const termsRes = await fetch('/api/terms', { cache: 'no-store' })
          const termsPayload = await termsRes.json().catch(() => ({}))
          if (!termsRes.ok) throw new Error(termsPayload?.error ?? 'Failed to load terms')
          terms = Array.isArray(termsPayload?.terms) ? termsPayload.terms : []
        } catch {
          // Fallback to direct client read if API route is unavailable.
          const termRes = await withCenter(supabase.from(DB.terms).select('*')).order('start_date', { ascending: false })
          if (termRes.error) throw termRes.error
          terms = termRes.data ?? []
        }

        const todayForTermSelection = toISODate(getCentralTimeNow())
        const requestedTermId = typeof selectedTermId === 'string' ? selectedTermId.trim() : ''
        const normalizedStatus = (value: unknown) => (typeof value === 'string' ? value.trim().toLowerCase() : '')

        // Prefer an explicitly active term (case-insensitive), then a term covering today, then newest term.
        const activeTerm =
          (requestedTermId ? terms.find((term: any) => term.id === requestedTermId) : null)
          ??
          terms.find((term: any) => normalizedStatus(term.status) === 'active')
          ?? terms.find((term: any) => {
            const start = typeof term.start_date === 'string' ? term.start_date : ''
            const end = typeof term.end_date === 'string' ? term.end_date : ''
            return !!start && !!end && start <= todayForTermSelection && todayForTermSelection <= end
          })
          ?? terms[0]
          ?? null
        const activeTermId = activeTerm?.id ?? null

        let enrollmentByStudent: Record<string, any> = {}
        if (activeTermId) {
          const enrollRes = await withCenter(
            supabase
              .from(DB.termEnrollments)
              .select('*')
              .eq('term_id', activeTermId)
          )
          if (enrollRes.error) throw enrollRes.error
          console.log('[enrollments]', enrollRes.data, 'for termId:', activeTermId)

          enrollmentByStudent = (enrollRes.data ?? []).reduce((acc: Record<string, any>, row: any) => {
            acc[row.student_id] = row
            return acc
          }, {})
        }

        let termAvailabilityByTutor: Record<string, string[]> = {}
        if (activeTermId) {
          try {
            const tutorAvailabilityRes = await fetch(`/api/tutor-availability?termId=${encodeURIComponent(activeTermId)}`, {
              cache: 'no-store',
            })
            const tutorAvailabilityPayload = await tutorAvailabilityRes.json().catch(() => ({}))
            if (tutorAvailabilityRes.ok) {
              const rows = Array.isArray(tutorAvailabilityPayload?.overrides) ? tutorAvailabilityPayload.overrides : []
              termAvailabilityByTutor = rows.reduce((acc: Record<string, string[]>, row: any) => {
                if (row?.tutor_id && Array.isArray(row?.availability_blocks)) {
                  acc[row.tutor_id] = row.availability_blocks
                }
                return acc
              }, {})
            }
          } catch {
            termAvailabilityByTutor = {}
          }
        }

        const tutors: Tutor[] = (tutorRes.data ?? []).map((r: any) => {
          const termAvailabilityBlocks = termAvailabilityByTutor[r.id]
          const resolvedAvailabilityBlocks: string[] = Array.isArray(termAvailabilityBlocks)
            ? termAvailabilityBlocks
            : (Array.isArray(r.availability_blocks) ? r.availability_blocks : [])
          const resolvedAvailabilityDays: number[] = Array.from(new Set<number>(
            resolvedAvailabilityBlocks
              .map((block: string) => {
                const [dow] = block.split('-')
                const n = Number(dow)
                return Number.isFinite(n) ? n : null
              })
              .filter((value: number | null): value is number => value !== null)
          )).sort((a, b) => a - b)

          return {
            id:                 r.id,
            name:               r.name,
            subjects:           r.subjects ?? [],
            cat:                r.cat,
            availability:       resolvedAvailabilityDays.length > 0 ? resolvedAvailabilityDays : (r.availability ?? []),
            availabilityBlocks: resolvedAvailabilityBlocks,
            email:              r.email ?? null,
          }
        })

        console.log('[debug] enrollment for Aisha:', enrollmentByStudent['bac81475-7fba-4f0d-9b42-52ef7253de7c'])


        const students: Student[] = (studentRes.data ?? []).map((r: any) => {
          const enrollment = enrollmentByStudent[r.id]
          const enrollmentSubjects = Array.isArray(enrollment?.subjects)
            ? enrollment.subjects.filter((s: unknown): s is string => typeof s === 'string' && !!s.trim())
            : null
          const enrollmentAvailability = Array.isArray(enrollment?.availability_blocks)
            ? enrollment.availability_blocks
            : null
          return ({
          id:                 r.id,
          name:               r.name,
          subjects:           Array.isArray(enrollmentSubjects) && enrollmentSubjects.length > 0
            ? enrollmentSubjects
            : Array.isArray(r.subjects)
            ? r.subjects.filter((s: unknown): s is string => typeof s === 'string' && !!s.trim())
            : (r.subject ? [r.subject] : []),
          subject:            r.subject ?? null,
          grade:              r.grade ?? null,
          hoursLeft:          r.hours_left ?? (typeof enrollment?.hours_purchased === 'number' ? enrollment.hours_purchased : null),
          sessionHours:       typeof r.session_hours === 'number' ? r.session_hours : 2,
          availabilityBlocks: enrollmentAvailability ?? (r.availability_blocks ?? []),
          email:              r.email ?? null,
          phone:              r.phone ?? null,
          parent_name:        r.parent_name ?? null,
          parent_email:       r.parent_email ?? null,
          parent_phone:       r.parent_phone ?? null,
          mom_name:           r.mom_name ?? null,
          mom_email:          r.mom_email ?? null,
          mom_phone:          r.mom_phone ?? null,
          dad_name:           r.dad_name ?? null,
          dad_email:          r.dad_email ?? null,
          dad_phone:          r.dad_phone ?? null,
          bluebook_url:       r.bluebook_url ?? null,
        })
        })

        console.log('[debug] activeTermId:', activeTermId)
console.log('[debug] enrollmentByStudent keys:', Object.keys(enrollmentByStudent))
console.log('[debug] students[0]:', students[0])

        const gradeMap: Record<string, string | null> = {}
        students.forEach(s => { gradeMap[s.id] = s.grade })

        const sessions: Session[] = (sessionRes.data ?? []).map((r: any) => ({
          id:       r.id,
          date:     r.session_date,
          tutorId:  r.tutor_id,
          time:     r.time,
          students: (r[SS] ?? []).filter((ss: any) => ss.status !== 'cancelled').map((ss: any) => ({
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

          // Load center-level session times (global, not per-term).
          // Fall back to active term's times for backward compat.
          let centerSessionTimes: SessionTimesByDay | null = null
          try {
            const csRes = await withCenter(
              supabase.from(DB.centerSettings).select('session_times_by_day').limit(1)
            ).maybeSingle()
            if (csRes.data && typeof csRes.data.session_times_by_day === 'object' && csRes.data.session_times_by_day) {
              centerSessionTimes = csRes.data.session_times_by_day as SessionTimesByDay
            }
          } catch {
            // ignore — fall through to term fallback
          }

          setActiveTermSessionTimesByDay(
            centerSessionTimes
            ?? (activeTerm && typeof activeTerm.session_times_by_day === 'object' && activeTerm.session_times_by_day
              ? (activeTerm.session_times_by_day as SessionTimesByDay)
              : null)
          )
          const ids = new Set<string>(
            (activeRes.data ?? []).flatMap((r: any) => (r[SS] ?? []).map((ss: any) => ss.student_id as string))
          )
          setActiveStudentIds(ids)
        }
      } catch (err: any) {
        if (!cancelled) setError(err.message ?? 'Failed to load schedule')
      } finally {
        if (!cancelled) setLoading(false)
      }
    }

    load()
    return () => { cancelled = true }
  }, [toISODate(weekStart), tick, selectedTermId])

  return { tutors, students, sessions, timeOff, activeTermSessionTimesByDay, activeStudentIds, loading, error, refetch }
}

// ── Write helpers ─────────────────────────────────────────────────────────────

export function createConfirmationToken(): string {
  return globalThis.crypto?.randomUUID?.()
    ?? `${Date.now()}-${Math.random().toString(16).slice(2)}-${Math.random().toString(16).slice(2)}`
}

export async function createInlineStudent({
  name,
  subject,
}: {
  name: string
  subject?: string | null
}): Promise<Student> {
  const trimmed = name.trim()
  if (!trimmed) throw new Error('Student name is required.')

  const { data, error } = await supabase
    .from(STUDENTS)
    .insert(withCenterPayload({
      name: trimmed,
      subjects: subject?.trim() ? [subject.trim()] : [],
      subject: subject?.trim() || null,
    }))
    .select('*')
    .single()

  if (error) throw error

  return {
    id: data.id,
    name: data.name,
    subjects: Array.isArray(data.subjects)
      ? data.subjects.filter((s: unknown): s is string => typeof s === 'string' && !!s.trim())
      : (data.subject ? [data.subject] : (subject?.trim() ? [subject.trim()] : [])),
    subject: data.subject ?? subject?.trim() ?? null,
    grade: data.grade ?? null,
    hoursLeft: data.hours_left ?? 0,
    sessionHours: 2,
    availabilityBlocks: data.availability_blocks ?? [],
    email: data.email ?? null,
    phone: data.phone ?? null,
    parent_name: data.parent_name ?? null,
    parent_email: data.parent_email ?? null,
    parent_phone: data.parent_phone ?? null,
    mom_name: data.mom_name ?? null,
    mom_email: data.mom_email ?? null,
    mom_phone: data.mom_phone ?? null,
    dad_name: data.dad_name ?? null,
    dad_email: data.dad_email ?? null,
    dad_phone: data.dad_phone ?? null,
    bluebook_url: data.bluebook_url ?? null,
  }
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
}): Promise<BookStudentResult[]> {
  const weeks = recurring ? recurringWeeks : 1
  const MAX_CAPACITY = 3
  const booked: BookStudentResult[] = []

  let seriesId: string | null = null
  if (recurring && recurringWeeks > 1) {
    const endDate = new Date(date + 'T00:00:00')
    endDate.setDate(endDate.getDate() + (recurringWeeks - 1) * 7)
    const { data: series, error: seriesErr } = await supabase
      .from(RECURRING)
      .insert(withCenterPayload({
        student_id: student.id, tutor_id: tutorId, day_of_week: dayOfWeek(date),
        time, topic, notes: notes || null, start_date: date,
        end_date: toISODate(endDate), total_weeks: recurringWeeks, status: 'active',
      }))
      .select('id').single()
    if (seriesErr) throw seriesErr
    seriesId = series.id
  }

  for (let w = 0; w < weeks; w++) {
    const d = new Date(date + 'T00:00:00')
    d.setDate(d.getDate() + w * 7)
    const isoDate = toISODate(d)

    const { data: sessionsAtTime } = await withCenter(
      supabase.from(SESSIONS).select('id').eq('session_date', isoDate).eq('time', time)
    )

    if (sessionsAtTime && sessionsAtTime.length > 0) {
      const sessionIds = sessionsAtTime.map((s: any) => s.id)
      const { data: alreadyBooked } = await withCenter(
        supabase.from(SS).select('id').in('session_id', sessionIds)
          .eq('student_id', student.id).neq('status', 'cancelled')
      ).maybeSingle()
      if (alreadyBooked) throw new Error(`${student.name} is already booked at ${time} on ${isoDate}`)
    }

    const { data: existing, error: fetchErr } = await (withCenter(supabase
      .from(SESSIONS)
      .select(`id, ${SS}(id)`)
      .eq('session_date', isoDate).eq('tutor_id', tutorId).eq('time', time)
      ).maybeSingle() as any)
    if (fetchErr) throw fetchErr

    let sessionId: string
    if (existing) {
      if (existing[SS] && existing[SS].length >= MAX_CAPACITY)
        throw new Error(`This session with the tutor is full for ${isoDate}`)
      sessionId = existing.id
    } else {
      const { data: created, error: createErr } = await supabase
        .from(SESSIONS).insert(withCenterPayload({ session_date: isoDate, tutor_id: tutorId, time })).select('id').single()
      if (createErr) throw createErr
      sessionId = created.id
    }

    const { data: enrolled, error: enrollErr } = await supabase
      .from(SS)
      .insert(withCenterPayload({
        session_id: sessionId, student_id: student.id, name: student.name,
        topic, notes: notes || null, status: 'scheduled', series_id: seriesId,
        confirmation_token: createConfirmationToken(),
      }))
      .select('id, series_id')
      .single()
    if (enrollErr) throw enrollErr

    booked.push({
      date: isoDate,
      time,
      tutorId,
      sessionId,
      rowId: enrolled.id,
      studentId: student.id,
      topic,
      notes: notes || null,
      seriesId: enrolled.series_id ?? seriesId,
    })
  }

  return booked
}

// Internal helper: adjusts hours_left when the present/not-present boundary is crossed.
async function _adjustHoursForAttendanceChange({
  studentId, prevStatus, newStatus,
}: {
  studentId: string; prevStatus: string | null; newStatus: string
}) {
  const wasPresent = prevStatus === 'present' || prevStatus === 'confirmed'
  const isPresent  = newStatus === 'present'
  if (wasPresent === isPresent) return

  const { data: student } = await withCenter(supabase
    .from(STUDENTS).select('hours_left, session_hours').eq('id', studentId)).single()
  if (!student || typeof student.hours_left !== 'number') return

  const hoursPerSession = typeof student.session_hours === 'number' && student.session_hours > 0 ? student.session_hours : 2
  const delta    = isPresent ? -hoursPerSession : hoursPerSession
  const newHours = Math.max(0, student.hours_left + delta)
  await withCenter(supabase.from(STUDENTS).update({ hours_left: newHours }).eq('id', studentId))
  await logEvent('hours_adjusted', {
    studentId, delta, prevHours: student.hours_left, newHours,
    reason: isPresent ? 'attendance_marked_present' : 'attendance_unmarked',
  })
}

export async function updateAttendance({ sessionId, studentId, status }: {
  sessionId: string; studentId: string; status: 'scheduled' | 'present' | 'no-show'
}) {
  // Fetch current status so we can detect present-boundary crossings for hours tracking.
  const { data: current } = await supabase
    .from(SS).select('status').eq('session_id', sessionId).eq('student_id', studentId).single()
  const prevStatus = current?.status ?? null

  const { error } = await supabase.from(SS).update({ status })
    .eq('session_id', sessionId).eq('student_id', studentId)
  if (error) throw error

  await _adjustHoursForAttendanceChange({ studentId, prevStatus, newStatus: status })
}

export async function correctSessionRecord({
  rowId, studentId, status, topic, notes,
}: {
  rowId: string; studentId: string; status: string; topic: string; notes: string | null
}) {
  // Fetch current row for audit log and hours delta.
  const { data: current } = await supabase
    .from(SS).select('status, topic, notes').eq('id', rowId).single()

  const { error } = await supabase.from(SS)
    .update({ status, topic, notes: notes || null })
    .eq('id', rowId)
  if (error) throw error

  if (current) {
    await _adjustHoursForAttendanceChange({ studentId, prevStatus: current.status, newStatus: status })
  }

  await logEvent('session_record_corrected', {
    rowId, studentId,
    prevStatus: current?.status ?? null, newStatus: status,
    prevTopic:  current?.topic  ?? null, newTopic: topic,
    prevNotes:  current?.notes  ?? null, newNotes: notes,
  })
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

export async function updateSessionTopic({ rowId, topic }: {
  rowId: string; topic: string
}) {
  const { error } = await supabase.from(SS).update({ topic }).eq('id', rowId)
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

  const { data: sessionsAtTime, error: satErr } = await withCenter(supabase
    .from(SESSIONS)
    .select('id')
    .eq('session_date', toDate)
    .eq('time', toTime))
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

  const { data: existing, error: existingErr } = await (withCenter(supabase
    .from(SESSIONS)
    .select(`id, ${SS}(id)`)
    .eq('session_date', toDate)
    .eq('tutor_id', toTutorId)
    .eq('time', toTime))
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
      .insert(withCenterPayload({ session_date: toDate, tutor_id: toTutorId, time: toTime }))
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
  const { data, error } = await (withCenter(
    supabase
      .from(RECURRING)
      .select(`id, created_at, student_id, tutor_id, day_of_week, time, topic, notes, start_date, end_date, total_weeks, status, ${STUDENTS} ( name ), ${TUTORS} ( name )`)
  ).order('start_date', { ascending: false }) as any)
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
  const { data, error } = await (withCenter(
    supabase
      .from(SS)
      .select(`id, status, notes, ${SESSIONS} ( id, session_date, time, tutor_id )`)
      .eq('series_id', seriesId)
  ) as any)
  if (error) throw error
  return data ?? []
}

export async function cancelSeries(seriesId: string): Promise<void> {
  const today = toISODate(new Date())
  const { data: futureSessions, error: fetchErr } = await (withCenter(
    supabase
      .from(SS)
      .select(`id, ${SESSIONS}!inner ( session_date )`)
      .eq('series_id', seriesId)
  ) as any)
  if (fetchErr) throw fetchErr

  const futureRowIds = (futureSessions ?? [])
    .filter((r: any) => {
      const s = Array.isArray(r[SESSIONS]) ? r[SESSIONS][0] : r[SESSIONS]
      return s?.session_date >= today
    })
    .map((r: any) => r.id)

  if (futureRowIds.length > 0) {
    const { error: deleteErr } = await withCenter(supabase.from(SS).delete()).in('id', futureRowIds)
    if (deleteErr) throw deleteErr
  }

  const { error: updateErr } = await withCenter(supabase.from(RECURRING)
    .update({ status: 'cancelled' })).eq('id', seriesId)
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

  const { data: seriesRow, error: seriesErr } = await withCenter(
    supabase
      .from(RECURRING)
      .select('end_date, day_of_week')
      .eq('id', seriesId)
  ).single()
  if (seriesErr) throw seriesErr

  const seriesEndDate: string = seriesRow.end_date
  const currentDow: number   = seriesRow.day_of_week
  const targetDow: number    = overrideDayOfWeek ?? currentDow
  const isDayChange           = overrideDayOfWeek !== undefined && overrideDayOfWeek !== currentDow

  const { data: futureSessions, error: fetchErr } = await (withCenter(
    supabase
      .from(SS)
      .select(`id, ${SESSIONS}!inner ( id, session_date )`)
      .eq('series_id', seriesId)
  ) as any)
  if (fetchErr) throw fetchErr

  const futureRows = (futureSessions ?? []).filter((r: any) => {
    const s = Array.isArray(r[SESSIONS]) ? r[SESSIONS][0] : r[SESSIONS]
    return s?.session_date >= today
  })

  if (futureRows.length > 0) {
    const { error: deleteErr } = await withCenter(supabase.from(SS).delete())
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
    const { data: existing } = await (withCenter(
      supabase
        .from(SESSIONS)
        .select(`id, ${SS}(id)`)
        .eq('session_date', isoDate)
        .eq('tutor_id', newTutorId)
        .eq('time', newTime)
    ).maybeSingle() as any)

    let sessionId: string
    if (existing) {
      if (existing[SS] && existing[SS].length >= MAX_CAPACITY)
        throw new Error(`Session is full on ${isoDate} — cannot reschedule to this slot`)
      sessionId = existing.id
    } else {
      const { data: created, error: createErr } = await supabase
        .from(SESSIONS).insert(withCenterPayload({ session_date: isoDate, tutor_id: newTutorId, time: newTime }))
        .select('id').single()
      if (createErr) throw createErr
      sessionId = created.id
    }

    const { error: enrollErr } = await supabase.from(SS).insert(withCenterPayload({
      session_id: sessionId, student_id: student.id, name: student.name,
      topic, status: 'scheduled', series_id: seriesId,
      confirmation_token: createConfirmationToken(),
    }))
    if (enrollErr) throw enrollErr
  }

  const seriesUpdate: Record<string, any> = { tutor_id: newTutorId, time: newTime, topic }
  if (isDayChange) seriesUpdate.day_of_week = targetDow
  const { error: updateErr } = await withCenter(
    supabase.from(RECURRING).update(seriesUpdate)
  ).eq('id', seriesId)
  if (updateErr) throw updateErr
}

export async function markCompletedSeries(): Promise<void> {
  const today = toISODate(new Date())
  const { error } = await withCenter(
    supabase.from(RECURRING)
      .update({ status: 'completed' })
      .eq('status', 'active')
      .lt('end_date', today)
  )
  if (error) throw error
}

export async function updateConfirmationStatus({ rowId, status }: {
  rowId: string; status: 'confirmed' | 'unconfirmed' | null
}) {
  const { error } = await supabase.from(SS)
    .update({ confirmation_status: status }).eq('id', rowId)
  if (error) throw error
}

export async function clearWeekNonRecurring({ weekStart }: {
  weekStart: Date | string
}): Promise<{ deletedBookings: number; deletedSessions: number }> {
  const from = typeof weekStart === 'string' ? weekStart : toISODate(weekStart)
  const weekEnd = new Date(from + 'T00:00:00')
  weekEnd.setDate(weekEnd.getDate() + 6)
  const to = toISODate(weekEnd)

  const { data: weekSessions, error: sessionsErr } = await supabase
    .from(SESSIONS)
    .select('id')
    .gte('session_date', from)
    .lte('session_date', to)
  if (sessionsErr) throw sessionsErr

  const sessionIds = (weekSessions ?? []).map((s: any) => s.id)
  if (sessionIds.length === 0) return { deletedBookings: 0, deletedSessions: 0 }

  const { data: deleteRows, error: deleteErr } = await supabase
    .from(SS)
    .delete()
    .in('session_id', sessionIds)
    .is('series_id', null)
    .select('id')
  if (deleteErr) throw deleteErr

  const { data: remaining, error: remainingErr } = await (supabase
    .from(SESSIONS)
    .select(`id, ${SS}(id)`)
    .in('id', sessionIds) as any)
  if (remainingErr) throw remainingErr

  const emptySessionIds = (remaining ?? [])
    .filter((s: any) => (s[SS] ?? []).length === 0)
    .map((s: any) => s.id)

  if (emptySessionIds.length > 0) {
    const { error: cleanupErr } = await supabase
      .from(SESSIONS)
      .delete()
      .in('id', emptySessionIds)
    if (cleanupErr) throw cleanupErr
  }

  return {
    deletedBookings: (deleteRows ?? []).length,
    deletedSessions: emptySessionIds.length,
  }
}