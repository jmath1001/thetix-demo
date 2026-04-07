'use client'
import { useState, useEffect, useRef, useCallback, useMemo } from 'react'
import {
  Loader2, Sparkles, CornerDownLeft, Clock, Calendar,
  ChevronRight, CheckCircle2, AlertCircle, Mail, Phone,
  User, ExternalLink, ArrowLeft, Zap,
} from 'lucide-react'
import { toISODate, dayOfWeek } from '@/lib/useScheduleData'
import { getSessionsForDay } from '@/components/constants'

interface CommandBarProps {
  sessions: any[]
  students: any[]
  tutors: any[]
  allAvailableSeats: any[]
  onBookingAction: (params: {
    studentId?: string
    slotDate?: string
    slotTime?: string
    tutorId?: string
    topic?: string
  }) => void
  onOpenProposal?: (proposal: any) => void
  onOpenAttendanceModal?: (session: any) => void
  weekStart?: string
  nextWeekStart?: string
}

type Result =
  | { type: 'answer'; text: string }
  | { type: 'slots'; slotIndices: number[]; reason: string }
  | { type: 'action'; action: string; studentId: string; slotDate: string; slotTime: string; tutorId: string; topic: string }
  | { type: 'student_contact'; studentId: string }
  | { type: 'student_sessions'; studentId: string }
  | { type: 'student_profile'; studentId: string }
  | { type: 'error'; text: string }

const PLACEHOLDERS = [
  "Show Maya's contact info...",
  "Find open Physics slots...",
  "John's upcoming sessions...",
  "Pull Sarah's session history...",
  "Open Math slots this week...",
]

// ── Tokens ────────────────────────────────────────────────────────────────────
const C = {
  bg: '#ffffff',
  surface: '#f8fafc',
  surfaceHover: '#f1f5f9',
  border: '#e2e8f0',
  borderStrong: '#cbd5e1',
  accent: '#dc2626',
  accentSoft: '#fef2f2',
  accentBorder: '#fecaca',
  green: '#16a34a',
  greenSoft: '#f0fdf4',
  greenBorder: '#bbf7d0',
  amber: '#d97706',
  amberSoft: '#fffbeb',
  textPrimary: '#0f172a',
  textSecondary: '#475569',
  textMuted: '#94a3b8',
  textTiny: '#cbd5e1',
}

// ── Pill ──────────────────────────────────────────────────────────────────────
function Pill({ children, color, bg, border }: { children: React.ReactNode; color: string; bg: string; border?: string }) {
  return (
    <span style={{
      display: 'inline-flex', alignItems: 'center', gap: 3,
      padding: '2px 8px', borderRadius: 20, fontSize: 10,
      fontWeight: 700, letterSpacing: '0.03em',
      background: bg, color,
      border: border ? `1px solid ${border}` : undefined,
    }}>{children}</span>
  )
}

// ── Section header ────────────────────────────────────────────────────────────
function Section({ label, count, accent }: { label: string; count?: number; accent?: boolean }) {
  return (
    <div style={{
      display: 'flex', alignItems: 'center', gap: 8,
      padding: '12px 20px 6px',
    }}>
      <span style={{
        fontSize: 10, fontWeight: 800, letterSpacing: '0.08em',
        textTransform: 'uppercase',
        color: accent ? '#6366f1' : C.textMuted,
      }}>{label}{count !== undefined ? ` · ${count}` : ''}</span>
      <span style={{ flex: 1, height: 1, background: C.border }} />
    </div>
  )
}

