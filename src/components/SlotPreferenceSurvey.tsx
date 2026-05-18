'use client'

import { useCallback, useState } from 'react'
import { Check, ChevronDown, Loader2, Save, X } from 'lucide-react'
import { formatTime } from '@/components/constants'

// ── Types ─────────────────────────────────────────────────────────────────────

export type SlotPreferences = Array<string[]> // up to 3 choices; each choice is 1–2 blocks

interface Props {
  studentId: string
  studentName: string
  termId: string
  /** session_times_by_day from the active term: { "1": ["15:00","16:00"], ... } */
  sessionTimesByDay: Record<string, string[]>
  /** Initial preferences loaded from DB, or null */
  initialPreferences: SlotPreferences | null
  onSave?: (prefs: SlotPreferences) => void
  onClose?: () => void
}

const DOW_LABELS: Record<string, string> = {
  '1': 'Monday',
  '2': 'Tuesday',
  '3': 'Wednesday',
  '4': 'Thursday',
  '5': 'Friday',
  '6': 'Saturday',
  '7': 'Sunday',
}

const CHOICE_LABELS = ['1st Choice', '2nd Choice', '3rd Choice']
const CHOICE_COLORS = [
  { border: 'border-indigo-300', badge: 'bg-indigo-600 text-white', ring: 'ring-indigo-400', header: 'bg-indigo-50 border-indigo-200' },
  { border: 'border-violet-300', badge: 'bg-violet-600 text-white', ring: 'ring-violet-400', header: 'bg-violet-50 border-violet-200' },
  { border: 'border-slate-300',  badge: 'bg-slate-500 text-white',  ring: 'ring-slate-400',  header: 'bg-slate-50 border-slate-200'  },
]

// ── Helpers ───────────────────────────────────────────────────────────────────

function parseBlock(block: string): { dow: string; time: string } | null {
  const m = block.match(/^(\d)-([\d:]+)$/)
  if (!m) return null
  return { dow: m[1], time: m[2] }
}

function addOneHour(time: string): string {
  const [h, m] = time.split(':').map(Number)
  const next = h + 1
  return `${String(next).padStart(2, '0')}:${String(m).padStart(2, '0')}`
}

/** Given a dow + time, return the next consecutive time if it exists in sessionTimesByDay */
function consecutiveBlock(
  dow: string,
  time: string,
  sessionTimesByDay: Record<string, string[]>,
): string | null {
  const nextTime = addOneHour(time)
  const slots = sessionTimesByDay[dow] ?? []
  return slots.includes(nextTime) ? `${dow}-${nextTime}` : null
}

// ── Single choice editor ──────────────────────────────────────────────────────

