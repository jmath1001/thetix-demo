'use client'
import React, { useMemo, useState } from 'react'
import { Check, X, Zap, Loader2, Sparkles, Calendar, List, TrendingUp } from 'lucide-react'
import { CalendarPreview } from './CalendarPreview'

const SUBJECT_FREQUENCY_HINT: Record<string, string> = {
  Algebra: 'Weekly',
  Geometry: 'Weekly',
  Precalculus: 'Weekly',
  Calculus: 'Twice weekly',
  Statistics: 'Weekly',
  'IB Math': 'Weekly',
  'SAT Math': 'Biweekly',
  'SAT R/W': 'Biweekly',
  'ACT Math': 'Biweekly',
  Physics: 'Weekly',
  'AP Physics C Mechanics': 'Weekly',
  'AP Physics C E&M': 'Weekly',
  Chemistry: 'Weekly',
  Biology: 'Weekly',
  Psychology: 'Weekly',
  'AP Environmental Science': 'Weekly',
  'AP Statistics': 'Weekly',
  'ACT Science': 'Biweekly',
  'English/Writing': 'Weekly',
  Literature: 'Weekly',
  History: 'Weekly',
  'ACT English': 'Biweekly',
}

const getFrequencyHint = (subject?: string) => SUBJECT_FREQUENCY_HINT[subject ?? ''] ?? 'Weekly'
const getSlotLabel = (slot: any) => slot?.block?.label ?? slot?.time ?? 'Any time'
const getDayName = (date: string) => new Date(date).toLocaleDateString('en-US', { weekday: 'short' })
const describeNewSlot = (slot: any) => {
  if (!slot) return 'No target session'
  const datePart = slot?.date ? `${getDayName(slot.date)} ${slot.date}` : 'Date TBD'
  return `${slot?.tutorName ?? 'Tutor'} · ${getSlotLabel(slot)} · ${datePart}`
}
const formatDate = (date?: string | null) => {
  if (!date) return 'Not set'
  const parsed = new Date(date)
  if (Number.isNaN(parsed.getTime())) return date
  return parsed.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
}

