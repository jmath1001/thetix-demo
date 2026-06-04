/**
 * POST /api/auto-schedule
 *
 * Applies a slot-scheduler proposal to the database.
 * The client first calls /api/slot-scheduler to get a proposal, lets the user
 * review it, then calls this endpoint to commit the assignments.
 *
 * Body:
 *   termId        -- the term being scheduled
 *   assignments   -- array from /api/slot-scheduler output
 *   mode          -- 'recurring' | 'week'
 *   weekStart     -- YYYY-MM-DD Monday (required for mode='week')
 *   skipExisting  -- skip students already scheduled in range
 */

import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { DB, withCenter, withCenterPayload } from '@/lib/db'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

const MAX_CAPACITY = 3

interface SlotAssignment {
  studentId: string
  studentName: string
  subject: string
  choiceUsed: 1 | 2 | 3
  blocks: string[]
  tutorId: string
  tutorName: string
}

function parseBlock(block: string): { dow: number; time: string } | null {
  const m = block.match(/^(\d)-([\d:]+)$/)
  return m ? { dow: parseInt(m[1], 10), time: m[2] } : null
}

function nextDateForDow(fromDate: string, dow: number): string {
  const d = new Date(fromDate + 'T00:00:00')
  const jsDow = dow === 7 ? 0 : dow
  const current = d.getDay()
  const diff = (jsDow - current + 7) % 7
  d.setDate(d.getDate() + diff)
  return d.toISOString().slice(0, 10)
}

function dateInWeek(monday: string, dow: number): string {
  const d = new Date(monday + 'T00:00:00')
  d.setDate(d.getDate() + (dow - 1))
  return d.toISOString().slice(0, 10)
}

function addDays(dateStr: string, days: number): string {
  const d = new Date(dateStr + 'T00:00:00')
  d.setDate(d.getDate() + days)
  return d.toISOString().slice(0, 10)
}

function countWeeks(start: string, dow: number, end: string): number {
  const first = nextDateForDow(start, dow)
  if (first > end) return 0
  let count = 1
  let cur = addDays(first, 7)
  while (cur <= end) { count++; cur = addDays(cur, 7) }
  return count
}

