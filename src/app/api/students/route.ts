import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { DB, withCenter } from '@/lib/db'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

export async function PATCH(req: NextRequest) {
  try {
    const { id, hours_left } = await req.json()
    if (!id) return NextResponse.json({ error: 'id is required' }, { status: 400 })

    const { error } = await withCenter(supabase.from(DB.students).update({ hours_left: Number(hours_left ?? 0) }).eq('id', id))
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })

    return NextResponse.json({ success: true })
  } catch (err) {
    console.error('Error patching student:', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

export async function DELETE(req: NextRequest) {
  try {
    const { ids } = await req.json()
    if (!Array.isArray(ids) || ids.length === 0) {
      return NextResponse.json({ error: 'ids must be a non-empty array' }, { status: 400 })
    }

    // 1. Get session_student IDs so we can delete reminder_logs that reference them
    const { data: ssRows, error: ssFetchErr } = await supabase
      .from(DB.sessionStudents).select('id').in('student_id', ids)
    if (ssFetchErr) return NextResponse.json({ error: ssFetchErr.message }, { status: 500 })

    const ssIds = (ssRows ?? []).map((r: { id: string }) => r.id)

    // 2. reminder_logs → session_students (FK: session_student_id)
    if (ssIds.length > 0) {
      const { error: rlErr } = await supabase.from(DB.reminderLogs).delete().in('session_student_id', ssIds)
      if (rlErr) return NextResponse.json({ error: rlErr.message }, { status: 500 })
    }

    // 3. session_students
    const { error: ssErr } = await supabase.from(DB.sessionStudents).delete().in('student_id', ids)
    if (ssErr) return NextResponse.json({ error: ssErr.message }, { status: 500 })

    // 4. recurring_series
    const { error: rsErr } = await supabase.from(DB.recurringSeries).delete().in('student_id', ids)
    if (rsErr) return NextResponse.json({ error: rsErr.message }, { status: 500 })

    // 5. term_enrollments
    const { error: teErr } = await supabase.from(DB.termEnrollments).delete().in('student_id', ids)
    if (teErr) return NextResponse.json({ error: teErr.message }, { status: 500 })

    // 6. students
    const { error: stuErr } = await withCenter(supabase.from(DB.students).delete()).in('id', ids)
    if (stuErr) return NextResponse.json({ error: stuErr.message }, { status: 500 })

    return NextResponse.json({ success: true, deleted: ids.length })
  } catch (err) {
    console.error('Error deleting students:', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
