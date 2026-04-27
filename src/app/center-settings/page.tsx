'use client'

import { useEffect, useMemo, useState } from 'react'
import { Loader2, Save, Settings } from 'lucide-react'
import { supabase } from '@/lib/supabaseClient'
import { DB, withCenter, withCenterPayload } from '@/lib/db'

type CenterSettingsRow = {
  id: string
  center_name: string | null
  center_email: string | null
  reminder_lead_time_hours: number | null
  reminder_subject: string | null
  reminder_body: string | null
}

type TermRow = {
  id: string
  name: string
  start_date: string
  end_date: string
  status: string
  operating_hours: Record<string, { open: string; close: string; closed?: boolean }> | null
  session_times_by_day: Record<string, string[]> | null
}

type TermDraft = {
  id: string
  name: string
  start_date: string
  end_date: string
  status: string
  operating_hours: Record<string, { open: string; close: string; closed: boolean }>
  session_times_by_day: Record<string, string[]>
}

const ALL_DAYS = [
  { dow: '1', label: 'Monday' },
  { dow: '2', label: 'Tuesday' },
  { dow: '3', label: 'Wednesday' },
  { dow: '4', label: 'Thursday' },
  { dow: '5', label: 'Friday' },
  { dow: '6', label: 'Saturday' },
]

const TIME_OPTIONS: string[] = []
for (let h = 7; h <= 22; h++) {
  TIME_OPTIONS.push(`${String(h).padStart(2, '0')}:00`)
  if (h < 22) TIME_OPTIONS.push(`${String(h).padStart(2, '0')}:30`)
}

const DEFAULTS = {
  center_name: 'Tutoring Center',
  center_email: '',
  reminder_lead_time_hours: 24,
  reminder_subject: 'Tutoring Reminder',
  reminder_body: 'Hi {{name}}, you have a session on {{date}} at {{time}}.',
}

const DEFAULT_OPERATING_HOURS = {
  '1': { open: '13:30', close: '21:30', closed: false },
  '2': { open: '13:30', close: '21:30', closed: false },
  '3': { open: '13:30', close: '21:30', closed: false },
  '4': { open: '13:30', close: '21:30', closed: false },
  '6': { open: '09:30', close: '17:30', closed: false },
}

const DEFAULT_SESSION_TIMES_BY_DAY = {
  '1': ['13:30-15:20', '15:30-17:20', '17:30-19:20', '19:30-21:20'],
  '2': ['13:30-15:20', '15:30-17:20', '17:30-19:20', '19:30-21:20'],
  '3': ['13:30-15:20', '15:30-17:20', '17:30-19:20', '19:30-21:20'],
  '4': ['13:30-15:20', '15:30-17:20', '17:30-19:20', '19:30-21:20'],
  '6': ['09:30-11:20', '11:30-13:20', '13:30-15:20', '15:30-17:20'],
}

function fmt12(t: string): string {
  if (!t) return ''
  const [hStr, mStr] = t.split(':')
  const h = parseInt(hStr, 10)
  const m = mStr ?? '00'
  const ampm = h >= 12 ? 'PM' : 'AM'
  const h12 = h % 12 === 0 ? 12 : h % 12
  return `${h12}:${m} ${ampm}`
}

function parseSlot(slot: string): { start: string; end: string } {
  const parts = slot.split('-')
  if (parts.length === 2 && parts[1].includes(':')) return { start: parts[0], end: parts[1] }
  return { start: slot, end: '' }
}