function createConfirmationToken(): string {
  return (
    globalThis.crypto?.randomUUID?.() ??
    `${Date.now()}-${Math.random().toString(36).slice(2)}`
  )
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json()
    const {
      termId,
      assignments = [],
      mode = 'recurring',
      weekStart,
      skipExisting = true,
    } = body as {
      termId: string
      assignments: SlotAssignment[]
      mode?: 'recurring' | 'week'
      weekStart?: string
      skipExisting?: boolean
    }

    if (!termId) return NextResponse.json({ error: 'termId is required' }, { status: 400 })
    if (!Array.isArray(assignments) || assignments.length === 0) {
      return NextResponse.json({ created: 0, skipped: 0, errors: [] })
    }
    if (mode === 'week' && !weekStart) {
      return NextResponse.json({ error: 'weekStart is required for week mode' }, { status: 400 })
    }

    const { data: term, error: termErr } = await withCenter(
      supabase.from(DB.terms).select('id, start_date, end_date').eq('id', termId).single()
    )
    if (termErr || !term) return NextResponse.json({ error: termErr?.message ?? 'Term not found' }, { status: 404 })

    const termStart: string = term.start_date
    const termEnd: string   = term.end_date
    const weekEnd = weekStart ? addDays(weekStart, 6) : ''
    const rangeStart = mode === 'week' ? (weekStart as string) : termStart
    const rangeEnd   = mode === 'week' ? weekEnd              : termEnd

    const skippedStudentIds = new Set<string>()
    if (skipExisting) {
      const { data: existingSessions } = await withCenter(
        supabase.from(DB.sessions).select('id').gte('session_date', rangeStart).lte('session_date', rangeEnd)
      )
      const ids = (existingSessions ?? []).map((s: any) => s.id)
      if (ids.length > 0) {
        const { data: existingSS } = await withCenter(
          supabase.from(DB.sessionStudents).select('student_id').in('session_id', ids)
        )
        for (const row of existingSS ?? []) skippedStudentIds.add(row.student_id)
      }
    }

    let created = 0
    let skipped = 0
    const errors: string[] = []
    const sessionCache: Record<string, string> = {}

    async function findOrCreateSession(tutorId: string, date: string, time: string): Promise<string | null> {
      const k = `${tutorId}||${date}||${time}`
      if (sessionCache[k]) return sessionCache[k]
      const { data: existing } = await withCenter(
        supabase.from(DB.sessions).select('id').eq('session_date', date).eq('tutor_id', tutorId).eq('time', time).maybeSingle()
      )
      if (existing?.id) { sessionCache[k] = existing.id; return existing.id }
      const { data, error } = await supabase
        .from(DB.sessions)
        .insert(withCenterPayload({ session_date: date, tutor_id: tutorId, time }))
        .select('id').single()
      if (error || !data) { console.error('session create', error); return null }
      sessionCache[k] = data.id
      return data.id
    }

    async function enrollInSession(sessId: string, studentId: string, studentName: string, subject: string, seriesId?: string): Promise<boolean> {
      const { count } = await withCenter(
        supabase.from(DB.sessionStudents).select('id', { count: 'exact', head: true }).eq('session_id', sessId).neq('status', 'cancelled')
      )
      if ((count ?? 0) >= MAX_CAPACITY) return false
      const { data: already } = await withCenter(
        supabase.from(DB.sessionStudents).select('id').eq('session_id', sessId).eq('student_id', studentId).neq('status', 'cancelled').maybeSingle()
      )
      if (already) return false
      const { error } = await supabase.from(DB.sessionStudents).insert(withCenterPayload({
        session_id: sessId, student_id: studentId, name: studentName,
        topic: subject || null, status: 'scheduled',
        series_id: seriesId ?? null,
        confirmation_token: createConfirmationToken(),
      }))
      return !error
    }

    for (const a of assignments) {
      if (skipExisting && skippedStudentIds.has(a.studentId)) {
        skipped++
        continue
      }

      if (mode === 'recurring') {
        for (const block of a.blocks) {
          const parsed = parseBlock(block)
          if (!parsed) continue
          const firstDate = nextDateForDow(termStart, parsed.dow)
          if (firstDate > termEnd) continue
          const weeks = countWeeks(termStart, parsed.dow, termEnd)
          if (weeks === 0) continue
          const endDate = addDays(firstDate, (weeks - 1) * 7)

          const { data: series, error: seriesErr } = await supabase
            .from(DB.recurringSeries)
            .insert(withCenterPayload({
              student_id: a.studentId, tutor_id: a.tutorId,
              day_of_week: parsed.dow, time: parsed.time,
              topic: a.subject || null,
              start_date: firstDate, end_date: endDate,
              total_weeks: weeks, status: 'active',
            }))
            .select('id').single()

          if (seriesErr || !series) {
            errors.push(Series for : )
            continue
          }

          for (let w = 0; w < weeks; w++) {
            const date = addDays(firstDate, w * 7)
            const { data: offDay } = await withCenter(
              supabase.from(DB.timeOff).select('id').eq('tutor_id', a.tutorId).eq('date', date).maybeSingle()
            )
            if (offDay) continue
            const sessId = await findOrCreateSession(a.tutorId, date, parsed.time)
            if (!sessId) continue
            const ok = await enrollInSession(sessId, a.studentId, a.studentName, a.subject, series.id)
            if (ok) created++
          }
        }
      } else {
        for (const block of a.blocks) {
          const parsed = parseBlock(block)
          if (!parsed) continue
          const date = dateInWeek(weekStart!, parsed.dow)
          if (date < rangeStart || date > rangeEnd || date < termStart || date > termEnd) continue
          const sessId = await findOrCreateSession(a.tutorId, date, parsed.time)
          if (!sessId) continue
          const ok = await enrollInSession(sessId, a.studentId, a.studentName, a.subject)
          if (ok) created++
        }
      }
    }

    return NextResponse.json({ created, skipped, errors })
  } catch (err) {
    console.error('auto-schedule apply error:', err)
    return NextResponse.json({ error: 'Unexpected server error' }, { status: 500 })
  }
}
