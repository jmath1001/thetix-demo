import { createClient } from '@supabase/supabase-js'
import type {
  ActionAppliedResult,
  CapabilityKey,
  CapabilityPreviewResult,
  CommandContext,
  CommandResult,
} from '@/lib/command/types'
import { DB, withCenter, withCenterPayload } from '@/lib/db'
import { activeStudentRows, dateRangeInclusive, resolveDayToken } from '@/lib/command/utils'

const STUDENTS = DB.students
const SESSIONS = DB.sessions
const SS = DB.sessionStudents
const TIME_OFF = DB.timeOff
const TUTORS = DB.tutors

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
)

export const CONTACT_FIELDS = new Set([
  'email',
  'phone',
  'parent_name',
  'parent_email',
  'parent_phone',
  'mom_name',
  'mom_email',
  'mom_phone',
  'dad_name',
  'dad_email',
  'dad_phone',
  'bluebook_url',
])

type MoveRow = {
  rowId: string
  studentId: string
  studentName: string
  topic?: string
  fromSessionId: string
  fromTutorId: string
  fromDate: string
  fromTime: string
}

type BookingCandidate = {
  tutorId: string
  tutorName: string
  date: string
  time: string
  seatsLeft: number
}

type DeleteCandidate = {
  rowId: string
  studentId: string
  studentName: string
  sessionId: string
  tutorId: string
  tutorName: string
  date: string
  time: string
  sessionSize: number
}

type TutorScheduleAction =
  | 'view'
  | 'add_time_off'
  | 'remove_time_off'
  | 'add_availability'
  | 'remove_availability'

function normalizeText(v: string): string {
  return v.toLowerCase().trim()
}

function matchesSubject(subject: string, tutorSubjects: string[]): boolean {
  const needle = normalizeText(subject)
  if (!needle) return true
  return tutorSubjects.some((item) => {
    const hay = normalizeText(item)
    return hay.includes(needle) || needle.includes(hay)
  })
}

function buildBookingCandidates(
  params: Record<string, unknown>,
  context: CommandContext,
  studentId: string,
  topicHint: string
): BookingCandidate[] {
  const today = context.today ?? new Date().toISOString().slice(0, 10)
  const requestedTutorId = typeof params.tutorId === 'string' ? params.tutorId : ''
  const requestedDateRaw = typeof params.date === 'string' ? params.date : ''
  const requestedTime = typeof params.time === 'string' ? params.time : ''
  const requestedDate = requestedDateRaw ? resolveDayToken(requestedDateRaw, today) : null

  const studentsSessions = context.sessions ?? []
  const conflictingAtDateTime = new Set(
    studentsSessions
      .flatMap((session) => {
        const hasStudent = activeStudentRows(session.students ?? []).some((row) => row.id === studentId)
        return hasStudent ? [`${session.date}|${session.time}`] : []
      })
  )

  const candidates = (context.availableSeats ?? [])
    .map((seat) => {
      const tutorId = seat.tutor?.id ?? ''
      const tutorName = seat.tutor?.name ?? 'Tutor'
      const date = seat.date ?? ''
      const time = seat.time ?? ''
      const seatsLeft = typeof seat.seatsLeft === 'number' ? seat.seatsLeft : 0
      const tutorSubjects = seat.tutor?.subjects ?? []

      if (!tutorId || !date || !time || seatsLeft <= 0) return null
      if (requestedTutorId && tutorId !== requestedTutorId) return null
      if (requestedDate && date !== requestedDate) return null
      if (requestedTime && time !== requestedTime) return null
      if (!matchesSubject(topicHint, tutorSubjects)) return null
      if (conflictingAtDateTime.has(`${date}|${time}`)) return null

      return { tutorId, tutorName, date, time, seatsLeft }
    })
    .filter(Boolean) as BookingCandidate[]

  candidates.sort((a, b) => {
    if (a.seatsLeft !== b.seatsLeft) return a.seatsLeft - b.seatsLeft
    if (a.date !== b.date) return a.date.localeCompare(b.date)
    return a.time.localeCompare(b.time)
  })

  return candidates
}

