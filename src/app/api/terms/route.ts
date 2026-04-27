import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { DB, withCenter, withCenterPayload } from '@/lib/db'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

function normalizeStatus(value: unknown): string {
  return typeof value === 'string' ? value.trim().toLowerCase() : ''
}

async function demoteOtherActiveTerms(currentTermId: string) {
  const { data, error } = await withCenter(
    supabase
      .from(DB.terms)
      .select('id, status')
  )

  if (error) {
    throw error
  }

  const idsToDemote = (data ?? [])
    .filter((row: any) => row.id !== currentTermId && normalizeStatus(row.status) === 'active')
    .map((row: any) => row.id)

  if (idsToDemote.length === 0) return

  const { error: demoteError } = await withCenter(
    supabase
      .from(DB.terms)
      .update({ status: 'upcoming' })
      .in('id', idsToDemote)
  )

  if (demoteError) {
    throw demoteError
  }
}

export async function GET() {
  const { data, error } = await withCenter(
    supabase
      .from(DB.terms)
      .select('*')
      .order('start_date', { ascending: false })
  )

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  const scopedTerms = Array.isArray(data) ? data : []
  const scopedTermIds = new Set(scopedTerms.map((term: any) => term.id))

  const { data: enrollmentRows, error: enrollmentError } = await withCenter(
    supabase
      .from(DB.termEnrollments)
      .select('term_id')
  )

  if (enrollmentError) {
    return NextResponse.json({ error: enrollmentError.message }, { status: 500 })
  }

  const referencedTermIds = Array.from(new Set(
    (enrollmentRows ?? [])
      .map((row: any) => row.term_id)
      .filter((id: unknown): id is string => typeof id === 'string' && id.trim().length > 0)
  ))

  const missingTermIds = referencedTermIds.filter(id => !scopedTermIds.has(id))

  if (missingTermIds.length === 0) {
    return NextResponse.json({ terms: scopedTerms })
  }

  const { data: referencedTerms, error: referencedTermsError } = await supabase
    .from(DB.terms)
    .select('*')
    .in('id', missingTermIds)

  if (referencedTermsError) {
    return NextResponse.json({ error: referencedTermsError.message }, { status: 500 })
  }

  const mergedTerms = [...scopedTerms, ...(referencedTerms ?? [])]
    .sort((a: any, b: any) => String(b.start_date).localeCompare(String(a.start_date)))

  return NextResponse.json({ terms: mergedTerms })
}

export async function POST(req: NextRequest) {
  try {
    const { name, startDate, endDate, status, operatingHours, sessionTimesByDay } = await req.json()

    if (!name || !startDate || !endDate) {
      return NextResponse.json({ error: 'name, startDate, and endDate are required' }, { status: 400 })
    }

    const payload = withCenterPayload({
      name: String(name).trim(),
      start_date: String(startDate),
      end_date: String(endDate),
      status: typeof status === 'string' && status.trim() ? status : 'upcoming',
      ...(typeof operatingHours === 'object' && operatingHours
        ? { operating_hours: operatingHours }
        : {}),
      ...(typeof sessionTimesByDay === 'object' && sessionTimesByDay
        ? { session_times_by_day: sessionTimesByDay }
        : {}),
    })

    const { data, error } = await supabase
      .from(DB.terms)
      .insert(payload)
      .select('*')
      .single()

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 })
    }

    if (data?.id && normalizeStatus(data.status) === 'active') {
      await demoteOtherActiveTerms(data.id)
    }

    return NextResponse.json({ term: data })
  } catch (err: any) {
    return NextResponse.json({ error: err?.message ?? 'Invalid request body' }, { status: 400 })
  }
}

export async function PATCH(req: NextRequest) {
  try {
    const { id, name, startDate, endDate, status, operatingHours, sessionTimesByDay } = await req.json()

    if (!id) {
      return NextResponse.json({ error: 'id is required' }, { status: 400 })
    }

    const updatePayload: Record<string, any> = {}
    if (typeof name === 'string') updatePayload.name = name.trim()
    if (typeof startDate === 'string' && startDate.trim()) updatePayload.start_date = startDate
    if (typeof endDate === 'string' && endDate.trim()) updatePayload.end_date = endDate
    if (typeof status === 'string' && status.trim()) updatePayload.status = status
    if (typeof operatingHours === 'object' && operatingHours) updatePayload.operating_hours = operatingHours
    if (typeof sessionTimesByDay === 'object' && sessionTimesByDay) updatePayload.session_times_by_day = sessionTimesByDay

    const { data, error } = await withCenter(
      supabase
        .from(DB.terms)
        .update(updatePayload)
        .eq('id', id)
        .select('*')
        .single()
    )

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 })
    }

    if (data?.id && normalizeStatus(data.status) === 'active') {
      await demoteOtherActiveTerms(data.id)
    }

    return NextResponse.json({ term: data })
  } catch (err: any) {
    return NextResponse.json({ error: err?.message ?? 'Invalid request body' }, { status: 400 })
  }
}