// ── Contact pill link ─────────────────────────────────────────────────────────
function ContactLink({ href, icon, label, sublabel }: { href: string; icon: React.ReactNode; label: string; sublabel: string }) {
  return (
    <a href={href} target={href.startsWith('http') ? '_blank' : undefined} rel="noopener noreferrer"
      style={{
        display: 'flex', alignItems: 'center', gap: 10,
        padding: '10px 14px', borderRadius: 10,
        background: C.surface, border: `1.5px solid ${C.border}`,
        textDecoration: 'none', transition: 'all 0.15s', flex: 1,
      }}
      onMouseEnter={e => { const el = e.currentTarget; el.style.borderColor = C.accent; el.style.background = C.accentSoft }}
      onMouseLeave={e => { const el = e.currentTarget; el.style.borderColor = C.border; el.style.background = C.surface }}
    >
      <span style={{ color: C.textMuted, display: 'flex', flexShrink: 0 }}>{icon}</span>
      <div style={{ minWidth: 0 }}>
        <div style={{ fontSize: 9, fontWeight: 700, color: C.textMuted, textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 1 }}>{sublabel}</div>
        <div style={{ fontSize: 12, fontWeight: 600, color: C.textPrimary, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{label}</div>
      </div>
    </a>
  )
}

// ── Student header ────────────────────────────────────────────────────────────
function StudentHeader({ student, onBook }: { student: any; onBook: () => void }) {
  const initials = student.name.split(' ').map((n: string) => n[0]).join('').slice(0, 2).toUpperCase()
  return (
    <div style={{
      display: 'flex', alignItems: 'center', gap: 14,
      padding: '16px 20px',
      borderBottom: `1.5px solid ${C.border}`,
      background: '#fff',
    }}>
      <div style={{
        width: 44, height: 44, borderRadius: 12,
        background: '#334155',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        fontWeight: 900, color: '#fff', fontSize: 15, flexShrink: 0,
        boxShadow: '0 2px 8px rgba(51,65,85,0.2)',
      }}>{initials}</div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 17, fontWeight: 800, color: C.textPrimary, letterSpacing: '-0.02em', lineHeight: 1.2 }}>{student.name}</div>
        <div style={{ display: 'flex', gap: 6, marginTop: 3, flexWrap: 'wrap' }}>
          {student.grade && <Pill color={C.textSecondary} bg={C.surface} border={C.border}>Gr. {student.grade}</Pill>}
          {student.subject && <Pill color={C.textSecondary} bg={C.surface} border={C.border}>{student.subject}</Pill>}
          {student.hoursLeft !== undefined && <Pill color={C.amber} bg={C.amberSoft}>{student.hoursLeft}h left</Pill>}
        </div>
      </div>
      <button onClick={onBook} style={{
        padding: '8px 16px', borderRadius: 8,
        background: '#1e293b', color: '#fff', border: 'none',
        fontSize: 12, fontWeight: 700, cursor: 'pointer',
        display: 'flex', alignItems: 'center', gap: 5,
        boxShadow: '0 2px 6px rgba(0,0,0,0.15)',
        transition: 'all 0.15s', flexShrink: 0,
      }}
        onMouseEnter={e => { (e.currentTarget as HTMLElement).style.transform = 'translateY(-1px)'; (e.currentTarget as HTMLElement).style.boxShadow = '0 4px 10px rgba(0,0,0,0.2)' }}
        onMouseLeave={e => { (e.currentTarget as HTMLElement).style.transform = 'none'; (e.currentTarget as HTMLElement).style.boxShadow = '0 2px 6px rgba(0,0,0,0.15)' }}
      >
        <Zap size={12} /> Book
      </button>
    </div>
  )
}

