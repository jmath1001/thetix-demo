const TABLE_PREFIX = 'slake'
const centerId = process.env.NEXT_PUBLIC_CENTER_ID ?? process.env.CENTER_ID ?? ''

export const DB = {
  centers:          `${TABLE_PREFIX}_centers`,
  terms:            `${TABLE_PREFIX}_terms`,
  termEnrollments:  `${TABLE_PREFIX}_term_enrollments`,
  tutorTermAvailability: `${TABLE_PREFIX}_tutor_term_availability`,
  tutors:           `${TABLE_PREFIX}_tutors`,
  students:         `${TABLE_PREFIX}_students`,
  sessions:         `${TABLE_PREFIX}_sessions`,
  sessionStudents:  `${TABLE_PREFIX}_session_students`,
  recurringSeries:  `${TABLE_PREFIX}_recurring_series`,
  timeOff:          `${TABLE_PREFIX}_tutor_time_off`,
  events:           `${TABLE_PREFIX}_events`,
  centerSettings:   `${TABLE_PREFIX}_center_settings`,
  reminderLogs:     `${TABLE_PREFIX}_reminder_logs`,
} as const

export function getCenterId(): string {
  if (!centerId) {
    throw new Error('Missing NEXT_PUBLIC_CENTER_ID or CENTER_ID for center-scoped data access.')
  }

  return centerId
}

export function withCenter(query: any): any {
  return query.eq('center_id', getCenterId())
}

export function withCenterPayload<T extends Record<string, unknown>>(payload: T): T & { center_id: string } {
  return {
    ...payload,
    center_id: getCenterId(),
  }
}