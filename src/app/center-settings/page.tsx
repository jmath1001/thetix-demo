'use client'

import { useEffect, useMemo, useState } from 'react'
import { Clock, Loader2, Plus, Save, Settings, Trash2, Zap, Pencil } from 'lucide-react'
import { useRouter, useSearchParams } from 'next/navigation'
import { supabase } from '@/lib/supabaseClient'
import { DB, withCenter, withCenterPayload } from '@/lib/db'

type CenterSettingsRow = {
  id: string
  center_name: string | null
  center_short_name: string | null
  center_email: string | null
  center_phone: string | null
  center_address: string | null
  reminder_lead_time_hours: number | null
  reminder_subject: string | null
  reminder_body: string | null
  enrollment_instructions: string | null
  tutor_portal_message: string | null
  session_duration_minutes: number | null
  session_times_by_day: Record<string, string[]> | null
}

type TermRow = {
  id: string
  name: string
  start_date: string
  end_date: string
  status: string
  session_hours: number | null
  operating_hours: Record<string, { open: string; close: string; closed?: boolean }> | null
  session_times_by_day: Record<string, string[]> | null
  date_exceptions: Array<{ date: string; closed: boolean; label?: string }> | null
}

type DateException = {
  date: string
  closed: boolean
  label?: string
}

type TermDraft = {
  id: string
  name: string
  start_date: string
  end_date: string
  status: string
  session_hours: number
  operating_hours: Record<string, { open: string; close: string; closed: boolean }>
  session_times_by_day: Record<string, string[]>
  date_exceptions: DateException[]
}

const ALL_DAYS = [
  { dow: '1', label: 'Monday' },
  { dow: '2', label: 'Tuesday' },
  { dow: '3', label: 'Wednesday' },
  { dow: '4', label: 'Thursday' },
  { dow: '5', label: 'Friday' },
  { dow: '6', label: 'Saturday' },
]

