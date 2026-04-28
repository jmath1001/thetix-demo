'use client'
import { Suspense, useEffect, useState } from 'react'
import { useSearchParams } from 'next/navigation'
import { Check, Loader2 } from 'lucide-react'

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
    return { time: start, label: `Session ${i + 1}`, display: end ? `${fmt12(start)} – ${fmt12(end)}` : fmt12(start) }
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
  const [selectedBlocks, setSelectedBlocks] = useState<string[]>([])
  const [submitting, setSubmitting] = useState(false)

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
        setSelectedBlocks(Array.isArray(enroll?.availability_blocks) ? enroll.availability_blocks : [])
        if (enroll?.form_submitted_at) setStatus('submitted')
        else setStatus('ready')
      })
      .catch(() => { setErrorMsg('Failed to load form.'); setStatus('error') })
  }, [token])

  const toggleSubject = (s: string) =>
    setSelectedSubjects(prev => prev.includes(s) ? prev.filter(x => x !== s) : [...prev, s])

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
      body: JSON.stringify({ token, subjects: selectedSubjects, availabilityBlocks: selectedBlocks }),
    })
    const data = await res.json()
    setSubmitting(false)
    if (!res.ok) { alert(data.error ?? 'Failed to submit. Please try again.'); return }
    setStatus('submitted')
  }

  if (status === 'loading') return (
    <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#fafafa' }}>
      <Loader2 size={28} style={{ color: '#dc2626', animation: 'spin 1s linear infinite' }} />
      <style>{`@keyframes spin { to { transform: rotate(360deg) } }`}</style>
    </div>
  )

  if (status === 'error') return (
    <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#fafafa', padding: 24 }}>
      <div style={{ maxWidth: 400, textAlign: 'center' }}>
        <p style={{ fontSize: 20, fontWeight: 700, color: '#0f172a', marginBottom: 8 }}>Invalid Link</p>
        <p style={{ fontSize: 14, color: '#64748b' }}>{errorMsg}</p>
      </div>
    </div>
  )

  if (status === 'submitted') return (
    <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#fafafa', padding: 24 }}>
      <div style={{ maxWidth: 420, textAlign: 'center' }}>
        <div style={{ width: 56, height: 56, borderRadius: '50%', background: '#dcfce7', display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto 16px' }}>
          <Check size={28} style={{ color: '#16a34a' }} />
        </div>
        <p style={{ fontSize: 22, fontWeight: 800, color: '#0f172a', marginBottom: 8 }}>You're all set!</p>
        <p style={{ fontSize: 14, color: '#64748b', lineHeight: 1.6 }}>
          We've received {studentName}'s availability and subjects for <strong>{termName}</strong>. The center will be in touch about scheduling.
        </p>
      </div>
    </div>
  )

  const allSessionBlocks = DAYS.flatMap(d => parseSessionTimesForDay(d.dow, sessionTimesByDay).map(b => ({ ...b, dow: d.dow })))
  const uniqueTimes = Array.from(new Map(allSessionBlocks.map(b => [b.time, b])).values())

  return (
    <div style={{ minHeight: '100vh', background: '#fafafa', padding: '32px 16px', fontFamily: 'ui-sans-serif, system-ui, sans-serif' }}>
      <div style={{ maxWidth: 680, margin: '0 auto' }}>
        <div style={{ marginBottom: 32 }}>
          <div style={{ display: 'inline-block', background: '#dc2626', color: 'white', fontSize: 11, fontWeight: 800, letterSpacing: '0.08em', textTransform: 'uppercase', padding: '4px 10px', borderRadius: 6, marginBottom: 12 }}>
            C2 Education
          </div>
          <h1 style={{ fontSize: 26, fontWeight: 800, color: '#0f172a', margin: '0 0 6px' }}>Enrollment Form</h1>
          <p style={{ fontSize: 14, color: '#64748b', margin: 0 }}>
            For <strong style={{ color: '#0f172a' }}>{studentName}</strong> · <strong style={{ color: '#0f172a' }}>{termName}</strong>
          </p>
        </div>

        <div style={{ background: 'white', border: '1px solid #e2e8f0', borderRadius: 16, padding: 24, marginBottom: 20 }}>
          <p style={{ fontSize: 11, fontWeight: 800, textTransform: 'uppercase', letterSpacing: '0.1em', color: '#64748b', margin: '0 0 4px' }}>Step 1</p>
          <h2 style={{ fontSize: 17, fontWeight: 700, color: '#0f172a', margin: '0 0 16px' }}>What subjects does your student need help with?</h2>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 8 }}>
            {selectedSubjects.length > 0
              ? selectedSubjects.map(s => <span key={s} style={{ fontSize: 11, fontWeight: 700, padding: '3px 10px', borderRadius: 20, background: '#dcfce7', color: '#15803d', border: '1px solid #86efac' }}>{s}</span>)
              : <span style={{ fontSize: 12, color: '#94a3b8' }}>Nothing selected yet</span>}
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12, marginTop: 16 }}>
            {SUBJECTS.map(group => (
              <div key={group.group}>
                <p style={{ fontSize: 10, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.08em', color: '#94a3b8', margin: '0 0 8px' }}>{group.group}</p>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                  {group.subjects.map(s => {
                    const active = selectedSubjects.includes(s)
                    return (
                      <button key={s} onClick={() => toggleSubject(s)}
                        style={{ padding: '6px 14px', borderRadius: 20, border: `1.5px solid ${active ? '#dc2626' : '#e2e8f0'}`, background: active ? '#dc2626' : 'white', color: active ? 'white' : '#475569', fontSize: 13, fontWeight: 600, cursor: 'pointer' }}>
                        {s}
                      </button>
                    )
                  })}
                </div>
              </div>
            ))}
          </div>
        </div>

        <div style={{ background: 'white', border: '1px solid #e2e8f0', borderRadius: 16, padding: 24, marginBottom: 20 }}>
          <p style={{ fontSize: 11, fontWeight: 800, textTransform: 'uppercase', letterSpacing: '0.1em', color: '#64748b', margin: '0 0 4px' }}>Step 2</p>
          <h2 style={{ fontSize: 17, fontWeight: 700, color: '#0f172a', margin: '0 0 4px' }}>When is your student available?</h2>
          <p style={{ fontSize: 13, color: '#64748b', margin: '0 0 20px' }}>Select all session times that work. The center will schedule within these windows.</p>
          {uniqueTimes.length === 0 ? (
            <p style={{ fontSize: 13, color: '#94a3b8', fontStyle: 'italic' }}>No session times configured for this term yet.</p>
          ) : (
            <div style={{ overflowX: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 400 }}>
                <thead>
                  <tr style={{ background: '#f8fafc', borderBottom: '1px solid #e2e8f0' }}>
                    <th style={{ textAlign: 'left', fontSize: 11, fontWeight: 700, color: '#64748b', padding: '8px 12px' }}>Session</th>
                    {DAYS.map(d => <th key={d.dow} style={{ textAlign: 'center', fontSize: 11, fontWeight: 700, color: '#64748b', padding: '8px 8px' }}>{d.label}</th>)}
                  </tr>
                </thead>
                <tbody>
                  {uniqueTimes.map((block, bi) => (
                    <tr key={block.time} style={{ borderBottom: bi < uniqueTimes.length - 1 ? '1px solid #f1f5f9' : 'none' }}>
                      <td style={{ padding: '8px 12px' }}>
                        <div style={{ fontSize: 12, fontWeight: 700, color: '#0f172a' }}>{block.label}</div>
                        <div style={{ fontSize: 11, color: '#64748b' }}>{block.display}</div>
                      </td>
                      {DAYS.map(d => {
                        const applicable = parseSessionTimesForDay(d.dow, sessionTimesByDay).some(b => b.time === block.time)
                        const key = `${d.dow}-${block.time}`
                        const active = applicable && selectedBlocks.includes(key)
                        return (
                          <td key={d.dow} style={{ padding: 8, textAlign: 'center' }}>
                            {applicable ? (
                              <button onClick={() => toggleBlock(d.dow, block.time)}
                                style={{ width: 28, height: 28, borderRadius: 8, border: `1.5px solid ${active ? '#dc2626' : '#cbd5e1'}`, background: active ? '#dc2626' : 'white', color: active ? 'white' : '#94a3b8', fontSize: 13, fontWeight: 800, cursor: 'pointer' }}>
                                {active ? '✓' : ''}
                              </button>
                            ) : (
                              <div style={{ width: 28, height: 28, margin: '0 auto', borderRadius: 8, background: '#f1f5f9' }} />
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
          {selectedBlocks.length > 0 && (
            <p style={{ marginTop: 12, fontSize: 12, color: '#15803d', fontWeight: 600 }}>
              {selectedBlocks.length} time slot{selectedBlocks.length !== 1 ? 's' : ''} selected
            </p>
          )}
        </div>

        <button onClick={handleSubmit} disabled={submitting || selectedSubjects.length === 0}
          style={{ width: '100%', padding: 14, borderRadius: 12, border: 'none', background: selectedSubjects.length > 0 ? '#dc2626' : '#e2e8f0', color: selectedSubjects.length > 0 ? 'white' : '#94a3b8', fontSize: 15, fontWeight: 800, cursor: selectedSubjects.length > 0 ? 'pointer' : 'not-allowed', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8 }}>
          {submitting ? <><Loader2 size={16} style={{ animation: 'spin 1s linear infinite' }} /> Submitting…</> : 'Submit Enrollment'}
        </button>
        <p style={{ textAlign: 'center', fontSize: 12, color: '#94a3b8', marginTop: 12 }}>You can resubmit this form if anything changes.</p>
        <style>{`@keyframes spin { to { transform: rotate(360deg) } }`}</style>
      </div>
    </div>
  )
}

export default function EnrollPage() {
  return (
    <Suspense fallback={
      <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#fafafa' }}>
        <Loader2 size={28} style={{ color: '#dc2626', animation: 'spin 1s linear infinite' }} />
        <style>{`@keyframes spin { to { transform: rotate(360deg) } }`}</style>
      </div>
    }>
      <EnrollForm />
    </Suspense>
  )
}