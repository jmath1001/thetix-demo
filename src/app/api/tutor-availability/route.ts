import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { DB, withCenter, withCenterPayload } from '@/lib/db'

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY

const supabase = createClient(
  SUPABASE_URL || '',
  SUPABASE_SERVICE_ROLE_KEY || ''
)

function serverConfigError() {
  return NextResponse.json(
    { error: 'Server missing Supabase configuration (SUPABASE_SERVICE_ROLE_KEY).' },
    { status: 500 }
  )
}

export async function GET(req: NextRequest) {
  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) return serverConfigError()

  const { searchParams } = new URL(req.url)
  const termId = searchParams.get('termId')

  if (!termId) {
    return NextResponse.json({ error: 'termId is required' }, { status: 400 })
  }

  const { data, error } = await withCenter(
    supabase
      .from(DB.tutorTermAvailability)
      .select('*')
      .eq('term_id', termId)
  )

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  return NextResponse.json({ overrides: data ?? [] })
}

export async function POST(req: NextRequest) {
  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) return serverConfigError()

  try {
    const { tutorId, termId, availabilityBlocks } = await req.json()

    if (!tutorId || !termId || !Array.isArray(availabilityBlocks)) {
      return NextResponse.json(
        { error: 'tutorId, termId and availabilityBlocks are required' },
        { status: 400 }
      )
    }

    const { data: existing, error: lookupError } = await withCenter(
      supabase
        .from(DB.tutorTermAvailability)
        .select('id')
        .eq('tutor_id', tutorId)
        .eq('term_id', termId)
        .limit(1)
        .maybeSingle()
    )

    if (lookupError) {
      return NextResponse.json({ error: lookupError.message }, { status: 500 })
    }

    if (existing?.id) {
      const { data, error } = await withCenter(
        supabase
          .from(DB.tutorTermAvailability)
          .update({ availability_blocks: availabilityBlocks })
          .eq('id', existing.id)
          .select('*')
          .single()
      )

      if (error) {
        return NextResponse.json({ error: error.message }, { status: 500 })
      }

      return NextResponse.json({ override: data })
    }

    const { data, error } = await supabase
      .from(DB.tutorTermAvailability)
      .insert(withCenterPayload({
        tutor_id: tutorId,
        term_id: termId,
        availability_blocks: availabilityBlocks,
      }))
      .select('*')
      .single()

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 })
    }

    return NextResponse.json({ override: data })
  } catch (err: any) {
    return NextResponse.json({ error: err?.message ?? 'Invalid request body' }, { status: 400 })
  }
}
