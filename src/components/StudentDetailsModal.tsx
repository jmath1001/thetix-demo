'use client'
import { useEffect, useMemo, useState } from 'react'
import { Save, X } from 'lucide-react'
import { getSessionsForDay, type SessionTimesByDay } from '@/components/constants'

const DEFAULT_SUBJECTS = [
  'Algebra', 'Geometry', 'Precalculus', 'Calculus', 'Statistics',
  'IB Math', 'Physics', 'Chemistry', 'Biology', 'Psychology',
  'SAT Math', 'ACT Math', 'ACT Science', 'ACT English', 'SAT R/W',
  'English/Writing', 'Literature', 'History',
  'AP Physics C Mechanics', 'AP Physics C E&M', 'AP Environmental Science', 'AP Statistics',
]

interface StudentDetailsModalProps {
  student: any;
  tutors?: Array<{ id: string; name: string; subjects: string[] }>;
  onClose: () => void;
  onSave?: (updatedStudent: any) => void;
}

type Term = {
  id: string
  name: string
  start_date: string
  end_date: string
  status: string
  session_times_by_day?: SessionTimesByDay | null
}

const normalizeStringArray = (value: unknown): string[] => {
  if (Array.isArray(value)) {
    return value
      .map(v => String(v).trim())
      .filter(Boolean)
  }

  if (typeof value === 'string') {
    const trimmed = value.trim()
    if (!trimmed) return []

    try {
      const parsed = JSON.parse(trimmed)
      if (Array.isArray(parsed)) {
        return parsed
          .map(v => String(v).trim())
          .filter(Boolean)
      }
    } catch {
      // Fall back to comma-separated parsing for legacy string values.
    }

    return trimmed
      .split(',')
      .map(v => v.trim())
      .filter(Boolean)
  }

  return []
}

