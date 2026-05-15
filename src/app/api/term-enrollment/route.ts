import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { DB, withCenter, withCenterPayload } from '@/lib/db'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url)
  const studentId = searchParams.get('studentId')
  const termId = searchParams.get('termId')

  if (studentId && termId) {
    const { data, error } = await withCenter(
      supabase
        .from(DB.termEnrollments)
        .select('*')
        .eq('student_id', studentId)
        .eq('term_id', termId)
        .limit(1)
        .maybeSingle()
    )

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 })
    }

    return NextResponse.json({ enrollment: data ?? null })
  }

  let query = withCenter(
    supabase
      .from(DB.termEnrollments)
      .select('*')
  )

  if (studentId) query = query.eq('student_id', studentId)
  if (termId) query = query.eq('term_id', termId)

  query = query.order('created_at', { ascending: false })

  const { data, error } = await query

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  return NextResponse.json({ enrollments: data ?? [] })
}

export async function POST(req: NextRequest) {
  try {
    const {
      studentId,
      termId,
      subjects,
      availabilityBlocks,
      hoursPurchased,
      syncStudentBalance,         // when true, also write students.hours_left = hoursPurchased
      sessionHours,               // if provided, update students.session_hours
      subjectSessionsPerWeek,     // Record<subject, number> — desired sessions/week per subject
      allowSameDayDouble,         // boolean — may schedule 2 sessions on the same day
      formToken,
      formSubmittedAt,
    } = await req.json()

    if (!studentId || !termId) {
      return NextResponse.json({ error: 'studentId and termId are required' }, { status: 400 })
    }

    const { data: existing, error: existingError } = await withCenter(
      supabase
        .from(DB.termEnrollments)
        .select('*')
        .eq('student_id', studentId)
        .eq('term_id', termId)
        .limit(1)
        .maybeSingle()
    )

    if (existingError) {
      return NextResponse.json({ error: existingError.message }, { status: 500 })
    }

    const updatePayload: Record<string, unknown> = {}
    if (Array.isArray(subjects)) updatePayload.subjects = subjects
    if (Array.isArray(availabilityBlocks)) updatePayload.availability_blocks = availabilityBlocks
    if (typeof hoursPurchased === 'number') updatePayload.hours_purchased = hoursPurchased
    if (subjectSessionsPerWeek && typeof subjectSessionsPerWeek === 'object' && !Array.isArray(subjectSessionsPerWeek)) updatePayload.subject_sessions_per_week = subjectSessionsPerWeek
    if (typeof allowSameDayDouble === 'boolean') updatePayload.allow_same_day_double = allowSameDayDouble
    if (subjectTutorPreference && typeof subjectTutorPreference === 'object' && !Array.isArray(subjectTutorPreference)) updatePayload.subject_tutor_preference = subjectTutorPreference
    if (typeof formToken === 'string') updatePayload.form_token = formToken || null
    if (typeof formSubmittedAt === 'string') updatePayload.form_submitted_at = formSubmittedAt || null

    if (existing) {
      const { data, error } = await withCenter(
        supabase
          .from(DB.termEnrollments)
          .update(updatePayload)
          .eq('id', existing.id)
          .select('*')
          .single()
      )

      if (error) {
        return NextResponse.json({ error: error.message }, { status: 500 })
      }

      if (syncStudentBalance && typeof hoursPurchased === 'number') {
        await withCenter(supabase.from(DB.students).update({ hours_left: hoursPurchased }).eq('id', studentId))
      }
      if (typeof sessionHours === 'number') {
        await withCenter(supabase.from(DB.students).update({ session_hours: Math.max(1, sessionHours) }).eq('id', studentId))
      }

      return NextResponse.json({ enrollment: data })
    }

    const insertPayload = withCenterPayload({
      term_id: termId,
      student_id: studentId,
      subjects: Array.isArray(subjects) ? subjects : [],
      availability_blocks: Array.isArray(availabilityBlocks) ? availabilityBlocks : [],
      hours_purchased: typeof hoursPurchased === 'number' ? hoursPurchased : 0,
      subject_sessions_per_week: (subjectSessionsPerWeek && typeof subjectSessionsPerWeek === 'object' && !Array.isArray(subjectSessionsPerWeek)) ? subjectSessionsPerWeek : {},
      allow_same_day_double: typeof allowSameDayDouble === 'boolean' ? allowSameDayDouble : false,
      subject_tutor_preference: (subjectTutorPreference && typeof subjectTutorPreference === 'object' && !Array.isArray(subjectTutorPreference)) ? subjectTutorPreference : {},
      form_token: typeof formToken === 'string' ? formToken || null : null,
      form_submitted_at: typeof formSubmittedAt === 'string' ? formSubmittedAt || null : null,
    })

    const { data, error } = await supabase
      .from(DB.termEnrollments)
      .insert(insertPayload)
      .select('*')
      .single()

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 })
    }

    if (syncStudentBalance && typeof hoursPurchased === 'number') {
      await withCenter(supabase.from(DB.students).update({ hours_left: hoursPurchased }).eq('id', studentId))
    }
    if (typeof sessionHours === 'number') {
      await withCenter(supabase.from(DB.students).update({ session_hours: Math.max(1, sessionHours) }).eq('id', studentId))
    }

    return NextResponse.json({ enrollment: data })
  } catch (err: any) {
    return NextResponse.json({ error: err?.message ?? 'Invalid request body' }, { status: 400 })
  }
}