function findDeleteCandidates(params: Record<string, unknown>, context: CommandContext): DeleteCandidate[] {
  const sessions = context.sessions ?? []
  const tutors = context.tutors ?? []
  const today = context.today ?? new Date().toISOString().slice(0, 10)
  const studentId = typeof params.studentId === 'string' ? params.studentId : ''
  const requestedTutorId = typeof params.tutorId === 'string' ? params.tutorId : ''
  const requestedDateRaw = typeof params.date === 'string' ? params.date : ''
  const requestedDate = requestedDateRaw ? resolveDayToken(requestedDateRaw, today) : null
  const requestedTime = typeof params.time === 'string' ? params.time : ''

  const candidates: DeleteCandidate[] = []
  for (const session of sessions) {
    if (requestedTutorId && session.tutorId !== requestedTutorId) continue
    if (requestedDate && session.date !== requestedDate) continue
    if (requestedTime && session.time !== requestedTime) continue

    const activeRows = activeStudentRows(session.students ?? [])
    const row = activeRows.find((entry) => entry.id === studentId)
    if (!row || !row.id || !row.name) continue

    candidates.push({
      rowId: row.rowId ?? row.id,
      studentId: row.id,
      studentName: row.name,
      sessionId: session.id,
      tutorId: session.tutorId,
      tutorName: tutors.find((t) => t.id === session.tutorId)?.name ?? 'Tutor',
      date: session.date,
      time: session.time,
      sessionSize: activeRows.length,
    })
  }

  candidates.sort((a, b) => {
    const aUpcoming = a.date >= today ? 0 : 1
    const bUpcoming = b.date >= today ? 0 : 1
    if (aUpcoming !== bUpcoming) return aUpcoming - bUpcoming
    if (a.date !== b.date) return a.date.localeCompare(b.date)
    return a.time.localeCompare(b.time)
  })

  return candidates
}

function dayTokenToDow(raw: string): number | null {
  const day = raw.toLowerCase().trim()
  const map: Record<string, number> = {
    monday: 1,
    mon: 1,
    tuesday: 2,
    tue: 2,
    wednesday: 3,
    wed: 3,
    thursday: 4,
    thu: 4,
    friday: 5,
    fri: 5,
    saturday: 6,
    sat: 6,
    sunday: 7,
    sun: 7,
  }
  return map[day] ?? null
}

function blockDayLabel(dow: number): string {
  const names: Record<number, string> = {
    1: 'Mon',
    2: 'Tue',
    3: 'Wed',
    4: 'Thu',
    5: 'Fri',
    6: 'Sat',
    7: 'Sun',
  }
  return names[dow] ?? 'Day'
}

function sortedBlocks(blocks: string[] = []): string[] {
  return [...blocks].sort((a, b) => {
    const [ad, at] = a.split('-')
    const [bd, bt] = b.split('-')
    const dayCmp = Number(ad) - Number(bd)
    if (dayCmp !== 0) return dayCmp
    return String(at).localeCompare(String(bt))
  })
}

function findMoveRow(params: Record<string, unknown>, sessions: CommandContext['sessions'] = []): MoveRow | null {
  const rowId = typeof params.rowId === 'string' ? params.rowId : ''
  if (rowId) {
    for (const session of sessions ?? []) {
      for (const row of activeStudentRows(session.students ?? [])) {
        if (row.rowId === rowId || row.id === rowId) {
          if (!row.id || !row.name) continue
          return {
            rowId: row.rowId ?? row.id,
            studentId: row.id,
            studentName: row.name,
            topic: row.topic,
            fromSessionId: session.id,
            fromTutorId: session.tutorId,
            fromDate: session.date,
            fromTime: session.time,
          }
        }
      }
    }
    return null
  }

  const fromDate = typeof params.fromDate === 'string' ? params.fromDate : ''
  const fromTime = typeof params.fromTime === 'string' ? params.fromTime : ''
  const fromTutorId = typeof params.fromTutorId === 'string' ? params.fromTutorId : ''
  const studentId = typeof params.studentId === 'string' ? params.studentId : ''

  for (const session of sessions ?? []) {
    if (fromDate && session.date !== fromDate) continue
    if (fromTime && session.time !== fromTime) continue
    if (fromTutorId && session.tutorId !== fromTutorId) continue

    for (const row of activeStudentRows(session.students ?? [])) {
      if (!row.id || !row.name) continue
      if (studentId && row.id !== studentId) continue
      return {
        rowId: row.rowId ?? row.id,
        studentId: row.id,
        studentName: row.name,
        topic: row.topic,
        fromSessionId: session.id,
        fromTutorId: session.tutorId,
        fromDate: session.date,
        fromTime: session.time,
      }
    }
  }

  return null
}

