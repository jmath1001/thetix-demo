'use client'
import React, { useState, useEffect, useCallback, useMemo } from 'react'
import { supabase } from '@/lib/supabaseClient'
import { DB, withCenter } from '@/lib/db'
import {
  Send, Check, AlertCircle, Edit3, X, ChevronDown, Users,
  Loader2, Eye, AlertTriangle, ChevronRight, Play, Search,
  Mail, Layers,
} from 'lucide-react'
import { logEvent } from '@/lib/analytics'
import { SlotPreferenceSurvey, type SlotPreferences } from '@/components/SlotPreferenceSurvey'
import { formatTime } from '@/components/constants'

// ── Types ──────────────────────────────────────────────────────────────────────

type Term = {
  id: string
  name: string
  start_date: string
  end_date: string
  status: string
  session_times_by_day: Record<string, string[]> | null
}

type BlastRecipient = {
  studentId: string
  studentName: string
  studentEmail: string | null
  momEmail: string | null
  dadEmail: string | null
  notifyStudent: boolean
  notifyMom: boolean
  notifyDad: boolean
}

type SpStudentRow = { id: string; name: string }
type SpEnrollmentRow = { student_id: string; slot_preferences: SlotPreferences | null; subjects: string[] }
type SpSlotAssignment = {
  studentId: string; studentName: string; subject: string
  choiceUsed: 1 | 2 | 3; blocks: string[]; tutorId: string; tutorName: string
}
type SpUnmatchedStudent = { studentId: string; studentName: string; subject: string; reason: string }
type SpProposal = { assignments: SpSlotAssignment[]; unmatched: SpUnmatchedStudent[] }
type SendResult = { sent: number; failed: number; errors: string[]; mode?: string; redirectedTo?: string | null }

// ── Constants ──────────────────────────────────────────────────────────────────

const DOW_LABELS: Record<string, string> = {
  '1': 'Mon', '2': 'Tue', '3': 'Wed', '4': 'Thu', '5': 'Fri', '6': 'Sat', '7': 'Sun',
}
const baseInputCls = 'w-full rounded border border-slate-200 bg-white px-3 py-2 text-sm text-slate-800 outline-none focus:border-slate-400 focus:ring-2 focus:ring-slate-100'
const BRAND = '#0f172a'

// ── Helpers ───────────────────────────────────────────────────────────────────

function parseBlock(b: string): { dow: string; time: string } | null {
  const m = b.match(/^(\d)-([\d:]+)$/)
  return m ? { dow: m[1], time: m[2] } : null
}

function blockLabel(blocks: string[]): string {
  if (blocks.length === 0) return '—'
  const first = parseBlock(blocks[0])
  if (!first) return blocks.join(', ')
  const dayStr = DOW_LABELS[first.dow] ?? `Day ${first.dow}`
  if (blocks.length === 1) return `${dayStr} ${formatTime(first.time)}`
  const last = parseBlock(blocks[blocks.length - 1])
  const endTime = last ? formatTime(last.time) : ''
  return `${dayStr} ${formatTime(first.time)} – ${endTime} (2h)`
}

function choiceBadge(c: 1 | 2 | 3) {
  const map: Record<number, string> = {
    1: 'bg-emerald-100 text-emerald-700 border-emerald-200',
    2: 'bg-amber-100 text-amber-700 border-amber-200',
    3: 'bg-slate-100 text-slate-500 border-slate-200',
  }
  return map[c] ?? map[3]
}

function applyTemplate(template: string, values: Record<string, string>) {
  return template.replace(/{{\s*(name|link|term|center)\s*}}/gi, (_, key: string) => values[key.toLowerCase()] ?? '')
}

function buildAnnouncementHtml(centerName: string, bodyText: string, availabilityLink: string) {
  const safeBody = bodyText.replace(/\n/g, '<br>').trim()
  const linkSection = availabilityLink
    ? `<table cellpadding="0" cellspacing="0" style="margin:24px 0 0;"><tr>
        <td style="border-radius:8px;background:${BRAND};">
          <a href="${availabilityLink}" style="display:inline-block;padding:13px 28px;font-size:14px;font-weight:700;color:white;text-decoration:none;border-radius:8px;">Submit Availability →</a>
        </td>
      </tr></table>
      <p style="margin:14px 0 0;font-size:11px;color:#9ca3af;">If the button doesn't work: <a href="${availabilityLink}" style="color:${BRAND};">${availabilityLink}</a></p>`
    : ''
  return `<!DOCTYPE html><html><head><meta charset="utf-8"></head>
<body style="margin:0;padding:0;background:#f9fafb;font-family:ui-sans-serif,system-ui,sans-serif;">
<table width="100%" cellpadding="0" cellspacing="0" style="background:#f9fafb;padding:32px 16px;">
  <tr><td align="center">
  <table width="100%" cellpadding="0" cellspacing="0" style="max-width:520px;background:white;border-radius:12px;border:1px solid #e5e7eb;overflow:hidden;">
    <tr><td style="background:${BRAND};padding:20px 28px;">
      <p style="margin:0;font-size:18px;font-weight:800;color:white;">${centerName}</p>
      <p style="margin:4px 0 0;font-size:12px;color:rgba(255,255,255,0.75);">Announcement</p>
    </td></tr>
    <tr><td style="padding:28px;">
      <p style="margin:0 0 16px;font-size:15px;color:#111827;line-height:1.65;">${safeBody}</p>
      ${linkSection}
    </td></tr>
    <tr><td style="padding:16px 28px;background:#f9fafb;border-top:1px solid #f3f4f6;">
      <p style="margin:0;font-size:11px;color:#9ca3af;">— ${centerName}</p>
    </td></tr>
  </table>
  </td></tr>
</table>
</body></html>`
}

