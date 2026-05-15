'use client'
import React, { useState, useCallback, useMemo, useEffect } from 'react'
import Link from 'next/link'
import {
  Plus, Trash2, GraduationCap, Loader2, Save, X,
  Upload, ChevronDown, ChevronUp, Search, Filter,
  MoreHorizontal, Mail, Phone, AlertTriangle, Check,
  ArrowUpDown, BookOpen, Clock, Activity
} from 'lucide-react'
import { supabase } from '@/lib/supabaseClient'
import { BookingForm, BookingToast } from '@/components/BookingForm'
import StudentDetailsModal from '@/components/StudentDetailsModal'
import {
  bookStudent, getWeekStart, getWeekDates, toISODate, dayOfWeek, getCentralTimeNow,
} from '@/lib/useScheduleData'
import { DB, withCenter, withCenterPayload } from '@/lib/db'
import { getSessionsForDay, SESSION_BLOCKS, type SessionTimesByDay } from '@/components/constants'
import { logEvent } from '@/lib/analytics'
import { CSVImportModal } from '@/components/CSVImportModal'

const TUTORS   = DB.tutors
const STUDENTS = DB.students
const SESSIONS = DB.sessions
const SS       = DB.sessionStudents

const EMPTY_FORM = {
  name: '', grade: '', email: '', phone: '',
  mom_name: '', mom_email: '', mom_phone: '',
  dad_name: '', dad_email: '', dad_phone: '',
  notify_student: true, notify_mom: true, notify_dad: true,
}
const ACTIVE_DAYS = [1, 2, 3, 4, 6]
const DAY_NAMES = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Saturday']
const MAX_CAPACITY = 3

const normalizeStringArray = (value: unknown): string[] => {
  if (Array.isArray(value)) {
    return value.map(v => String(v).trim()).filter(Boolean)
  }
  if (typeof value === 'string') {
    const trimmed = value.trim()
    if (!trimmed) return []
    try {
      const parsed = JSON.parse(trimmed)
      if (Array.isArray(parsed)) return parsed.map(v => String(v).trim()).filter(Boolean)
    } catch {}
    return trimmed.split(',').map(v => v.trim()).filter(Boolean)
  }
  return []
}

const isTutorAvailable = (tutor: any, dow: number, time: string) =>
  tutor.availability_blocks?.includes(`${dow}-${time}`)

function Badge({ children, color = 'gray' }: { children: React.ReactNode; color?: 'green' | 'red' | 'blue' | 'yellow' | 'gray' | 'purple' }) {
  const map: Record<string, string> = {
    green:  'bg-emerald-50 text-emerald-700 border-emerald-200',
    red:    'bg-red-50 text-red-600 border-red-200',
    blue:   'bg-blue-50 text-blue-700 border-blue-200',
    yellow: 'bg-amber-50 text-amber-700 border-amber-200',
    gray:   'bg-slate-100 text-slate-500 border-slate-200',
    purple: 'bg-violet-50 text-violet-700 border-violet-200',
  }
  return (
    <span className={`inline-flex items-center gap-1 rounded border px-1.5 py-0.5 text-[10px] font-semibold leading-none ${map[color]}`}>
      {children}
    </span>
  )
}

function AttBar({ rate }: { rate: number | null }) {
  if (rate === null) return <span className="text-xs text-slate-400">—</span>
  const pct = Math.round(rate * 100)
  const color = pct >= 80 ? '#10b981' : pct >= 60 ? '#f59e0b' : '#ef4444'
  return (
    <div className="flex items-center gap-2">
      <div className="h-1.5 w-16 rounded-full bg-slate-100 overflow-hidden">
        <div className="h-full rounded-full" style={{ width: `${pct}%`, background: color }} />
      </div>
      <span className="text-xs font-semibold tabular-nums" style={{ color }}>{pct}%</span>
    </div>
  )
}

