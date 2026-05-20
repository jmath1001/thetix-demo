'use client'

import { useState } from 'react'
import { ALL_DAYS, parseSlot } from './constants'

type Props = {
  globalSessionTimes: Record<string, string[]>
  setGlobalSessionTimes: React.Dispatch<React.SetStateAction<Record<string, string[]>>>
  globalSaving: boolean
  onSave: () => void
}

export function DefaultSessionTimesSection({
  globalSessionTimes,
  setGlobalSessionTimes,
  globalSaving,
  onSave,
}: Props) {
  const [open, setOpen] = useState(false)
  const [newTimeByDay, setNewTimeByDay] = useState<Record<string, { start: string; end: string }>>({})

  return (
    <div className="mb-5 rounded border border-slate-200 overflow-hidden">
      <button
        onClick={() => setOpen(o => !o)}
        className="flex w-full items-center justify-between px-4 py-3 text-left hover:bg-slate-50"
      >
        <div>
          <p className="text-[11px] font-bold uppercase tracking-widest text-slate-400">Default Session Times</p>
          <p className="mt-0.5 text-[11px] text-slate-500">Global fallback used when a term has no session times configured.</p>
        </div>
        <span className="ml-4 text-slate-400 text-sm">{open ? '▲' : '▼'}</span>
      </button>

      {open && (
        <div className="border-t border-slate-100 px-4 pb-4 pt-3">
          <p className="mb-3 text-[11px] text-slate-400">Add session rows for each day. Days with no rows are treated as off.</p>
          {ALL_DAYS.map(({ dow, label }) => {
            const slots = globalSessionTimes[dow] ?? []
            const pending = newTimeByDay[dow] ?? { start: '09:00', end: '' }
            return (
              <div key={dow} className="mb-4">
                <p className="mb-1.5 text-[11px] font-bold text-slate-600">{label}</p>
                <div className="overflow-hidden rounded border border-slate-200 bg-white">
                  <table className="w-full border-collapse text-xs">
                    <thead>
                      <tr className="border-b border-slate-100 text-[10px] font-bold uppercase tracking-widest text-slate-400">
                        <th className="px-3 py-2 text-left w-28">Session</th>
                        <th className="px-3 py-2 text-left">Start</th>
                        <th className="px-3 py-2 text-left">End</th>
                        <th className="px-3 py-2 w-20"></th>
                      </tr>
                    </thead>
                    <tbody>
                      {slots.length === 0 && (
                        <tr className="border-b border-slate-100">
                          <td colSpan={4} className="px-3 py-2 text-[11px] text-slate-400">No sessions — day is off by default.</td>
                        </tr>
                      )}
                      {slots.map((slot, index) => {
                        const { start, end } = parseSlot(slot)
                        return (
                          <tr key={`g-${dow}-${index}`} className="border-b border-slate-100 last:border-b-0">
                            <td className="px-3 py-2 font-semibold text-slate-700">Session {index + 1}</td>
                            <td className="px-3 py-2">
                              <input type="time" value={start}
                                onChange={e => setGlobalSessionTimes(prev => {
                                  const next = [...(prev[dow] ?? [])]
                                  next[index] = `${e.target.value}-${parseSlot(next[index] ?? '').end}`
                                  return { ...prev, [dow]: next }
                                })}
                                className="w-full rounded border border-slate-200 bg-white px-2 py-1 text-xs"
                              />
                            </td>
                            <td className="px-3 py-2">
                              <input type="time" value={end}
                                onChange={e => setGlobalSessionTimes(prev => {
                                  const next = [...(prev[dow] ?? [])]
                                  next[index] = `${parseSlot(next[index] ?? '').start}-${e.target.value}`
                                  return { ...prev, [dow]: next }
                                })}
                                className="w-full rounded border border-slate-200 bg-white px-2 py-1 text-xs"
                              />
                            </td>
                            <td className="px-3 py-2">
                              <button type="button"
                                onClick={() => setGlobalSessionTimes(prev => ({ ...prev, [dow]: (prev[dow] ?? []).filter((_, i) => i !== index) }))}
                                className="rounded border border-slate-200 bg-white px-2 py-1 text-[11px] font-semibold text-slate-500 hover:bg-slate-50 hover:text-red-600"
                              >Remove</button>
                            </td>
                          </tr>
                        )
                      })}
                      <tr className="bg-slate-50/60">
                        <td className="px-3 py-2 font-semibold text-slate-500">Session {slots.length + 1}</td>
                        <td className="px-3 py-2">
                          <input type="time" value={pending.start}
                            onChange={e => setNewTimeByDay(prev => ({ ...prev, [dow]: { ...pending, start: e.target.value } }))}
                            className="w-full rounded border border-slate-200 bg-white px-2 py-1 text-xs"
                          />
                        </td>
                        <td className="px-3 py-2">
                          <input type="time" value={pending.end}
                            onChange={e => setNewTimeByDay(prev => ({ ...prev, [dow]: { ...pending, end: e.target.value } }))}
                            className="w-full rounded border border-slate-200 bg-white px-2 py-1 text-xs"
                          />
                        </td>
                        <td className="px-3 py-2">
                          <button type="button" disabled={!pending.start || !pending.end}
                            onClick={() => {
                              if (!pending.start || !pending.end) return
                              setGlobalSessionTimes(prev => ({ ...prev, [dow]: [...(prev[dow] ?? []), `${pending.start}-${pending.end}`] }))
                              setNewTimeByDay(prev => ({ ...prev, [dow]: { start: pending.start, end: '' } }))
                            }}
                            className="rounded bg-slate-800 px-2.5 py-1 text-[11px] font-semibold text-white hover:bg-slate-700 disabled:opacity-40"
                          >+ Add</button>
                        </td>
                      </tr>
                    </tbody>
                  </table>
                </div>
              </div>
            )
          })}
          <button onClick={onSave} disabled={globalSaving}
            className="mt-1 rounded bg-slate-900 px-4 py-2 text-xs font-semibold text-white hover:bg-slate-800 disabled:opacity-50"
          >
            {globalSaving ? 'Saving…' : 'Save Default Times'}
          </button>
        </div>
      )}
    </div>
  )
}
