'use client'
import { Suspense, useEffect, useState } from 'react'
import { useSearchParams } from 'next/navigation'
import { Loader2 } from 'lucide-react'
import { supabase } from '@/lib/supabaseClient'
import { withCenter } from '@/lib/db'

const SUBJECTS = [
  { group: 'Math & Science', subjects: ['Algebra', 'Geometry', 'Precalculus', 'Calculus', 'Statistics', 'IB Math', 'Biology', 'Chemistry', 'Physics'] },
  { group: 'English & Humanities', subjects: ['English/Writing', 'Literature', 'History', 'Geography', 'Psychology'] },
  { group: 'Test Prep', subjects: ['SAT Math', 'SAT R/W', 'ACT Math', 'ACT English', 'ACT Science'] },
  { group: 'AP', subjects: ['AP Physics C Mechanics', 'AP Physics C E&M', 'AP Environmental Science', 'AP Statistics'] },
]

const DAYS = [
  { dow: 1, label: 'Mon' },
  { dow: 2, label: 'Tue' },
  { dow: 3, label: 'Wed' },
  { dow: 4, label: 'Thu' },
  { dow: 6, label: 'Sat' },
]

function fmt12(t: string): string {
  const [hStr, mStr] = t.split(':')
  const h = parseInt(hStr, 10)
  const m = mStr ?? '00'
  const ampm = h >= 12 ? 'PM' : 'AM'
  const h12 = h % 12 === 0 ? 12 : h % 12
  return `${h12}:${m} ${ampm}`
}

function parseSessionTimesForDay(dow: number, sessionTimesByDay: Record<string, string[]> | null) {
  if (!sessionTimesByDay) return []
  const slots = sessionTimesByDay[String(dow)] ?? []
  return slots.map((slot, i) => {
    const parts = slot.split('-')
    const start = parts[0] ?? slot
    const end = parts.length === 2 && parts[1].includes(':') ? parts[1] : ''
    return { time: start, label: `S${i + 1}`, display: end ? `${fmt12(start)} – ${fmt12(end)}` : fmt12(start) }
  })
}

const DOW_NAMES: Record<string, string> = { '1': 'Mon', '2': 'Tue', '3': 'Wed', '4': 'Thu', '5': 'Fri', '6': 'Sat' }
const CHOICE_COLORS = ['#dc2626', '#7c3aed', '#0ea5e9']
const CHOICE_NAMES = ['1st Choice', '2nd Choice', '3rd Choice']