// ── Inline Components ─────────────────────────────────────────────────────────

function Checkbox({ checked, indeterminate, onChange }: { checked: boolean; indeterminate?: boolean; onChange: () => void }) {
  return (
    <div
      onClick={e => { e.stopPropagation(); onChange() }}
      className="flex h-4 w-4 shrink-0 cursor-pointer items-center justify-center rounded transition-all"
      style={{
        background: checked ? BRAND : indeterminate ? '#e2e8f0' : 'white',
        border: `2px solid ${checked || indeterminate ? BRAND : '#d1d5db'}`,
      }}
    >
      {checked && <Check size={9} color="white" strokeWidth={3} />}
      {indeterminate && !checked && <div className="h-1.5 w-1.5 rounded-sm bg-slate-700" />}
    </div>
  )
}

function EmailList({ student }: { student: BlastRecipient }) {
  const entries = [
    student.studentEmail ? { addr: student.studentEmail, notify: student.notifyStudent } : null,
    student.momEmail     ? { addr: student.momEmail,     notify: student.notifyMom }     : null,
    student.dadEmail     ? { addr: student.dadEmail,     notify: student.notifyDad }     : null,
  ].filter(Boolean) as { addr: string; notify: boolean }[]
  return (
    <>
      {entries.map((x, i) => (
        <span key={i} style={x.notify ? {} : { textDecoration: 'line-through', opacity: 0.5 }}>
          {i > 0 ? ', ' : ''}{x.addr}
        </span>
      ))}
    </>
  )
}

function SendButton({ onClick, loading, confirm, count, disabled, label }: {
  onClick: () => void; loading: boolean; confirm: boolean; count: number; disabled: boolean; label: string
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className="inline-flex items-center gap-1.5 rounded-lg px-4 py-2 text-sm font-semibold text-white disabled:opacity-50 transition-colors"
      style={{ background: confirm ? '#92400e' : BRAND }}
    >
      {loading ? (
        <><Loader2 size={13} className="animate-spin" /> Sending…</>
      ) : confirm ? (
        <><AlertCircle size={13} /> Confirm — {count} recipient{count !== 1 ? 's' : ''}</>
      ) : (
        <><Send size={13} /> {label} ({count})</>
      )}
    </button>
  )
}

function ResultBanner({ sent, failed, errors, mode, redirectedTo }: SendResult) {
  const isSuccess = failed === 0
  return (
    <div className={`flex items-start gap-2 rounded-lg border px-3 py-2.5 text-xs font-semibold ${isSuccess ? 'border-emerald-200 bg-emerald-50 text-emerald-700' : 'border-amber-200 bg-amber-50 text-amber-700'}`}>
      {isSuccess ? <Check size={13} className="mt-0.5 shrink-0" /> : <AlertCircle size={13} className="mt-0.5 shrink-0" />}
      <div className="space-y-0.5">
        {mode === 'redirect' && redirectedTo && <p>Protected mode — redirected to {redirectedTo}.</p>}
        {sent > 0 && <p>{sent} email{sent !== 1 ? 's' : ''} sent successfully.</p>}
        {failed > 0 && <p>{failed} failed.{errors[0] ? ` ${errors[0]}` : ''}</p>}
      </div>
    </div>
  )
}

function LoadingRow({ label }: { label: string }) {
  return (
    <div className="flex items-center gap-2 px-4 py-6 text-slate-400">
      <Loader2 size={13} className="animate-spin" />
      <span className="text-xs">{label}</span>
    </div>
  )
}

function EmptyState({ icon, label }: { icon: React.ReactNode; label: string }) {
  return (
    <div className="flex flex-col items-center justify-center py-10 text-slate-400">
      <div className="mb-2 opacity-40">{icon}</div>
      <p className="text-xs font-medium">{label}</p>
    </div>
  )
}

