import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { DB } from '@/lib/db'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

export async function GET(req: NextRequest) {
  const token = new URL(req.url).searchParams.get('token')
  if (!token) return NextResponse.json({ error: 'token is required' }, { status: 400 })

  const { data, error } = await supabase
    .from(DB.termEnrollments)
    .select(`*, ${DB.students}(name, grade), ${DB.terms}(name, start_date, end_date, session_times_by_day)`)
    .eq('form_token', token)
    .maybeSingle()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  if (!data) return NextResponse.json({ error: 'Invalid or expired token' }, { status: 404 })

  return NextResponse.json({ enrollment: data })
}

export async function POST(req: NextRequest) {
  try {
    const { token, subjects, subjectSessionsPerWeek, availabilityBlocks } = await req.json()
    if (!token) return NextResponse.json({ error: 'token is required' }, { status: 400 })

    const { data: existing, error: lookupErr } = await supabase
      .from(DB.termEnrollments)
      .select('id')
      .eq('form_token', token)
      .maybeSingle()

    if (lookupErr) return NextResponse.json({ error: lookupErr.message }, { status: 500 })
    if (!existing) return NextResponse.json({ error: 'Invalid or expired token' }, { status: 404 })

    const updateFields: Record<string, unknown> = {
      subjects: Array.isArray(subjects) ? subjects : [],
      availability_blocks: Array.isArray(availabilityBlocks) ? availabilityBlocks : [],
      form_submitted_at: new Date().toISOString(),
    }
    if (subjectSessionsPerWeek && typeof subjectSessionsPerWeek === 'object' && !Array.isArray(subjectSessionsPerWeek)) {
      updateFields.subject_sessions_per_week = subjectSessionsPerWeek
    }

    const { error } = await supabase
      .from(DB.termEnrollments)
      .update(updateFields)
      .eq('id', existing.id)

    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    return NextResponse.json({ ok: true })
  } catch (err: any) {
    return NextResponse.json({ error: err?.message ?? 'Invalid request' }, { status: 400 })
  }
}