'use client'

import { useState } from 'react'
import { ALL_DAYS, DEFAULT_OPERATING_HOURS, DEFAULT_SESSION_TIMES_BY_DAY, baseInputCls, parseSlot } from './constants'
import type { TermDraft, TermRow, DateException } from './types'

type Props = {
  termDraft: TermDraft
  setTermDraft: React.Dispatch<React.SetStateAction<TermDraft>>
  terms: TermRow[]
  termSaving: boolean
  onSave: () => void
  onCancel: () => void
}

export function TermForm({ termDraft, setTermDraft, terms, termSaving, onSave, onCancel }: Props) {
  const [newTimeByDay, setNewTimeByDay] = useState<Record<string, { start: string; end: string }>>({})
  const [copyPickerDow, setCopyPickerDow] = useState<string | null>(null)
  const [copyPickerTargets, setCopyPickerTargets] = useState<Set<string>>(new Set())
  const [newExceptionDate, setNewExceptionDate] = useState('')
  const [newExceptionLabel, setNewExceptionLabel] = useState('')
  const [newExceptionClosed, setNewExceptionClosed] = useState(true)

  return (
    <div className="mt-4 rounded border border-slate-200 bg-white p-4">
      {/* Header + copy from term */}
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <p className="text-xs font-bold text-slate-700">{termDraft.id ? 'Edit Term' : 'New Term'}</p>
        {terms.filter(t => t.id !== termDraft.id && (t.session_times_by_day || t.operating_hours)).length > 0 && (
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="text-[11px] text-slate-400">Copy schedule from:</span>
            {terms.filter(t => t.id !== termDraft.id).map(t => (
              <button key={t.id} type="button"
                onClick={() => setTermDraft(prev => ({
                  ...prev,
                  operating_hours: (t.operating_hours ?? DEFAULT_OPERATING_HOURS) as TermDraft['operating_hours'],
                  session_times_by_day: (t.session_times_by_day ?? DEFAULT_SESSION_TIMES_BY_DAY) as TermDraft['session_times_by_day'],
                }))}
                className="rounded border border-slate-200 bg-slate-50 px-2 py-0.5 text-[11px] font-semibold text-slate-600 hover:border-indigo-200 hover:bg-indigo-50 hover:text-indigo-700 whitespace-nowrap"
              >{t.name}</button>
            ))}
          </div>
        )}
      </div>

      {/* Basic fields */}
      <div className="grid grid-cols-1 gap-3 md:grid-cols-4">
        <div className="md:col-span-2">
          <label className="mb-1 block text-xs font-semibold text-slate-500">Term Name</label>
          <input value={termDraft.name} onChange={e => setTermDraft(prev => ({ ...prev, name: e.target.value }))} className={baseInputCls} placeholder="e.g. Spring 2026" />
        </div>
        <div>
          <label className="mb-1 block text-xs font-semibold text-slate-500">Status</label>
          <select value={termDraft.status} onChange={e => setTermDraft(prev => ({ ...prev, status: e.target.value }))} className={baseInputCls}>
            <option value="upcoming">Upcoming</option>
            <option value="active">Active</option>
            <option value="completed">Completed</option>
          </select>
        </div>
        <div>
          <label className="mb-1 block text-xs font-semibold text-slate-500">Session Hours</label>
          <input type="number" min={1} max={6} step={1} value={termDraft.session_hours}
            onChange={e => setTermDraft(prev => ({ ...prev, session_hours: Math.max(1, Number(e.target.value || 1)) }))}
            className={baseInputCls}
          />
        </div>
      </div>

      <div className="mt-3 grid grid-cols-1 gap-3 md:grid-cols-2">
        <div>
          <label className="mb-1 block text-xs font-semibold text-slate-500">Start Date</label>
          <input type="date" value={termDraft.start_date} onChange={e => setTermDraft(prev => ({ ...prev, start_date: e.target.value }))} className={baseInputCls} />
        </div>
        <div>
          <label className="mb-1 block text-xs font-semibold text-slate-500">End Date</label>
          <input type="date" value={termDraft.end_date} onChange={e => setTermDraft(prev => ({ ...prev, end_date: e.target.value }))} className={baseInputCls} />
        </div>
      </div>

      {/* Operating Hours */}
      <div className="mt-4">
        <p className="mb-2 text-xs font-semibold text-slate-600">Operating Hours by Day</p>
        <table className="w-full text-xs border-collapse">
          <thead>
            <tr className="text-[10px] font-bold uppercase tracking-widest text-slate-400">
              <th className="pb-1.5 text-left w-28">Day</th>
              <th className="pb-1.5 text-left" colSpan={3}>Hours</th>
              <th className="pb-1.5 pl-2"></th>
            </tr>
          </thead>
          <tbody>
            {ALL_DAYS.map(({ dow, label }) => {
              const oh = termDraft.operating_hours[dow] ?? { open: '09:00', close: '21:00', closed: true }
              const isClosed = oh.closed ?? true
              return (
                <tr key={dow} className="border-t border-slate-100">
                  <td className="py-1.5 pr-3">
                    <label className="flex cursor-pointer items-center gap-1.5 font-semibold text-slate-700">
                      <input
                        type="checkbox"
                        checked={!isClosed}
                        onChange={e => setTermDraft(prev => {
                          const nextClosed = !e.target.checked
                          const nextSessionTimes = { ...prev.session_times_by_day }
                          if (nextClosed) delete nextSessionTimes[dow]
                          return {
                            ...prev,
                            operating_hours: { ...prev.operating_hours, [dow]: { ...oh, closed: nextClosed } },
                            session_times_by_day: nextSessionTimes,
                          }
                        })}
                      />
                      {label}
                    </label>
                  </td>
                  {isClosed ? (
                    <td colSpan={3} className="py-1.5">
                      <span className="rounded bg-slate-100 px-2 py-1 text-[11px] font-semibold text-slate-400">Closed</span>
                    </td>
                  ) : (
                    <>
                      <td className="py-1.5">
                        <input type="time" value={oh.open ?? '09:00'}
                          onChange={e => setTermDraft(prev => ({ ...prev, operating_hours: { ...prev.operating_hours, [dow]: { ...oh, open: e.target.value } } }))}
                          className="rounded border border-slate-200 bg-white px-2 py-1 text-xs"
                        />
                      </td>
                      <td className="px-2 text-center text-slate-300">–</td>
                      <td className="py-1.5">
                        <input type="time" value={oh.close ?? '21:00'}
                          onChange={e => setTermDraft(prev => ({ ...prev, operating_hours: { ...prev.operating_hours, [dow]: { ...oh, close: e.target.value } } }))}
                          className="rounded border border-slate-200 bg-white px-2 py-1 text-xs"
                        />
                      </td>
                    </>
                  )}
                  <td className="py-1.5 pl-2">
                    {!isClosed && (
                      <button type="button"
                        onClick={() => setTermDraft(prev => {
                          const updated = { ...prev.operating_hours }
                          ALL_DAYS.forEach(({ dow: d }) => {
                            const ex = updated[d] ?? { open: '09:00', close: '21:00', closed: true }
                            if (!ex.closed) updated[d] = { ...ex, open: oh.open ?? '09:00', close: oh.close ?? '21:00' }
                          })
                          return { ...prev, operating_hours: updated }
                        })}
                        className="rounded border border-slate-200 bg-white px-2 py-1 text-[10px] font-semibold text-slate-400 hover:bg-slate-100 whitespace-nowrap"
                      >Copy to all</button>
                    )}
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>

      {/* Session Times by Day */}
      <div className="mt-5 border-t border-slate-100 pt-4">
        <p className="mb-3 text-[11px] font-bold uppercase tracking-widest text-slate-400">Session Times by Day</p>
        <p className="mb-3 text-[11px] text-slate-400">Set the specific time slots for each open day.</p>
        {ALL_DAYS.map(({ dow, label }) => {
          const oh = termDraft.operating_hours[dow]
          if (oh?.closed) return null
          const slots = termDraft.session_times_by_day[dow] ?? []
          const pending = newTimeByDay[dow] ?? { start: oh?.open ?? '09:00', end: '' }
          return (
            <div key={dow} className="mb-4">
              <div className="mb-1.5">
                <div className="flex items-center justify-between">
                  <p className="text-[11px] font-bold text-slate-600">{label}</p>
                  {slots.length > 0 && copyPickerDow !== dow && (
                    <button type="button"
                      onClick={() => {
                        const openDays = new Set(ALL_DAYS.map(d => d.dow).filter(d => d !== dow && !termDraft.operating_hours[d]?.closed))
                        setCopyPickerDow(dow)
                        setCopyPickerTargets(openDays)
                      }}
                      className="text-[10px] font-semibold text-slate-400 hover:text-indigo-600"
                    >Copy to days →</button>
                  )}
                </div>
                {copyPickerDow === dow && (
                  <div className="mt-1.5 flex flex-wrap items-center gap-1.5 rounded border border-indigo-100 bg-indigo-50 px-2.5 py-2">
                    {ALL_DAYS.filter(d => d.dow !== dow && !termDraft.operating_hours[d.dow]?.closed).map(d => (
                      <button key={d.dow} type="button"
                        onClick={() => setCopyPickerTargets(prev => {
                          const next = new Set(prev)
                          next.has(d.dow) ? next.delete(d.dow) : next.add(d.dow)
                          return next
                        })}
                        className={`rounded px-2 py-0.5 text-[10px] font-bold transition-colors ${copyPickerTargets.has(d.dow) ? 'bg-indigo-600 text-white' : 'bg-white text-slate-500 border border-slate-200 hover:border-indigo-300'}`}
                      >{d.label.slice(0, 3)}</button>
                    ))}
                    <button type="button"
                      disabled={copyPickerTargets.size === 0}
                      onClick={() => {
                        setTermDraft(prev => {
                          const nextTimes = { ...prev.session_times_by_day }
                          copyPickerTargets.forEach(d => { nextTimes[d] = [...slots] })
                          return { ...prev, session_times_by_day: nextTimes }
                        })
                        setCopyPickerDow(null)
                      }}
                      className="ml-1 rounded bg-indigo-600 px-2.5 py-0.5 text-[10px] font-bold text-white hover:bg-indigo-700 disabled:opacity-40"
                    >Apply</button>
                    <button type="button" onClick={() => setCopyPickerDow(null)}
                      className="text-[10px] text-slate-400 hover:text-slate-600"
                    >Cancel</button>
                  </div>
                )}
              </div>
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
                        <td colSpan={4} className="px-3 py-2 text-[11px] text-slate-400">No sessions yet.</td>
                      </tr>
                    )}
                    {slots.map((slot, index) => {
                      const { start, end } = parseSlot(slot)
                      return (
                        <tr key={`t-${dow}-${index}`} className="border-b border-slate-100 last:border-b-0">
                          <td className="px-3 py-2 font-semibold text-slate-700">Session {index + 1}</td>
                          <td className="px-3 py-2">
                            <input type="time" value={start}
                              onChange={e => setTermDraft(prev => {
                                const nextSlots = [...(prev.session_times_by_day[dow] ?? [])]
                                nextSlots[index] = `${e.target.value}-${parseSlot(nextSlots[index] ?? '').end}`
                                return { ...prev, session_times_by_day: { ...prev.session_times_by_day, [dow]: nextSlots } }
                              })}
                              className="w-full rounded border border-slate-200 bg-white px-2 py-1 text-xs"
                            />
                          </td>
                          <td className="px-3 py-2">
                            <input type="time" value={end}
                              onChange={e => setTermDraft(prev => {
                                const nextSlots = [...(prev.session_times_by_day[dow] ?? [])]
                                nextSlots[index] = `${parseSlot(nextSlots[index] ?? '').start}-${e.target.value}`
                                return { ...prev, session_times_by_day: { ...prev.session_times_by_day, [dow]: nextSlots } }
                              })}
                              className="w-full rounded border border-slate-200 bg-white px-2 py-1 text-xs"
                            />
                          </td>
                          <td className="px-3 py-2">
                            <button type="button"
                              onClick={() => setTermDraft(prev => ({
                                ...prev,
                                session_times_by_day: {
                                  ...prev.session_times_by_day,
                                  [dow]: (prev.session_times_by_day[dow] ?? []).filter((_, i) => i !== index),
                                },
                              }))}
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
                            const nextSlot = `${pending.start}-${pending.end}`
                            if (slots.includes(nextSlot)) return
                            setTermDraft(prev => ({
                              ...prev,
                              session_times_by_day: {
                                ...prev.session_times_by_day,
                                [dow]: [...(prev.session_times_by_day[dow] ?? []), nextSlot],
                              },
                            }))
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
      </div>

      {/* Special Days / Holidays */}
      <div className="mt-5 border-t border-slate-100 pt-4">
        <p className="mb-3 text-[11px] font-bold uppercase tracking-widest text-slate-400">Special Days / Holidays</p>
        <p className="mb-3 text-[11px] text-slate-400">Mark individual dates as closed or with a custom note.</p>
        {termDraft.date_exceptions.length > 0 && (
          <div className="mb-3 space-y-1.5">
            {termDraft.date_exceptions.slice().sort((a, b) => a.date.localeCompare(b.date)).map(ex => (
              <div key={ex.date} className="flex items-center justify-between rounded-lg border border-slate-100 bg-slate-50 px-3 py-2 text-xs">
                <div className="flex items-center gap-2">
                  <span className={`rounded px-1.5 py-0.5 text-[10px] font-bold ${ex.closed ? 'bg-red-100 text-red-700' : 'bg-amber-100 text-amber-700'}`}>
                    {ex.closed ? 'Closed' : 'Special'}
                  </span>
                  <span className="font-semibold text-slate-700">{ex.date}</span>
                  {ex.label && <span className="text-slate-500">{ex.label}</span>}
                </div>
                <button type="button"
                  onClick={() => setTermDraft(prev => ({ ...prev, date_exceptions: prev.date_exceptions.filter(e => e.date !== ex.date) }))}
                  className="text-slate-300 hover:text-red-500"
                >&times;</button>
              </div>
            ))}
          </div>
        )}
        <div className="flex flex-wrap items-end gap-2">
          <div>
            <label className="mb-1 block text-[11px] font-semibold text-slate-500">Date</label>
            <input type="date" value={newExceptionDate} onChange={e => setNewExceptionDate(e.target.value)} className="rounded border border-slate-200 px-2 py-1.5 text-xs" />
          </div>
          <div>
            <label className="mb-1 block text-[11px] font-semibold text-slate-500">Label (optional)</label>
            <input type="text" value={newExceptionLabel} onChange={e => setNewExceptionLabel(e.target.value)} placeholder="e.g. Memorial Day" className="rounded border border-slate-200 px-2 py-1.5 text-xs w-44" />
          </div>
          <div className="flex items-center gap-2 pb-1.5">
            <button type="button" onClick={() => setNewExceptionClosed(c => !c)}
              className="rounded px-2.5 py-1.5 text-[11px] font-semibold"
              style={newExceptionClosed
                ? { background: '#fee2e2', color: '#b91c1c', border: '1px solid #fca5a5' }
                : { background: '#fef3c7', color: '#92400e', border: '1px solid #fcd34d' }}
            >
              {newExceptionClosed ? 'Closed' : 'Special'}
            </button>
            <button type="button" disabled={!newExceptionDate}
              onClick={() => {
                if (!newExceptionDate || termDraft.date_exceptions.some(e => e.date === newExceptionDate)) return
                setTermDraft(prev => ({
                  ...prev,
                  date_exceptions: [...prev.date_exceptions, {
                    date: newExceptionDate,
                    closed: newExceptionClosed,
                    ...(newExceptionLabel.trim() ? { label: newExceptionLabel.trim() } : {}),
                  }],
                }))
                setNewExceptionDate('')
                setNewExceptionLabel('')
                setNewExceptionClosed(true)
              }}
              className="rounded bg-slate-800 px-3 py-1.5 text-[11px] font-semibold text-white disabled:opacity-40"
            >+ Add</button>
          </div>
        </div>
      </div>

      {/* Form actions */}
      <div className="mt-4 flex gap-2">
        <button onClick={onSave} disabled={termSaving}
          className="rounded bg-slate-900 px-4 py-2 text-xs font-semibold text-white hover:bg-slate-800 disabled:opacity-50"
        >
          {termSaving ? 'Saving…' : (termDraft.id ? 'Update Term' : 'Save Term')}
        </button>
        <button onClick={onCancel} className="rounded border border-slate-200 bg-white px-4 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50">
          Cancel
        </button>
      </div>
    </div>
  )
}