export default function CenterSettingsPage() {
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState<string | null>(null)
  const [rowId, setRowId] = useState<string | null>(null)

  const [centerName, setCenterName] = useState(DEFAULTS.center_name)
  const [centerEmail, setCenterEmail] = useState(DEFAULTS.center_email)
  const [leadHours, setLeadHours] = useState<number>(DEFAULTS.reminder_lead_time_hours)
  const [subject, setSubject] = useState(DEFAULTS.reminder_subject)
  const [body, setBody] = useState(DEFAULTS.reminder_body)
  const [initialSnapshot, setInitialSnapshot] = useState<string>('')
  const [terms, setTerms] = useState<TermRow[]>([])
  const [termsLoading, setTermsLoading] = useState(true)
  const [termSaving, setTermSaving] = useState(false)
  const [activatingTermId, setActivatingTermId] = useState<string | null>(null)
  const [termDraft, setTermDraft] = useState<TermDraft>({
    id: '',
    name: '',
    start_date: '',
    end_date: '',
    status: 'upcoming',
    operating_hours: DEFAULT_OPERATING_HOURS as Record<string, { open: string; close: string; closed: boolean }>,
    session_times_by_day: DEFAULT_SESSION_TIMES_BY_DAY,
  })
  // per-day pending add-row state
  const [newTimeByDay, setNewTimeByDay] = useState<Record<string, { start: string; end: string }>>({})
  // which day's "apply to" popover is open
  const [applyPopover, setApplyPopover] = useState<string | null>(null)
  // whether the term add/edit form is visible
  const [termFormOpen, setTermFormOpen] = useState(false)

  const baseInputCls = 'w-full rounded border border-slate-200 bg-white px-3 py-2 text-sm text-slate-800 outline-none focus:border-slate-400 focus:ring-2 focus:ring-slate-100'

  const isDirty = useMemo(() => {
    const current = JSON.stringify({ centerName, centerEmail })
    return initialSnapshot ? current !== initialSnapshot : false
  }, [centerName, centerEmail, initialSnapshot])

  useEffect(() => {
    let cancelled = false

    async function load() {
      setLoading(true)
      setError(null)

      try {
        const { data, error: readErr } = await withCenter(
          supabase.from(DB.centerSettings).select('*').limit(1)
        ).maybeSingle()

        if (readErr) throw readErr

        if (!data) {
          const { data: inserted, error: insertErr } = await supabase
            .from(DB.centerSettings)
            .insert(withCenterPayload(DEFAULTS))
            .select('*')
            .single()

          if (insertErr) throw insertErr

          if (cancelled) return

          setRowId(inserted.id)
          setCenterName(inserted.center_name ?? DEFAULTS.center_name)
          setCenterEmail(inserted.center_email ?? '')
          setLeadHours(inserted.reminder_lead_time_hours ?? DEFAULTS.reminder_lead_time_hours)
          setSubject(inserted.reminder_subject ?? DEFAULTS.reminder_subject)
          setBody(inserted.reminder_body ?? DEFAULTS.reminder_body)
          setInitialSnapshot(JSON.stringify({
            centerName: inserted.center_name ?? DEFAULTS.center_name,
            centerEmail: inserted.center_email ?? '',
          }))
        } else {
          const row = data as CenterSettingsRow
          if (cancelled) return

          setRowId(row.id)
          setCenterName(row.center_name ?? DEFAULTS.center_name)
          setCenterEmail(row.center_email ?? '')
          setLeadHours(row.reminder_lead_time_hours ?? DEFAULTS.reminder_lead_time_hours)
          setSubject(row.reminder_subject ?? DEFAULTS.reminder_subject)
          setBody(row.reminder_body ?? DEFAULTS.reminder_body)
          setInitialSnapshot(JSON.stringify({
            centerName: row.center_name ?? DEFAULTS.center_name,
            centerEmail: row.center_email ?? '',
          }))
        }
      } catch (err: any) {
        if (!cancelled) setError(err?.message ?? 'Failed to load center settings')
      } finally {
        if (!cancelled) setLoading(false)
      }
    }

    load()
    return () => { cancelled = true }
  }, [])

  useEffect(() => {
    let cancelled = false

    const loadTerms = async () => {
      setTermsLoading(true)
      try {
        const res = await fetch('/api/terms')
        const payload = await res.json()
        if (!res.ok) throw new Error(payload?.error || 'Failed to load terms')
        if (!cancelled) setTerms(Array.isArray(payload?.terms) ? payload.terms : [])
      } catch (err: any) {
        if (!cancelled) setError(err?.message ?? 'Failed to load terms')
      } finally {
        if (!cancelled) setTermsLoading(false)
      }
    }

    loadTerms()
    return () => { cancelled = true }
  }, [])

  const handleSave = async () => {
    if (!rowId) return

    setSaving(true)
    setError(null)
    setSuccess(null)

    try {
      const payload = {
        center_name: centerName.trim() || DEFAULTS.center_name,
        center_email: centerEmail.trim() || null,
        reminder_lead_time_hours: Number.isFinite(leadHours) ? Math.max(1, Math.min(168, leadHours)) : DEFAULTS.reminder_lead_time_hours,
        reminder_subject: subject.trim() || DEFAULTS.reminder_subject,
        reminder_body: body.trim() || DEFAULTS.reminder_body,
      }

      const { error: updateErr } = await withCenter(
        supabase.from(DB.centerSettings).update(payload)
      ).eq('id', rowId)

      if (updateErr) throw updateErr

      setSuccess('Settings saved.')
      setInitialSnapshot(JSON.stringify({ centerName, centerEmail }))
    } catch (err: any) {
      setError(err?.message ?? 'Failed to save settings')
    } finally {
      setSaving(false)
    }
  }

  const resetTermDraft = () => {
    setTermDraft({
      id: '',
      name: '',
      start_date: '',
      end_date: '',
      status: 'upcoming',
      operating_hours: DEFAULT_OPERATING_HOURS as Record<string, { open: string; close: string; closed: boolean }>,
      session_times_by_day: DEFAULT_SESSION_TIMES_BY_DAY,
    })
    setTermFormOpen(false)
  }

  const handleSaveTerm = async () => {
    if (!termDraft.name || !termDraft.start_date || !termDraft.end_date) {
      setError('Term name, start date, and end date are required.')
      return
    }

    setTermSaving(true)
    setError(null)
    try {
      const method = termDraft.id ? 'PATCH' : 'POST'
      const res = await fetch('/api/terms', {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          id: termDraft.id || undefined,
          name: termDraft.name,
          startDate: termDraft.start_date,
          endDate: termDraft.end_date,
          status: termDraft.status,
          operatingHours: termDraft.operating_hours,
          sessionTimesByDay: termDraft.session_times_by_day,
        }),
      })

      const payload = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(payload?.error || 'Failed to save term')

      const saved = payload?.term
      if (saved?.id) {
        setTerms(prev => {
          const exists = prev.some(t => t.id === saved.id)
          if (exists) return prev.map(t => t.id === saved.id ? saved : t)
          return [saved, ...prev]
        })
      }
      resetTermDraft()
    } catch (err: any) {
      setError(err?.message ?? 'Failed to save term')
    } finally {
      setTermSaving(false)
    }
  }

  const handleEditTerm = (term: TermRow) => {
    setTermDraft({
      id: term.id,
      name: term.name,
      start_date: term.start_date,
      end_date: term.end_date,
      status: term.status,
      operating_hours: (term.operating_hours ?? DEFAULT_OPERATING_HOURS) as Record<string, { open: string; close: string; closed: boolean }>,
      session_times_by_day: term.session_times_by_day ?? DEFAULT_SESSION_TIMES_BY_DAY,
    })
    setTermFormOpen(true)
  }

  const handleSetCurrentTerm = async (termId: string) => {
    setActivatingTermId(termId)
    setError(null)
    setSuccess(null)
    try {
      const res = await fetch('/api/terms', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: termId, status: 'active' }),
      })
      const payload = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(payload?.error || 'Failed to switch current term')

      const refresh = await fetch('/api/terms')
      const refreshPayload = await refresh.json().catch(() => ({}))
      if (!refresh.ok) throw new Error(refreshPayload?.error || 'Failed to refresh terms')
      setTerms(Array.isArray(refreshPayload?.terms) ? refreshPayload.terms : [])
      setSuccess('Current term updated.')
    } catch (err: any) {
      setError(err?.message ?? 'Failed to switch current term')
    } finally {
      setActivatingTermId(null)
    }
  }

  if (loading) {
    return (
      <div className="min-h-screen bg-slate-50 px-4 py-5">
        <div className="mx-auto flex h-[calc(100vh-2.5rem)] w-full max-w-5xl items-center justify-center rounded-2xl border border-slate-200 bg-white shadow-sm">
          <div className="flex items-center gap-2 text-slate-500">
            <Loader2 size={16} className="animate-spin" />
            <span className="text-sm">Loading center settings...</span>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-slate-50 px-4 py-5">
      <div className="mx-auto w-full max-w-5xl rounded-2xl border border-slate-200 bg-white shadow-sm">
        <div className="flex items-center justify-between border-b border-slate-100 px-5 py-4">
          <div className="flex items-center gap-3">
            <div className="flex h-8 w-8 items-center justify-center rounded bg-slate-900 text-white">
              <Settings size={15} />
            </div>
            <div>
              <p className="text-[10px] font-bold uppercase tracking-widest text-slate-400">Admin</p>
              <h1 className="text-base font-bold text-slate-900">Center Settings</h1>
            </div>
          </div>
          <button
            onClick={handleSave}
            disabled={saving || !isDirty}
            className="inline-flex items-center gap-1.5 rounded bg-slate-900 px-3 py-1.5 text-xs font-semibold text-white hover:bg-slate-800 disabled:opacity-50"
          >
            {saving ? <Loader2 size={12} className="animate-spin" /> : <Save size={12} />}
            Save
          </button>
        </div>

        <div className="space-y-4 p-5">
          {error && <div className="rounded border border-red-200 bg-red-50 px-3 py-2 text-xs font-medium text-red-700">{error}</div>}
          {success && <div className="rounded border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs font-medium text-emerald-700">{success}</div>}

          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
            <div>
              <label className="mb-1 block text-xs font-semibold text-slate-500">Center Name</label>
              <input value={centerName} onChange={e => setCenterName(e.target.value)} className={baseInputCls} />
            </div>
            <div>
              <label className="mb-1 block text-xs font-semibold text-slate-500">Director Email(s)</label>
              <input value={centerEmail} onChange={e => setCenterEmail(e.target.value)} className={baseInputCls} placeholder="director@yourcenter.com" />
            </div>
          </div>

          <div className="rounded-lg border border-slate-200 bg-slate-50 p-4">
            <div className="mb-3 flex items-center justify-between">
              <div>
                <p className="text-[10px] font-bold uppercase tracking-widest text-slate-400">Terms</p>
                <p className="text-xs text-slate-500">Manage schedule setup by academic term.</p>
              </div>
              {!termFormOpen && (
                <button
                  onClick={() => { resetTermDraft(); setTermFormOpen(true) }}
                  className="rounded bg-slate-900 px-3 py-1.5 text-xs font-semibold text-white hover:bg-slate-800"
                >
                  + New Term
                </button>
              )}
            </div>

            {/* Term list */}
            <div className="overflow-hidden rounded border border-slate-200 bg-white">
              {termsLoading ? (
                <div className="px-3 py-2 text-xs text-slate-500">Loading terms...</div>
              ) : terms.length === 0 ? (
                <div className="px-3 py-2 text-xs text-slate-500">No terms yet. Click + New Term to get started.</div>
              ) : (
                terms.map(term => {
                  const isActive = term.status?.trim().toLowerCase() === 'active'
                  return (
                  <div key={term.id} className="flex items-center justify-between border-b border-slate-100 px-3 py-2 text-xs last:border-b-0">
                    <div>
                      <div className="flex items-center gap-2">
                        <p className="font-semibold text-slate-800">{term.name}</p>
                        {isActive && (
                          <span className="rounded bg-emerald-100 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-emerald-700">Current</span>
                        )}
                      </div>
                      <p className="text-slate-500">
                        {term.start_date} to {term.end_date} · {term.status}
                      </p>
                      <p className="text-[11px] text-slate-400">
                        Hours: {term.operating_hours ? 'configured' : 'default'} · Times: {term.session_times_by_day ? 'configured' : 'default'}
                      </p>
                    </div>
                    <div className="flex items-center gap-2">
                      <button
                        onClick={() => handleSetCurrentTerm(term.id)}
                        disabled={isActive || activatingTermId === term.id}
                        className="rounded border border-slate-200 bg-white px-2.5 py-1 text-[11px] font-semibold text-slate-700 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50"
                      >
                        {isActive ? 'Current' : (activatingTermId === term.id ? 'Switching...' : 'Set Current')}
                      </button>
                      <button
                        onClick={() => handleEditTerm(term)}
                        className="rounded border border-slate-200 bg-white px-2.5 py-1 text-[11px] font-semibold text-slate-700 hover:bg-slate-50"
                      >
                        Edit
                      </button>
                    </div>
                  </div>
                )})
              )}
            </div>

            {/* Term add/edit form — only shown when open */}
            {termFormOpen && (
              <div className="mt-4 rounded border border-slate-200 bg-white p-4">
                <p className="mb-3 text-xs font-bold text-slate-700">{termDraft.id ? 'Edit Term' : 'New Term'}</p>

                <div className="grid grid-cols-1 gap-3 md:grid-cols-4">
                  <div className="md:col-span-2">
                    <label className="mb-1 block text-xs font-semibold text-slate-500">Term Name</label>
                    <input
                      value={termDraft.name}
                      onChange={e => setTermDraft(prev => ({ ...prev, name: e.target.value }))}
                      className={baseInputCls}
                      placeholder="e.g. Spring 2026"
                    />
                  </div>
                  <div>
                    <label className="mb-1 block text-xs font-semibold text-slate-500">Status</label>
                    <select
                      value={termDraft.status}
                      onChange={e => setTermDraft(prev => ({ ...prev, status: e.target.value }))}
                      className={baseInputCls}
                    >
                      <option value="upcoming">Upcoming</option>
                      <option value="active">Active</option>
                      <option value="completed">Completed</option>
                    </select>
                  </div>
                </div>

                <div className="mt-3 grid grid-cols-1 gap-3 md:grid-cols-2">
                  <div>
                    <label className="mb-1 block text-xs font-semibold text-slate-500">Start Date</label>
                    <input
                      type="date"
                      value={termDraft.start_date}
                      onChange={e => setTermDraft(prev => ({ ...prev, start_date: e.target.value }))}
                      className={baseInputCls}
                    />
                  </div>
                  <div>
                    <label className="mb-1 block text-xs font-semibold text-slate-500">End Date</label>
                    <input
                      type="date"
                      value={termDraft.end_date}
                      onChange={e => setTermDraft(prev => ({ ...prev, end_date: e.target.value }))}
                      className={baseInputCls}
                    />
                  </div>
                </div>

                <div className="mt-4">
                  <div className="mb-3 flex flex-wrap items-center gap-2">
                    <p className="text-xs font-semibold text-slate-600">Hours &amp; Session Times by Day</p>
                    {terms.length > 0 && (
                      <select
                        className="ml-auto rounded border border-slate-200 bg-white px-2 py-1 text-xs text-slate-700"
                        defaultValue=""
                        onChange={e => {
                          const src = terms.find(t => t.id === e.target.value)
                          if (!src) return
                          setTermDraft(prev => ({
                            ...prev,
                            operating_hours: (src.operating_hours ?? DEFAULT_OPERATING_HOURS) as Record<string, { open: string; close: string; closed: boolean }>,
                            session_times_by_day: src.session_times_by_day ?? DEFAULT_SESSION_TIMES_BY_DAY,
                          }))
                          e.target.value = ''
                        }}
                      >
                        <option value="" disabled>Copy times from term…</option>
                        {terms.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
                      </select>
                    )}
                  </div>
                  <div className="space-y-2">
                    {ALL_DAYS.map(({ dow, label }) => {
                      const oh = termDraft.operating_hours[dow] ?? { open: '09:00', close: '21:00', closed: true }
                      const openVal = oh.open ?? '09:00'
                      const closeVal = oh.close ?? '21:00'
                      const slots = termDraft.session_times_by_day[dow] ?? []
                      const isClosed = oh.closed ?? true
                      const pending = newTimeByDay[dow] ?? { start: '', end: '' }
                      const pendingStart = pending.start ?? ''
                      const pendingEnd = pending.end ?? ''
                      return (
                        <div key={dow} className="rounded border border-slate-200 bg-slate-50 p-3">
                          <div className="flex flex-wrap items-center gap-3">
                            <label className="flex w-24 cursor-pointer items-center gap-1.5 text-xs font-semibold text-slate-700">
                              <input
                                type="checkbox"
                                checked={!isClosed}
                                onChange={e => {
                                  const isOpen = e.target.checked
                                  setTermDraft(prev => ({
                                    ...prev,
                                    operating_hours: { ...prev.operating_hours, [dow]: { ...oh, closed: !isOpen } },
                                    session_times_by_day: isOpen ? prev.session_times_by_day : { ...prev.session_times_by_day, [dow]: [] },
                                  }))
                                }}
                              />
                              {label}
                            </label>
                            {!isClosed && (
                              <div className="flex items-center gap-2 text-xs text-slate-500">
                                <span>Open:</span>
                                <select
                                  value={openVal}
                                  onChange={e => setTermDraft(prev => ({ ...prev, operating_hours: { ...prev.operating_hours, [dow]: { ...oh, open: e.target.value } } }))}
                                  className="rounded border border-slate-200 bg-white px-2 py-1 text-xs"
                                >
                                  {TIME_OPTIONS.map(t => <option key={t} value={t}>{fmt12(t)}</option>)}
                                </select>
                                <span className="text-slate-400">–</span>
                                <select
                                  value={closeVal}
                                  onChange={e => setTermDraft(prev => ({ ...prev, operating_hours: { ...prev.operating_hours, [dow]: { ...oh, close: e.target.value } } }))}
                                  className="rounded border border-slate-200 bg-white px-2 py-1 text-xs"
                                >
                                  {TIME_OPTIONS.map(t => <option key={t} value={t}>{fmt12(t)}</option>)}
                                </select>
                              </div>
                            )}
                            {!isClosed && slots.length > 0 && (
                              <div className="relative ml-auto">
                                <button
                                  type="button"
                                  onClick={() => setApplyPopover(applyPopover === dow ? null : dow)}
                                  className="rounded border border-slate-200 bg-white px-2 py-1 text-[11px] font-semibold text-slate-600 hover:bg-slate-50"
                                >
                                  Apply to days…
                                </button>
                                {applyPopover === dow && (
                                  <div className="absolute right-0 top-full z-20 mt-1 w-44 rounded border border-slate-200 bg-white p-3 shadow-lg">
                                    <p className="mb-2 text-[10px] font-bold uppercase tracking-widest text-slate-400">Copy slots to</p>
                                    {ALL_DAYS.filter(d => d.dow !== dow).map(d => (
                                      <label key={d.dow} className="flex cursor-pointer items-center gap-2 py-0.5 text-xs text-slate-700">
                                        <input
                                          type="checkbox"
                                          onChange={e => {
                                            if (!e.target.checked) return
                                            setTermDraft(prev => ({
                                              ...prev,
                                              session_times_by_day: { ...prev.session_times_by_day, [d.dow]: [...slots] },
                                              operating_hours: { ...prev.operating_hours, [d.dow]: { ...oh } },
                                            }))
                                            e.target.checked = false
                                          }}
                                        />
                                        {d.label}
                                      </label>
                                    ))}
                                    <button type="button" onClick={() => setApplyPopover(null)} className="mt-2 w-full rounded bg-slate-900 px-2 py-1 text-[11px] font-semibold text-white">Done</button>
                                  </div>
                                )}
                              </div>
                            )}
                          </div>

                          {!isClosed && (
                            <div className="mt-3 space-y-1 pl-1">
                              <p className="mb-1.5 text-[10px] font-bold uppercase tracking-widest text-slate-400">Session Slots</p>
                              {slots.length === 0 && <p className="text-[11px] italic text-slate-400">No sessions yet.</p>}
                              {slots.map((slot, slotIdx) => {
                                const { start, end } = parseSlot(slot)
                                return (
                                  <div key={slot} className="flex items-center gap-2">
                                    <span className="w-20 shrink-0 text-[11px] font-semibold text-slate-500">Session {slotIdx + 1}</span>
                                    <input
                                      type="time"
                                      value={start}
                                      onChange={e => {
                                        const newSlot = end ? `${e.target.value}-${end}` : e.target.value
                                        setTermDraft(prev => ({ ...prev, session_times_by_day: { ...prev.session_times_by_day, [dow]: (prev.session_times_by_day[dow] ?? []).map(s => s === slot ? newSlot : s) } }))
                                      }}
                                      className="rounded border border-slate-200 px-2 py-1 text-xs"
                                    />
                                    <span className="text-slate-400 text-xs">→</span>
                                    <input
                                      type="time"
                                      value={end}
                                      onChange={e => {
                                        const newSlot = `${start}-${e.target.value}`
                                        setTermDraft(prev => ({ ...prev, session_times_by_day: { ...prev.session_times_by_day, [dow]: (prev.session_times_by_day[dow] ?? []).map(s => s === slot ? newSlot : s) } }))
                                      }}
                                      className="rounded border border-slate-200 px-2 py-1 text-xs"
                                    />
                                    <span className="w-36 shrink-0 text-[11px] text-slate-400">
                                      {start && end ? `${fmt12(start)} – ${fmt12(end)}` : start ? fmt12(start) : ''}
                                    </span>
                                    <button
                                      type="button"
                                      onClick={() => setTermDraft(prev => ({ ...prev, session_times_by_day: { ...prev.session_times_by_day, [dow]: (prev.session_times_by_day[dow] ?? []).filter(s => s !== slot) } }))}
                                      className="text-slate-300 hover:text-red-500 text-sm leading-none"
                                    >&times;</button>
                                  </div>
                                )
                              })}
                              <div className="flex items-center gap-2 pt-1">
                                <span className="w-20 shrink-0 text-[11px] font-semibold text-slate-400">Session {slots.length + 1}</span>
                                <input
                                  type="time"
                                  value={pendingStart}
                                  onChange={e => { const v = e.target.value; setNewTimeByDay(prev => ({ ...prev, [dow]: { start: v, end: prev[dow]?.end ?? '' } })) }}
                                  className="rounded border border-dashed border-slate-300 px-2 py-1 text-xs"
                                />
                                <span className="text-slate-400 text-xs">→</span>
                                <input
                                  type="time"
                                  value={pendingEnd}
                                  onChange={e => { const v = e.target.value; setNewTimeByDay(prev => ({ ...prev, [dow]: { start: prev[dow]?.start ?? '', end: v } })) }}
                                  className="rounded border border-dashed border-slate-300 px-2 py-1 text-xs"
                                />
                                <button
                                  type="button"
                                  disabled={!pendingStart || !pendingEnd}
                                  onClick={() => {
                                    if (!pendingStart || !pendingEnd) return
                                    const newSlot = `${pendingStart}-${pendingEnd}`
                                    if (slots.includes(newSlot)) return
                                    setTermDraft(prev => ({ ...prev, session_times_by_day: { ...prev.session_times_by_day, [dow]: [...(prev.session_times_by_day[dow] ?? []), newSlot].sort() } }))
                                    setNewTimeByDay(prev => ({ ...prev, [dow]: { start: '', end: '' } }))
                                  }}
                                  className="rounded bg-slate-800 px-2 py-1 text-[11px] font-semibold text-white hover:bg-slate-700 disabled:opacity-40"
                                >+ Add</button>
                              </div>
                            </div>
                          )}
                          {isClosed && <p className="mt-2 text-[11px] italic text-slate-400">Closed — no sessions</p>}
                        </div>
                      )
                    })}
                  </div>
                </div>

                <div className="mt-4 flex gap-2">
                  <button
                    onClick={handleSaveTerm}
                    disabled={termSaving}
                    className="rounded bg-slate-900 px-4 py-2 text-xs font-semibold text-white hover:bg-slate-800 disabled:opacity-50"
                  >
                    {termSaving ? 'Saving…' : (termDraft.id ? 'Update Term' : 'Save Term')}
                  </button>
                  <button
                    onClick={resetTermDraft}
                    className="rounded border border-slate-200 bg-white px-4 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50"
                  >
                    Cancel
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
