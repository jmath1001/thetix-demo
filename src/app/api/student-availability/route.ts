import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { DB, withCenter, withCenterPayload } from '@/lib/db'

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY

if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
  console.error('Missing Supabase config for student availability API')
}

const supabase = createClient(
  SUPABASE_URL || '',
  SUPABASE_SERVICE_ROLE_KEY || ''
)

export async function POST(req: NextRequest) {
  try {
    if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
      return NextResponse.json(
        { error: 'Server missing Supabase configuration (SUPABASE_SERVICE_ROLE_KEY).' },
        { status: 500 }
      )
    }

    const { studentId, availabilityBlocks, termId } = await req.json()

    if (!studentId || !Array.isArray(availabilityBlocks)) {
      return NextResponse.json(
        { error: 'Missing studentId or invalid availabilityBlocks' },
        { status: 400 }
      )
    }

    if (termId) {
      const { data: existing, error: existingErr } = await withCenter(
        supabase
          .from(DB.termEnrollments)
          .select('id')
          .eq('student_id', studentId)
          .eq('term_id', termId)
          .limit(1)
          .maybeSingle()
      )

      if (existingErr) {
        console.error('Supabase term enrollment lookup error:', existingErr)
        return NextResponse.json({ error: existingErr.message }, { status: 500 })
      }

      if (existing?.id) {
        const { data, error } = await withCenter(
          supabase
            .from(DB.termEnrollments)
            .update({ availability_blocks: availabilityBlocks })
            .eq('id', existing.id)
            .select()
        )

        if (error) {
          console.error('Supabase term enrollment update error:', error)
          return NextResponse.json({ error: error.message }, { status: 500 })
        }

        return NextResponse.json({ success: true, data })
      }

      const { data, error } = await supabase
        .from(DB.termEnrollments)
        .insert(withCenterPayload({
          term_id: termId,
          student_id: studentId,
          availability_blocks: availabilityBlocks,
        }))
        .select()

      if (error) {
        console.error('Supabase term enrollment insert error:', error)
        return NextResponse.json({ error: error.message }, { status: 500 })
      }

      return NextResponse.json({ success: true, data })
    }

    const { data, error } = await withCenter(
      supabase
        .from(DB.students)
        .update({ availability_blocks: availabilityBlocks })
        .eq('id', studentId)
        .select()
    )

    if (error) {
      console.error('Supabase error:', error)
      return NextResponse.json({ error: error.message }, { status: 500 })
    }

    if (!data || data.length === 0) {
      return NextResponse.json(
        { error: `No student updated for id ${studentId}.` },
        { status: 404 }
      )
    }

    return NextResponse.json({ success: true, data })
  } catch (err) {
    console.error('Error updating availability:', err)
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    )
  }
}
