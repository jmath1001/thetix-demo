import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { DB, withCenter } from '@/lib/db'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

const MAX_CAPACITY = 3

// ── Types ─────────────────────────────────────────────────────────────────────

interface SlotAssignment {
  studentId: string
  studentName: string
  subject: string
  choiceUsed: 1 | 2 | 3
  blocks: string[]       // ["2-15:00"] or ["2-15:00", "2-16:00"]
  tutorId: string
  tutorName: string
}

interface UnmatchedStudent {
  studentId: string
  studentName: string
  subject: string
  reason: string
}

// ── Helpers ───────────────────────────────────────────────────────────────────

/** Parse "dayNum-HH:MM" → { dow: number, time: string } */
function parseBlock(block: string): { dow: number; time: string } | null {
  const m = block.match(/^(\d)-(\d{2}:\d{2})$/)
  if (!m) return null
  return { dow: parseInt(m[1], 10), time: m[2] }
}

/** Two blocks are consecutive when same day and second starts exactly 1h after first */
function areConsecutive(a: string, b: string): boolean {
  const pa = parseBlock(a)
  const pb = parseBlock(b)
  if (!pa || !pb || pa.dow !== pb.dow) return false
  const [ah, am] = pa.time.split(':').map(Number)
  const [bh, bm] = pb.time.split(':').map(Number)
  return bh * 60 + bm - (ah * 60 + am) === 60
}

function subjectMatches(subject: string, tutorSubjects: string[]): boolean {
  if (!subject) return false
  const s = subject.toLowerCase().trim()
  return tutorSubjects.some(ts => {
    const t = ts.toLowerCase().trim()
    return t === s || t.includes(s) || s.includes(t)
  })
}

// ── Main engine ───────────────────────────────────────────────────────────────

export async function POST(req: NextRequest) {
  try {
    const { termId } = await req.json()
    if (!termId) {
      return NextResponse.json({ error: 'termId is required' }, { status: 400 })
    }

    // 1. Load enrollments with slot_preferences
    const { data: enrollments, error: enrollErr } = await withCenter(
      supabase
        .from(DB.termEnrollments)
        .select('student_id, subjects, slot_preferences, subject_tutor_preference')
        .eq('term_id', termId)
    )
    if (enrollErr) return NextResponse.json({ error: enrollErr.message }, { status: 500 })

    // 2. Load student names
    const studentIds = (enrollments ?? []).map((e: any) => e.student_id)
    const { data: studentRows, error: stuErr } = await withCenter(
      supabase.from(DB.students).select('id, name').in('id', studentIds)
    )
    if (stuErr) return NextResponse.json({ error: stuErr.message }, { status: 500 })
    const studentName: Record<string, string> = {}
    for (const s of studentRows ?? []) studentName[s.id] = s.name

    // 3. Load tutors + their term availability (fall back to global availability_blocks)
    const { data: tutorRows, error: tutErr } = await withCenter(
      supabase.from(DB.tutors).select('id, name, subjects, availability_blocks')
    )
    if (tutErr) return NextResponse.json({ error: tutErr.message }, { status: 500 })

    const { data: termAvailRows, error: taErr } = await withCenter(
      supabase
        .from(DB.tutorTermAvailability)
        .select('tutor_id, availability_blocks')
        .eq('term_id', termId)
    )
    if (taErr) return NextResponse.json({ error: taErr.message }, { status: 500 })

    // Build effective availability per tutor (term override wins)
    const termAvailMap: Record<string, string[]> = {}
    for (const row of termAvailRows ?? []) {
      termAvailMap[row.tutor_id] = row.availability_blocks ?? []
    }
    const tutors: { id: string; name: string; subjects: string[]; blocks: string[] }[] = (tutorRows ?? []).map((t: any) => ({
      id: t.id,
      name: t.name,
      subjects: Array.isArray(t.subjects) ? t.subjects : [],
      blocks: termAvailMap[t.id] ?? (Array.isArray(t.availability_blocks) ? t.availability_blocks : []),
    }))

    // 4. Capacity tracker: key = "tutorId|block", value = count assigned this run
    const capacityCount: Record<string, number> = {}
    const key = (tutorId: string, block: string) => `${tutorId}|${block}`

    function hasCapacity(tutorId: string, blocks: string[]): boolean {
      return blocks.every(b => (capacityCount[key(tutorId, b)] ?? 0) < MAX_CAPACITY)
    }
    function consume(tutorId: string, blocks: string[]) {
      for (const b of blocks) {
        capacityCount[key(tutorId, b)] = (capacityCount[key(tutorId, b)] ?? 0) + 1
      }
    }

    // 5. Run ranked-choice assignment
    const assignments: SlotAssignment[] = []
    const unmatched: UnmatchedStudent[] = []

    for (const enrollment of enrollments ?? []) {
      const sId = enrollment.student_id
      const sName = studentName[sId] ?? sId
      const preferences: string[][] = Array.isArray(enrollment.slot_preferences)
        ? enrollment.slot_preferences
        : []
      const subjects: string[] = Array.isArray(enrollment.subjects) && enrollment.subjects.length > 0
        ? enrollment.subjects
        : ['']
      const tutorPref: Record<string, string> = enrollment.subject_tutor_preference ?? {}

      for (const subject of subjects) {
        if (preferences.length === 0) {
          unmatched.push({ studentId: sId, studentName: sName, subject, reason: 'No slot preferences recorded' })
          continue
        }

        let placed = false

        for (let ci = 0; ci < preferences.length; ci++) {
          const choice = preferences[ci]
          if (!Array.isArray(choice) || choice.length === 0) continue

          // Validate: if 2 blocks, they must be consecutive
          if (choice.length === 2 && !areConsecutive(choice[0], choice[1])) continue

          const preferredTutorId = tutorPref[subject] ?? null

          // Find eligible tutors: available at all blocks in this choice + teaches subject
          const eligible = tutors.filter(t =>
            (subject === '' || subjectMatches(subject, t.subjects)) &&
            choice.every(b => t.blocks.includes(b)) &&
            hasCapacity(t.id, choice)
          )

          if (eligible.length === 0) continue

          // Preferred tutor gets priority
          const preferred = preferredTutorId ? eligible.find(t => t.id === preferredTutorId) : null
          const tutor = preferred ?? eligible[0]

          consume(tutor.id, choice)
          assignments.push({
            studentId: sId,
            studentName: sName,
            subject,
            choiceUsed: (ci + 1) as 1 | 2 | 3,
            blocks: choice,
            tutorId: tutor.id,
            tutorName: tutor.name,
          })
          placed = true
          break
        }

        if (!placed) {
          unmatched.push({
            studentId: sId,
            studentName: sName,
            subject,
            reason: 'No available tutor slot matched any of the 3 choices',
          })
        }
      }
    }

    return NextResponse.json({ assignments, unmatched })
  } catch (err) {
    console.error('slot-scheduler error:', err)
    return NextResponse.json({ error: 'Unexpected server error' }, { status: 500 })
  }
}
