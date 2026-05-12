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

function toISODate(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function fmt12(time: string): string {
  const [hStr, mStr] = time.split(":");
  const h = Number(hStr);
  const suffix = h >= 12 ? "PM" : "AM";
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return `${h12}:${mStr} ${suffix}`;
}

function fmtDate(iso: string): string {
  return new Date(iso + "T00:00:00").toLocaleDateString("en-US", {
    weekday: "long",
    month: "long",
    day: "numeric",
  });
}

type SessionEntry = {
  date: string;
  time: string;
  students: { name: string; topic: string }[];
};

function buildScheduleHtml(
  centerName: string,
  tutorName: string,
  schedule: SessionEntry[],
  periodLabel: string
): string {
  const BRAND = "#0f172a";

  // Group by date then sort by time
  const byDate: Record<string, SessionEntry[]> = {};
  for (const s of schedule) {
    if (!byDate[s.date]) byDate[s.date] = [];
    byDate[s.date].push(s);
  }

  const totalSessions = schedule.length;
  const totalStudents = schedule.reduce((sum, s) => sum + s.students.length, 0);

  const dateBlocks = Object.entries(byDate)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([date, sessions]) => {
      const rows = sessions
        .sort((a, b) => a.time.localeCompare(b.time))
        .map((s) => {
          const studentList =
            s.students.length === 0
              ? `<span style="color:#9ca3af;font-style:italic;">No students</span>`
              : s.students
                  .map(
                    (st) =>
                      `${st.name}${st.topic ? ` <span style="color:#6b7280;font-size:11px;">(${st.topic})</span>` : ""}`
                  )
                  .join(", ");
          return `<tr>
            <td style="padding:8px 12px;font-size:13px;font-weight:600;color:#374151;white-space:nowrap;border-right:1px solid #f3f4f6;">${fmt12(s.time)}</td>
            <td style="padding:8px 12px;font-size:13px;color:#374151;">${studentList}</td>
          </tr>`;
        })
        .join("");

      return `<div style="margin-bottom:24px;">
        <p style="margin:0 0 8px;font-size:11px;font-weight:800;text-transform:uppercase;letter-spacing:0.08em;color:#6366f1;">${fmtDate(date)}</p>
        <table cellpadding="0" cellspacing="0" style="width:100%;border-collapse:collapse;background:#f9fafb;border-radius:8px;border:1px solid #e5e7eb;overflow:hidden;">
          ${rows || `<tr><td colspan="2" style="padding:10px 12px;font-size:12px;color:#9ca3af;font-style:italic;">No sessions scheduled</td></tr>`}
        </table>
      </div>`;
    })
    .join("");

  return `<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
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
          ${totalSessions > 0 ? `${totalSessions} session${totalSessions !== 1 ? "s" : ""}, ${totalStudents} student slot${totalStudents !== 1 ? "s" : ""}.` : "No sessions scheduled for this period."}
        </p>
        ${dateBlocks || `<p style="color:#9ca3af;font-size:13px;font-style:italic;">No sessions scheduled for this period.</p>`}
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
    const { tutorIds, mode, date } = body as {
      tutorIds: unknown;
      mode: unknown;
      date: unknown;
    };

    if (!Array.isArray(tutorIds) || tutorIds.length === 0) {
      return NextResponse.json({ error: "No tutor IDs provided." }, { status: 400 });
    }
    if (mode !== "daily" && mode !== "weekly") {
      return NextResponse.json({ error: 'mode must be "daily" or "weekly".' }, { status: 400 });
    }
    if (typeof date !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      return NextResponse.json({ error: "date must be a valid YYYY-MM-DD string." }, { status: 400 });
    }

    const guard = getDeliveryGuard();
    if (guard.mode === "disabled") {
      return NextResponse.json({
        sent: 0, failed: 0, errors: [],
        skipped: true, reason: "Email sending is disabled.",
        mode: "disabled",
      });
    }
    if (guard.mode === "redirect" && !guard.redirectTo) {
      return NextResponse.json(
        { error: "EMAIL_TEST_RECIPIENT or GOOGLE_EMAIL must be set for redirect mode." },
        { status: 500 }
      );
    }

    // Build date range
    const fromDate = date as string;
    let toDate = fromDate;
    let periodLabel: string;

    if (mode === "weekly") {
      const end = new Date(fromDate + "T00:00:00");
      end.setDate(end.getDate() + 6);
      toDate = toISODate(end);
      const startFmt = new Date(fromDate + "T00:00:00").toLocaleDateString("en-US", {
        month: "short",
        day: "numeric",
      });
      const endFmt = end.toLocaleDateString("en-US", {
        month: "short",
        day: "numeric",
        year: "numeric",
      });
      periodLabel = `Week of ${startFmt}–${endFmt}`;
    } else {
      periodLabel = fmtDate(fromDate);
    }

    // Center name
    const { data: settingsData } = await withCenter(
      supabase.from(DB.centerSettings).select("center_name").limit(1)
    ).maybeSingle();
    const centerName: string = settingsData?.center_name ?? "Tutoring Center";

    // Fetch tutors (only those in the provided list)
    const safeIds = (tutorIds as unknown[]).filter(
      (id): id is string => typeof id === "string" && id.length > 0
    );
    const { data: tutors, error: tutorsError } = await withCenter(
      supabase.from(DB.tutors).select("id, name, email").in("id", safeIds)
    );
    if (tutorsError) {
      return NextResponse.json({ error: tutorsError.message }, { status: 500 });
    }

    // Fetch sessions in date range for those tutors
    const { data: sessionsData, error: sessionsError } = await (
      withCenter(
        supabase
          .from(DB.sessions)
          .select(
            `id, session_date, time, tutor_id, ${DB.sessionStudents}(id, name, topic, status)`
          )
          .in("tutor_id", safeIds)
          .gte("session_date", fromDate)
          .lte("session_date", toDate)
      ) as any
    );
    if (sessionsError) {
      return NextResponse.json({ error: sessionsError.message }, { status: 500 });
    }

    // Build per-tutor schedule map
    const scheduleByTutor: Record<string, SessionEntry[]> = {};
    for (const session of sessionsData ?? []) {
      const tid: string = session.tutor_id;
      if (!scheduleByTutor[tid]) scheduleByTutor[tid] = [];
      const ssRows = Array.isArray(session[DB.sessionStudents])
        ? session[DB.sessionStudents]
        : [];
      const students = ssRows
        .filter((ss: any) => ss.status !== "cancelled")
        .map((ss: any) => ({
          name: ss.name ?? "—",
          topic: ss.topic ?? "",
        }));
      scheduleByTutor[tid].push({
        date: session.session_date,
        time: session.time,
        students,
      });
    }

    const transporter = getTransporter();
    let sent = 0;
    let failed = 0;
    const errors: string[] = [];

    for (const tutor of tutors ?? []) {
      if (!tutor.email) continue;
      const schedule = scheduleByTutor[tutor.id] ?? [];
      const html = buildScheduleHtml(centerName, tutor.name ?? "Tutor", schedule, periodLabel);
      const subject = `Your ${mode === "daily" ? "daily" : "weekly"} schedule — ${periodLabel}`;
      const textLines =
        schedule.length === 0
          ? "No sessions scheduled for this period."
          : schedule
              .sort(
                (a, b) =>
                  a.date.localeCompare(b.date) || a.time.localeCompare(b.time)
              )
              .map(
                (s) =>
                  `${fmtDate(s.date)} at ${fmt12(s.time)}: ${
                    s.students.map((st) => st.name).join(", ") || "no students"
                  }`
              )
              .join("\n");
      const text = `Hi ${tutor.name},\n\nHere's your schedule for ${periodLabel}:\n\n${textLines}\n\n— ${centerName}`;
      const to = guard.mode === "live" ? tutor.email : guard.redirectTo!;

      try {
        await transporter.sendMail({
          from: `"${centerName}" <${process.env.GOOGLE_EMAIL}>`,
          to,
          subject,
          text,
          html,
        });
        sent++;
      } catch (e: any) {
        failed++;
        const msg: string = e?.message ?? "Unknown error";
        if (errors.length < 5) errors.push(`${tutor.name ?? tutor.id}: ${msg}`);
      }
    }

    return NextResponse.json({
      sent,
      failed,
      errors,
      mode: guard.mode,
      redirectedTo: guard.mode === "redirect" ? guard.redirectTo : null,
    });
  } catch (e: any) {
    return NextResponse.json(
      { error: e?.message ?? "Internal server error." },
      { status: 500 }
    );
  }
}
