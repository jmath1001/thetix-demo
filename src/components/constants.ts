// ─── Session blocks ───────────────────────────────────────────────────────────

export type SessionBlock = {
  id: string        // e.g. 'S1', 'S2', 'S3', 'S4'
  label: string     // e.g. 'Session 1'
  time: string      // start time in 24hr for storage e.g. '15:30'
  display: string   // e.g. '3:30 – 5:20 PM'
  days: number[]    // which days this session exists on (1=Mon…4=Thu, 6=Sat)
}

export type SessionTimesByDay = Record<string, string[]>

export const DEFAULT_SESSION_TIMES_BY_DAY: SessionTimesByDay = {
  '1': ['13:30-15:20', '15:30-17:20', '17:30-19:20', '19:30-21:20'],
  '2': ['13:30-15:20', '15:30-17:20', '17:30-19:20', '19:30-21:20'],
  '3': ['13:30-15:20', '15:30-17:20', '17:30-19:20', '19:30-21:20'],
  '4': ['13:30-15:20', '15:30-17:20', '17:30-19:20', '19:30-21:20'],
  '6': ['09:30-11:20', '11:30-13:20', '13:30-15:20', '15:30-17:20'],
}

export const SESSION_BLOCKS: SessionBlock[] = [
  { id: 'S1', label: 'Session 1', time: '13:30', display: '1:30 – 3:20 PM', days: [1, 2, 3, 4] },
  { id: 'S2', label: 'Session 2', time: '15:30', display: '3:30 – 5:20 PM', days: [1, 2, 3, 4] },
  { id: 'S3', label: 'Session 3', time: '17:30', display: '5:30 – 7:20 PM', days: [1, 2, 3, 4] },
  { id: 'S4', label: 'Session 4', time: '19:30', display: '7:30 – 9:20 PM', days: [1, 2, 3, 4] },
  { id: 'S5', label: 'Session 1', time: '09:30', display: '9:30 – 11:20 AM', days: [6] },
  { id: 'S6', label: 'Session 2', time: '11:30', display: '11:30 AM – 1:20 PM', days: [6] },
  { id: 'S7', label: 'Session 3', time: '13:30', display: '1:30 – 3:20 PM', days: [6] },
  { id: 'S8', label: 'Session 4', time: '15:30', display: '3:30 – 5:20 PM', days: [6] },
]

function buildBlocksFromTimes(dow: number, slots: string[]): SessionBlock[] {
  return [...new Set(slots)]
    .sort((a, b) => {
      const aStart = a.split('-')[0]
      const bStart = b.split('-')[0]
      return aStart.localeCompare(bStart)
    })
    .map((slot, i) => {
      const parts = slot.split('-')
      const hasEnd = parts.length === 2 && parts[1].includes(':')
      const startTime = hasEnd ? parts[0] : slot
      const endTime = hasEnd ? parts[1] : null

      const existing = SESSION_BLOCKS.find(s => s.time === startTime && s.days.includes(dow))
      if (existing && !endTime) return existing

      return {
        id: `D${dow}-T${startTime}`,
        label: `Session ${i + 1}`,
        time: startTime,
        display: endTime
          ? `${formatTime(startTime)} – ${formatTime(endTime)}`
          : formatTime(startTime),
        days: [dow],
      }
    })
}

// TIME_SLOTS is kept for compatibility — just the unique start times
export const TIME_SLOTS = SESSION_BLOCKS.map(s => s.time)

export const DAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Saturday']

export const MAX_CAPACITY = 3

/** Get session blocks available on a given day-of-week number */
export function getSessionsForDay(dow: number, sessionTimesByDay?: SessionTimesByDay | null): SessionBlock[] {
  if (sessionTimesByDay) {
    const key = String(dow)
    if (Object.prototype.hasOwnProperty.call(sessionTimesByDay, key)) {
      const dayTimes = Array.isArray(sessionTimesByDay[key]) ? sessionTimesByDay[key] : []
      if (dayTimes.length > 0) {
        return buildBlocksFromTimes(dow, dayTimes)
      }
      // Explicitly configured but empty means no sessions for this day.
      return []
    }
  }
  return SESSION_BLOCKS.filter(s => s.days.includes(dow))
}

/** Get a session block by its start time and day */
export function getSessionBlock(time: string, dow: number): SessionBlock | undefined {
  return SESSION_BLOCKS.find(s => s.time === time && s.days.includes(dow))
}

/** Display a 24hr time string as 12hr e.g. '14:30' → '2:30 PM' */
export function formatTime(t: string): string {
  const [hStr, mStr] = t.split(':')
  const h = parseInt(hStr, 10)
  const m = mStr ?? '00'
  const ampm = h >= 12 ? 'PM' : 'AM'
  const h12 = h % 12 === 0 ? 12 : h % 12
  return `${h12}:${m} ${ampm}`
}

/** Format a session block for display e.g. 'Session 1 · 3:30 – 5:20 PM' */
export function formatSession(time: string, dow: number): string {
  const block = getSessionBlock(time, dow)
  return block ? `${block.label} · ${block.display}` : formatTime(time)
}