export default function OptimizationPreview({
  proposal,
  onConfirm,
  onCancel,
  isApplying,
  activeDates,
  tutors,
  sessions,
  timeOff,
  students,
  tutorPaletteMap
}: any) {
  const [viewMode, setViewMode] = useState<'cards' | 'calendar'>('calendar')

  if (!proposal) return null

  const weekRangeLabel = useMemo(() => {
    const start = proposal?.context?.weekStart
    const end = proposal?.context?.weekEnd
    if (!start || !end) return 'Current schedule window'
    if (start === end) return `${formatDate(start)} only`
    return `${formatDate(start)} - ${formatDate(end)}`
  }, [proposal])

  const strBefore = proposal?.metrics?.studentsPerSessionBefore
  const strAfter = proposal?.metrics?.studentsPerSessionAfter
  const strDelta = proposal?.metrics?.studentsPerSessionDelta
  const hasStrMetrics = Number.isFinite(strBefore) && Number.isFinite(strAfter)

  const moveCount = proposal?.changes?.filter((change: any) => change?.action === 'move').length ?? 0
  const placementCount = proposal?.changes?.filter((change: any) => change?.action !== 'move').length ?? 0

  return (
    <div className="fixed inset-0 z-50 bg-slate-900/40 backdrop-blur-sm flex items-center justify-center p-4 sm:p-6"
      onClick={e => { if (e.target === e.currentTarget) onCancel() }}>
      <div className="w-full max-w-6xl overflow-hidden rounded-[28px] border border-slate-200 bg-white/95 shadow-[0_30px_90px_-40px_rgba(15,23,42,0.6)] ring-1 ring-slate-100 flex flex-col max-h-[90vh]"
        onClick={e => e.stopPropagation()}>

        <div className="border-b border-slate-200 bg-white/90 px-6 py-5 backdrop-blur-md sm:px-8">
          <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
            <div>
              <div className="flex items-center gap-3">
                <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-indigo-600 text-white shadow-sm shadow-indigo-200">
                  <Zap size={20} />
                </div>
                <div>
                  <p className="text-xs uppercase tracking-[0.32em] text-indigo-500">Session Preview</p>
                  <h2 className="mt-2 text-xl font-semibold leading-tight text-slate-900 sm:text-2xl">{proposal.title || 'Booking Preview'}</h2>
                </div>
              </div>
            </div>

            <div className="flex items-center gap-3">
              <div className="flex rounded-2xl border border-slate-200 bg-white p-1">
                <button
                  onClick={() => setViewMode('calendar')}
                  className={`inline-flex items-center gap-2 px-3 py-1.5 text-xs font-medium rounded-xl transition ${
                    viewMode === 'calendar'
                      ? 'bg-slate-900 text-white'
                      : 'text-slate-600 hover:text-slate-900'
                  }`}
                >
                  <Calendar size={14} />
                  Calendar
                </button>
                <button
                  onClick={() => setViewMode('cards')}
                  className={`inline-flex items-center gap-2 px-3 py-1.5 text-xs font-medium rounded-xl transition ${
                    viewMode === 'cards'
                      ? 'bg-slate-900 text-white'
                      : 'text-slate-600 hover:text-slate-900'
                  }`}
                >
                  <List size={14} />
                  Changes
                </button>
              </div>

              <button
                onClick={onCancel}
                className="inline-flex h-11 w-11 items-center justify-center rounded-2xl border border-slate-200 bg-white text-slate-500 transition hover:border-slate-300 hover:text-slate-700"
              >
                <X size={20} />
              </button>
            </div>
          </div>

          <div className="mt-5 rounded-3xl border border-slate-200 bg-slate-50 p-5 text-sm leading-6 text-slate-600 shadow-sm">
            <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
              <div className="flex items-start gap-2">
                <Sparkles size={16} className="mt-0.5 text-indigo-500" />
                <p>{proposal.reasoning}</p>
              </div>
              <div className="grid w-full grid-cols-2 gap-3 xl:w-auto xl:min-w-130 xl:grid-cols-4">
                <div className="rounded-3xl bg-white p-3 text-center shadow-sm min-h-22.5 flex flex-col justify-center">
                  <p className="text-2xl font-semibold text-slate-900">{proposal.changes?.length ?? 0}</p>
                  <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-slate-400">Changes proposed</p>
                </div>
                <div className="rounded-3xl bg-white p-3 text-center shadow-sm min-h-22.5 flex flex-col justify-center">
                  <p className="text-xs font-semibold text-slate-900 wrap-break-word leading-snug">{weekRangeLabel}</p>
                  <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-slate-400">Week visualized</p>
                </div>
                <div className="rounded-3xl bg-white p-3 text-center shadow-sm min-h-22.5 flex flex-col justify-center">
                  <p className="text-2xl font-semibold text-slate-900">{hasStrMetrics ? strAfter.toFixed(2) : '--'}</p>
                  <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-slate-400">New STR</p>
                </div>
                <div className="rounded-3xl bg-white p-3 text-center shadow-sm min-h-22.5 flex flex-col justify-center">
                  <p className="text-xs font-semibold text-slate-900 inline-flex items-center justify-center gap-1.5 flex-wrap">
                    {hasStrMetrics ? `${strBefore.toFixed(2)} -> ${strAfter.toFixed(2)}` : '--'}
                    {Number.isFinite(strDelta) && (
                      <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-bold ${strDelta >= 0 ? 'bg-emerald-100 text-emerald-700' : 'bg-rose-100 text-rose-700'}`}>
                        <TrendingUp size={10} className="mr-1" />
                        {strDelta >= 0 ? '+' : ''}{strDelta.toFixed(2)}
                      </span>
                    )}
                  </p>
                  <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-slate-400">STR change</p>
                </div>
              </div>
            </div>

            <div className="mt-5 flex flex-wrap gap-2">
              <span className="rounded-full bg-indigo-50 px-3 py-1 text-xs font-semibold uppercase tracking-[0.24em] text-indigo-700">Tutor availability</span>
              <span className="rounded-full bg-slate-100 px-3 py-1 text-xs font-semibold uppercase tracking-[0.24em] text-slate-700">Student availability</span>
              <span className="rounded-full bg-emerald-50 px-3 py-1 text-xs font-semibold uppercase tracking-[0.24em] text-emerald-700">Max session density</span>
              <span className="rounded-full bg-amber-50 px-3 py-1 text-xs font-semibold uppercase tracking-[0.24em] text-amber-700">Frequency-aware</span>
              <span className="rounded-full bg-rose-50 px-3 py-1 text-xs font-semibold uppercase tracking-[0.24em] text-rose-700">Recurring preserved</span>
            </div>
          </div>
        </div>

        <div className="flex-1 overflow-y-auto">
          {viewMode === 'calendar' ? (
            <div className="p-6 sm:p-8">
              <CalendarPreview
                activeDates={activeDates}
                tutors={tutors}
                sessions={sessions}
                timeOff={timeOff}
                students={students}
                tutorPaletteMap={tutorPaletteMap}
                proposal={proposal}
              />
            </div>
          ) : (
            <div className="p-6 sm:p-8">
              <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
                <div>
                  <p className="text-xs uppercase tracking-[0.16em] text-slate-400">Proposed optimization actions</p>
                  <h3 className="mt-2 text-lg font-semibold text-slate-900">Review the changes before confirming</h3>
                  <p className="mt-1 text-xs text-slate-500">Showing: {weekRangeLabel}</p>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <span className="rounded-full bg-rose-100 px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.14em] text-rose-700">
                    {moveCount} move{moveCount === 1 ? '' : 's'}
                  </span>
                  <span className="rounded-full bg-emerald-100 px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.14em] text-emerald-700">
                    {placementCount} placement{placementCount === 1 ? '' : 's'}
                  </span>
                </div>
              </div>

              <div className="space-y-4">
                {proposal.changes?.map((change: any, i: number) => (
                  <div key={i} className="grid gap-4 rounded-3xl border border-slate-200 bg-white p-4 shadow-sm sm:grid-cols-[1fr_auto]">
                    <div className="space-y-3">
                      <div className="flex items-center justify-between gap-3 flex-wrap">
                        <div className="flex items-center gap-3">
                          <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-slate-100 text-slate-700 font-semibold">
                            {change.studentName?.[0] ?? 'S'}
                          </div>
                          <div>
                            <p className="text-sm font-semibold text-slate-900">{change.studentName || 'Student'}</p>
                            <p className="text-xs text-slate-500">{change.subject || 'General subject'}</p>
                          </div>
                        </div>
                        <span className={`rounded-full px-2.5 py-1 text-[10px] font-bold uppercase tracking-[0.12em] ${change.action === 'move' ? 'bg-rose-100 text-rose-700' : 'bg-emerald-100 text-emerald-700'}`}>
                          {change.action === 'move' ? 'Move' : 'Placement'}
                        </span>
                      </div>

                      <div className="rounded-3xl border border-slate-200 bg-slate-50 px-3 py-2.5">
                        <p className="text-[11px] uppercase tracking-[0.16em] text-slate-400">Student action lane</p>
                        <div className="mt-2 grid gap-2 md:grid-cols-[1fr_auto_1fr] md:items-center">
                          <div className="rounded-2xl border border-rose-200 bg-rose-50 p-2.5">
                            <p className="text-[10px] font-bold uppercase tracking-[0.14em] text-rose-600">From session</p>
                            <p className="mt-1 text-xs font-semibold text-rose-800 wrap-break-word">{change.oldTime || 'Unassigned'}</p>
                          </div>
                          <div className="text-center text-slate-400 text-xs font-semibold">TO</div>
                          <div className="rounded-2xl border border-emerald-200 bg-emerald-50 p-2.5">
                            <p className="text-[10px] font-bold uppercase tracking-[0.14em] text-emerald-700">Target session</p>
                            <p className="mt-1 text-xs font-semibold text-emerald-900 wrap-break-word">{describeNewSlot(change.newSlot)}</p>
                          </div>
                        </div>
                      </div>

                      <div className="grid gap-2 sm:grid-cols-2">
                        <div className="rounded-3xl bg-slate-50 p-3 text-sm text-slate-600">
                          <p className="text-[11px] uppercase tracking-[0.16em] text-slate-400">New slot details</p>
                          <p className="mt-1 font-semibold text-slate-900">{getSlotLabel(change.newSlot)}</p>
                          <p className="mt-1 text-slate-500">{change.newSlot?.tutorName ?? 'Tutor not set'}</p>
                          {change.newSlot?.date && <p className="mt-1 text-slate-500">{getDayName(change.newSlot.date)} · {change.newSlot.date}</p>}
                        </div>
                        <div className="rounded-3xl bg-slate-50 p-3 text-sm text-slate-600">
                          <p className="text-[11px] uppercase tracking-[0.16em] text-slate-400">Why this change</p>
                          <p className="mt-1 text-slate-700">{change.explanation || 'Better balance and capacity'}</p>
                          <div className="mt-3 flex flex-wrap gap-2">
                            <span className="rounded-full bg-emerald-100 px-2.5 py-1 text-[11px] font-semibold uppercase tracking-[0.12em] text-emerald-700">{getFrequencyHint(change.subject)}</span>
                            <span className="rounded-full bg-indigo-100 px-2.5 py-1 text-[11px] font-semibold uppercase tracking-[0.12em] text-indigo-700">{change.newSlot?.time ? 'Timed session' : 'Flexible slot'}</span>
                          </div>
                        </div>
                      </div>

                      {Array.isArray(change.suggestionOptions) && change.suggestionOptions.length > 0 && (
                        <div className="rounded-3xl border border-indigo-100 bg-indigo-50/60 p-3 text-sm">
                          <p className="text-[11px] uppercase tracking-[0.2em] text-indigo-500">Suggestion options</p>
                          <div className="mt-2 space-y-2">
                            {change.suggestionOptions.slice(0, 3).map((option: any, optionIndex: number) => (
                              <div key={optionIndex} className="rounded-2xl bg-white p-2.5 text-slate-700 shadow-sm">
                                <p className="text-xs font-semibold text-slate-900">{option.title || `Option ${optionIndex + 1}`}</p>
                                <p className="mt-0.5 text-xs text-slate-600">{option.detail}</p>
                                <p className="mt-1 text-xs text-indigo-700">{option.explanation || 'Valid alternative if priorities change.'}</p>
                              </div>
                            ))}
                          </div>
                        </div>
                      )}
                    </div>

                    <div className="hidden items-center justify-end sm:flex">
                      <div className="rounded-3xl bg-indigo-600 px-4 py-2 text-sm font-semibold text-white shadow-sm">
                        Preview
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>

        <div className="border-t border-slate-200 bg-white/90 px-6 py-5 sm:px-8">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <p className="text-sm text-slate-500">Review the session bookings above before confirming. Changes apply only after commit, and recurring series are not moved by this optimizer.</p>
            <div className="flex flex-col gap-3 sm:flex-row">
              <button
                onClick={onCancel}
                disabled={isApplying}
                className="inline-flex items-center justify-center rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm font-semibold text-slate-700 transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-60"
              >
                Discard
              </button>
              <button
                onClick={() => onConfirm(proposal.changes)}
                disabled={isApplying}
                className="inline-flex items-center justify-center rounded-2xl bg-slate-900 px-5 py-3 text-sm font-semibold text-white transition hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-60"
              >
                {isApplying ? (
                  <><Loader2 className="mr-2 h-4 w-4 animate-spin" /> Confirm bookings</>
                ) : (
                  <><Check size={16} className="mr-2" /> Confirm bookings</>
                )}
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
