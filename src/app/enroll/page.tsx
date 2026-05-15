'use client'
import { Suspense, useEffect, useState } from 'react'
import { useSearchParams } from 'next/navigation'
import { Check, Loader2 } from 'lucide-react'
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

function EnrollForm() {
  const searchParams = useSearchParams()
  const token = searchParams.get('token') ?? ''

  const [status, setStatus] = useState<'loading' | 'ready' | 'submitted' | 'error'>('loading')
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

  useEffect(() => {
    withCenter(supabase.from('slake_center_settings').select('enrollment_instructions').limit(1))
      .maybeSingle()
      .then(({ data }: { data: { enrollment_instructions: string | null } | null }) => {
        if (data?.enrollment_instructions) setEnrollmentInstructions(data.enrollment_instructions)
      })
      .catch(() => {})
  }, [])

  useEffect(() => {
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
        if (enroll?.form_submitted_at) setStatus('submitted')
        else setStatus('ready')
      })
      .catch(() => { setErrorMsg('Failed to load form.'); setStatus('error') })
  }, [token])

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
    if (selectedSubjects.length === 0) { alert('Please select at least one subject.'); return }
    setSubmitting(true)
    const res = await fetch('/api/enrollment-form', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token, subjects: selectedSubjects, subjectSessionsPerWeek, availabilityBlocks: selectedBlocks }),
    })
    const data = await res.json()
    setSubmitting(false)
    if (!res.ok) { alert(data.error ?? 'Failed to submit.'); return }
    setStatus('submitted')
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

  if (status === 'submitted') return (
    <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#f8fafc', padding: 24 }}>
      <div style={{ maxWidth: 380, textAlign: 'center' }}>
        <div style={{ width: 48, height: 48, borderRadius: '50%', background: '#dcfce7', display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto 12px' }}>
          <Check size={22} style={{ color: '#16a34a' }} />
        </div>
        <p style={{ fontSize: 18, fontWeight: 800, color: '#0f172a', margin: '0 0 6px' }}>All set!</p>
        <p style={{ fontSize: 13, color: '#64748b', lineHeight: 1.6, margin: 0 }}>
          We've received {studentName}'s availability for <strong>{termName}</strong>. The center will reach out to confirm scheduling.
        </p>
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
          {submitting ? <><Loader2 size={14} style={{ animation: 'spin 1s linear infinite' }} /> Submitting…</> : 'Submit Availability'}
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