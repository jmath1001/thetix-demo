import { createClient } from '@supabase/supabase-js'
import type {
  ActionAppliedResult,
  CapabilityKey,
  CapabilityPreviewResult,
  CommandContext,
  CommandResult,
} from '@/lib/command/types'
import { activeStudentRows, dateRangeInclusive, resolveDayToken } from '@/lib/command/utils'

const p = process.env.NEXT_PUBLIC_TABLE_PREFIX ?? 'slake'
const STUDENTS = `${p}_students`
const SESSIONS = `${p}_sessions`
const SS = `${p}_session_students`
const TIME_OFF = `${p}_tutor_time_off`

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
  const { data: existing, error: existingErr } = await supabase
    .from(TIME_OFF)
    .select('date')
    .eq('tutor_id', tutorId)
    .gte('date', startDate)
    .lte('date', endDate)
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

  const rows = toInsertDates.map((date) => ({ tutor_id: tutorId, date, note }))
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

  const { error } = await supabase.from(STUDENTS).update(patch).eq('id', studentId)
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
    return {
      type: 'action_applied',
      summary: 'No move needed.',
      detail: 'Booking is already in that target slot.',
    }
  }

  const { data: sessionsAtTime, error: satErr } = await supabase
    .from(SESSIONS)
    .select('id')
    .eq('session_date', toDate)
    .eq('time', toTime)
  if (satErr) throw satErr

  const targetSessionIds = (sessionsAtTime ?? []).map((s: { id: string }) => s.id)
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
    if ((existing[SS] ?? []).length >= 3) throw new Error('Target session is full.')
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

  return {
    type: 'action_applied',
    summary: 'Session moved successfully.',
    detail: `Moved to ${toDate} ${toTime}.`,
  }
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