function dryRunCreateTimeOff(params: Record<string, unknown>, context: CommandContext): CommandResult {
  const tutorId = typeof params.tutorId === 'string' ? params.tutorId : ''
  const tutor = (context.tutors ?? []).find((t) => t.id === tutorId)
  if (!tutor) return { type: 'error', text: 'Tutor not found for this request.' }

  const today = context.today ?? new Date().toISOString().slice(0, 10)
  const startToken = typeof params.startDate === 'string' ? params.startDate : ''
  const endToken = typeof params.endDate === 'string' ? params.endDate : startToken
  const startDate = resolveDayToken(startToken, today)
  const endDate = resolveDayToken(endToken, today)

  if (!startDate || !endDate) return { type: 'error', text: 'I could not resolve the date range.' }
  if (endDate < startDate) return { type: 'error', text: 'End date must be on or after start date.' }

  const requestedDates = dateRangeInclusive(startDate, endDate)
  const existingSet = new Set(
    (context.timeOff ?? [])
      .filter((entry) => entry.tutorId === tutorId)
      .map((entry) => entry.date)
  )
  const toInsertDates = requestedDates.filter((d) => !existingSet.has(d))
  const alreadyBlockedDates = requestedDates.filter((d) => existingSet.has(d))

  const impacted = (context.sessions ?? []).flatMap((session) => {
    if (session.tutorId !== tutorId) return []
    if (!toInsertDates.includes(session.date)) return []
    const rows = activeStudentRows(session.students ?? [])
    if (rows.length === 0) return []
    return [{
      sessionId: session.id,
      date: session.date,
      time: session.time,
      studentCount: rows.length,
      studentNames: rows.map((r) => r.name).filter(Boolean),
    }]
  })

  const note = typeof params.note === 'string' ? params.note.trim() : ''

  const preview: CapabilityPreviewResult = {
    type: 'capability_preview',
    capability: 'create_time_off_range',
    summary: `Block ${tutor.name} from ${startDate} to ${endDate}.`,
    risk: impacted.length >= 6 ? 'high' : impacted.length > 0 ? 'medium' : 'low',
    requiresConfirmation: true,
    preview: {
      kind: 'time_off_range',
      tutorId: tutor.id,
      tutorName: tutor.name,
      startDate,
      endDate,
      note,
      requestedDates,
      toInsertDates,
      alreadyBlockedDates,
      impactedSessions: impacted,
    },
    pendingAction: {
      capability: 'create_time_off_range',
      params: { tutorId: tutor.id, startDate, endDate, note },
    },
  }

  return preview
}

async function executeCreateTimeOff(params: Record<string, unknown>): Promise<ActionAppliedResult> {
  const tutorId = typeof params.tutorId === 'string' ? params.tutorId : ''
  const startDate = typeof params.startDate === 'string' ? params.startDate : ''
  const endDate = typeof params.endDate === 'string' ? params.endDate : ''
  const note = typeof params.note === 'string' ? params.note : ''

  const requestedDates = dateRangeInclusive(startDate, endDate)
  const { data: existing, error: existingErr } = await withCenter(
    supabase
      .from(TIME_OFF)
      .select('date')
      .eq('tutor_id', tutorId)
      .gte('date', startDate)
      .lte('date', endDate)
  )
  if (existingErr) throw existingErr

  const existingSet = new Set((existing ?? []).map((r: { date: string }) => r.date))
  const toInsertDates = requestedDates.filter((d) => !existingSet.has(d))

  if (toInsertDates.length === 0) {
    return {
      type: 'action_applied',
      summary: 'No changes needed. All dates were already blocked.',
      detail: 'Time-off records already existed for the full requested range.',
    }
  }

  const rows = toInsertDates.map((date) => withCenterPayload({ tutor_id: tutorId, date, note }))
  const { error: insertErr } = await supabase.from(TIME_OFF).insert(rows)
  if (insertErr) throw insertErr

  return {
    type: 'action_applied',
    summary: `Time off added for ${toInsertDates.length} day${toInsertDates.length === 1 ? '' : 's'}.`,
    detail: `${startDate} to ${endDate}`,
  }
}

function dryRunUpdateStudentContact(params: Record<string, unknown>, context: CommandContext): CommandResult {
  const field = typeof params.field === 'string' ? params.field : ''
  if (!CONTACT_FIELDS.has(field)) {
    return { type: 'error', text: `Unsupported contact field: ${field || 'unknown'}` }
  }

  const studentId = typeof params.studentId === 'string' ? params.studentId : ''
  const student = (context.students ?? []).find((s) => s.id === studentId)
  if (!student) return { type: 'error', text: 'Student not found for this update.' }

  const beforeValue = (student as Record<string, unknown>)[field] ?? null
  const valueRaw = params.value
  const afterValue = typeof valueRaw === 'string' ? (valueRaw.trim() || null) : null

  const preview: CapabilityPreviewResult = {
    type: 'capability_preview',
    capability: 'update_student_contact',
    summary: `Update ${student.name}: ${field.replaceAll('_', ' ')}.`,
    risk: 'low',
    requiresConfirmation: true,
    preview: {
      kind: 'student_contact_diff',
      studentId: student.id,
      studentName: student.name,
      field,
      beforeValue,
      afterValue,
    },
    pendingAction: {
      capability: 'update_student_contact',
      params: { studentId: student.id, field, value: afterValue },
    },
  }

  return preview
}

async function executeUpdateStudentContact(params: Record<string, unknown>): Promise<ActionAppliedResult> {
  const field = typeof params.field === 'string' ? params.field : ''
  if (!CONTACT_FIELDS.has(field)) {
    throw new Error(`Unsupported contact field: ${field || 'unknown'}`)
  }

  const studentId = typeof params.studentId === 'string' ? params.studentId : ''
  const patch: Record<string, unknown> = {}
  patch[field] = params.value ?? null

  const { error } = await withCenter(supabase.from(STUDENTS).update(patch)).eq('id', studentId)
  if (error) throw error

  return {
    type: 'action_applied',
    summary: 'Student contact updated.',
    detail: `${field.replaceAll('_', ' ')} saved successfully.`,
  }
}

