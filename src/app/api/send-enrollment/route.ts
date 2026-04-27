import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { DB, withCenter, withCenterPayload } from '@/lib/db'
import nodemailer from 'nodemailer'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

export async function POST(req: NextRequest) {
  try {
    const { studentId, termId, recipientEmail, studentName, termName } = await req.json()
    if (!studentId || !termId || !recipientEmail) {
      return NextResponse.json({ error: 'studentId, termId, and recipientEmail are required' }, { status: 400 })
    }

    const token = crypto.randomUUID()
    const formUrl = `${process.env.NEXT_PUBLIC_BASE_URL}/enroll?token=${token}`

    const { data: existing } = await withCenter(
      supabase.from(DB.termEnrollments).select('id').eq('student_id', studentId).eq('term_id', termId).maybeSingle()
    )

    if (existing) {
      await withCenter(supabase.from(DB.termEnrollments).update({ form_token: token }).eq('id', existing.id))
    } else {
      await supabase.from(DB.termEnrollments).insert(withCenterPayload({
        student_id: studentId,
        term_id: termId,
        subjects: [],
        availability_blocks: [],
        hours_purchased: 0,
        form_token: token,
      }))
    }

    const transporter = nodemailer.createTransport({
      service: 'gmail',
      auth: {
        user: process.env.GOOGLE_EMAIL,
        pass: process.env.GOOGLE_APP_PASSWORD,
      },
    })

    await transporter.sendMail({
      from: `"C2 Education" <${process.env.GOOGLE_EMAIL}>`,
      to: recipientEmail,
      subject: `${termName ?? 'Upcoming Term'} Enrollment Form – ${studentName ?? 'Your Student'}`,
      html: `
        <div style="font-family:sans-serif;max-width:520px;margin:0 auto;">
          <h2 style="color:#0f172a;">Enrollment Form</h2>
          <p>Please fill out the availability and subject form for <strong>${studentName}</strong> for the <strong>${termName}</strong>.</p>
          <a href="${formUrl}" style="display:inline-block;margin-top:16px;padding:12px 24px;background:#dc2626;color:white;border-radius:8px;text-decoration:none;font-weight:bold;">
            Fill Out Form
          </a>
          <p style="margin-top:24px;color:#64748b;font-size:13px;">This link is unique to your student. If you have questions, contact the center directly.</p>
        </div>
      `,
    })

    return NextResponse.json({ ok: true })
  } catch (err: any) {
    return NextResponse.json({ error: err?.message ?? 'Failed to send enrollment form' }, { status: 500 })
  }
}