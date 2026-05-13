'use client'
import { useState, useEffect, useRef, useCallback, useMemo } from 'react'
import {
  Loader2, Sparkles, CornerDownLeft, Clock, Calendar,
  ChevronRight, CheckCircle2, AlertCircle, Mail, Phone,
  User, ExternalLink, ArrowLeft, Zap,
} from 'lucide-react'
import { toISODate, dayOfWeek } from '@/lib/useScheduleData'
import { getSessionsForDay } from '@/components/constants'
import { logEvent } from '@/lib/analytics'

interface CommandBarProps {
  sessions: any[]
  students: any[]
  tutors: any[]
  timeOff?: any[]
  allAvailableSeats: any[]
  onDataChanged?: () => void | Promise<void>
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

type PendingAction = {
  capability:
    | 'create_time_off_range'
    | 'update_student_contact'
    | 'move_session_with_conflict_check'
    | 'book_student_with_optimization'
    | 'delete_student_booking_with_optimization'
    | 'manage_tutor_schedule'
  params: any
}

type CapabilityPreview = {
  type: 'capability_preview'
  capability: PendingAction['capability']
  summary: string
  risk: 'low' | 'medium' | 'high'
  requiresConfirmation: boolean
  preview: any
  pendingAction: PendingAction
}

type ActionApplied = {
  type: 'action_applied'
  summary: string
  detail?: string
}

type Result =
  | { type: 'answer'; text: string }
  | { type: 'slots'; slotIndices: number[]; reason: string }
  | { type: 'action'; action: string; studentId: string; slotDate: string; slotTime: string; tutorId: string; topic: string }
  | { type: 'student_contact'; studentId: string }
  | { type: 'student_sessions'; studentId: string }
  | { type: 'student_profile'; studentId: string }
  | CapabilityPreview
  | ActionApplied
  | { type: 'error'; text: string }

const PLACEHOLDERS = [
  "Search by subject: Algebra openings",
  "Search student record: Maya Thompson",
  "Find contact info for John Park",
  "Show Sarah Nguyen session history",
  "Find open Chemistry slots this week",
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
  const hoursLeft = student.hoursLeft ?? student.hours_left
  const primarySubject = Array.isArray(student.subjects) && student.subjects.length > 0
    ? student.subjects[0]
    : student.subject
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
          {primarySubject && <Pill color={C.textSecondary} bg={C.surface} border={C.border}>{primarySubject}</Pill>}
          {hoursLeft !== undefined && hoursLeft !== null && <Pill color={C.amber} bg={C.amberSoft}>{hoursLeft}h left</Pill>}
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
  const hasMom = student.mom_name || student.mom_email || student.mom_phone
  const hasDad = student.dad_name || student.dad_email || student.dad_phone
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
        {hasMom && (
          <>
            <Section label="Mom" />
            <div style={{ padding: '0 20px 12px', display: 'flex', flexDirection: 'column', gap: 6 }}>
              {student.mom_name && (
                <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 14px', borderRadius: 10, background: C.surface, border: `1.5px solid ${C.border}` }}>
                  <User size={13} style={{ color: C.textMuted, flexShrink: 0 }} />
                  <div>
                    <div style={{ fontSize: 9, fontWeight: 700, color: C.textMuted, textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 1 }}>Name</div>
                    <div style={{ fontSize: 12, fontWeight: 600, color: C.textPrimary }}>{student.mom_name}</div>
                  </div>
                </div>
              )}
              <div style={{ display: 'flex', gap: 8 }}>
                {student.mom_email && <ContactLink href={`mailto:${student.mom_email}`} icon={<Mail size={13} />} label={student.mom_email} sublabel="Email" />}
                {student.mom_phone && <ContactLink href={`tel:${student.mom_phone}`} icon={<Phone size={13} />} label={student.mom_phone} sublabel="Phone" />}
              </div>
            </div>
          </>
        )}
        {hasDad && (
          <>
            <Section label="Dad" />
            <div style={{ padding: '0 20px 12px', display: 'flex', flexDirection: 'column', gap: 6 }}>
              {student.dad_name && (
                <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 14px', borderRadius: 10, background: C.surface, border: `1.5px solid ${C.border}` }}>
                  <User size={13} style={{ color: C.textMuted, flexShrink: 0 }} />
                  <div>
                    <div style={{ fontSize: 9, fontWeight: 700, color: C.textMuted, textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 1 }}>Name</div>
                    <div style={{ fontSize: 12, fontWeight: 600, color: C.textPrimary }}>{student.dad_name}</div>
                  </div>
                </div>
              )}
              <div style={{ display: 'flex', gap: 8 }}>
                {student.dad_email && <ContactLink href={`mailto:${student.dad_email}`} icon={<Mail size={13} />} label={student.dad_email} sublabel="Email" />}
                {student.dad_phone && <ContactLink href={`tel:${student.dad_phone}`} icon={<Phone size={13} />} label={student.dad_phone} sublabel="Phone" />}
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
        {!hasStudent && !hasMom && !hasDad && !student.bluebook_url && (
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
        const { supabase } = await import('@/lib/supabaseClient')
        const { DB, withCenter } = await import('@/lib/db')
        const SS = DB.sessionStudents
        const SESS = DB.sessions
        const { data, error } = await (withCenter(supabase
          .from(SS)
          .select(`id, topic, status, notes, confirmation_status, ${SESS} ( id, session_date, tutor_id, time )`)
          .eq('student_id', student.id)) as any)

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
  const [tab, setTab] = useState<'overview' | 'sessions' | 'contact'>('overview')
  const hoursLeft = student.hoursLeft ?? student.hours_left
  const studentSessions = useMemo(
    () => sessions
      .filter((s: any) => (s.students ?? []).some((st: any) => st.id === student.id))
      .sort((a: any, b: any) => b.date.localeCompare(a.date)),
    [sessions, student.id]
  )

  const upcomingCount = studentSessions.filter((s: any) => s.date >= toISODate(new Date())).length
  const pastCount = studentSessions.length - upcomingCount

  return (
    <div>
      <StudentHeader student={student} onBook={onBook} />
      <div style={{ display: 'flex', borderBottom: `1.5px solid ${C.border}`, background: C.surface, padding: '0 20px' }}>
        {(['overview', 'sessions', 'contact'] as const).map(t => (
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
      {tab === 'overview' && (
        <div style={{ background: C.bg }}>
          <Section label="Profile snapshot" accent />
          <div style={{ padding: '0 20px 14px', display: 'grid', gridTemplateColumns: 'repeat(3, minmax(0, 1fr))', gap: 8 }}>
            <div style={{ border: `1.5px solid ${C.border}`, borderRadius: 10, background: '#fff', padding: '10px 12px' }}>
              <div style={{ fontSize: 9, fontWeight: 700, color: C.textMuted, textTransform: 'uppercase', letterSpacing: '0.08em' }}>Hours left</div>
              <div style={{ marginTop: 3, fontSize: 16, fontWeight: 800, color: C.textPrimary }}>{hoursLeft ?? '—'}</div>
            </div>
            <div style={{ border: `1.5px solid ${C.border}`, borderRadius: 10, background: '#fff', padding: '10px 12px' }}>
              <div style={{ fontSize: 9, fontWeight: 700, color: C.textMuted, textTransform: 'uppercase', letterSpacing: '0.08em' }}>Upcoming</div>
              <div style={{ marginTop: 3, fontSize: 16, fontWeight: 800, color: C.textPrimary }}>{upcomingCount}</div>
            </div>
            <div style={{ border: `1.5px solid ${C.border}`, borderRadius: 10, background: '#fff', padding: '10px 12px' }}>
              <div style={{ fontSize: 9, fontWeight: 700, color: C.textMuted, textTransform: 'uppercase', letterSpacing: '0.08em' }}>Session history</div>
              <div style={{ marginTop: 3, fontSize: 16, fontWeight: 800, color: C.textPrimary }}>{pastCount}</div>
            </div>
          </div>

          <Section label="Contact" />
          <div style={{ padding: '0 20px 12px', display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
            <div style={{ border: `1.5px solid ${C.border}`, borderRadius: 10, background: '#fff', padding: '10px 12px' }}>
              <div style={{ fontSize: 9, fontWeight: 700, color: C.textMuted, textTransform: 'uppercase', letterSpacing: '0.08em' }}>Student email</div>
              <div style={{ marginTop: 3, fontSize: 12, fontWeight: 600, color: C.textPrimary }}>{student.email || 'Not on file'}</div>
            </div>
            <div style={{ border: `1.5px solid ${C.border}`, borderRadius: 10, background: '#fff', padding: '10px 12px' }}>
              <div style={{ fontSize: 9, fontWeight: 700, color: C.textMuted, textTransform: 'uppercase', letterSpacing: '0.08em' }}>Student phone</div>
              <div style={{ marginTop: 3, fontSize: 12, fontWeight: 600, color: C.textPrimary }}>{student.phone || 'Not on file'}</div>
            </div>
            <div style={{ border: `1.5px solid ${C.border}`, borderRadius: 10, background: '#fff', padding: '10px 12px' }}>
              <div style={{ fontSize: 9, fontWeight: 700, color: C.textMuted, textTransform: 'uppercase', letterSpacing: '0.08em' }}>Mom</div>
              <div style={{ marginTop: 3, fontSize: 12, fontWeight: 600, color: C.textPrimary }}>{student.mom_name || student.mom_phone || student.mom_email || 'Not on file'}</div>
            </div>
            <div style={{ border: `1.5px solid ${C.border}`, borderRadius: 10, background: '#fff', padding: '10px 12px' }}>
              <div style={{ fontSize: 9, fontWeight: 700, color: C.textMuted, textTransform: 'uppercase', letterSpacing: '0.08em' }}>Dad</div>
              <div style={{ marginTop: 3, fontSize: 12, fontWeight: 600, color: C.textPrimary }}>{student.dad_name || student.dad_phone || student.dad_email || 'Not on file'}</div>
            </div>
          </div>
        </div>
      )}
      {tab === 'sessions' && <StudentSessionsCard student={student} tutors={tutors} onOpenAttendanceModal={onOpenAttendanceModal} onBook={onBook} />}
      {tab === 'contact' && <StudentContactCard student={student} onBook={onBook} />}
    </div>
  )
}

// ── Main CommandBar ───────────────────────────────────────────────────────────
export function CommandBar({
  sessions = [], students = [], tutors = [], timeOff = [], allAvailableSeats = [],
  onDataChanged,
  onBookingAction, onOpenProposal, onOpenAttendanceModal,
}: CommandBarProps) {
  const [query, setQuery] = useState('')
  const [loading, setLoading] = useState(false)
  const [isExecuting, setIsExecuting] = useState(false)
  const [result, setResult] = useState<Result | null>(null)
  const [isFocused, setIsFocused] = useState(false)
  const [placeholderIdx, setPlaceholderIdx] = useState(0)
  const [typedPlaceholder, setTypedPlaceholder] = useState('')
  const [isDeletingPlaceholder, setIsDeletingPlaceholder] = useState(false)
  const [showPlaceholderCaret, setShowPlaceholderCaret] = useState(true)
  const inputRef = useRef<HTMLInputElement>(null)
  const containerRef = useRef<HTMLDivElement>(null)
  const lastLoggedSearchRef = useRef('')

  // Typing placeholder animation while idle
  useEffect(() => {
    if (isFocused || query) {
      setTypedPlaceholder('')
      setIsDeletingPlaceholder(false)
      return
    }

    const target = PLACEHOLDERS[placeholderIdx]
    const timeout = setTimeout(() => {
      if (!isDeletingPlaceholder && typedPlaceholder.length < target.length) {
        setTypedPlaceholder(target.slice(0, typedPlaceholder.length + 1))
        return
      }

      if (!isDeletingPlaceholder && typedPlaceholder.length === target.length) {
        setIsDeletingPlaceholder(true)
        return
      }

      if (isDeletingPlaceholder && typedPlaceholder.length > 0) {
        setTypedPlaceholder(target.slice(0, typedPlaceholder.length - 1))
        return
      }

      setIsDeletingPlaceholder(false)
      setPlaceholderIdx(i => (i + 1) % PLACEHOLDERS.length)
    }, !isDeletingPlaceholder && typedPlaceholder.length === target.length ? 1300 : isDeletingPlaceholder ? 22 : 40)

    return () => clearTimeout(timeout)
  }, [isFocused, query, placeholderIdx, typedPlaceholder, isDeletingPlaceholder])

  useEffect(() => {
    if (isFocused || query) {
      setShowPlaceholderCaret(false)
      return
    }
    setShowPlaceholderCaret(true)
    const interval = setInterval(() => {
      setShowPlaceholderCaret(v => !v)
    }, 500)
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

  useEffect(() => {
    const trimmed = query.trim()
    if (!trimmed) return

    const timeout = window.setTimeout(() => {
      if (trimmed === lastLoggedSearchRef.current) return
      lastLoggedSearchRef.current = trimmed
      logEvent('command_search_input', {
        query: trimmed,
        length: trimmed.length,
        source: 'command_bar',
      })
    }, 500)

    return () => window.clearTimeout(timeout)
  }, [query])

  const buildContext = useCallback(() => ({
    today: toISODate(new Date()),
    students: students.map(s => ({
      id: s.id, name: s.name, subject: s.subject, grade: s.grade,
      hoursLeft: s.hoursLeft, email: s.email, phone: s.phone,
      parent_name: s.parent_name,
      parent_email: s.parent_email,
      parent_phone: s.parent_phone,
      mom_name: s.mom_name, mom_email: s.mom_email, mom_phone: s.mom_phone,
      dad_name: s.dad_name, dad_email: s.dad_email, dad_phone: s.dad_phone,
      bluebook_url: s.bluebook_url,
    })),
    tutors: tutors.map(t => ({
      id: t.id,
      name: t.name,
      subjects: t.subjects ?? [],
      availability: t.availability ?? [],
      availabilityBlocks: t.availabilityBlocks ?? [],
    })),
    sessions: sessions.map(session => ({
      id: session.id,
      date: session.date,
      tutorId: session.tutorId,
      time: session.time,
      students: (session.students ?? []).map((st: any) => ({
        rowId: st.rowId,
        id: st.id,
        name: st.name,
        topic: st.topic,
        status: st.status,
      })),
    })),
    timeOff: timeOff.map(entry => ({
      id: entry.id,
      tutorId: entry.tutorId,
      date: entry.date,
      note: entry.note,
    })),
    availableSeats: allAvailableSeats.map(s => ({
      tutor: { name: s.tutor.name, id: s.tutor.id, subjects: s.tutor.subjects ?? [] },
      dayName: s.dayName, date: s.date, time: s.time,
      seatsLeft: s.seatsLeft, block: s.block,
    })),
  }), [students, tutors, sessions, timeOff, allAvailableSeats])

  const runQuery = useCallback(async (q: string) => {
    const trimmed = q.trim()
    if (!trimmed) return
    logEvent('command_search_submitted', {
      query: trimmed,
      length: trimmed.length,
      source: 'command_bar',
    })
    setLoading(true); setResult(null)
    try {
      const res = await fetch('/api/command', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ query: trimmed, context: buildContext(), mode: 'draft' }),
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

  const confirmPendingAction = useCallback(async () => {
    if (!result || result.type !== 'capability_preview') return
    setIsExecuting(true)
    try {
      const res = await fetch('/api/command', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          mode: 'execute',
          pendingAction: result.pendingAction,
          context: buildContext(),
        }),
      })
      const data: Result = await res.json()
      setResult(data)
      if (data.type === 'action_applied') {
        await Promise.resolve(onDataChanged?.())
      }
    } catch {
      setResult({ type: 'error', text: 'Failed to apply command.' })
    } finally {
      setIsExecuting(false)
    }
  }, [result, buildContext, onDataChanged])

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
    <div ref={containerRef} style={{ position: 'relative', width: '100%', maxWidth: '680px' }}>
      {showDropdown && (
        <div onClick={() => { setResult(null); setIsFocused(false) }}
          style={{ position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, zIndex: 999 }} />
      )}

      {/* ── Input bar ── */}
      <div style={{
        display: 'flex', alignItems: 'center', gap: 8, padding: '0 10px', height: '34px',
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
              display: 'inline-flex', alignItems: 'center',
            }}>
              {typedPlaceholder}
              <span style={{ opacity: showPlaceholderCaret ? 1 : 0, transition: 'opacity 0.12s linear' }}>|</span>
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
          width: '95%', maxWidth: '860px',
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
                    <button key={s} onClick={() => { setQuery(s); runQuery(s) }}
                      style={{
                        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                        padding: '10px 14px', borderRadius: 9,
                        background: C.surface, border: `1.5px solid ${C.border}`,
                        textAlign: 'left', cursor: 'pointer', transition: 'all 0.15s',
                      }}
                      onMouseEnter={e => { const el = e.currentTarget; el.style.borderColor = C.accent; el.style.background = C.accentSoft }}
                      onMouseLeave={e => { const el = e.currentTarget; el.style.borderColor = C.border; el.style.background = C.surface }}>
                      <span style={{ fontSize: 12, color: C.textSecondary, fontWeight: 600 }}>{s}</span>
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

            {/* Capability preview */}
            {result?.type === 'capability_preview' && (
              <div style={{ padding: '20px' }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, marginBottom: 10 }}>
                  <div style={{ fontSize: 15, fontWeight: 800, color: C.textPrimary }}>Review changes</div>
                  <Pill
                    color={result.risk === 'high' ? C.accent : result.risk === 'medium' ? C.amber : C.green}
                    bg={result.risk === 'high' ? C.accentSoft : result.risk === 'medium' ? C.amberSoft : C.greenSoft}
                    border={result.risk === 'high' ? C.accentBorder : result.risk === 'medium' ? '#fde68a' : C.greenBorder}
                  >
                    {result.risk.toUpperCase()} RISK
                  </Pill>
                </div>
                <div style={{ fontSize: 13, color: C.textSecondary, lineHeight: 1.5, marginBottom: 12 }}>{result.summary}</div>

                {result.preview?.kind === 'time_off_range' && (
                  <div style={{ border: `1.5px solid ${C.border}`, borderRadius: 10, background: C.surface, padding: '12px 14px', marginBottom: 12 }}>
                    <div style={{ fontSize: 12, fontWeight: 700, color: C.textPrimary }}>{result.preview.tutorName}</div>
                    <div style={{ fontSize: 11, color: C.textMuted, marginTop: 3 }}>
                      {result.preview.startDate} to {result.preview.endDate}
                    </div>
                    <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: 8 }}>
                      <Pill color={C.green} bg={C.greenSoft} border={C.greenBorder}>{(result.preview.toInsertDates ?? []).length} to add</Pill>
                      <Pill color={C.textSecondary} bg={C.surface} border={C.border}>{(result.preview.alreadyBlockedDates ?? []).length} already blocked</Pill>
                      <Pill color={C.amber} bg={C.amberSoft} border={'#fde68a'}>{(result.preview.impactedSessions ?? []).length} sessions impacted</Pill>
                    </div>
                    {(result.preview.impactedSessions ?? []).slice(0, 5).map((impact: any, idx: number) => (
                      <div key={idx} style={{ marginTop: 8, fontSize: 11, color: C.textSecondary }}>
                        {impact.date} {impact.time} - {impact.studentCount} student{impact.studentCount === 1 ? '' : 's'}
                      </div>
                    ))}
                  </div>
                )}

                {result.preview?.kind === 'student_contact_diff' && (
                  <div style={{ border: `1.5px solid ${C.border}`, borderRadius: 10, background: C.surface, padding: '12px 14px', marginBottom: 12 }}>
                    <div style={{ fontSize: 12, fontWeight: 700, color: C.textPrimary }}>{result.preview.studentName}</div>
                    <div style={{ fontSize: 11, color: C.textMuted, marginTop: 3, textTransform: 'capitalize' }}>
                      {String(result.preview.field ?? '').replaceAll('_', ' ')}
                    </div>
                    <div style={{ marginTop: 8, display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
                      <div style={{ border: `1.5px solid ${C.border}`, borderRadius: 8, background: '#fff', padding: '8px 10px' }}>
                        <div style={{ fontSize: 9, fontWeight: 700, color: C.textMuted, textTransform: 'uppercase', letterSpacing: '0.08em' }}>Before</div>
                        <div style={{ marginTop: 3, fontSize: 12, color: C.textSecondary }}>{result.preview.beforeValue || 'Empty'}</div>
                      </div>
                      <div style={{ border: `1.5px solid ${C.greenBorder}`, borderRadius: 8, background: '#fff', padding: '8px 10px' }}>
                        <div style={{ fontSize: 9, fontWeight: 700, color: C.green, textTransform: 'uppercase', letterSpacing: '0.08em' }}>After</div>
                        <div style={{ marginTop: 3, fontSize: 12, color: C.textPrimary }}>{result.preview.afterValue || 'Empty'}</div>
                      </div>
                    </div>
                  </div>
                )}

                {result.preview?.kind === 'session_move' && (
                  <div style={{ border: `1.5px solid ${C.border}`, borderRadius: 10, background: C.surface, padding: '12px 14px', marginBottom: 12 }}>
                    <div style={{ fontSize: 12, fontWeight: 700, color: C.textPrimary }}>{result.preview.studentName}</div>
                    <div style={{ marginTop: 8, display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
                      <div style={{ border: `1.5px solid ${C.border}`, borderRadius: 8, background: '#fff', padding: '8px 10px' }}>
                        <div style={{ fontSize: 9, fontWeight: 700, color: C.textMuted, textTransform: 'uppercase', letterSpacing: '0.08em' }}>From</div>
                        <div style={{ marginTop: 3, fontSize: 12, color: C.textSecondary }}>{result.preview.fromTutorName}</div>
                        <div style={{ marginTop: 2, fontSize: 11, color: C.textMuted }}>{result.preview.fromDate} {result.preview.fromTime}</div>
                      </div>
                      <div style={{ border: `1.5px solid ${C.greenBorder}`, borderRadius: 8, background: '#fff', padding: '8px 10px' }}>
                        <div style={{ fontSize: 9, fontWeight: 700, color: C.green, textTransform: 'uppercase', letterSpacing: '0.08em' }}>To</div>
                        <div style={{ marginTop: 3, fontSize: 12, color: C.textPrimary }}>{result.preview.toTutorName}</div>
                        <div style={{ marginTop: 2, fontSize: 11, color: C.textMuted }}>{result.preview.toDate} {result.preview.toTime}</div>
                      </div>
                    </div>
                    <div style={{ marginTop: 8, fontSize: 11, color: C.textMuted }}>
                      Target session currently has {result.preview.targetSessionCurrentCount ?? 0} student{(result.preview.targetSessionCurrentCount ?? 0) === 1 ? '' : 's'}.
                    </div>
                  </div>
                )}

                {result.preview?.kind === 'book_student_plan' && (
                  <div style={{ border: `1.5px solid ${C.border}`, borderRadius: 10, background: C.surface, padding: '12px 14px', marginBottom: 12 }}>
                    <div style={{ fontSize: 12, fontWeight: 700, color: C.textPrimary }}>{result.preview.studentName}</div>
                    <div style={{ fontSize: 11, color: C.textMuted, marginTop: 3 }}>
                      Topic: {result.preview.topic || 'General'}
                    </div>
                    <div style={{ marginTop: 8, border: `1.5px solid ${C.greenBorder}`, borderRadius: 8, background: '#fff', padding: '8px 10px' }}>
                      <div style={{ fontSize: 9, fontWeight: 700, color: C.green, textTransform: 'uppercase', letterSpacing: '0.08em' }}>Selected Slot</div>
                      <div style={{ marginTop: 3, fontSize: 12, color: C.textPrimary }}>
                        {result.preview.selected?.tutorName} · {result.preview.selected?.date} {result.preview.selected?.time}
                      </div>
                      <div style={{ marginTop: 2, fontSize: 11, color: C.textMuted }}>
                        Seats left after optimization filter: {result.preview.selected?.seatsLeft}
                      </div>
                    </div>
                    {(result.preview.alternatives ?? []).length > 0 && (
                      <div style={{ marginTop: 8, fontSize: 11, color: C.textMuted }}>
                        Alternatives: {(result.preview.alternatives ?? []).map((alt: any) => `${alt.tutorName} ${alt.date} ${alt.time}`).join(' | ')}
                      </div>
                    )}
                  </div>
                )}

                {result.preview?.kind === 'delete_booking_plan' && (
                  <div style={{ border: `1.5px solid ${C.border}`, borderRadius: 10, background: C.surface, padding: '12px 14px', marginBottom: 12 }}>
                    <div style={{ fontSize: 12, fontWeight: 700, color: C.textPrimary }}>{result.preview.studentName}</div>
                    <div style={{ marginTop: 8, border: `1.5px solid ${C.accentBorder}`, borderRadius: 8, background: '#fff', padding: '8px 10px' }}>
                      <div style={{ fontSize: 9, fontWeight: 700, color: C.accent, textTransform: 'uppercase', letterSpacing: '0.08em' }}>Booking To Delete</div>
                      <div style={{ marginTop: 3, fontSize: 12, color: C.textPrimary }}>
                        {result.preview.selected?.tutorName} · {result.preview.selected?.date} {result.preview.selected?.time}
                      </div>
                      <div style={{ marginTop: 2, fontSize: 11, color: C.textMuted }}>
                        Session currently has {result.preview.selected?.sessionSize} student{result.preview.selected?.sessionSize === 1 ? '' : 's'}.
                      </div>
                    </div>
                    {result.preview.matchesFound > 1 && (
                      <div style={{ marginTop: 8, fontSize: 11, color: C.textMuted }}>
                        {result.preview.matchesFound} matching bookings found. This selection is the next upcoming match.
                      </div>
                    )}
                  </div>
                )}

                {result.preview?.kind === 'tutor_schedule_view' && (
                  <div style={{ border: `1.5px solid ${C.border}`, borderRadius: 10, background: C.surface, padding: '12px 14px', marginBottom: 12 }}>
                    <div style={{ fontSize: 12, fontWeight: 700, color: C.textPrimary }}>{result.preview.tutorName}</div>
                    <div style={{ marginTop: 8, fontSize: 11, color: C.textMuted }}>
                      Availability blocks: {(result.preview.availabilityBlocks ?? []).length}
                    </div>
                    {(result.preview.availabilityBlocks ?? []).slice(0, 8).map((block: string, idx: number) => (
                      <div key={idx} style={{ marginTop: 4, fontSize: 11, color: C.textSecondary }}>{block}</div>
                    ))}
                    <div style={{ marginTop: 10, fontSize: 11, color: C.textMuted }}>
                      Time-off dates: {(result.preview.timeOffEntries ?? []).length}
                    </div>
                    {(result.preview.timeOffEntries ?? []).slice(0, 8).map((entry: any, idx: number) => (
                      <div key={idx} style={{ marginTop: 4, fontSize: 11, color: C.textSecondary }}>
                        {entry.date}{entry.note ? ` - ${entry.note}` : ''}
                      </div>
                    ))}
                  </div>
                )}

                {result.preview?.kind === 'tutor_schedule_edit' && (
                  <div style={{ border: `1.5px solid ${C.border}`, borderRadius: 10, background: C.surface, padding: '12px 14px', marginBottom: 12 }}>
                    <div style={{ fontSize: 12, fontWeight: 700, color: C.textPrimary }}>{result.preview.tutorName}</div>
                    <div style={{ marginTop: 6, fontSize: 11, color: C.textSecondary }}>
                      Action: {String(result.preview.action ?? '').replaceAll('_', ' ')}
                    </div>
                    {result.preview.block && (
                      <div style={{ marginTop: 4, fontSize: 11, color: C.textSecondary }}>Block: {result.preview.block}</div>
                    )}
                    {result.preview.startDate && (
                      <div style={{ marginTop: 4, fontSize: 11, color: C.textSecondary }}>
                        Range: {result.preview.startDate} to {result.preview.endDate}
                      </div>
                    )}
                    {(result.preview.datesAffected ?? []).length > 0 && (
                      <div style={{ marginTop: 4, fontSize: 11, color: C.textMuted }}>
                        Dates affected: {(result.preview.datesAffected ?? []).length}
                      </div>
                    )}
                  </div>
                )}

                <button
                  onClick={confirmPendingAction}
                  disabled={isExecuting}
                  style={{
                    width: '100%',
                    padding: '10px 14px',
                    borderRadius: 9,
                    border: 'none',
                    background: '#1e293b',
                    color: '#fff',
                    fontSize: 12,
                    fontWeight: 800,
                    cursor: isExecuting ? 'default' : 'pointer',
                    opacity: isExecuting ? 0.75 : 1,
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    gap: 6,
                  }}
                >
                  {isExecuting ? <Loader2 size={13} className="animate-spin" /> : <CheckCircle2 size={13} />} Confirm and apply
                </button>
              </div>
            )}

            {/* Action applied */}
            {result?.type === 'action_applied' && (
              <div style={{ padding: '20px', display: 'flex', gap: 12, alignItems: 'flex-start' }}>
                <CheckCircle2 size={16} style={{ color: C.green, flexShrink: 0, marginTop: 2 }} />
                <div>
                  <div style={{ fontSize: 13, color: C.textPrimary, fontWeight: 700 }}>{result.summary}</div>
                  {result.detail && <div style={{ fontSize: 12, color: C.textMuted, marginTop: 3 }}>{result.detail}</div>}
                </div>
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