"use client"

import { useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { useParams } from 'next/navigation'
import { ArrowLeft, AlertTriangle, CalendarDays, Repeat2 } from 'lucide-react'
import { supabase } from '@/lib/supabaseClient'
import { DB, withCenter } from '@/lib/db'
import { dayOfWeek, getCentralTimeNow, toISODate, correctSessionRecord } from '@/lib/useScheduleData'
import { getSessionsForDay } from '@/components/constants'

const STUDENTS = DB.students
const SESSIONS = DB.sessions
const SS = DB.sessionStudents
const TUTORS = DB.tutors

type HistoryRow = {
  rowId: string
  date: string
  time: string
  blockLabel: string
  tutorId: string
  tutorName: string
  topic: string
  status: string
  notes: string | null
  seriesId: string | null
}

type TimelineItem =
  | {
      kind: 'single'
      key: string
      row: HistoryRow
      sortDate: string
    }
  | {
      kind: 'series'
      key: string
      seriesId: string
      topic: string
      tutorName: string
      blockLabel: string
      time: string
      firstDate: string
      lastDate: string
      focusDate: string
      count: number
      present: number
      noShow: number
      unmarked: number
      notesCount: number
      sortDate: string
    }

export default function StudentHistoryPage() {
  const params = useParams<{ id: string }>()
  const studentId = String(params?.id ?? '')

  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [student, setStudent] = useState<any | null>(null)
  const [history, setHistory] = useState<HistoryRow[]>([])
  const [timelineTab, setTimelineTab] = useState<'all' | 'upcoming' | 'past'>('all')
  const [editingRowId, setEditingRowId]   = useState<string | null>(null)
  const [editDraft,    setEditDraft]      = useState({ status: '', topic: '', notes: '' })
  const [editSaving,   setEditSaving]     = useState(false)

  useEffect(() => {
    let cancelled = false

    async function load() {
      if (!studentId) return
      setLoading(true)
      setError(null)

      try {
        const [{ data: studentRow, error: studentErr }, { data: rows, error: rowsErr }, { data: tutorRows, error: tutorErr }] = await Promise.all([
          withCenter(supabase.from(STUDENTS).select('*').eq('id', studentId)).single(),
          (withCenter(supabase
            .from(SS)
            .select(`id, topic, status, notes, series_id, session_id, ${SESSIONS} ( id, session_date, time, tutor_id )`)
            .eq('student_id', studentId)) as any),
          withCenter(supabase.from(TUTORS).select('id, name')),
        ])

        if (studentErr) throw studentErr
        if (rowsErr) throw rowsErr
        if (tutorErr) throw tutorErr

        const tutorMap = new Map<string, string>((tutorRows ?? []).map((t: any) => [String(t.id), t.name]))

        const mapped = (rows ?? [])
          .map((r: any) => {
            const session = Array.isArray(r[SESSIONS]) ? r[SESSIONS][0] : r[SESSIONS]
            if (!session?.session_date) return null
            const blockLabel = getSessionsForDay(dayOfWeek(session.session_date)).find((b: any) => b.time === session.time)?.label ?? session.time
            return {
              rowId: r.id,
              date: session.session_date,
              time: session.time,
              blockLabel,
              tutorId: session.tutor_id,
              tutorName: tutorMap.get(String(session.tutor_id)) ?? 'Unknown',
              topic: r.topic ?? 'Session',
              status: r.status ?? 'scheduled',
              notes: r.notes ?? null,
              seriesId: r.series_id ?? null,
            }
          })
          .filter(Boolean)
          .sort((a: any, b: any) => b.date.localeCompare(a.date) || b.time.localeCompare(a.time))

        if (!cancelled) {
          setStudent(studentRow)
          setHistory(mapped as any[])
        }
      } catch (err: any) {
        if (!cancelled) setError(err?.message ?? 'Failed to load student history')
      } finally {
        if (!cancelled) setLoading(false)
      }
    }

    load()
    return () => { cancelled = true }
  }, [studentId])

  const today = toISODate(getCentralTimeNow())
  const past = useMemo(() => history.filter(s => s.date < today), [history, today])
  const upcoming = useMemo(() => history.filter(s => s.date >= today), [history, today])
  const presentCount = useMemo(() => past.filter(s => s.status === 'present' || s.status === 'confirmed').length, [past])
  const noShowCount = useMemo(() => past.filter(s => s.status === 'no-show').length, [past])
  const unmarkedCount = useMemo(() => past.filter(s => s.status !== 'present' && s.status !== 'confirmed' && s.status !== 'no-show').length, [past])
  const attendanceRate = past.length > 0 ? presentCount / past.length : null
  const noShowRate = past.length > 0 ? noShowCount / past.length : null

  const groupedTimeline = useMemo(() => {
    const source = timelineTab === 'upcoming' ? upcoming : timelineTab === 'past' ? past : history

    const singles: TimelineItem[] = []
    const recurringBuckets = new Map<string, HistoryRow[]>()

    for (const row of source) {
      if (row.seriesId) {
        const key = String(row.seriesId)
        const existing = recurringBuckets.get(key) ?? []
        existing.push(row)
        recurringBuckets.set(key, existing)
      } else {
        singles.push({
          kind: 'single',
          key: `single-${row.rowId}`,
          row,
          sortDate: `${row.date}T${row.time}`,
        })
      }
    }

    const seriesItems: TimelineItem[] = Array.from(recurringBuckets.entries()).map(([seriesId, rows]) => {
      const ordered = [...rows].sort((a, b) => a.date.localeCompare(b.date) || a.time.localeCompare(b.time))
      const first = ordered[0]
      const last = ordered[ordered.length - 1]
      const focus = timelineTab === 'upcoming' ? first : last
      const present = rows.filter(r => r.status === 'present' || r.status === 'confirmed').length
      const noShow = rows.filter(r => r.status === 'no-show').length
      const unmarked = rows.length - present - noShow

      return {
        kind: 'series',
        key: `series-${seriesId}-${timelineTab}`,
        seriesId,
        topic: focus.topic,
        tutorName: focus.tutorName,
        blockLabel: focus.blockLabel,
        time: focus.time,
        firstDate: first.date,
        lastDate: last.date,
        focusDate: focus.date,
        count: rows.length,
        present,
        noShow,
        unmarked,
        notesCount: rows.filter(r => !!r.notes).length,
        sortDate: `${focus.date}T${focus.time}`,
      }
    })

    const merged = [...singles, ...seriesItems]
    return merged.sort((a, b) => {
      const cmp = a.sortDate.localeCompare(b.sortDate)
      return timelineTab === 'upcoming' ? cmp : -cmp
    })
  }, [timelineTab, past, upcoming])

  const statusBadge = (row: any) => {
    if (row.status === 'present' || row.status === 'confirmed') return { text: '✓ Present', bg: '#dcfce7', color: '#166534', shadow: '#16a34a20' }
    if (row.status === 'no-show') return { text: '✕ No-show', bg: '#fee2e2', color: '#991b1b', shadow: '#dc262620' }
    if (row.date < today) return { text: '? Unmarked', bg: '#f1f5f9', color: '#334155', shadow: '#64748b20' }
    return { text: '→ Upcoming', bg: '#dbeafe', color: '#1e40af', shadow: '#3b82f620' }
  }

  const handleSaveEdit = async () => {
    if (!editingRowId || !student) return
    setEditSaving(true)
    try {
      await correctSessionRecord({
        rowId:     editingRowId,
        studentId: student.id,
        status:    editDraft.status,
        topic:     editDraft.topic,
        notes:     editDraft.notes || null,
      })
      setHistory(prev => prev.map(r =>
        r.rowId === editingRowId
          ? { ...r, status: editDraft.status, topic: editDraft.topic, notes: editDraft.notes || null }
          : r
      ))
      setEditingRowId(null)
    } catch (err: any) {
      alert(err?.message ?? 'Failed to save')
    } finally {
      setEditSaving(false)
    }
  }

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center" style={{ background: 'linear-gradient(135deg, #f5f7fa 0%, #e9ecef 100%)' }}>
        <div className="text-center">
          <div className="inline-flex items-center justify-center w-12 h-12 rounded-xl mb-3" style={{ background: '#f1f5f9', border: '1.5px solid #e2e8f0' }}>
            <div className="animate-spin w-6 h-6 border-2 border-[#3b82f6] border-t-[#10b981] rounded-full"></div>
          </div>
          <p className="text-sm font-semibold text-[#64748b]">Loading student history...</p>
        </div>
      </div>
    )
  }

  if (error || !student) {
    return (
      <div className="min-h-screen flex items-center justify-center" style={{ background: 'linear-gradient(135deg, #f5f7fa 0%, #e9ecef 100%)' }}>
        <div className="rounded-2xl bg-white p-8 text-center shadow-sm" style={{ border: '1.5px solid #fca5a5', boxShadow: '0 4px 16px rgba(220,38,38,0.1)' }}>
          <div className="inline-flex items-center justify-center w-14 h-14 rounded-xl mb-4" style={{ background: '#fef2f2', border: '1.5px solid #fca5a5' }}>
            <AlertTriangle size={24} style={{ color: '#dc2626' }} />
          </div>
          <p className="text-base font-black text-[#dc2626]">Unable to load student</p>
          <p className="mt-2 text-sm text-[#64748b]">{error ?? 'Student not found'}</p>
          <Link href="/students" className="inline-flex items-center gap-2 mt-4 px-4 py-2 rounded-lg font-bold text-sm" style={{ background: '#dc2626', color: '#ffffff' }}>
            ← Back to students
          </Link>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen" style={{ background: 'linear-gradient(135deg, #f5f7fa 0%, #e9ecef 100%)' }}>
      <div className="max-w-5xl mx-auto px-4 py-4 md:py-6 space-y-4">
        <div className="flex items-center justify-between">
          <Link href="/students" className="inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-[11px] font-black uppercase tracking-[0.16em] hover:shadow-sm transition-all" style={{ background: 'linear-gradient(135deg, #fef2f2 0%, #fee2e2 100%)', color: '#991b1b', border: '1.5px solid #fca5a5', boxShadow: '0 2px 4px rgba(220,38,38,0.08)' }}>
            <ArrowLeft size={12} /> Back
          </Link>
        </div>

        <div className="rounded-2xl bg-white p-5 shadow-sm" style={{ border: '1.5px solid #e2e8f0', boxShadow: '0 4px 16px rgba(15,23,42,0.08)' }}>
          <div className="flex items-center justify-between gap-3 flex-wrap">
            <div>
              <h1 className="text-2xl font-black text-[#0f172a]">{student.name}</h1>
              <p className="text-[11px] text-[#63adb0] font-semibold">Student Performance Dashboard</p>
            </div>
            {past.length >= 3 && noShowRate !== null && noShowRate > 0.4 && (
              <span className="inline-flex items-center gap-1 rounded-full px-3.5 py-1.5 text-[9px] font-black uppercase tracking-[0.18em]" style={{ background: 'linear-gradient(135deg, #fef2f2 0%, #fee2e2 100%)', color: '#991b1b', border: '1px solid #fca5a5' }}>
                <AlertTriangle size={11} /> At Risk
              </span>
            )}
          </div>

          <div className="mt-5 grid grid-cols-2 md:grid-cols-5 gap-3">
            {[
              { label: 'Total Sessions', value: history.length, sub: `${upcoming.length} upcoming`, color: '#3b82f6' },
              { label: 'Past Sessions', value: past.length, sub: `${presentCount} present`, color: '#10b981' },
              { label: 'Attendance Rate', value: attendanceRate === null ? '—' : `${Math.round(attendanceRate * 100)}%`, sub: `${presentCount}/${past.length || 0}`, color: '#8b5cf6' },
              { label: 'No-show Rate', value: noShowRate === null ? '—' : `${Math.round(noShowRate * 100)}%`, sub: `${noShowCount}/${past.length || 0}`, color: '#ef4444' },
              { label: 'Unmarked Past', value: unmarkedCount, sub: 'Needs review', color: '#f59e0b' },
            ].map(card => (
              <div key={card.label} className="rounded-xl p-3.5 border-l-4 transition-all hover:shadow-md" style={{ background: 'linear-gradient(135deg, #ffffff 0%, #f8fafc 100%)', borderLeftColor: card.color, border: '1px solid #e2e8f0', borderLeftWidth: '4px' }}>
                <p className="text-[9px] font-black uppercase tracking-[0.18em]" style={{ color: card.color }}>{card.label}</p>
                <p className="mt-1.5 text-xl font-black text-[#0f172a]">{card.value}</p>
                <p className="text-[10px] text-[#64748b] mt-0.5">{card.sub}</p>
              </div>
            ))}
          </div>
        </div>

        <div className="rounded-2xl bg-white overflow-hidden shadow-sm" style={{ border: '1.5px solid #e2e8f0', boxShadow: '0 4px 16px rgba(15,23,42,0.08)' }}>
          <div className="px-5 py-4 flex items-center justify-between gap-3" style={{ borderBottom: '1.5px solid #e2e8f0', background: 'linear-gradient(90deg, #ffffff 0%, #f8fafc 100%)' }}>
            <p className="text-[10px] font-black uppercase tracking-[0.18em]" style={{ color: '#0f172a' }}>📅 Session Timeline</p>
            <div className="flex items-center gap-1.5 rounded-lg p-1.5" style={{ background: '#f1f5f9' }}>
              <button
                onClick={() => setTimelineTab('all')}
                className="px-3 py-1.5 rounded-md text-[10px] font-black uppercase tracking-[0.12em] transition-all"
                style={timelineTab === 'all' ? { background: '#0f172a', color: '#ffffff', boxShadow: '0 2px 4px rgba(15,23,42,0.25)' } : { color: '#64748b' }}>
                All ({history.length})
              </button>
              <button
                onClick={() => setTimelineTab('upcoming')}
                className="px-3 py-1.5 rounded-md text-[10px] font-black uppercase tracking-[0.12em] transition-all"
                style={timelineTab === 'upcoming' ? { background: '#3b82f6', color: '#ffffff', boxShadow: '0 2px 4px rgba(59,130,246,0.3)' } : { color: '#64748b' }}>
                ↓ Upcoming ({upcoming.length})
              </button>
              <button
                onClick={() => setTimelineTab('past')}
                className="px-3 py-1.5 rounded-md text-[10px] font-black uppercase tracking-[0.12em] transition-all"
                style={timelineTab === 'past' ? { background: '#10b981', color: '#ffffff', boxShadow: '0 2px 4px rgba(16,185,129,0.3)' } : { color: '#64748b' }}>
                ✓ Past ({past.length})
              </button>
            </div>
          </div>
          <div className="divide-y divide-[#e2e8f0] max-h-[68vh] overflow-y-auto">
            {groupedTimeline.length === 0 && (
              <p className="px-5 py-8 text-sm text-[#64748b] text-center">No {timelineTab === 'all' ? '' : timelineTab + ' '}sessions found.</p>
            )}
            {groupedTimeline.map((item) => {
              if (item.kind === 'single') {
                const row = item.row
                const badge = statusBadge(row)
                const d = new Date(row.date + 'T00:00:00')
                const isEditing = editingRowId === row.rowId
                return (
                  <div key={item.key} className="group px-5 py-3.5 transition-colors" style={{ borderLeft: `3px solid ${badge.color}`, background: isEditing ? '#f8fafc' : undefined }}>
                    {isEditing ? (
                      <div className="space-y-2.5">
                        <div className="flex items-center justify-between">
                          <p className="text-[10px] font-black uppercase tracking-[0.18em]" style={{ color: '#64748b' }}>Correcting · {row.date}</p>
                          <button onClick={() => setEditingRowId(null)} className="text-[10px] text-[#94a3b8] hover:text-red-500 font-semibold">✕ Cancel</button>
                        </div>
                        <div className="grid grid-cols-2 gap-2">
                          <div>
                            <label className="text-[9px] font-black uppercase tracking-[0.16em] text-[#94a3b8]">Status</label>
                            <select value={editDraft.status} onChange={e => setEditDraft(d => ({ ...d, status: e.target.value }))}
                              className="mt-1 w-full rounded border border-[#e2e8f0] bg-white px-2 py-1.5 text-xs font-semibold text-[#0f172a]">
                              <option value="present">✓ Present</option>
                              <option value="no-show">✕ No-show</option>
                              <option value="scheduled">→ Scheduled</option>
                            </select>
                          </div>
                          <div>
                            <label className="text-[9px] font-black uppercase tracking-[0.16em] text-[#94a3b8]">Topic</label>
                            <input value={editDraft.topic} onChange={e => setEditDraft(d => ({ ...d, topic: e.target.value }))}
                              className="mt-1 w-full rounded border border-[#e2e8f0] px-2 py-1.5 text-xs text-[#0f172a]" />
                          </div>
                        </div>
                        <div>
                          <label className="text-[9px] font-black uppercase tracking-[0.16em] text-[#94a3b8]">Notes</label>
                          <textarea value={editDraft.notes} onChange={e => setEditDraft(d => ({ ...d, notes: e.target.value }))}
                            rows={2} className="mt-1 w-full rounded border border-[#e2e8f0] px-2 py-1.5 text-xs text-[#0f172a] resize-none" />
                        </div>
                        <div className="flex justify-end gap-2">
                          <button onClick={() => setEditingRowId(null)}
                            className="px-3 py-1.5 rounded border border-[#e2e8f0] text-[10px] font-semibold text-[#64748b] hover:bg-slate-50">
                            Cancel
                          </button>
                          <button onClick={handleSaveEdit} disabled={editSaving}
                            className="px-3 py-1.5 rounded text-[10px] font-black text-white disabled:opacity-50"
                            style={{ background: '#3b82f6' }}>
                            {editSaving ? 'Saving…' : 'Save Changes'}
                          </button>
                        </div>
                      </div>
                    ) : (
                      <div className="flex items-start gap-3.5">
                        <div className="w-9 shrink-0 text-center rounded-lg p-1.5" style={{ background: '#f1f5f9' }}>
                          <p className="text-[8px] font-black uppercase text-[#94a3b8] leading-none">{d.toLocaleDateString('en-US', { month: 'short' })}</p>
                          <p className="text-base font-black text-[#0f172a] leading-tight">{d.getDate()}</p>
                        </div>
                        <div className="flex-1 min-w-0">
                          <p className="text-[13px] font-bold text-[#0f172a] truncate">{row.topic}</p>
                          <p className="text-[10px] text-[#64748b] mt-0.5">{row.tutorName} · {row.blockLabel}</p>
                          {row.notes && <p className="text-[10px] mt-1 text-[#475569] truncate italic">"{row.notes}"</p>}
                        </div>
                        <div className="flex flex-col items-end gap-1.5 shrink-0">
                          <span className="text-[9px] font-black px-2.5 py-1 rounded-full" style={{ background: badge.bg, color: badge.color, boxShadow: `0 2px 4px ${badge.shadow}` }}>{badge.text}</span>
                          <span className="text-[9px] text-[#94a3b8]">{row.time}</span>
                          <button
                            onClick={() => { setEditingRowId(row.rowId); setEditDraft({ status: row.status, topic: row.topic, notes: row.notes ?? '' }) }}
                            className="text-[9px] font-semibold text-[#94a3b8] hover:text-[#3b82f6] opacity-0 group-hover:opacity-100 transition-opacity">
                            Edit
                          </button>
                        </div>
                      </div>
                    )}
                  </div>
                )
              }

              const focus = new Date(item.focusDate + 'T00:00:00')
              return (
                <div key={item.key} className="px-5 py-3.5 flex items-start gap-3.5 hover:bg-gradient-to-r hover:from-purple-50 hover:to-transparent transition-colors" style={{ background: '#fcfdff', borderLeft: '3px solid #7c3aed' }}>
                  <div className="w-9 shrink-0 text-center rounded-lg p-1.5" style={{ background: '#f5f3ff' }}>
                    <p className="text-[8px] font-black uppercase text-[#a78bfa] leading-none">{focus.toLocaleDateString('en-US', { month: 'short' })}</p>
                    <p className="text-base font-black text-[#6d28d9] leading-tight">{focus.getDate()}</p>
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-[13px] font-bold text-[#0f172a] truncate inline-flex items-center gap-1.5">
                      <Repeat2 size={14} className="text-[#7c3aed]" /> {item.topic}
                    </p>
                    <p className="text-[10px] text-[#64748b] mt-0.5">{item.tutorName} · {item.blockLabel}</p>
                    <p className="text-[10px] text-[#475569] mt-1 font-semibold">
                      {item.count} recurring sessions · {item.firstDate} to {item.lastDate}
                    </p>
                  </div>
                  <div className="flex flex-col items-end gap-1.5 shrink-0">
                    <span className="text-[9px] font-black px-2.5 py-1 rounded-full" style={{ background: '#f5f3ff', color: '#6d28d9', boxShadow: '0 2px 4px #7c3aed20' }}>
                      🔄 Recurring
                    </span>
                    {timelineTab === 'upcoming' ? (
                      <span className="text-[9px] text-[#3b82f6] font-semibold">{item.count} pending</span>
                    ) : (
                      <span className="text-[9px] text-[#64748b] font-semibold">P {item.present} · NS {item.noShow}{timelineTab === 'all' && item.unmarked > 0 ? ` · ${item.unmarked} upcoming` : ''}</span>
                    )}
                  </div>
                </div>
              )
            })}
          </div>
        </div>
      </div>
    </div>
  )
}