function dryRunMoveSession(params: Record<string, unknown>, context: CommandContext): CommandResult {
  const sessions = context.sessions ?? []
  const tutors = context.tutors ?? []

  const row = findMoveRow(params, sessions)
  if (!row) return { type: 'error', text: 'I could not find the source booking to move.' }

  const toDate = typeof params.toDate === 'string' ? resolveDayToken(params.toDate, context.today ?? '') : null
  const toTime = typeof params.toTime === 'string' ? params.toTime : ''
  const toTutorId = typeof params.toTutorId === 'string' ? params.toTutorId : ''

  if (!toDate || !toTime || !toTutorId) {
    return { type: 'error', text: 'Move request needs target tutor, date, and time.' }
  }

  const toTutor = tutors.find((t) => t.id === toTutorId)
  if (!toTutor) return { type: 'error', text: 'Target tutor was not found.' }

  const isSameSlot = row.fromTutorId === toTutorId && row.fromDate === toDate && row.fromTime === toTime
  if (isSameSlot) return { type: 'answer', text: 'This booking is already in that exact slot.' }

  const conflicting = sessions.some((session) => {
    if (session.date !== toDate || session.time !== toTime) return false
    return activeStudentRows(session.students ?? []).some((s) => s.id === row.studentId)
  })
  if (conflicting) return { type: 'error', text: 'Student is already booked at the target date/time.' }

  const targetSession = sessions.find((session) => session.tutorId === toTutorId && session.date === toDate && session.time === toTime)
  const targetCount = targetSession ? activeStudentRows(targetSession.students ?? []).length : 0
  if (targetCount >= 3) return { type: 'error', text: 'Target session is full (3 students).' }

  const fromTutor = tutors.find((t) => t.id === row.fromTutorId)

  const preview: CapabilityPreviewResult = {
    type: 'capability_preview',
    capability: 'move_session_with_conflict_check',
    summary: `Move ${row.studentName} to ${toTutor.name} on ${toDate} at ${toTime}.`,
    risk: 'medium',
    requiresConfirmation: true,
    preview: {
      kind: 'session_move',
      studentId: row.studentId,
      studentName: row.studentName,
      rowId: row.rowId,
      fromSessionId: row.fromSessionId,
      fromTutorId: row.fromTutorId,
      fromTutorName: fromTutor?.name ?? 'Tutor',
      fromDate: row.fromDate,
      fromTime: row.fromTime,
      toTutorId,
      toTutorName: toTutor.name,
      toDate,
      toTime,
      targetSessionCurrentCount: targetCount,
      targetSessionId: targetSession?.id ?? null,
    },
    pendingAction: {
      capability: 'move_session_with_conflict_check',
      params: {
        studentId: row.studentId,
        rowId: row.rowId,
        fromSessionId: row.fromSessionId,
        toTutorId,
        toDate,
        toTime,
      },
    },
  }

  return preview
}