// ── Student detail slide-over ─────────────────────────────────────────────────
function StudentSlideOver({
  student, tutors, allSessions, allAvailableSeats, terms,
  onClose, onRefetch, onUpdateStudent, onBookingSuccess,
}: {
  student: any
  tutors: any[]
  allSessions: any[]
  allAvailableSeats: any[]
  terms: any[]
  onClose: () => void
  onRefetch: () => void
  onUpdateStudent: (updated: any) => void
  onBookingSuccess: (d: any) => void
}) {
  const [tab, setTab] = useState<'info' | 'sessions'>('info')
  const [showBooking, setShowBooking] = useState(false)
  const [showDetailsModal, setShowDetailsModal] = useState(false)
  const [draft, setDraft] = useState(student)
  const [saving, setSaving] = useState(false)
  const [editing, setEditing] = useState(false)
  const [enrollCat, setEnrollCat] = useState('math')
  const [sendingForm, setSendingForm] = useState(false)

  const today = toISODate(getCentralTimeNow())

  const sessions = useMemo(() =>
    allSessions.flatMap(s => s.students
      .filter((ss: any) => ss.id === student.id)
      .map((ss: any) => ({
        date: s.date,
        tutorName: tutors.find(t => t.id === s.tutorId)?.name ?? 'Unknown',
        time: s.time,
        topic: ss.topic,
        status: ss.status,
        isPast: s.date < today,
      }))
    ).sort((a, b) => b.date.localeCompare(a.date)),
    [allSessions, student.id, tutors, today]
  )

  const past = sessions.filter(s => s.isPast)
  const upcoming = sessions.filter(s => !s.isPast)
  const present = past.filter(s => s.status === 'present' || s.status === 'confirmed').length
  const rate = past.length > 0 ? present / past.length : null

  const availabilityBlocks: string[] = [
    ...normalizeStringArray(student.availability_blocks),
    ...normalizeStringArray(student.availabilityBlocks),
  ].filter((value, index, self) => self.indexOf(value) === index)

  const availabilityPreview = availabilityBlocks.slice(0, 6).map((key: string) => {
    const [dowRaw, time] = key.split('-')
    const dow = Number(dowRaw)
    const dayLabel = ({ 1: 'Mon', 2: 'Tue', 3: 'Wed', 4: 'Thu', 6: 'Sat' } as Record<number, string>)[dow] ?? `D${dow}`
    const blockLabel = SESSION_BLOCKS.find(b => b.time === time)?.label ?? time
    return `${dayLabel} ${blockLabel}`
  })

  const handleSave = async () => {
    setSaving(true)
    await withCenter(supabase.from(STUDENTS).update({
      name: draft.name, grade: draft.grade,
      email: draft.email || null, phone: draft.phone || null,
      mom_name: draft.mom_name || null, mom_email: draft.mom_email || null,
      mom_phone: draft.mom_phone || null,
      dad_name: draft.dad_name || null, dad_email: draft.dad_email || null,
      dad_phone: draft.dad_phone || null,
      notify_student: draft.notify_student ?? true,
      notify_mom:     draft.notify_mom     ?? true,
      notify_dad:     draft.notify_dad     ?? true,
    })).eq('id', student.id)
    setSaving(false)
    setEditing(false)
    onRefetch()
  }

  const handleSendEnrollmentForm = async () => {
    const email = student.mom_email || student.dad_email || student.email
    if (!email) { alert('No email on file for this student.'); return }
    if (!student.selected_term_id) { alert('No term selected.'); return }
    const termRow = terms.find((t: any) => t.id === student.selected_term_id)
    setSendingForm(true)
    try {
      const res = await fetch('/api/send-enrollment', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          studentId: student.id,
          termId: student.selected_term_id,
          recipientEmail: email,
          studentName: student.name,
          termName: termRow?.name ?? 'Upcoming Term',
        }),
      })
      if (!res.ok) { const d = await res.json(); alert(d.error ?? 'Failed to send'); return }
      alert(`Enrollment form sent to ${email}`)
    } catch {
      alert('Failed to send enrollment form.')
    } finally {
      setSendingForm(false)
    }
  }

  const handleConfirmBooking = async (data: any) => {
    await bookStudent({
      tutorId: data.slot.tutor.id, date: data.slot.date, time: data.slot.time,
      student: {
        id: student.id, name: student.name,
        subjects: Array.isArray(student.subjects) ? student.subjects : (student.subject ? [student.subject] : []),
        subject: student.subject ?? null,
        grade: student.grade ?? null, hoursLeft: student.hours_left ?? 0,
        sessionHours: student.session_hours ?? 2,
        availabilityBlocks: student.availability_blocks ?? [],
        subjectSessionsPerWeek: student.subjectSessionsPerWeek ?? {},
        allowSameDayDouble: student.allowSameDayDouble ?? false,
        subjectTutorPreference: student.subjectTutorPreference ?? {},
        email: student.email ?? null, phone: student.phone ?? null,
        parent_name: null, parent_email: null, parent_phone: null,
        mom_name: student.mom_name ?? null, mom_email: student.mom_email ?? null,
        mom_phone: student.mom_phone ?? null,
        dad_name: student.dad_name ?? null, dad_email: student.dad_email ?? null,
        dad_phone: student.dad_phone ?? null,
        bluebook_url: student.bluebook_url ?? null,
      },
      topic: data.topic, recurring: data.recurring, recurringWeeks: data.recurringWeeks,
    })
    setShowBooking(false)
    onRefetch()
    onBookingSuccess(data)
  }

  const inputCls = "w-full rounded border border-slate-200 bg-white px-2.5 py-1.5 text-xs font-medium text-slate-800 outline-none focus:border-slate-400 focus:ring-2 focus:ring-slate-100"

  return (
    <div className="fixed inset-0 z-50 flex" onClick={e => { if (e.target === e.currentTarget) onClose() }}>
      <div className="flex-1 bg-black/20" onClick={onClose} />
      <div className="flex h-full w-105 flex-col border-l border-slate-200 bg-white shadow-2xl">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-slate-100 px-5 py-4">
          <div className="flex items-center gap-3">
            <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-slate-900 text-xs font-black text-white">
              {student.name.charAt(0)}
            </div>
            <div>
              <p className="text-sm font-bold text-slate-900">{student.name}</p>
              <p className="text-xs text-slate-400">
                {student.grade ? `Grade ${student.grade}` : 'No grade'} · {sessions.length} sessions
              </p>
            </div>
          </div>
          <div className="flex items-center gap-1.5">
            <button
              onClick={handleSendEnrollmentForm}
              disabled={sendingForm}
              className="rounded border border-slate-200 px-3 py-1.5 text-xs font-semibold text-slate-600 hover:bg-slate-50 disabled:opacity-50">
              {sendingForm ? 'Sending…' : 'Send Form'}
            </button>
            <button onClick={() => setShowBooking(true)}
              className="rounded border border-slate-900 bg-slate-900 px-3 py-1.5 text-xs font-semibold text-white hover:bg-slate-800">
              Book
            </button>
            <button onClick={onClose} className="rounded border border-slate-200 p-1.5 text-slate-400 hover:text-slate-600">
              <X size={13} />
            </button>
          </div>
        </div>

        {/* Tabs */}
        <div className="flex border-b border-slate-100">
          {(['info', 'sessions'] as const).map(t => (
            <button key={t} onClick={() => setTab(t)}
              className={`px-5 py-2.5 text-xs font-semibold capitalize transition-colors ${tab === t ? 'border-b-2 border-slate-900 text-slate-900' : 'text-slate-400 hover:text-slate-600'}`}>
              {t === 'sessions' ? `Sessions (${sessions.length})` : 'Info'}
            </button>
          ))}
        </div>

        <div className="flex-1 overflow-y-auto">
          {tab === 'info' && (
            <div className="p-5 space-y-5">
              <div>
                <div className="flex items-center justify-between mb-2">
                  <p className="text-[10px] font-bold uppercase tracking-widest text-slate-400">Subjects</p>
                  <button onClick={() => setShowDetailsModal(true)} className="text-[10px] font-semibold text-blue-600 hover:text-blue-800">Edit</button>
                </div>
                <div className="flex flex-wrap gap-1.5">
                  {((() => {
                    const normalized = normalizeStringArray(student.subjects)
                    if (normalized.length > 0) return normalized
                    return student.subject ? [String(student.subject)] : []
                  })()).map((s: string, i: number) => (
                    <Badge key={i} color="blue">{s}</Badge>
                  ))}
                  {normalizeStringArray(student.subjects).length === 0 && !student.subject && (
                    <span className="text-xs text-slate-400">Not set</span>
                  )}
                </div>
              </div>

              <div>
                <div className="flex items-center justify-between mb-2">
                  <p className="text-[10px] font-bold uppercase tracking-widest text-slate-400">Availability</p>
                  <button onClick={() => setShowDetailsModal(true)} className="text-[10px] font-semibold text-blue-600 hover:text-blue-800">Edit</button>
                </div>
                {availabilityPreview.length > 0 ? (
                  <div className="flex flex-wrap gap-1.5">
                    {availabilityPreview.map((label, i) => (
                      <Badge key={`${label}-${i}`} color="purple">{label}</Badge>
                    ))}
                    {availabilityBlocks.length > availabilityPreview.length && (
                      <Badge color="gray">+{availabilityBlocks.length - availabilityPreview.length} more</Badge>
                    )}
                  </div>
                ) : (
                  <span className="text-xs text-slate-400">No availability set</span>
                )}
              </div>

              <div className="grid grid-cols-3 gap-2">
                {[
                  { label: 'Hours Left', value: student.hours_left ?? '—', icon: Clock },
                  { label: 'Upcoming', value: upcoming.length, icon: BookOpen },
                  { label: 'Attendance', value: rate !== null ? `${Math.round(rate * 100)}%` : '—', icon: Activity },
                ].map(({ label, value, icon: Icon }) => (
                  <div key={label} className="rounded border border-slate-100 bg-slate-50 p-3">
                    <Icon size={11} className="text-slate-400 mb-1.5" />
                    <p className="text-sm font-black text-slate-900">{value}</p>
                    <p className="text-[10px] text-slate-400 mt-0.5">{label}</p>
                  </div>
                ))}
              </div>

              <div>
                <div className="flex items-center justify-between mb-2">
                  <p className="text-[10px] font-bold uppercase tracking-widest text-slate-400">Contact</p>
                  <button onClick={() => setEditing(e => !e)} className="text-[10px] font-semibold text-blue-600 hover:text-blue-800">
                    {editing ? 'Cancel' : 'Edit'}
                  </button>
                </div>
                {editing ? (
                  <div className="space-y-2">
                    {[['Email', 'email', 'email'], ['Phone', 'phone', 'tel'], ['Grade', 'grade', 'text']].map(([label, field, type]) => (
                      <div key={field}>
                        <label className="text-[10px] font-semibold text-slate-400 mb-1 block">{label}</label>
                        <input type={type} value={draft[field] ?? ''} onChange={e => setDraft((p: any) => ({ ...p, [field]: e.target.value }))} className={inputCls} />
                      </div>
                    ))}
                    <label className="flex items-center gap-2 mt-1 cursor-pointer select-none">
                      <input type="checkbox" checked={draft.notify_student ?? true}
                        onChange={e => setDraft((p: any) => ({ ...p, notify_student: e.target.checked }))}
                        className="h-3.5 w-3.5 rounded border-slate-300 accent-slate-800" />
                      <span className="text-[10px] font-semibold text-slate-500">Send reminders to student email</span>
                    </label>
                    <div className="pt-1">
                      <p className="text-[10px] font-bold uppercase tracking-widest text-slate-400 mb-2">Mother</p>
                      {[['Name', 'mom_name', 'text'], ['Email', 'mom_email', 'email'], ['Phone', 'mom_phone', 'tel']].map(([label, field, type]) => (
                        <div key={field} className="mb-2">
                          <label className="text-[10px] font-semibold text-slate-400 mb-1 block">{label}</label>
                          <input type={type} value={draft[field] ?? ''} onChange={e => setDraft((p: any) => ({ ...p, [field]: e.target.value }))} className={inputCls} />
                        </div>
                      ))}
                      <label className="flex items-center gap-2 mt-1 mb-3 cursor-pointer select-none">
                        <input type="checkbox" checked={draft.notify_mom ?? true}
                          onChange={e => setDraft((p: any) => ({ ...p, notify_mom: e.target.checked }))}
                          className="h-3.5 w-3.5 rounded border-slate-300 accent-slate-800" />
                        <span className="text-[10px] font-semibold text-slate-500">Send reminders to mom&apos;s email</span>
                      </label>
                      <p className="text-[10px] font-bold uppercase tracking-widest text-slate-400 mb-2 mt-3">Father</p>
                      {[['Name', 'dad_name', 'text'], ['Email', 'dad_email', 'email'], ['Phone', 'dad_phone', 'tel']].map(([label, field, type]) => (
                        <div key={field} className="mb-2">
                          <label className="text-[10px] font-semibold text-slate-400 mb-1 block">{label}</label>
                          <input type={type} value={draft[field] ?? ''} onChange={e => setDraft((p: any) => ({ ...p, [field]: e.target.value }))} className={inputCls} />
                        </div>
                      ))}
                      <label className="flex items-center gap-2 mt-1 cursor-pointer select-none">
                        <input type="checkbox" checked={draft.notify_dad ?? true}
                          onChange={e => setDraft((p: any) => ({ ...p, notify_dad: e.target.checked }))}
                          className="h-3.5 w-3.5 rounded border-slate-300 accent-slate-800" />
                        <span className="text-[10px] font-semibold text-slate-500">Send reminders to dad&apos;s email</span>
                      </label>
                    </div>
                    <button onClick={handleSave} disabled={saving}
                      className="w-full rounded bg-slate-900 py-2 text-xs font-semibold text-white hover:bg-slate-800 disabled:opacity-50 mt-1">
                      {saving ? 'Saving…' : 'Save Changes'}
                    </button>
                  </div>
                ) : (
                  <div className="space-y-1.5 text-xs">
                    {[
                      { label: 'Student', icon: Mail, value: student.email, notifyKey: 'notify_student' },
                      { label: 'Phone', icon: Phone, value: student.phone, notifyKey: null },
                      { label: 'Mom', icon: Mail, value: student.mom_email, notifyKey: 'notify_mom' },
                      { label: 'Dad', icon: Mail, value: student.dad_email, notifyKey: 'notify_dad' },
                    ].map(({ label, icon: Icon, value, notifyKey }) => (
                      <div key={label} className="flex items-center gap-2.5 rounded border border-slate-100 px-3 py-2">
                        <Icon size={11} className="text-slate-300 shrink-0" />
                        <span className="text-slate-400 w-10 shrink-0">{label}</span>
                        <span className="font-medium text-slate-700 truncate flex-1">{value ?? 'Not on file'}</span>
                        {notifyKey && value && student[notifyKey] === false && (
                          <span className="text-[9px] font-bold uppercase text-amber-600 bg-amber-50 border border-amber-200 rounded px-1.5 py-0.5 shrink-0">No emails</span>
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          )}

          {tab === 'sessions' && (
            <div className="divide-y divide-slate-50">
              {sessions.length === 0 && (
                <p className="py-12 text-center text-xs text-slate-400">No sessions on record</p>
              )}
              {sessions.map((s, i) => {
                const d = new Date(s.date + 'T00:00:00')
                const isPresent = s.status === 'present' || s.status === 'confirmed'
                const isNoShow = s.status === 'no-show'
                return (
                  <div key={i} className="flex items-center gap-3 px-5 py-3 hover:bg-slate-50">
                    <div className="w-10 shrink-0 text-center">
                      <p className="text-[9px] font-bold uppercase text-slate-300">{d.toLocaleDateString('en-US', { month: 'short' })}</p>
                      <p className={`text-sm font-black ${s.isPast ? 'text-slate-400' : 'text-slate-900'}`}>{d.getDate()}</p>
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-xs font-semibold text-slate-800 truncate">{s.topic || <span className="italic text-slate-400">No topic</span>}</p>
                      <p className="text-[10px] text-slate-400">{s.tutorName} · {s.time}</p>
                    </div>
                    <div className={`h-1.5 w-1.5 rounded-full shrink-0 ${isPresent ? 'bg-emerald-400' : isNoShow ? 'bg-red-400' : s.isPast ? 'bg-amber-400' : 'bg-blue-400'}`} />
                  </div>
                )
              })}
            </div>
          )}
        </div>
      </div>

      {showBooking && (
        <div className="fixed inset-0 z-60 flex items-center justify-center p-4"
          style={{ background: 'rgba(15,23,42,0.6)', backdropFilter: 'blur(4px)' }}
          onClick={e => { if (e.target === e.currentTarget) setShowBooking(false) }}>
          <div onClick={e => e.stopPropagation()}>
            <BookingForm prefilledSlot={null} onConfirm={handleConfirmBooking} onCancel={() => setShowBooking(false)}
              enrollCat={enrollCat} setEnrollCat={setEnrollCat} allAvailableSeats={allAvailableSeats} studentDatabase={[student]} />
          </div>
        </div>
      )}
      {showDetailsModal && (
        <StudentDetailsModal
          student={student}
          tutors={tutors.map(t => ({ id: t.id, name: t.name, subjects: Array.isArray(t.subjects) ? t.subjects : [] }))}
          onClose={() => setShowDetailsModal(false)}
          onSave={(updatedStudent) => {
            onUpdateStudent(updatedStudent)
            onRefetch()
            setShowDetailsModal(false)
          }}
        />
      )}
    </div>
  )
}

// ── Main Page ─────────────────────────────────────────────────────────────────
export default function StudentAdminPage() {
  const [students, setStudents] = useState<any[]>([])
  const [tutors, setTutors] = useState<any[]>([])
  const [allSessions, setAllSessions] = useState<any[]>([])
  const [terms, setTerms] = useState<any[]>([])
  const [selectedTermId, setSelectedTermId] = useState('')
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [filter, setFilter] = useState<'all' | 'booked' | 'unbooked' | 'active' | 'inactive'>('all')
  const [sortCol, setSortCol] = useState<'name' | 'grade' | 'hours' | 'attendance'>('name')
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('asc')
  const [activeStudentId, setActiveStudentId] = useState<string | null>(null)
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [showImport, setShowImport] = useState(false)
  const [showAddForm, setShowAddForm] = useState(false)
  const [newStudent, setNewStudent] = useState(EMPTY_FORM)
  const [creating, setCreating] = useState(false)
  const [confirmBulkDelete, setConfirmBulkDelete] = useState(false)
  const [bulkDeleting, setBulkDeleting] = useState(false)
  const [bookingToast, setBookingToast] = useState<any>(null)

  const fetchData = useCallback(async () => {
    setLoading(true)
    const [sRes, tRes, sesRes, termsPayload] = await Promise.all([
      withCenter(supabase.from(STUDENTS).select('*')).order('name'),
      withCenter(supabase.from(TUTORS).select('*')).order('name'),
      (withCenter(supabase.from(SESSIONS).select(`id, session_date, tutor_id, time, ${SS}(id, student_id, name, topic, status)`)).order('session_date') as any),
      fetch('/api/terms')
        .then(async (res) => {
          const payload = await res.json().catch(() => ({}))
          if (!res.ok) throw new Error(payload?.error || 'Failed to load terms')
          return payload
        })
        .catch((err) => {
          console.error('Failed to fetch terms for students page:', err)
          return { terms: [] }
        }),
    ])

    const termRows = Array.isArray(termsPayload?.terms) ? termsPayload.terms : []
    setTerms(termRows)

    const preferredTermId = (
      selectedTermId && termRows.some((t: any) => t.id === selectedTermId)
        ? selectedTermId
        : (termRows.find((t: any) => t.status === 'active')?.id ?? termRows[0]?.id ?? '')
    )

    if (preferredTermId !== selectedTermId) setSelectedTermId(preferredTermId)

    const enrollmentsPayload = await fetch('/api/term-enrollment')
      .then(async (res) => {
        const payload = await res.json().catch(() => ({}))
        if (!res.ok) throw new Error(payload?.error || 'Failed to load term enrollments')
        return payload
      })
      .catch((err) => {
        console.error('Failed to fetch term enrollments for students page:', err)
        return { enrollments: [] }
      })

    const allEnrollmentRows = Array.isArray(enrollmentsPayload?.enrollments) ? enrollmentsPayload.enrollments : []

    const latestEnrollmentByStudent = allEnrollmentRows.reduce((acc: Record<string, any>, row: any) => {
      if (!acc[row.student_id]) acc[row.student_id] = row
      return acc
    }, {})

    const enrollmentByStudentForTerm = allEnrollmentRows
      .filter((row: any) => !preferredTermId || row.term_id === preferredTermId)
      .reduce((acc: Record<string, any>, row: any) => {
        if (!acc[row.student_id]) acc[row.student_id] = row
        return acc
      }, {})

    const studentRows = (sRes.data ?? []).map((row: any) => {
      const enrollment = preferredTermId
  ? enrollmentByStudentForTerm[row.id] ?? null  // no fallback when term is selected
  : latestEnrollmentByStudent[row.id] ?? null
      const enrollmentSubjects = normalizeStringArray(enrollment?.subjects)
      const rowSubjects = normalizeStringArray(row.subjects)
      const enrollmentAvailability = normalizeStringArray(enrollment?.availability_blocks)
      const rowAvailability = normalizeStringArray(row.availability_blocks)
      return {
        ...row,
        subjects: enrollmentSubjects.length > 0 ? enrollmentSubjects : (rowSubjects.length > 0 ? rowSubjects : (row.subject ? [String(row.subject)] : [])),
        availability_blocks: enrollmentAvailability.length > 0 ? enrollmentAvailability : rowAvailability,
        hours_left: typeof row.hours_left === 'number' ? row.hours_left : (typeof enrollment?.hours_purchased === 'number' ? enrollment.hours_purchased : null),
        selected_term_id: preferredTermId || enrollment?.term_id || null,
      }
    })

    setStudents(studentRows)
    setTutors(tRes.data ?? [])
    setAllSessions((sesRes.data ?? []).map((r: any) => ({
      id: r.id, date: r.session_date, tutorId: r.tutor_id, time: r.time,
      students: (r[SS] ?? []).map((ss: any) => ({ id: ss.student_id, rowId: ss.id, name: ss.name, topic: ss.topic, status: ss.status })),
    })))
    setLoading(false)
  }, [selectedTermId])

  useEffect(() => { fetchData() }, [fetchData])

  const today = toISODate(getCentralTimeNow())
  const weekStart = getWeekStart(getCentralTimeNow())
  const weekDates = getWeekDates(weekStart)
  const activeDates = weekDates.filter(d => ACTIVE_DAYS.includes(dayOfWeek(toISODate(d))))
  const weekEnd = toISODate(new Date(weekStart.getTime() + 6 * 86400000))
  const selectedTerm = useMemo(() => terms.find((t: any) => t.id === selectedTermId) ?? null, [terms, selectedTermId])
  const selectedTermSessionTimesByDay = useMemo<SessionTimesByDay | null>(() => {
    const raw = selectedTerm?.session_times_by_day
    if (!raw || typeof raw !== 'object') return null
    return raw as SessionTimesByDay
  }, [selectedTerm])

  const allAvailableSeats = useMemo(() => {
    const seats: any[] = []
    tutors.forEach(tutor => {
      activeDates.forEach(date => {
        const iso = toISODate(date)
        const dow = dayOfWeek(iso)
        if (!tutor.availability?.includes(dow)) return
        getSessionsForDay(dow, selectedTermSessionTimesByDay).forEach((block: any) => {
          if (!isTutorAvailable(tutor, dow, block.time)) return
          const session = allSessions.find(s => s.date === iso && s.tutorId === tutor.id && s.time === block.time)
          const count = session ? session.students.length : 0
          if (count < MAX_CAPACITY) {
            seats.push({ tutor: { ...tutor, availabilityBlocks: tutor.availability_blocks }, dayName: DAY_NAMES[ACTIVE_DAYS.indexOf(dow)], date: iso, time: block.time, block, count, seatsLeft: MAX_CAPACITY - count, dayNum: dow })
          }
        })
      })
    })
    return seats.sort((a, b) => a.date.localeCompare(b.date) || a.time.localeCompare(b.time))
  }, [tutors, allSessions, activeDates, selectedTermSessionTimesByDay])

  const bookedIds = useMemo(() => {
    const ids = new Set<string>()
    allSessions.filter(s => s.date >= today && s.date <= weekEnd).forEach(s => s.students.forEach((st: any) => ids.add(st.id)))
    return ids
  }, [allSessions, today, weekEnd])

  const activeIds = useMemo(() => {
    const ids = new Set<string>()
    const dt = new Date(today + 'T00:00:00')
    dt.setDate(dt.getDate() - 30)
    const ago = toISODate(dt)
    allSessions.filter(s => s.date >= ago && s.date <= today).forEach(s => s.students.forEach((st: any) => ids.add(st.id)))
    return ids
  }, [allSessions, today])

  const studentStats = useMemo(() => {
    const map = new Map<string, { attendanceRate: number | null; sessionCount: number; upcoming: number; isAtRisk: boolean }>()
    students.forEach(student => {
      const past = allSessions.filter(s => s.date < today).flatMap(s => s.students.filter((st: any) => st.id === student.id))
      const upcoming = allSessions.filter(s => s.date >= today && s.students.some((st: any) => st.id === student.id)).length
      const present = past.filter((st: any) => st.status === 'present' || st.status === 'confirmed').length
      const noShow = past.filter((st: any) => st.status === 'no-show').length
      const rate = past.length > 0 ? present / past.length : null
      const isAtRisk = past.length >= 3 && noShow / past.length > 0.4
      map.set(student.id, { attendanceRate: rate, sessionCount: past.length + upcoming, upcoming, isAtRisk })
    })
    return map
  }, [students, allSessions, today])

  const handleSort = (col: typeof sortCol) => {
    if (sortCol === col) setSortDir(d => d === 'asc' ? 'desc' : 'asc')
    else { setSortCol(col); setSortDir('asc') }
  }

  const filtered = useMemo(() => {
    let list = students.filter(s => {
      if (!s.name.toLowerCase().includes(search.toLowerCase())) return false
      if (filter === 'booked') return bookedIds.has(s.id)
      if (filter === 'unbooked') return !bookedIds.has(s.id)
      if (filter === 'active') return activeIds.has(s.id)
      if (filter === 'inactive') return !activeIds.has(s.id)
      return true
    })
    list = [...list].sort((a, b) => {
      let va: any, vb: any
      if (sortCol === 'name') { va = a.name.toLowerCase(); vb = b.name.toLowerCase() }
      else if (sortCol === 'grade') { va = parseInt(a.grade) || 0; vb = parseInt(b.grade) || 0 }
      else if (sortCol === 'hours') { va = a.hours_left ?? -1; vb = b.hours_left ?? -1 }
      else if (sortCol === 'attendance') {
        va = studentStats.get(a.id)?.attendanceRate ?? -1
        vb = studentStats.get(b.id)?.attendanceRate ?? -1
      }
      return sortDir === 'asc' ? (va > vb ? 1 : -1) : (va < vb ? 1 : -1)
    })
    return list
  }, [students, search, filter, bookedIds, activeIds, sortCol, sortDir, studentStats])

  const allSelected = filtered.length > 0 && filtered.every(s => selected.has(s.id))
  const toggleAll = () => allSelected ? setSelected(new Set()) : setSelected(new Set(filtered.map(s => s.id)))

  const handleCreate = async () => {
    if (!newStudent.name) return
    setCreating(true)
    await supabase.from(STUDENTS).insert([withCenterPayload({
      name: newStudent.name, grade: newStudent.grade || null,
      email: newStudent.email || null, phone: newStudent.phone || null,
      mom_name: newStudent.mom_name || null, mom_email: newStudent.mom_email || null, mom_phone: newStudent.mom_phone || null,
      dad_name: newStudent.dad_name || null, dad_email: newStudent.dad_email || null, dad_phone: newStudent.dad_phone || null,
    })])
    setCreating(false); setShowAddForm(false); setNewStudent(EMPTY_FORM); fetchData()
  }

  const handleBulkDelete = async () => {
    if (!confirmBulkDelete) { setConfirmBulkDelete(true); setTimeout(() => setConfirmBulkDelete(false), 3000); return }
    setBulkDeleting(true)
    await withCenter(supabase.from(STUDENTS).delete()).in('id', Array.from(selected))
    setSelected(new Set()); setConfirmBulkDelete(false); setBulkDeleting(false); fetchData()
  }

  const activeStudent = students.find(s => s.id === activeStudentId) ?? null

  const SortIcon = ({ col }: { col: typeof sortCol }) => (
    <ArrowUpDown size={10} className={`inline ml-1 ${sortCol === col ? 'text-slate-600' : 'text-slate-300'}`} />
  )

  const inputCls = "rounded border border-slate-200 bg-white px-2.5 py-1.5 text-xs text-slate-800 outline-none focus:border-slate-400"

  return (
    <div className="min-h-screen bg-slate-50 px-4 py-5 text-slate-900" style={{ fontFamily: "'DM Sans', 'Inter', system-ui, sans-serif" }}>
      <div className="mx-auto flex h-[calc(100vh-2.5rem)] w-full max-w-7xl flex-col overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">

      <div className="flex h-12 shrink-0 items-center justify-between border-b border-slate-200 bg-white px-5">
        <div className="flex items-center gap-3">
          <GraduationCap size={15} className="text-slate-400" />
          <span className="text-sm font-bold text-slate-900">Students</span>
          {!loading && <span className="rounded bg-slate-100 px-2 py-0.5 text-[10px] font-bold text-slate-500">{students.length}</span>}
        </div>
        <div className="flex items-center gap-2">
          {selected.size > 0 && (
            <button onClick={handleBulkDelete} disabled={bulkDeleting}
              className={`flex items-center gap-1.5 rounded border px-3 py-1.5 text-xs font-semibold ${confirmBulkDelete ? 'border-red-300 bg-red-50 text-red-600' : 'border-slate-200 text-slate-600 hover:border-red-200 hover:text-red-500'}`}>
              <Trash2 size={11} />
              {confirmBulkDelete ? `Confirm delete ${selected.size}` : `Delete ${selected.size}`}
            </button>
          )}
          <button onClick={() => setShowImport(true)}
            className="flex items-center gap-1.5 rounded border border-slate-200 px-3 py-1.5 text-xs font-semibold text-slate-600 hover:bg-slate-50">
            <Upload size={11} /> Import CSV
          </button>
          <button onClick={() => setShowAddForm(f => !f)}
            className="flex items-center gap-1.5 rounded bg-slate-900 px-3 py-1.5 text-xs font-semibold text-white hover:bg-slate-800">
            <Plus size={11} /> Add Student
          </button>
        </div>
      </div>

      {showAddForm && (
        <div className="shrink-0 border-b border-slate-200 bg-slate-50 px-5 py-4">
          <div className="flex items-center justify-between mb-3">
            <p className="text-xs font-bold text-slate-700">New Student</p>
            <button onClick={() => setShowAddForm(false)} className="text-slate-400 hover:text-slate-600"><X size={13} /></button>
          </div>
          <div className="flex flex-wrap gap-2">
            {[['Name *', 'name', 'text'], ['Grade', 'grade', 'text'], ['Email', 'email', 'email'], ['Phone', 'phone', 'tel'],
              ['Mom Name', 'mom_name', 'text'], ['Mom Email', 'mom_email', 'email'],
              ['Dad Name', 'dad_name', 'text'], ['Dad Email', 'dad_email', 'email']
            ].map(([label, field, type]) => (
              <div key={field} className="flex flex-col gap-1">
                <label className="text-[10px] font-semibold text-slate-400">{label}</label>
                <input type={type} value={(newStudent as any)[field] ?? ''} onChange={e => setNewStudent(p => ({ ...p, [field]: e.target.value }))} className={inputCls} placeholder={label.replace(' *', '')} style={{ width: 140 }} />
              </div>
            ))}
            <div className="flex items-end">
              <button onClick={handleCreate} disabled={!newStudent.name || creating}
                className="rounded bg-slate-900 px-4 py-1.5 text-xs font-semibold text-white hover:bg-slate-800 disabled:opacity-40">
                {creating ? <Loader2 size={11} className="animate-spin" /> : 'Register'}
              </button>
            </div>
          </div>
        </div>
      )}

      <div className="flex h-10 shrink-0 items-center gap-3 border-b border-slate-100 bg-white px-5">
        <div className="relative">
          <Search size={11} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-300" />
          <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search students…"
            className="h-7 rounded border border-slate-200 bg-slate-50 pl-7 pr-3 text-xs text-slate-700 outline-none focus:border-slate-400 w-52" />
        </div>
        <div className="flex items-center gap-1 border-l border-slate-100 pl-3">
          {([
            { key: 'all', label: 'All' },
            { key: 'booked', label: 'Booked' },
            { key: 'unbooked', label: 'Not Booked' },
            { key: 'active', label: 'Active' },
            { key: 'inactive', label: 'Inactive' },
          ] as const).map(({ key, label }) => (
            <button key={key} onClick={() => setFilter(key)}
              className={`rounded px-2.5 py-1 text-[11px] font-semibold transition-colors ${filter === key ? 'bg-slate-900 text-white' : 'text-slate-500 hover:bg-slate-50 hover:text-slate-700'}`}>
              {label}
            </button>
          ))}
        </div>
        <div className="flex items-center gap-2 border-l border-slate-100 pl-3">
          <span className="text-[10px] font-bold uppercase tracking-widest text-slate-400">Term</span>
          <select value={selectedTermId} onChange={e => setSelectedTermId(e.target.value)}
            className="h-7 rounded border border-slate-200 bg-white px-2 text-xs font-semibold text-slate-700">
            {terms.length === 0 && <option value="">No terms</option>}
            {terms.map(term => <option key={term.id} value={term.id}>{term.name}</option>)}
          </select>
        </div>
        <div className="ml-auto text-[11px] text-slate-400">{filtered.length} of {students.length} students</div>
      </div>

      <div className="flex-1 overflow-auto">
        {loading ? (
          <div className="flex items-center justify-center py-24 gap-2 text-slate-400">
            <Loader2 size={16} className="animate-spin" />
            <span className="text-xs">Loading students…</span>
          </div>
        ) : (
          <table className="w-full text-left border-collapse">
            <thead className="sticky top-0 z-10 bg-white">
              <tr className="border-b border-slate-200">
                <th className="w-10 px-4 py-2.5">
                  <button onClick={toggleAll} className="flex items-center justify-center">
                    <div className={`h-3.5 w-3.5 rounded border ${allSelected ? 'border-slate-900 bg-slate-900' : 'border-slate-300'} flex items-center justify-center`}>
                      {allSelected && <Check size={9} strokeWidth={3} className="text-white" />}
                    </div>
                  </button>
                </th>
                <th className="px-3 py-2.5 text-[10px] font-bold uppercase tracking-widest text-slate-400 cursor-pointer hover:text-slate-600" onClick={() => handleSort('name')}>Name <SortIcon col="name" /></th>
                <th className="px-3 py-2.5 text-[10px] font-bold uppercase tracking-widest text-slate-400 cursor-pointer hover:text-slate-600" onClick={() => handleSort('grade')}>Grade <SortIcon col="grade" /></th>
                <th className="px-3 py-2.5 text-[10px] font-bold uppercase tracking-widest text-slate-400">Subject</th>
                <th className="px-3 py-2.5 text-[10px] font-bold uppercase tracking-widest text-slate-400 cursor-pointer hover:text-slate-600" onClick={() => handleSort('hours')}>Hours Left <SortIcon col="hours" /></th>
                <th className="px-3 py-2.5 text-[10px] font-bold uppercase tracking-widest text-slate-400">Booked</th>
                <th className="px-3 py-2.5 text-[10px] font-bold uppercase tracking-widest text-slate-400 cursor-pointer hover:text-slate-600" onClick={() => handleSort('attendance')}>Attendance <SortIcon col="attendance" /></th>
                <th className="w-24 px-3 py-2.5 text-[10px] font-bold uppercase tracking-widest text-slate-400">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-50">
              {filtered.map(student => {
                const stats = studentStats.get(student.id)
                const isBooked = bookedIds.has(student.id)
                const isActive = activeIds.has(student.id)
                const isSelected = selected.has(student.id)
                const isOpen = activeStudentId === student.id
                const subjects = normalizeStringArray(student.subjects).length > 0
                  ? normalizeStringArray(student.subjects)
                  : student.subject ? [String(student.subject)] : []
                return (
                  <tr key={student.id}
                    className={`group cursor-pointer transition-colors ${isOpen ? 'bg-slate-50' : 'hover:bg-slate-50/60'} ${isSelected ? 'bg-blue-50/40' : ''}`}
                    onClick={() => setActiveStudentId(isOpen ? null : student.id)}>
                    <td className="px-4 py-2.5" onClick={e => e.stopPropagation()}>
                      <button onClick={() => {
                        const next = new Set(selected)
                        next.has(student.id) ? next.delete(student.id) : next.add(student.id)
                        setSelected(next)
                      }} className="flex items-center justify-center">
                        <div className={`h-3.5 w-3.5 rounded border ${isSelected ? 'border-slate-900 bg-slate-900' : 'border-slate-300'} flex items-center justify-center`}>
                          {isSelected && <Check size={9} strokeWidth={3} className="text-white" />}
                        </div>
                      </button>
                    </td>
                    <td className="px-3 py-2.5">
                      <div className="flex items-center gap-2.5">
                        <div className="h-6 w-6 shrink-0 rounded bg-slate-900 flex items-center justify-center text-[10px] font-black text-white">{student.name.charAt(0)}</div>
                        <div>
                          <div className="flex items-center gap-1.5">
                            <span className="text-sm font-semibold text-slate-900">{student.name}</span>
                            {stats?.isAtRisk && <AlertTriangle size={10} className="text-red-400" />}
                          </div>
                          <span className={`text-[10px] font-medium ${isActive ? 'text-emerald-600' : 'text-slate-400'}`}>
                            {isActive ? '● Active' : '○ Inactive'}
                          </span>
                        </div>
                      </div>
                    </td>
                    <td className="px-3 py-2.5 text-sm text-slate-600">{student.grade ?? '—'}</td>
                    <td className="px-3 py-2.5">
                      <div className="flex flex-wrap gap-1">
                        {subjects.slice(0, 2).map((s: string, i: number) => <Badge key={i} color="blue">{s}</Badge>)}
                        {subjects.length > 2 && <Badge color="gray">+{subjects.length - 2}</Badge>}
                        {subjects.length === 0 && <span className="text-xs text-slate-300">—</span>}
                      </div>
                    </td>
                    <td className="px-3 py-2.5">
                      {student.hours_left != null
                        ? <span className={`text-sm font-semibold tabular-nums ${student.hours_left <= 2 ? 'text-red-500' : 'text-slate-700'}`}>{student.hours_left}h</span>
                        : <span className="text-slate-300 text-sm">—</span>}
                    </td>
                    <td className="px-3 py-2.5">
                      {isBooked ? <Badge color="green"><Check size={9} />Booked</Badge> : <Badge color="gray">Not booked</Badge>}
                    </td>
                    <td className="px-3 py-2.5"><AttBar rate={stats?.attendanceRate ?? null} /></td>
                    <td className="px-3 py-2.5" onClick={e => e.stopPropagation()}>
                      <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                        <button onClick={() => setActiveStudentId(isOpen ? null : student.id)}
                          className="rounded border border-slate-200 px-2 py-1 text-[10px] font-semibold text-slate-600 hover:bg-slate-50">
                          {isOpen ? 'Close' : 'View'}
                        </button>
                        <Link href={`/students/${student.id}`}
                          className="rounded border border-slate-200 px-2 py-1 text-[10px] font-semibold text-slate-600 hover:bg-slate-50">
                          History
                        </Link>
                      </div>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        )}
        {!loading && filtered.length === 0 && (
          <div className="flex flex-col items-center py-20 text-slate-400">
            <GraduationCap size={24} className="mb-3 text-slate-200" />
            <p className="text-sm font-semibold">No students found</p>
            {search && <p className="text-xs mt-1">Try a different search term</p>}
          </div>
        )}
      </div>

      {activeStudent && (
        <StudentSlideOver
          student={activeStudent}
          tutors={tutors}
          allSessions={allSessions}
          allAvailableSeats={allAvailableSeats}
          terms={terms}
          onClose={() => setActiveStudentId(null)}
          onRefetch={fetchData}
          onUpdateStudent={(updatedStudent) => {
            setStudents(prev => prev.map(st => {
              if (st.id !== updatedStudent.id) return st
              return {
                ...st,
                ...updatedStudent,
                subjects: Array.isArray(updatedStudent.subjects) ? updatedStudent.subjects : st.subjects,
                subject: typeof updatedStudent.subject === 'string' ? updatedStudent.subject : st.subject,
                availability_blocks: Array.isArray(updatedStudent.availability_blocks)
                  ? updatedStudent.availability_blocks
                  : Array.isArray(updatedStudent.availabilityBlocks)
                  ? updatedStudent.availabilityBlocks
                  : st.availability_blocks,
                hours_left: typeof updatedStudent.hours_left === 'number' ? updatedStudent.hours_left : st.hours_left,
                selected_term_id: typeof updatedStudent.selected_term_id === 'string'
                  ? updatedStudent.selected_term_id
                  : typeof updatedStudent.selectedTermId === 'string'
                  ? updatedStudent.selectedTermId
                  : st.selected_term_id,
              }
            }))
          }}
          onBookingSuccess={d => { setBookingToast(d); setTimeout(() => setBookingToast(null), 4000) }}
        />
      )}

      {showImport && <CSVImportModal onClose={() => setShowImport(false)} onImported={fetchData} />}
      {bookingToast && <BookingToast data={bookingToast} onClose={() => setBookingToast(null)} />}
      </div>
    </div>
  )
}