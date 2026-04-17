export type CommandStudent = {
  id: string
  name: string
  subject?: string | null
  grade?: string | null
  hoursLeft?: number
  email?: string | null
  phone?: string | null
  parent_name?: string | null
  parent_email?: string | null
  parent_phone?: string | null
  mom_name?: string | null
  mom_email?: string | null
  mom_phone?: string | null
  dad_name?: string | null
  dad_email?: string | null
  dad_phone?: string | null
  bluebook_url?: string | null
}

export type CommandTutor = {
  id: string
  name: string
  subjects?: string[]
}

export type CommandSessionStudent = {
  rowId?: string
  id?: string
  name?: string
  topic?: string
  status?: string
}

export type CommandSession = {
  id: string
  date: string
  tutorId: string
  time: string
  students?: CommandSessionStudent[]
}

export type CommandTimeOff = {
  id?: string
  tutorId: string
  date: string
  note?: string
}

export type CommandSeat = {
  tutor?: {
    id?: string
    name?: string
    subjects?: string[]
  }
  dayName?: string
  date?: string
  time?: string
  seatsLeft?: number
  block?: {
    label?: string
    display?: string
  }
}

export type CommandContext = {
  today?: string
  students?: CommandStudent[]
  tutors?: CommandTutor[]
  sessions?: CommandSession[]
  timeOff?: CommandTimeOff[]
  availableSeats?: CommandSeat[]
}

export type CapabilityKey =
  | 'create_time_off_range'
  | 'update_student_contact'
  | 'move_session_with_conflict_check'

export type PendingAction = {
  capability: CapabilityKey
  params: Record<string, unknown>
}

export type CapabilityPreviewResult = {
  type: 'capability_preview'
  capability: CapabilityKey
  summary: string
  risk: 'low' | 'medium' | 'high'
  requiresConfirmation: true
  preview: Record<string, unknown>
  pendingAction: PendingAction
}

export type ActionAppliedResult = {
  type: 'action_applied'
  summary: string
  detail?: string
}

export type ReadOnlyResult =
  | { type: 'student_contact'; studentId: string }
  | { type: 'student_sessions'; studentId: string }
  | { type: 'student_profile'; studentId: string }
  | { type: 'slots'; subject: string; day: string; reason?: string }
  | { type: 'answer'; text: string }

export type CommandResult =
  | CapabilityPreviewResult
  | ActionAppliedResult
  | ReadOnlyResult
  | { type: 'slots'; slotIndices: number[]; reason: string }
  | { type: 'error'; text: string }

export type PlannedIntent =
  | ({ type: 'capability'; capability: CapabilityKey; params: Record<string, unknown> } & Record<string, unknown>)
  | ReadOnlyResult