// ── Student Contact Card ──────────────────────────────────────────────────────
function StudentContactCard({ student, onBook }: { student: any; onBook: () => void }) {
  const hasStudent = student.email || student.phone
  const hasParent = student.parent_name || student.parent_email || student.parent_phone
  return (
    <div>
      <StudentHeader student={student} onBook={onBook} />
      <div style={{ background: C.bg }}>
        {hasStudent && (
          <>
            <Section label="Student" />
            <div style={{ padding: '0 20px 12px', display: 'flex', gap: 8 }}>
              {student.email && <ContactLink href={`mailto:${student.email}`} icon={<Mail size={13} />} label={student.email} sublabel="Email" />}
              {student.phone && <ContactLink href={`tel:${student.phone}`} icon={<Phone size={13} />} label={student.phone} sublabel="Phone" />}
            </div>
          </>
        )}
        {hasParent && (
          <>
            <Section label="Parent / Guardian" />
            <div style={{ padding: '0 20px 12px', display: 'flex', flexDirection: 'column', gap: 6 }}>
              {student.parent_name && (
                <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 14px', borderRadius: 10, background: C.surface, border: `1.5px solid ${C.border}` }}>
                  <User size={13} style={{ color: C.textMuted, flexShrink: 0 }} />
                  <div>
                    <div style={{ fontSize: 9, fontWeight: 700, color: C.textMuted, textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 1 }}>Name</div>
                    <div style={{ fontSize: 12, fontWeight: 600, color: C.textPrimary }}>{student.parent_name}</div>
                  </div>
                </div>
              )}
              <div style={{ display: 'flex', gap: 8 }}>
                {student.parent_email && <ContactLink href={`mailto:${student.parent_email}`} icon={<Mail size={13} />} label={student.parent_email} sublabel="Email" />}
                {student.parent_phone && <ContactLink href={`tel:${student.parent_phone}`} icon={<Phone size={13} />} label={student.parent_phone} sublabel="Phone" />}
              </div>
            </div>
          </>
        )}
        {student.bluebook_url && (
          <>
            <Section label="Bluebook" />
            <div style={{ padding: '0 20px 16px' }}>
              <ContactLink href={student.bluebook_url} icon={<ExternalLink size={13} />} label="Open in SharePoint" sublabel="Document" />
            </div>
          </>
        )}
        {!hasStudent && !hasParent && !student.bluebook_url && (
          <div style={{ padding: '24px 20px', color: C.textMuted, fontSize: 13, textAlign: 'center' }}>No contact info on file</div>
        )}
      </div>
    </div>
  )
}

