import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import nodemailer from 'nodemailer';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

export async function GET() {
  try {
    const { data: settings } = await supabase
      .from('slake_center_settings')
      .select('*')
      .single();

    if (!settings) throw new Error('Settings not found');

    const today = new Date().toISOString().split('T')[0];

    const { data: sessions, error } = await supabase
      .from('slake_sessions')
      .select(`
        id,
        session_date,
        time,
        slake_session_students (
          topic,
          slake_students (
            name,
            email,
            parent_email
          )
        )
      `)
      .gte('session_date', today);

    if (error) throw error;

    console.log('Sessions:', JSON.stringify(sessions, null, 2));

    if (!sessions || sessions.length === 0) {
      return NextResponse.json({ status: 'No sessions found' });
    }

    const transporter = nodemailer.createTransport({
      service: 'gmail',
      auth: {
        user: process.env.GOOGLE_EMAIL,
        pass: process.env.GOOGLE_APP_PASSWORD,
      },
    });

    let sent = 0;

    for (const session of sessions) {
      for (const entry of session.slake_session_students as any[]) {
        const student = entry.slake_students;
        if (!student) continue;

        const targetEmail = student.parent_email || student.email;
        if (!targetEmail) continue;

        const body = settings.reminder_body
          .replace('{{name}}', student.name)
          .replace('{{date}}', session.session_date)
          .replace('{{time}}', session.time);

        await transporter.sendMail({
          from: `"${settings.center_name}" <${process.env.GOOGLE_EMAIL}>`,
          to: targetEmail,
          subject: settings.reminder_subject,
          text: body,
        });

        sent++;
      }
    }

    return NextResponse.json({ sent });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}