function StatPill({ icon, label, value, color }: { icon: React.ReactNode; label: string; value: number; color: 'blue' | 'green' | 'amber' | 'gray' }) {
  const map: Record<string, string> = {
    blue:  'bg-blue-50 border-blue-200 text-blue-700',
    green: 'bg-emerald-50 border-emerald-200 text-emerald-700',
    amber: 'bg-amber-50 border-amber-200 text-amber-700',
    gray:  'bg-slate-100 border-slate-200 text-slate-500',
  }
  return (
    <div className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full border text-xs font-semibold ${map[color]}`}>
      {icon}
      {value} {label}
    </div>
  )
}

function ProposalPanel({ proposal, onClose }: { proposal: SpProposal; onClose: () => void }) {
  const { assignments, unmatched } = proposal
  const byBlock: Record<string, SpSlotAssignment[]> = {}
  for (const a of assignments) {
    const key = a.blocks[0] ?? 'unknown'
    ;(byBlock[key] = byBlock[key] ?? []).push(a)
  }
  const sortedKeys = Object.keys(byBlock).sort()
  return (
    <div className="bg-white rounded-xl border border-indigo-200 overflow-hidden shadow-sm">
      <div className="flex items-center justify-between px-4 py-3 bg-indigo-50 border-b border-indigo-200">
        <div className="flex items-center gap-2">
          <Play className="w-4 h-4 text-indigo-600" />
          <span className="text-sm font-bold text-indigo-900">Scheduler Proposal</span>
          <span className="text-xs bg-indigo-100 text-indigo-700 px-2 py-0.5 rounded-full font-semibold">
            {assignments.length} placed · {unmatched.length} unmatched
          </span>
        </div>
        <button onClick={onClose} className="p-1 rounded hover:bg-indigo-100 text-indigo-400">
          <X className="w-4 h-4" />
        </button>
      </div>
      <div className="p-4 space-y-4">
        {sortedKeys.length > 0 && (
          <div>
            <p className="text-xs font-bold text-slate-500 uppercase tracking-wide mb-2">Placed</p>
            <div className="space-y-2">
              {sortedKeys.map(blockKey => {
                const parsed = parseBlock(blockKey)
                const slotLabel = parsed
                  ? `${DOW_LABELS[parsed.dow] ?? `Day ${parsed.dow}`} ${formatTime(parsed.time)}`
                  : blockKey
                return (
                  <div key={blockKey} className="rounded-lg border border-slate-200 overflow-hidden">
                    <div className="bg-slate-50 px-3 py-1.5 text-xs font-bold text-slate-700 border-b border-slate-200">
                      {slotLabel}
                    </div>
                    <ul className="divide-y divide-slate-100">
                      {byBlock[blockKey].map((a, i) => (
                        <li key={i} className="flex items-center gap-2 px-3 py-2 text-xs">
                          <span className={`px-1.5 py-0.5 rounded border text-[10px] font-bold ${choiceBadge(a.choiceUsed)}`}>
                            C{a.choiceUsed}
                          </span>
                          <span className="font-semibold text-slate-800">{a.studentName}</span>
                          {a.subject && <span className="text-slate-400">· {a.subject}</span>}
                          <span className="ml-auto text-slate-500">{a.tutorName}</span>
                          {a.blocks.length === 2 && <span className="text-indigo-600 font-semibold">2h</span>}
                        </li>
                      ))}
                    </ul>
                  </div>
                )
              })}
            </div>
          </div>
        )}
        {unmatched.length > 0 && (
          <div>
            <p className="text-xs font-bold text-slate-500 uppercase tracking-wide mb-2">Unmatched</p>
            <ul className="space-y-1">
              {unmatched.map((u, i) => (
                <li key={i} className="flex items-start gap-2 rounded-lg border border-red-100 bg-red-50 px-3 py-2 text-xs">
                  <AlertTriangle className="w-3 h-3 mt-0.5 text-red-400 shrink-0" />
                  <div>
                    <span className="font-semibold text-red-800">{u.studentName}</span>
                    {u.subject && <span className="text-red-500 ml-1">· {u.subject}</span>}
                    <p className="text-red-500 mt-0.5">{u.reason}</p>
                  </div>
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>
    </div>
  )
}

function PreviewModal({ modal, onClose }: {
  modal: { title: string; subject: string; html: string; url?: string; note?: string }
  onClose: () => void
}) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50">
      <div className="bg-white rounded-2xl shadow-2xl flex flex-col overflow-hidden w-160 max-h-[90vh]">
        <div className="flex items-center justify-between px-5 py-4 border-b border-slate-200">
          <div>
            <h3 className="text-sm font-bold text-slate-900">{modal.title}</h3>
            {modal.note && <p className="text-xs text-slate-500 mt-0.5">{modal.note}</p>}
          </div>
          <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-slate-100 text-slate-400">
            <X className="w-4 h-4" />
          </button>
        </div>
        {modal.subject && (
          <div className="px-5 py-2.5 bg-slate-50 border-b border-slate-100">
            <p className="text-xs font-semibold text-slate-500">
              Subject: <span className="text-slate-800 font-normal">{modal.subject}</span>
            </p>
          </div>
        )}
        <div className="flex-1 overflow-hidden">
          {modal.url ? (
            <iframe src={modal.url} className="w-full h-full border-0" style={{ minHeight: 500 }} />
          ) : (
            <iframe
              srcDoc={modal.html}
              className="w-full h-full border-0"
              style={{ minHeight: 500 }}
              sandbox="allow-same-origin"
            />
          )}
        </div>
      </div>
    </div>
  )
}

// ── Page ──────────────────────────────────────────────────────────────────────

export default function ScheduleBuilderPage() {
  // Term + center
  const [terms, setTerms] = useState<Term[]>([])
  const [termId, setTermId] = useState('')
  const [centerName, setCenterName] = useState('Tutoring Center')

  // Blast
  const [blastSubject, setBlastSubject] = useState('')
  const [blastBody, setBlastBody] = useState('')
  const [blastRecipients, setBlastRecipients] = useState<BlastRecipient[]>([])
  const [blastSelected, setBlastSelected] = useState<Set<string>>(new Set())
  const [loadingRecipients, setLoadingRecipients] = useState(false)
  const [blastSending, setBlastSending] = useState(false)
  const [blastConfirm, setBlastConfirm] = useState(false)
  const [blastResult, setBlastResult] = useState<SendResult | null>(null)
  const [editingTemplate, setEditingTemplate] = useState(false)

  // Submissions
  const [spStudents, setSpStudents] = useState<SpStudentRow[]>([])
  const [spEnrollments, setSpEnrollments] = useState<SpEnrollmentRow[]>([])
  const [spLoading, setSpLoading] = useState(false)
  const [spSearch, setSpSearch] = useState('')
  const [spOpenStudentId, setSpOpenStudentId] = useState<string | null>(null)

  // Build
  const [spProposal, setSpProposal] = useState<SpProposal | null>(null)
  const [spRunning, setSpRunning] = useState(false)
  const [spRunError, setSpRunError] = useState<string | null>(null)

  // UI
  const [activeTab, setActiveTab] = useState<'blast' | 'submissions' | 'build'>('blast')
  const [previewModal, setPreviewModal] = useState<{
    title: string; subject: string; html: string; url?: string; note?: string
  } | null>(null)

  // ── Derived ──────────────────────────────────────────────────────────────────

  const selectedTerm = useMemo(() => terms.find(t => t.id === termId) ?? null, [terms, termId])
  const sessionTimesByDay = useMemo(() => selectedTerm?.session_times_by_day ?? {}, [selectedTerm])

  const blastLinkPreview = typeof window !== 'undefined'
    ? `${window.location.origin}/enroll?token=preview-token`
    : 'https://example.com/enroll?token=preview-token'

  const blastAllChecked = blastRecipients.length > 0 && blastSelected.size === blastRecipients.length
  const blastSomeChecked = blastSelected.size > 0 && blastSelected.size < blastRecipients.length

  const enrollmentMap = useMemo(() => {
    const m: Record<string, SpEnrollmentRow> = {}
    for (const e of spEnrollments) m[e.student_id] = e
    return m
  }, [spEnrollments])

  const enrolledStudents = useMemo(
    () => spStudents.filter(s => enrollmentMap[s.id] !== undefined),
    [spStudents, enrollmentMap]
  )

  const filteredStudents = useMemo(() => {
    const q = spSearch.toLowerCase()
    return q ? enrolledStudents.filter(s => s.name.toLowerCase().includes(q)) : enrolledStudents
  }, [enrolledStudents, spSearch])

  const prefCount = useMemo(
    () => enrolledStudents.filter(s => (enrollmentMap[s.id]?.slot_preferences?.length ?? 0) > 0).length,
    [enrolledStudents, enrollmentMap]
  )

  // ── Data fetching ─────────────────────────────────────────────────────────────

  const fetchTerms = useCallback(async () => {
    try {
      const res = await fetch('/api/terms')
      const payload = await res.json()
      const rows: Term[] = Array.isArray(payload?.terms) ? payload.terms : []
      setTerms(rows)
      const preferred = rows.find(t => t.status === 'active') ?? rows[0] ?? null
      if (preferred) {
        setTermId(preferred.id)
        setBlastSubject(`Availability Is Now Open for {{term}} \u2013 Submit Your Preferences`)
        setBlastBody(`Hi {{name}},\n\nWe\u2019re now collecting availability for {{term}}. Please use the link below to submit your preferred schedule.\n\n{{link}}\n\nThank you,\n{{center}}`)
      }
    } catch (e) {
      console.error('fetchTerms', e)
    }
  }, [])

  const fetchSettings = useCallback(async () => {
    const { data } = await withCenter(
      supabase.from(DB.centerSettings).select('center_name').limit(1)
    ).maybeSingle()
    if (data?.center_name) setCenterName(data.center_name)
  }, [])

  const fetchRecipients = useCallback(async () => {
    setLoadingRecipients(true)
    try {
      const { data, error } = await withCenter(
        supabase
          .from(DB.students)
          .select('id, name, email, mom_email, dad_email, notify_student, notify_mom, notify_dad')
      ).order('name', { ascending: true })
      if (error) throw error
      const recipients: BlastRecipient[] = (data ?? [])
        .map((s: any) => ({
          studentId: s.id,
          studentName: s.name ?? '\u2014',
          studentEmail: s.email ?? null,
          momEmail: s.mom_email ?? null,
          dadEmail: s.dad_email ?? null,
          notifyStudent: s.notify_student ?? true,
          notifyMom: s.notify_mom ?? true,
          notifyDad: s.notify_dad ?? true,
        }))
        .filter((r: BlastRecipient) => r.studentEmail || r.momEmail || r.dadEmail)
      setBlastRecipients(recipients)
      const activeIds = recipients
        .filter(r =>
          (r.studentEmail && r.notifyStudent) ||
          (r.momEmail && r.notifyMom) ||
          (r.dadEmail && r.notifyDad)
        )
        .map(r => r.studentId)
      setBlastSelected(new Set(activeIds))
    } catch (e) {
      console.error('fetchRecipients', e)
    }
    setLoadingRecipients(false)
  }, [])

  // Load sp data whenever term changes
  useEffect(() => {
    if (!termId) return
    setSpLoading(true)
    setSpProposal(null)
    Promise.all([
      withCenter(
        supabase.from(DB.students).select('id, name').order('name', { ascending: true })
      ).then(({ data }) => data ?? []),
      withCenter(
        supabase
          .from(DB.termEnrollments)
          .select('student_id, slot_preferences, subjects')
          .eq('term_id', termId)
      ).then(({ data }) => data ?? []),
    ])
      .then(([students, enrollments]) => {
        setSpStudents(students as SpStudentRow[])
        setSpEnrollments(enrollments as SpEnrollmentRow[])
        setSpLoading(false)
      })
      .catch(e => {
        console.error('sp data fetch', e)
        setSpLoading(false)
      })
  }, [termId])

  useEffect(() => {
    fetchTerms()
    fetchSettings()
    fetchRecipients()
  }, [fetchTerms, fetchSettings, fetchRecipients])

  // ── Actions ───────────────────────────────────────────────────────────────────

  const handleBlastSend = async () => {
    if (blastSelected.size === 0 || !termId) return
    if (!blastConfirm) {
      setBlastConfirm(true)
      setTimeout(() => setBlastConfirm(false), 3500)
      return
    }
    setBlastSending(true)
    setBlastResult(null)
    setBlastConfirm(false)
    try {
      const res = await fetch('/api/announce', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          studentIds: [...blastSelected],
          termId,
          subject: blastSubject,
          body: blastBody,
          baseUrl: window.location.origin,
        }),
      })
      const data = await res.json()
      setBlastResult({
        sent: data.sent ?? 0,
        failed: data.failed ?? (data.error ? blastSelected.size : 0),
        errors: data.errors ?? (data.error ? [data.error] : []),
        mode: data.mode,
        redirectedTo: data.redirectedTo ?? null,
      })
      logEvent('blast_sent', { type: 'availability', sent: data.sent ?? 0, termId })
    } catch (e: unknown) {
      setBlastResult({ sent: 0, failed: blastSelected.size, errors: [e instanceof Error ? e.message : 'Request failed'] })
    }
    setBlastSending(false)
  }

  function toggleBlast(id: string) {
    setBlastSelected(prev => {
      const next = new Set(prev)
      next.has(id) ? next.delete(id) : next.add(id)
      return next
    })
    setBlastResult(null)
    setBlastConfirm(false)
  }

  function toggleBlastAll() {
    if (blastAllChecked) {
      setBlastSelected(new Set())
    } else {
      setBlastSelected(new Set(blastRecipients.map(r => r.studentId)))
    }
    setBlastResult(null)
    setBlastConfirm(false)
  }

  function openEmailPreview() {
    const sampleName = blastRecipients[0]?.studentName ?? 'Alex Student'
    const sampleTerm = selectedTerm?.name ?? ''
    const subject = applyTemplate(blastSubject, { name: sampleName, link: blastLinkPreview, term: sampleTerm, center: centerName })
    const body = applyTemplate(blastBody, { name: sampleName, link: blastLinkPreview, term: sampleTerm, center: centerName })
    setPreviewModal({
      title: 'Availability Email Preview',
      subject,
      html: buildAnnouncementHtml(centerName, body, termId ? blastLinkPreview : ''),
      note: `Previewing ${sampleName}${sampleTerm ? ` for ${sampleTerm}` : ''}`,
    })
  }

  function openFormPreview() {
    const termName = selectedTerm?.name ?? 'Upcoming term'
    setPreviewModal({
      title: 'Availability Form Preview',
      subject: '',
      html: '',
      url: `/enroll?preview=1&term=${encodeURIComponent(termName)}`,
      note: `Showing the same enrollment form flow used from Students (${termName}).`,
    })
  }

  function handleSpSave(studentId: string, prefs: SlotPreferences) {
    setSpEnrollments(prev =>
      prev.map(e => e.student_id === studentId ? { ...e, slot_preferences: prefs } : e)
    )
  }

  async function runScheduler() {
    if (!termId) return
    setSpRunning(true)
    setSpRunError(null)
    setSpProposal(null)
    try {
      const res = await fetch('/api/slot-scheduler', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ termId }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error ?? 'Scheduler failed')
      setSpProposal(data)
    } catch (e: unknown) {
      setSpRunError(e instanceof Error ? e.message : 'Unexpected error')
    } finally {
      setSpRunning(false)
    }
  }

  // ── Render ────────────────────────────────────────────────────────────────────

  const tabs = [
    { id: 'blast' as const,       label: 'Blast',       icon: <Mail className="w-3.5 h-3.5" /> },
    { id: 'submissions' as const, label: 'Submissions', icon: <Users className="w-3.5 h-3.5" /> },
    { id: 'build' as const,       label: 'Build',       icon: <Play className="w-3.5 h-3.5" /> },
  ]

  return (
    <main className="min-h-screen bg-slate-50">
      <div className="mx-auto max-w-5xl px-4 py-8 space-y-0">

        {/* ── Page header ──────────────────────────────────────────────────── */}
        <div className="flex items-start justify-between gap-4 pb-6">
          <div>
            <h1 className="text-2xl font-bold text-slate-900 flex items-center gap-2.5">
              <Layers className="w-6 h-6 text-indigo-600" />
              Schedule Builder
            </h1>
            <p className="text-sm text-slate-500 mt-1">
              Send availability forms, collect slot preferences, and build your schedule.
            </p>
          </div>

          {/* Shared term selector */}
          <div className="shrink-0">
            <label className="block text-xs font-semibold text-slate-500 mb-1.5">Term</label>
            <div className="relative">
              <select
                value={termId}
                onChange={e => setTermId(e.target.value)}
                className="appearance-none bg-white border border-slate-200 rounded-lg pl-3 pr-8 py-2 text-sm font-medium text-slate-800 focus:outline-none focus:ring-2 focus:ring-indigo-400 cursor-pointer shadow-sm min-w-44"
              >
                {terms.length === 0 && <option value="">No terms available</option>}
                {terms.map(t => (
                  <option key={t.id} value={t.id}>{t.name} ({t.status})</option>
                ))}
              </select>
              <ChevronDown className="absolute right-2 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-slate-400 pointer-events-none" />
            </div>
          </div>
        </div>

        {/* ── Tab bar ──────────────────────────────────────────────────────── */}
        <div className="flex gap-0 border-b border-slate-200">
          {tabs.map(tab => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className={`flex items-center gap-2 px-5 py-3 text-sm font-semibold border-b-2 -mb-px transition-all ${
                activeTab === tab.id
                  ? 'border-indigo-500 text-indigo-700'
                  : 'border-transparent text-slate-500 hover:text-slate-700 hover:bg-slate-50'
              }`}
            >
              {tab.icon}
              {tab.label}
              {tab.id === 'submissions' && termId && (
                <span className={`ml-0.5 text-[10px] font-bold px-1.5 py-0.5 rounded-full ${
                  activeTab === tab.id
                    ? 'bg-indigo-100 text-indigo-600'
                    : 'bg-slate-200 text-slate-500'
                }`}>
                  {prefCount}/{enrolledStudents.length}
                </span>
              )}
            </button>
          ))}
        </div>

        {/* ── Tab panels ───────────────────────────────────────────────────── */}
        <div className="bg-white rounded-b-xl border border-t-0 border-slate-200 shadow-sm p-6">

          {/* ── BLAST ──────────────────────────────────────────────────────── */}
          {activeTab === 'blast' && (
            <div className="space-y-5">
              <div>
                <h2 className="text-base font-bold text-slate-900">Availability Email Blast</h2>
                <p className="text-sm text-slate-500 mt-0.5">
                  Send enrollment links to students and parents. Recipients click the link to submit their preferred schedule.
                </p>
              </div>

              {!termId && (
                <div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-700 font-medium">
                  ⚠ Select a term at the top right to generate availability links.
                </div>
              )}

              <div className="grid gap-4 sm:grid-cols-2">
                {/* Email template */}
                <div className="rounded-xl border border-slate-200 overflow-hidden">
                  <div className="flex items-center justify-between border-b border-violet-100 bg-linear-to-r from-violet-50 to-white px-4 py-3">
                    <p className="text-xs font-bold text-violet-900 uppercase tracking-wide">Email Template</p>
                    <div className="flex items-center gap-2">
                      <button
                        onClick={openEmailPreview}
                        className="inline-flex items-center gap-1 rounded-lg border border-slate-200 px-2.5 py-1 text-[11px] font-semibold text-slate-600 hover:bg-slate-50"
                      >
                        <Eye size={10} /> Preview
                      </button>
                      <button
                        onClick={() => setEditingTemplate(v => !v)}
                        className="inline-flex items-center gap-1 rounded-lg border border-slate-200 px-2.5 py-1 text-[11px] font-semibold text-slate-600 hover:bg-slate-50"
                      >
                        {editingTemplate ? <><X size={10} /> Close</> : <><Edit3 size={10} /> Edit</>}
                      </button>
                    </div>
                  </div>

                  {!editingTemplate ? (
                    <div className="px-4 py-3 space-y-2">
                      <div>
                        <p className="text-[10px] font-bold uppercase tracking-widest text-slate-400 mb-0.5">Subject</p>
                        <p className="text-sm text-slate-800">{blastSubject || <span className="text-slate-400 italic">Empty</span>}</p>
                      </div>
                      <div>
                        <p className="text-[10px] font-bold uppercase tracking-widest text-slate-400 mb-0.5">Body</p>
                        <p className="line-clamp-4 whitespace-pre-line text-xs text-slate-500">{blastBody || <span className="italic">Empty</span>}</p>
                      </div>
                    </div>
                  ) : (
                    <div className="p-4 space-y-3">
                      <div className="flex flex-wrap gap-1.5">
                        {['{{name}}', '{{link}}', '{{term}}', '{{center}}'].map(v => (
                          <span key={v} className="rounded border border-slate-200 bg-slate-50 px-2 py-0.5 font-mono text-[10px] text-slate-600">{v}</span>
                        ))}
                      </div>
                      <div>
                        <label className="mb-1 block text-xs font-semibold text-slate-700">Subject</label>
                        <input value={blastSubject} onChange={e => setBlastSubject(e.target.value)} className={baseInputCls} />
                      </div>
                      <div>
                        <label className="mb-1 block text-xs font-semibold text-slate-700">Body</label>
                        <textarea
                          value={blastBody}
                          onChange={e => setBlastBody(e.target.value)}
                          rows={7}
                          className={`${baseInputCls} resize-none`}
                          style={{ lineHeight: '1.6' }}
                        />
                      </div>
                      {termId && (
                        <div className="rounded-lg border border-slate-200 bg-slate-50 p-3 text-xs space-y-1">
                          <p className="font-bold text-slate-500 uppercase tracking-widest text-[10px]">Live Preview</p>
                          <p className="font-semibold text-slate-800">
                            {applyTemplate(blastSubject, { name: 'Alex Student', link: blastLinkPreview, term: selectedTerm?.name ?? '', center: centerName })}
                          </p>
                          <p className="whitespace-pre-line text-slate-500">
                            {applyTemplate(blastBody, { name: 'Alex Student', link: blastLinkPreview, term: selectedTerm?.name ?? '', center: centerName })}
                          </p>
                        </div>
                      )}
                    </div>
                  )}
                </div>

                {/* Recipients */}
                <div className="rounded-xl border border-slate-200 overflow-hidden flex flex-col">
                  <div className="flex items-center justify-between border-b border-blue-100 bg-linear-to-r from-blue-50 to-white px-4 py-3">
                    <p className="text-xs font-bold text-blue-900 uppercase tracking-wide">
                      Recipients <span className="text-blue-400 font-normal normal-case">({blastRecipients.length})</span>
                    </p>
                    <label className="flex cursor-pointer select-none items-center gap-1.5 text-xs text-slate-500">
                      <Checkbox
                        checked={blastAllChecked}
                        indeterminate={blastSomeChecked && !blastAllChecked}
                        onChange={toggleBlastAll}
                      />
                      {blastAllChecked ? 'Deselect all' : 'Select all'}
                    </label>
                  </div>

                  {loadingRecipients ? (
                    <LoadingRow label="Loading recipients…" />
                  ) : blastRecipients.length === 0 ? (
                    <EmptyState icon={<Users size={22} />} label="No students with email addresses" />
                  ) : (
                    <ul className="flex-1 overflow-y-auto divide-y divide-slate-100 max-h-72">
                      {blastRecipients.map(r => (
                        <li
                          key={r.studentId}
                          className="flex cursor-pointer items-center gap-3 px-4 py-2.5 hover:bg-slate-50 transition-colors"
                          onClick={() => { setBlastConfirm(false); toggleBlast(r.studentId) }}
                        >
                          <Checkbox
                            checked={blastSelected.has(r.studentId)}
                            onChange={() => { setBlastConfirm(false); toggleBlast(r.studentId) }}
                          />
                          <div className="min-w-0 flex-1">
                            <p className="text-sm font-semibold text-slate-800">{r.studentName}</p>
                            <p className="truncate text-[10px] text-slate-400"><EmailList student={r} /></p>
                          </div>
                        </li>
                      ))}
                    </ul>
                  )}

                  <div className="border-t border-slate-100 bg-slate-50 p-4 space-y-3">
                    {blastResult && <ResultBanner {...blastResult} />}
                    {termId && (
                      <p className="font-mono text-[10px] text-slate-400 break-all">{blastLinkPreview}</p>
                    )}
                    <p className="text-[11px] text-amber-600 font-medium">⚠ Availability email blast is temporarily disabled — feature still in progress.</p>
                    <div className="flex items-center justify-between gap-2 flex-wrap">
                      <button
                        onClick={openFormPreview}
                        disabled={!termId}
                        className="inline-flex items-center gap-1 text-xs text-slate-500 hover:text-slate-700 disabled:opacity-40"
                      >
                        <Eye size={11} /> Preview form
                      </button>
                      <SendButton
                        onClick={handleBlastSend}
                        loading={blastSending}
                        confirm={blastConfirm}
                        count={blastSelected.size}
                        disabled={true}
                        label="Send availability"
                      />
                    </div>
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* ── SUBMISSIONS ────────────────────────────────────────────────── */}
          {activeTab === 'submissions' && (
            <div className="space-y-5">
              <div>
                <h2 className="text-base font-bold text-slate-900">Slot Preferences</h2>
                <p className="text-sm text-slate-500 mt-0.5">
                  View digital submissions or enter paper form choices for enrolled students.
                </p>
              </div>

              {!spLoading && termId && (
                <div className="flex flex-wrap gap-3">
                  <StatPill icon={<Users className="w-3.5 h-3.5" />} label="Enrolled" value={enrolledStudents.length} color="blue" />
                  <StatPill icon={<Check className="w-3.5 h-3.5" />} label="Preferences entered" value={prefCount} color="green" />
                  <StatPill
                    icon={<AlertTriangle className="w-3.5 h-3.5" />}
                    label="Awaiting"
                    value={enrolledStudents.length - prefCount}
                    color={enrolledStudents.length - prefCount > 0 ? 'amber' : 'gray'}
                  />
                </div>
              )}

              <div className="rounded-xl border border-slate-200 overflow-hidden">
                <div className="px-4 py-3 border-b border-slate-100 flex items-center gap-2">
                  <Search className="w-4 h-4 text-slate-400 shrink-0" />
                  <input
                    value={spSearch}
                    onChange={e => setSpSearch(e.target.value)}
                    placeholder="Search enrolled students…"
                    className="flex-1 text-sm bg-transparent outline-none placeholder:text-slate-400"
                  />
                </div>

                {spLoading ? (
                  <LoadingRow label="Loading students…" />
                ) : filteredStudents.length === 0 ? (
                  <EmptyState
                    icon={<Users size={24} />}
                    label={termId ? 'No enrolled students found.' : 'Select a term to begin.'}
                  />
                ) : (
                  <ul className="divide-y divide-slate-100">
                    {filteredStudents.map(student => {
                      const enrollment = enrollmentMap[student.id]
                      const prefs = enrollment?.slot_preferences ?? null
                      const hasPrefs = Array.isArray(prefs) && prefs.length > 0
                      const isOpen = spOpenStudentId === student.id
                      return (
                        <li key={student.id}>
                          <button
                            onClick={() => setSpOpenStudentId(isOpen ? null : student.id)}
                            className="w-full flex items-center gap-3 px-4 py-3 hover:bg-slate-50 transition-colors text-left"
                          >
                            <div className="flex-1 min-w-0">
                              <div className="flex items-center gap-2 flex-wrap">
                                <span className="text-sm font-semibold text-slate-800 truncate">{student.name}</span>
                                {hasPrefs ? (
                                  <span className="text-[11px] font-semibold bg-emerald-50 text-emerald-700 border border-emerald-200 px-1.5 py-0.5 rounded-full">
                                    {prefs!.length} choice{prefs!.length !== 1 ? 's' : ''}
                                  </span>
                                ) : (
                                  <span className="text-[11px] font-semibold bg-amber-50 text-amber-600 border border-amber-200 px-1.5 py-0.5 rounded-full">
                                    No preferences
                                  </span>
                                )}
                              </div>
                              {hasPrefs && (
                                <div className="mt-0.5 flex flex-wrap gap-1">
                                  {prefs!.map((choice, ci) => (
                                    <span key={ci} className="text-[11px] text-slate-500">
                                      {ci + 1}. {blockLabel(choice)}
                                      {ci < prefs!.length - 1 && <span className="mx-1 text-slate-300">·</span>}
                                    </span>
                                  ))}
                                </div>
                              )}
                            </div>
                            {isOpen
                              ? <ChevronDown className="w-4 h-4 text-slate-400 shrink-0" />
                              : <ChevronRight className="w-4 h-4 text-slate-400 shrink-0" />
                            }
                          </button>
                          {isOpen && (
                            <div className="px-4 pb-4 pt-1 bg-slate-50 border-t border-slate-100">
                              <SlotPreferenceSurvey
                                studentId={student.id}
                                studentName={student.name}
                                termId={termId}
                                sessionTimesByDay={sessionTimesByDay}
                                initialPreferences={prefs}
                                onSave={newPrefs => handleSpSave(student.id, newPrefs)}
                                onClose={() => setSpOpenStudentId(null)}
                              />
                            </div>
                          )}
                        </li>
                      )
                    })}
                  </ul>
                )}
              </div>
            </div>
          )}

          {/* ── BUILD ──────────────────────────────────────────────────────── */}
          {activeTab === 'build' && (
            <div className="space-y-5">
              <div>
                <h2 className="text-base font-bold text-slate-900">Build Schedule</h2>
                <p className="text-sm text-slate-500 mt-0.5">
                  Run the scheduler to automatically place students based on their slot preferences.
                </p>
              </div>

              {!spLoading && termId && (
                <div className="flex flex-wrap gap-3">
                  <StatPill icon={<Users className="w-3.5 h-3.5" />} label="Enrolled" value={enrolledStudents.length} color="blue" />
                  <StatPill icon={<Check className="w-3.5 h-3.5" />} label="With preferences" value={prefCount} color="green" />
                  <StatPill
                    icon={<AlertTriangle className="w-3.5 h-3.5" />}
                    label="Missing preferences"
                    value={enrolledStudents.length - prefCount}
                    color={enrolledStudents.length - prefCount > 0 ? 'amber' : 'gray'}
                  />
                </div>
              )}

              <div className="flex items-center gap-3 flex-wrap">
                <button
                  onClick={runScheduler}
                  disabled={spRunning || prefCount === 0 || !termId}
                  className="flex items-center gap-2 px-5 py-2.5 rounded-xl text-sm font-semibold bg-indigo-600 text-white hover:bg-indigo-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors shadow-sm"
                >
                  {spRunning ? <Loader2 className="w-4 h-4 animate-spin" /> : <Play className="w-4 h-4" />}
                  {spRunning ? 'Running…' : 'Run Scheduler'}
                </button>
                {prefCount === 0 && termId && !spLoading && (
                  <p className="text-xs text-slate-500">
                    No preferences entered yet.{' '}
                    <button
                      onClick={() => setActiveTab('submissions')}
                      className="text-indigo-600 font-semibold hover:underline"
                    >
                      Go to Submissions →
                    </button>
                  </p>
                )}
              </div>

              {spRunError && (
                <div className="bg-red-50 border border-red-200 rounded-xl px-4 py-3 text-sm text-red-700 flex items-center gap-2">
                  <AlertTriangle className="w-4 h-4 shrink-0" />
                  {spRunError}
                </div>
              )}

              {spProposal ? (
                <ProposalPanel proposal={spProposal} onClose={() => setSpProposal(null)} />
              ) : !spRunning && !spRunError && termId ? (
                <div className="rounded-xl border border-dashed border-slate-300 py-16 flex flex-col items-center gap-3 text-slate-400">
                  <Play className="w-8 h-8 opacity-30" />
                  <p className="text-sm font-medium">Run the scheduler to see the proposed schedule</p>
                </div>
              ) : null}
            </div>
          )}

        </div>
      </div>

      {previewModal && <PreviewModal modal={previewModal} onClose={() => setPreviewModal(null)} />}
    </main>
  )
}