// ── Student Sessions Card ─────────────────────────────────────────────────────
function StudentSessionsCard({ student, tutors, onOpenAttendanceModal, onBook }: {
  student: any; tutors: any[]
  onOpenAttendanceModal?: (session: any) => void; onBook: () => void
}) {
  const today = toISODate(new Date())
  const [studentSessions, setStudentSessions] = useState<any[]>([])
  const [fetchLoading, setFetchLoading] = useState(true)

  useEffect(() => {
    async function fetchAllSessions() {
      setFetchLoading(true)
      try {
        const p = process.env.NEXT_PUBLIC_TABLE_PREFIX ?? 'slake'
        const { supabase } = await import('@/lib/supabaseClient')
        const SS = `${p}_session_students`
        const SESS = `${p}_sessions`
        const { data, error } = await (supabase
          .from(SS)
          .select(`id, topic, status, notes, confirmation_status, ${SESS} ( id, session_date, tutor_id, time )`)
          .eq('student_id', student.id) as any)

        if (error) throw error

        const mapped = (data ?? []).map((ss: any) => {
          const s = Array.isArray(ss[SESS]) ? ss[SESS][0] : ss[SESS]
          if (!s) return null
          const dow = dayOfWeek(s.session_date)
          const block = getSessionsForDay(dow).find((b: any) => b.time === s.time)
          const tutor = tutors.find(t => t.id === s.tutor_id)
          return {
            id: s.id,
            date: s.session_date,
            tutorId: s.tutor_id,
            time: s.time,
            tutorName: tutor?.name ?? 'Unknown',
            blockLabel: block?.label ?? s.time,
            block: block ?? null,
            topic: ss.topic,
            status: ss.status,
            rowId: ss.id,
            isPast: s.session_date < today,
            dayName: ['', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', '', 'Saturday'][dow] ?? '',
            students: [{ id: student.id, name: student.name, topic: ss.topic, status: ss.status, rowId: ss.id, confirmationStatus: ss.confirmation_status ?? null, notes: ss.notes ?? null }],
          }
        }).filter(Boolean).sort((a: any, b: any) => b.date.localeCompare(a.date))

        setStudentSessions(mapped)
      } catch (err) {
        console.error('Failed to fetch student sessions:', err)
      } finally {
        setFetchLoading(false)
      }
    }
    fetchAllSessions()
  }, [student.id])

  const upcoming = studentSessions.filter((s: any) => !s.isPast)
  const past = studentSessions.filter((s: any) => s.isPast)

  const statusCfg = (status: string) => {
    if (status === 'present' || status === 'confirmed') return { color: C.green, bg: C.greenSoft, border: C.greenBorder, label: 'Present' }
    if (status === 'no-show') return { color: C.accent, bg: C.accentSoft, border: C.accentBorder, label: 'No-show' }
    return { color: C.textSecondary, bg: C.surface, border: C.border, label: 'Scheduled' }
  }

  const SessionRow = ({ s, showAttendance }: { s: any; showAttendance: boolean }) => {
    const d = new Date(s.date + 'T00:00:00')
    const cfg = statusCfg(s.status)
    return (
      <div style={{
        display: 'flex', alignItems: 'center', gap: 0,
        borderRadius: 10, overflow: 'hidden',
        border: `1.5px solid ${C.border}`,
        background: '#fff',
      }}>
        {/* Date block */}
        <div style={{
          width: 52, flexShrink: 0, textAlign: 'center',
          padding: '10px 0',
          background: s.isPast ? C.surface : '#f5f3ff',
          borderRight: `1.5px solid ${C.border}`,
        }}>
          <div style={{ fontSize: 8, fontWeight: 800, color: s.isPast ? C.textMuted : '#6366f1', textTransform: 'uppercase', letterSpacing: '0.08em' }}>
            {d.toLocaleDateString('en-US', { month: 'short' })}
          </div>
          <div style={{ fontSize: 20, fontWeight: 900, color: s.isPast ? C.textMuted : '#4f46e5', lineHeight: 1.1 }}>
            {d.getDate()}
          </div>
          <div style={{ fontSize: 8, color: s.isPast ? C.textTiny : C.accentBorder, fontWeight: 600 }}>
            {d.toLocaleDateString('en-US', { weekday: 'short' })}
          </div>
        </div>
        {/* Content */}
        <div style={{ flex: 1, padding: '10px 14px', minWidth: 0 }}>
          <div style={{ fontSize: 13, fontWeight: 700, color: s.isPast ? C.textSecondary : C.textPrimary, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{s.topic}</div>
          <div style={{ fontSize: 11, color: C.textMuted, marginTop: 2 }}>{s.tutorName} · {s.blockLabel}</div>
        </div>
        {/* Action */}
        <div style={{ padding: '0 12px', flexShrink: 0 }}>
          {showAttendance && s.status === 'scheduled' && onOpenAttendanceModal ? (
            <button
              onClick={() => onOpenAttendanceModal({
                id: s.id,
                date: s.date,
                tutorId: s.tutorId,
                tutorName: s.tutorName,
                time: s.time,
                block: s.block,
                dayName: s.dayName,
                students: s.students,
                activeStudent: { id: student.id, name: student.name, topic: s.topic, status: s.status, rowId: s.rowId, confirmationStatus: null, notes: null },
              })}
              style={{
                padding: '5px 12px', borderRadius: 6,
                border: `1.5px solid ${C.border}`,
                background: '#fff', color: C.textSecondary,
                fontSize: 11, fontWeight: 700, cursor: 'pointer',
                display: 'flex', alignItems: 'center', gap: 4, transition: 'all 0.15s',
              }}
              onMouseEnter={e => { const el = e.currentTarget; el.style.borderColor = C.green; el.style.color = C.green; el.style.background = C.greenSoft }}
              onMouseLeave={e => { const el = e.currentTarget; el.style.borderColor = C.border; el.style.color = C.textSecondary; el.style.background = '#fff' }}
            >
              <CheckCircle2 size={11} /> Mark
            </button>
          ) : (
            <Pill color={cfg.color} bg={cfg.bg} border={cfg.border}>{cfg.label}</Pill>
          )}
        </div>
      </div>
    )
  }

  return (
    <div>
      <StudentHeader student={student} onBook={onBook} />
      <div style={{ background: C.bg }}>
        {fetchLoading && (
          <div style={{ padding: '28px 20px', textAlign: 'center', color: C.textMuted, fontSize: 13, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8 }}>
            <Loader2 size={14} className="animate-spin" /> Loading sessions...
          </div>
        )}
        {!fetchLoading && studentSessions.length === 0 && (
          <div style={{ padding: '28px 20px', textAlign: 'center', color: C.textMuted, fontSize: 13 }}>No sessions yet</div>
        )}
        {upcoming.length > 0 && (
          <>
            <Section label="Upcoming" count={upcoming.length} accent />
            <div style={{ padding: '0 20px 12px', display: 'flex', flexDirection: 'column', gap: 6 }}>
              {upcoming.map((s: any, i: number) => <SessionRow key={i} s={s} showAttendance={false} />)}
            </div>
          </>
        )}
        {past.length > 0 && (
          <>
            <Section label="History" count={past.length} />
            <div style={{ padding: '0 20px 16px', display: 'flex', flexDirection: 'column', gap: 6 }}>
              {past.slice(0, 6).map((s: any, i: number) => <SessionRow key={i} s={s} showAttendance={true} />)}
              {past.length > 6 && (
                <div style={{ textAlign: 'center', fontSize: 11, color: C.textMuted, paddingTop: 2 }}>+{past.length - 6} more sessions</div>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  )
}

// ── Student Profile (tabbed) ──────────────────────────────────────────────────
function StudentProfileCard({ student, sessions, tutors, onOpenAttendanceModal, onBook }: {
  student: any; sessions: any[]; tutors: any[]
  onOpenAttendanceModal?: (session: any) => void; onBook: () => void
}) {
  const [tab, setTab] = useState<'sessions' | 'contact'>('sessions')
  return (
    <div>
      <StudentHeader student={student} onBook={onBook} />
      <div style={{ display: 'flex', borderBottom: `1.5px solid ${C.border}`, background: C.surface, padding: '0 20px' }}>
        {(['sessions', 'contact'] as const).map(t => (
          <button key={t} onClick={() => setTab(t)} style={{
            padding: '10px 0', marginRight: 24, fontSize: 11, fontWeight: 700,
            textTransform: 'uppercase', letterSpacing: '0.06em',
            border: 'none', background: 'none', cursor: 'pointer',
            color: tab === t ? C.accent : C.textMuted,
            borderBottom: `2px solid ${tab === t ? C.accent : 'transparent'}`,
            marginBottom: -1, transition: 'all 0.15s',
          }}>{t}</button>
        ))}
      </div>
      {tab === 'sessions'
        ? <StudentSessionsCard student={student} tutors={tutors} onOpenAttendanceModal={onOpenAttendanceModal} onBook={onBook} />
        : <StudentContactCard student={student} onBook={onBook} />}
    </div>
  )
}

// ── Main CommandBar ───────────────────────────────────────────────────────────
export function CommandBar({
  sessions = [], students = [], tutors = [], allAvailableSeats = [],
  onBookingAction, onOpenProposal, onOpenAttendanceModal,
}: CommandBarProps) {
  const [query, setQuery] = useState('')
  const [loading, setLoading] = useState(false)
  const [result, setResult] = useState<Result | null>(null)
  const [isFocused, setIsFocused] = useState(false)
  const [placeholderIdx, setPlaceholderIdx] = useState(0)
  const [placeholderVisible, setPlaceholderVisible] = useState(true)
  const inputRef = useRef<HTMLInputElement>(null)
  const containerRef = useRef<HTMLDivElement>(null)

  // Rotating placeholder
  useEffect(() => {
    if (isFocused || query) return
    const interval = setInterval(() => {
      setPlaceholderVisible(false)
      setTimeout(() => {
        setPlaceholderIdx(i => (i + 1) % PLACEHOLDERS.length)
        setPlaceholderVisible(true)
      }, 300)
    }, 3000)
    return () => clearInterval(interval)
  }, [isFocused, query])

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') { e.preventDefault(); inputRef.current?.focus() }
      if (e.key === 'Escape') { inputRef.current?.blur(); setResult(null); setIsFocused(false) }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  const buildContext = useCallback(() => ({
    today: toISODate(new Date()),
    students: students.map(s => ({
      id: s.id, name: s.name, subject: s.subject, grade: s.grade,
      hoursLeft: s.hoursLeft, email: s.email, phone: s.phone,
      parent_name: s.parent_name, parent_email: s.parent_email, parent_phone: s.parent_phone,
    })),
    availableSeats: allAvailableSeats.map(s => ({
      tutor: { name: s.tutor.name, id: s.tutor.id, subjects: s.tutor.subjects ?? [] },
      dayName: s.dayName, date: s.date, time: s.time,
      seatsLeft: s.seatsLeft, block: s.block,
    })),
  }), [students, allAvailableSeats])

  const runQuery = useCallback(async (q: string) => {
    if (!q.trim()) return
    setLoading(true); setResult(null)
    try {
      const res = await fetch('/api/command', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ query: q, context: buildContext() }),
      })
      const data: Result = await res.json()
      if (data.type === 'action' && (data as any).action === 'open_booking') {
        onBookingAction({ studentId: data.studentId, slotDate: data.slotDate, slotTime: data.slotTime, tutorId: data.tutorId, topic: data.topic })
        setResult(null); setQuery('')
        return
      }
      setResult(data)
    } catch {
      setResult({ type: 'error', text: 'Scheduler unreachable.' })
    } finally {
      setLoading(false)
    }
  }, [buildContext, onBookingAction])

  const showDropdown = !!(result || loading || (isFocused && !query))

  useEffect(() => {
    function handleClickAway(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setResult(null); setIsFocused(false)
      }
    }
    if (showDropdown) {
      document.addEventListener('mousedown', handleClickAway)
      return () => document.removeEventListener('mousedown', handleClickAway)
    }
  }, [showDropdown])

  const resolvedStudent = useMemo(() => {
    if (!result) return null
    if (result.type === 'student_contact' || result.type === 'student_sessions' || result.type === 'student_profile')
      return students.find(s => s.id === result.studentId) ?? null
    return null
  }, [result, students])

  const matchedSlots = result?.type === 'slots'
    ? (result.slotIndices ?? []).map((i: number) => allAvailableSeats[i]).filter(Boolean)
    : []

  const dismiss = () => { setResult(null); setQuery(''); inputRef.current?.focus() }
  const isStudentResult = result?.type === 'student_contact' || result?.type === 'student_sessions' || result?.type === 'student_profile'

  return (
    <div ref={containerRef} style={{ position: 'relative', width: '100%', maxWidth: '550px' }}>
      {showDropdown && (
        <div onClick={() => { setResult(null); setIsFocused(false) }}
          style={{ position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, zIndex: 999 }} />
      )}

      {/* ── Input bar ── */}
      <div style={{
        display: 'flex', alignItems: 'center', gap: 8, padding: '0 12px', height: '36px',
        background: '#fff', borderRadius: 10,
        border: isFocused ? '1.5px solid #8b5cf6' : '1.5px solid #c4b5fd',
        transition: 'all 0.2s',
        boxShadow: isFocused
          ? '0 0 0 3px rgba(139,92,246,0.25), 0 0 24px rgba(139,92,246,0.22), 0 4px 12px rgba(0,0,0,0.08)'
          : '0 0 0 2px rgba(139,92,246,0.22), 0 0 14px rgba(139,92,246,0.16), 0 2px 8px rgba(0,0,0,0.06)',
      }}>
        <Sparkles size={14} style={{ color: '#8b5cf6', flexShrink: 0 }} />
        <div style={{ flex: 1, position: 'relative', height: '100%', display: 'flex', alignItems: 'center' }}>
          <input
            ref={inputRef}
            value={query}
            onFocus={() => setIsFocused(true)}
            onBlur={() => setTimeout(() => setIsFocused(false), 200)}
            onChange={e => setQuery(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter') runQuery(query) }}
            style={{
              width: '100%', fontSize: '13px', border: 'none', outline: 'none',
              background: 'transparent', color: C.textPrimary, fontWeight: 500,
            }}
          />
          {/* Rotating placeholder shown when input empty */}
          {!query && (
            <span style={{
              position: 'absolute', left: 0, pointerEvents: 'none',
              fontSize: 13, color: C.textMuted, fontWeight: 400,
              opacity: placeholderVisible ? 1 : 0,
              transform: placeholderVisible ? 'translateY(0)' : 'translateY(4px)',
              transition: 'opacity 0.25s ease, transform 0.25s ease',
            }}>
              {PLACEHOLDERS[placeholderIdx]}
            </span>
          )}
        </div>
        {!query && !isFocused && (
          <kbd style={{ fontSize: 9, padding: '2px 6px', borderRadius: 5, background: C.surface, color: C.textMuted, border: `1px solid ${C.border}`, fontWeight: 700, flexShrink: 0 }}>⌘K</kbd>
        )}
        {query && !loading && (
          <div onClick={() => runQuery(query)} style={{ cursor: 'pointer', display: 'flex', alignItems: 'center', color: C.accent, fontWeight: 700, fontSize: 11, gap: 3, flexShrink: 0 }}>
            RUN <CornerDownLeft size={11} />
          </div>
        )}
        {loading && <Loader2 size={13} className="animate-spin" style={{ color: C.accent, flexShrink: 0 }} />}
      </div>

      {/* ── Floating panel ── */}
      {showDropdown && (
        <div style={{
          position: 'fixed', top: '72px', left: '50%', transform: 'translateX(-50%)',
          width: '95%', maxWidth: '680px',
          background: C.bg, borderRadius: 14,
          border: `1.5px solid ${C.border}`,
          boxShadow: '0 20px 48px -8px rgba(0,0,0,0.12), 0 4px 12px rgba(0,0,0,0.06)',
          zIndex: 1000, overflow: 'hidden',
          maxHeight: '480px',
          display: 'flex', flexDirection: 'column',
        }}>
          <div style={{ overflowY: 'auto', flex: 1 }}>

            {/* Suggestions while idle */}
            {isFocused && !query && !result && !loading && (
              <div style={{ padding: '16px 20px' }}>
                <div style={{ fontSize: 10, fontWeight: 700, color: C.textMuted, textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 10 }}>Try asking</div>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 7 }}>
                  {PLACEHOLDERS.map(s => (
                    <button key={s} onClick={() => { setQuery(s.replace('...', '')); runQuery(s.replace('...', '')) }}
                      style={{
                        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                        padding: '10px 14px', borderRadius: 9,
                        background: C.surface, border: `1.5px solid ${C.border}`,
                        textAlign: 'left', cursor: 'pointer', transition: 'all 0.15s',
                      }}
                      onMouseEnter={e => { const el = e.currentTarget; el.style.borderColor = C.accent; el.style.background = C.accentSoft }}
                      onMouseLeave={e => { const el = e.currentTarget; el.style.borderColor = C.border; el.style.background = C.surface }}>
                      <span style={{ fontSize: 12, color: C.textSecondary, fontWeight: 600 }}>{s.replace('...', '')}</span>
                      <ChevronRight size={13} style={{ color: C.textTiny, flexShrink: 0 }} />
                    </button>
                  ))}
                </div>
              </div>
            )}

            {/* Loading */}
            {loading && !result && (
              <div style={{ padding: '48px 24px', textAlign: 'center' }}>
                <Loader2 size={26} className="animate-spin" style={{ color: C.accent, margin: '0 auto 12px' }} />
                <p style={{ fontWeight: 600, color: C.textSecondary, fontSize: 13 }}>Looking that up...</p>
              </div>
            )}

            {/* Student results */}
            {result?.type === 'student_contact' && resolvedStudent && (
              <StudentContactCard student={resolvedStudent} onBook={() => { onBookingAction({ studentId: resolvedStudent.id }); dismiss() }} />
            )}
            {result?.type === 'student_sessions' && resolvedStudent && (
              <StudentSessionsCard student={resolvedStudent} tutors={tutors}
                onOpenAttendanceModal={s => { onOpenAttendanceModal?.(s); dismiss() }}
                onBook={() => { onBookingAction({ studentId: resolvedStudent.id }); dismiss() }} />
            )}
            {result?.type === 'student_profile' && resolvedStudent && (
              <StudentProfileCard student={resolvedStudent} sessions={sessions} tutors={tutors}
                onOpenAttendanceModal={s => { onOpenAttendanceModal?.(s); dismiss() }}
                onBook={() => { onBookingAction({ studentId: resolvedStudent.id }); dismiss() }} />
            )}
            {isStudentResult && !resolvedStudent && (
              <div style={{ padding: '24px 20px', display: 'flex', gap: 10, alignItems: 'center', color: C.textMuted }}>
                <AlertCircle size={16} />
                <span style={{ fontSize: 13, fontWeight: 600 }}>Student not found</span>
              </div>
            )}

            {/* Answer */}
            {result?.type === 'answer' && (
              <div style={{ padding: '20px', display: 'flex', gap: 12, alignItems: 'flex-start' }}>
                <CheckCircle2 size={16} style={{ color: C.green, flexShrink: 0, marginTop: 2 }} />
                <span style={{ fontSize: 13, color: C.textSecondary, lineHeight: 1.6 }}>{result.text}</span>
              </div>
            )}

            {/* Slots */}
            {result?.type === 'slots' && (
              <div style={{ padding: '20px' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 }}>
                  <div>
                    <div style={{ fontSize: 15, fontWeight: 800, color: C.textPrimary, letterSpacing: '-0.01em' }}>Open Slots</div>
                    <div style={{ fontSize: 12, color: C.textMuted, marginTop: 2 }}>{result.reason}</div>
                  </div>
                  <Pill color={C.accent} bg={C.accentSoft} border={C.accentBorder}>{matchedSlots.length} found</Pill>
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(190px, 1fr))', gap: 8 }}>
                  {matchedSlots.map((slot: any, i: number) => (
                    <button key={i}
                      onClick={() => { onBookingAction({ slotDate: slot.date, slotTime: slot.time, tutorId: slot.tutor?.id }); dismiss() }}
                      style={{
                        textAlign: 'left', padding: '12px 14px', borderRadius: 10,
                        border: `1.5px solid ${C.border}`, background: '#fff',
                        cursor: 'pointer', transition: 'all 0.15s',
                      }}
                      onMouseEnter={e => { const el = e.currentTarget; el.style.borderColor = C.accent; el.style.background = C.accentSoft; el.style.transform = 'translateY(-1px)' }}
                      onMouseLeave={e => { const el = e.currentTarget; el.style.borderColor = C.border; el.style.background = '#fff'; el.style.transform = 'none' }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
                        <span style={{ fontSize: 10, fontWeight: 700, color: C.textSecondary, display: 'flex', alignItems: 'center', gap: 3 }}>
                          <Clock size={9} style={{ color: C.textMuted }} /> {slot.block?.label ?? slot.time}
                        </span>
                        <div style={{ display: 'flex', gap: 2 }}>
                          {[...Array(3)].map((_, idx) => (
                            <div key={idx} style={{ width: 4, height: 12, borderRadius: 2, background: idx < (3 - slot.seatsLeft) ? C.border : C.accent }} />
                          ))}
                        </div>
                      </div>
                      <div style={{ fontWeight: 700, fontSize: 13, color: C.textPrimary }}>{slot.tutor.name}</div>
                      <div style={{ fontSize: 11, color: C.textMuted, marginTop: 4, display: 'flex', alignItems: 'center', gap: 4 }}>
                        <Calendar size={10} /> {slot.dayName} · {slot.date}
                      </div>
                    </button>
                  ))}
                </div>
              </div>
            )}

            {/* Error */}
            {result?.type === 'error' && (
              <div style={{ padding: '20px', display: 'flex', gap: 10, alignItems: 'center', color: C.accent }}>
                <AlertCircle size={16} />
                <span style={{ fontSize: 13, fontWeight: 600 }}>{result.text}</span>
              </div>
            )}
          </div>

          {/* Footer */}
          {result && (
            <div style={{
              padding: '10px 20px', borderTop: `1.5px solid ${C.border}`,
              background: C.surface,
              display: 'flex', justifyContent: 'space-between', alignItems: 'center',
            }}>
              <button onClick={dismiss} style={{
                background: 'none', border: 'none', color: C.textMuted,
                fontSize: 11, cursor: 'pointer', fontWeight: 700,
                display: 'flex', alignItems: 'center', gap: 5,
                textTransform: 'uppercase', letterSpacing: '0.06em', transition: 'color 0.15s',
              }}
                onMouseEnter={e => { (e.currentTarget as HTMLElement).style.color = C.accent }}
                onMouseLeave={e => { (e.currentTarget as HTMLElement).style.color = C.textMuted }}
              >
                <ArrowLeft size={10} /> New search
              </button>
              <span style={{ fontSize: 9, color: C.textTiny, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.08em' }}>ESC to close</span>
            </div>
          )}
        </div>
      )}
    </div>
  )
}