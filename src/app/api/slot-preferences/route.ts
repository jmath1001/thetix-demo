import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { DB, withCenter, withCenterPayload } from '@/lib/db'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

// GET /api/slot-preferences?studentId=&termId=
export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url)
  const studentId = searchParams.get('studentId')
  const termId = searchParams.get('termId')

  if (!studentId || !termId) {
    return NextResponse.json({ error: 'studentId and termId are required' }, { status: 400 })
  }

  const { data, error } = await withCenter(
    supabase
      .from(DB.termEnrollments)
      .select('id, slot_preferences, subjects, subject_tutor_preference')
      .eq('student_id', studentId)
      .eq('term_id', termId)
      .limit(1)
      .maybeSingle()
  )

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  return NextResponse.json({
    enrollment: data ?? null,
    slotPreferences: data?.slot_preferences ?? null,
  })
}

// POST /api/slot-preferences
// Body: { studentId, termId, slotPreferences: string[][] }
export async function POST(req: NextRequest) {
  try {
    const { studentId, termId, slotPreferences } = await req.json()

    if (!studentId || !termId) {
      return NextResponse.json({ error: 'studentId and termId are required' }, { status: 400 })
    }

    if (!Array.isArray(slotPreferences) || slotPreferences.length > 3) {
      return NextResponse.json(
        { error: 'slotPreferences must be an array of up to 3 choices' },
        { status: 400 }
      )
    }

    // Validate each choice: array of 1–2 block strings in "dayNum-HH:MM" format
    const blockPattern = /^\d-([01]\d|2[0-3]):[0-5]\d$/
    for (const choice of slotPreferences) {
      if (!Array.isArray(choice) || choice.length === 0 || choice.length > 2) {
        return NextResponse.json(
          { error: 'Each choice must be an array of 1 or 2 block strings' },
          { status: 400 }
        )
      }
      for (const block of choice) {
        if (typeof block !== 'string' || !blockPattern.test(block)) {
          return NextResponse.json(
            { error: `Invalid block format: "${block}". Expected "dayNum-HH:MM"` },
            { status: 400 }
          )
        }
      }
    }

    // Upsert into term_enrollments (enrollment row must already exist)
    const { data: existing, error: lookupErr } = await withCenter(
      supabase
        .from(DB.termEnrollments)
        .select('id')
        .eq('student_id', studentId)
        .eq('term_id', termId)
        .limit(1)
        .maybeSingle()
    )

    if (lookupErr) {
      return NextResponse.json({ error: lookupErr.message }, { status: 500 })
    }

    if (existing?.id) {
      const { data, error } = await withCenter(
        supabase
          .from(DB.termEnrollments)
          .update({ slot_preferences: slotPreferences })
          .eq('id', existing.id)
          .select('id, slot_preferences')
          .single()
      )
      if (error) return NextResponse.json({ error: error.message }, { status: 500 })
      return NextResponse.json({ success: true, data })
    }

    // No enrollment yet — create a minimal one
    const { data, error } = await supabase
      .from(DB.termEnrollments)
      .insert(withCenterPayload({
        student_id: studentId,
        term_id: termId,
        slot_preferences: slotPreferences,
        subjects: [],
        availability_blocks: [],
        hours_purchased: 0,
        subject_sessions_per_week: {},
        allow_same_day_double: false,
        subject_tutor_preference: {},
      }))
      .select('id, slot_preferences')
      .single()

    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    return NextResponse.json({ success: true, data })
  } catch (err) {
    console.error('slot-preferences POST error:', err)
    return NextResponse.json({ error: 'Unexpected server error' }, { status: 500 })
  }
}
