'use client'

import { useCallback, useState } from 'react'
import { Check, Loader2, Save, X } from 'lucide-react'
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
  '1': 'Mon',
  '2': 'Tue',
  '3': 'Wed',
  '4': 'Thu',
  '5': 'Fri',
  '6': 'Sat',
  '7': 'Sun',
}

const CHOICE_LABELS = ['Choice 1', 'Choice 2', 'Choice 3']

const CHOICE_STYLES = [
  {
    tab: 'border-indigo-500 text-indigo-700',
    dot: 'bg-indigo-500',
    selected: 'bg-indigo-600 text-white border-indigo-600',
    header: 'bg-indigo-50',
  },
  {
    tab: 'border-violet-500 text-violet-700',
    dot: 'bg-violet-500',
    selected: 'bg-violet-600 text-white border-violet-600',
    header: 'bg-violet-50',
  },
  {
    tab: 'border-slate-500 text-slate-700',
    dot: 'bg-slate-400',
    selected: 'bg-slate-600 text-white border-slate-600',
    header: 'bg-slate-50',
  },
]

// ── Helpers ───────────────────────────────────────────────────────────────────

function parseBlock(block: string): { dow: string; time: string } | null {
  const m = block.match(/^(\d)-([\d:]+)$/)
  if (!m) return null
  return { dow: m[1], time: m[2] }
}

// ── Grid for a single choice ──────────────────────────────────────────────────

