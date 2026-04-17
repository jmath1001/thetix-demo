import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

const p = process.env.NEXT_PUBLIC_TABLE_PREFIX ?? 'slake'
const RECURRING_TABLE = `${p}_recurring_series`
const SESSIONS_TABLE  = `${p}_sessions`
const SS_TABLE        = `${p}_session_students`
const STUDENTS_TABLE  = `${p}_students`
const TIME_OFF_TABLE  = `${p}_tutor_time_off`
const MAX_CAPACITY    = 3

function toISODate(d: Date): string {
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

function createConfirmationToken(): string {
  return globalThis.crypto?.randomUUID?.()
    ?? `${Date.now()}-${Math.random().toString(16).slice(2)}-${Math.random().toString(16).slice(2)}`
}

export async function POST(req: NextRequest) {
  try {
    const { studentId, tutorId, topic, startDate, weeks, time, dayOfWeek } = await req.json()

    if (!studentId || !tutorId || !topic || !startDate || !weeks || !time || dayOfWeek == null) {
      return NextResponse.json({ error: 'Missing required fields' }, { status: 400 })
    }

    const totalWeeks = Math.max(1, Math.min(52, Number(weeks) || 1))

    const { data: studentRow, error: studentErr } = await supabase
      .from(STUDENTS_TABLE)
      .select('id, name')
      .eq('id', studentId)
      .single()

    if (studentErr || !studentRow) {
      return NextResponse.json({ error: 'Student not found' }, { status: 404 })
    }

    // Calculate end date
    const start = new Date(startDate + 'T00:00:00')
    const end   = new Date(start)
    end.setDate(end.getDate() + (totalWeeks - 1) * 7)
    const endDate = end.toISOString().split('T')[0]

    // Create the recurring series row
    const { data: series, error: seriesErr } = await supabase
      .from(RECURRING_TABLE)
      .insert({
        student_id:  studentId,
        tutor_id:    tutorId,
        day_of_week: dayOfWeek,
        time,
        topic,
        start_date:  startDate,
        end_date:    endDate,
        total_weeks: totalWeeks,
        status:      'active',
      })
      .select('id')
      .single()

    if (seriesErr) {
      console.error('Series insert error:', seriesErr)
      return NextResponse.json({ error: seriesErr.message }, { status: 500 })
    }

    const seriesId = series.id

    let createdRows = 0
    let linkedRows = 0
    let skippedTimeOffRows = 0

    for (let w = 0; w < totalWeeks; w++) {
      const d = new Date(startDate + 'T00:00:00')
      d.setDate(d.getDate() + w * 7)
      const isoDate = toISODate(d)

      const { data: offDay, error: offDayErr } = await supabase
        .from(TIME_OFF_TABLE)
        .select('id')
        .eq('tutor_id', tutorId)
        .eq('date', isoDate)
        .maybeSingle()

      if (offDayErr) {
        return NextResponse.json({ error: offDayErr.message }, { status: 500 })
      }

      if (offDay) {
        skippedTimeOffRows += 1
        continue
      }

      const { data: sessionsAtTime, error: sessionsAtTimeErr } = await supabase
        .from(SESSIONS_TABLE)
        .select('id, tutor_id')
        .eq('session_date', isoDate)
        .eq('time', time)

      if (sessionsAtTimeErr) {
        return NextResponse.json({ error: sessionsAtTimeErr.message }, { status: 500 })
      }

      const slotSessionIds = (sessionsAtTime ?? []).map((s: any) => s.id)

      if (slotSessionIds.length > 0) {
        const { data: existingRows, error: existingRowsErr } = await supabase
          .from(SS_TABLE)
          .select('id, session_id')
          .in('session_id', slotSessionIds)
          .eq('student_id', studentId)
          .neq('status', 'cancelled')

        if (existingRowsErr) {
          return NextResponse.json({ error: existingRowsErr.message }, { status: 500 })
        }

        if ((existingRows ?? []).length > 0) {
          const sameTutorBooking = (existingRows ?? []).find((row: any) =>
            (sessionsAtTime ?? []).some((s: any) => s.id === row.session_id && s.tutor_id === tutorId)
          )

          if (sameTutorBooking) {
            const { error: updateErr } = await supabase
              .from(SS_TABLE)
              .update({ series_id: seriesId, topic })
              .eq('id', sameTutorBooking.id)

            if (updateErr) {
              return NextResponse.json({ error: updateErr.message }, { status: 500 })
            }

            linkedRows += 1
            continue
          }

          return NextResponse.json(
            { error: `Student is already booked with another tutor at ${time} on ${isoDate}` },
            { status: 409 }
          )
        }
      }

      let targetSessionId: string
      const existingTargetSession = (sessionsAtTime ?? []).find((s: any) => s.tutor_id === tutorId)

      if (existingTargetSession) {
        targetSessionId = existingTargetSession.id
      } else {
        const { data: createdSession, error: createSessionErr } = await supabase
          .from(SESSIONS_TABLE)
          .insert({ session_date: isoDate, tutor_id: tutorId, time })
          .select('id')
          .single()

        if (createSessionErr || !createdSession) {
          return NextResponse.json({ error: createSessionErr?.message ?? 'Failed to create session' }, { status: 500 })
        }

        targetSessionId = createdSession.id
      }

      const { data: enrolledRows, error: enrolledErr } = await supabase
        .from(SS_TABLE)
        .select('id')
        .eq('session_id', targetSessionId)
        .neq('status', 'cancelled')

      if (enrolledErr) {
        return NextResponse.json({ error: enrolledErr.message }, { status: 500 })
      }

      if ((enrolledRows ?? []).length >= MAX_CAPACITY) {
        return NextResponse.json(
          { error: `Session is full for ${isoDate} ${time}` },
          { status: 409 }
        )
      }

      const { error: enrollErr } = await supabase
        .from(SS_TABLE)
        .insert({
          session_id: targetSessionId,
          student_id: studentId,
          name: studentRow.name,
          topic,
          status: 'scheduled',
          series_id: seriesId,
          confirmation_token: createConfirmationToken(),
        })

      if (enrollErr) {
        return NextResponse.json({ error: enrollErr.message }, { status: 500 })
      }

      createdRows += 1
    }

    return NextResponse.json({ success: true, seriesId, createdRows, linkedRows, skippedTimeOffRows })
  } catch (err) {
    console.error('Recurring series error:', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}