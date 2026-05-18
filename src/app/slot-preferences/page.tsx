'use client'

import React, { useState, useMemo, useEffect } from 'react'
import {
  Clipboard, ChevronDown, ChevronRight, Loader2, Play,
  Users, Check, AlertTriangle, Search, X,
} from 'lucide-react'
import { supabase } from '@/lib/supabaseClient'
import { DB, withCenter } from '@/lib/db'
import { SlotPreferenceSurvey, type SlotPreferences } from '@/components/SlotPreferenceSurvey'
import { formatTime } from '@/components/constants'

// ── Types ─────────────────────────────────────────────────────────────────────

type TermRow = {
  id: string
  name: string
  status: string
  session_times_by_day: Record<string, string[]> | null
}

type StudentRow = {
  id: string
  name: string
  subjects: string[]
}

type EnrollmentRow = {
  student_id: string
  slot_preferences: SlotPreferences | null
  subjects: string[]
}

type SlotAssignment = {
  studentId: string
  studentName: string
  subject: string
  choiceUsed: 1 | 2 | 3
  blocks: string[]
  tutorId: string
  tutorName: string
}

type UnmatchedStudent = {
  studentId: string
  studentName: string
  subject: string
  reason: string
}

type Proposal = {
  assignments: SlotAssignment[]
  unmatched: UnmatchedStudent[]
}

const DOW_LABELS: Record<string, string> = {
  '1': 'Mon', '2': 'Tue', '3': 'Wed', '4': 'Thu', '5': 'Fri', '6': 'Sat', '7': 'Sun',
}

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

// ── Page ──────────────────────────────────────────────────────────────────────

