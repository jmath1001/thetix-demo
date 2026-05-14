import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { DB, withCenter } from '@/lib/db'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

export const DEFAULT_SUBJECTS = [
  'Algebra', 'Geometry', 'Precalculus', 'Calculus', 'Statistics',
  'IB Math', 'Physics', 'Chemistry', 'Biology', 'Psychology',
  'SAT Math', 'ACT Math', 'ACT Science', 'ACT English', 'SAT R/W',
  'English/Writing', 'Literature', 'History',
  'AP Physics C Mechanics', 'AP Physics C E&M', 'AP Environmental Science', 'AP Statistics',
]

export async function GET() {
  try {
    const { data, error } = await withCenter(
      supabase.from(DB.centerSettings).select('id, subjects').limit(1)
    ).maybeSingle()

    if (error) throw error

    const subjects =
      Array.isArray((data as any)?.subjects) && (data as any).subjects.length > 0
        ? (data as any).subjects as string[]
        : DEFAULT_SUBJECTS

    return NextResponse.json({ subjects })
  } catch {
    return NextResponse.json({ subjects: DEFAULT_SUBJECTS })
  }
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json()
    if (!Array.isArray(body?.subjects)) {
      return NextResponse.json({ error: 'subjects must be an array' }, { status: 400 })
    }

    const subjects: string[] = (body.subjects as unknown[])
      .filter((s): s is string => typeof s === 'string' && s.trim() !== '')
      .map(s => s.trim())

    const { data: existing, error: fetchErr } = await withCenter(
      supabase.from(DB.centerSettings).select('id').limit(1)
    ).maybeSingle()

    if (fetchErr) throw fetchErr
    if (!existing?.id) {
      return NextResponse.json({ error: 'Center settings not found' }, { status: 404 })
    }

    const { error: updateErr } = await withCenter(
      supabase.from(DB.centerSettings).update({ subjects } as any)
    ).eq('id', existing.id)

    if (updateErr) throw updateErr

    return NextResponse.json({ subjects })
  } catch (err: any) {
    return NextResponse.json({ error: err?.message ?? 'Failed to save subjects' }, { status: 500 })
  }
}
