import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import nodemailer from "nodemailer";
import { randomUUID } from "crypto";
import { DB, withCenter, withCenterPayload } from "@/lib/db";

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

const SS = DB.sessionStudents;
const SESSIONS = DB.sessions;
const STUDENTS = DB.students;
const SETTINGS = DB.centerSettings;
const REMINDER_LOGS = DB.reminderLogs;
const TERM_ENROLLMENTS = DB.termEnrollments;
const EMAIL_SEND_MODE = (process.env.EMAIL_SEND_MODE ?? "redirect").toLowerCase();
const REMINDER_CRON_ENABLED = process.env.REMINDER_CRON_ENABLED === "true";
const TEST_RECIPIENT = process.env.EMAIL_TEST_RECIPIENT?.trim() || process.env.GOOGLE_EMAIL?.trim() || null;
const BRAND_RED = "#991b1b";

type DeliveryMode = "live" | "redirect" | "disabled";

type ReminderStudent = {
  name?: string;
  email?: string;
  mom_name?: string;
  mom_email?: string;
  dad_name?: string;
  dad_email?: string;
  notify_student?: boolean | null;
  notify_mom?: boolean | null;
  notify_dad?: boolean | null;
};

type ReminderEntry = {
  id: string;
  student_id?: string;
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

type DeliveryGuard = {
  mode: DeliveryMode;
  redirectTo: string | null;
  shouldMarkSent: boolean;
};

type TemplateTokens = {
  name: string;
  date: string;
  time: string;
  link: string;
};

function pickRelation(row: any, key: string) {
  return Array.isArray(row?.[key]) ? row[key][0] : row?.[key];
}

function applyTemplate(template: string, tokens: TemplateTokens) {
  return template.replace(/{{\s*(name|date|time|link)\s*}}/gi, (_, rawKey: string) => {
    const key = String(rawKey).toLowerCase() as keyof TemplateTokens;
    return tokens[key] ?? "";
  });
}

function buildStudentHtml(settings: any, studentName: string, session: any, confirmLink: string) {
  const body = applyTemplate(settings.reminder_body, {
    name: `<strong>${studentName}</strong>`,
    date: `<strong>${session.session_date}</strong>`,
    time: `<strong>${session.time}</strong>`,
    link: `<a href="${confirmLink}" style="color:${BRAND_RED};text-decoration:underline;">${confirmLink}</a>`,
  }).replace(/\n/g, "<br>").trim();
  return `<!DOCTYPE html><html><head><meta charset="utf-8"></head><body style="margin:0;padding:0;background:#f9fafb;font-family:ui-sans-serif,system-ui,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#f9fafb;padding:32px 16px;"><tr><td align="center">
  <table width="100%" cellpadding="0" cellspacing="0" style="max-width:520px;background:white;border-radius:12px;border:1px solid #e5e7eb;overflow:hidden;">
    <tr><td style="background:${BRAND_RED};padding:20px 28px;">
      <p style="margin:0;font-size:18px;font-weight:800;color:white;">${settings.center_name}</p>
      <p style="margin:4px 0 0;font-size:12px;color:rgba(255,255,255,0.8);">Session Reminder</p>
    </td></tr>
    <tr><td style="padding:28px;">
      <p style="margin:0 0 16px;font-size:15px;color:#111827;line-height:1.6;">${body}</p>
      <table cellpadding="0" cellspacing="0" style="margin:24px 0 0;"><tr>
        <td style="border-radius:8px;background:${BRAND_RED};">
          <a href="${confirmLink}" style="display:inline-block;padding:13px 28px;font-size:14px;font-weight:700;color:white;text-decoration:none;border-radius:8px;">✓ Confirm Attendance</a>
        </td>
      </tr></table>
      <p style="margin:16px 0 0;font-size:11px;color:#9ca3af;">If the button doesn't work: <a href="${confirmLink}" style="color:${BRAND_RED};">${confirmLink}</a></p>
    </td></tr>
    <tr><td style="padding:16px 28px;background:#f9fafb;border-top:1px solid #f3f4f6;">
      <p style="margin:0;font-size:11px;color:#9ca3af;">— ${settings.center_name} Automated Reminders</p>
    </td></tr>
  </table></td></tr></table></body></html>`;
}

function buildGuardianHtml(settings: any, guardianName: string, studentName: string, session: any) {
  return `<!DOCTYPE html><html><head><meta charset="utf-8"></head><body style="margin:0;padding:0;background:#f9fafb;font-family:ui-sans-serif,system-ui,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#f9fafb;padding:32px 16px;"><tr><td align="center">
  <table width="100%" cellpadding="0" cellspacing="0" style="max-width:520px;background:white;border-radius:12px;border:1px solid #e5e7eb;overflow:hidden;">
    <tr><td style="background:${BRAND_RED};padding:20px 28px;">
      <p style="margin:0;font-size:18px;font-weight:800;color:white;">${settings.center_name}</p>
      <p style="margin:4px 0 0;font-size:12px;color:rgba(255,255,255,0.8);">Parent Notification</p>
    </td></tr>
    <tr><td style="padding:28px;">
      <p style="margin:0;font-size:15px;color:#111827;line-height:1.6;">
        Hi <strong>${guardianName}</strong>,<br><br>
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

function getDeliveryGuard(): DeliveryGuard {
  if (EMAIL_SEND_MODE === "live") {
    return { mode: "live", redirectTo: null, shouldMarkSent: true };
  }

  if (EMAIL_SEND_MODE === "disabled") {
    return { mode: "disabled", redirectTo: null, shouldMarkSent: false };
  }

  return { mode: "redirect", redirectTo: TEST_RECIPIENT, shouldMarkSent: false };
}

async function sendProtectedMail({
  transporter,
  guard,
  to,
  subject,
  text,
  html,
}: {
  transporter: nodemailer.Transporter;
  guard: DeliveryGuard;
  to: string;
  subject: string;
  text: string;
  html: string;
}) {
  if (guard.mode === "disabled") {
    return { delivered: false, recipient: null };
  }

  if (guard.mode === "redirect" && !guard.redirectTo) {
    throw new Error("EMAIL_TEST_RECIPIENT or GOOGLE_EMAIL must be set before sending in redirect mode");
  }

  const recipient = guard.mode === "live" ? to : guard.redirectTo!;

  await transporter.sendMail({
    from: `"${process.env.EMAIL_FROM_NAME}" <${process.env.GOOGLE_EMAIL}>`,
    to: recipient,
    subject,
    text,
    html,
  });

  return { delivered: true, recipient };
}

async function getSettingsOrThrow() {
  const { data, error } = await withCenter(
    supabase.from(SETTINGS).select("*").limit(1)
  ).maybeSingle();

  if (error) {
    throw new Error(`Unable to read ${SETTINGS}: ${error.message}`);
  }

  if (!data) {
    throw new Error(`No settings row found in ${SETTINGS}. Open Contact Center once to initialize it.`);
  }

  return data;
}

// Core send: sends student + family emails for one session_student row,
// marks reminder_sent, logs to reminder logs table.
async function sendReminderForEntry({
  entry, session, settings, transporter, guard, appBaseUrl,
}: {
  entry: any;
  session: any;
  settings: any;
  transporter: nodemailer.Transporter;
  guard: DeliveryGuard;
  appBaseUrl: string;
}) {
  const student = pickRelation(entry, STUDENTS);
  const hasReachableRecipient =
    (student?.email     && student.notify_student !== false) ||
    (student?.mom_email && student.notify_mom     !== false) ||
    (student?.dad_email && student.notify_dad     !== false);
  if (!student || !hasReachableRecipient) return { sent: 0, skipped: true };

  let token = entry.confirmation_token;
  if (!token) {
    token = randomUUID();
    const { error: tokenError } = await withCenter(
      supabase.from(SS).update({ confirmation_token: token })
    ).eq("id", entry.id);
    if (tokenError) throw tokenError;
  }
  const normalizedBaseUrl = appBaseUrl.endsWith("/") ? appBaseUrl.slice(0, -1) : appBaseUrl;
  const confirmLink = `${normalizedBaseUrl}/confirm?token=${token}`;
  let sent = 0;

  if (student.email && student.notify_student !== false) {
    const tokens: TemplateTokens = {
      name: student.name ?? "",
      date: session.session_date ?? "",
      time: session.time ?? "",
      link: confirmLink,
    };
    const plainBody = applyTemplate(settings.reminder_body ?? "", tokens);
    const result = await sendProtectedMail({
      transporter,
      guard,
      to: student.email,
      subject: applyTemplate(settings.reminder_subject ?? "", tokens),
      text: plainBody,
      html: buildStudentHtml(settings, student.name, session, confirmLink),
    });
    if (result.delivered) sent++;
  }

  if (student.mom_email && student.notify_mom !== false) {
    const momName = student.mom_name || "Mom";
    const result = await sendProtectedMail({
      transporter,
      guard,
      to: student.mom_email,
      subject: `Upcoming session reminder for ${student.name}`,
      text: `Hi ${momName},\n\n${student.name} has a session on ${session.session_date} at ${session.time}.\n\nNo action needed.\n\n— ${settings.center_name}`,
      html: buildGuardianHtml(settings, momName, student.name, session),
    });
    if (result.delivered) sent++;
  }

  if (student.dad_email && student.notify_dad !== false) {
    const dadName = student.dad_name || "Dad";
    const result = await sendProtectedMail({
      transporter,
      guard,
      to: student.dad_email,
      subject: `Upcoming session reminder for ${student.name}`,
      text: `Hi ${dadName},\n\n${student.name} has a session on ${session.session_date} at ${session.time}.\n\nNo action needed.\n\n— ${settings.center_name}`,
      html: buildGuardianHtml(settings, dadName, student.name, session),
    });
    if (result.delivered) sent++;
  }

  if (guard.shouldMarkSent) {
    await withCenter(
      supabase.from(SS).update({ reminder_sent: true })
    ).eq("id", entry.id);
    await supabase.from(REMINDER_LOGS).insert(withCenterPayload({
      session_date:       session.session_date,
      session_time:       session.time,
      student_name:       student.name,
      emailed_to:         [student.email, student.mom_email, student.dad_email].filter(Boolean).join(", "),
      session_student_id: entry.id,
    }));
  }

  return { sent };
}

// ── GET — cron (today + tomorrow, skips already-sent) ─────────────────────────

export async function GET() {
  try {
    const guard = getDeliveryGuard();
    const appBaseUrl = (process.env.NEXT_PUBLIC_BASE_URL ?? "").trim();
    if (!REMINDER_CRON_ENABLED) {
      return NextResponse.json({
        sent: 0,
        skipped: true,
        mode: guard.mode,
        redirectedTo: guard.redirectTo,
        reason: "Automatic reminder sending is disabled. Set REMINDER_CRON_ENABLED=true to enable it.",
      });
    }

    const settings = await getSettingsOrThrow();

    if (!appBaseUrl) {
      throw new Error("NEXT_PUBLIC_BASE_URL must be set for reminder links");
    }

    const now = new Date();
    const todayStr    = now.toLocaleDateString("en-CA", { timeZone: "America/Chicago" });
    const tomorrow    = new Date(); tomorrow.setDate(now.getDate() + 1);
    const tomorrowStr = tomorrow.toLocaleDateString("en-CA", { timeZone: "America/Chicago" });

    const { data: sessions, error } = await (withCenter(
      supabase
        .from(SESSIONS)
        .select(`id, session_date, time,
          ${SS} ( id, student_id, status, reminder_sent, confirmation_token, topic,
            ${STUDENTS} ( name, email, mom_name, mom_email, dad_name, dad_email, notify_student, notify_mom, notify_dad ) )`)
        .in("session_date", [todayStr, tomorrowStr])
    ) as any);
    if (error) throw error;

    // Build a set of enrolled student IDs for the active term (if one exists).
    // If no active term is found, enrolled set is null and all students are eligible.
    let enrolledStudentIds: Set<string> | null = null;
    try {
      const { data: termRows } = await withCenter(
        supabase.from(DB.terms).select('id, status, start_date, end_date').order('start_date', { ascending: false })
      );
      const activeTerm = (termRows ?? []).find((t: any) =>
        (t.status ?? '').trim().toLowerCase() === 'active'
      ) ?? (termRows ?? []).find((t: any) => {
        const s = t.start_date ?? '';
        const e = t.end_date ?? '';
        return s && e && s <= todayStr && todayStr <= e;
      });
      if (activeTerm?.id) {
        const { data: enrollRows } = await withCenter(
          supabase.from(TERM_ENROLLMENTS).select('student_id').eq('term_id', activeTerm.id)
        );
        enrolledStudentIds = new Set((enrollRows ?? []).map((r: any) => r.student_id));
      }
    } catch {
      // If we can't load term data, fall back to sending all reminders.
      enrolledStudentIds = null;
    }

    if (guard.mode === "disabled") {
      return NextResponse.json({
        sent: 0,
        skipped: true,
        mode: guard.mode,
        redirectedTo: guard.redirectTo,
        reason: "Email sending is disabled. Set EMAIL_SEND_MODE=redirect or live to send reminders.",
      });
    }

    const transporter = getTransporter();
    let sent = 0;
    const summaryEntries: string[] = [];

    for (const session of sessions ?? []) {
      for (const entry of (session[SS] as ReminderEntry[] | undefined) ?? []) {
        if (entry.reminder_sent) continue;
        // Skip if an active term exists and this student is not enrolled in it.
        if (enrolledStudentIds !== null && entry.student_id && !enrolledStudentIds.has(entry.student_id)) {
          continue;
        }
        const result = await sendReminderForEntry({ entry, session, settings, transporter, guard, appBaseUrl });
        if (!result.skipped) {
          sent += result.sent ?? 0;
          summaryEntries.push(`  • ${pickRelation(entry, STUDENTS)?.name} — ${session.session_date} at ${session.time}`);
        }
      }
    }

    if (guard.mode === "live" && settings.center_email) {
      await transporter.sendMail({
        from:    `"${settings.center_name}" <${process.env.GOOGLE_EMAIL}>`,
        to:      settings.center_email,
        subject: sent === 0 ? `Reminder Summary — Nothing to send (${todayStr})` : `Reminder Summary — ${sent} sent (${todayStr})`,
        text:    sent === 0 ? "No new reminders sent." : `Sent:\n\n${summaryEntries.join("\n")}\n\nTotal: ${sent}`,
      });
    }

    return NextResponse.json({ sent, mode: guard.mode, redirectedTo: guard.redirectTo });
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

    const guard = getDeliveryGuard();
    const requestOrigin = req.headers.get("origin")?.trim() || "";
    const bodyBaseUrl = typeof body.baseUrl === "string" ? body.baseUrl.trim() : "";
    const appBaseUrl = bodyBaseUrl || requestOrigin || (process.env.NEXT_PUBLIC_BASE_URL ?? "").trim();
    if (guard.mode === "disabled") {
      return NextResponse.json({
        sent: 0,
        failed: 0,
        errors: [],
        skipped: true,
        mode: guard.mode,
        redirectedTo: guard.redirectTo,
        reason: "Email sending is disabled. Set EMAIL_SEND_MODE=redirect or live to send reminders.",
      });
    }

    const settings = await getSettingsOrThrow();

    if (!appBaseUrl) {
      return NextResponse.json({ error: "Unable to determine app base URL for confirmation links" }, { status: 500 });
    }

    const { data: entries, error: fetchErr } = await (withCenter(
      supabase
        .from(SS)
        .select(`id, student_id, status, reminder_sent, confirmation_token, topic,
          ${STUDENTS} ( name, email, mom_name, mom_email, dad_name, dad_email, notify_student, notify_mom, notify_dad ),
          ${SESSIONS} ( session_date, time )`)
        .in("id", body.sessionStudentIds)
    ) as any);
    if (fetchErr) throw fetchErr;

    let filteredEntries = entries ?? [];
    if (typeof body.termId === 'string' && body.termId.trim()) {
      const { data: enrollmentRows, error: enrollmentErr } = await withCenter(
        supabase
          .from(TERM_ENROLLMENTS)
          .select('student_id')
          .eq('term_id', body.termId.trim())
      );
      if (enrollmentErr) throw enrollmentErr;

      const enrolledStudentIds = new Set((enrollmentRows ?? []).map((row: any) => row.student_id));
      filteredEntries = filteredEntries.filter((entry: any) => enrolledStudentIds.has(entry.student_id));
    }

    const transporter = getTransporter();
    let sent = 0;
    const errors: string[] = [];

    for (const entry of filteredEntries) {
      const session = pickRelation(entry, SESSIONS);
      const student = pickRelation(entry, STUDENTS);
      if (!session) { errors.push(`${student?.name ?? entry.id}: session not found`); continue; }
      try {
        const result = await sendReminderForEntry({ entry, session, settings, transporter, guard, appBaseUrl });
        sent += result.sent ?? 0;
      } catch (e: any) {
        errors.push(`${student?.name ?? entry.id}: ${e.message}`);
      }
    }

    return NextResponse.json({ sent, failed: errors.length, errors, mode: guard.mode, redirectedTo: guard.redirectTo });
  } catch (err: any) {
    console.error("MANUAL SEND ERROR:", err.message);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}