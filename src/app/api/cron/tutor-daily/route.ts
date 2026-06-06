import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import nodemailer from "nodemailer";
import { DB, withCenter } from "@/lib/db";

// Cron endpoint — called by cron-job.org on a schedule.
// Sends every tutor their schedule for today.
//
// Required env vars:
//   TUTOR_DAILY_CRON_ENABLED=true    (must be set to allow sending)
//   NEXT_PUBLIC_SUPABASE_URL
//   SUPABASE_SERVICE_ROLE_KEY
//   GOOGLE_EMAIL
//   GOOGLE_APP_PASSWORD
//   EMAIL_SEND_MODE                  (live | redirect | disabled)
//   EMAIL_TEST_RECIPIENT             (required when redirect)

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

const EMAIL_SEND_MODE = (process.env.EMAIL_SEND_MODE ?? "redirect").toLowerCase();
const CRON_ENABLED = process.env.TUTOR_DAILY_CRON_ENABLED === "true";
const TEST_RECIPIENT = process.env.EMAIL_TEST_RECIPIENT?.trim() || process.env.GOOGLE_EMAIL?.trim() || null;

type DeliveryMode = "live" | "redirect" | "disabled";

function getDeliveryGuard(): { mode: DeliveryMode; redirectTo: string | null } {
  if (EMAIL_SEND_MODE === "live") return { mode: "live", redirectTo: null };
  if (EMAIL_SEND_MODE === "disabled") return { mode: "disabled", redirectTo: null };
  return { mode: "redirect", redirectTo: TEST_RECIPIENT };
}

function getTransporter() {
  return nodemailer.createTransport({
    service: "gmail",
    auth: { user: process.env.GOOGLE_EMAIL, pass: process.env.GOOGLE_APP_PASSWORD },
  });
}

