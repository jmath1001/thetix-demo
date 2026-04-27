import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { DB, withCenter, withCenterPayload } from '@/lib/db'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

export async function POST(req: NextRequest) {
  try {
    const { studentId, subjects, termId } = await req.json()

    if (!studentId || !Array.isArray(subjects)) {
      return NextResponse.json({ error: 'Missing studentId or subjects' }, { status: 400 })
    }

    if (termId) {
      const { data: existing, error: existingError } = await withCenter(
        supabase
          .from(DB.termEnrollments)
          .select('id')
          .eq('student_id', studentId)
          .eq('term_id', termId)
          .limit(1)
          .maybeSingle()
      )

      if (existingError) {
        console.error('Supabase term enrollment lookup error:', existingError)
        return NextResponse.json({ error: existingError.message }, { status: 500 })
      }

      if (existing?.id) {
        const { error } = await withCenter(
          supabase
            .from(DB.termEnrollments)
            .update({ subjects })
            .eq('id', existing.id)
        )

        if (error) {
          console.error('Supabase term enrollment update error:', error)
          return NextResponse.json({ error: 'Failed to update term subjects' }, { status: 500 })
        }

        return NextResponse.json({ success: true, subjects })
      }

      const { error } = await supabase
        .from(DB.termEnrollments)
        .insert(withCenterPayload({
          term_id: termId,
          student_id: studentId,
          subjects,
        }))

      if (error) {
        console.error('Supabase term enrollment insert error:', error)
        return NextResponse.json({ error: 'Failed to create term subjects' }, { status: 500 })
      }

      return NextResponse.json({ success: true, subjects })
    }

    const { error } = await withCenter(
      supabase
        .from(DB.students)
        .update({ subjects })
        .eq('id', studentId)
    )

    if (error) {
      console.error('Supabase update error:', error)
      return NextResponse.json({ error: 'Failed to update subjects' }, { status: 500 })
    }

    return NextResponse.json({ success: true, subjects })
  } catch (err) {
    console.error('Error in student-subjects route:', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
