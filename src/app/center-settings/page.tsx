'use client'

import { useEffect, useMemo, useState } from 'react'
import { Loader2, Plus, Save, Settings, Trash2, Zap } from 'lucide-react'
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
}

type TermRow = {
  id: string
  name: string
  start_date: string
  end_date: string
  status: string
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

const TIME_OPTIONS: string[] = []
for (let h = 7; h <= 22; h++) {
  TIME_OPTIONS.push(`${String(h).padStart(2, '0')}:00`)
  if (h < 22) TIME_OPTIONS.push(`${String(h).padStart(2, '0')}:30`)
}

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
    date_exceptions: [],
  })
  // per-day pending add-row state
  const [newTimeByDay, setNewTimeByDay] = useState<Record<string, { start: string; end: string }>>({})
  // which day's "apply to" popover is open
  const [applyPopover, setApplyPopover] = useState<string | null>(null)
  // whether the term add/edit form is visible
  const [termFormOpen, setTermFormOpen] = useState(false)
  const [newExceptionDate, setNewExceptionDate] = useState('')
  const [newExceptionLabel, setNewExceptionLabel] = useState('')
  const [newExceptionClosed, setNewExceptionClosed] = useState(true)

  const [tab, setTab] = useState<'general' | 'terms' | 'notifications' | 'portals' | 'subjects'>('general')
  const [centerSubjects, setCenterSubjects] = useState<string[]>([])
  const [subjectsLoading, setSubjectsLoading] = useState(true)
  const [subjectsSaving, setSubjectsSaving] = useState(false)
  const [newSubjectInput, setNewSubjectInput] = useState('')
  const baseInputCls = 'w-full rounded border border-slate-200 bg-white px-3 py-2 text-sm text-slate-800 outline-none focus:border-slate-400 focus:ring-2 focus:ring-slate-100'

  const isDirty = useMemo(() => {
    const current = JSON.stringify({ centerName, centerShortName, centerEmail, centerPhone, centerAddress, leadHours, subject, body, enrollmentInstructions, tutorPortalMessage, sessionDurationMinutes })
    return initialSnapshot ? current !== initialSnapshot : false
  }, [centerName, centerShortName, centerEmail, centerPhone, centerAddress, leadHours, subject, body, enrollmentInstructions, tutorPortalMessage, sessionDurationMinutes, initialSnapshot])

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
          setCenterShortName(inserted.center_short_name ?? DEFAULTS.center_short_name)
          setCenterEmail(inserted.center_email ?? '')
          setCenterPhone(inserted.center_phone ?? '')
          setCenterAddress(inserted.center_address ?? '')
          setLeadHours(inserted.reminder_lead_time_hours ?? DEFAULTS.reminder_lead_time_hours)
          setSubject(inserted.reminder_subject ?? DEFAULTS.reminder_subject)
          setBody(inserted.reminder_body ?? DEFAULTS.reminder_body)
          setEnrollmentInstructions(inserted.enrollment_instructions ?? '')
          setTutorPortalMessage(inserted.tutor_portal_message ?? '')
          setSessionDurationMinutes(inserted.session_duration_minutes ?? DEFAULTS.session_duration_minutes)
          setInitialSnapshot(JSON.stringify({
            centerName: inserted.center_name ?? DEFAULTS.center_name,
            centerShortName: inserted.center_short_name ?? DEFAULTS.center_short_name,
            centerEmail: inserted.center_email ?? '',
            centerPhone: inserted.center_phone ?? '',
            centerAddress: inserted.center_address ?? '',
            leadHours: inserted.reminder_lead_time_hours ?? DEFAULTS.reminder_lead_time_hours,
            subject: inserted.reminder_subject ?? DEFAULTS.reminder_subject,
            body: inserted.reminder_body ?? DEFAULTS.reminder_body,
            enrollmentInstructions: inserted.enrollment_instructions ?? '',
            tutorPortalMessage: inserted.tutor_portal_message ?? '',
            sessionDurationMinutes: inserted.session_duration_minutes ?? DEFAULTS.session_duration_minutes,
          }))
        } else {
          const row = data as CenterSettingsRow
          if (cancelled) return

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

  useEffect(() => {
    let cancelled = false
    const loadSubjects = async () => {
      setSubjectsLoading(true)
      try {
        const res = await fetch('/api/center-subjects')
        const payload = await res.json()
        if (!cancelled) setCenterSubjects(Array.isArray(payload?.subjects) ? payload.subjects : [])
      } catch {
        // keep empty, user can add
      } finally {
        if (!cancelled) setSubjectsLoading(false)
      }
    }
    loadSubjects()
    return () => { cancelled = true }
  }, [])

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

  const handleRemoveSubject = (subject: string) => {
    setCenterSubjects(prev => prev.filter(s => s !== subject))
  }

  const handleSave = async () => {
    if (!rowId) return

    setSaving(true)
    setError(null)
    setSuccess(null)

    // Columns added by 20260512_extend_center_settings.sql — guarded so save
    // still works before the migration is run in Supabase.
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

    const basePayload = {
      center_name: extendedPayload.center_name,
      center_email: extendedPayload.center_email,
      reminder_lead_time_hours: extendedPayload.reminder_lead_time_hours,
      reminder_subject: extendedPayload.reminder_subject,
      reminder_body: extendedPayload.reminder_body,
    }

    try {
      let { error: updateErr } = await withCenter(
        supabase.from(DB.centerSettings).update(extendedPayload)
      ).eq('id', rowId)

      // If migration hasn't been run yet, fall back to base columns only
      if (updateErr?.message?.includes('schema cache')) {
        const fallback = await withCenter(
          supabase.from(DB.centerSettings).update(basePayload)
        ).eq('id', rowId)
        updateErr = fallback.error
      }

      if (updateErr) throw updateErr

      setSuccess('Settings saved.')
      setInitialSnapshot(JSON.stringify({ centerName, centerShortName, centerEmail, centerPhone, centerAddress, leadHours, subject, body, enrollmentInstructions, tutorPortalMessage, sessionDurationMinutes }))
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
      date_exceptions: [],
    })
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
      if (t.id === termDraft.id) return false // allow editing own dates
      return termDraft.start_date <= t.end_date && termDraft.end_date >= t.start_date
    })
    if (overlap) {
      setError(`Date range overlaps with existing term "${overlap.name}" (${overlap.start_date} – ${overlap.end_date}).`)
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
      operating_hours: (term.operating_hours ?? DEFAULT_OPERATING_HOURS) as Record<string, { open: string; close: string; closed: boolean }>,
      session_times_by_day: term.session_times_by_day ?? DEFAULT_SESSION_TIMES_BY_DAY,
      date_exceptions: Array.isArray(term.date_exceptions) ? term.date_exceptions : [],
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
      <div className="mx-auto w-full max-w-4xl rounded-2xl border border-slate-200 bg-white shadow-sm">

        {/* ── Header ─────────────────────────────────────────────────── */}
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
          {isDirty && (
            <button
              onClick={handleSave}
              disabled={saving}
              className="inline-flex items-center gap-1.5 rounded bg-slate-900 px-3 py-1.5 text-xs font-semibold text-white hover:bg-slate-800 disabled:opacity-50"
            >
              {saving ? <Loader2 size={12} className="animate-spin" /> : <Save size={12} />}
              Save
            </button>
          )}
        </div>

        {/* ── Tab bar ────────────────────────────────────────────────── */}
        <div className="flex border-b border-slate-100 px-5">
          {([
            { id: 'general',       label: 'General' },
            { id: 'terms',         label: 'Terms' },
            { id: 'notifications', label: 'Notifications' },
            { id: 'portals',       label: 'Portals' },
            { id: 'subjects',      label: 'Subjects' },
          ] as const).map(t => (
            <button
              key={t.id}
              onClick={() => setTab(t.id)}
              className="relative mr-4 py-3 text-xs font-semibold transition-colors"
              style={{ color: tab === t.id ? '#0f172a' : '#94a3b8', borderBottom: tab === t.id ? '2px solid #0f172a' : '2px solid transparent' }}
            >
              {t.label}
            </button>
          ))}
        </div>

        {/* ── Tab content ────────────────────────────────────────────── */}
        <div className="p-5">
          {error && <div className="mb-4 rounded border border-red-200 bg-red-50 px-3 py-2 text-xs font-medium text-red-700">{error}</div>}
          {success && <div className="mb-4 rounded border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs font-medium text-emerald-700">{success}</div>}

          {/* ── General ── */}
          {tab === 'general' && (
            <div className="space-y-4">
              <div>
                <p className="mb-4 text-xs font-black uppercase tracking-widest text-slate-800">Center Info</p>
                <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
                  <div>
                    <label className="mb-1 block text-xs font-semibold text-slate-600">Center Name</label>
                    <input value={centerName} onChange={e => setCenterName(e.target.value)} className={baseInputCls} placeholder="My Tutoring Center" />
                    <p className="mt-1 text-[11px] text-slate-400">Shown in the sidebar and outgoing emails.</p>
                  </div>
                  <div>
                    <label className="mb-1 block text-xs font-semibold text-slate-600">Short Name / Initials</label>
                    <input
                      value={centerShortName}
                      onChange={e => setCenterShortName(e.target.value.slice(0, 3))}
                      maxLength={3}
                      className={baseInputCls}
                      placeholder="TC"
                    />
                    <p className="mt-1 text-[11px] text-slate-400">Up to 3 chars — used in the nav logo icon.</p>
                  </div>
                  <div>
                    <label className="mb-1 block text-xs font-semibold text-slate-600">Director Email(s)</label>
                    <input value={centerEmail} onChange={e => setCenterEmail(e.target.value)} className={baseInputCls} placeholder="director@yourcenter.com" />
                    <p className="mt-1 text-[11px] text-slate-400">Separate multiple addresses with commas.</p>
                  </div>
                  <div>
                    <label className="mb-1 block text-xs font-semibold text-slate-600">Phone Number</label>
                    <input value={centerPhone} onChange={e => setCenterPhone(e.target.value)} className={baseInputCls} placeholder="(555) 555-5555" />
                  </div>
                  <div className="md:col-span-2">
                    <label className="mb-1 block text-xs font-semibold text-slate-600">Center Address</label>
                    <input value={centerAddress} onChange={e => setCenterAddress(e.target.value)} className={baseInputCls} placeholder="123 Main St, City, State 12345" />
                    <p className="mt-1 text-[11px] text-slate-400">Shown in email footers.</p>
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* ── Terms ── */}
          {tab === 'terms' && (
            <div>
              <div className="mb-4 flex items-start justify-between">
                <div>
                  <p className="text-xs font-black uppercase tracking-widest text-slate-800">Academic Terms</p>
                  <p className="mt-0.5 text-xs text-slate-500">Each term has its own operating hours and session time slots.</p>
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
                          <p className="text-slate-500">{term.start_date} to {term.end_date} · {term.status}</p>
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
                                <p className="mb-1.5 text-[10px] font-bold uppercase tracking-widest text-slate-500">Session Slots</p>
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
                                      <span className="text-xs text-slate-400">→</span>
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
                                  <span className="text-xs text-slate-400">→</span>
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

                  {/* ── Special Days / Holidays ── */}
                  <div className="mt-5 border-t border-slate-100 pt-4">
                    <p className="mb-3 text-xs font-black uppercase tracking-widest text-slate-800">Special Days / Holidays</p>
                    <p className="mb-3 text-[11px] text-slate-400">Mark individual dates as closed or with a custom note.</p>

                    {/* Existing exceptions */}
                    {termDraft.date_exceptions.length > 0 && (
                      <div className="mb-3 space-y-1.5">
                        {termDraft.date_exceptions
                          .slice()
                          .sort((a, b) => a.date.localeCompare(b.date))
                          .map(ex => (
                            <div key={ex.date} className="flex items-center justify-between rounded-lg border border-slate-100 bg-slate-50 px-3 py-2 text-xs">
                              <div className="flex items-center gap-2">
                                <span className={`rounded px-1.5 py-0.5 text-[10px] font-bold ${ex.closed ? 'bg-red-100 text-red-700' : 'bg-amber-100 text-amber-700'}`}>
                                  {ex.closed ? 'Closed' : 'Special'}
                                </span>
                                <span className="font-semibold text-slate-700">{ex.date}</span>
                                {ex.label && <span className="text-slate-500">{ex.label}</span>}
                              </div>
                              <button
                                type="button"
                                onClick={() => setTermDraft(prev => ({ ...prev, date_exceptions: prev.date_exceptions.filter(e => e.date !== ex.date) }))}
                                className="text-slate-300 hover:text-red-500"
                              >&times;</button>
                            </div>
                          ))}
                      </div>
                    )}

                    {/* Add new exception */}
                    <div className="flex flex-wrap items-end gap-2">
                      <div>
                        <label className="mb-1 block text-[11px] font-semibold text-slate-500">Date</label>
                        <input
                          type="date"
                          value={newExceptionDate}
                          onChange={e => setNewExceptionDate(e.target.value)}
                          className="rounded border border-slate-200 px-2 py-1.5 text-xs"
                        />
                      </div>
                      <div>
                        <label className="mb-1 block text-[11px] font-semibold text-slate-500">Label (optional)</label>
                        <input
                          type="text"
                          value={newExceptionLabel}
                          onChange={e => setNewExceptionLabel(e.target.value)}
                          placeholder="e.g. Memorial Day"
                          className="rounded border border-slate-200 px-2 py-1.5 text-xs w-44"
                        />
                      </div>
                      <div className="flex items-center gap-2 pb-1.5">
                        <button
                          type="button"
                          onClick={() => setNewExceptionClosed(c => !c)}
                          className="rounded px-2.5 py-1.5 text-[11px] font-semibold"
                          style={newExceptionClosed
                            ? { background: '#fee2e2', color: '#b91c1c', border: '1px solid #fca5a5' }
                            : { background: '#fef3c7', color: '#92400e', border: '1px solid #fcd34d' }}
                        >
                          {newExceptionClosed ? 'Closed' : 'Special'}
                        </button>
                        <button
                          type="button"
                          disabled={!newExceptionDate}
                          onClick={() => {
                            if (!newExceptionDate) return
                            if (termDraft.date_exceptions.some(e => e.date === newExceptionDate)) return
                            setTermDraft(prev => ({
                              ...prev,
                              date_exceptions: [
                                ...prev.date_exceptions,
                                { date: newExceptionDate, closed: newExceptionClosed, ...(newExceptionLabel.trim() ? { label: newExceptionLabel.trim() } : {}) },
                              ],
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
          )}

          {/* ── Notifications ── */}
          {tab === 'notifications' && (
            <div className="space-y-5">
              <div>
                <p className="mb-4 text-xs font-black uppercase tracking-widest text-slate-800">Reminder Settings</p>
                <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
                  <div>
                    <label className="mb-1 block text-xs font-semibold text-slate-600">Lead Time (hours)</label>
                    <input
                      type="number"
                      min={1}
                      max={168}
                      value={leadHours}
                      onChange={e => setLeadHours(Number(e.target.value))}
                      className={baseInputCls}
                    />
                    <p className="mt-1 text-[11px] text-slate-400">How many hours before a session reminders are sent (1–168).</p>
                  </div>
                </div>
              </div>

              <div>
                <p className="mb-3 text-xs font-black uppercase tracking-widest text-slate-800">Email Template</p>
                <p className="mb-3 text-[11px] text-slate-500">Variables: <code className="rounded bg-slate-100 px-1 text-slate-700">{'{{name}}'}</code> <code className="rounded bg-slate-100 px-1 text-slate-700">{'{{date}}'}</code> <code className="rounded bg-slate-100 px-1 text-slate-700">{'{{time}}'}</code></p>
                <div className="space-y-3">
                  <div>
                    <label className="mb-1 block text-xs font-semibold text-slate-600">Subject</label>
                    <input value={subject} onChange={e => setSubject(e.target.value)} className={baseInputCls} />
                  </div>
                  <div>
                    <label className="mb-1 block text-xs font-semibold text-slate-600">Body</label>
                    <textarea
                      value={body}
                      onChange={e => setBody(e.target.value)}
                      rows={5}
                      className={baseInputCls + ' resize-y'}
                    />
                  </div>
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
                    <input
                      type="number"
                      min={30}
                      max={240}
                      step={5}
                      value={sessionDurationMinutes}
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
                    <textarea
                      value={enrollmentInstructions}
                      onChange={e => setEnrollmentInstructions(e.target.value)}
                      rows={3}
                      className={baseInputCls + ' resize-y'}
                      placeholder="Instructions shown at the top of the enrollment form sent to families."
                    />
                  </div>
                  <div>
                    <label className="mb-1 block text-xs font-semibold text-slate-600">Tutor Portal Welcome Message</label>
                    <textarea
                      value={tutorPortalMessage}
                      onChange={e => setTutorPortalMessage(e.target.value)}
                      rows={3}
                      className={baseInputCls + ' resize-y'}
                      placeholder="Message displayed at the top of the tutor availability portal."
                    />
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* ── Subjects ── */}
          {tab === 'subjects' && (
            <div className="space-y-5">
              <div className="flex items-center justify-between">
                <p className="text-xs font-black uppercase tracking-widest text-slate-800">Subjects</p>
                <button
                  onClick={handleSaveSubjects}
                  disabled={subjectsSaving}
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
                    {centerSubjects.map(subject => (
                      <span
                        key={subject}
                        className="flex items-center gap-1.5 rounded-lg border px-2.5 py-1 text-xs font-semibold"
                        style={{ background: '#f8fafc', borderColor: '#e2e8f0', color: '#0f172a' }}
                      >
                        {subject}
                        <button
                          type="button"
                          onClick={() => handleRemoveSubject(subject)}
                          className="ml-0.5 rounded text-slate-400 transition-colors hover:text-red-500"
                        >
                          <Trash2 size={11} />
                        </button>
                      </span>
                    ))}
                    {centerSubjects.length === 0 && (
                      <p className="text-xs text-slate-400">No subjects yet. Add one below.</p>
                    )}
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
                    <button
                      type="button"
                      onClick={handleAddSubject}
                      disabled={!newSubjectInput.trim()}
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
