export type CenterSettingsRow = {
  id: string
  center_name: string | null
  center_short_name: string | null
  center_email: string | null
  center_phone: string | null
  center_address: string | null
  reminder_lead_time_hours: number | null
  reminder_subject: string | null
  reminder_body: string | null
  enrollment_instructions: string | null
  tutor_portal_message: string | null
  session_duration_minutes: number | null
  session_times_by_day: Record<string, string[]> | null
}

export type TermRow = {
  id: string
  name: string
  start_date: string
  end_date: string
  status: string
  session_hours: number | null
  operating_hours: Record<string, { open: string; close: string; closed?: boolean }> | null
  session_times_by_day: Record<string, string[]> | null
  date_exceptions: Array<{ date: string; closed: boolean; label?: string }> | null
}

export type DateException = {
  date: string
  closed: boolean
  label?: string
}

export type TermDraft = {
  id: string
  name: string
  start_date: string
  end_date: string
  status: string
  session_hours: number
  operating_hours: Record<string, { open: string; close: string; closed: boolean }>
  session_times_by_day: Record<string, string[]>
  date_exceptions: DateException[]
}