const DEFAULTS = {
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

function parseSlot(slot: string): { start: string; end: string } {
  const parts = slot.split('-')
  if (parts.length === 2 && parts[1].includes(':')) return { start: parts[0], end: parts[1] }
  return { start: slot, end: '' }
}

const TABS = ['general', 'notifications', 'portals', 'subjects'] as const
type Tab = typeof TABS[number]

export default function CenterSettingsPage() {
  const router = useRouter()
  const searchParams = useSearchParams()

  const initialTab = (searchParams.get('tab') as Tab) ?? 'general'
  const [tab, setTab] = useState<Tab>(TABS.includes(initialTab) ? initialTab : 'general')

  const handleTabChange = (t: Tab) => {
    setTab(t)
    const params = new URLSearchParams(searchParams.toString())
    params.set('tab', t)
    router.replace(`?${params.toString()}`, { scroll: false })
  }

  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [editing, setEditing] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState<string | null>(null)
  const [rowId, setRowId] = useState<string | null>(null)

  const [centerName, setCenterName] = useState(DEFAULTS.center_name)
  const [centerShortName, setCenterShortName] = useState(DEFAULTS.center_short_name)
  const [centerEmail, setCenterEmail] = useState(DEFAULTS.center_email)
  const [centerPhone, setCenterPhone] = useState(DEFAULTS.center_phone)
  const [centerAddress, setCenterAddress] = useState(DEFAULTS.center_address)
  const [leadHours, setLeadHours] = useState<number>(DEFAULTS.reminder_lead_time_hours)
  const [subject, setSubject] = useState(DEFAULTS.reminder_subject)
  const [body, setBody] = useState(DEFAULTS.reminder_body)
  const [enrollmentInstructions, setEnrollmentInstructions] = useState(DEFAULTS.enrollment_instructions)
  const [tutorPortalMessage, setTutorPortalMessage] = useState(DEFAULTS.tutor_portal_message)
  const [sessionDurationMinutes, setSessionDurationMinutes] = useState<number>(DEFAULTS.session_duration_minutes)
  const [initialSnapshot, setInitialSnapshot] = useState<string>('')

  // ── Terms ────────────────────────────────────────────────────────────────
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
    session_hours: 2,
    operating_hours: DEFAULT_OPERATING_HOURS as Record<string, { open: string; close: string; closed: boolean }>,
    session_times_by_day: DEFAULT_SESSION_TIMES_BY_DAY,
    date_exceptions: [],
  })
  const [newTimeByDay, setNewTimeByDay] = useState<Record<string, { start: string; end: string }>>({})
  const [termFormOpen, setTermFormOpen] = useState(false)
  const [newExceptionDate, setNewExceptionDate] = useState('')
  const [newExceptionLabel, setNewExceptionLabel] = useState('')
  const [newExceptionClosed, setNewExceptionClosed] = useState(true)

  // ── Global default session times ─────────────────────────────────────────
  const [globalSessionTimes, setGlobalSessionTimes] = useState<Record<string, string[]>>(DEFAULT_SESSION_TIMES_BY_DAY)
  const [globalNewTimeByDay, setGlobalNewTimeByDay] = useState<Record<string, { start: string; end: string }>>({})
  const [globalSaving, setGlobalSaving] = useState(false)
  const [defaultOpen, setDefaultOpen] = useState(false)

  // ── Reminder send time ───────────────────────────────────────────────────
  type CronSchedule = { hours: number[]; minutes: number[]; timezone: string }
  type CronJob = { enabled: boolean; nextExecution: number; lastExecution: number; lastStatus: number; schedule: CronSchedule }
  type CronHistoryItem = { date: number; status: number; statusText: string; httpStatus: number; duration: number }
  const DEFAULT_REMINDER_TIMEZONE = 'America/Chicago'
  const [cronJob, setCronJob] = useState<CronJob | null>(null)
  const [cronHistory, setCronHistory] = useState<CronHistoryItem[]>([])
  const [cronLoading, setCronLoading] = useState(false)
  const [cronSaving, setCronSaving] = useState(false)
  const [cronConfigured, setCronConfigured] = useState<boolean | null>(null)
  const [reminderTime, setReminderTime] = useState('07:00')

  useEffect(() => {
    if (tab !== 'notifications') return
    let cancelled = false
    setCronLoading(true)
    Promise.all([
      fetch('/api/cron-config').then(r => r.json()),
      fetch('/api/cron-config?history').then(r => r.json()),
    ]).then(([jobRes, histRes]) => {
      if (cancelled) return
      if (jobRes?.error === 'CRONJOB_ORG_API_KEY or CRONJOB_ORG_JOB_ID is not configured') {
        setCronConfigured(false)
        return
      }
      setCronConfigured(true)
      const details: CronJob = jobRes?.jobDetails ?? null
      if (details) {
        setCronJob(details)
        const h = Array.isArray(details.schedule?.hours) && details.schedule.hours[0] !== -1 ? details.schedule.hours[0] : 7
        const m = Array.isArray(details.schedule?.minutes) && details.schedule.minutes[0] !== -1 ? details.schedule.minutes[0] : 0
        setReminderTime(`${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`)
      }
      setCronHistory(Array.isArray(histRes?.history) ? histRes.history.slice(0, 8) : [])
    }).catch(() => { if (!cancelled) setCronConfigured(false) })
      .finally(() => { if (!cancelled) setCronLoading(false) })
    return () => { cancelled = true }
  }, [tab])

  const saveReminderTime = async () => {
    const [hStr, mStr] = reminderTime.split(':')
    const h = parseInt(hStr, 10)
    const m = parseInt(mStr, 10)
    const timezone = cronJob?.schedule?.timezone || Intl.DateTimeFormat().resolvedOptions().timeZone || DEFAULT_REMINDER_TIMEZONE
    setCronSaving(true)
    setError(null)
    try {
      const res = await fetch('/api/cron-config', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          schedule: { hours: [h], minutes: [m], wdays: [-1], timezone },
        }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data?.error ?? 'Failed to save')
      const updated = await fetch('/api/cron-config').then(r => r.json())
      if (updated?.jobDetails) setCronJob(updated.jobDetails)
      setSuccess('Reminder time saved.')
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setCronSaving(false)
    }
  }

  const toggleCronEnabled = async () => {
    if (!cronJob) return
    setCronSaving(true)
    setError(null)
    try {
      const res = await fetch('/api/cron-config', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ enabled: !cronJob.enabled }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data?.error ?? 'Failed')
      const updated = await fetch('/api/cron-config').then(r => r.json())
      if (updated?.jobDetails) setCronJob(updated.jobDetails)
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setCronSaving(false)
    }
  }

  // ── Subjects ─────────────────────────────────────────────────────────────
  const [centerSubjects, setCenterSubjects] = useState<string[]>([])
  const [subjectsLoading, setSubjectsLoading] = useState(true)
  const [subjectsSaving, setSubjectsSaving] = useState(false)
  const [newSubjectInput, setNewSubjectInput] = useState('')

  const baseInputCls = 'w-full rounded border border-slate-200 bg-white px-3 py-2 text-sm text-slate-800 outline-none focus:border-slate-400 focus:ring-2 focus:ring-slate-100'
  const readonlyInputCls = 'w-full rounded border border-transparent bg-slate-50 px-3 py-2 text-sm text-slate-700'

  const snapshot = useMemo(() => JSON.stringify({
    centerName, centerShortName, centerEmail, centerPhone, centerAddress,
    leadHours, subject, body, enrollmentInstructions, tutorPortalMessage, sessionDurationMinutes,
  }), [centerName, centerShortName, centerEmail, centerPhone, centerAddress, leadHours, subject, body, enrollmentInstructions, tutorPortalMessage, sessionDurationMinutes])

  const isDirty = initialSnapshot ? snapshot !== initialSnapshot : false

  // ── Load center settings ─────────────────────────────────────────────────
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

        const applyRow = (row: CenterSettingsRow) => {
          setRowId(row.id)
          setCenterName(row.center_name ?? DEFAULTS.center_name)
          setCenterShortName(row.center_short_name ?? DEFAULTS.center_short_name)
          setCenterEmail(row.center_email ?? '')
          setCenterPhone(row.center_phone ?? '')
          setCenterAddress(row.center_address ?? '')
          setLeadHours(row.reminder_lead_time_hours ?? DEFAULTS.reminder_lead_time_hours)
          setSubject(row.reminder_subject ?? DEFAULTS.reminder_subject)
          setBody(row.reminder_body ?? DEFAULTS.reminder_body)
          setEnrollmentInstructions(row.enrollment_instructions ?? '')
          setTutorPortalMessage(row.tutor_portal_message ?? '')
          setSessionDurationMinutes(row.session_duration_minutes ?? DEFAULTS.session_duration_minutes)
          if (row.session_times_by_day) setGlobalSessionTimes(row.session_times_by_day)
          setInitialSnapshot(JSON.stringify({
            centerName: row.center_name ?? DEFAULTS.center_name,
            centerShortName: row.center_short_name ?? DEFAULTS.center_short_name,
            centerEmail: row.center_email ?? '',
            centerPhone: row.center_phone ?? '',
            centerAddress: row.center_address ?? '',
            leadHours: row.reminder_lead_time_hours ?? DEFAULTS.reminder_lead_time_hours,
            subject: row.reminder_subject ?? DEFAULTS.reminder_subject,
            body: row.reminder_body ?? DEFAULTS.reminder_body,
            enrollmentInstructions: row.enrollment_instructions ?? '',
            tutorPortalMessage: row.tutor_portal_message ?? '',
            sessionDurationMinutes: row.session_duration_minutes ?? DEFAULTS.session_duration_minutes,
          }))
        }

        if (!data) {
          const { data: inserted, error: insertErr } = await supabase
            .from(DB.centerSettings)
            .insert(withCenterPayload(DEFAULTS))
            .select('*')
            .single()
          if (insertErr) throw insertErr
          if (!cancelled) applyRow(inserted as CenterSettingsRow)
        } else {
          if (!cancelled) applyRow(data as CenterSettingsRow)
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

  // ── Load terms ────────────────────────────────────────────────────────────
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

  // ── Load subjects ─────────────────────────────────────────────────────────
  useEffect(() => {
    let cancelled = false
    const loadSubjects = async () => {
      setSubjectsLoading(true)
      try {
        const res = await fetch('/api/center-subjects')
        const payload = await res.json()
        if (!cancelled) setCenterSubjects(Array.isArray(payload?.subjects) ? payload.subjects : [])
      } catch { /* keep empty */ } finally {
        if (!cancelled) setSubjectsLoading(false)
      }
    }
    loadSubjects()
    return () => { cancelled = true }
  }, [])

  const handleSaveGlobalTimes = async () => {
    if (!rowId) return
    setGlobalSaving(true)
    setError(null)
    try {
      const { error: updateErr } = await withCenter(
        supabase.from(DB.centerSettings).update({ session_times_by_day: globalSessionTimes })
      ).eq('id', rowId)
      if (updateErr) throw updateErr
      setSuccess('Default session times saved.')
    } catch (err: any) {
      setError(err?.message ?? 'Failed to save default session times')
    } finally {
      setGlobalSaving(false)
    }
  }

  const handleSaveSubjects = async () => {
    setSubjectsSaving(true)
    try {
      const res = await fetch('/api/center-subjects', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ subjects: centerSubjects }),
      })
      const payload = await res.json()
      if (!res.ok) throw new Error(payload?.error || 'Failed to save subjects')
      setSuccess('Subjects saved.')
    } catch (err: any) {
      setError(err?.message ?? 'Failed to save subjects')
    } finally {
      setSubjectsSaving(false)
    }
  }

  const handleAddSubject = () => {
    const trimmed = newSubjectInput.trim()
    if (!trimmed || centerSubjects.includes(trimmed)) return
    setCenterSubjects(prev => [...prev, trimmed])
    setNewSubjectInput('')
  }

  const handleRemoveSubject = (s: string) => setCenterSubjects(prev => prev.filter(x => x !== s))

  const handleSave = async () => {
    if (!rowId) return
    setSaving(true)
    setError(null)
    setSuccess(null)

    const extendedPayload = {
      center_name: centerName.trim() || DEFAULTS.center_name,
      center_short_name: centerShortName.trim() || null,
      center_email: centerEmail.trim() || null,
      center_phone: centerPhone.trim() || null,
      center_address: centerAddress.trim() || null,
      reminder_lead_time_hours: Number.isFinite(leadHours) ? Math.max(1, Math.min(168, leadHours)) : DEFAULTS.reminder_lead_time_hours,
      reminder_subject: subject.trim() || DEFAULTS.reminder_subject,
      reminder_body: body.trim() || DEFAULTS.reminder_body,
      enrollment_instructions: enrollmentInstructions.trim() || null,
      tutor_portal_message: tutorPortalMessage.trim() || null,
      session_duration_minutes: Number.isFinite(sessionDurationMinutes) ? Math.max(30, Math.min(240, sessionDurationMinutes)) : DEFAULTS.session_duration_minutes,
    }

    try {
      let { error: updateErr } = await withCenter(
        supabase.from(DB.centerSettings).update(extendedPayload)
      ).eq('id', rowId)

      if (updateErr?.message?.includes('schema cache')) {
        const fallback = await withCenter(
          supabase.from(DB.centerSettings).update({
            center_name: extendedPayload.center_name,
            center_email: extendedPayload.center_email,
            reminder_lead_time_hours: extendedPayload.reminder_lead_time_hours,
            reminder_subject: extendedPayload.reminder_subject,
            reminder_body: extendedPayload.reminder_body,
          })
        ).eq('id', rowId)
        updateErr = fallback.error
      }

      if (updateErr) throw updateErr
      setSuccess('Settings saved.')
      setInitialSnapshot(snapshot)
      setEditing(false)
    } catch (err: any) {
      setError(err?.message ?? 'Failed to save settings')
    } finally {
      setSaving(false)
    }
  }

  const handleCancelEdit = () => {
    const snap = JSON.parse(initialSnapshot)
    setCenterName(snap.centerName)
    setCenterShortName(snap.centerShortName)
    setCenterEmail(snap.centerEmail)
    setCenterPhone(snap.centerPhone)
    setCenterAddress(snap.centerAddress)
    setLeadHours(snap.leadHours)
    setSubject(snap.subject)
    setBody(snap.body)
    setEnrollmentInstructions(snap.enrollmentInstructions)
    setTutorPortalMessage(snap.tutorPortalMessage)
    setSessionDurationMinutes(snap.sessionDurationMinutes)
    setEditing(false)
  }

  const resetTermDraft = () => {
    setTermDraft({
      id: '',
      name: '',
      start_date: '',
      end_date: '',
      status: 'upcoming',
      session_hours: 2,
      operating_hours: DEFAULT_OPERATING_HOURS as Record<string, { open: string; close: string; closed: boolean }>,
      session_times_by_day: DEFAULT_SESSION_TIMES_BY_DAY,
      date_exceptions: [],
    })
    setNewTimeByDay({})
    setTermFormOpen(false)
  }

  const handleSaveTerm = async () => {
    if (!termDraft.name || !termDraft.start_date || !termDraft.end_date) {
      setError('Term name, start date, and end date are required.')
      return
    }
    if (termDraft.end_date <= termDraft.start_date) {
      setError('End date must be after start date.')
      return
    }
    const overlap = terms.find(t => {
      if (t.id === termDraft.id) return false
      return termDraft.start_date <= t.end_date && termDraft.end_date >= t.start_date
    })
    if (overlap) {
      setError(`Date range overlaps with "${overlap.name}" (${overlap.start_date} – ${overlap.end_date}).`)
      return
    }

    setTermSaving(true)
    setError(null)
    try {
      const sanitizedSessionTimesByDay = Object.fromEntries(
        Object.entries(termDraft.session_times_by_day).filter(([dow, slots]) => {
          const oh = termDraft.operating_hours[dow]
          if (oh?.closed) return false
          return Array.isArray(slots) && slots.length > 0
        })
      ) as Record<string, string[]>

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
          sessionHours: Math.max(1, Number(termDraft.session_hours || 2)),
          operatingHours: termDraft.operating_hours,
          sessionTimesByDay: sanitizedSessionTimesByDay,
          dateExceptions: termDraft.date_exceptions,
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
      session_hours: typeof term.session_hours === 'number' ? term.session_hours : 2,
      operating_hours: (term.operating_hours ?? DEFAULT_OPERATING_HOURS) as Record<string, { open: string; close: string; closed: boolean }>,
      session_times_by_day: term.session_times_by_day ?? DEFAULT_SESSION_TIMES_BY_DAY,
      date_exceptions: Array.isArray(term.date_exceptions) ? term.date_exceptions : [],
    })
    setNewTimeByDay({})
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
      <div className="mx-auto w-full max-w-4xl rounded-2xl border border-slate-200 bg-white shadow-sm">

        {/* ── Header ── */}
        <div className="flex items-center justify-between border-b border-slate-100 px-5 py-4">
          <div className="flex items-center gap-3">
            <div className="flex h-8 w-8 items-center justify-center rounded bg-slate-900 text-white">
              <Settings size={15} />
            </div>
            <div>
              <p className="text-[10px] font-black uppercase tracking-widest" style={{ color: '#6366f1' }}>Admin</p>
              <h1 className="text-base font-bold text-slate-900">Center Settings</h1>
            </div>
          </div>
          {tab === 'general' && (
            editing ? (
              <div className="flex items-center gap-2">
                <button
                  onClick={handleCancelEdit}
                  className="rounded border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-slate-600 hover:bg-slate-50"
                >
                  Cancel
                </button>
                <button
                  onClick={handleSave}
                  disabled={saving || !isDirty}
                  className="inline-flex items-center gap-1.5 rounded bg-slate-900 px-3 py-1.5 text-xs font-semibold text-white hover:bg-slate-800 disabled:opacity-50"
                >
                  {saving ? <Loader2 size={12} className="animate-spin" /> : <Save size={12} />}
                  Save
                </button>
              </div>
            ) : (
              <button
                onClick={() => setEditing(true)}
                className="inline-flex items-center gap-1.5 rounded border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-50"
              >
                <Pencil size={11} />
                Edit
              </button>
            )
          )}
        </div>

        {/* ── Tab bar ── */}
        <div className="flex border-b border-slate-100 px-5">
          {([
            { id: 'general',       label: 'General' },
            { id: 'notifications', label: 'Notifications' },
            { id: 'portals',       label: 'Portals' },
            { id: 'subjects',      label: 'Subjects' },
          ] as const).map(t => (
            <button
              key={t.id}
              onClick={() => handleTabChange(t.id)}
              className="relative mr-4 py-3 text-xs font-semibold transition-colors"
              style={{
                color: tab === t.id ? '#0f172a' : '#94a3b8',
                borderBottom: tab === t.id ? '2px solid #0f172a' : '2px solid transparent',
              }}
            >
              {t.label}
            </button>
          ))}
        </div>

        {/* ── Tab content ── */}
        <div className="p-5">
          {error && <div className="mb-4 rounded border border-red-200 bg-red-50 px-3 py-2 text-xs font-medium text-red-700">{error}</div>}
          {success && <div className="mb-4 rounded border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs font-medium text-emerald-700">{success}</div>}

          {/* ── General ── */}
          {tab === 'general' && (
            <div className="space-y-8">

              {/* Center Info */}
              <div>
                <p className="mb-4 text-xs font-black uppercase tracking-widest text-slate-800">Center Info</p>
                <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
                  <div>
                    <label className="mb-1 block text-xs font-semibold text-slate-500">Center Name</label>
                    {editing
                      ? <input value={centerName} onChange={e => setCenterName(e.target.value)} className={baseInputCls} placeholder="My Tutoring Center" />
                      : <p className={readonlyInputCls}>{centerName || <span className="text-slate-400">—</span>}</p>
                    }
                    {editing && <p className="mt-1 text-[11px] text-slate-400">Shown in the sidebar and outgoing emails.</p>}
                  </div>
                  <div>
                    <label className="mb-1 block text-xs font-semibold text-slate-500">Short Name / Initials</label>
                    {editing
                      ? <input value={centerShortName} onChange={e => setCenterShortName(e.target.value.slice(0, 3))} maxLength={3} className={baseInputCls} placeholder="TC" />
                      : <p className={readonlyInputCls}>{centerShortName || <span className="text-slate-400">—</span>}</p>
                    }
                    {editing && <p className="mt-1 text-[11px] text-slate-400">Up to 3 chars — used in the nav logo icon.</p>}
                  </div>
                  <div>
                    <label className="mb-1 block text-xs font-semibold text-slate-500">Director Email(s)</label>
                    {editing
                      ? <input value={centerEmail} onChange={e => setCenterEmail(e.target.value)} className={baseInputCls} placeholder="director@yourcenter.com" />
                      : <p className={readonlyInputCls}>{centerEmail || <span className="text-slate-400">—</span>}</p>
                    }
                    {editing && <p className="mt-1 text-[11px] text-slate-400">Separate multiple addresses with commas.</p>}
                  </div>
                  <div>
                    <label className="mb-1 block text-xs font-semibold text-slate-500">Phone Number</label>
                    {editing
                      ? <input value={centerPhone} onChange={e => setCenterPhone(e.target.value)} className={baseInputCls} placeholder="(555) 555-5555" />
                      : <p className={readonlyInputCls}>{centerPhone || <span className="text-slate-400">—</span>}</p>
                    }
                  </div>
                  <div className="md:col-span-2">
                    <label className="mb-1 block text-xs font-semibold text-slate-500">Center Address</label>
                    {editing
                      ? <input value={centerAddress} onChange={e => setCenterAddress(e.target.value)} className={baseInputCls} placeholder="123 Main St, City, State 12345" />
                      : <p className={readonlyInputCls}>{centerAddress || <span className="text-slate-400">—</span>}</p>
                    }
                    {editing && <p className="mt-1 text-[11px] text-slate-400">Shown in email footers.</p>}
                  </div>
                </div>
              </div>

              {/* ── Terms ── */}
              <div className="border-t border-slate-100 pt-6">

                {/* Default Session Times collapsible */}
                <div className="mb-5 rounded border border-slate-200 overflow-hidden">
                  <button
                    onClick={() => setDefaultOpen(o => !o)}
                    className="flex w-full items-center justify-between px-4 py-3 text-left hover:bg-slate-50"
                  >
                    <div>
                      <p className="text-xs font-black uppercase tracking-widest text-slate-800">Default Session Times</p>
                      <p className="mt-0.5 text-[11px] text-slate-500">Global fallback used when a term has no session times configured.</p>
                    </div>
                    <span className="ml-4 text-slate-400 text-sm">{defaultOpen ? '▲' : '▼'}</span>
                  </button>

                  {defaultOpen && (
                    <div className="border-t border-slate-100 px-4 pb-4 pt-3">
                      <p className="mb-3 text-[11px] text-slate-400">Add session rows for each day. Days with no rows are treated as off.</p>
                      {ALL_DAYS.map(({ dow, label }) => {
                        const slots = globalSessionTimes[dow] ?? []
                        const pending = globalNewTimeByDay[dow] ?? { start: '13:30', end: '' }
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
                                        onChange={e => setGlobalNewTimeByDay(prev => ({ ...prev, [dow]: { ...pending, start: e.target.value } }))}
                                        className="w-full rounded border border-slate-200 bg-white px-2 py-1 text-xs"
                                      />
                                    </td>
                                    <td className="px-3 py-2">
                                      <input type="time" value={pending.end}
                                        onChange={e => setGlobalNewTimeByDay(prev => ({ ...prev, [dow]: { ...pending, end: e.target.value } }))}
                                        className="w-full rounded border border-slate-200 bg-white px-2 py-1 text-xs"
                                      />
                                    </td>
                                    <td className="px-3 py-2">
                                      <button type="button" disabled={!pending.start || !pending.end}
                                        onClick={() => {
                                          if (!pending.start || !pending.end) return
                                          setGlobalSessionTimes(prev => ({ ...prev, [dow]: [...(prev[dow] ?? []), `${pending.start}-${pending.end}`] }))
                                          setGlobalNewTimeByDay(prev => ({ ...prev, [dow]: { start: pending.start, end: '' } }))
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
                      <button onClick={handleSaveGlobalTimes} disabled={globalSaving}
                        className="mt-1 rounded bg-slate-900 px-4 py-2 text-xs font-semibold text-white hover:bg-slate-800 disabled:opacity-50"
                      >
                        {globalSaving ? 'Saving…' : 'Save Default Times'}
                      </button>
                    </div>
                  )}
                </div>

                {/* Academic Terms list */}
                <div className="mb-4 flex items-start justify-between">
                  <div>
                    <p className="text-xs font-black uppercase tracking-widest text-slate-800">Academic Terms</p>
                    <p className="mt-0.5 text-xs text-slate-500">Each term has its own operating hours, session times, and date exceptions.</p>
                  </div>
                  {!termFormOpen && (
                    <div className="flex items-center gap-2">
                      <a
                        href="/?action=build"
                        className="inline-flex items-center gap-1.5 rounded border border-blue-200 bg-blue-50 px-3 py-1.5 text-xs font-semibold text-blue-700 hover:bg-blue-100"
                      >
                        <Zap size={11} />
                        Schedule Builder
                      </a>
                      <button
                        onClick={() => { resetTermDraft(); setTermFormOpen(true) }}
                        className="rounded bg-slate-900 px-3 py-1.5 text-xs font-semibold text-white hover:bg-slate-800"
                      >
                        + New Term
                      </button>
                    </div>
                  )}
                </div>

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
                            <p className="text-slate-500">{term.start_date} to {term.end_date} · {term.status}</p>
                            <p className="text-[11px] text-slate-400">
                              Session Hours: {typeof term.session_hours === 'number' ? term.session_hours : 2}h · Hours: {term.operating_hours ? 'configured' : 'default'} · Times: {term.session_times_by_day ? 'configured' : 'default'}
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
                      )
                    })
                  )}
                </div>

                {/* Term add/edit form */}
                {termFormOpen && (
                  <div className="mt-4 rounded border border-slate-200 bg-white p-4">
                    <p className="mb-3 text-xs font-bold text-slate-700">{termDraft.id ? 'Edit Term' : 'New Term'}</p>

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
                      <p className="mb-1 text-xs font-black uppercase tracking-widest text-slate-800">Session Times by Day</p>
                      <p className="mb-3 text-[11px] text-slate-400">Set the specific time slots for each open day.</p>
                      {ALL_DAYS.map(({ dow, label }) => {
                        const oh = termDraft.operating_hours[dow]
                        if (oh?.closed) return null
                        const slots = termDraft.session_times_by_day[dow] ?? []
                        const pending = newTimeByDay[dow] ?? { start: oh?.open ?? '13:30', end: '' }
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

                    {/* Special Days */}
                    <div className="mt-5 border-t border-slate-100 pt-4">
                      <p className="mb-3 text-xs font-black uppercase tracking-widest text-slate-800">Special Days / Holidays</p>
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
                                date_exceptions: [...prev.date_exceptions, { date: newExceptionDate, closed: newExceptionClosed, ...(newExceptionLabel.trim() ? { label: newExceptionLabel.trim() } : {}) }],
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

                    <div className="mt-4 flex gap-2">
                      <button onClick={handleSaveTerm} disabled={termSaving}
                        className="rounded bg-slate-900 px-4 py-2 text-xs font-semibold text-white hover:bg-slate-800 disabled:opacity-50"
                      >
                        {termSaving ? 'Saving…' : (termDraft.id ? 'Update Term' : 'Save Term')}
                      </button>
                      <button onClick={resetTermDraft} className="rounded border border-slate-200 bg-white px-4 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50">
                        Cancel
                      </button>
                    </div>
                  </div>
                )}
              </div>
            </div>
          )}

          {/* ── Notifications ── */}
          {tab === 'notifications' && (
            <div className="space-y-6">

              {/* Reminder Send Time */}
              <div>
                <p className="mb-1 text-xs font-black uppercase tracking-widest text-slate-800">Reminder Send Time</p>
                <p className="mb-4 text-[11px] text-slate-500">
                  Reminders are sent automatically every day at this time, for all sessions scheduled that day.
                </p>

                {cronConfigured === false && (
                  <div className="rounded border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-700">
                    Automatic reminders aren't connected yet. Ask your developer to configure <code className="rounded bg-amber-100 px-1">CRONJOB_ORG_API_KEY</code> and <code className="rounded bg-amber-100 px-1">CRONJOB_ORG_JOB_ID</code>.
                  </div>
                )}

                {cronLoading && cronConfigured === null && (
                  <div className="flex items-center gap-2 text-xs text-slate-400">
                    <Loader2 size={12} className="animate-spin" /> Checking reminder status…
                  </div>
                )}

                {cronConfigured && cronJob && (
                  <div className="space-y-4">
                    {/* On/off toggle */}
                    <div className="flex items-center gap-3">
                      <span className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] font-semibold ${cronJob.enabled ? 'bg-emerald-50 text-emerald-700' : 'bg-slate-100 text-slate-500'}`}>
                        <span className={`h-1.5 w-1.5 rounded-full ${cronJob.enabled ? 'bg-emerald-500' : 'bg-slate-400'}`} />
                        {cronJob.enabled ? 'Reminders on' : 'Reminders off'}
                      </span>
                      <button
                        onClick={toggleCronEnabled}
                        disabled={cronSaving}
                        className="rounded border border-slate-200 bg-white px-3 py-1 text-xs font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-50"
                      >
                        {cronSaving ? 'Saving…' : cronJob.enabled ? 'Turn off' : 'Turn on'}
                      </button>
                    </div>

                    {/* Time picker */}
                    <div className="flex items-end gap-3">
                      <div>
                        <label className="mb-1 block text-xs font-semibold text-slate-600">Send reminders at</label>
                        <input
                          type="time"
                          value={reminderTime}
                          onChange={e => setReminderTime(e.target.value)}
                          className="rounded border border-slate-200 px-3 py-2 text-sm text-slate-800 focus:border-slate-400 outline-none"
                        />
                        <p className="mt-1 text-[11px] text-slate-400">Timezone: {cronJob.schedule?.timezone || Intl.DateTimeFormat().resolvedOptions().timeZone || DEFAULT_REMINDER_TIMEZONE}</p>
                      </div>
                      <button
                        onClick={saveReminderTime}
                        disabled={cronSaving}
                        className="mb-5 flex items-center gap-1.5 rounded bg-slate-900 px-3 py-2 text-xs font-semibold text-white hover:bg-slate-700 disabled:opacity-50"
                      >
                        <Save size={11} />
                        {cronSaving ? 'Saving…' : 'Save'}
                      </button>
                    </div>

                    {cronJob.nextExecution > 0 && (
                      <p className="text-[11px] text-slate-400">
                        Next send: {new Date(cronJob.nextExecution * 1000).toLocaleString(undefined, { timeZone: cronJob.schedule?.timezone || Intl.DateTimeFormat().resolvedOptions().timeZone || DEFAULT_REMINDER_TIMEZONE })}
                      </p>
                    )}

                    {cronHistory.length > 0 && (
                      <div>
                        <p className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-slate-400">Recent sends</p>
                        <div className="overflow-hidden rounded border border-slate-100">
                          {cronHistory.map((h, i) => (
                            <div key={i} className="flex items-center gap-3 border-b border-slate-50 px-3 py-1.5 last:border-0 text-xs">
                              <span className={`w-12 shrink-0 rounded-full px-2 py-0.5 text-center font-semibold ${h.status === 1 ? 'bg-emerald-50 text-emerald-700' : 'bg-red-50 text-red-600'}`}>
                                {h.status === 1 ? 'Sent' : 'Failed'}
                              </span>
                              <span className="text-slate-500">{new Date(h.date * 1000).toLocaleString()}</span>
                              <span className="ml-auto text-slate-400">{h.duration}ms</span>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                )}
              </div>

              {/* Email Template */}
              <div className="border-t border-slate-100 pt-5">
                <p className="mb-3 text-xs font-black uppercase tracking-widest text-slate-800">Email Template</p>
                <p className="mb-3 text-[11px] text-slate-500">
                  Variables: <code className="rounded bg-slate-100 px-1 text-slate-700">{'{{name}}'}</code> <code className="rounded bg-slate-100 px-1 text-slate-700">{'{{date}}'}</code> <code className="rounded bg-slate-100 px-1 text-slate-700">{'{{time}}'}</code>
                </p>
                <div className="space-y-3">
                  <div>
                    <label className="mb-1 block text-xs font-semibold text-slate-600">Subject</label>
                    <input value={subject} onChange={e => setSubject(e.target.value)} className={baseInputCls} />
                  </div>
                  <div>
                    <label className="mb-1 block text-xs font-semibold text-slate-600">Body</label>
                    <textarea value={body} onChange={e => setBody(e.target.value)} rows={5} className={baseInputCls + ' resize-y'} />
                  </div>
                  <button onClick={handleSave} disabled={saving}
                    className="inline-flex items-center gap-1.5 rounded bg-slate-900 px-3 py-1.5 text-xs font-semibold text-white hover:bg-slate-800 disabled:opacity-50"
                  >
                    {saving ? <Loader2 size={12} className="animate-spin" /> : <Save size={12} />}
                    Save Template
                  </button>
                </div>
              </div>
            </div>
          )}

          {/* ── Portals ── */}
          {tab === 'portals' && (
            <div className="space-y-5">
              <div>
                <p className="mb-3 text-xs font-black uppercase tracking-widest text-slate-800">Scheduling</p>
                <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
                  <div>
                    <label className="mb-1 block text-xs font-semibold text-slate-600">Default Session Duration (min)</label>
                    <input type="number" min={30} max={240} step={5} value={sessionDurationMinutes}
                      onChange={e => setSessionDurationMinutes(Number(e.target.value))}
                      className={baseInputCls}
                    />
                    <p className="mt-1 text-[11px] text-slate-400">Used as the default when creating new sessions (30–240 min).</p>
                  </div>
                </div>
              </div>
              <div>
                <p className="mb-3 text-xs font-black uppercase tracking-widest text-slate-800">Portal Messages</p>
                <div className="space-y-3">
                  <div>
                    <label className="mb-1 block text-xs font-semibold text-slate-600">Enrollment Form Instructions</label>
                    <textarea value={enrollmentInstructions} onChange={e => setEnrollmentInstructions(e.target.value)} rows={3} className={baseInputCls + ' resize-y'} placeholder="Instructions shown at the top of the enrollment form sent to families." />
                  </div>
                  <div>
                    <label className="mb-1 block text-xs font-semibold text-slate-600">Tutor Portal Welcome Message</label>
                    <textarea value={tutorPortalMessage} onChange={e => setTutorPortalMessage(e.target.value)} rows={3} className={baseInputCls + ' resize-y'} placeholder="Message displayed at the top of the tutor availability portal." />
                  </div>
                  <button onClick={handleSave} disabled={saving}
                    className="inline-flex items-center gap-1.5 rounded bg-slate-900 px-3 py-1.5 text-xs font-semibold text-white hover:bg-slate-800 disabled:opacity-50"
                  >
                    {saving ? <Loader2 size={12} className="animate-spin" /> : <Save size={12} />}
                    Save
                  </button>
                </div>
              </div>
            </div>
          )}

          {/* ── Subjects ── */}
          {tab === 'subjects' && (
            <div className="space-y-5">
              <div className="flex items-center justify-between">
                <p className="text-xs font-black uppercase tracking-widest text-slate-800">Subjects</p>
                <button onClick={handleSaveSubjects} disabled={subjectsSaving}
                  className="flex items-center gap-1.5 rounded px-3 py-1.5 text-xs font-semibold text-white transition-opacity disabled:opacity-50"
                  style={{ background: '#0f172a' }}
                >
                  {subjectsSaving ? <Loader2 size={11} className="animate-spin" /> : <Save size={11} />}
                  Save
                </button>
              </div>
              <p className="text-xs text-slate-500">These subjects appear in student and tutor profiles. Changes apply to new bookings.</p>
              {subjectsLoading ? (
                <div className="flex items-center gap-2 text-xs text-slate-400"><Loader2 size={13} className="animate-spin" />Loading…</div>
              ) : (
                <>
                  <div className="flex flex-wrap gap-2">
                    {centerSubjects.map(s => (
                      <span key={s} className="flex items-center gap-1.5 rounded-lg border px-2.5 py-1 text-xs font-semibold" style={{ background: '#f8fafc', borderColor: '#e2e8f0', color: '#0f172a' }}>
                        {s}
                        <button type="button" onClick={() => handleRemoveSubject(s)} className="ml-0.5 rounded text-slate-400 transition-colors hover:text-red-500">
                          <Trash2 size={11} />
                        </button>
                      </span>
                    ))}
                    {centerSubjects.length === 0 && <p className="text-xs text-slate-400">No subjects yet. Add one below.</p>}
                  </div>
                  <div className="flex items-center gap-2">
                    <input
                      type="text"
                      value={newSubjectInput}
                      onChange={e => setNewSubjectInput(e.target.value)}
                      onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); handleAddSubject() } }}
                      placeholder="New subject…"
                      className={baseInputCls + ' max-w-xs'}
                    />
                    <button type="button" onClick={handleAddSubject} disabled={!newSubjectInput.trim()}
                      className="flex items-center gap-1.5 rounded px-3 py-2 text-xs font-semibold text-white disabled:opacity-40"
                      style={{ background: '#6d28d9' }}
                    >
                      <Plus size={12} /> Add
                    </button>
                  </div>
                </>
              )}
            </div>
          )}

        </div>
      </div>
    </div>
  )
}