export default function SlotPreferencesPage() {
  const [terms, setTerms] = useState<TermRow[]>([])
  const [selectedTermId, setSelectedTermId] = useState<string>('')
  const [students, setStudents] = useState<StudentRow[]>([])
  const [enrollments, setEnrollments] = useState<EnrollmentRow[]>([])
  const [loading, setLoading] = useState(false)
  const [search, setSearch] = useState('')
  const [openStudentId, setOpenStudentId] = useState<string | null>(null)
  const [proposal, setProposal] = useState<Proposal | null>(null)
  const [running, setRunning] = useState(false)
  const [runError, setRunError] = useState<string | null>(null)

  // Load terms on mount
  useEffect(() => {
    supabase
      .from(DB.terms)
      .select('id, name, status, session_times_by_day')
      .order('start_date', { ascending: false })
      .then(({ data }) => {
        const rows = (data ?? []) as TermRow[]
        setTerms(rows)
        const active = rows.find(t => t.status === 'active') ?? rows[0]
        if (active) setSelectedTermId(active.id)
      })
  }, [])

  const selectedTerm = useMemo(
    () => terms.find(t => t.id === selectedTermId) ?? null,
    [terms, selectedTermId]
  )

  const sessionTimesByDay: Record<string, string[]> = useMemo(() => {
    return selectedTerm?.session_times_by_day ?? {}
  }, [selectedTerm])

  // Load students + enrollments when term changes
  useEffect(() => {
    if (!selectedTermId) return
    setLoading(true)
    setProposal(null)

    Promise.all([
      withCenter(supabase.from(DB.students).select('id, name, subjects').order('name')),
      withCenter(
        supabase
          .from(DB.termEnrollments)
          .select('student_id, slot_preferences, subjects')
          .eq('term_id', selectedTermId)
      ),
    ]).then(([stuRes, enrRes]) => {
      setStudents((stuRes.data ?? []) as StudentRow[])
      setEnrollments((enrRes.data ?? []) as EnrollmentRow[])
      setLoading(false)
    })
  }, [selectedTermId])

  const enrollmentMap = useMemo(() => {
    const m: Record<string, EnrollmentRow> = {}
    for (const e of enrollments) m[e.student_id] = e
    return m
  }, [enrollments])

  // Students enrolled in this term
  const enrolledStudents = useMemo(
    () => students.filter(s => enrollmentMap[s.id] !== undefined),
    [students, enrollmentMap]
  )

  const filteredStudents = useMemo(() => {
    const q = search.toLowerCase()
    return q ? enrolledStudents.filter(s => s.name.toLowerCase().includes(q)) : enrolledStudents
  }, [enrolledStudents, search])

  const openStudent = useMemo(
    () => students.find(s => s.id === openStudentId) ?? null,
    [students, openStudentId]
  )

  function handleSave(studentId: string, prefs: SlotPreferences) {
    setEnrollments(prev =>
      prev.map(e =>
        e.student_id === studentId ? { ...e, slot_preferences: prefs } : e
      )
    )
  }

  async function runScheduler() {
    if (!selectedTermId) return
    setRunning(true)
    setRunError(null)
    setProposal(null)
    try {
      const res = await fetch('/api/slot-scheduler', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ termId: selectedTermId }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error ?? 'Scheduler failed')
      setProposal(data)
    } catch (e: any) {
      setRunError(e.message ?? 'Unexpected error')
    } finally {
      setRunning(false)
    }
  }

  const prefCount = enrolledStudents.filter(s => (enrollmentMap[s.id]?.slot_preferences?.length ?? 0) > 0).length

  return (
    <div className="min-h-screen bg-slate-50">
      {/* ── Header ── */}
      <div className="bg-white border-b border-slate-200 px-6 py-4">
        <div className="max-w-5xl mx-auto flex flex-col sm:flex-row sm:items-center gap-3">
          <div className="flex items-center gap-2.5 flex-1">
            <Clipboard className="w-5 h-5 text-indigo-600" />
            <div>
              <h1 className="text-lg font-bold text-slate-900 leading-tight">Slot Preferences</h1>
              <p className="text-xs text-slate-500">Enter paper survey choices for each enrolled student</p>
            </div>
          </div>

          {/* Term selector */}
          <div className="relative">
            <select
              value={selectedTermId}
              onChange={e => setSelectedTermId(e.target.value)}
              className="appearance-none bg-white border border-slate-200 rounded-lg pl-3 pr-8 py-2 text-sm font-medium text-slate-700 focus:outline-none focus:ring-2 focus:ring-indigo-400 cursor-pointer"
            >
              {terms.map(t => (
                <option key={t.id} value={t.id}>{t.name}</option>
              ))}
            </select>
            <ChevronDown className="absolute right-2 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-slate-400 pointer-events-none" />
          </div>

          {/* Run scheduler button */}
          <button
            onClick={runScheduler}
            disabled={running || prefCount === 0}
            className="flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-semibold bg-indigo-600 text-white hover:bg-indigo-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
          >
            {running ? <Loader2 className="w-4 h-4 animate-spin" /> : <Play className="w-4 h-4" />}
            Run Scheduler
          </button>
        </div>
      </div>

      <div className="max-w-5xl mx-auto px-6 py-6 space-y-5">
        {/* Stats bar */}
        {!loading && selectedTermId && (
          <div className="flex flex-wrap gap-3">
            <StatPill icon={<Users className="w-3.5 h-3.5" />} label="Enrolled" value={enrolledStudents.length} color="blue" />
            <StatPill icon={<Check className="w-3.5 h-3.5" />} label="Preferences entered" value={prefCount} color="green" />
            <StatPill icon={<AlertTriangle className="w-3.5 h-3.5" />} label="Awaiting" value={enrolledStudents.length - prefCount} color={enrolledStudents.length - prefCount > 0 ? 'amber' : 'gray'} />
          </div>
        )}

        {/* Proposal results */}
        {proposal && (
          <ProposalPanel
            proposal={proposal}
            onClose={() => setProposal(null)}
            studentNames={Object.fromEntries(students.map(s => [s.id, s.name]))}
          />
        )}

        {runError && (
          <div className="bg-red-50 border border-red-200 rounded-xl px-4 py-3 text-sm text-red-700 flex items-center gap-2">
            <AlertTriangle className="w-4 h-4 shrink-0" />
            {runError}
          </div>
        )}

        {/* Main panel */}
        <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
          {/* Search */}
          <div className="px-4 py-3 border-b border-slate-100 flex items-center gap-2">
            <Search className="w-4 h-4 text-slate-400 shrink-0" />
            <input
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder="Search enrolled students…"
              className="flex-1 text-sm bg-transparent outline-none placeholder:text-slate-400"
            />
          </div>

          {loading ? (
            <div className="flex justify-center py-12">
              <Loader2 className="w-6 h-6 animate-spin text-slate-400" />
            </div>
          ) : filteredStudents.length === 0 ? (
            <div className="py-12 text-center text-sm text-slate-400">
              {selectedTermId ? 'No enrolled students found.' : 'Select a term to begin.'}
            </div>
          ) : (
            <ul className="divide-y divide-slate-100">
              {filteredStudents.map(student => {
                const enrollment = enrollmentMap[student.id]
                const prefs = enrollment?.slot_preferences ?? null
                const hasPrefs = Array.isArray(prefs) && prefs.length > 0
                const isOpen = openStudentId === student.id

                return (
                  <li key={student.id}>
                    {/* Row */}
                    <button
                      onClick={() => setOpenStudentId(isOpen ? null : student.id)}
                      className="w-full flex items-center gap-3 px-4 py-3 hover:bg-slate-50 transition-colors text-left"
                    >
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="text-sm font-semibold text-slate-800 truncate">
                            {student.name}
                          </span>
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

                    {/* Inline survey form */}
                    {isOpen && (
                      <div className="px-4 pb-4 pt-1 bg-slate-50 border-t border-slate-100">
                        <SlotPreferenceSurvey
                          studentId={student.id}
                          studentName={student.name}
                          termId={selectedTermId}
                          sessionTimesByDay={sessionTimesByDay}
                          initialPreferences={prefs}
                          onSave={newPrefs => handleSave(student.id, newPrefs)}
                          onClose={() => setOpenStudentId(null)}
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
    </div>
  )
}

// ── Stat pill ─────────────────────────────────────────────────────────────────

function StatPill({
  icon,
  label,
  value,
  color,
}: {
  icon: React.ReactNode
  label: string
  value: number
  color: 'blue' | 'green' | 'amber' | 'gray'
}) {
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

// ── Proposal panel ────────────────────────────────────────────────────────────

function ProposalPanel({
  proposal,
  onClose,
  studentNames,
}: {
  proposal: Proposal
  onClose: () => void
  studentNames: Record<string, string>
}) {
  const { assignments, unmatched } = proposal

  // Group assignments by day+time for display
  const byBlock: Record<string, SlotAssignment[]> = {}
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
        {/* Placed assignments grouped by slot */}
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
                          {a.blocks.length === 2 && (
                            <span className="text-indigo-600 font-semibold">2h</span>
                          )}
                        </li>
                      ))}
                    </ul>
                  </div>
                )
              })}
            </div>
          </div>
        )}

        {/* Unmatched */}
        {unmatched.length > 0 && (
          <div>
            <p className="text-xs font-bold text-slate-500 uppercase tracking-wide mb-2">
              Unmatched ({unmatched.length})
            </p>
            <ul className="space-y-1">
              {unmatched.map((u, i) => (
                <li key={i} className="flex items-start gap-2 text-xs bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">
                  <AlertTriangle className="w-3.5 h-3.5 text-amber-500 shrink-0 mt-0.5" />
                  <span>
                    <span className="font-semibold text-slate-800">{u.studentName}</span>
                    {u.subject && <span className="text-slate-500"> · {u.subject}</span>}
                    <span className="text-amber-700 ml-1">— {u.reason}</span>
                  </span>
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>
    </div>
  )
}
