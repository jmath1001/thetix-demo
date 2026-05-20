'use client'

import { useEffect, useMemo, useState } from 'react'
import { Loader2, Pencil, Save, Settings, Trash2, Zap } from 'lucide-react'
import { useRouter, useSearchParams } from 'next/navigation'
import { supabase } from '@/lib/supabaseClient'
import { DB, withCenter, withCenterPayload } from '@/lib/db'
import { logEvent } from '@/lib/analytics'

import { DEFAULTS, DEFAULT_OPERATING_HOURS, DEFAULT_SESSION_TIMES_BY_DAY } from '@/components/center-settings/constants'
import type { CenterSettingsRow, TermDraft, TermRow } from '@/components/center-settings/types'
import { CenterInfoSection } from '@/components/center-settings/CenterInfoSection'
import { DefaultSessionTimesSection } from '@/components/center-settings/DefaultSessionTimesSection'
import { TermForm } from '@/components/center-settings/TermForm'
import { SubjectsTab } from '@/components/center-settings/SubjectsTab'

const TABS = ['general', 'subjects'] as const
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

  // ── Terms ─────────────────────────────────────────────────────────────────
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
  const [termFormOpen, setTermFormOpen] = useState(false)

  // ── Global default session times ──────────────────────────────────────────
  const [globalSessionTimes, setGlobalSessionTimes] = useState<Record<string, string[]>>(DEFAULT_SESSION_TIMES_BY_DAY)
  const [globalSaving, setGlobalSaving] = useState(false)

  // ── Subjects ─────────────────────────────────────────────────────────────
  const [centerSubjects, setCenterSubjects] = useState<string[]>([])
  const [subjectsLoading, setSubjectsLoading] = useState(true)
  const [subjectsSaving, setSubjectsSaving] = useState(false)
  const [newSubjectInput, setNewSubjectInput] = useState('')

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
      logEvent('center_settings_saved', {})
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
        logEvent(termDraft.id ? 'term_updated' : 'term_created', { termName: termDraft.name })
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

    const handleDeleteTerm = async (termId: string) => {
      if (!confirm('Are you sure you want to delete this term? This action cannot be undone.')) return
      setTermSaving(true)
      setError(null)
      try {
        const res = await fetch('/api/terms', {
          method: 'DELETE',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ id: termId }),
        })
        const payload = await res.json().catch(() => ({}))
        if (!res.ok) throw new Error(payload?.error || 'Failed to delete term')
        setTerms(prev => prev.filter(t => t.id !== termId))
        logEvent('term_deleted', { termId })
        setSuccess('Term deleted.')
      } catch (err: any) {
        setError(err?.message ?? 'Failed to delete term')
      } finally {
        setTermSaving(false)
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
    <div className="min-h-screen bg-slate-50 px-4 py-6">
      <div className="mx-auto w-full max-w-4xl overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">

        {/* ── Header ── */}
        <div className="flex items-center justify-between border-b border-slate-100 bg-linear-to-r from-slate-50 to-white px-6 py-4">
          <div className="flex items-center gap-3">
            <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-slate-900 text-white shadow-sm">
              <Settings size={16} />
            </div>
            <div>
              <p className="text-[10px] font-bold uppercase tracking-widest text-indigo-500">Admin</p>
              <h1 className="text-sm font-bold text-slate-900">Center Settings</h1>
            </div>
          </div>
          {tab === 'general' && (
            editing ? (
              <div className="flex items-center gap-2">
                <button
                  onClick={handleCancelEdit}
                  className="rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-slate-600 hover:bg-slate-50 transition-colors"
                >
                  Cancel
                </button>
                <button
                  onClick={handleSave}
                  disabled={saving || !isDirty}
                  className="inline-flex items-center gap-1.5 rounded-lg bg-slate-900 px-3 py-1.5 text-xs font-semibold text-white hover:bg-slate-700 disabled:opacity-50 transition-colors shadow-sm"
                >
                  {saving ? <Loader2 size={12} className="animate-spin" /> : <Save size={12} />}
                  Save
                </button>
              </div>
            ) : (
              <button
                onClick={() => setEditing(true)}
                className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-50 transition-colors shadow-sm"
              >
                <Pencil size={11} />
                Edit
              </button>
            )
          )}
        </div>

        {/* ── Tab bar ── */}
        <div className="flex gap-1 border-b border-slate-100 px-5 pt-1">
          {([
            { id: 'general',   label: 'General' },
            { id: 'subjects',  label: 'Subjects' },
          ] as const).map(t => (
            <button
              key={t.id}
              onClick={() => handleTabChange(t.id)}
              className="relative px-3 py-2.5 text-xs font-semibold transition-all rounded-t"
              style={{
                color: tab === t.id ? '#0f172a' : '#94a3b8',
                borderBottom: tab === t.id ? '2px solid #6366f1' : '2px solid transparent',
                background: tab === t.id ? 'white' : 'transparent',
              }}
            >
              {t.label}
            </button>
          ))}
        </div>

        {/* ── Tab content ── */}
        <div className="p-6">
          {error && (
            <div className="mb-4 flex items-start gap-2 rounded-lg border border-red-200 bg-red-50 px-3 py-2.5 text-xs font-medium text-red-700">
              <span className="mt-px shrink-0">⚠</span>
              <span>{error}</span>
            </div>
          )}
          {success && (
            <div className="mb-4 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2.5 text-xs font-medium text-emerald-700">{success}</div>
          )}

          {/* ── General tab ── */}
          {tab === 'general' && (
            <div className="space-y-8">

              <CenterInfoSection
                editing={editing}
                centerName={centerName} setCenterName={setCenterName}
                centerShortName={centerShortName} setCenterShortName={setCenterShortName}
                centerEmail={centerEmail} setCenterEmail={setCenterEmail}
                centerPhone={centerPhone} setCenterPhone={setCenterPhone}
                centerAddress={centerAddress} setCenterAddress={setCenterAddress}
              />

              {/* ── Terms / Session Times ── */}
              <div className="border-t border-slate-100 pt-6">

                <DefaultSessionTimesSection
                  globalSessionTimes={globalSessionTimes}
                  setGlobalSessionTimes={setGlobalSessionTimes}
                  globalSaving={globalSaving}
                  onSave={handleSaveGlobalTimes}
                />

                {/* Academic Terms */}
                <div className="mb-4 flex items-start justify-between">
                  <div>
                    <p className="text-[11px] font-bold uppercase tracking-widest text-slate-400">Academic Terms</p>
                    <p className="mt-0.5 text-xs text-slate-500">Each term has its own operating hours, session times, and date exceptions.</p>
                  </div>
                  {!termFormOpen && (
                    <div className="flex items-center gap-2">
                      <a href="/?action=build"
                        className="inline-flex items-center gap-1.5 rounded border border-blue-200 bg-blue-50 px-3 py-1.5 text-xs font-semibold text-blue-700 hover:bg-blue-100"
                      >
                        <Zap size={11} />
                        Schedule Builder
                      </a>
                      <button onClick={() => { resetTermDraft(); setTermFormOpen(true) }}
                        className="rounded bg-slate-900 px-3 py-1.5 text-xs font-semibold text-white hover:bg-slate-800"
                      >+ New Term</button>
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
                            <button onClick={() => handleSetCurrentTerm(term.id)}
                              disabled={isActive || activatingTermId === term.id}
                              className="rounded border border-slate-200 bg-white px-2.5 py-1 text-[11px] font-semibold text-slate-700 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50"
                            >
                              {isActive ? 'Current' : (activatingTermId === term.id ? 'Switching...' : 'Set Current')}
                            </button>
                            <button onClick={() => handleEditTerm(term)}
                              className="rounded border border-slate-200 bg-white px-2.5 py-1 text-[11px] font-semibold text-slate-700 hover:bg-slate-50"
                            >Edit</button>
                            <button onClick={() => handleDeleteTerm(term.id)}
                              className="rounded border border-red-200 bg-white px-2.5 py-1 text-[11px] font-semibold text-red-600 hover:bg-red-50"
                            ><Trash2 size={11} /></button>
                          </div>
                        </div>
                      )
                    })
                  )}
                </div>

                {termFormOpen && (
                  <TermForm
                    termDraft={termDraft}
                    setTermDraft={setTermDraft}
                    terms={terms}
                    termSaving={termSaving}
                    onSave={handleSaveTerm}
                    onCancel={resetTermDraft}
                  />
                )}
              </div>
            </div>
          )}

          {/* ── Subjects tab ── */}
          {tab === 'subjects' && (
            <SubjectsTab
              centerSubjects={centerSubjects}
              subjectsLoading={subjectsLoading}
              subjectsSaving={subjectsSaving}
              newSubjectInput={newSubjectInput}
              setNewSubjectInput={setNewSubjectInput}
              onSave={handleSaveSubjects}
              onAdd={handleAddSubject}
              onRemove={handleRemoveSubject}
            />
          )}

        </div>
      </div>
    </div>
  )
}
