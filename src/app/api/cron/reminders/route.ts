import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import nodemailer from "nodemailer";
import { randomUUID } from "crypto";

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

export async function GET() {
  try {
    const { data: settings, error: settingsError } = await supabase
      .from("slake_center_settings")
      .select("*")
      .single();

    if (settingsError || !settings) throw new Error("Settings not found");

    const now = new Date();
    const tomorrow = new Date();
    tomorrow.setDate(now.getDate() + 1);
    const tomorrowStr = tomorrow.toISOString().split("T")[0];

    const { data: sessions, error } = await supabase
      .from("slake_sessions")
      .select(`
        id,
        session_date,
        time,
        slake_session_students (
          id,
          status,
          reminder_sent,
          confirmation_token,
          topic,
          slake_students (
            name,
            email,
            parent_email
          )
        )
      `)
      .eq("session_date", tomorrowStr);

    if (error) throw error;
    if (!sessions || sessions.length === 0) return NextResponse.json({ sent: 0 });

    const transporter = nodemailer.createTransport({
      service: "gmail",
      auth: {
        user: process.env.GOOGLE_EMAIL,
        pass: process.env.GOOGLE_APP_PASSWORD,
      },
    });

    let sent = 0;

    for (const session of sessions) {
      for (const entry of session.slake_session_students as any[]) {
        // Skip if already sent, confirmed, or no-show
        if (entry.reminder_sent) continue;
        if (entry.status === 'confirmed' || entry.status === 'no-show') continue;

        if (!entry.slake_students) continue;

        const student = entry.slake_students;
        const targetEmail = student.parent_email || student.email;
        if (!targetEmail) continue;

        // Generate token if missing
        let token = entry.confirmation_token;
        if (!token) {
          token = randomUUID();
          await supabase
            .from("slake_session_students")
            .update({ confirmation_token: token })
            .eq("id", entry.id);
        }

        const confirmLink = `${process.env.NEXT_PUBLIC_BASE_URL}/confirm?token=${token}`;

        const body = settings.reminder_body
          .replace("{{name}}", student.name)
          .replace("{{date}}", session.session_date)
          .replace("{{time}}", session.time)
          .replace("{{link}}", confirmLink);

        await transporter.sendMail({
          from: `"${settings.center_name}" <${process.env.GOOGLE_EMAIL}>`,
          to: targetEmail,
          subject: settings.reminder_subject,
          text: body,
        });

        // Mark this student's reminder as sent
        await supabase
          .from("slake_session_students")
          .update({ reminder_sent: true })
          .eq("id", entry.id);

        sent++;
      }
    }

    return NextResponse.json({ sent });
  } catch (err: any) {
    console.error("CRON ERROR:", err.message);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}