function SlotChoicePicker({ index, choice, sessionTimesByDay, onChange }: {
  index: number
  choice: string[]
  sessionTimesByDay: Record<string, string[]>
  onChange: (c: string[]) => void
}) {
  const color = CHOICE_COLORS[index] ?? '#64748b'
  const availableDays = Object.entries(sessionTimesByDay)
    .filter(([, times]) => times.length > 0)
    .map(([dow]) => dow)
    .sort((a, b) => Number(a) - Number(b))

  const pendingDow = choice.length === 1 && choice[0]?.endsWith('-PENDING')
    ? choice[0].split('-PENDING')[0] : null
  const activeDow = pendingDow ?? (choice[0]?.match(/^(\d)-/) ? choice[0].split('-')[0] : null)
  const slotsForDay = activeDow ? (sessionTimesByDay[activeDow] ?? []) : []

  function startOf(slot: string) { return slot.split('-')[0] }

  function fmt12(t: string) {
    const [hStr, mStr] = t.split(':')
    const h = parseInt(hStr, 10)
    const ampm = h >= 12 ? 'PM' : 'AM'
    const h12 = h % 12 === 0 ? 12 : h % 12
    return `${h12}:${mStr ?? '00'} ${ampm}`
  }

  function toggleTime(startTime: string) {
    const block = `${activeDow}-${startTime}`
    const real = choice.filter(b => !b.endsWith('-PENDING'))
    if (real.includes(block)) { onChange(real.filter(b => b !== block)); return }
    if (real.length === 0) { onChange([block]); return }
    if (real.length === 1) {
      const otherTime = real[0].split('-').slice(1).join('-')
      const [oh, om] = otherTime.split(':').map(Number)
      const [nh, nm] = startTime.split(':').map(Number)
      if (Math.abs(nh * 60 + nm - (oh * 60 + om)) === 60) {
        const pair = nh * 60 + nm < oh * 60 + om ? [block, real[0]] : [real[0], block]
        onChange(pair); return
      }
    }
    onChange([block])
  }

  const selectedTimes = choice.filter(b => !b.endsWith('-PENDING')).map(b => b.split('-').slice(1).join('-'))
  const hasSelection = selectedTimes.length > 0

  return (
    <div style={{ border: `1.5px solid ${hasSelection ? color : '#e2e8f0'}`, borderRadius: 10, padding: '10px 12px', marginBottom: 8 }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
        <span style={{ fontSize: 11, fontWeight: 800, color: 'white', background: color, borderRadius: 20, padding: '2px 10px' }}>{CHOICE_NAMES[index]}</span>
        {hasSelection && (
          <span style={{ fontSize: 11, color: '#475569', fontWeight: 600 }}>
            {DOW_NAMES[activeDow ?? ''] ?? ''} {selectedTimes.map(fmt12).join(' – ')}{selectedTimes.length === 2 ? ' (2h)' : ''}
          </span>
        )}
        {choice.length > 0 && (
          <button onClick={() => onChange([])} style={{ fontSize: 10, color: '#94a3b8', background: 'none', border: 'none', cursor: 'pointer', marginLeft: 6 }}>Clear</button>
        )}
      </div>
      <div style={{ marginBottom: activeDow ? 8 : 0 }}>
        <p style={{ fontSize: 9, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.1em', color: '#94a3b8', margin: '0 0 5px' }}>Day</p>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
          {availableDays.map(dow => (
            <button key={dow} onClick={() => { if (activeDow !== dow) onChange([`${dow}-PENDING`]) }}
              style={{ padding: '4px 10px', borderRadius: 20, fontSize: 11, fontWeight: 700, cursor: 'pointer', border: `1px solid ${activeDow === dow ? color : '#e2e8f0'}`, background: activeDow === dow ? color : 'white', color: activeDow === dow ? 'white' : '#64748b' }}>
              {DOW_NAMES[dow] ?? `Day ${dow}`}
            </button>
          ))}
        </div>
      </div>
      {activeDow && (
        <div>
          <p style={{ fontSize: 9, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.1em', color: '#94a3b8', margin: '0 0 5px' }}>Time <span style={{ color: '#cbd5e1', fontWeight: 400, textTransform: 'none', fontSize: 9 }}>(pick 2 consecutive for a 2h session)</span></p>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
            {slotsForDay.map(slot => {
              const t = startOf(slot)
              const isSelected = selectedTimes.includes(t)
              return (
                <button key={t} onClick={() => toggleTime(t)}
                  style={{ padding: '4px 10px', borderRadius: 20, fontSize: 11, fontWeight: 700, cursor: 'pointer', border: `1px solid ${isSelected ? color : '#e2e8f0'}`, background: isSelected ? color : 'white', color: isSelected ? 'white' : '#64748b' }}>
                  {fmt12(t)}
                </button>
              )
            })}
          </div>
        </div>
      )}
    </div>
  )
}

function EnrollForm() {
  const searchParams = useSearchParams()
  const token = searchParams.get('token') ?? ''
  const isPreview = searchParams.get('preview') === '1'
  const previewTermName = searchParams.get('term') ?? 'Upcoming term'

  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading')
  const [errorMsg, setErrorMsg] = useState('')
  const [studentName, setStudentName] = useState('')
  const [termName, setTermName] = useState('')
  const [sessionTimesByDay, setSessionTimesByDay] = useState<Record<string, string[]> | null>(null)
  const [selectedSubjects, setSelectedSubjects] = useState<string[]>([])
  const [subjectSessionsPerWeek, setSubjectSessionsPerWeek] = useState<Record<string, number>>({})
  const [selectedBlocks, setSelectedBlocks] = useState<string[]>([])
  const [recurring, setRecurring] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [enrollmentInstructions, setEnrollmentInstructions] = useState<string | null>(null)
  const [lastSubmittedAt, setLastSubmittedAt] = useState<string | null>(null)
  const [submitNotice, setSubmitNotice] = useState<string | null>(null)
  const [slotPreferences, setSlotPreferences] = useState<string[][]>([])

  useEffect(() => {
    withCenter(supabase.from('slake_center_settings').select('enrollment_instructions').limit(1))
      .maybeSingle()
      .then(({ data }: { data: { enrollment_instructions: string | null } | null }) => {
        if (data?.enrollment_instructions) setEnrollmentInstructions(data.enrollment_instructions)
      })
      .catch(() => {})
  }, [])

  useEffect(() => {
    if (isPreview) {
      setStudentName('Alex Student')
      setTermName(previewTermName)
      setSessionTimesByDay({
        '1': ['15:30-17:30', '17:30-19:30'],
        '2': ['15:30-17:30', '17:30-19:30'],
        '3': ['15:30-17:30', '17:30-19:30'],
        '4': ['15:30-17:30', '17:30-19:30'],
        '6': ['09:00-11:00', '11:00-13:00'],
      })
      setSelectedSubjects([])
      setSubjectSessionsPerWeek({})
      setSelectedBlocks([])
      setLastSubmittedAt(null)
      setSubmitNotice(null)
      setStatus('ready')
      return
    }

    if (!token) { setErrorMsg('Missing enrollment token.'); setStatus('error'); return }
    fetch(`/api/enrollment-form?token=${encodeURIComponent(token)}`)
      .then(r => r.json())
      .then(data => {
        if (data.error) { setErrorMsg(data.error); setStatus('error'); return }
        const enroll = data.enrollment
        setStudentName(enroll?.slake_students?.name ?? 'Your student')
        setTermName(enroll?.slake_terms?.name ?? 'Upcoming term')
        setSessionTimesByDay(enroll?.slake_terms?.session_times_by_day ?? null)
        setSelectedSubjects(Array.isArray(enroll?.subjects) ? enroll.subjects : [])
        setSubjectSessionsPerWeek((enroll?.subject_sessions_per_week && typeof enroll.subject_sessions_per_week === 'object' && !Array.isArray(enroll.subject_sessions_per_week)) ? enroll.subject_sessions_per_week : {})
        setSelectedBlocks(Array.isArray(enroll?.availability_blocks) ? enroll.availability_blocks : [])
        setSlotPreferences(Array.isArray(enroll?.slot_preferences) ? enroll.slot_preferences : [])
        setLastSubmittedAt(enroll?.form_submitted_at ?? null)
        setSubmitNotice(null)
        setStatus('ready')
      })
      .catch(() => { setErrorMsg('Failed to load form.'); setStatus('error') })
  }, [token, isPreview, previewTermName])

  const toggleSubject = (s: string) =>
    setSelectedSubjects(prev => {
      if (prev.includes(s)) {
        const next = prev.filter(x => x !== s)
        setSubjectSessionsPerWeek(spw => { const n = { ...spw }; delete n[s]; return n })
        return next
      }
      return [...prev, s]
    })

  const toggleBlock = (dow: number, time: string) => {
    const key = `${dow}-${time}`
    setSelectedBlocks(prev => prev.includes(key) ? prev.filter(x => x !== key) : [...prev, key])
  }

  const handleSubmit = async () => {
    if (isPreview) {
      setLastSubmittedAt(new Date().toISOString())
      setSubmitNotice('Preview saved. In live mode this updates the existing enrollment form submission.')
      return
    }
    if (selectedSubjects.length === 0) { alert('Please select at least one subject.'); return }
    setSubmitting(true)
    setSubmitNotice(null)
    const res = await fetch('/api/enrollment-form', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token, subjects: selectedSubjects, subjectSessionsPerWeek, availabilityBlocks: selectedBlocks, slotPreferences: slotPreferences.filter(c => c.length > 0) }),
    })
    const data = await res.json()
    setSubmitting(false)
    if (!res.ok) { alert(data.error ?? 'Failed to submit.'); return }
    setLastSubmittedAt(new Date().toISOString())
    setSubmitNotice('Availability saved. You can update and resubmit any time using this same link.')
  }

  if (status === 'loading') return (
    <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#f8fafc' }}>
      <Loader2 size={22} style={{ color: '#dc2626', animation: 'spin 1s linear infinite' }} />
      <style>{`@keyframes spin { to { transform: rotate(360deg) } }`}</style>
    </div>
  )

  if (status === 'error') return (
    <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#f8fafc', padding: 24 }}>
      <div style={{ textAlign: 'center' }}>
        <p style={{ fontSize: 16, fontWeight: 700, color: '#0f172a', margin: '0 0 6px' }}>Invalid Link</p>
        <p style={{ fontSize: 13, color: '#64748b', margin: 0 }}>{errorMsg}</p>
      </div>
    </div>
  )

  const allSessionBlocks = DAYS.flatMap(d => parseSessionTimesForDay(d.dow, sessionTimesByDay).map(b => ({ ...b, dow: d.dow })))
  const uniqueTimes = Array.from(new Map(allSessionBlocks.map(b => [b.time, b])).values())

  return (
    <div style={{ minHeight: '100vh', background: '#f8fafc', display: 'flex', alignItems: 'flex-start', justifyContent: 'center', padding: '28px 16px', fontFamily: 'ui-sans-serif, system-ui, sans-serif' }}>
      <div style={{ width: '100%', maxWidth: 620 }}>

        {/* Header */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 20 }}>
          <div>
            <div style={{ fontSize: 11, fontWeight: 800, color: '#dc2626', letterSpacing: '0.08em', textTransform: 'uppercase', marginBottom: 2 }}>Thetix</div>
            <h1 style={{ fontSize: 20, fontWeight: 800, color: '#0f172a', margin: 0 }}>Scheduling Availability</h1>
            <p style={{ fontSize: 12, color: '#64748b', margin: '3px 0 0' }}>
              {studentName} · {termName}
            </p>
          </div>
          <div style={{ textAlign: 'right' }}>
            <div style={{ fontSize: 10, fontWeight: 700, color: '#16a34a', background: '#dcfce7', border: '1px solid #86efac', borderRadius: 20, padding: '3px 10px', display: 'inline-block' }}>
              ● Enrolled
            </div>
            <p style={{ fontSize: 10, color: '#94a3b8', margin: '4px 0 0' }}>Update your availability below</p>
          </div>
        </div>

        {/* Enrollment instructions */}
        {enrollmentInstructions && (
          <div style={{ background: '#eff6ff', border: '1px solid #bfdbfe', borderRadius: 10, padding: '10px 14px', marginBottom: 12 }}>
            <p style={{ fontSize: 12, color: '#1e40af', lineHeight: 1.6, margin: 0 }}>{enrollmentInstructions}</p>
          </div>
        )}

        {lastSubmittedAt && (
          <div style={{ background: '#ecfeff', border: '1px solid #a5f3fc', borderRadius: 10, padding: '10px 14px', marginBottom: 12 }}>
            <p style={{ fontSize: 12, color: '#155e75', lineHeight: 1.6, margin: 0 }}>
              Previous submission detected.
              {' '}
              Last submitted: {new Date(lastSubmittedAt).toLocaleString()}.
              {' '}
              You can update fields and resubmit below.
            </p>
          </div>
        )}

        {submitNotice && (
          <div style={{ background: '#f0fdf4', border: '1px solid #bbf7d0', borderRadius: 10, padding: '10px 14px', marginBottom: 12 }}>
            <p style={{ fontSize: 12, color: '#166534', lineHeight: 1.6, margin: 0 }}>{submitNotice}</p>
          </div>
        )}

        {/* Subjects — compact pill row */}
        <div style={{ background: 'white', border: '1px solid #e2e8f0', borderRadius: 12, padding: '14px 16px', marginBottom: 12 }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
            <p style={{ fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.08em', color: '#64748b', margin: 0 }}>Subjects</p>
            {selectedSubjects.length > 0 && (
              <span style={{ fontSize: 10, fontWeight: 700, color: '#15803d', background: '#dcfce7', borderRadius: 20, padding: '2px 8px' }}>{selectedSubjects.length} selected</span>
            )}
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {SUBJECTS.map(group => (
              <div key={group.group}>
                <p style={{ fontSize: 9, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.1em', color: '#cbd5e1', margin: '0 0 5px' }}>{group.group}</p>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
                  {group.subjects.map(s => {
                    const active = selectedSubjects.includes(s)
                    return (
                      <button key={s} onClick={() => toggleSubject(s)}
                        style={{ padding: '4px 10px', borderRadius: 20, border: `1px solid ${active ? '#dc2626' : '#e2e8f0'}`, background: active ? '#dc2626' : 'white', color: active ? 'white' : '#64748b', fontSize: 11, fontWeight: 600, cursor: 'pointer' }}>
                        {s}
                      </button>
                    )
                  })}
                </div>
              </div>
            ))}
          </div>
          {selectedSubjects.length > 0 && (
            <div style={{ marginTop: 10, display: 'flex', flexDirection: 'column', gap: 6 }}>
              <p style={{ fontSize: 9, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.1em', color: '#94a3b8', margin: 0 }}>How many sessions per week?</p>
              {selectedSubjects.map(s => {
                const val = subjectSessionsPerWeek[s] ?? 1
                return (
                  <div key={s} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <span style={{ fontSize: 12, fontWeight: 600, color: '#0f172a', minWidth: 110 }}>{s}</span>
                    <button
                      type="button"
                      onClick={() => setSubjectSessionsPerWeek(prev => ({ ...prev, [s]: Math.max(1, (prev[s] ?? 1) - 1) }))}
                      style={{ width: 24, height: 24, borderRadius: 6, border: '1px solid #e2e8f0', background: 'white', fontSize: 14, fontWeight: 700, cursor: 'pointer', color: '#475569' }}
                    >−</button>
                    <span style={{ fontSize: 13, fontWeight: 700, color: '#0f172a', minWidth: 24, textAlign: 'center' }}>{val}</span>
                    <button
                      type="button"
                      onClick={() => setSubjectSessionsPerWeek(prev => ({ ...prev, [s]: Math.min(5, (prev[s] ?? 1) + 1) }))}
                      style={{ width: 24, height: 24, borderRadius: 6, border: '1px solid #e2e8f0', background: 'white', fontSize: 14, fontWeight: 700, cursor: 'pointer', color: '#475569' }}
                    >+</button>
                    <span style={{ fontSize: 11, color: '#94a3b8' }}>per week</span>
                  </div>
                )
              })}
            </div>
          )}
        </div>

        {/* Availability grid */}
        <div style={{ background: 'white', border: '1px solid #e2e8f0', borderRadius: 12, padding: '14px 16px', marginBottom: 12 }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
            <p style={{ fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.08em', color: '#64748b', margin: 0 }}>Weekly Availability</p>
            {selectedBlocks.length > 0 && (
              <span style={{ fontSize: 10, fontWeight: 700, color: '#6d28d9', background: '#ede9fe', borderRadius: 20, padding: '2px 8px' }}>{selectedBlocks.length} slots</span>
            )}
          </div>
          {uniqueTimes.length === 0 ? (
            <p style={{ fontSize: 12, color: '#94a3b8', fontStyle: 'italic', margin: 0 }}>No session times configured yet.</p>
          ) : (
            <div style={{ overflowX: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                <thead>
                  <tr style={{ borderBottom: '1px solid #f1f5f9' }}>
                    <th style={{ textAlign: 'left', fontSize: 10, fontWeight: 700, color: '#94a3b8', padding: '4px 8px 6px 0', whiteSpace: 'nowrap' }}>Time</th>
                    {DAYS.map(d => <th key={d.dow} style={{ textAlign: 'center', fontSize: 10, fontWeight: 700, color: '#94a3b8', padding: '4px 6px 6px', minWidth: 40 }}>{d.label}</th>)}
                  </tr>
                </thead>
                <tbody>
                  {uniqueTimes.map((block, bi) => (
                    <tr key={block.time} style={{ borderBottom: bi < uniqueTimes.length - 1 ? '1px solid #f8fafc' : 'none' }}>
                      <td style={{ padding: '5px 8px 5px 0', whiteSpace: 'nowrap' }}>
                        <span style={{ fontSize: 11, fontWeight: 600, color: '#334155' }}>{block.display}</span>
                      </td>
                      {DAYS.map(d => {
                        const applicable = parseSessionTimesForDay(d.dow, sessionTimesByDay).some(b => b.time === block.time)
                        const key = `${d.dow}-${block.time}`
                        const active = applicable && selectedBlocks.includes(key)
                        return (
                          <td key={d.dow} style={{ padding: '5px 6px', textAlign: 'center' }}>
                            {applicable ? (
                              <button onClick={() => toggleBlock(d.dow, block.time)}
                                style={{ width: 26, height: 26, borderRadius: 6, border: `1.5px solid ${active ? '#dc2626' : '#e2e8f0'}`, background: active ? '#dc2626' : 'white', color: active ? 'white' : '#94a3b8', fontSize: 12, fontWeight: 800, cursor: 'pointer', display: 'inline-flex', alignItems: 'center', justifyContent: 'center' }}>
                                {active ? '✓' : ''}
                              </button>
                            ) : (
                              <div style={{ width: 26, height: 26, margin: '0 auto', borderRadius: 6, background: '#f8fafc' }} />
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
        </div>

        {/* Slot preferences */}
        <div style={{ background: 'white', border: '1px solid #e2e8f0', borderRadius: 12, padding: '14px 16px', marginBottom: 12 }}>
          <p style={{ fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.08em', color: '#64748b', margin: '0 0 4px' }}>Preferred Time Slots <span style={{ fontWeight: 400, textTransform: 'none', color: '#94a3b8' }}>(optional)</span></p>
          <p style={{ fontSize: 11, color: '#94a3b8', margin: '0 0 10px' }}>Rank your top 3 preferred session slots. We'll do our best to match your first choice.</p>
          {[0, 1, 2].map(i => (
            <SlotChoicePicker
              key={i}
              index={i}
              choice={slotPreferences[i] ?? []}
              sessionTimesByDay={sessionTimesByDay ?? {}}
              onChange={newChoice => setSlotPreferences(prev => {
                const next = [...prev]
                while (next.length <= i) next.push([])
                next[i] = newChoice
                return next
              })}
            />
          ))}
        </div>

        {/* Recurring toggle */}
        <div style={{ background: 'white', border: '1px solid #e2e8f0', borderRadius: 12, padding: '12px 16px', marginBottom: 16 }}>
          <label style={{ display: 'flex', alignItems: 'center', gap: 10, cursor: 'pointer' }}>
            <div
              onClick={() => setRecurring(r => !r)}
              style={{ width: 36, height: 20, borderRadius: 10, background: recurring ? '#dc2626' : '#e2e8f0', position: 'relative', transition: 'background 0.15s', flexShrink: 0, cursor: 'pointer' }}>
              <div style={{ width: 16, height: 16, borderRadius: '50%', background: 'white', position: 'absolute', top: 2, left: recurring ? 18 : 2, transition: 'left 0.15s', boxShadow: '0 1px 3px rgba(0,0,0,0.15)' }} />
            </div>
            <div>
              <p style={{ fontSize: 12, fontWeight: 700, color: '#0f172a', margin: 0 }}>Interested in recurring sessions</p>
              <p style={{ fontSize: 11, color: '#94a3b8', margin: '1px 0 0' }}>Same time each week for the term</p>
            </div>
          </label>
        </div>

        {/* Submit */}
        <button onClick={handleSubmit} disabled={submitting || selectedSubjects.length === 0}
          style={{ width: '100%', padding: '12px', borderRadius: 10, border: 'none', background: selectedSubjects.length > 0 ? '#dc2626' : '#e2e8f0', color: selectedSubjects.length > 0 ? 'white' : '#94a3b8', fontSize: 13, fontWeight: 800, cursor: selectedSubjects.length > 0 ? 'pointer' : 'not-allowed', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8 }}>
          {submitting
            ? <><Loader2 size={14} style={{ animation: 'spin 1s linear infinite' }} /> Submitting…</>
            : (lastSubmittedAt ? 'Resubmit Availability' : 'Submit Availability')}
        </button>
        <p style={{ textAlign: 'center', fontSize: 11, color: '#cbd5e1', marginTop: 8, marginBottom: 0 }}>You can resubmit if your schedule changes.</p>
        <style>{`@keyframes spin { to { transform: rotate(360deg) } }`}</style>
      </div>
    </div>
  )
}

export default function EnrollPage() {
  return (
    <Suspense fallback={
      <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#f8fafc' }}>
        <Loader2 size={22} style={{ color: '#dc2626', animation: 'spin 1s linear infinite' }} />
        <style>{`@keyframes spin { to { transform: rotate(360deg) } }`}</style>
      </div>
    }>
      <EnrollForm />
    </Suspense>
  )
}