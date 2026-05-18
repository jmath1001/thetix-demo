import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import nodemailer from "nodemailer";
import { DB, withCenter } from "@/lib/db";

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

const EMAIL_SEND_MODE = (process.env.EMAIL_SEND_MODE ?? "redirect").toLowerCase();
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
    auth: {
      user: process.env.GOOGLE_EMAIL,
      pass: process.env.GOOGLE_APP_PASSWORD,
    },
  });
}

const DOW_NAMES = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

function fmt12(time: string): string {
  const [hStr, mStr] = time.split(":");
  const h = Number(hStr);
  const suffix = h >= 12 ? "PM" : "AM";
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return `${h12}:${mStr} ${suffix}`;
}

type SeriesRow = {
  day_of_week: number;
  time: string;
  topic: string;
  start_date: string;
  end_date: string;
  tutor_name: string;
};

function buildStudentScheduleHtml(
  centerName: string,
  studentName: string,
  termName: string,
  series: SeriesRow[]
): string {
  const BRAND = "#0f172a";

  const rows = series
    .sort((a, b) => a.day_of_week - b.day_of_week || a.time.localeCompare(b.time))
    .map((s) => {
      const dayLabel = DOW_NAMES[s.day_of_week] ?? `Day ${s.day_of_week}`;
      const startFmt = new Date(s.start_date + "T00:00:00").toLocaleDateString("en-US", {
        month: "short",
        day: "numeric",
      });
      const endFmt = new Date(s.end_date + "T00:00:00").toLocaleDateString("en-US", {
        month: "short",
        day: "numeric",
        year: "numeric",
      });
      return `<tr>
        <td style="padding:10px 14px;font-size:13px;font-weight:700;color:#111827;white-space:nowrap;border-right:1px solid #f3f4f6;">${dayLabel}</td>
        <td style="padding:10px 14px;font-size:13px;color:#374151;white-space:nowrap;border-right:1px solid #f3f4f6;">${fmt12(s.time)}</td>
        <td style="padding:10px 14px;font-size:13px;color:#374151;border-right:1px solid #f3f4f6;">${s.topic || "—"}</td>
        <td style="padding:10px 14px;font-size:13px;color:#6b7280;white-space:nowrap;border-right:1px solid #f3f4f6;">${s.tutor_name}</td>
        <td style="padding:10px 14px;font-size:11px;color:#9ca3af;white-space:nowrap;">${startFmt} – ${endFmt}</td>
      </tr>`;
    })
    .join("");

  const tableBody =
    rows ||
    `<tr><td colspan="5" style="padding:14px;font-size:12px;color:#9ca3af;font-style:italic;">No recurring sessions scheduled for this term.</td></tr>`;

  return `<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#f9fafb;font-family:ui-sans-serif,system-ui,-apple-system,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#f9fafb;padding:32px 16px;">
    <tr><td align="center">
    <table width="100%" cellpadding="0" cellspacing="0" style="max-width:600px;background:white;border-radius:12px;border:1px solid #e5e7eb;overflow:hidden;">
      <tr><td style="background:${BRAND};padding:20px 28px;">
        <p style="margin:0;font-size:18px;font-weight:800;color:white;">${centerName}</p>
        <p style="margin:4px 0 0;font-size:12px;color:rgba(255,255,255,0.7);">Your Recurring Schedule — ${termName}</p>
      </td></tr>
      <tr><td style="padding:28px;">
        <p style="margin:0 0 4px;font-size:16px;font-weight:700;color:#111827;">Hi ${studentName},</p>
        <p style="margin:0 0 24px;font-size:13px;color:#6b7280;">
          Here is your confirmed recurring tutoring schedule for <strong>${termName}</strong>.
          These sessions repeat every week on the days listed below.
        </p>
        <div style="overflow-x:auto;">
          <table cellpadding="0" cellspacing="0" style="width:100%;border-collapse:collapse;background:#f9fafb;border-radius:8px;border:1px solid #e5e7eb;overflow:hidden;">
            <thead>
              <tr style="background:#f3f4f6;">
                <th style="padding:8px 14px;font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:0.06em;color:#6b7280;text-align:left;border-right:1px solid #e5e7eb;">Day</th>
                <th style="padding:8px 14px;font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:0.06em;color:#6b7280;text-align:left;border-right:1px solid #e5e7eb;">Time</th>
                <th style="padding:8px 14px;font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:0.06em;color:#6b7280;text-align:left;border-right:1px solid #e5e7eb;">Subject</th>
                <th style="padding:8px 14px;font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:0.06em;color:#6b7280;text-align:left;border-right:1px solid #e5e7eb;">Tutor</th>
                <th style="padding:8px 14px;font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:0.06em;color:#6b7280;text-align:left;">Dates</th>
              </tr>
            </thead>
            <tbody>
              ${tableBody}
            </tbody>
          </table>
        </div>
      </td></tr>
      <tr><td style="padding:16px 28px;background:#f9fafb;border-top:1px solid #f3f4f6;">
        <p style="margin:0;font-size:11px;color:#9ca3af;">— ${centerName}</p>
      </td></tr>
    </table>
    </td></tr>
  </table>
</body>
</html>`;
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { studentIds, termId } = body as { studentIds: unknown; termId: unknown };

    if (!Array.isArray(studentIds) || studentIds.length === 0) {
      return NextResponse.json({ error: "No student IDs provided." }, { status: 400 });
    }
    if (typeof termId !== "string" || !termId) {
      return NextResponse.json({ error: "termId is required." }, { status: 400 });
    }

    const safeIds = (studentIds as unknown[]).filter(
      (id): id is string => typeof id === "string" && id.length > 0
    );

    const guard = getDeliveryGuard();
    if (guard.mode === "disabled") {
      return NextResponse.json({
        sent: 0, failed: 0, errors: [],
        skipped: true, reason: "Email sending is disabled (EMAIL_SEND_MODE=disabled).",
        mode: "disabled",
      });
    }
    if (guard.mode === "redirect" && !guard.redirectTo) {
      return NextResponse.json(
        { error: "EMAIL_TEST_RECIPIENT or GOOGLE_EMAIL must be set for redirect mode." },
        { status: 500 }
      );
    }

    // Load center name
    const { data: settingsData } = await withCenter(
      supabase.from(DB.centerSettings).select("center_name").limit(1)
    ).maybeSingle();
    const centerName: string = settingsData?.center_name ?? "Tutoring Center";

    // Load term
    const { data: termData, error: termError } = await supabase
      .from(DB.terms)
      .select("id, name, start_date, end_date")
      .eq("id", termId)
      .maybeSingle();
    if (termError || !termData) {
      return NextResponse.json({ error: termError?.message ?? "Term not found." }, { status: 404 });
    }
    const termName: string = termData.name;
    const termStart: string = termData.start_date;
    const termEnd: string = termData.end_date;

    // Load students
    const { data: students, error: studentsError } = await withCenter(
      supabase
        .from(DB.students)
        .select("id, name, email, mom_email, dad_email")
        .in("id", safeIds)
    );
    if (studentsError) {
      return NextResponse.json({ error: studentsError.message }, { status: 500 });
    }

    // Load all recurring series for the given students that overlap with the term
    const { data: allSeries, error: seriesError } = await withCenter(
      supabase
        .from(DB.recurringSeries)
        .select("student_id, day_of_week, time, topic, start_date, end_date, tutor_id")
        .in("student_id", safeIds)
        .eq("status", "active")
        .lte("start_date", termEnd)
        .gte("end_date", termStart)
    );
    if (seriesError) {
      return NextResponse.json({ error: seriesError.message }, { status: 500 });
    }

    // Load tutors for name lookup
    const tutorIds = [...new Set((allSeries ?? []).map((s: any) => s.tutor_id as string))];
    let tutorMap: Record<string, string> = {};
    if (tutorIds.length > 0) {
      const { data: tutors } = await withCenter(
        supabase.from(DB.tutors).select("id, name").in("id", tutorIds)
      );
      for (const t of tutors ?? []) {
        tutorMap[t.id] = t.name ?? "—";
      }
    }

    const transporter = getTransporter();
    let sent = 0;
    let failed = 0;
    const errors: string[] = [];
    const redirectedTo = guard.mode === "redirect" ? guard.redirectTo : null;

    for (const student of students ?? []) {
      const emails: string[] = [student.email, student.mom_email, student.dad_email].filter(Boolean) as string[];
      if (emails.length === 0) continue;

      const studentSeries: SeriesRow[] = (allSeries ?? [])
        .filter((s: any) => s.student_id === student.id)
        .map((s: any) => ({
          day_of_week: s.day_of_week,
          time: s.time,
          topic: s.topic ?? "",
          start_date: s.start_date,
          end_date: s.end_date,
          tutor_name: tutorMap[s.tutor_id] ?? "—",
        }));

      const html = buildStudentScheduleHtml(centerName, student.name ?? "Student", termName, studentSeries);
      const subject = `Your tutoring schedule for ${termName}`;

      const toAddresses = guard.mode === "live" ? emails : [guard.redirectTo!];

      try {
        await transporter.sendMail({
          from: `"${centerName}" <${process.env.GOOGLE_EMAIL}>`,
          to: toAddresses.join(", "),
          subject,
          html,
        });
        sent++;
      } catch (err: any) {
        failed++;
        errors.push(`${student.name ?? student.id}: ${err?.message ?? "send failed"}`);
      }
    }

    return NextResponse.json({ sent, failed, errors, mode: guard.mode, redirectedTo });
  } catch (err: any) {
    console.error("send-student-schedule error:", err);
    return NextResponse.json({ error: err?.message ?? "Internal error" }, { status: 500 });
  }
}
