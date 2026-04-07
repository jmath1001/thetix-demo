import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import nodemailer from "nodemailer";
import { randomUUID } from "crypto";
import { DB } from "@/lib/db";

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

const SS = DB.sessionStudents;
const SESSIONS = DB.sessions;
const STUDENTS = DB.students;
const SETTINGS = DB.centerSettings;
const REMINDER_LOGS = DB.reminderLogs;

type ReminderStudent = {
  name?: string;
  email?: string;
  parent_name?: string;
  parent_email?: string;
};

type ReminderEntry = {
  id: string;
  reminder_sent?: boolean;
  confirmation_token?: string | null;
  [STUDENTS]?: ReminderStudent | ReminderStudent[];
  [SESSIONS]?: ReminderSession | ReminderSession[];
};

type ReminderSession = {
  id?: string;
  session_date: string;
  time: string;
  [SS]?: ReminderEntry[];
};

function pickRelation(row: any, key: string) {
  return Array.isArray(row?.[key]) ? row[key][0] : row?.[key];
}

function buildStudentHtml(settings: any, studentName: string, session: any, confirmLink: string) {
  const body = settings.reminder_body
    .replace("{{name}}", `<strong>${studentName}</strong>`)
    .replace("{{date}}", `<strong>${session.session_date}</strong>`)
    .replace("{{time}}", `<strong>${session.time}</strong>`)
    .replace("{{link}}", "")
    .replace(/\n/g, "<br>")
    .trim();
  return `<!DOCTYPE html><html><head><meta charset="utf-8"></head><body style="margin:0;padding:0;background:#f9fafb;font-family:ui-sans-serif,system-ui,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#f9fafb;padding:32px 16px;"><tr><td align="center">
  <table width="100%" cellpadding="0" cellspacing="0" style="max-width:520px;background:white;border-radius:12px;border:1px solid #e5e7eb;overflow:hidden;">
    <tr><td style="background:#dc2626;padding:20px 28px;">
      <p style="margin:0;font-size:18px;font-weight:800;color:white;">${settings.center_name}</p>
      <p style="margin:4px 0 0;font-size:12px;color:rgba(255,255,255,0.8);">Session Reminder</p>
    </td></tr>
    <tr><td style="padding:28px;">
      <p style="margin:0 0 16px;font-size:15px;color:#111827;line-height:1.6;">${body}</p>
      <table cellpadding="0" cellspacing="0" style="margin:24px 0 0;"><tr>
        <td style="border-radius:8px;background:#dc2626;">
          <a href="${confirmLink}" style="display:inline-block;padding:13px 28px;font-size:14px;font-weight:700;color:white;text-decoration:none;border-radius:8px;">✓ Confirm Attendance</a>
        </td>
      </tr></table>
      <p style="margin:16px 0 0;font-size:11px;color:#9ca3af;">If the button doesn't work: <a href="${confirmLink}" style="color:#dc2626;">${confirmLink}</a></p>
    </td></tr>
    <tr><td style="padding:16px 28px;background:#f9fafb;border-top:1px solid #f3f4f6;">
      <p style="margin:0;font-size:11px;color:#9ca3af;">— ${settings.center_name} Automated Reminders</p>
    </td></tr>
  </table></td></tr></table></body></html>`;
}

function buildParentHtml(settings: any, parentName: string, studentName: string, session: any) {
  return `<!DOCTYPE html><html><head><meta charset="utf-8"></head><body style="margin:0;padding:0;background:#f9fafb;font-family:ui-sans-serif,system-ui,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#f9fafb;padding:32px 16px;"><tr><td align="center">
  <table width="100%" cellpadding="0" cellspacing="0" style="max-width:520px;background:white;border-radius:12px;border:1px solid #e5e7eb;overflow:hidden;">
    <tr><td style="background:#dc2626;padding:20px 28px;">
      <p style="margin:0;font-size:18px;font-weight:800;color:white;">${settings.center_name}</p>
      <p style="margin:4px 0 0;font-size:12px;color:rgba(255,255,255,0.8);">Parent Notification</p>
    </td></tr>
    <tr><td style="padding:28px;">
      <p style="margin:0;font-size:15px;color:#111827;line-height:1.6;">
        Hi <strong>${parentName}</strong>,<br><br>
        This is a heads-up that <strong>${studentName}</strong> has a tutoring session on
        <strong>${session.session_date}</strong> at <strong>${session.time}</strong>.<br><br>
        No action needed — this is for your records only.
      </p>
    </td></tr>
    <tr><td style="padding:16px 28px;background:#f9fafb;border-top:1px solid #f3f4f6;">
      <p style="margin:0;font-size:11px;color:#9ca3af;">— ${settings.center_name} Automated Reminders</p>
    </td></tr>
  </table></td></tr></table></body></html>`;
}

function getTransporter() {
  return nodemailer.createTransport({
    service: "gmail",
    auth: { user: process.env.GOOGLE_EMAIL, pass: process.env.GOOGLE_APP_PASSWORD },
  });
}

