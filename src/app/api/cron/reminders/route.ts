import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import nodemailer from 'nodemailer';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

export async function GET() {
  try {
    const { data: settings, error: settingsError } = await supabase
      .from('slake_center_settings')
      .select('*')
      .single();

    if (settingsError || !settings) {
      throw new Error('Settings not found');
    }

    // Get tomorrow's date (YYYY-MM-DD)
    const now = new Date();
    const tomorrow = new Date();
    tomorrow.setDate(now.getDate() + 1);
    const tomorrowStr = tomorrow.toISOString().split('T')[0];

    console.log('Running cron job...');
    console.log('Looking for sessions on:', tomorrowStr);

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
      `);

    if (error) throw error;

    if (!sessions || sessions.length === 0) {
      console.log('No sessions found at all');
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
      // ✅ ONLY tomorrow's sessions
      if (session.session_date !== tomorrowStr) continue;

      console.log(`Processing session ${session.id} on ${session.session_date}`);

      for (const entry of session.slake_session_students as any[]) {
        const student = entry.slake_students;
        if (!student) continue;

        const targetEmail = student.parent_email || student.email;
        if (!targetEmail) continue;

        const body = settings.reminder_body
          .replace('{{name}}', student.name)
          .replace('{{date}}', session.session_date)
          .replace('{{time}}', session.time);

        console.log(`Sending email to ${targetEmail}`);

        await transporter.sendMail({
          from: `"${settings.center_name}" <${process.env.GOOGLE_EMAIL}>`,
          to: targetEmail,
          subject: settings.reminder_subject,
          text: body,
        });

        sent++;
      }
    }

    console.log(`Total emails sent: ${sent}`);

    return NextResponse.json({ sent });
  } catch (err: any) {
    console.error('ERROR:', err.message);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}