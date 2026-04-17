import type { CommandSessionStudent } from '@/lib/command/types'

const DAY_ALIASES: Record<string, string[]> = {
  monday: ['monday', 'mon'],
  tuesday: ['tuesday', 'tue'],
  wednesday: ['wednesday', 'wed'],
  thursday: ['thursday', 'thu'],
  friday: ['friday', 'fri'],
  saturday: ['saturday', 'sat'],
  sunday: ['sunday', 'sun'],
  today: ['today'],
  tomorrow: ['tomorrow'],
}

export function isIsoDate(v: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(v)
}

export function nextDayIso(dayName: string, fromIso: string): string {
  const dayOrder: Record<string, number> = {
    monday: 1,
    tuesday: 2,
    wednesday: 3,
    thursday: 4,
    friday: 5,
    saturday: 6,
    sunday: 0,
  }
  const current = new Date(fromIso + 'T00:00:00')
  const targetDay = dayOrder[dayName]
  const delta = (targetDay - current.getDay() + 7) % 7
  current.setDate(current.getDate() + delta)
  return current.toISOString().slice(0, 10)
}

export function resolveDayToken(raw: string, today: string): string | null {
  if (!raw) return null
  const lower = raw.toLowerCase().trim()

  if (isIsoDate(lower)) return lower
  if (lower === 'today') return today
  if (lower === 'tomorrow') {
    const d = new Date(today + 'T00:00:00')
    d.setDate(d.getDate() + 1)
    return d.toISOString().slice(0, 10)
  }

  for (const [canonical, aliases] of Object.entries(DAY_ALIASES)) {
    if (aliases.includes(lower) && canonical !== 'today' && canonical !== 'tomorrow') {
      return nextDayIso(canonical, today)
    }
  }

  return null
}

export function dateRangeInclusive(startIso: string, endIso: string): string[] {
  const dates: string[] = []
  const cursor = new Date(startIso + 'T00:00:00')
  const end = new Date(endIso + 'T00:00:00')
  while (cursor <= end) {
    dates.push(cursor.toISOString().slice(0, 10))
    cursor.setDate(cursor.getDate() + 1)
    if (dates.length > 90) break
  }
  return dates
}

export function activeStudentRows(students: CommandSessionStudent[] = []): CommandSessionStudent[] {
  return students.filter((s) => s?.status !== 'cancelled')
}

export function normalizeTimeToken(raw: string): string | null {
  const lower = raw.toLowerCase().trim()
  const twelveHour = lower.match(/^(\d{1,2})(?::(\d{2}))?\s*(am|pm)$/)
  if (twelveHour) {
    let hour = Number(twelveHour[1])
    const min = Number(twelveHour[2] ?? '0')
    const ampm = twelveHour[3]
    if (Number.isNaN(hour) || Number.isNaN(min) || min < 0 || min > 59) return null
    if (ampm === 'am') {
      if (hour === 12) hour = 0
    } else {
      if (hour < 12) hour += 12
    }
    return `${String(hour).padStart(2, '0')}:${String(min).padStart(2, '0')}`
  }

  const twentyFour = lower.match(/^(\d{1,2})(?::(\d{2}))$/)
  if (twentyFour) {
    const hour = Number(twentyFour[1])
    const min = Number(twentyFour[2])
    if (Number.isNaN(hour) || Number.isNaN(min) || hour > 23 || min > 59) return null
    return `${String(hour).padStart(2, '0')}:${String(min).padStart(2, '0')}`
  }

  return null
}

export function extractQuotedValue(query: string): string | null {
  const quoted = query.match(/["']([^"']+)["']/)
  return quoted?.[1]?.trim() || null
}