// Core send: sends student + parent emails for one session_student row,
// marks reminder_sent, logs to reminder logs table.
async function sendReminderForEntry({
  entry, session, settings, transporter,
}: { entry: any; session: any; settings: any; transporter: any }) {
  const student = pickRelation(entry, STUDENTS);
  if (!student || (!student.email && !student.parent_email)) return { sent: 0, skipped: true };

  let token = entry.confirmation_token;
  if (!token) {
    token = randomUUID();
    await supabase.from(SS).update({ confirmation_token: token }).eq("id", entry.id);
  }
  const confirmLink = `${process.env.NEXT_PUBLIC_BASE_URL}/confirm?token=${token}`;
  let sent = 0;

  if (student.email) {
    const plainBody = settings.reminder_body
      .replace("{{name}}", student.name)
      .replace("{{date}}", session.session_date)
      .replace("{{time}}", session.time)
      .replace("{{link}}", confirmLink);
    await transporter.sendMail({
      from: `"${settings.center_name}" <${process.env.GOOGLE_EMAIL}>`,
      to: student.email,
      subject: settings.reminder_subject,
      text: plainBody,
      html: buildStudentHtml(settings, student.name, session, confirmLink),
    });
    sent++;
  }

  if (student.parent_email) {
    const parentName = student.parent_name || "Parent/Guardian";
    await transporter.sendMail({
      from: `"${settings.center_name}" <${process.env.GOOGLE_EMAIL}>`,
      to: student.parent_email,
      subject: `Upcoming session reminder for ${student.name}`,
      text: `Hi ${parentName},\n\n${student.name} has a session on ${session.session_date} at ${session.time}.\n\nNo action needed.\n\n— ${settings.center_name}`,
      html: buildParentHtml(settings, parentName, student.name, session),
    });
    sent++;
  }

  await supabase.from(SS).update({ reminder_sent: true }).eq("id", entry.id);
  await supabase.from(REMINDER_LOGS).insert({
    session_date:       session.session_date,
    session_time:       session.time,
    student_name:       student.name,
    emailed_to:         [student.email, student.parent_email].filter(Boolean).join(", "),
    session_student_id: entry.id,
  });

  return { sent };
}

// ── GET — cron (today + tomorrow, skips already-sent) ─────────────────────────

export async function GET() {
  try {
    const { data: settings, error: settingsError } = await supabase.from(SETTINGS).select("*").single();
    if (settingsError || !settings) throw new Error("Settings not found");

    const now = new Date();
    const todayStr    = now.toLocaleDateString("en-CA", { timeZone: "America/Chicago" });
    const tomorrow    = new Date(); tomorrow.setDate(now.getDate() + 1);
    const tomorrowStr = tomorrow.toLocaleDateString("en-CA", { timeZone: "America/Chicago" });

    const { data: sessions, error } = await (supabase
      .from(SESSIONS)
      .select(`id, session_date, time,
        ${SS} ( id, status, reminder_sent, confirmation_token, topic,
          ${STUDENTS} ( name, email, parent_name, parent_email ) )`)
      .in("session_date", [todayStr, tomorrowStr]) as PromiseLike<{ data: ReminderSession[] | null; error: any }>);
    if (error) throw error;

    const transporter = getTransporter();
    let sent = 0;
    const summaryEntries: string[] = [];

    for (const session of sessions ?? []) {
      for (const entry of (session[SS] as ReminderEntry[] | undefined) ?? []) {
        if (entry.reminder_sent) continue;
        const result = await sendReminderForEntry({ entry, session, settings, transporter });
        if (!result.skipped) {
          sent += result.sent ?? 0;
          summaryEntries.push(`  • ${pickRelation(entry, STUDENTS)?.name} — ${session.session_date} at ${session.time}`);
        }
      }
    }

    if (settings.center_email) {
      await transporter.sendMail({
        from:    `"${settings.center_name}" <${process.env.GOOGLE_EMAIL}>`,
        to:      settings.center_email,
        subject: sent === 0 ? `Reminder Summary — Nothing to send (${todayStr})` : `Reminder Summary — ${sent} sent (${todayStr})`,
        text:    sent === 0 ? "No new reminders sent." : `Sent:\n\n${summaryEntries.join("\n")}\n\nTotal: ${sent}`,
      });
    }

    return NextResponse.json({ sent });
  } catch (err: any) {
    console.error("CRON ERROR:", err.message);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}

// ── POST — manual dispatch from ContactCenter UI ──────────────────────────────
// Body: { manual: true, sessionStudentIds: string[] }
// Sends regardless of reminder_sent so director can re-send if needed.

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    if (!body.manual || !Array.isArray(body.sessionStudentIds) || body.sessionStudentIds.length === 0) {
      return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
    }

    const { data: settings, error: settingsError } = await supabase.from(SETTINGS).select("*").single();
    if (settingsError || !settings) throw new Error("Settings not found");

    const { data: entries, error: fetchErr } = await (supabase
      .from(SS)
      .select(`id, status, reminder_sent, confirmation_token, topic,
        ${STUDENTS} ( name, email, parent_name, parent_email ),
        ${SESSIONS} ( session_date, time )`)
      .in("id", body.sessionStudentIds) as PromiseLike<{ data: ReminderEntry[] | null; error: any }>);
    if (fetchErr) throw fetchErr;

    const transporter = getTransporter();
    let sent = 0;
    const errors: string[] = [];

    for (const entry of entries ?? []) {
      const session = pickRelation(entry, SESSIONS);
      const student = pickRelation(entry, STUDENTS);
      if (!session) { errors.push(`${student?.name ?? entry.id}: session not found`); continue; }
      try {
        const result = await sendReminderForEntry({ entry, session, settings, transporter });
        sent += result.sent ?? 0;
      } catch (e: any) {
        errors.push(`${student?.name ?? entry.id}: ${e.message}`);
      }
    }

    return NextResponse.json({ sent, failed: errors.length, errors });
  } catch (err: any) {
    console.error("MANUAL SEND ERROR:", err.message);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}