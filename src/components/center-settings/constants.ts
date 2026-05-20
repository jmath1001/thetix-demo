export const ALL_DAYS = [
  { dow: '1', label: 'Monday' },
  { dow: '2', label: 'Tuesday' },
  { dow: '3', label: 'Wednesday' },
  { dow: '4', label: 'Thursday' },
  { dow: '5', label: 'Friday' },
  { dow: '6', label: 'Saturday' },
]

export const DEFAULTS = {
  center_name: 'Tutoring Center',
  center_short_name: 'TC',
  center_email: '',
  center_phone: '',
  center_address: '',
  reminder_lead_time_hours: 24,
  reminder_subject: 'Tutoring Reminder',
  reminder_body: 'Hi {{name}}, you have a session on {{date}} at {{time}}.',
  enrollment_instructions: '',
  tutor_portal_message: '',
  session_duration_minutes: 110,
}

export const DEFAULT_OPERATING_HOURS: Record<string, { open: string; close: string; closed: boolean }> = {
  '1': { open: '09:00', close: '21:30', closed: false },
  '2': { open: '09:00', close: '21:30', closed: false },
  '3': { open: '09:00', close: '21:30', closed: false },
  '4': { open: '09:00', close: '21:30', closed: false },
  '6': { open: '09:00', close: '17:30', closed: false },
}

export const DEFAULT_SESSION_TIMES_BY_DAY: Record<string, string[]> = {
  '1': [],
  '2': [],
  '3': [],
  '4': [],
  '6': [],
}

export function parseSlot(slot: string): { start: string; end: string } {
  const parts = slot.split('-')
  if (parts.length === 2 && parts[1].includes(':')) return { start: parts[0], end: parts[1] }
  return { start: slot, end: '' }
}

export const baseInputCls = 'w-full rounded border border-slate-200 bg-white px-3 py-2 text-sm text-slate-800 outline-none focus:border-slate-400 focus:ring-2 focus:ring-slate-100'
