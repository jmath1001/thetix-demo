const p = process.env.NEXT_PUBLIC_TABLE_PREFIX ?? 'slake'

export const DB = {
  tutors:           `${p}_tutors`,
  students:         `${p}_students`,
  sessions:         `${p}_sessions`,
  sessionStudents:  `${p}_session_students`,
  recurringSeries:  `${p}_recurring_series`,
  timeOff:          `${p}_tutor_time_off`,
  events:           `${p}_events`,
  centerSettings:   `${p}_center_settings`,
  reminderLogs:     `${p}_reminder_logs`,
}