function ChoiceEditor({
  index,
  choice,
  sessionTimesByDay,
  onChange,
}: {
  index: number
  choice: string[]
  sessionTimesByDay: Record<string, string[]>
  onChange: (newChoice: string[]) => void
}) {
  const colors = CHOICE_COLORS[index] ?? CHOICE_COLORS[2]

  // Available days = days with at least 1 slot
  const availableDays = Object.entries(sessionTimesByDay)
    .filter(([, times]) => times.length > 0)
    .map(([dow]) => dow)
    .sort((a, b) => Number(a) - Number(b))

  const selectedDow = choice.length > 0 ? parseBlock(choice[0])?.dow ?? null : null
  const selectedTimes = choice.map(b => parseBlock(b)?.time ?? '')

  function handleDayChange(dow: string) {
    // Reset time selection when day changes
    onChange([])
    // Pre-select nothing — user picks time next
    void dow // suppress unused warning; selection triggers time re-render
    onChange([]) // clear; actual selection happens in time toggle
    // We update via a separate effect — just clear and let user pick time
    onChange([`${dow}-PENDING`])
  }

  function handleTimeToggle(dow: string, time: string) {
    const block = `${dow}-${time}`

    // If clicking an already-selected block, deselect it
    if (choice.includes(block)) {
      const next = choice.filter(b => b !== block)
      onChange(next)
      return
    }

    // If nothing selected yet, select this block
    if (choice.length === 0 || (choice.length === 1 && choice[0].endsWith('-PENDING'))) {
      onChange([block])
      return
    }

    // If one block selected and we click a second, allow only if consecutive
    if (choice.length === 1) {
      const existing = choice[0]
      const existingParsed = parseBlock(existing)
      if (!existingParsed || existingParsed.dow !== dow) {
        // Different day — replace selection
        onChange([block])
        return
      }
      // Same day — check if consecutive
      const [eh, em] = existingParsed.time.split(':').map(Number)
      const [nh, nm] = time.split(':').map(Number)
      const diffMin = Math.abs(nh * 60 + nm - (eh * 60 + em))
      if (diffMin === 60) {
        // Sort so earlier comes first
        const pair = nh * 60 + nm < eh * 60 + em
          ? [block, existing]
          : [existing, block]
        onChange(pair)
        return
      }
      // Not consecutive — replace
      onChange([block])
      return
    }

    // Already have 2 selected — replace entirely
    onChange([block])
  }

  const pendingDow = choice.length === 1 && choice[0].endsWith('-PENDING')
    ? choice[0].split('-PENDING')[0]
    : null
  const activeDow = selectedDow ?? pendingDow

  const slotsForDay = activeDow ? (sessionTimesByDay[activeDow] ?? []) : []

  function isSelected(time: string): boolean {
    if (!activeDow) return false
    return choice.includes(`${activeDow}-${time}`)
  }

  function isTwoHour(): boolean {
    return choice.length === 2
  }

  return (
    <div className={`rounded-xl border ${colors.border} overflow-hidden`}>
      {/* Header */}
      <div className={`flex items-center gap-2 px-4 py-2.5 ${colors.header} border-b ${colors.border}`}>
        <span className={`text-xs font-bold px-2 py-0.5 rounded-full ${colors.badge}`}>
          {CHOICE_LABELS[index]}
        </span>
        {choice.length > 0 && !pendingDow && (
          <span className="ml-auto text-xs text-slate-500 font-medium">
            {activeDow ? DOW_LABELS[activeDow] : ''}{' '}
            {choice.map(b => formatTime(parseBlock(b)?.time ?? '')).join(' – ')}
            {isTwoHour() && <span className="ml-1 text-indigo-600 font-semibold">(2h)</span>}
          </span>
        )}
        {choice.length > 0 && (
          <button
            onClick={() => onChange([])}
            className="ml-auto p-0.5 rounded text-slate-400 hover:text-red-500 hover:bg-red-50 transition-colors"
            title="Clear this choice"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        )}
      </div>

      <div className="p-3 space-y-3">
        {/* Day picker */}
        <div>
          <p className="text-[11px] font-semibold text-slate-500 uppercase tracking-wide mb-1.5">Day</p>
          <div className="flex flex-wrap gap-1.5">
            {availableDays.map(dow => (
              <button
                key={dow}
                onClick={() => {
                  if (activeDow === dow) return
                  // Change day: clear times
                  onChange([`${dow}-PENDING`])
                }}
                className={`px-2.5 py-1 rounded-lg text-xs font-semibold border transition-all ${
                  activeDow === dow
                    ? `${colors.badge} border-transparent ${colors.ring} ring-1`
                    : 'bg-white border-slate-200 text-slate-600 hover:border-slate-400'
                }`}
              >
                {DOW_LABELS[dow] ?? `Day ${dow}`}
              </button>
            ))}
          </div>
        </div>

        {/* Time picker — only shown after a day is selected */}
        {activeDow && (
          <div>
            <p className="text-[11px] font-semibold text-slate-500 uppercase tracking-wide mb-1.5">
              Time {slotsForDay.length > 1 && <span className="normal-case font-normal text-slate-400">(select 1 or 2 consecutive for 2h)</span>}
            </p>
            <div className="flex flex-wrap gap-1.5">
              {slotsForDay.map(time => {
                const selected = isSelected(time)
                const hasCons = consecutiveBlock(activeDow, time, sessionTimesByDay) !== null
                return (
                  <button
                    key={time}
                    onClick={() => handleTimeToggle(activeDow, time)}
                    className={`px-3 py-1.5 rounded-lg text-xs font-semibold border transition-all ${
                      selected
                        ? `${colors.badge} border-transparent ring-1 ${colors.ring}`
                        : 'bg-white border-slate-200 text-slate-600 hover:border-slate-400'
                    }`}
                  >
                    {formatTime(time)}
                    {selected && hasCons && !isTwoHour() && (
                      <span className="ml-1 text-[10px] opacity-70">+1h?</span>
                    )}
                  </button>
                )
              })}
            </div>
            {isTwoHour() && (
              <p className="mt-1.5 text-[11px] text-indigo-600 font-medium">
                2-hour session selected
              </p>
            )}
          </div>
        )}
      </div>
    </div>
  )
}

