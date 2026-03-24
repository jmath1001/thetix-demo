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
    const tomorrowStr = tomorrow.toLocaleDateString("en-CA", { timeZone: "America/Chicago" });

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

    const transporter = nodemailer.createTransport({
      service: "gmail",
      auth: {
        user: process.env.GOOGLE_EMAIL,
        pass: process.env.GOOGLE_APP_PASSWORD,
      },
    });

    // No sessions at all — notify center and bail
    if (!sessions || sessions.length === 0) {
      if (settings.center_email) {
        await transporter.sendMail({
          from: `"${settings.center_name}" <${process.env.GOOGLE_EMAIL}>`,
          to: settings.center_email,
          subject: `Reminder Summary — No scheduled students for ${tomorrowStr}`,
          text: [
            `Hi,`,
            ``,
            `The automated reminder job ran for ${tomorrowStr} but found no scheduled students to notify.`,
            ``,
            `No reminder emails were sent.`,
            ``,
            `— ${settings.center_name} Automated Reminders`,
          ].join("\n"),
        });
      }
      return NextResponse.json({ sent: 0 });
    }

    let sent = 0;

    type SummaryEntry = {
      studentName: string;
      emailedTo: string;
      sessionDate: string;
      sessionTime: string;
      sessionStudentId: string;
    };
    const summaryEntries: SummaryEntry[] = [];

    for (const session of sessions) {
      for (const entry of session.slake_session_students as any[]) {
        if (entry.reminder_sent) continue;
        if (!entry.slake_students) continue;

        const student = entry.slake_students;
        const targetEmail = student.parent_email || student.email;
        if (!targetEmail) continue;

        let token = entry.confirmation_token;
        if (!token) {
          token = randomUUID();
          await supabase
            .from("slake_session_students")
            .update({ confirmation_token: token })
            .eq("id", entry.id);
        }

        const confirmLink = `${process.env.NEXT_PUBLIC_BASE_URL}/confirm?token=${token}`;

        // Build plain text version (fallback)
        const plainBody = settings.reminder_body
          .replace("{{name}}", student.name)
          .replace("{{date}}", session.session_date)
          .replace("{{time}}", session.time)
          .replace("{{link}}", confirmLink);

        // Build HTML version with a styled button
        const htmlBody = `
<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"></head>
<body style="margin:0;padding:0;background:#f9fafb;font-family:ui-sans-serif,system-ui,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#f9fafb;padding:32px 16px;">
    <tr><td align="center">
      <table width="100%" cellpadding="0" cellspacing="0" style="max-width:520px;background:white;border-radius:12px;border:1px solid #e5e7eb;box-shadow:0 2px 8px rgba(0,0,0,0.06);overflow:hidden;">
        <!-- Header -->
        <tr>
          <td style="background:#dc2626;padding:20px 28px;">
            <p style="margin:0;font-size:18px;font-weight:800;color:white;letter-spacing:-0.3px;">${settings.center_name}</p>
            <p style="margin:4px 0 0;font-size:12px;color:rgba(255,255,255,0.8);font-weight:500;">Session Reminder</p>
          </td>
        </tr>
        <!-- Body -->
        <tr>
          <td style="padding:28px;">
            <p style="margin:0 0 16px;font-size:15px;color:#111827;line-height:1.6;">
              ${settings.reminder_body
                .replace("{{name}}", `<strong>${student.name}</strong>`)
                .replace("{{date}}", `<strong>${session.session_date}</strong>`)
                .replace("{{time}}", `<strong>${session.time}</strong>`)
                .replace("{{link}}", "")
                .replace(/\n/g, "<br>")
                .trim()}
            </p>
            <!-- Confirm button -->
            <table cellpadding="0" cellspacing="0" style="margin:24px 0 0;">
              <tr>
                <td style="border-radius:8px;background:#dc2626;">
                  <a href="${confirmLink}"
                     style="display:inline-block;padding:13px 28px;font-size:14px;font-weight:700;color:white;text-decoration:none;border-radius:8px;letter-spacing:0.2px;">
                    ✓ Confirm Attendance
                  </a>
                </td>
              </tr>
            </table>
            <p style="margin:16px 0 0;font-size:11px;color:#9ca3af;">
              If the button doesn't work, copy this link: <a href="${confirmLink}" style="color:#dc2626;">${confirmLink}</a>
            </p>
          </td>
        </tr>
        <!-- Footer -->
        <tr>
          <td style="padding:16px 28px;background:#f9fafb;border-top:1px solid #f3f4f6;">
            <p style="margin:0;font-size:11px;color:#9ca3af;">— ${settings.center_name} Automated Reminders</p>
          </td>
        </tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`;

        await transporter.sendMail({
          from: `"${settings.center_name}" <${process.env.GOOGLE_EMAIL}>`,
          to: targetEmail,
          subject: settings.reminder_subject,
          text: plainBody,
          html: htmlBody,
        });

        await supabase
          .from("slake_session_students")
          .update({ reminder_sent: true })
          .eq("id", entry.id);

        // Log to slake_reminder_logs
        await supabase.from("slake_reminder_logs").insert({
          session_date: session.session_date,
          session_time: session.time,
          student_name: student.name,
          emailed_to: targetEmail,
          session_student_id: entry.id,
        });

        summaryEntries.push({
          studentName: student.name,
          emailedTo: targetEmail,
          sessionDate: session.session_date,
          sessionTime: session.time,
          sessionStudentId: entry.id,
        });

        sent++;
      }
    }

    // Send summary email to center
    if (settings.center_email) {
      if (sent === 0) {
        await transporter.sendMail({
          from: `"${settings.center_name}" <${process.env.GOOGLE_EMAIL}>`,
          to: settings.center_email,
          subject: `Reminder Summary — No scheduled students for ${tomorrowStr}`,
          text: [
            `Hi,`,
            ``,
            `The automated reminder job ran for ${tomorrowStr} but found no scheduled students to notify.`,
            ``,
            `No reminder emails were sent.`,
            ``,
            `— ${settings.center_name} Automated Reminders`,
          ].join("\n"),
        });
      } else {
        const rows = summaryEntries
          .map((e) => `  • ${e.studentName} (${e.emailedTo}) — ${e.sessionDate} at ${e.sessionTime}`)
          .join("\n");

        await transporter.sendMail({
          from: `"${settings.center_name}" <${process.env.GOOGLE_EMAIL}>`,
          to: settings.center_email,
          subject: `Reminder Summary — ${sent} email${sent !== 1 ? "s" : ""} sent for ${tomorrowStr}`,
          text: [
            `Hi,`,
            ``,
            `Here is a summary of the reminder emails sent on ${now.toLocaleDateString("en-CA", { timeZone: "America/Chicago" })}:`,
            ``,
            rows,
            ``,
            `Total sent: ${sent}`,
            ``,
            `— ${settings.center_name} Automated Reminders`,
          ].join("\n"),
        });
      }
    }

    return NextResponse.json({ sent });
  } catch (err: any) {
    console.error("CRON ERROR:", err.message);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}