async function executeMoveSession(params: Record<string, unknown>): Promise<ActionAppliedResult> {
  const fromSessionId = typeof params.fromSessionId === 'string' ? params.fromSessionId : ''
  const toTutorId = typeof params.toTutorId === 'string' ? params.toTutorId : ''
  const toDate = typeof params.toDate === 'string' ? params.toDate : ''
  const toTime = typeof params.toTime === 'string' ? params.toTime : ''
  const studentId = typeof params.studentId === 'string' ? params.studentId : ''
  const rowId = typeof params.rowId === 'string' ? params.rowId : ''

  const { data: fromSession, error: fromErr } = await withCenter(
    supabase
      .from(SESSIONS)
      .select('id, tutor_id, session_date, time')
      .eq('id', fromSessionId)
  )
    .single()
  if (fromErr) throw fromErr

  if (
    fromSession.tutor_id === toTutorId &&
    fromSession.session_date === toDate &&
    fromSession.time === toTime
  ) {
    return {
      type: 'action_applied',
      summary: 'No move needed.',
      detail: 'Booking is already in that target slot.',
    }
  }

  const { data: sessionsAtTime, error: satErr } = await withCenter(
    supabase
      .from(SESSIONS)
      .select('id')
      .eq('session_date', toDate)
      .eq('time', toTime)
  )
  if (satErr) throw satErr

  const targetSessionIds = (sessionsAtTime ?? []).map((s: { id: string }) => s.id)
  if (targetSessionIds.length > 0) {
    const { data: dup, error: dupErr } = await withCenter(
      supabase
        .from(SS)
        .select('id')
        .in('session_id', targetSessionIds)
        .eq('student_id', studentId)
        .neq('status', 'cancelled')
        .neq('id', rowId)
    )
      .maybeSingle()
    if (dupErr) throw dupErr
    if (dup) throw new Error('Student is already booked at that date/time.')
  }

  const { data: existing, error: existingErr } = await (withCenter(supabase
    .from(SESSIONS)
    .select(`id, ${SS}(id)`)
    .eq('session_date', toDate)
    .eq('tutor_id', toTutorId)
    .eq('time', toTime)
    ).maybeSingle() as any)
  if (existingErr) throw existingErr

  let targetSessionId: string
  if (existing) {
    if ((existing[SS] ?? []).length >= 3) throw new Error('Target session is full.')
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

  const { error: moveErr } = await withCenter(
    supabase
      .from(SS)
      .update({ session_id: targetSessionId })
  )
    .eq('id', rowId)
    .eq('student_id', studentId)
  if (moveErr) throw moveErr

  return {
    type: 'action_applied',
    summary: 'Session moved successfully.',
    detail: `Moved to ${toDate} ${toTime}.`,
  }
}

function dryRunBookStudent(params: Record<string, unknown>, context: CommandContext): CommandResult {
  const studentId = typeof params.studentId === 'string' ? params.studentId : ''
  const student = (context.students ?? []).find((s) => s.id === studentId)
  if (!student) return { type: 'error', text: 'Student not found for this booking request.' }

  const requestedTopic = typeof params.topic === 'string' ? params.topic.trim() : ''
  const topicHint = requestedTopic || student.subject || ''
  const candidates = buildBookingCandidates(params, context, student.id, topicHint)

  if (candidates.length === 0) {
    return { type: 'error', text: 'I could not find an available optimized slot with those constraints.' }
  }

  const selected = candidates[0]
  const requestedDateRaw = typeof params.date === 'string' ? params.date : ''
  const requestedTime = typeof params.time === 'string' ? params.time : ''
  const requestedTutorId = typeof params.tutorId === 'string' ? params.tutorId : ''
  const usedOptimization = !requestedDateRaw || !requestedTime || !requestedTutorId

  const preview: CapabilityPreviewResult = {
    type: 'capability_preview',
    capability: 'book_student_with_optimization',
    summary: `Book ${student.name} with ${selected.tutorName} on ${selected.date} at ${selected.time}${usedOptimization ? ' (optimized).' : '.'}`,
    risk: usedOptimization ? 'medium' : 'low',
    requiresConfirmation: true,
    preview: {
      kind: 'book_student_plan',
      studentId: student.id,
      studentName: student.name,
      topic: topicHint,
      selected,
      usedOptimization,
      alternatives: candidates.slice(1, 4),
    },
    pendingAction: {
      capability: 'book_student_with_optimization',
      params: {
        studentId: student.id,
        tutorId: selected.tutorId,
        date: selected.date,
        time: selected.time,
        topic: topicHint,
      },
    },
  }

  return preview
}

async function executeBookStudent(params: Record<string, unknown>): Promise<ActionAppliedResult> {
  const studentId = typeof params.studentId === 'string' ? params.studentId : ''
  const tutorId = typeof params.tutorId === 'string' ? params.tutorId : ''
  const date = typeof params.date === 'string' ? params.date : ''
  const time = typeof params.time === 'string' ? params.time : ''
  const topic = typeof params.topic === 'string' ? params.topic : ''

  if (!studentId || !tutorId || !date || !time) {
    throw new Error('Booking execution requires student, tutor, date, and time.')
  }

  const { data: student, error: studentErr } = await withCenter(
    supabase
      .from(STUDENTS)
      .select('id, name')
      .eq('id', studentId)
  )
    .single()
  if (studentErr) throw studentErr

  const { data: sessionsAtTime, error: satErr } = await withCenter(
    supabase
      .from(SESSIONS)
      .select('id')
      .eq('session_date', date)
      .eq('time', time)
  )
  if (satErr) throw satErr

  const targetSessionIds = (sessionsAtTime ?? []).map((s: { id: string }) => s.id)
  if (targetSessionIds.length > 0) {
    const { data: dup, error: dupErr } = await withCenter(
      supabase
        .from(SS)
        .select('id')
        .in('session_id', targetSessionIds)
        .eq('student_id', studentId)
        .neq('status', 'cancelled')
    )
      .maybeSingle()
    if (dupErr) throw dupErr
    if (dup) throw new Error('Student is already booked at that date/time.')
  }

  const { data: existing, error: existingErr } = await (withCenter(supabase
    .from(SESSIONS)
    .select(`id, ${SS}(id)`)
    .eq('session_date', date)
    .eq('tutor_id', tutorId)
    .eq('time', time)
    ).maybeSingle() as any)
  if (existingErr) throw existingErr

  let sessionId: string
  if (existing) {
    if ((existing[SS] ?? []).length >= 3) throw new Error('Target session is full.')
    sessionId = existing.id
  } else {
    const { data: created, error: createErr } = await supabase
      .from(SESSIONS)
      .insert(withCenterPayload({ session_date: date, tutor_id: tutorId, time }))
      .select('id')
      .single()
    if (createErr) throw createErr
    sessionId = created.id
  }

  const confirmationToken =
    globalThis.crypto?.randomUUID?.() ??
    `${Date.now()}-${Math.random().toString(16).slice(2)}-${Math.random().toString(16).slice(2)}`

  const { error: enrollErr } = await supabase.from(SS).insert(withCenterPayload({
    session_id: sessionId,
    student_id: studentId,
    name: student.name,
    topic,
    status: 'scheduled',
    confirmation_token: confirmationToken,
  }))
  if (enrollErr) throw enrollErr

  return {
    type: 'action_applied',
    summary: 'Student booked successfully.',
    detail: `${student.name} on ${date} at ${time}.`,
  }
}

function dryRunDeleteStudentBooking(params: Record<string, unknown>, context: CommandContext): CommandResult {
  const studentId = typeof params.studentId === 'string' ? params.studentId : ''
  const student = (context.students ?? []).find((s) => s.id === studentId)
  if (!student) return { type: 'error', text: 'Student not found for this removal request.' }

  const candidates = findDeleteCandidates(params, context)
  if (candidates.length === 0) {
    return { type: 'error', text: 'I could not find a matching active booking to delete.' }
  }

  const selected = candidates[0]
  const explicitlyScoped = Boolean(params.date || params.time || params.tutorId)

  const preview: CapabilityPreviewResult = {
    type: 'capability_preview',
    capability: 'delete_student_booking_with_optimization',
    summary: `Delete booking for ${student.name} on ${selected.date} at ${selected.time} with ${selected.tutorName}.`,
    risk: explicitlyScoped ? 'low' : candidates.length > 1 ? 'medium' : 'low',
    requiresConfirmation: true,
    preview: {
      kind: 'delete_booking_plan',
      studentId: selected.studentId,
      studentName: selected.studentName,
      selected,
      usedOptimization: !explicitlyScoped,
      matchesFound: candidates.length,
      alternatives: candidates.slice(1, 5),
    },
    pendingAction: {
      capability: 'delete_student_booking_with_optimization',
      params: {
        studentId: selected.studentId,
        rowId: selected.rowId,
        sessionId: selected.sessionId,
      },
    },
  }

  return preview
}

async function executeDeleteStudentBooking(params: Record<string, unknown>): Promise<ActionAppliedResult> {
  const studentId = typeof params.studentId === 'string' ? params.studentId : ''
  const rowId = typeof params.rowId === 'string' ? params.rowId : ''
  const sessionId = typeof params.sessionId === 'string' ? params.sessionId : ''
  if (!studentId || !rowId) throw new Error('Delete execution requires student and booking row IDs.')

  const { error } = await supabase
    .from(SS)
    .delete()
    .eq('id', rowId)
    .eq('student_id', studentId)
    .eq('session_id', sessionId)
  if (error) throw error

  return {
    type: 'action_applied',
    summary: 'Booking deleted successfully.',
    detail: 'The student was removed from the selected session.',
  }
}

function dryRunManageTutorSchedule(params: Record<string, unknown>, context: CommandContext): CommandResult {
  const action = (typeof params.action === 'string' ? params.action : 'view') as TutorScheduleAction
  const tutorId = typeof params.tutorId === 'string' ? params.tutorId : ''
  const tutor = (context.tutors ?? []).find((t) => t.id === tutorId)
  if (!tutor) return { type: 'error', text: 'Tutor not found for this schedule request.' }

  const tutorTimeOff = (context.timeOff ?? [])
    .filter((entry) => entry.tutorId === tutor.id)
    .sort((a, b) => a.date.localeCompare(b.date))

  const availabilityBlocks = sortedBlocks(tutor.availabilityBlocks ?? [])

  if (action === 'view') {
    return {
      type: 'capability_preview',
      capability: 'manage_tutor_schedule',
      summary: `Review ${tutor.name}'s availability and time off.`,
      risk: 'low',
      requiresConfirmation: true,
      preview: {
        kind: 'tutor_schedule_view',
        tutorId: tutor.id,
        tutorName: tutor.name,
        availabilityBlocks,
        timeOffEntries: tutorTimeOff,
      },
      pendingAction: {
        capability: 'manage_tutor_schedule',
        params: { action: 'view', tutorId: tutor.id },
      },
    }
  }

  if (action === 'add_availability' || action === 'remove_availability') {
    const day = typeof params.day === 'string' ? params.day : ''
    const time = typeof params.time === 'string' ? params.time : ''
    const dow = dayTokenToDow(day)
    if (!dow || !time) return { type: 'error', text: 'Availability edits need a day and time.' }

    const block = `${dow}-${time}`
    const hasBlock = availabilityBlocks.includes(block)

    if (action === 'add_availability' && hasBlock) {
      return { type: 'answer', text: `${tutor.name} is already available on ${blockDayLabel(dow)} at ${time}.` }
    }
    if (action === 'remove_availability' && !hasBlock) {
      return { type: 'answer', text: `${tutor.name} does not currently have that availability block.` }
    }

    const nextBlocks = action === 'add_availability'
      ? sortedBlocks([...availabilityBlocks, block])
      : availabilityBlocks.filter((b) => b !== block)

    return {
      type: 'capability_preview',
      capability: 'manage_tutor_schedule',
      summary: `${action === 'add_availability' ? 'Add' : 'Remove'} ${tutor.name}'s availability on ${blockDayLabel(dow)} at ${time}.`,
      risk: 'low',
      requiresConfirmation: true,
      preview: {
        kind: 'tutor_schedule_edit',
        action,
        tutorId: tutor.id,
        tutorName: tutor.name,
        block,
        beforeCount: availabilityBlocks.length,
        afterCount: nextBlocks.length,
      },
      pendingAction: {
        capability: 'manage_tutor_schedule',
        params: { action, tutorId: tutor.id, day, time },
      },
    }
  }

  if (action === 'add_time_off' || action === 'remove_time_off') {
    const today = context.today ?? new Date().toISOString().slice(0, 10)
    const startRaw = typeof params.startDate === 'string' ? params.startDate : ''
    const endRaw = typeof params.endDate === 'string' ? params.endDate : startRaw
    const startDate = resolveDayToken(startRaw, today)
    const endDate = resolveDayToken(endRaw, today)
    if (!startDate || !endDate) return { type: 'error', text: 'Could not resolve the time-off date range.' }
    if (endDate < startDate) return { type: 'error', text: 'End date must be on or after start date.' }

    const requestedDates = dateRangeInclusive(startDate, endDate)
    const existingSet = new Set(tutorTimeOff.map((entry) => entry.date))

    const addDates = requestedDates.filter((d) => !existingSet.has(d))
    const removeDates = requestedDates.filter((d) => existingSet.has(d))

    if (action === 'add_time_off' && addDates.length === 0) {
      return { type: 'answer', text: 'All requested dates are already blocked as time off.' }
    }
    if (action === 'remove_time_off' && removeDates.length === 0) {
      return { type: 'answer', text: 'No existing time-off entries matched that range.' }
    }

    const note = typeof params.note === 'string' ? params.note.trim() : ''
    return {
      type: 'capability_preview',
      capability: 'manage_tutor_schedule',
      summary: `${action === 'add_time_off' ? 'Add' : 'Remove'} ${tutor.name}'s time off from ${startDate} to ${endDate}.`,
      risk: 'medium',
      requiresConfirmation: true,
      preview: {
        kind: 'tutor_schedule_edit',
        action,
        tutorId: tutor.id,
        tutorName: tutor.name,
        startDate,
        endDate,
        datesAffected: action === 'add_time_off' ? addDates : removeDates,
        note,
      },
      pendingAction: {
        capability: 'manage_tutor_schedule',
        params: {
          action,
          tutorId: tutor.id,
          startDate,
          endDate,
          note,
        },
      },
    }
  }

  return { type: 'error', text: `Unsupported tutor schedule action: ${action}` }
}

async function executeManageTutorSchedule(params: Record<string, unknown>): Promise<ActionAppliedResult> {
  const action = (typeof params.action === 'string' ? params.action : 'view') as TutorScheduleAction
  const tutorId = typeof params.tutorId === 'string' ? params.tutorId : ''
  if (!tutorId) throw new Error('Tutor is required for this schedule action.')

  if (action === 'view') {
    return {
      type: 'action_applied',
      summary: 'Tutor schedule reviewed.',
      detail: 'No changes were applied.',
    }
  }

  if (action === 'add_availability' || action === 'remove_availability') {
    const day = typeof params.day === 'string' ? params.day : ''
    const time = typeof params.time === 'string' ? params.time : ''
    const dow = dayTokenToDow(day)
    if (!dow || !time) throw new Error('Availability updates require a valid day and time.')

    const block = `${dow}-${time}`

    const { data: tutor, error: tutorErr } = await withCenter(
      supabase
        .from(TUTORS)
        .select('availability, availability_blocks')
        .eq('id', tutorId)
    )
      .single()
    if (tutorErr) throw tutorErr

    const currentBlocks = sortedBlocks((tutor.availability_blocks as string[] | null) ?? [])
    const nextBlocks = action === 'add_availability'
      ? sortedBlocks([...new Set([...currentBlocks, block])])
      : currentBlocks.filter((b) => b !== block)

    const nextAvailability = [...new Set(nextBlocks.map((b) => Number(b.split('-')[0])))]
      .filter((d) => Number.isFinite(d))
      .sort((a, b) => a - b)

    const { error: updateErr } = await withCenter(
      supabase
        .from(TUTORS)
        .update({
        availability_blocks: nextBlocks,
        availability: nextAvailability,
        })
    )
      .eq('id', tutorId)
    if (updateErr) throw updateErr

    return {
      type: 'action_applied',
      summary: action === 'add_availability' ? 'Availability block added.' : 'Availability block removed.',
      detail: `${blockDayLabel(dow)} ${time}`,
    }
  }

  if (action === 'add_time_off' || action === 'remove_time_off') {
    const startDate = typeof params.startDate === 'string' ? params.startDate : ''
    const endDate = typeof params.endDate === 'string' ? params.endDate : startDate
    if (!startDate || !endDate) throw new Error('Time-off updates require a date range.')

    const requestedDates = dateRangeInclusive(startDate, endDate)

    if (action === 'add_time_off') {
      const note = typeof params.note === 'string' ? params.note : ''
      const { data: existing, error: existingErr } = await withCenter(
        supabase
          .from(TIME_OFF)
          .select('date')
          .eq('tutor_id', tutorId)
          .gte('date', startDate)
          .lte('date', endDate)
      )
      if (existingErr) throw existingErr

      const existingSet = new Set((existing ?? []).map((row: { date: string }) => row.date))
      const toInsert = requestedDates.filter((d) => !existingSet.has(d))
      if (toInsert.length === 0) {
        return {
          type: 'action_applied',
          summary: 'No time-off changes needed.',
          detail: 'All requested dates were already blocked.',
        }
      }

      const { error: insertErr } = await supabase.from(TIME_OFF).insert(
        toInsert.map((date) => withCenterPayload({ tutor_id: tutorId, date, note }))
      )
      if (insertErr) throw insertErr

      return {
        type: 'action_applied',
        summary: `Added ${toInsert.length} time-off day${toInsert.length === 1 ? '' : 's'}.`,
        detail: `${startDate} to ${endDate}`,
      }
    }

    const { data: existing, error: existingErr } = await withCenter(
      supabase
        .from(TIME_OFF)
        .select('id, date')
        .eq('tutor_id', tutorId)
        .gte('date', startDate)
        .lte('date', endDate)
    )
    if (existingErr) throw existingErr

    const ids = (existing ?? []).map((row: { id: string }) => row.id).filter(Boolean)
    if (ids.length === 0) {
      return {
        type: 'action_applied',
        summary: 'No time-off entries removed.',
        detail: 'No matching time-off rows in that range.',
      }
    }

    const { error: deleteErr } = await withCenter(supabase.from(TIME_OFF).delete()).in('id', ids)
    if (deleteErr) throw deleteErr

    return {
      type: 'action_applied',
      summary: `Removed ${ids.length} time-off day${ids.length === 1 ? '' : 's'}.`,
      detail: `${startDate} to ${endDate}`,
    }
  }

  throw new Error(`Unsupported tutor schedule action: ${action}`)
}

export const CAPABILITY_REGISTRY: Record<
  CapabilityKey,
  {
    title: string
    risk: 'low' | 'medium' | 'high'
    dryRun: (params: Record<string, unknown>, context: CommandContext) => Promise<CommandResult> | CommandResult
    execute: (params: Record<string, unknown>) => Promise<ActionAppliedResult>
  }
> = {
  create_time_off_range: {
    title: 'Create tutor time off range',
    risk: 'medium',
    dryRun: dryRunCreateTimeOff,
    execute: executeCreateTimeOff,
  },
  update_student_contact: {
    title: 'Update student contact field',
    risk: 'low',
    dryRun: dryRunUpdateStudentContact,
    execute: executeUpdateStudentContact,
  },
  move_session_with_conflict_check: {
    title: 'Move session with conflict checks',
    risk: 'medium',
    dryRun: dryRunMoveSession,
    execute: executeMoveSession,
  },
  book_student_with_optimization: {
    title: 'Book student with optimization',
    risk: 'medium',
    dryRun: dryRunBookStudent,
    execute: executeBookStudent,
  },
  delete_student_booking_with_optimization: {
    title: 'Delete student booking with optimization',
    risk: 'medium',
    dryRun: dryRunDeleteStudentBooking,
    execute: executeDeleteStudentBooking,
  },
  manage_tutor_schedule: {
    title: 'Manage tutor schedule',
    risk: 'medium',
    dryRun: dryRunManageTutorSchedule,
    execute: executeManageTutorSchedule,
  },
}

export async function runCapabilityDryRun(
  capability: string,
  params: Record<string, unknown>,
  context: CommandContext
): Promise<CommandResult> {
  if (!(capability in CAPABILITY_REGISTRY)) {
    return { type: 'error', text: `Unsupported capability: ${capability}` }
  }
  const key = capability as CapabilityKey
  return CAPABILITY_REGISTRY[key].dryRun(params, context)
}

export async function runCapabilityExecute(
  capability: string,
  params: Record<string, unknown>
): Promise<CommandResult> {
  if (!(capability in CAPABILITY_REGISTRY)) {
    return { type: 'error', text: `Unsupported capability: ${capability}` }
  }
  const key = capability as CapabilityKey
  return CAPABILITY_REGISTRY[key].execute(params)
}