function ChoiceGrid({
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
  const styles = CHOICE_STYLES[index] ?? CHOICE_STYLES[2]
  const cleanChoice = choice.filter(b => !b.endsWith('-PENDING') && b !== '')
  const selected = new Set(cleanChoice)

  const days = Object.entries(sessionTimesByDay)
    .filter(([, times]) => times.length > 0)
    .map(([dow]) => dow)
    .sort((a, b) => Number(a) - Number(b))

  const allTimes = Array.from(
    new Set(days.flatMap(d => sessionTimesByDay[d] ?? []))
  ).sort()

  function handleCellClick(dow: string, time: string) {
    const block = `${dow}-${time}`

    if (selected.has(block)) {
      onChange(cleanChoice.filter(b => b !== block))
      return
    }

    if (cleanChoice.length === 0) {
      onChange([block])
      return
    }

    if (cleanChoice.length === 1) {
      const existing = parseBlock(cleanChoice[0])
      if (existing && existing.dow === dow) {
        const eh = Number(existing.time.split(':')[0])
        const nh = Number(time.split(':')[0])
        if (Math.abs(nh - eh) === 1) {
          const pair = nh < eh ? [block, cleanChoice[0]] : [cleanChoice[0], block]
          onChange(pair)
          return
        }
      }
      onChange([block])
      return
    }

    onChange([block])
  }

  function getSummary(): string {
    if (cleanChoice.length === 0) return ''
    const first = parseBlock(cleanChoice[0])
    if (!first) return ''
    const dayLabel = DOW_LABELS[first.dow] ?? `Day ${first.dow}`
    if (cleanChoice.length === 2) {
      const second = parseBlock(cleanChoice[1])
      const endHour = second ? Number(second.time.split(':')[0]) + 1 : null
      const endMin = second ? second.time.split(':')[1] : '00'
      const endStr = endHour !== null ? `${String(endHour).padStart(2, '0')}:${endMin}` : ''
      return `${dayLabel} · ${formatTime(first.time)} – ${formatTime(endStr)} (2h)`
    }
    return `${dayLabel} · ${formatTime(first.time)} (1h)`
  }

  const summary = getSummary()

  if (days.length === 0) {
    return (
      <div className="flex items-center justify-center h-24 text-sm text-slate-400">
        No available slots configured for this term.
      </div>
    )
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between min-h-5">
        {summary ? (
          <span className="text-sm font-semibold text-slate-700">{summary}</span>
        ) : (
          <span className="text-xs text-slate-400 italic">
            Click one slot (1h) or two consecutive slots in the same column (2h)
          </span>
        )}
        {cleanChoice.length > 0 && (
          <button
            onClick={() => onChange([])}
            className="flex items-center gap-1 text-xs text-slate-400 hover:text-red-500 transition-colors ml-3 shrink-0"
          >
            <X className="w-3 h-3" />
            Clear
          </button>
        )}
      </div>

      <div className="overflow-x-auto rounded-xl border border-slate-200">
        <table className="w-full text-xs border-collapse">
          <thead>
            <tr className={`${styles.header} border-b border-slate-200`}>
              <th className="w-14 py-2.5 px-3 text-left font-semibold text-slate-500 border-r border-slate-200">
                Time
              </th>
              {days.map(dow => (
                <th
                  key={dow}
                  className="py-2.5 px-2 text-center font-bold text-slate-700 min-w-14"
                >
                  {DOW_LABELS[dow] ?? `Day ${dow}`}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {allTimes.map((time, rowIdx) => (
              <tr
                key={time}
                className={`border-b border-slate-100 last:border-0 ${rowIdx % 2 === 0 ? 'bg-white' : 'bg-slate-50/60'}`}
              >
                <td className="py-2 px-3 font-medium text-slate-500 whitespace-nowrap border-r border-slate-200">
                  {formatTime(time)}
                </td>
                {days.map(dow => {
                  const hasSlot = sessionTimesByDay[dow]?.includes(time)
                  if (!hasSlot) {
                    return (
                      <td key={dow} className="py-2 px-2 text-center">
                        <span className="inline-block w-8 h-7 rounded-md bg-slate-100/50" />
                      </td>
                    )
                  }
                  const block = `${dow}-${time}`
                  const isSel = selected.has(block)
                  return (
                    <td key={dow} className="py-2 px-2 text-center">
                      <button
                        onClick={() => handleCellClick(dow, time)}
                        className={`inline-flex items-center justify-center w-8 h-7 rounded-md border font-semibold transition-all ${
                          isSel
                            ? `${styles.selected} shadow-sm`
                            : 'bg-white border-slate-200 text-slate-400 hover:border-slate-400 hover:text-slate-600 hover:bg-slate-50'
                        }`}
                        title={`${DOW_LABELS[dow]} ${formatTime(time)}`}
                      >
                        {isSel ? <Check className="w-3 h-3" /> : <span className="text-[10px]">○</span>}
                      </button>
                    </td>
                  )
                })}
              </tr>
            ))}
          </tbody>
        </table>
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
  const normalise = (p: SlotPreferences | null): [string[], string[], string[]] => {
    const base = Array.isArray(p) ? [...p] : []
    while (base.length < 3) base.push([])
    return [base[0] ?? [], base[1] ?? [], base[2] ?? []]
  }

  const [choices, setChoices] = useState<[string[], string[], string[]]>(
    normalise(initialPreferences)
  )
  const [activeTab, setActiveTab] = useState(0)
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
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Failed to save')
    } finally {
      setSaving(false)
    }
  }

  const hasAnyChoice = toCleanPrefs().length > 0

  function hasSelection(i: number): boolean {
    return choices[i].filter(b => !b.endsWith('-PENDING') && b !== '').length > 0
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-base font-semibold text-slate-800">{studentName}</h3>
          <p className="text-xs text-slate-500 mt-0.5">
            Enter up to 3 slot preferences. Two consecutive slots in the same day = 2-hour session.
          </p>
        </div>
        {onClose && (
          <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-slate-100 text-slate-400">
            <X className="w-4 h-4" />
          </button>
        )}
      </div>

      {/* Tab bar */}
      <div className="flex border-b border-slate-200">
        {CHOICE_LABELS.map((label, i) => {
          const isActive = activeTab === i
          const tabStyles = CHOICE_STYLES[i]
          return (
            <button
              key={i}
              onClick={() => setActiveTab(i)}
              className={`relative flex items-center gap-2 px-5 py-2.5 text-sm font-semibold transition-colors border-b-2 -mb-px ${
                isActive
                  ? `${tabStyles.tab} bg-white`
                  : 'border-transparent text-slate-500 hover:text-slate-700 hover:bg-slate-50'
              }`}
            >
              {label}
              {hasSelection(i) && (
                <span className={`w-1.5 h-1.5 rounded-full ${isActive ? tabStyles.dot : 'bg-slate-400'}`} />
              )}
            </button>
          )
        })}
      </div>

      {/* Active choice grid */}
      <ChoiceGrid
        index={activeTab}
        choice={choices[activeTab]}
        sessionTimesByDay={sessionTimesByDay}
        onChange={val => updateChoice(activeTab, val)}
      />

      {error && (
        <p className="text-xs text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">{error}</p>
      )}

      <div className="flex items-center gap-3 pt-1">
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
          {saving ? 'Saving…' : saved ? 'Saved!' : 'Save Preferences'}
        </button>
        {saved && (
          <span className="text-xs text-emerald-600 font-medium">Preferences saved</span>
        )}
      </div>
    </div>
  )
}