function toISODate(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function fmt12(time: string): string {
  const [hStr, mStr] = time.split(":");
  const h = Number(hStr);
  return `${h % 12 === 0 ? 12 : h % 12}:${mStr} ${h >= 12 ? "PM" : "AM"}`;
}

function fmtDate(iso: string): string {
  return new Date(iso + "T00:00:00").toLocaleDateString("en-US", {
    weekday: "long", month: "long", day: "numeric",
  });
}

type SessionEntry = { date: string; time: string; students: { name: string; topic: string; notes: string }[] };

function buildScheduleHtml(
  centerName: string,
  tutorName: string,
  schedule: SessionEntry[],
  periodLabel: string,
  centerPhone?: string | null
): string {
  const BRAND = "#0f172a";
  const rows = schedule
    .sort((a, b) => a.time.localeCompare(b.time))
    .map((s) => {
      const studentList =
        s.students.length === 0
          ? `<span style="color:#9ca3af;font-style:italic;">No students</span>`
              : s.students.map((st) => `${st.name}${st.topic ? ` <span style="color:#6b7280;font-size:11px;">(${st.topic})</span>` : ""}${st.notes ? `<br><span style="color:#6b7280;font-size:11px;font-style:italic;">${st.notes}</span>` : ""}`).join(", ");
      return `<tr>
        <td style="padding:8px 12px;font-size:13px;font-weight:600;color:#374151;white-space:nowrap;border-right:1px solid #f3f4f6;">${fmt12(s.time)}</td>
        <td style="padding:8px 12px;font-size:13px;color:#374151;">${studentList}</td>
      </tr>`;
    }).join("");

  const tableBlock = schedule.length > 0
    ? `<table cellpadding="0" cellspacing="0" style="width:100%;border-collapse:collapse;background:#f9fafb;border-radius:8px;border:1px solid #e5e7eb;overflow:hidden;">${rows}</table>`
    : `<p style="color:#9ca3af;font-size:13px;font-style:italic;">No sessions scheduled for today.</p>`;

  return `<!DOCTYPE html>
<html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#f9fafb;font-family:ui-sans-serif,system-ui,-apple-system,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#f9fafb;padding:32px 16px;">
    <tr><td align="center">
    <table width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;background:white;border-radius:12px;border:1px solid #e5e7eb;overflow:hidden;">
      <tr><td style="background:${BRAND};padding:20px 28px;">
        <p style="margin:0;font-size:18px;font-weight:800;color:white;">${centerName}</p>
        <p style="margin:4px 0 0;font-size:12px;color:rgba(255,255,255,0.7);">Schedule — ${periodLabel}</p>
      </td></tr>
      <tr><td style="padding:28px;">
        <p style="margin:0 0 4px;font-size:16px;font-weight:700;color:#111827;">Hi ${tutorName},</p>
        <p style="margin:0 0 24px;font-size:13px;color:#6b7280;">
          Here's your schedule for <strong>${periodLabel}</strong>.
          ${schedule.length > 0 ? `${schedule.length} session${schedule.length !== 1 ? "s" : ""} today.` : "No sessions scheduled for today."}
        </p>
        ${tableBlock}
      </td></tr>
      <tr><td style="padding:16px 28px;background:#f9fafb;border-top:1px solid #f3f4f6;">
        <p style="margin:0;font-size:11px;color:#9ca3af;">— ${centerName}</p>
        ${centerPhone ? `<p style="margin:4px 0 0;font-size:11px;color:#9ca3af;">Do not reply — call us at <a href="tel:${centerPhone}" style="color:#9ca3af;">${centerPhone}</a>.</p>` : ""}
      </td></tr>
    </table>
    </td></tr>
  </table>
</body></html>`;
}

export async function GET(_req: NextRequest) {
  if (!CRON_ENABLED) {
    return NextResponse.json({ skipped: true, reason: "TUTOR_DAILY_CRON_ENABLED is not set to true." });
  }

  const guard = getDeliveryGuard();
  if (guard.mode === "disabled") {
    return NextResponse.json({ skipped: true, reason: "Email sending is disabled." });
  }
  if (guard.mode === "redirect" && !guard.redirectTo) {
    return NextResponse.json(
      { error: "EMAIL_TEST_RECIPIENT or GOOGLE_EMAIL must be set for redirect mode." },
      { status: 500 }
    );
  }

  const today = toISODate(new Date());
  const periodLabel = fmtDate(today);

  const { data: settingsData } = await withCenter(
    supabase.from(DB.centerSettings).select("center_name, center_email, center_phone").limit(1)
  ).maybeSingle();
  const centerName: string = settingsData?.center_name ?? "Tutoring Center";
  const centerEmail: string | null = settingsData?.center_email ?? null;
  const centerPhone: string | null = settingsData?.center_phone ?? null;

  const { data: tutors, error: tutorsError } = await withCenter(
    supabase.from(DB.tutors).select("id, name, email").not("email", "is", null).neq("email", "")
  );
  if (tutorsError) {
    return NextResponse.json({ error: tutorsError.message }, { status: 500 });
  }

  const tutorIds = (tutors ?? []).map((t: any) => t.id);
  if (tutorIds.length === 0) {
    return NextResponse.json({ sent: 0, failed: 0, errors: [], skipped: true, reason: "No tutors with email addresses." });
  }

  const { data: sessionsData, error: sessionsError } = await (
    withCenter(
      supabase
        .from(DB.sessions)
        .select(`id, session_date, time, tutor_id, ${DB.sessionStudents}(id, name, topic, notes, status)`)
        .in("tutor_id", tutorIds)
        .eq("session_date", today)
    ) as any
  );
  if (sessionsError) {
    return NextResponse.json({ error: sessionsError.message }, { status: 500 });
  }

  const scheduleByTutor: Record<string, SessionEntry[]> = {};
  for (const session of sessionsData ?? []) {
    const tid: string = session.tutor_id;
    if (!scheduleByTutor[tid]) scheduleByTutor[tid] = [];
    const ssRows = Array.isArray(session[DB.sessionStudents]) ? session[DB.sessionStudents] : [];
    scheduleByTutor[tid].push({
      date: session.session_date,
      time: session.time,
      students: ssRows
        .filter((ss: any) => ss.status !== "cancelled")
        .map((ss: any) => ({ name: ss.name ?? "—", topic: ss.topic ?? "", notes: ss.notes ?? "" })),
    });
  }

  const transporter = getTransporter();
  let sent = 0;
  let failed = 0;
  const errors: string[] = [];

  for (const tutor of tutors ?? []) {
    if (!tutor.email) continue;
    const schedule = scheduleByTutor[tutor.id] ?? [];
    const html = buildScheduleHtml(centerName, tutor.name ?? "Tutor", schedule, periodLabel, centerPhone);
    const subject = `Your schedule for today — ${periodLabel}`;
    const to = guard.mode === "live" ? tutor.email : guard.redirectTo!;
    let logStatus: 'sent' | 'failed' = 'sent';
    let logError: string | null = null;
    try {
      await transporter.sendMail({
        from: `"${centerName}" <${process.env.GOOGLE_EMAIL}>`,
        replyTo: centerEmail ?? undefined,
        to,
        subject,
        html,
        text: `Hi ${tutor.name},\n\nHere's your schedule for ${periodLabel}.\n\n— ${centerName}`,
      });
      sent++;
    } catch (e: any) {
      failed++;
      logStatus = 'failed';
      logError = e?.message ?? 'Unknown error';
      if (errors.length < 5) errors.push(`${tutor.name ?? tutor.id}: ${logError}`);
    }
    await supabase.from(DB.tutorScheduleLogs).insert({
      center_id: process.env.NEXT_PUBLIC_CENTER_ID ?? process.env.CENTER_ID ?? '',
      tutor_id: tutor.id,
      tutor_name: tutor.name ?? '',
      emailed_to: to,
      mode: 'daily',
      period_label: periodLabel,
      trigger: 'cron',
      status: logStatus,
      error: logError,
    });
  }

  return NextResponse.json({ sent, failed, errors, mode: guard.mode, periodLabel });
}