export default function StudentDetailsModal({ student, tutors: tutorsProp = [], onClose, onSave }: StudentDetailsModalProps) {
  const [isEditing, setIsEditing] = useState(false)
  const [editSubjects, setEditSubjects] = useState<string[]>([])
  const [isSaving, setIsSaving] = useState(false)
  const [editAvailability, setEditAvailability] = useState<string[]>([])
  const [isSavingAvailability, setIsSavingAvailability] = useState(false)
  const [isEditingAvailability, setIsEditingAvailability] = useState(true)
  const [subjectSearch, setSubjectSearch] = useState('')
  const [terms, setTerms] = useState<Term[]>([])
  const [loadingTerms, setLoadingTerms] = useState(true)
  const [selectedTermId, setSelectedTermId] = useState('')
  const [originalSubjects, setOriginalSubjects] = useState<string[]>([])
  const [originalAvailability, setOriginalAvailability] = useState<string[]>([])
  const [hoursPurchased, setHoursPurchased] = useState(0)
  const [originalHoursPurchased, setOriginalHoursPurchased] = useState(0)
  const [sessionHours, setSessionHours] = useState<number>(typeof (student as any).session_hours === 'number' ? (student as any).session_hours : 2)
  const [isSavingHours, setIsSavingHours] = useState(false)
  const [termEnrollmentExists, setTermEnrollmentExists] = useState(false)
  const [isRevertingHours, setIsRevertingHours] = useState(false)
  const [isEditingTerm, setIsEditingTerm] = useState(false)
  const [isSavingTerm, setIsSavingTerm] = useState(false)
  const [termDraft, setTermDraft] = useState({ id: '', name: '', start_date: '', end_date: '', status: 'upcoming' })
  const [centerSubjects, setCenterSubjects] = useState<string[]>(DEFAULT_SUBJECTS)
  // Per-subject scheduling preferences (stored in term enrollment)
  const [subjectSessionsPerWeek, setSubjectSessionsPerWeek] = useState<Record<string, number>>({})
  const [allowSameDayDouble, setAllowSameDayDouble] = useState(false)
  const [subjectTutorPreference, setSubjectTutorPreference] = useState<Record<string, string>>({})
  const tutors = tutorsProp

  useEffect(() => {
    let cancelled = false
    fetch('/api/center-subjects')
      .then(r => r.json())
      .then(d => { if (!cancelled && Array.isArray(d?.subjects)) setCenterSubjects(d.subjects) })
      .catch(() => {})
    return () => { cancelled = true }
  }, [])

  const AVAILABILITY_DAYS = [
    { dow: 1, label: 'Mon' },
    { dow: 2, label: 'Tue' },
    { dow: 3, label: 'Wed' },
    { dow: 4, label: 'Thu' },
    { dow: 6, label: 'Sat' },
  ]

  const selectedTerm = useMemo(
    () => terms.find(t => t.id === selectedTermId) ?? null,
    [terms, selectedTermId]
  )

  const selectedTermSessionTimesByDay = useMemo<SessionTimesByDay | null>(() => {
    const raw = selectedTerm?.session_times_by_day
    if (!raw || typeof raw !== 'object') return null
    return raw as SessionTimesByDay
  }, [selectedTerm])

  const availabilityRows = useMemo(() => {
    const byTime = new Map<string, { id: string; label: string; time: string; display: string; days: number[] }>()

    AVAILABILITY_DAYS.forEach(({ dow }) => {
      const dayBlocks = selectedTerm
        ? (Array.isArray(selectedTermSessionTimesByDay?.[String(dow)])
          ? selectedTermSessionTimesByDay[String(dow)]
              .map((slot, idx) => {
                const [start = '', end = ''] = String(slot).split('-')
                const to12 = (time: string) => {
                  if (!time || !time.includes(':')) return time
                  const [hStr, mStr] = time.split(':')
                  const h = Number(hStr)
                  const m = mStr ?? '00'
                  const ampm = h >= 12 ? 'PM' : 'AM'
                  const h12 = h % 12 === 0 ? 12 : h % 12
                  return `${h12}:${m} ${ampm}`
                }
                return {
                  id: `D${dow}-T${start || idx}`,
                  label: `Session ${idx + 1}`,
                  time: start,
                  display: end ? `${to12(start)} – ${to12(end)}` : to12(start),
                }
              })
              .filter(b => !!b.time)
          : [])
        : getSessionsForDay(dow, null)
      dayBlocks.forEach(block => {
        const existing = byTime.get(block.time)
        if (existing) {
          if (!existing.days.includes(dow)) existing.days.push(dow)
          return
        }
        byTime.set(block.time, {
          id: block.id,
          label: block.label,
          time: block.time,
          display: block.display,
          days: [dow],
        })
      })
    })

    return Array.from(byTime.values()).sort((a, b) => a.time.localeCompare(b.time))
  }, [AVAILABILITY_DAYS, selectedTermSessionTimesByDay])

  const fallbackSubjects = normalizeStringArray(student.subjects).length > 0
    ? normalizeStringArray(student.subjects)
    : (student.subject ? [String(student.subject)] : [])
  const fallbackAvailability = [
    ...normalizeStringArray(student.availability_blocks),
    ...normalizeStringArray(student.availabilityBlocks),
  ].filter((value, index, self) => self.indexOf(value) === index)

  const currentSubjectsDisplay = editSubjects.length > 0
    ? editSubjects.join(', ')
    : 'Not set'

  const filteredSubjects = centerSubjects.filter(s => {
    if (editSubjects.includes(s)) return false
    if (!subjectSearch.trim()) return true
    return s.toLowerCase().includes(subjectSearch.toLowerCase())
  }).slice(0, 10)

  const currentAvailabilityCount = editAvailability.length
  const hasAvailabilityChanges = JSON.stringify([...editAvailability].sort()) !== JSON.stringify([...originalAvailability].sort())
  const hasHoursChanges = !termEnrollmentExists || Number(hoursPurchased || 0) !== Number(originalHoursPurchased || 0)

  useEffect(() => {
    let cancelled = false

    const loadTerms = async () => {
      setLoadingTerms(true)
      try {
        const res = await fetch('/api/terms')
        const payload = await res.json()
        if (!res.ok) throw new Error(payload?.error || 'Failed to load terms')
        const rows: Term[] = Array.isArray(payload?.terms) ? payload.terms : []
        if (cancelled) return
        setTerms(rows)
        const requestedTermId =
          (typeof student?.selected_term_id === 'string' && student.selected_term_id)
          || (typeof student?.selectedTermId === 'string' && student.selectedTermId)
          || ''
        const preferred = (requestedTermId
          ? rows.find(t => t.id === requestedTermId)
          : null) ?? rows.find(t => t.status === 'active') ?? rows[0] ?? null
        setSelectedTermId(preferred?.id ?? '')
      } catch (err) {
        console.error('Failed to load terms:', err)
      } finally {
        if (!cancelled) setLoadingTerms(false)
      }
    }

    loadTerms()
    return () => { cancelled = true }
  }, [student?.selected_term_id, student?.selectedTermId])

  useEffect(() => {
    let cancelled = false

    const loadEnrollment = async () => {
      if (!selectedTermId) {
        setEditSubjects(fallbackSubjects)
        setOriginalSubjects(fallbackSubjects)
        setEditAvailability(fallbackAvailability)
        setOriginalAvailability(fallbackAvailability)
        setHoursPurchased(Number(student.hours_left ?? 0))
        setOriginalHoursPurchased(Number(student.hours_left ?? 0))
        return
      }

      try {
        const res = await fetch(`/api/term-enrollment?studentId=${encodeURIComponent(student.id)}&termId=${encodeURIComponent(selectedTermId)}`)
        const payload = await res.json()
        if (!res.ok) throw new Error(payload?.error || 'Failed to load term enrollment')

        const enrollment = payload?.enrollment
        const nextSubjects = Array.isArray(enrollment?.subjects) ? enrollment.subjects : fallbackSubjects
        const nextAvailability = Array.isArray(enrollment?.availability_blocks)
          ? enrollment.availability_blocks
          : fallbackAvailability
        const nextHours = enrollment
          ? Number(enrollment.hours_purchased ?? 0)
          : Number(student.hours_left ?? 0)

        if (cancelled) return
        setTermEnrollmentExists(!!enrollment)
        setEditSubjects(nextSubjects)
        setOriginalSubjects(nextSubjects)
        setEditAvailability(nextAvailability)
        setOriginalAvailability(nextAvailability)
        setHoursPurchased(nextHours)
        setOriginalHoursPurchased(enrollment ? nextHours : -1)
        setSubjectSessionsPerWeek((enrollment?.subject_sessions_per_week && typeof enrollment.subject_sessions_per_week === 'object' && !Array.isArray(enrollment.subject_sessions_per_week)) ? enrollment.subject_sessions_per_week : {})
        setAllowSameDayDouble(enrollment?.allow_same_day_double === true)
        setSubjectTutorPreference((enrollment?.subject_tutor_preference && typeof enrollment.subject_tutor_preference === 'object' && !Array.isArray(enrollment.subject_tutor_preference)) ? enrollment.subject_tutor_preference : {})
      } catch (err) {
        console.error('Failed to load term enrollment:', err)
      }
    }

    loadEnrollment()
    return () => { cancelled = true }
  }, [selectedTermId, student.id])

  const handleAddSubject = (subject: string) => {
    if (!editSubjects.includes(subject) && editSubjects.length < 3) {
      setEditSubjects([...editSubjects, subject])
    }
  }

  const handleRemoveSubject = (subject: string) => {
    setEditSubjects(editSubjects.filter(s => s !== subject))
  }

  const handleSave = async () => {
    setIsSaving(true)
    try {
      const endpoint = selectedTermId ? '/api/term-enrollment' : '/api/student-subjects'
      const res = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(selectedTermId
          ? {
            studentId: student.id,
            termId: selectedTermId,
            subjects: editSubjects,
            availabilityBlocks: editAvailability,
            hoursPurchased,
            subjectSessionsPerWeek,
            allowSameDayDouble,
            subjectTutorPreference,
          }
          : { studentId: student.id, subjects: editSubjects }
        )
      })
      const payload = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(payload?.error || 'Failed to save subjects')

      const serverEnrollment = payload?.enrollment
      const nextSubjects = Array.isArray(serverEnrollment?.subjects)
        ? serverEnrollment.subjects
        : [...editSubjects]
      const nextAvailability = Array.isArray(serverEnrollment?.availability_blocks)
        ? serverEnrollment.availability_blocks
        : [...editAvailability]
      const nextHours = typeof serverEnrollment?.hours_purchased === 'number'
        ? serverEnrollment.hours_purchased
        : Number(hoursPurchased || 0)

      setEditSubjects(nextSubjects)
      setOriginalSubjects(nextSubjects)
      setEditAvailability(nextAvailability)
      setOriginalAvailability(nextAvailability)
      setHoursPurchased(nextHours)
      setOriginalHoursPurchased(nextHours)

      if (onSave) {
        onSave({
          ...student,
          subjects: nextSubjects,
          availability_blocks: nextAvailability,
          availabilityBlocks: nextAvailability,
          hours_left: Number(nextHours || 0),
          selected_term_id: selectedTermId,
          selectedTermId,
        })
      }
      setIsEditing(false)
    } catch (err) {
      console.error('Error saving subjects:', err)
      alert('Failed to save subjects.')
    } finally {
      setIsSaving(false)
    }
  }

  const toggleAvailabilityBlock = (dow: number, time: string) => {
    const key = `${dow}-${time}`
    setEditAvailability(prev => prev.includes(key) ? prev.filter(b => b !== key) : [...prev, key])
  }

  const handleSaveAvailability = async () => {
    setIsSavingAvailability(true)
    try {
      const endpoint = selectedTermId ? '/api/term-enrollment' : '/api/student-availability'
      const res = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(selectedTermId
          ? {
            studentId: student.id,
            termId: selectedTermId,
            subjects: editSubjects,
            availabilityBlocks: editAvailability,
            hoursPurchased,
          }
          : { studentId: student.id, availabilityBlocks: editAvailability }
        ),
      })

      if (!res.ok) {
        const body = await res.json().catch(() => ({}))
        throw new Error(body?.error || 'Failed to save availability')
      }

      const payload = await res.json().catch(() => ({}))

      const serverEnrollment = payload?.enrollment
      const nextSubjects = Array.isArray(serverEnrollment?.subjects)
        ? serverEnrollment.subjects
        : [...editSubjects]
      const nextAvailability = Array.isArray(serverEnrollment?.availability_blocks)
        ? serverEnrollment.availability_blocks
        : [...editAvailability]
      const nextHours = typeof serverEnrollment?.hours_purchased === 'number'
        ? serverEnrollment.hours_purchased
        : Number(hoursPurchased || 0)

      setEditSubjects(nextSubjects)
      setOriginalSubjects(nextSubjects)
      setEditAvailability(nextAvailability)
      setOriginalAvailability(nextAvailability)
      setHoursPurchased(nextHours)
      setOriginalHoursPurchased(nextHours)

      if (onSave) {
        onSave({
          ...student,
          availability_blocks: nextAvailability,
          availabilityBlocks: nextAvailability,
          subjects: nextSubjects,
          hours_left: Number(nextHours || 0),
          selected_term_id: selectedTermId,
          selectedTermId,
        })
      }
      setIsEditingAvailability(false)
    } catch (err) {
      console.error('Error saving availability:', err)
      alert((err as Error).message || 'Failed to save availability.')
    } finally {
      setIsSavingAvailability(false)
    }
  }

  const handleSaveHours = async () => {
    if (!selectedTermId) return
    setIsSavingHours(true)
    try {
      const res = await fetch('/api/term-enrollment', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          studentId: student.id,
          termId: selectedTermId,
          hoursPurchased: Number(hoursPurchased || 0),
          sessionHours,
          syncStudentBalance: true,
        }),
      })

      const payload = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(payload?.error || 'Failed to save term hours')

      const serverEnrollment = payload?.enrollment
      const nextHours = typeof serverEnrollment?.hours_purchased === 'number'
        ? serverEnrollment.hours_purchased
        : Number(hoursPurchased || 0)

      setHoursPurchased(nextHours)
      setOriginalHoursPurchased(nextHours)
      setTermEnrollmentExists(true)
      if (onSave) {
        onSave({
          ...student,
          hours_left: Number(nextHours || 0),
          selected_term_id: selectedTermId,
          selectedTermId,
        })
      }
    } catch (err) {
      console.error('Error saving term hours:', err)
      alert((err as Error).message || 'Failed to save term hours.')
    } finally {
      setIsSavingHours(false)
    }
  }

  const handleRevertHours = async () => {
    if (!selectedTermId || !termEnrollmentExists) return
    setIsRevertingHours(true)
    try {
      // Re-fetch the enrollment to get hours_purchased, then reset the student balance
      const res = await fetch(`/api/term-enrollment?studentId=${encodeURIComponent(student.id)}&termId=${encodeURIComponent(selectedTermId)}`)
      const payload = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(payload?.error || 'Failed to load enrollment')
      const purchased = typeof payload?.enrollment?.hours_purchased === 'number' ? payload.enrollment.hours_purchased : null
      if (purchased === null) throw new Error('No hours_purchased found for this enrollment')
      // Reset balance to purchased amount
      const resetRes = await fetch('/api/term-enrollment', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          studentId: student.id,
          termId: selectedTermId,
          hoursPurchased: purchased,
          syncStudentBalance: true,
        }),
      })
      if (!resetRes.ok) {
        const e = await resetRes.json().catch(() => ({}))
        throw new Error(e?.error || 'Failed to revert')
      }
      setHoursPurchased(purchased)
      setOriginalHoursPurchased(purchased)
      if (onSave) {
        onSave({ ...student, hours_left: purchased, selected_term_id: selectedTermId, selectedTermId })
      }
    } catch (err) {
      console.error('Error reverting hours:', err)
      alert((err as Error).message || 'Failed to revert hours.')
    } finally {
      setIsRevertingHours(false)
    }
  }

  const startEditSelectedTerm = () => {
    if (!selectedTerm) return
    setTermDraft({
      id: selectedTerm.id,
      name: selectedTerm.name,
      start_date: selectedTerm.start_date,
      end_date: selectedTerm.end_date,
      status: selectedTerm.status || 'upcoming',
    })
    setIsEditingTerm(true)
  }

  const startCreateTerm = () => {
    setTermDraft({ id: '', name: '', start_date: '', end_date: '', status: 'upcoming' })
    setIsEditingTerm(true)
  }

  const saveTerm = async () => {
    if (!termDraft.name || !termDraft.start_date || !termDraft.end_date) {
      alert('Term name, start date, and end date are required.')
      return
    }

    setIsSavingTerm(true)
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
        }),
      })

      const payload = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(payload?.error || 'Failed to save term')

      const savedTerm = payload?.term
      if (savedTerm?.id) {
        setTerms(prev => {
          const exists = prev.some(t => t.id === savedTerm.id)
          if (exists) return prev.map(t => t.id === savedTerm.id ? savedTerm : t)
          return [savedTerm, ...prev]
        })
        setSelectedTermId(savedTerm.id)
      }

      setIsEditingTerm(false)
    } catch (err) {
      console.error('Error saving term:', err)
      alert((err as Error).message || 'Failed to save term.')
    } finally {
      setIsSavingTerm(false)
    }
  }

  return (
    <div className="fixed inset-0 bg-slate-200/60 backdrop-blur-[2px] flex items-center justify-center z-50"
      onClick={e => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="bg-white p-6 rounded-lg shadow-lg w-115 max-w-[95vw] max-h-[92vh] overflow-y-auto" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-bold">{student.name}</h2>
          <button onClick={onClose} className="p-1 hover:bg-gray-100 rounded">
            <X size={16} />
          </button>
        </div>

        <div className="space-y-4 mb-6">
          <div className="pb-2 border-b border-gray-200 space-y-2">
            <div className="flex items-center justify-between">
              <p className="text-xs font-bold uppercase tracking-wide text-gray-500">Term</p>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={startCreateTerm}
                  className="px-2.5 py-1 text-[11px] font-bold rounded border border-gray-300 text-gray-700 hover:bg-gray-50"
                >
                  Add Term
                </button>
                <button
                  type="button"
                  onClick={startEditSelectedTerm}
                  disabled={!selectedTerm}
                  className="px-2.5 py-1 text-[11px] font-bold rounded border border-purple-300 text-purple-700 bg-purple-50 hover:bg-purple-100 disabled:opacity-50"
                >
                  Edit Term
                </button>
              </div>
            </div>

            <select
              value={selectedTermId}
              onChange={e => setSelectedTermId(e.target.value)}
              className="w-full rounded border border-gray-300 bg-white px-2.5 py-2 text-sm font-semibold text-gray-800"
              disabled={loadingTerms}
            >
              {loadingTerms && <option value="">Loading terms...</option>}
              {!loadingTerms && terms.length === 0 && <option value="">No terms yet</option>}
              {!loadingTerms && terms.map(term => (
                <option key={term.id} value={term.id}>{term.name} ({term.status})</option>
              ))}
            </select>

            {isEditingTerm && (
              <div className="rounded border border-purple-200 bg-purple-50/40 p-3 space-y-2">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                  <input
                    value={termDraft.name}
                    onChange={e => setTermDraft(prev => ({ ...prev, name: e.target.value }))}
                    placeholder="Term name"
                    className="rounded border border-gray-300 bg-white px-2.5 py-1.5 text-xs"
                  />
                  <select
                    value={termDraft.status}
                    onChange={e => setTermDraft(prev => ({ ...prev, status: e.target.value }))}
                    className="rounded border border-gray-300 bg-white px-2.5 py-1.5 text-xs"
                  >
                    <option value="upcoming">upcoming</option>
                    <option value="active">active</option>
                    <option value="completed">completed</option>
                  </select>
                  <input
                    type="date"
                    value={termDraft.start_date}
                    onChange={e => setTermDraft(prev => ({ ...prev, start_date: e.target.value }))}
                    className="rounded border border-gray-300 bg-white px-2.5 py-1.5 text-xs"
                  />
                  <input
                    type="date"
                    value={termDraft.end_date}
                    onChange={e => setTermDraft(prev => ({ ...prev, end_date: e.target.value }))}
                    className="rounded border border-gray-300 bg-white px-2.5 py-1.5 text-xs"
                  />
                </div>
                <div className="flex gap-2">
                  <button
                    type="button"
                    onClick={() => setIsEditingTerm(false)}
                    className="flex-1 rounded border border-gray-300 bg-white px-3 py-1.5 text-xs font-bold text-gray-700"
                  >
                    Cancel
                  </button>
                  <button
                    type="button"
                    onClick={saveTerm}
                    disabled={isSavingTerm}
                    className="flex-1 rounded bg-purple-600 px-3 py-1.5 text-xs font-bold text-white hover:bg-purple-700 disabled:opacity-50"
                  >
                    {isSavingTerm ? 'Saving term...' : 'Save Term'}
                  </button>
                </div>
              </div>
            )}
          </div>

          <div>
            <p className="text-xs font-bold uppercase tracking-wide text-gray-500 mb-2">Subjects for Selected Term</p>
            {!isEditing ? (
              <div className="flex items-center justify-between">
                <p className="text-sm font-semibold text-gray-900">{currentSubjectsDisplay}</p>
                <button 
                  onClick={() => setIsEditing(true)}
                  className="px-3 py-1 text-xs font-bold bg-purple-50 border border-purple-300 text-purple-700 rounded hover:bg-purple-100">
                  Edit
                </button>
              </div>
            ) : (
              <div className="space-y-3">
                <div className="flex flex-wrap gap-2">
                  {editSubjects.map(subject => (
                    <div key={subject} className="flex items-center gap-2 bg-purple-100 border border-purple-300 rounded-full px-3 py-1">
                      <span className="text-xs font-semibold text-purple-900">{subject}</span>
                      <button
                        onClick={() => handleRemoveSubject(subject)}
                        className="text-purple-600 hover:text-purple-900"
                      >
                        <X size={13} />
                      </button>
                    </div>
                  ))}
                </div>
                {editSubjects.length > 0 && selectedTermId && (
                  <div className="space-y-2 mt-2">
                    <p className="text-[11px] font-bold uppercase tracking-wide text-gray-500">Sessions per week &amp; tutor preference</p>
                    {editSubjects.map(subject => {
                      const sessionsVal = subjectSessionsPerWeek[subject] ?? 1
                      const tutorId = subjectTutorPreference[subject] ?? ''
                      const eligibleTutors = tutors.filter(t =>
                        !t.subjects?.length || t.subjects.some(ts => ts.toLowerCase().includes(subject.toLowerCase()) || subject.toLowerCase().includes(ts.toLowerCase()))
                      )
                      return (
                        <div key={subject} className="flex items-center gap-3 rounded-lg border border-gray-200 bg-gray-50 px-3 py-2">
                          <span className="w-28 shrink-0 text-xs font-semibold text-gray-800 truncate">{subject}</span>
                          <div className="flex items-center gap-1">
                            <button
                              type="button"
                              onClick={() => setSubjectSessionsPerWeek(prev => ({ ...prev, [subject]: Math.max(1, (prev[subject] ?? 1) - 1) }))}
                              className="w-5 h-5 rounded border border-gray-300 bg-white text-xs font-bold text-gray-700 hover:bg-gray-100 flex items-center justify-center"
                            >−</button>
                            <span className="w-6 text-center text-xs font-bold text-gray-900">{sessionsVal}×</span>
                            <button
                              type="button"
                              onClick={() => setSubjectSessionsPerWeek(prev => ({ ...prev, [subject]: Math.min(5, (prev[subject] ?? 1) + 1) }))}
                              className="w-5 h-5 rounded border border-gray-300 bg-white text-xs font-bold text-gray-700 hover:bg-gray-100 flex items-center justify-center"
                            >+</button>
                          </div>
                          <select
                            value={tutorId}
                            onChange={e => setSubjectTutorPreference(prev => {
                              const next = { ...prev }
                              if (e.target.value) next[subject] = e.target.value
                              else delete next[subject]
                              return next
                            })}
                            className="flex-1 text-xs border border-gray-300 rounded bg-white px-2 py-1 text-gray-800 min-w-0"
                          >
                            <option value="">Any tutor</option>
                            {(eligibleTutors.length > 0 ? eligibleTutors : tutors).map(t => (
                              <option key={t.id} value={t.id}>{t.name}</option>
                            ))}
                          </select>
                        </div>
                      )
                    })}
                    <label className="flex items-center gap-2 cursor-pointer select-none mt-1">
                      <input
                        type="checkbox"
                        checked={allowSameDayDouble}
                        onChange={e => setAllowSameDayDouble(e.target.checked)}
                        className="h-3.5 w-3.5 rounded border-gray-300 text-purple-600"
                      />
                      <span className="text-[11px] text-gray-700">Allow two sessions on the same day</span>
                    </label>
                  </div>
                )}
                {editSubjects.length < 3 && (
                  <div className="space-y-2">
                    <input
                      value={subjectSearch}
                      onChange={e => setSubjectSearch(e.target.value)}
                      placeholder="Search subjects..."
                      className="w-full text-xs font-semibold px-2.5 py-1.5 border border-gray-300 rounded bg-white text-gray-900"
                    />
                    <div className="flex flex-wrap gap-1.5 max-h-28 overflow-y-auto rounded border border-gray-200 p-2">
                      {filteredSubjects.map(s => (
                        <button
                          key={s}
                          type="button"
                          onClick={() => handleAddSubject(s)}
                          className="rounded-full border border-gray-300 bg-white px-2.5 py-1 text-[11px] font-semibold text-gray-700 hover:bg-gray-50"
                        >
                          + {s}
                        </button>
                      ))}
                      {filteredSubjects.length === 0 && (
                        <span className="text-[11px] text-gray-400">No matching subjects</span>
                      )}
                    </div>
                  </div>
                )}
                <div className="flex gap-2">
                  <button
                    onClick={() => setIsEditing(false)}
                    className="flex-1 px-3 py-1.5 text-xs font-bold border border-gray-300 rounded bg-white text-gray-900 hover:bg-gray-50">
                    Cancel
                  </button>
                  <button
                    onClick={handleSave}
                    disabled={isSaving}
                    className="flex-1 flex items-center justify-center gap-1 px-3 py-1.5 text-xs font-bold rounded bg-purple-600 text-white hover:bg-purple-700 disabled:opacity-50">
                    <Save size={13} /> {isSaving ? 'Saving...' : 'Save'}
                  </button>
                </div>
              </div>
            )}
          </div>

          <div className="pt-2 border-t border-gray-200">
            <div className="mb-2 flex items-center justify-between">
              <p className="text-xs font-bold uppercase tracking-wide text-gray-500">Availability for Selected Term</p>
              <div className="flex items-center gap-2">
                <span className="rounded-full bg-purple-50 border border-purple-200 px-2 py-0.5 text-[10px] font-semibold text-purple-700">
                  {currentAvailabilityCount} blocks
                </span>
                {!isEditingAvailability && (
                  <button
                    onClick={() => setIsEditingAvailability(true)}
                    className="px-3 py-1 text-xs font-bold bg-purple-50 border border-purple-300 text-purple-700 rounded hover:bg-purple-100"
                  >
                    Edit
                  </button>
                )}
              </div>
            </div>

            {!isEditingAvailability ? (
              <p className="text-xs text-gray-600">Set when this student can attend by session block.</p>
            ) : (
              <>
                {selectedTerm && availabilityRows.length === 0 ? (
                  <p className="rounded border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-700">
                    No session slots are configured for this setting term yet.
                  </p>
                ) : (
                <div className="overflow-hidden rounded border border-gray-200">
                  <table className="w-full border-collapse text-[11px]">
                    <thead className="bg-gray-50">
                      <tr>
                        <th className="border-r border-gray-200 px-2 py-1.5 text-left font-bold text-gray-600">Session</th>
                        {AVAILABILITY_DAYS.map(d => (
                          <th key={d.dow} className="px-1 py-1.5 text-center font-bold text-gray-600">{d.label}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {availabilityRows.map((block, i) => (
                        <tr key={block.id} className={i % 2 ? 'bg-gray-50/50' : 'bg-white'}>
                          <td className="border-r border-gray-100 px-2 py-1.5">
                            <p className="font-semibold text-gray-800 leading-tight">{block.label}</p>
                            <p className="text-[10px] text-gray-500">{block.display}</p>
                          </td>
                          {AVAILABILITY_DAYS.map(d => {
                            const applicable = block.days.includes(d.dow)
                            const active = applicable && editAvailability.includes(`${d.dow}-${block.time}`)
                            return (
                              <td key={d.dow} className="p-1 text-center">
                                {applicable ? (
                                  <button
                                    type="button"
                                    onClick={() => toggleAvailabilityBlock(d.dow, block.time)}
                                    className={`h-6 w-6 rounded border text-[10px] font-black transition-colors ${active ? 'bg-purple-600 border-purple-600 text-white' : 'bg-white border-gray-300 text-gray-500 hover:bg-gray-100'}`}
                                  >
                                    {active ? '✓' : ''}
                                  </button>
                                ) : (
                                  <div className="mx-auto h-6 w-6" />
                                )}
                              </td>
                            )
                          })}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                )}

                <div className="mt-2 flex gap-2">
                  <button
                    onClick={() => {
                      setEditAvailability([...originalAvailability])
                      setIsEditingAvailability(false)
                    }}
                    disabled={isSavingAvailability}
                    className="flex-1 px-3 py-1.5 text-xs font-bold border border-gray-300 rounded bg-white text-gray-700 hover:bg-gray-50 disabled:opacity-50"
                  >
                    Cancel
                  </button>
                  <button
                    onClick={handleSaveAvailability}
                    disabled={!hasAvailabilityChanges || isSavingAvailability}
                    className="flex-1 px-3 py-1.5 text-xs font-bold rounded bg-purple-600 text-white hover:bg-purple-700 disabled:opacity-50"
                  >
                    {isSavingAvailability ? 'Saving...' : 'Save Availability'}
                  </button>
                </div>
              </>
            )}
          </div>

          <div className="pt-2 border-t border-gray-200 space-y-2">
            <div>
              <p className="text-xs font-bold text-gray-500 uppercase mb-1">Hours Purchased for Selected Term</p>
              <div className="flex items-center gap-2 flex-wrap">
                <input
                  type="number"
                  min={0}
                  value={hoursPurchased}
                  onChange={e => setHoursPurchased(Number(e.target.value || 0))}
                  className="w-28 rounded border border-gray-300 bg-white px-2.5 py-1.5 text-sm font-semibold text-gray-800"
                />
                <button
                  type="button"
                  onClick={handleSaveHours}
                  disabled={!selectedTermId || !hasHoursChanges || isSavingHours || isRevertingHours}
                  className="rounded bg-purple-600 px-3 py-1.5 text-xs font-bold text-white hover:bg-purple-700 disabled:opacity-50"
                >
                  {isSavingHours ? 'Saving...' : 'Save & Set Balance'}
                </button>
                {termEnrollmentExists && (
                  <button
                    type="button"
                    onClick={handleRevertHours}
                    disabled={isSavingHours || isRevertingHours}
                    title="Reset the student's current balance back to the purchased amount"
                    className="rounded border border-amber-300 bg-amber-50 px-3 py-1.5 text-xs font-bold text-amber-800 hover:bg-amber-100 disabled:opacity-50"
                  >
                    {isRevertingHours ? 'Reverting...' : 'Revert Balance'}
                  </button>
                )}
              </div>
              <p className="mt-1 text-[10px] text-gray-400">Saving will also reset the student's running balance to this number.</p>
            </div>
            <div>
              <p className="text-xs font-bold text-gray-500 uppercase mb-1">Hours per Session</p>
              <div className="flex gap-1 p-0.5 rounded-lg border border-gray-200 bg-gray-50 w-fit">
                {[1, 2].map(h => (
                  <button key={h} type="button" onClick={() => setSessionHours(h)}
                    className="px-4 py-1.5 rounded-md text-xs font-bold transition-all"
                    style={sessionHours === h ? { background: '#7c3aed', color: '#fff' } : { color: '#6b7280' }}>
                    {h}h
                  </button>
                ))}
              </div>
              <p className="mt-1 text-[10px] text-gray-400">Deducted per attended session. Save & Set Balance to apply.</p>
            </div>
            {student.tutor && <p><strong className="text-xs font-bold text-gray-500 uppercase">Tutor:</strong> <span className="text-sm text-gray-900">{student.tutor}</span></p>}
            {student.day && <p><strong className="text-xs font-bold text-gray-500 uppercase">Day:</strong> <span className="text-sm text-gray-900">{student.day}</span></p>}
            {student.time && <p><strong className="text-xs font-bold text-gray-500 uppercase">Time:</strong> <span className="text-sm text-gray-900">{student.time}</span></p>}
          </div>
        </div>

        <div className="flex justify-end">
          <button onClick={onClose} className="px-4 py-2 bg-gray-200 rounded hover:bg-gray-300 text-sm font-semibold">
            Close
          </button>
        </div>
      </div>
    </div>
  );
}