// ── Main component ────────────────────────────────────────────────────────────

export function SlotPreferenceSurvey({
  studentId,
  studentName,
  termId,
  sessionTimesByDay,
  initialPreferences,
  onSave,
  onClose,
}: Props) {
  // Normalise: ensure exactly 3 entries (fill with [] for empty choices)
  const normalise = (p: SlotPreferences | null): [string[], string[], string[]] => {
    const base = Array.isArray(p) ? [...p] : []
    while (base.length < 3) base.push([])
    return [base[0] ?? [], base[1] ?? [], base[2] ?? []]
  }

  const [choices, setChoices] = useState<[string[], string[], string[]]>(
    normalise(initialPreferences)
  )
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const updateChoice = useCallback((i: number, val: string[]) => {
    setChoices(prev => {
      const next = [...prev] as [string[], string[], string[]]
      next[i] = val
      return next
    })
    setSaved(false)
  }, [])

  // Filter out pending/empty choices before saving
  function toCleanPrefs(): SlotPreferences {
    return choices
      .map(c => c.filter(b => !b.endsWith('-PENDING') && b !== ''))
      .filter(c => c.length > 0)
  }

  async function handleSave() {
    const prefs = toCleanPrefs()
    setSaving(true)
    setError(null)
    try {
      const res = await fetch('/api/slot-preferences', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ studentId, termId, slotPreferences: prefs }),
      })
      if (!res.ok) {
        const body = await res.json().catch(() => ({}))
        throw new Error(body.error ?? 'Save failed')
      }
      setSaved(true)
      onSave?.(prefs)
    } catch (e: any) {
      setError(e.message ?? 'Failed to save')
    } finally {
      setSaving(false)
    }
  }

  const hasAnyChoice = toCleanPrefs().length > 0

  return (
    <div className="flex flex-col gap-4">
      {/* Student header */}
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-base font-semibold text-slate-800">{studentName}</h3>
          <p className="text-xs text-slate-500 mt-0.5">Enter up to 3 slot preferences from the paper survey</p>
        </div>
        {onClose && (
          <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-slate-100 text-slate-400">
            <X className="w-4 h-4" />
          </button>
        )}
      </div>

      {/* Choice editors */}
      <div className="space-y-3">
        {choices.map((choice, i) => (
          <ChoiceEditor
            key={i}
            index={i}
            choice={choice}
            sessionTimesByDay={sessionTimesByDay}
            onChange={val => updateChoice(i, val)}
          />
        ))}
      </div>

      {/* Footer */}
      {error && (
        <p className="text-xs text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">{error}</p>
      )}

      <div className="flex items-center gap-2 pt-1">
        <button
          onClick={handleSave}
          disabled={saving || !hasAnyChoice}
          className="flex items-center gap-1.5 px-4 py-2 rounded-lg text-sm font-semibold bg-indigo-600 text-white hover:bg-indigo-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
        >
          {saving ? (
            <Loader2 className="w-3.5 h-3.5 animate-spin" />
          ) : saved ? (
            <Check className="w-3.5 h-3.5" />
          ) : (
            <Save className="w-3.5 h-3.5" />
          )}
          {saved ? 'Saved' : 'Save Preferences'}
        </button>
        {onClose && (
          <button
            onClick={onClose}
            className="px-4 py-2 rounded-lg text-sm font-semibold text-slate-600 hover:bg-slate-100 transition-colors"
          >
            Cancel
          </button>
        )}
      </div>
    </div>
  )
}
