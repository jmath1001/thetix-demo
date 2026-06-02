'use client';
import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { supabase } from '@/lib/supabaseClient';
import { DB, withCenter } from '@/lib/db';
import {
  Mail, Send, Clock, Check, AlertCircle, Edit3, Save,
  X, RefreshCw, ChevronDown, ChevronUp, Users, Calendar,
  Link2, Loader2, Eye, AlertTriangle, ChevronRight, Clipboard, Play, Search,
} from 'lucide-react';
import { logEvent } from '@/lib/analytics';
import { SlotPreferenceSurvey, type SlotPreferences } from '@/components/SlotPreferenceSurvey';
import { formatTime } from '@/components/constants';

type Log = {
  id: string;
  sent_at: string;
  session_date: string;
  session_time: string;
  student_name: string;
  emailed_to: string;
};

type Settings = {
  center_name: string;
  center_email: string;
  center_phone: string;
  reminder_subject: string;
  reminder_body: string;
};

const DEFAULT_SETTINGS: Settings = {
  center_name: 'Tutoring Center',
  center_email: '',
  center_phone: '',
  reminder_subject: 'Reminder: Upcoming tutoring session for {{name}}',
  reminder_body: 'Hi {{name}},\n\nThis is a reminder that you have a tutoring session on {{date}} at {{time}}.\n\nPlease confirm here: {{link}}\n\nThank you.',
};

type Candidate = {
  rowId: string;
  studentId: string;
  studentName: string;
  sessionDate: string;
  sessionTime: string;
  tutorName: string;
  studentEmail: string | null;
  momEmail: string | null;
  dadEmail: string | null;
  notifyStudent: boolean;
  notifyMom: boolean;
  notifyDad: boolean;
  reminderSent: boolean;
};

type Term = {
  id: string;
  name: string;
  start_date: string;
  end_date: string;
  status: string;
};

type BlastRecipient = {
  studentId: string;
  studentName: string;
  studentEmail: string | null;
  momEmail: string | null;
  dadEmail: string | null;
  notifyStudent: boolean;
  notifyMom: boolean;
  notifyDad: boolean;
};

type StudentSchedLog = {
  id: string;
  student_id: string;
  student_name: string;
  term_id: string;
  term_name: string;
  emailed_to: string;
  status: 'sent' | 'failed';
  error: string | null;
  sent_at: string;
};

type TutorSchedLog = {
  id: string;
  tutor_id: string;
  tutor_name: string;
  emailed_to: string;
  mode: 'daily' | 'weekly';
  period_label: string;
  trigger: 'cron' | 'manual';
  status: 'sent' | 'failed';
  error: string | null;
  sent_at: string;
};

type ScheduleEntry = {
  date: string;
  time: string;
  students: { name: string; topic: string }[];
};

type EmailPreview = {
  title: string;
  subject: string;
  html: string;
  url?: string;
  note?: string;
};

// ── Slot preferences types & helpers ─────────────────────────────────────────
const DOW_LABELS: Record<string, string> = {
  '1': 'Mon', '2': 'Tue', '3': 'Wed', '4': 'Thu', '5': 'Fri', '6': 'Sat', '7': 'Sun',
}
type SpTermRow = { id: string; name: string; status: string; session_times_by_day: Record<string, string[]> | null }
type SpStudentRow = { id: string; name: string; subjects: string[] }
type SpEnrollmentRow = { student_id: string; slot_preferences: SlotPreferences | null; subjects: string[] }
type SpSlotAssignment = { studentId: string; studentName: string; subject: string; choiceUsed: 1 | 2 | 3; blocks: string[]; tutorId: string; tutorName: string }
type SpUnmatchedStudent = { studentId: string; studentName: string; subject: string; reason: string }
type SpProposal = { assignments: SpSlotAssignment[]; unmatched: SpUnmatchedStudent[] }

function parseSpBlock(b: string): { dow: string; time: string } | null {
  const m = b.match(/^(\d)-([\d:]+)$/)
  return m ? { dow: m[1], time: m[2] } : null
}
function spBlockLabel(blocks: string[]): string {
  if (blocks.length === 0) return '—'
  const first = parseSpBlock(blocks[0])
  if (!first) return blocks.join(', ')
  const dayStr = DOW_LABELS[first.dow] ?? `Day ${first.dow}`
  if (blocks.length === 1) return `${dayStr} ${formatTime(first.time)}`
  const last = parseSpBlock(blocks[blocks.length - 1])
  const endTime = last ? formatTime(last.time) : ''
  return `${dayStr} ${formatTime(first.time)} – ${endTime} (2h)`
}
function spChoiceBadge(c: 1 | 2 | 3) {
  const map: Record<number, string> = {
    1: 'bg-emerald-100 text-emerald-700 border-emerald-200',
    2: 'bg-amber-100 text-amber-700 border-amber-200',
    3: 'bg-slate-100 text-slate-500 border-slate-200',
  }
  return map[c] ?? map[3]
}

const baseInputCls = 'w-full rounded border border-slate-200 bg-white px-3 py-2 text-sm text-slate-800 outline-none focus:border-slate-400 focus:ring-2 focus:ring-slate-100';
const BRAND_BLUE = '#0f172a';
const BRAND_RED = '#991b1b';

function toISODate(d: Date) { return d.toLocaleDateString('en-CA'); }
function tomorrow() { const d = new Date(); d.setDate(d.getDate() + 1); return toISODate(d); }
function addDaysIso(iso: string, days: number) { const d = new Date(`${iso}T00:00:00`); d.setDate(d.getDate() + days); return toISODate(d); }
function formatSentAt(iso: string) {
  try { return new Date(iso).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }); }
  catch { return iso; }
}

function applyTemplate(template: string, values: Record<string, string>) {
  return template.replace(/{{\s*(name|date|time|link)\s*}}/gi, (_, key: string) => values[key.toLowerCase()] ?? '');
}

function buildAnnouncementHtml(centerName: string, bodyText: string, availabilityLink: string, centerPhone?: string | null) {
  const safeBody = bodyText.replace(/\n/g, '<br>').trim();
  const linkSection = availabilityLink
    ? `<table cellpadding="0" cellspacing="0" style="margin:24px 0 0;"><tr>
        <td style="border-radius:8px;background:${BRAND_BLUE};">
          <a href="${availabilityLink}" style="display:inline-block;padding:13px 28px;font-size:14px;font-weight:700;color:white;text-decoration:none;border-radius:8px;">Submit Availability →</a>
        </td>
      </tr></table>
      <p style="margin:14px 0 0;font-size:11px;color:#9ca3af;">If the button doesn't work: <a href="${availabilityLink}" style="color:${BRAND_BLUE};">${availabilityLink}</a></p>`
    : '';
  return `<!DOCTYPE html><html><head><meta charset="utf-8"></head>
<body style="margin:0;padding:0;background:#f9fafb;font-family:ui-sans-serif,system-ui,sans-serif;">
<table width="100%" cellpadding="0" cellspacing="0" style="background:#f9fafb;padding:32px 16px;">
  <tr><td align="center">
  <table width="100%" cellpadding="0" cellspacing="0" style="max-width:520px;background:white;border-radius:12px;border:1px solid #e5e7eb;overflow:hidden;">
    <tr><td style="background:${BRAND_BLUE};padding:20px 28px;">
      <p style="margin:0;font-size:18px;font-weight:800;color:white;">${centerName}</p>
      <p style="margin:4px 0 0;font-size:12px;color:rgba(255,255,255,0.75);">Announcement</p>
    </td></tr>
    <tr><td style="padding:28px;">
      <p style="margin:0 0 16px;font-size:15px;color:#111827;line-height:1.65;">${safeBody}</p>
      ${linkSection}
    </td></tr>
    <tr><td style="padding:16px 28px;background:#f9fafb;border-top:1px solid #f3f4f6;">
      <p style="margin:0;font-size:11px;color:#9ca3af;">— ${centerName}</p>
      ${centerPhone ? `<p style="margin:4px 0 0;font-size:11px;color:#9ca3af;">Please do not reply to this email — call us at <a href="tel:${centerPhone}" style="color:#9ca3af;">${centerPhone}</a>.</p>` : `<p style="margin:4px 0 0;font-size:11px;color:#f59e0b;font-weight:600;">⚠ No phone number set — please add one in center settings.</p>`}
    </td></tr>
  </table>
  </td></tr>
</table>
</body></html>`;
}

function fmt12(time: string): string {
  const [hStr, mStr] = time.split(':');
  const hour = Number(hStr);
  const suffix = hour >= 12 ? 'PM' : 'AM';
  const hour12 = hour % 12 === 0 ? 12 : hour % 12;
  return `${hour12}:${mStr} ${suffix}`;
}

function fmtDate(iso: string): string {
  return new Date(`${iso}T00:00:00`).toLocaleDateString('en-US', {
    weekday: 'long',
    month: 'long',
    day: 'numeric',
  });
}

function buildScheduleHtml(centerName: string, tutorName: string, schedule: ScheduleEntry[], periodLabel: string, centerPhone?: string | null): string {
  const byDate: Record<string, ScheduleEntry[]> = {};
  for (const entry of schedule) {
    if (!byDate[entry.date]) byDate[entry.date] = [];
    byDate[entry.date].push(entry);
  }

  const totalSessions = schedule.length;
  const totalStudents = schedule.reduce((sum, entry) => sum + entry.students.length, 0);

  const dateBlocks = Object.entries(byDate)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([date, sessions]) => {
      const rows = sessions
        .sort((a, b) => a.time.localeCompare(b.time))
        .map((entry) => {
          const studentList = entry.students.length === 0
            ? `<span style="color:#9ca3af;font-style:italic;">No students</span>`
            : entry.students
                .map((student) => `${student.name}${student.topic ? ` <span style="color:#6b7280;font-size:11px;">(${student.topic})</span>` : ''}`)
                .join(', ');

          return `<tr>
            <td style="padding:8px 12px;font-size:13px;font-weight:600;color:#374151;white-space:nowrap;border-right:1px solid #f3f4f6;">${fmt12(entry.time)}</td>
            <td style="padding:8px 12px;font-size:13px;color:#374151;">${studentList}</td>
          </tr>`;
        })
        .join('');

      return `<div style="margin-bottom:24px;">
        <p style="margin:0 0 8px;font-size:11px;font-weight:800;text-transform:uppercase;letter-spacing:0.08em;color:#6366f1;">${fmtDate(date)}</p>
        <table cellpadding="0" cellspacing="0" style="width:100%;border-collapse:collapse;background:#f9fafb;border-radius:8px;border:1px solid #e5e7eb;overflow:hidden;">
          ${rows || `<tr><td colspan="2" style="padding:10px 12px;font-size:12px;color:#9ca3af;font-style:italic;">No sessions scheduled</td></tr>`}
        </table>
      </div>`;
    })
    .join('');

  return `<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#f9fafb;font-family:ui-sans-serif,system-ui,-apple-system,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#f9fafb;padding:32px 16px;">
    <tr><td align="center">
    <table width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;background:white;border-radius:12px;border:1px solid #e5e7eb;overflow:hidden;">
      <tr><td style="background:${BRAND_BLUE};padding:20px 28px;">
        <p style="margin:0;font-size:18px;font-weight:800;color:white;">${centerName}</p>
        <p style="margin:4px 0 0;font-size:12px;color:rgba(255,255,255,0.7);">Schedule — ${periodLabel}</p>
      </td></tr>
      <tr><td style="padding:28px;">
        <p style="margin:0 0 4px;font-size:16px;font-weight:700;color:#111827;">Hi ${tutorName},</p>
        <p style="margin:0 0 24px;font-size:13px;color:#6b7280;">
          Here's your schedule for <strong>${periodLabel}</strong>.
          ${totalSessions > 0 ? `${totalSessions} session${totalSessions !== 1 ? 's' : ''}, ${totalStudents} student slot${totalStudents !== 1 ? 's' : ''}.` : 'No sessions scheduled for this period.'}
        </p>
        ${dateBlocks || `<p style="color:#9ca3af;font-size:13px;font-style:italic;">No sessions scheduled for this period.</p>`}
      </td></tr>
      <tr><td style="padding:16px 28px;background:#f9fafb;border-top:1px solid #f3f4f6;">
        <p style="margin:0;font-size:11px;color:#9ca3af;">— ${centerName}</p>
        ${centerPhone ? `<p style="margin:4px 0 0;font-size:11px;color:#9ca3af;">Please do not reply to this email — call us at <a href="tel:${centerPhone}" style="color:#9ca3af;">${centerPhone}</a>.</p>` : `<p style="margin:4px 0 0;font-size:11px;color:#f59e0b;font-weight:600;">⚠ No phone number set — please add one in center settings.</p>`}
      </td></tr>
    </table>
    </td></tr>
  </table>
</body>
</html>`;
}

const DOW_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

type StudentSeriesRow = {
  day_of_week: number;
  time: string;
  topic: string;
  start_date: string;
  end_date: string;
  tutor_name: string;
};

function buildStudentScheduleHtml(centerName: string, studentName: string, termName: string, series: StudentSeriesRow[], centerPhone?: string | null): string {
  const rows = series
    .sort((a, b) => a.day_of_week - b.day_of_week || a.time.localeCompare(b.time))
    .map(s => {
      const dayLabel = DOW_NAMES[s.day_of_week] ?? `Day ${s.day_of_week}`;
      const startFmt = new Date(`${s.start_date}T00:00:00`).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
      const endFmt   = new Date(`${s.end_date}T00:00:00`).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
      return `<tr>
        <td style="padding:10px 14px;font-size:13px;font-weight:700;color:#111827;white-space:nowrap;border-right:1px solid #f3f4f6;">${dayLabel}</td>
        <td style="padding:10px 14px;font-size:13px;color:#374151;white-space:nowrap;border-right:1px solid #f3f4f6;">${fmt12(s.time)}</td>
        <td style="padding:10px 14px;font-size:13px;color:#374151;border-right:1px solid #f3f4f6;">${s.topic || '—'}</td>
        <td style="padding:10px 14px;font-size:13px;color:#6b7280;white-space:nowrap;border-right:1px solid #f3f4f6;">${s.tutor_name}</td>
        <td style="padding:10px 14px;font-size:11px;color:#9ca3af;white-space:nowrap;">${startFmt} – ${endFmt}</td>
      </tr>`;
    })
    .join('');
  const tableBody = rows || `<tr><td colspan="5" style="padding:14px;font-size:12px;color:#9ca3af;font-style:italic;">No recurring sessions scheduled for this term.</td></tr>`;
  return `<!DOCTYPE html>
<html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#f9fafb;font-family:ui-sans-serif,system-ui,-apple-system,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#f9fafb;padding:32px 16px;">
    <tr><td align="center">
    <table width="100%" cellpadding="0" cellspacing="0" style="max-width:600px;background:white;border-radius:12px;border:1px solid #e5e7eb;overflow:hidden;">
      <tr><td style="background:${BRAND_BLUE};padding:20px 28px;">
        <p style="margin:0;font-size:18px;font-weight:800;color:white;">${centerName}</p>
        <p style="margin:4px 0 0;font-size:12px;color:rgba(255,255,255,0.7);">Your Recurring Schedule — ${termName}</p>
      </td></tr>
      <tr><td style="padding:28px;">
        <p style="margin:0 0 4px;font-size:16px;font-weight:700;color:#111827;">Hi ${studentName},</p>
        <p style="margin:0 0 24px;font-size:13px;color:#6b7280;">Here is your confirmed recurring tutoring schedule for <strong>${termName}</strong>. These sessions repeat every week on the days listed below.</p>
        <div style="overflow-x:auto;">
          <table cellpadding="0" cellspacing="0" style="width:100%;border-collapse:collapse;background:#f9fafb;border-radius:8px;border:1px solid #e5e7eb;overflow:hidden;">
            <thead><tr style="background:#f3f4f6;">
              <th style="padding:8px 14px;font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:0.06em;color:#6b7280;text-align:left;border-right:1px solid #e5e7eb;">Day</th>
              <th style="padding:8px 14px;font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:0.06em;color:#6b7280;text-align:left;border-right:1px solid #e5e7eb;">Time</th>
              <th style="padding:8px 14px;font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:0.06em;color:#6b7280;text-align:left;border-right:1px solid #e5e7eb;">Subject</th>
              <th style="padding:8px 14px;font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:0.06em;color:#6b7280;text-align:left;border-right:1px solid #e5e7eb;">Tutor</th>
              <th style="padding:8px 14px;font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:0.06em;color:#6b7280;text-align:left;">Dates</th>
            </tr></thead>
            <tbody>${tableBody}</tbody>
          </table>
        </div>
      </td></tr>
      <tr><td style="padding:16px 28px;background:#f9fafb;border-top:1px solid #f3f4f6;">
        <p style="margin:0;font-size:11px;color:#9ca3af;">— ${centerName}</p>
        ${centerPhone ? `<p style="margin:4px 0 0;font-size:11px;color:#9ca3af;">Please do not reply to this email — call us at <a href="tel:${centerPhone}" style="color:#9ca3af;">${centerPhone}</a>.</p>` : `<p style="margin:4px 0 0;font-size:11px;color:#f59e0b;font-weight:600;">⚠ No phone number set — please add one in center settings.</p>`}
      </td></tr>
    </table>
    </td></tr>
  </table>
</body></html>`;
}

function buildReminderStudentHtml(settings: Settings, studentName: string, sessionDate: string, sessionTime: string, confirmLink: string) {
  const body = applyTemplate(settings.reminder_body, {
    name: `<strong>${studentName}</strong>`,
    date: `<strong>${sessionDate}</strong>`,
    time: `<strong>${sessionTime}</strong>`,
    link: `<a href="${confirmLink}" style="color:${BRAND_RED};text-decoration:underline;">${confirmLink}</a>`,
  }).replace(/\n/g, '<br>').trim();

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
      ${settings.center_phone ? `<p style="margin:4px 0 0;font-size:11px;color:#9ca3af;">Please do not reply to this email — call us at <a href="tel:${settings.center_phone}" style="color:#9ca3af;">${settings.center_phone}</a>.</p>` : `<p style="margin:4px 0 0;font-size:11px;color:#f59e0b;font-weight:600;">⚠ No phone number set — please add one in center settings.</p>`}
    </td></tr>
  </table></td></tr></table></body></html>`;
}

function buildReminderGuardianHtml(settings: Settings, guardianName: string, studentName: string, sessionDate: string, sessionTime: string) {
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
        <strong>${sessionDate}</strong> at <strong>${sessionTime}</strong>.<br><br>
        No action needed — this is for your records only.
      </p>
    </td></tr>
    <tr><td style="padding:16px 28px;background:#f9fafb;border-top:1px solid #f3f4f6;">
      <p style="margin:0;font-size:11px;color:#9ca3af;">— ${settings.center_name} Automated Reminders</p>
      ${settings.center_phone ? `<p style="margin:4px 0 0;font-size:11px;color:#9ca3af;">Please do not reply to this email — call us at <a href="tel:${settings.center_phone}" style="color:#9ca3af;">${settings.center_phone}</a>.</p>` : `<p style="margin:4px 0 0;font-size:11px;color:#f59e0b;font-weight:600;">⚠ No phone number set — please add one in center settings.</p>`}
    </td></tr>
  </table></td></tr></table></body></html>`;
}

function buildPreviewFrameHtml(subject: string, html: string) {
  return html;
}

export default function ContactCenter() {
  const [settings, setSettings]               = useState<Settings | null>(null);
  const [settingsError, setSettingsError]     = useState<string | null>(null);
  const [loadingSettings, setLoadingSettings] = useState(true);
  const [editingTemplate, setEditingTemplate] = useState(false);
  const [savingTemplate, setSavingTemplate]   = useState(false);
  const [templateSaved, setTemplateSaved]     = useState(false);
  const [draftSubject, setDraftSubject]       = useState('');
  const [draftBody, setDraftBody]             = useState('');

  const [dispatchDate, setDispatchDate]           = useState(tomorrow());
  const [terms, setTerms]                         = useState<Term[]>([]);
  // const [selectedTermId, setSelectedTermId] = useState('') // removed — reminders are date-based
  const [candidates, setCandidates]               = useState<Candidate[]>([]);
  const [loadingCandidates, setLoadingCandidates] = useState(false);
  const [selected, setSelected]                   = useState<Set<string>>(new Set());
  const [sending, setSending]                     = useState(false);
  const [confirmSend, setConfirmSend]             = useState(false);
  const [sendResult, setSendResult]               = useState<{ sent: number; failed: number; errors: string[]; mode?: string; redirectedTo?: string | null; skipped?: boolean; reason?: string; details?: { name: string; to: string }[] } | null>(null);

  const [logs, setLogs]                 = useState<Log[]>([]);
  const [loadingLogs, setLoadingLogs]   = useState(true);
  const [logsExpanded, setLogsExpanded] = useState(false);
  const [cronHistoryExpanded, setCronHistoryExpanded] = useState(false);

  // ── Auto-reminder schedule (cron) ──────────────────────────────────────────
  type CronSchedule = { hours: number[]; minutes: number[]; timezone: string }
  type CronJob = { enabled: boolean; nextExecution: number; lastExecution: number; lastStatus: number; schedule: CronSchedule }
  type CronHistoryItem = { date: number; status: number; statusText: string; httpStatus: number; duration: number }
  const DEFAULT_REMINDER_TIMEZONE = 'America/Chicago'
  const [cronJob, setCronJob]             = useState<CronJob | null>(null);
  const [cronHistory, setCronHistory]     = useState<CronHistoryItem[]>([]);
  const [cronLoading, setCronLoading]     = useState(false);
  const [cronSaving, setCronSaving]       = useState(false);
  const [cronConfigured, setCronConfigured] = useState<boolean | null>(null);
  const [reminderTime, setReminderTime]   = useState('07:00');
  const cronFetchedRef = useRef(false);

  // ── Tutor schedule cron (weekly & daily) ───────────────────────────────────
  const [tutorWeeklyCronJob, setTutorWeeklyCronJob]               = useState<CronJob | null>(null);
  const [tutorWeeklyCronHistory, setTutorWeeklyCronHistory]       = useState<CronHistoryItem[]>([]);
  const [tutorWeeklyCronLoading, setTutorWeeklyCronLoading]       = useState(false);
  const [tutorWeeklyCronSaving, setTutorWeeklyCronSaving]         = useState(false);
  const [tutorWeeklyCronConfigured, setTutorWeeklyCronConfigured] = useState<boolean | null>(null);
  const [tutorWeeklyTime, setTutorWeeklyTime]                     = useState('07:00');
  const [tutorWeeklyCronHistExpanded, setTutorWeeklyCronHistExpanded] = useState(false);

  const [tutorDailyCronJob, setTutorDailyCronJob]               = useState<CronJob | null>(null);
  const [tutorDailyCronHistory, setTutorDailyCronHistory]       = useState<CronHistoryItem[]>([]);
  const [tutorDailyCronLoading, setTutorDailyCronLoading]       = useState(false);
  const [tutorDailyCronSaving, setTutorDailyCronSaving]         = useState(false);
  const [tutorDailyCronConfigured, setTutorDailyCronConfigured] = useState<boolean | null>(null);
  const [tutorDailyTime, setTutorDailyTime]                     = useState('07:00');
  const [tutorDailyCronHistExpanded, setTutorDailyCronHistExpanded] = useState(false);

  const tutorCronFetchedRef = useRef(false);

  const [blastTermId, setBlastTermId]                       = useState('');
  const [blastSubject, setBlastSubject]                     = useState('');
  const [blastBody, setBlastBody]                           = useState('');
  const [blastRecipients, setBlastRecipients]               = useState<BlastRecipient[]>([]);
  const [blastSelected, setBlastSelected]                   = useState<Set<string>>(new Set());
  const [loadingBlastRecipients, setLoadingBlastRecipients] = useState(false);
  const [blastSending, setBlastSending]                     = useState(false);
  const [blastConfirm, setBlastConfirm]                     = useState(false);
  const [blastResult, setBlastResult]                       = useState<{ sent: number; failed: number; errors: string[]; mode?: string; redirectedTo?: string | null; details?: { name: string; to: string }[] } | null>(null);
  const [blastExpanded, setBlastExpanded]                   = useState(false);
  const [editingBlastTemplate, setEditingBlastTemplate]     = useState(false);

  // General email blast state (freeform, no term required)
  const [generalSubject, setGeneralSubject]   = useState('');
  const [generalBody, setGeneralBody]         = useState('');
  const [generalSelected, setGeneralSelected] = useState<Set<string>>(new Set());
  const [generalSending, setGeneralSending]   = useState(false);
  const [generalConfirm, setGeneralConfirm]   = useState(false);
  const [generalResult, setGeneralResult]     = useState<{ sent: number; failed: number; errors: string[]; mode?: string; redirectedTo?: string | null; details?: { name: string; to: string }[] } | null>(null);
  const [generalExpanded, setGeneralExpanded] = useState(false);

  // Student schedule email state
  const [studentSchedTermId, setStudentSchedTermId]   = useState('');
  const [studentSchedSelected, setStudentSchedSelected] = useState<Set<string>>(new Set());
  const [studentSchedSending, setStudentSchedSending]   = useState(false);
  const [studentSchedConfirm, setStudentSchedConfirm]   = useState(false);
  const [studentSchedResult, setStudentSchedResult]     = useState<{ sent: number; failed: number; errors: string[]; mode?: string; redirectedTo?: string | null; skipped?: boolean; reason?: string; details?: { name: string; to: string }[] } | null>(null);
  const [studentSchedLogs, setStudentSchedLogs]         = useState<StudentSchedLog[]>([]);
  const [loadingStudentSchedLogs, setLoadingStudentSchedLogs] = useState(false);
  const [studentSchedLogsExpanded, setStudentSchedLogsExpanded] = useState(false);

  // Tutor schedule email state
  const [tutorSchedExpanded, setTutorSchedExpanded]   = useState(false);
  const [tutorSchedMode, setTutorSchedMode]           = useState<'weekly' | 'daily'>('weekly');
  const [tutorSchedWeek, setTutorSchedWeek]           = useState(() => {
    const d = new Date(); const dow = d.getDay(); d.setDate(d.getDate() + (dow === 0 ? -6 : 1 - dow)); return toISODate(d);
  });
  const [tutorSchedDay, setTutorSchedDay]             = useState(() => toISODate(new Date()));
  const [tutorsWithEmail, setTutorsWithEmail]         = useState<{ id: string; name: string; email: string }[]>([]);
  const [tutorSchedSending, setTutorSchedSending]     = useState(false);
  const [tutorSchedResult, setTutorSchedResult]       = useState<{ sent: number; failed: number; errors: string[]; mode?: string; redirectedTo?: string | null; skipped?: boolean; reason?: string; details?: { name: string; to: string }[] } | null>(null);
  const [tutorSchedLogs, setTutorSchedLogs]           = useState<TutorSchedLog[]>([]);
  const [loadingTutorSchedLogs, setLoadingTutorSchedLogs] = useState(false);
  const [tutorSchedLogsExpanded, setTutorSchedLogsExpanded] = useState(false);
  const [previewModal, setPreviewModal]               = useState<EmailPreview | null>(null);
  const [previewLoading, setPreviewLoading]           = useState(false);

  // Survey tab state
  const [spTerms, setSpTerms]                     = useState<SpTermRow[]>([])
  const [spSelectedTermId, setSpSelectedTermId]   = useState<string>('')
  const [spStudents, setSpStudents]               = useState<SpStudentRow[]>([])
  const [spEnrollments, setSpEnrollments]         = useState<SpEnrollmentRow[]>([])
  const [spLoading, setSpLoading]                 = useState(false)
  const [spSearch, setSpSearch]                   = useState('')
  const [spOpenStudentId, setSpOpenStudentId]     = useState<string | null>(null)
  const [spProposal, setSpProposal]               = useState<SpProposal | null>(null)
  const [spRunning, setSpRunning]                 = useState(false)
  const [spRunError, setSpRunError]               = useState<string | null>(null)

  const formatSettingsError = (message: string) => {
    if (message.toLowerCase().includes('relation') || message.toLowerCase().includes('does not exist')) {
      return `Missing table: ${DB.centerSettings}. Create that table in Supabase.`;
    }
    return `Failed to load ${DB.centerSettings}: ${message}`;
  };

  const fetchSettings = useCallback(async () => {
    setLoadingSettings(true);
    setSettingsError(null);

    const { data, error } = await withCenter(
      supabase.from(DB.centerSettings).select('*').limit(1)
    ).maybeSingle();

    if (error) {
      setSettings(null);
      setSettingsError(formatSettingsError(error.message));
      setLoadingSettings(false);
      return;
    }

    if (data) {
      setSettings(data);
      setDraftSubject(data.reminder_subject ?? '');
      setDraftBody(data.reminder_body ?? '');
      setLoadingSettings(false);
      return;
    }

    const { data: inserted, error: insertError } = await supabase
      .from(DB.centerSettings)
      .insert({
        ...DEFAULT_SETTINGS,
        center_id: process.env.NEXT_PUBLIC_CENTER_ID ?? process.env.CENTER_ID ?? '',
      })
      .select('*')
      .single();

    if (insertError) {
      setSettings(null);
      setSettingsError(formatSettingsError(insertError.message));
      setLoadingSettings(false);
      return;
    }

    setSettings(inserted);
    setDraftSubject(inserted.reminder_subject ?? '');
    setDraftBody(inserted.reminder_body ?? '');
    setLoadingSettings(false);
  }, []);

  const fetchLogs = useCallback(async () => {
    setLoadingLogs(true);
    const { data } = await withCenter(
      supabase.from(DB.reminderLogs).select('*')
    ).order('sent_at', { ascending: false }).limit(200);
    if (data) setLogs(data);
    setLoadingLogs(false);
  }, []);

  const fetchTerms = useCallback(async () => {
    try {
      const res = await fetch('/api/terms');
      const payload = await res.json();
      if (!res.ok) throw new Error(payload?.error || 'Failed to load terms');
      const rows: Term[] = Array.isArray(payload?.terms) ? payload.terms : [];
      setTerms(rows);
      const preferred = rows.find(t => t.status === 'active') ?? rows[0] ?? null;
      setBlastTermId(preferred?.id ?? '');
      if (preferred?.name) {
        setBlastSubject(`Availability Is Now Open for {{term}} – Submit Your Preferences`);
        setBlastBody(`Hi {{name}},\n\nWe're now collecting availability for {{term}}. Please use the link below to submit your preferred schedule.\n\n{{link}}\n\nThank you,\n{{center}}`);
      }
    } catch (err) {
      console.error('Failed to load terms:', err);
      setTerms([]);
      setBlastTermId('');
    }
  }, []);

  const fetchBlastRecipients = useCallback(async () => {
    setLoadingBlastRecipients(true);
    try {
      const { data, error } = await withCenter(
        supabase.from(DB.students).select('id, name, email, mom_email, dad_email, notify_student, notify_mom, notify_dad')
      ).order('name', { ascending: true });
      if (error) throw error;
      const recipients: BlastRecipient[] = (data ?? [])
        .map((s: any) => ({
          studentId: s.id,
          studentName: s.name ?? '—',
          studentEmail: s.email ?? null,
          momEmail: s.mom_email ?? null,
          dadEmail: s.dad_email ?? null,
          notifyStudent: s.notify_student ?? true,
          notifyMom: s.notify_mom ?? true,
          notifyDad: s.notify_dad ?? true,
        }))
        .filter((r: BlastRecipient) => r.studentEmail || r.momEmail || r.dadEmail);
      setBlastRecipients(recipients);
      const activeIds = recipients
        .filter((r: BlastRecipient) =>
          (r.studentEmail && r.notifyStudent) ||
          (r.momEmail && r.notifyMom) ||
          (r.dadEmail && r.notifyDad)
        )
        .map((r: BlastRecipient) => r.studentId);
      setBlastSelected(new Set(activeIds));
      setGeneralSelected(new Set(activeIds));
    } catch (e: any) {
      console.error('Failed to load blast recipients:', e);
    }
    setLoadingBlastRecipients(false);
  }, []);

  const fetchTutorSchedLogs = useCallback(async () => {
    setLoadingTutorSchedLogs(true);
    try {
      const { data } = await withCenter(
        supabase
          .from(DB.tutorScheduleLogs)
          .select('id, tutor_id, tutor_name, emailed_to, mode, period_label, trigger, status, error, sent_at')
      ).order('sent_at', { ascending: false }).limit(200);
      setTutorSchedLogs((data as TutorSchedLog[]) ?? []);
    } catch {
      setTutorSchedLogs([]);
    }
    setLoadingTutorSchedLogs(false);
  }, []);

  const fetchStudentSchedLogs = useCallback(async (termId: string) => {
    if (!termId) { setStudentSchedLogs([]); return; }
    setLoadingStudentSchedLogs(true);
    try {
      const { data } = await withCenter(
        supabase
          .from(DB.studentScheduleLogs)
          .select('id, student_id, student_name, term_id, term_name, emailed_to, status, error, sent_at')
          .eq('term_id', termId)
      ).order('sent_at', { ascending: false });
      setStudentSchedLogs((data as StudentSchedLog[]) ?? []);
    } catch {
      setStudentSchedLogs([]);
    }
    setLoadingStudentSchedLogs(false);
  }, []);

  const fetchCandidates = useCallback(async (date: string) => {
    setLoadingCandidates(true);
    setSendResult(null);
    setConfirmSend(false);
    setSelected(new Set());

    try {
      const { data, error } = await (withCenter(supabase
        .from(DB.sessionStudents)
        .select(`
          id,
          student_id,
          status,
          reminder_sent,
          ${DB.sessions}!inner (
            session_date,
            time,
            ${DB.tutors} ( name )
          ),
          ${DB.students} (
            name,
            email,
            mom_email,
            dad_email,
            notify_student,
            notify_mom,
            notify_dad
          )
        `)
        .eq(`${DB.sessions}.session_date`, date)
        .neq('status', 'cancelled')) as any);

      if (error) throw error;

      const rows: Candidate[] = (data ?? []).map((r: any) => {
        const sess    = Array.isArray(r[DB.sessions]) ? r[DB.sessions][0] : r[DB.sessions];
        const tutor   = Array.isArray(sess?.[DB.tutors]) ? sess[DB.tutors][0] : sess?.[DB.tutors];
        const student = Array.isArray(r[DB.students]) ? r[DB.students][0] : r[DB.students];
        return {
          rowId:        r.id,
          studentId:    r.student_id,
          studentName:  student?.name ?? '—',
          sessionDate:  sess?.session_date ?? date,
          sessionTime:  sess?.time ?? '',
          tutorName:    tutor?.name ?? '—',
          studentEmail:  student?.email ?? null,
          momEmail:      student?.mom_email ?? null,
          dadEmail:      student?.dad_email ?? null,
          notifyStudent: student?.notify_student ?? true,
          notifyMom:     student?.notify_mom ?? true,
          notifyDad:     student?.notify_dad ?? true,
          reminderSent:  !!r.reminder_sent,
        };
      }).sort((a: Candidate, b: Candidate) => a.sessionTime.localeCompare(b.sessionTime) || a.studentName.localeCompare(b.studentName));

      setCandidates(rows);
      setSelected(new Set(rows.filter((r: Candidate) =>
        !r.reminderSent &&
        ((r.studentEmail && r.notifyStudent) || (r.momEmail && r.notifyMom) || (r.dadEmail && r.notifyDad))
      ).map((r: Candidate) => r.rowId)));
    } catch (e: any) {
      console.error('Failed to load candidates:', e);
      setCandidates([]);
    }

    setLoadingCandidates(false);
  }, []);

  useEffect(() => {
    fetchSettings(); fetchLogs(); fetchTerms(); fetchBlastRecipients();
    withCenter(supabase.from(DB.tutors).select('id, name, email').order('name'))
      .then(({ data }: { data: any[] | null }) => {
        setTutorsWithEmail(((data ?? []) as any[]).filter((t: any) => !!t.email).map((t: any) => ({ id: t.id, name: t.name, email: t.email })));
      })
      .catch(() => {});
  }, [fetchSettings, fetchLogs, fetchTerms, fetchBlastRecipients]);
  useEffect(() => { fetchCandidates(dispatchDate); }, [dispatchDate, fetchCandidates]);
  useEffect(() => { void fetchStudentSchedLogs(studentSchedTermId); }, [studentSchedTermId, fetchStudentSchedLogs]);
  useEffect(() => { void fetchTutorSchedLogs(); }, [fetchTutorSchedLogs]);

  useEffect(() => {
    withCenter(supabase
      .from(DB.terms)
      .select('id, name, status, session_times_by_day'))
      .order('start_date', { ascending: false })
      .then(({ data }: { data: SpTermRow[] | null }) => {
        const rows = (data ?? []) as SpTermRow[]
        setSpTerms(rows)
        const active = rows.find(t => t.status === 'active') ?? rows[0]
        if (active) setSpSelectedTermId(active.id)
      })
  }, [])

  useEffect(() => {
    if (!spSelectedTermId) return
    setSpLoading(true)
    setSpProposal(null)
    Promise.all([
      withCenter(supabase.from(DB.students).select('id, name, subjects').order('name')),
      withCenter(supabase.from(DB.termEnrollments).select('student_id, slot_preferences, subjects').eq('term_id', spSelectedTermId)),
    ]).then(([stuRes, enrRes]) => {
      setSpStudents((stuRes.data ?? []) as SpStudentRow[])
      setSpEnrollments((enrRes.data ?? []) as SpEnrollmentRow[])
      setSpLoading(false)
    })
  }, [spSelectedTermId])

  useEffect(() => {
    if (cronFetchedRef.current) return
    cronFetchedRef.current = true
    let cancelled = false
    setCronLoading(true)
    Promise.all([
      fetch('/api/cron-config').then(r => r.json()),
      fetch('/api/cron-config?history').then(r => r.json()),
    ]).then(([jobRes, histRes]) => {
      if (cancelled) return
      if (jobRes?.error === 'CRONJOB_ORG_API_KEY or CRONJOB_ORG_JOB_ID is not configured') {
        setCronConfigured(false)
        return
      }
      setCronConfigured(true)
      const details: CronJob = jobRes?.jobDetails ?? null
      if (details) {
        setCronJob(details)
        const h = Array.isArray(details.schedule?.hours) && details.schedule.hours[0] !== -1 ? details.schedule.hours[0] : 7
        const m = Array.isArray(details.schedule?.minutes) && details.schedule.minutes[0] !== -1 ? details.schedule.minutes[0] : 0
        setReminderTime(`${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`)
      }
      setCronHistory(Array.isArray(histRes?.history) ? histRes.history.slice(0, 8) : [])
    }).catch(() => { if (!cancelled) setCronConfigured(false) })
      .finally(() => { if (!cancelled) setCronLoading(false) })
    return () => { cancelled = true }
  }, [])

  const saveReminderTime = async () => {
    const [hStr, mStr] = reminderTime.split(':')
    const h = parseInt(hStr, 10)
    const m = parseInt(mStr, 10)
    const timezone = cronJob?.schedule?.timezone || Intl.DateTimeFormat().resolvedOptions().timeZone || DEFAULT_REMINDER_TIMEZONE
    setCronSaving(true)
    try {
      const res = await fetch('/api/cron-config', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ schedule: { hours: [h], minutes: [m], wdays: [-1], timezone } }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data?.error ?? 'Failed to save')
      const updated = await fetch('/api/cron-config').then(r => r.json())
      if (updated?.jobDetails) setCronJob(updated.jobDetails)
      logEvent('auto_reminder_time_saved', { time: reminderTime })
    } catch (err) {
      console.error('saveReminderTime', err)
    } finally {
      setCronSaving(false)
    }
  }

  const toggleCronEnabled = async () => {
    if (!cronJob) return
    setCronSaving(true)
    try {
      const res = await fetch('/api/cron-config', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ enabled: !cronJob.enabled }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data?.error ?? 'Failed')
      const updated = await fetch('/api/cron-config').then(r => r.json())
      if (updated?.jobDetails) setCronJob(updated.jobDetails)
      logEvent('auto_reminder_toggled', { enabled: !cronJob.enabled })
    } catch (err) {
      console.error('toggleCronEnabled', err)
    } finally {
      setCronSaving(false)
    }
  }

  // ── Tutor schedule cron fetch ───────────────────────────────────────────────
  const fetchTutorCron = useCallback(() => {
    if (tutorCronFetchedRef.current) return
    tutorCronFetchedRef.current = true
    const load = async (type: 'tutor-weekly' | 'tutor-daily') => {
      const setLoading  = type === 'tutor-weekly' ? setTutorWeeklyCronLoading  : setTutorDailyCronLoading
      const setConfigured = type === 'tutor-weekly' ? setTutorWeeklyCronConfigured : setTutorDailyCronConfigured
      const setJob      = type === 'tutor-weekly' ? setTutorWeeklyCronJob      : setTutorDailyCronJob
      const setHistory  = type === 'tutor-weekly' ? setTutorWeeklyCronHistory  : setTutorDailyCronHistory
      const setTime     = type === 'tutor-weekly' ? setTutorWeeklyTime          : setTutorDailyTime
      setLoading(true)
      try {
        const [jobRes, histRes] = await Promise.all([
          fetch(`/api/cron-config?type=${type}`).then(r => r.json()),
          fetch(`/api/cron-config?type=${type}&history`).then(r => r.json()),
        ])
        if (jobRes?.error?.includes('is not configured')) { setConfigured(false); return }
        setConfigured(true)
        const details: CronJob = jobRes?.jobDetails ?? null
        if (details) {
          setJob(details)
          const h = Array.isArray(details.schedule?.hours) && details.schedule.hours[0] !== -1 ? details.schedule.hours[0] : 7
          const m = Array.isArray(details.schedule?.minutes) && details.schedule.minutes[0] !== -1 ? details.schedule.minutes[0] : 0
          setTime(`${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`)
        }
        setHistory(Array.isArray(histRes?.history) ? histRes.history.slice(0, 8) : [])
      } catch { setConfigured(false) }
      finally { setLoading(false) }
    }
    load('tutor-weekly')
    load('tutor-daily')
  }, [])

  const saveTutorCronTime = async (type: 'tutor-weekly' | 'tutor-daily') => {
    const time     = type === 'tutor-weekly' ? tutorWeeklyTime : tutorDailyTime
    const cronJob  = type === 'tutor-weekly' ? tutorWeeklyCronJob : tutorDailyCronJob
    const setSaving = type === 'tutor-weekly' ? setTutorWeeklyCronSaving : setTutorDailyCronSaving
    const setJob   = type === 'tutor-weekly' ? setTutorWeeklyCronJob : setTutorDailyCronJob
    const [hStr, mStr] = time.split(':')
    const h = parseInt(hStr, 10)
    const m = parseInt(mStr, 10)
    const timezone = cronJob?.schedule?.timezone || Intl.DateTimeFormat().resolvedOptions().timeZone || DEFAULT_REMINDER_TIMEZONE
    setSaving(true)
    try {
      const res = await fetch(`/api/cron-config?type=${type}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ schedule: { hours: [h], minutes: [m], wdays: [-1], timezone } }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data?.error ?? 'Failed to save')
      const updated = await fetch(`/api/cron-config?type=${type}`).then(r => r.json())
      if (updated?.jobDetails) setJob(updated.jobDetails)
      logEvent('tutor_schedule_cron_time_saved', { type, time })
    } catch (err) {
      console.error('saveTutorCronTime', err)
    } finally {
      setSaving(false)
    }
  }

  const toggleTutorCronEnabled = async (type: 'tutor-weekly' | 'tutor-daily') => {
    const cronJob   = type === 'tutor-weekly' ? tutorWeeklyCronJob : tutorDailyCronJob
    const setSaving = type === 'tutor-weekly' ? setTutorWeeklyCronSaving : setTutorDailyCronSaving
    const setJob    = type === 'tutor-weekly' ? setTutorWeeklyCronJob : setTutorDailyCronJob
    if (!cronJob) return
    setSaving(true)
    try {
      const res = await fetch(`/api/cron-config?type=${type}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ enabled: !cronJob.enabled }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data?.error ?? 'Failed')
      const updated = await fetch(`/api/cron-config?type=${type}`).then(r => r.json())
      if (updated?.jobDetails) setJob(updated.jobDetails)
      logEvent('tutor_schedule_cron_toggled', { type, enabled: !cronJob.enabled })
    } catch (err) {
      console.error('toggleTutorCronEnabled', err)
    } finally {
      setSaving(false)
    }
  }

  const handleSendStudentSchedules = async () => {
    setStudentSchedSending(true);
    setStudentSchedResult(null);
    try {
      const res = await fetch('/api/send-student-schedule', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ studentIds: [...studentSchedSelected], termId: studentSchedTermId }),
      });
      const data = await res.json();
      if (!res.ok) setStudentSchedResult({ sent: 0, failed: studentSchedSelected.size, errors: [data.error ?? 'Request failed'] });
      else { setStudentSchedResult(data); setStudentSchedConfirm(false); logEvent('student_schedules_sent', { sent: data.sent ?? 0 }); void fetchStudentSchedLogs(studentSchedTermId); }
    } catch (e: any) {
      setStudentSchedResult({ sent: 0, failed: 0, errors: [e?.message ?? 'Unknown error'] });
    } finally {
      setStudentSchedSending(false);
    }
  };

  const handleSendTutorSchedules = async () => {
    setTutorSchedSending(true);
    setTutorSchedResult(null);
    try {
      const res = await fetch('/api/send-tutor-schedule', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tutorIds: tutorsWithEmail.map(t => t.id), mode: tutorSchedMode, date: tutorSchedMode === 'weekly' ? tutorSchedWeek : tutorSchedDay }),
      });
      const data = await res.json();
      if (!res.ok) setTutorSchedResult({ sent: 0, failed: tutorsWithEmail.length, errors: [data.error ?? 'Request failed'] });
      else { setTutorSchedResult(data); logEvent('tutor_schedules_sent', { sent: data.sent ?? 0 }); void fetchTutorSchedLogs(); }
    } catch (e: any) {
      setTutorSchedResult({ sent: 0, failed: 0, errors: [e?.message ?? 'Unknown error'] });
    } finally {
      setTutorSchedSending(false);
    }
  };

  const saveTemplate = async () => {
    if (!settings) return;
    setSavingTemplate(true);
    const { error } = await withCenter(
      supabase
        .from(DB.centerSettings)
        .update({ reminder_subject: draftSubject, reminder_body: draftBody })
    )
      .eq('center_name', settings.center_name);
    if (error) {
      setSettingsError(formatSettingsError(error.message));
      setSavingTemplate(false);
      return;
    }
    setSettings(s => s ? { ...s, reminder_subject: draftSubject, reminder_body: draftBody } : s);
    setSavingTemplate(false); setTemplateSaved(true); setEditingTemplate(false);
    logEvent('template_saved', {});
    setTimeout(() => setTemplateSaved(false), 3000);
  };

  const cancelEdit = () => {
    setDraftSubject(settings?.reminder_subject ?? '');
    setDraftBody(settings?.reminder_body ?? '');
    setEditingTemplate(false);
  };

  const selectableIds = candidates.filter(c => !c.reminderSent && (c.studentEmail || c.momEmail || c.dadEmail)).map(c => c.rowId);
  const allChecked  = selectableIds.length > 0 && selectableIds.every(id => selected.has(id));
  const someChecked = selectableIds.some(id => selected.has(id));

  const toggle = (id: string) => setSelected(prev => {
    const next = new Set(prev); next.has(id) ? next.delete(id) : next.add(id); return next;
  });
  const toggleAll = () => {
    setConfirmSend(false);
    setSelected(allChecked ? new Set() : new Set(selectableIds));
  };
  const toggleWithConfirmReset = (id: string) => {
    setConfirmSend(false);
    toggle(id);
  };

  const handleSend = async () => {
    if (selected.size === 0) return;
    if (!confirmSend) {
      setConfirmSend(true);
      setTimeout(() => setConfirmSend(false), 3500);
      return;
    }
    setSending(true); setSendResult(null);
    setConfirmSend(false);
    try {
      const res = await fetch('/api/cron/reminders', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          manual: true,
          sessionStudentIds: [...selected],
          baseUrl: window.location.origin,
        }),
      });
      const data = await res.json();
      if (data.error) {
        setSendResult({ sent: 0, failed: selected.size, errors: [data.error] });
      } else {
        setSendResult({
          sent: data.sent ?? 0,
          failed: data.failed ?? 0,
          errors: data.errors ?? [],
          mode: data.mode,
          redirectedTo: data.redirectedTo ?? null,
          skipped: !!data.skipped,
          reason: data.reason,
          details: data.details ?? [],
        });
        logEvent('reminder_sent', { sent: data.sent ?? 0, failed: data.failed ?? 0, date: dispatchDate });
        await Promise.all([fetchCandidates(dispatchDate), fetchLogs()]);
      }
    } catch (e: any) {
      setSendResult({ sent: 0, failed: selected.size, errors: [e.message ?? 'Request failed'] });
    }
    setSending(false);
  };

  // Blast helpers
  const blastSelectableIds = blastRecipients.map(r => r.studentId);
  const blastAllChecked  = blastSelectableIds.length > 0 && blastSelectableIds.every(id => blastSelected.has(id));
  const blastSomeChecked = blastSelectableIds.some(id => blastSelected.has(id));

  const toggleBlast = (id: string) => setBlastSelected(prev => {
    const next = new Set(prev); next.has(id) ? next.delete(id) : next.add(id); return next;
  });
  const toggleBlastAll = () => {
    setBlastConfirm(false);
    setBlastSelected(blastAllChecked ? new Set() : new Set(blastSelectableIds));
  };

  const handleBlastSend = async () => {
    if (blastSelected.size === 0 || !blastTermId) return;
    if (!blastConfirm) {
      setBlastConfirm(true);
      setTimeout(() => setBlastConfirm(false), 3500);
      return;
    }
    setBlastSending(true);
    setBlastResult(null);
    setBlastConfirm(false);
    try {
      const res = await fetch('/api/announce', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          studentIds: [...blastSelected],
          termId: blastTermId,
          subject: blastSubject,
          body: blastBody,
          baseUrl: window.location.origin,
        }),
      });
      const data = await res.json();
      if (data.error) {
        setBlastResult({ sent: 0, failed: blastSelected.size, errors: [data.error] });
      } else {
        setBlastResult({
          sent: data.sent ?? 0,
          failed: data.failed ?? 0,
          errors: data.errors ?? [],
          mode: data.mode,
          redirectedTo: data.redirectedTo ?? null,
          details: data.details ?? [],
        });
        logEvent('reminder_sent', { sent: data.sent ?? 0, termId: blastTermId });
        logEvent('blast_sent', { type: 'availability', sent: data.sent ?? 0, termId: blastTermId });
      }
    } catch (e: any) {
      setBlastResult({ sent: 0, failed: blastSelected.size, errors: [e.message ?? 'Request failed'] });
    }
    setBlastSending(false);
  };

  const handleGeneralSend = async () => {
    if (generalSelected.size === 0) return;
    if (!generalConfirm) {
      setGeneralConfirm(true);
      setTimeout(() => setGeneralConfirm(false), 3500);
      return;
    }
    setGeneralSending(true);
    setGeneralResult(null);
    setGeneralConfirm(false);
    try {
      const res = await fetch('/api/announce', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          studentIds: [...generalSelected],
          subject: generalSubject,
          body: generalBody,
          baseUrl: window.location.origin,
        }),
      });
      const data = await res.json();
      if (data.error) {
        setGeneralResult({ sent: 0, failed: generalSelected.size, errors: [data.error] });
      } else {
        setGeneralResult({
          sent: data.sent ?? 0,
          failed: data.failed ?? 0,
          errors: data.errors ?? [],
          mode: data.mode,
          redirectedTo: data.redirectedTo ?? null,
          details: data.details ?? [],
        });
        logEvent('reminder_sent', { sent: data.sent ?? 0 });
        logEvent('blast_sent', { type: 'general', sent: data.sent ?? 0 });
      }
    } catch (e: any) {
      setGeneralResult({ sent: 0, failed: generalSelected.size, errors: [e.message ?? 'Request failed'] });
    }
    setGeneralSending(false);
  };

  const selectedBlastTerm = terms.find(t => t.id === blastTermId);
  const blastLinkPreview = typeof window !== 'undefined'
    ? `${window.location.origin}/enroll?token=preview-token`
    : `https://example.com/enroll?token=preview-token`;

  const groupedLogs = logs.reduce<Record<string, Log[]>>((acc, log) => {
    const key = log.session_date;
    if (!acc[key]) acc[key] = [];
    acc[key].push(log);
    return acc;
  }, {});

  const previewCandidate = candidates[0];
  const previewValues = {
    name: previewCandidate?.studentName ?? 'Alex Student',
    date: previewCandidate?.sessionDate ?? dispatchDate,
    time: previewCandidate?.sessionTime ?? '16:30',
    link: typeof window !== 'undefined' ? `${window.location.origin}/confirm?token=preview-token` : 'https://example.com/confirm?token=preview-token',
    term: '',
    center: '',
  };
  const previewSubject = applyTemplate(draftSubject || DEFAULT_SETTINGS.reminder_subject, previewValues);
  const previewBody = applyTemplate(draftBody || DEFAULT_SETTINGS.reminder_body, previewValues);

  const openAvailabilityPreview = () => {
    setPreviewLoading(false);
    const sampleName = blastRecipients[0]?.studentName ?? 'Alex Student';
    const sampleLink = blastTermId
      ? blastLinkPreview
      : (typeof window !== 'undefined' ? `${window.location.origin}/enroll?token=preview-token` : 'https://example.com/enroll?token=preview-token');
    const sampleCenter = settings?.center_name ?? DEFAULT_SETTINGS.center_name;
    const sampleTerm = selectedBlastTerm?.name ?? '';
    const subject = applyTemplate(blastSubject || '', {
      name: sampleName,
      link: sampleLink,
      term: sampleTerm,
      center: sampleCenter,
    });
    const body = applyTemplate(blastBody || '', {
      name: sampleName,
      link: sampleLink,
      term: sampleTerm,
      center: sampleCenter,
    });
    setPreviewModal({
      title: 'Availability Email Preview',
      subject,
      html: buildPreviewFrameHtml(subject, buildAnnouncementHtml(sampleCenter, body, blastTermId ? sampleLink : '', settings?.center_phone)),
      note: `Previewing ${sampleName}${sampleTerm ? ` for ${sampleTerm}` : ''}.`,
    });
  };

  const openAvailabilityFormPreview = () => {
    setPreviewLoading(false);
    const termName = selectedBlastTerm?.name ?? 'Upcoming term';
    const previewUrl = `/enroll?preview=1&term=${encodeURIComponent(termName)}`;
    setPreviewModal({
      title: 'Availability Form Preview',
      subject: '',
      html: '',
      url: previewUrl,
      note: `Showing the same enrollment form flow used from Students (${termName}).`,
    });
  };

  const openGeneralPreview = () => {
    setPreviewLoading(false);
    const sampleName = blastRecipients[0]?.studentName ?? 'Alex Student';
    const sampleCenter = settings?.center_name ?? DEFAULT_SETTINGS.center_name;
    const subject = applyTemplate(generalSubject || '', {
      name: sampleName,
      link: '',
      term: '',
      center: sampleCenter,
    });
    const body = applyTemplate(generalBody || '', {
      name: sampleName,
      link: '',
      term: '',
      center: sampleCenter,
    });
    setPreviewModal({
      title: 'General Email Preview',
      subject,
      html: buildPreviewFrameHtml(subject, buildAnnouncementHtml(sampleCenter, body, '', settings?.center_phone)),
      note: `Previewing ${sampleName}.`,
    });
  };

  const openTutorSchedulePreview = async () => {
    const previewTutor = tutorsWithEmail[0];
    const isDaily = tutorSchedMode === 'daily';
    const fromDate = isDaily ? tutorSchedDay : tutorSchedWeek;
    const toDate = isDaily ? fromDate : addDaysIso(fromDate, 6);
    const periodLabel = isDaily
      ? fmtDate(fromDate)
      : (() => {
          const startFmt = new Date(`${fromDate}T00:00:00`).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
          const endFmt = new Date(`${toDate}T00:00:00`).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
          return `Week of ${startFmt}–${endFmt}`;
        })();
    const centerName = settings?.center_name ?? DEFAULT_SETTINGS.center_name;
    const previewTitle = isDaily ? 'Tutor Daily Schedule Preview' : 'Tutor Weekly Schedule Preview';
    const subjectLine = isDaily ? `Your schedule for ${periodLabel}` : `Your weekly schedule — ${periodLabel}`;

    // Dummy schedule used when real data is unavailable or empty
    const buildDummySchedule = (): ScheduleEntry[] => isDaily
      ? [
          { date: fromDate, time: '15:00', students: [{ name: 'Alex Johnson', topic: 'Algebra II' }, { name: 'Maya Patel', topic: 'Pre-Calc' }] },
          { date: fromDate, time: '16:30', students: [{ name: 'Ethan Williams', topic: 'SAT Math' }] },
        ]
      : [
          { date: addDaysIso(fromDate, 1), time: '15:00', students: [{ name: 'Alex Johnson', topic: 'Algebra II' }, { name: 'Maya Patel', topic: 'Pre-Calc' }] },
          { date: addDaysIso(fromDate, 1), time: '16:30', students: [{ name: 'Ethan Williams', topic: 'SAT Math' }] },
          { date: addDaysIso(fromDate, 3), time: '14:00', students: [{ name: 'Sofia Chen', topic: 'Geometry' }, { name: 'Liam Brown', topic: 'Statistics' }] },
          { date: addDaysIso(fromDate, 3), time: '17:00', students: [{ name: 'Noah Davis', topic: 'Calculus' }] },
          { date: addDaysIso(fromDate, 5), time: '15:30', students: [{ name: 'Emma Wilson', topic: 'Pre-Calc' }, { name: 'Oliver Moore', topic: 'Algebra II' }] },
        ];

    if (!previewTutor) {
      const dummySchedule = buildDummySchedule();
      const html = buildScheduleHtml(centerName, 'Sample Tutor', dummySchedule, periodLabel, settings?.center_phone);
      setPreviewModal({
        title: previewTitle,
        subject: subjectLine,
        html: buildPreviewFrameHtml(subjectLine, html),
        note: 'Sample preview — add a tutor email to preview a real schedule.',
      });
      return;
    }

    setPreviewLoading(true);
    try {
      const { data, error } = await (withCenter(
        supabase
          .from(DB.sessions)
          .select(`id, session_date, time, tutor_id, ${DB.sessionStudents}(id, name, topic, status)`)
          .eq('tutor_id', previewTutor.id)
          .gte('session_date', fromDate)
          .lte('session_date', toDate)
      ) as any);

      if (error) throw error;

      const schedule: ScheduleEntry[] = (data ?? []).map((session: any) => {
        const sessionStudents = Array.isArray(session[DB.sessionStudents]) ? session[DB.sessionStudents] : [];
        return {
          date: session.session_date,
          time: session.time,
          students: sessionStudents
            .filter((student: any) => student.status !== 'cancelled')
            .map((student: any) => ({
              name: student.name ?? '—',
              topic: student.topic ?? '',
            })),
        };
      });

      const displaySchedule = schedule.length > 0 ? schedule : buildDummySchedule();
      const isDummy = schedule.length === 0;

      const html = buildScheduleHtml(centerName, previewTutor.name ?? 'Tutor', displaySchedule, periodLabel, settings?.center_phone);
      setPreviewModal({
        title: previewTitle,
        subject: subjectLine,
        html: buildPreviewFrameHtml(subjectLine, html),
        note: isDummy
          ? `Sample preview for ${previewTutor.name ?? 'Tutor'} — no real sessions found for ${periodLabel}.`
          : `Previewing ${previewTutor.name ?? 'Tutor'} for ${periodLabel}.`,
      });
    } catch (error: any) {
      setPreviewModal({
        title: previewTitle,
        subject: 'Preview unavailable',
        html: buildPreviewFrameHtml('Preview unavailable', `<div style="padding:32px;font-family:ui-sans-serif,system-ui,sans-serif;color:#991b1b;background:#fff;">${error?.message ?? 'Failed to load preview.'}</div>`),
        note: error?.message ?? 'Failed to load preview.',
      });
    } finally {
      setPreviewLoading(false);
    }
  };

  const openStudentSchedulePreview = async () => {
    const previewStudent = blastRecipients[0];
    const centerName = settings?.center_name ?? DEFAULT_SETTINGS.center_name;
    const previewTerm = terms.find(t => t.id === studentSchedTermId);
    const termName = previewTerm?.name ?? 'Selected Term';
    const subject = `Your tutoring schedule for ${termName}`;

    const buildDummySeries = (): StudentSeriesRow[] => [
      { day_of_week: 1, time: '15:00', topic: 'Algebra II',  start_date: previewTerm?.start_date ?? toISODate(new Date()), end_date: previewTerm?.end_date ?? toISODate(new Date()), tutor_name: 'Sample Tutor' },
      { day_of_week: 3, time: '16:30', topic: 'SAT Math',    start_date: previewTerm?.start_date ?? toISODate(new Date()), end_date: previewTerm?.end_date ?? toISODate(new Date()), tutor_name: 'Sample Tutor' },
      { day_of_week: 5, time: '14:00', topic: 'Pre-Calculus', start_date: previewTerm?.start_date ?? toISODate(new Date()), end_date: previewTerm?.end_date ?? toISODate(new Date()), tutor_name: 'Sample Tutor' },
    ];

    if (!previewStudent || !studentSchedTermId) {
      const html = buildStudentScheduleHtml(centerName, previewStudent?.studentName ?? 'Sample Student', termName, buildDummySeries(), settings?.center_phone);
      setPreviewModal({
        title: 'Student Schedule Email Preview',
        subject,
        html: buildPreviewFrameHtml(subject, html),
        note: studentSchedTermId ? 'Sample preview — no students found.' : 'Sample preview — select a term to see real data.',
      });
      return;
    }

    setPreviewLoading(true);
    try {
      const term = previewTerm;
      const { data: seriesData, error: seriesError } = await (withCenter(
        supabase
          .from(DB.recurringSeries)
          .select('day_of_week, time, topic, start_date, end_date, tutor_id')
          .eq('student_id', previewStudent.studentId)
          .eq('status', 'active')
          .lte('start_date', term?.end_date ?? '9999-12-31')
          .gte('end_date',   term?.start_date ?? '0000-01-01')
      ) as any);
      if (seriesError) throw seriesError;

      const tutorIds = [...new Set((seriesData ?? []).map((s: any) => s.tutor_id as string))];
      let tutorMap: Record<string, string> = {};
      if (tutorIds.length > 0) {
        const { data: tutorData } = await (withCenter(
          supabase.from(DB.tutors).select('id, name').in('id', tutorIds)
        ) as any);
        for (const t of tutorData ?? []) tutorMap[t.id] = t.name ?? '—';
      }

      const series: StudentSeriesRow[] = (seriesData ?? []).map((s: any) => ({
        day_of_week: s.day_of_week,
        time: s.time,
        topic: s.topic ?? '',
        start_date: s.start_date,
        end_date: s.end_date,
        tutor_name: tutorMap[s.tutor_id] ?? '—',
      }));

      const displaySeries = series.length > 0 ? series : buildDummySeries();
      const isDummy = series.length === 0;
      const html = buildStudentScheduleHtml(centerName, previewStudent.studentName, termName, displaySeries, settings?.center_phone);
      setPreviewModal({
        title: 'Student Schedule Email Preview',
        subject,
        html: buildPreviewFrameHtml(subject, html),
        note: isDummy
          ? `Sample preview for ${previewStudent.studentName} — no active recurring series found for ${termName}.`
          : `Previewing ${previewStudent.studentName} for ${termName}.`,
      });
    } catch (err: any) {
      setPreviewModal({
        title: 'Student Schedule Email Preview',
        subject: 'Preview unavailable',
        html: buildPreviewFrameHtml('Preview unavailable', `<div style="padding:32px;font-family:ui-sans-serif,system-ui,sans-serif;color:#991b1b;background:#fff;">${err?.message ?? 'Failed to load preview.'}</div>`),
        note: err?.message ?? 'Failed to load preview.',
      });
    } finally {
      setPreviewLoading(false);
    }
  };

  // Survey derived state
  const spSelectedTerm = useMemo(() => spTerms.find(t => t.id === spSelectedTermId) ?? null, [spTerms, spSelectedTermId])
  const spSessionTimesByDay = useMemo(() => spSelectedTerm?.session_times_by_day ?? {}, [spSelectedTerm])
  const spEnrollmentMap = useMemo(() => {
    const m: Record<string, SpEnrollmentRow> = {}
    for (const e of spEnrollments) m[e.student_id] = e
    return m
  }, [spEnrollments])
  const spEnrolledStudents = useMemo(() => spStudents.filter(s => spEnrollmentMap[s.id] !== undefined), [spStudents, spEnrollmentMap])
  const spFilteredStudents = useMemo(() => {
    const q = spSearch.toLowerCase()
    return q ? spEnrolledStudents.filter(s => s.name.toLowerCase().includes(q)) : spEnrolledStudents
  }, [spEnrolledStudents, spSearch])
  const spPrefCount = spEnrolledStudents.filter(s => (spEnrollmentMap[s.id]?.slot_preferences?.length ?? 0) > 0).length

  function handleSpSave(studentId: string, prefs: SlotPreferences) {
    setSpEnrollments(prev => prev.map(e => e.student_id === studentId ? { ...e, slot_preferences: prefs } : e))
  }
  async function spRunScheduler() {
    if (!spSelectedTermId) return
    setSpRunning(true); setSpRunError(null); setSpProposal(null)
    try {
      const res = await fetch('/api/slot-scheduler', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ termId: spSelectedTermId }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error ?? 'Scheduler failed')
      setSpProposal(data)
    } catch (e: any) {
      setSpRunError(e.message ?? 'Unexpected error')
    } finally {
      setSpRunning(false)
    }
  }

  const [activeTab, setActiveTab] = useState<'reminders' | 'availability' | 'general' | 'tutor' | 'student' | 'history'>('reminders');

  useEffect(() => {
    if (activeTab === 'tutor') fetchTutorCron()
  }, [activeTab, fetchTutorCron])

  const openReminderPreview = () => {
    setPreviewLoading(false);
    const sampleCandidate = candidates[0];
    const sampleName = sampleCandidate?.studentName ?? 'Alex Student';
    const sampleDate = sampleCandidate?.sessionDate ?? dispatchDate;
    const sampleTime = sampleCandidate?.sessionTime ?? '16:30';
    const sampleLink = typeof window !== 'undefined' ? `${window.location.origin}/confirm?token=preview-token` : 'https://example.com/confirm?token=preview-token';
    const sampleSettings: Settings = {
      center_name: settings?.center_name ?? DEFAULT_SETTINGS.center_name,
      center_email: settings?.center_email ?? DEFAULT_SETTINGS.center_email,
      center_phone: settings?.center_phone ?? DEFAULT_SETTINGS.center_phone,
      reminder_subject: draftSubject || settings?.reminder_subject || DEFAULT_SETTINGS.reminder_subject,
      reminder_body: draftBody || settings?.reminder_body || DEFAULT_SETTINGS.reminder_body,
    };
    const subject = applyTemplate(sampleSettings.reminder_subject, {
      name: sampleName,
      date: sampleDate,
      time: sampleTime,
      link: sampleLink,
    });
    const html = buildReminderStudentHtml(sampleSettings, sampleName, sampleDate, sampleTime, sampleLink);
    setPreviewModal({
      title: 'Reminder Email Preview',
      subject,
      html: buildPreviewFrameHtml(subject, html),
      note: `Previewing ${sampleName} for ${sampleDate} at ${sampleTime}.`,
    });
  };

  return (
    <div className="min-h-screen bg-slate-50">
      <div className="mx-auto max-w-5xl px-6 py-8">

        {/* ── Page header ─────────────────────────────────────────────────── */}
        <div className="mb-6">
          <h1 className="text-2xl font-bold text-slate-900">Notifications</h1>
          <p className="mt-1 text-sm text-slate-500">Email tools for students and tutors</p>
        </div>

        {/* ── Tab bar ─────────────────────────────────────────────────────── */}
        <div className="mb-6 flex gap-1 overflow-x-auto border-b border-slate-200 pb-0">
          {([
            { id: 'reminders',    label: 'Reminders' },
            { id: 'availability', label: 'Availability' },
            { id: 'general',      label: 'General Blast' },
            { id: 'tutor',        label: 'Tutor Schedules' },
            { id: 'student',      label: 'Student Schedules' },
            { id: 'history',      label: 'Send History', badge: logs.length || null },
          ] as const).map(item => (
            <button
              key={item.id}
              onClick={() => setActiveTab(item.id)}
              className={`relative flex shrink-0 items-center gap-1.5 px-4 py-2.5 text-sm font-semibold transition-colors focus:outline-none ${
                activeTab === item.id
                  ? 'text-slate-900 after:absolute after:bottom-0 after:left-0 after:right-0 after:h-0.5 after:rounded-t after:bg-slate-900'
                  : 'text-slate-500 hover:text-slate-700'
              }`}
            >
              {item.label}
              {'badge' in item && item.badge ? (
                <span className="rounded-full bg-slate-200 px-1.5 py-0.5 text-[10px] font-bold text-slate-600">{item.badge}</span>
              ) : null}
            </button>
          ))}
        </div>

        {/* ── Panel content ───────────────────────────────────────────────── */}
        <div>

        {/* ── REMINDERS ─────────────────────────────────────────────────── */}
        {activeTab === 'reminders' && (
          <div className="space-y-4">

            {/* Controls row */}
            <div className="flex flex-wrap items-end gap-3 rounded-xl border border-slate-200 bg-slate-50 p-4">
              <div>
                <label className="mb-1 block text-xs font-semibold text-slate-600">Session date</label>
                <div className="flex items-center gap-1.5 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2">
                  <Calendar size={12} className="text-slate-400" />
                  <input
                    type="date"
                    value={dispatchDate}
                    onChange={e => setDispatchDate(e.target.value)}
                    className="bg-transparent text-sm text-slate-800 outline-none"
                  />
                </div>
              </div>
            </div>

            {/* Result banner */}
            {sendResult && (
              <ResultBanner
                sent={sendResult.sent}
                failed={sendResult.failed}
                errors={sendResult.errors}
                mode={sendResult.mode}
                redirectedTo={sendResult.redirectedTo}
                skipped={sendResult.skipped}
                reason={sendResult.reason}
                details={sendResult.details}
              />
            )}

            {/* Auto-active warning */}
            {cronConfigured && cronJob?.enabled && (
              <div className="flex items-start gap-3 rounded-xl border border-amber-300 bg-amber-50 px-4 py-3">
                <AlertCircle size={15} className="mt-0.5 shrink-0 text-amber-600" />
                <div className="min-w-0">
                  <p className="text-xs font-bold text-amber-800">Auto reminders are active</p>
                  <p className="mt-0.5 text-[11px] text-amber-700">
                    Reminders go out automatically every day
                    {cronJob.schedule?.hours?.length === 1
                      ? ` at ${cronJob.schedule.hours[0]}:${String(cronJob.schedule?.minutes?.[0] ?? 0).padStart(2, '0')} (${cronJob.schedule.timezone ?? 'CT'})`
                      : ''}
                    {' — '}will send for sessions on <span className="font-bold">{tomorrow()}</span>.
                    Use the manual send below only for one-off cases.
                  </p>
                </div>
              </div>
            )}

            {/* Candidate list */}
            <div className={`overflow-hidden rounded-xl border bg-white ${cronConfigured && cronJob?.enabled ? 'border-amber-200' : 'border-slate-200'}`}>
              <div className={`flex items-center justify-between border-b px-4 py-3 ${cronConfigured && cronJob?.enabled ? 'border-amber-100 bg-amber-50/60' : 'border-blue-100 bg-linear-to-r from-blue-50 to-white'}`}>
                <div className="flex items-center gap-2">
                  {selectableIds.length > 0 && (
                    <Checkbox checked={allChecked} indeterminate={someChecked && !allChecked} onChange={toggleAll} />
                  )}
                  <span className="text-xs font-semibold text-slate-600">
                    {loadingCandidates ? 'Loading…' : `${candidates.length} student${candidates.length !== 1 ? 's' : ''} on ${dispatchDate}`}
                  </span>
                  {cronConfigured && cronJob?.enabled && (
                    <span className="text-[10px] font-bold uppercase tracking-wide text-amber-600 border border-amber-300 bg-amber-50 rounded px-1.5 py-0.5">Manual override</span>
                  )}
                </div>
                {selected.size > 0 && (
                  <SendButton
                    onClick={handleSend}
                    loading={sending}
                    confirm={confirmSend}
                    count={selected.size}
                    disabled={selected.size === 0 || sending}
                    label="Send reminders"
                  />
                )}
              </div>

              {loadingCandidates ? (
                <LoadingRow label={`Loading sessions for ${dispatchDate}…`} />
              ) : candidates.length === 0 ? (
                <EmptyState icon={<Users size={24} />} label={`No sessions found for ${dispatchDate}`} />
              ) : (
                <ul className="divide-y divide-slate-100 max-h-96 overflow-y-auto">
                  {candidates.map(c => {
                    const noEmail     = !c.studentEmail && !c.momEmail && !c.dadEmail;
                    const allOptedOut = !noEmail &&
                      (!c.studentEmail || !c.notifyStudent) &&
                      (!c.momEmail     || !c.notifyMom) &&
                      (!c.dadEmail     || !c.notifyDad);
                    const isDisabled  = noEmail || allOptedOut || c.reminderSent;
                    const isChecked   = selected.has(c.rowId);
                    return (
                      <li
                        key={c.rowId}
                        className={`flex items-start gap-3 px-4 py-3 transition-colors ${isDisabled ? 'opacity-50' : 'cursor-pointer hover:bg-slate-50'}`}
                        onClick={() => !isDisabled && toggleWithConfirmReset(c.rowId)}
                      >
                        <div className="mt-0.5">
                          <Checkbox checked={isChecked} disabled={isDisabled} onChange={() => !isDisabled && toggleWithConfirmReset(c.rowId)} />
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className="flex flex-wrap items-center gap-1.5">
                            <span className={`text-sm font-semibold ${c.reminderSent ? 'text-slate-400' : 'text-slate-900'}`}>{c.studentName}</span>
                            {c.reminderSent && <StatusBadge color="green" label="Sent" icon={<Check size={8} strokeWidth={3} />} />}
                            {noEmail && <StatusBadge color="gray" label="No email" />}
                            {allOptedOut && !noEmail && <StatusBadge color="amber" label="Opted out" />}
                          </div>
                          <p className="mt-0.5 text-[11px] text-slate-500">
                            {c.sessionTime} · {c.tutorName}
                            {(c.studentEmail || c.momEmail || c.dadEmail) && !c.reminderSent && (
                              <> · <EmailList student={c} /></>
                            )}
                          </p>
                        </div>
                      </li>
                    );
                  })}
                </ul>
              )}

              {!loadingCandidates && candidates.length > 0 && (
                <div className={`border-t px-4 py-3 flex items-center justify-between gap-3 ${cronConfigured && cronJob?.enabled ? 'border-amber-100 bg-amber-50/40' : 'border-slate-100 bg-slate-50'}`}>
                  {cronConfigured && cronJob?.enabled && confirmSend && (
                    <p className="text-[11px] font-semibold text-amber-700">⚠ Auto is on — this may duplicate today&apos;s reminders</p>
                  )}
                  <div className="ml-auto">
                    <SendButton
                      onClick={handleSend}
                      loading={sending}
                      confirm={confirmSend}
                      count={selected.size}
                      disabled={selected.size === 0 || sending}
                      label={cronConfigured && cronJob?.enabled ? 'Send anyway' : 'Send reminders'}
                    />
                  </div>
                </div>
              )}
            </div>

            {/* ── Auto Reminder Schedule ───────────────────────────────────── */}
            <div className="rounded-xl border border-slate-200 bg-white overflow-hidden">
              <div className="border-b border-indigo-100 bg-linear-to-r from-indigo-50 to-white px-4 py-3">
                <p className="text-xs font-bold text-indigo-900 uppercase tracking-wide">Auto Reminder Schedule</p>
                <p className="mt-0.5 text-[11px] text-indigo-400">Reminders send automatically every day at this time.</p>
              </div>
              {cronLoading && cronConfigured === null ? (
                <div className="flex items-center gap-2 px-4 py-3 text-xs text-slate-400">
                  <Loader2 size={12} className="animate-spin" /> Checking reminder status…
                </div>
              ) : cronConfigured === false ? (
                <div className="px-4 py-3 text-xs text-slate-500">
                  Automatic reminders aren&apos;t connected. Configure{' '}
                  <code className="rounded bg-slate-100 px-1">CRONJOB_ORG_API_KEY</code> and{' '}
                  <code className="rounded bg-slate-100 px-1">CRONJOB_ORG_JOB_ID</code> to enable.
                </div>
              ) : cronConfigured ? (
                <div className="space-y-4 p-4">
                  {cronJob && (
                    <div className="flex items-center gap-3">
                      <span className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] font-semibold ${cronJob.enabled ? 'bg-emerald-50 text-emerald-700' : 'bg-slate-100 text-slate-500'}`}>
                        <span className={`h-1.5 w-1.5 rounded-full ${cronJob.enabled ? 'bg-emerald-500' : 'bg-slate-400'}`} />
                        {cronJob.enabled ? 'Auto reminders on' : 'Auto reminders off'}
                      </span>
                      <button
                        onClick={toggleCronEnabled}
                        disabled={cronSaving}
                        className="rounded border border-slate-200 bg-white px-3 py-1 text-xs font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-50"
                      >
                        {cronSaving ? 'Saving…' : cronJob.enabled ? 'Turn off' : 'Turn on'}
                      </button>
                    </div>
                  )}
                  <div className="flex items-end gap-3 flex-wrap">
                    <div>
                      <label className="mb-1 block text-xs font-semibold text-slate-600">Send daily at</label>
                      <input
                        type="time"
                        value={reminderTime}
                        onChange={e => setReminderTime(e.target.value)}
                        className="rounded border border-slate-200 px-3 py-2 text-sm text-slate-800 focus:border-slate-400 outline-none"
                      />
                      <p className="mt-1 text-[11px] text-slate-400">Timezone: {cronJob?.schedule?.timezone || DEFAULT_REMINDER_TIMEZONE}</p>
                    </div>
                    <button
                      onClick={saveReminderTime}
                      disabled={cronSaving}
                      className="mb-5 flex items-center gap-1.5 rounded bg-slate-900 px-3 py-2 text-xs font-semibold text-white hover:bg-slate-700 disabled:opacity-50"
                    >
                      <Save size={11} />
                      {cronSaving ? 'Saving…' : 'Save'}
                    </button>
                  </div>
                  {cronJob && cronJob.nextExecution > 0 && (
                    <p className="text-[11px] text-slate-400">
                      Next send: {new Date(cronJob.nextExecution * 1000).toLocaleString(undefined, { timeZone: cronJob.schedule?.timezone || DEFAULT_REMINDER_TIMEZONE })}
                    </p>
                  )}
                  <p className="text-[11px] text-slate-500">
                    When triggered, sends reminders for sessions on <span className="font-semibold text-slate-700">{tomorrow()}</span>
                  </p>
                  {cronHistory.length > 0 && (
                    <div>
                      <button
                        onClick={() => setCronHistoryExpanded(v => !v)}
                        className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-slate-400 hover:text-slate-600 transition-colors"
                      >
                        <ChevronDown size={11} className={`transition-transform ${cronHistoryExpanded ? 'rotate-180' : ''}`} />
                        Recent sends ({cronHistory.length})
                      </button>
                      {cronHistoryExpanded && (
                        <div className="mt-1.5 overflow-y-auto rounded border border-slate-100 max-h-24">
                          {cronHistory.map((h, i) => (
                            <div key={i} className="flex items-center gap-3 border-b border-slate-50 px-3 py-1 last:border-0 text-xs">
                              <span className={`w-12 shrink-0 rounded-full px-2 py-0.5 text-center font-semibold ${h.status === 1 ? 'bg-emerald-50 text-emerald-700' : 'bg-red-50 text-red-600'}`}>
                                {h.status === 1 ? 'OK' : 'Fail'}
                              </span>
                              <span className="text-slate-500">{new Date(h.date * 1000).toLocaleString()}</span>
                              <span className="ml-auto text-slate-400">{h.duration}ms</span>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  )}
                </div>
              ) : null}
            </div>

            {/* ── Reminder Email Template ───────────────────────────────────── */}
            <div className="rounded-xl border border-slate-200 bg-white overflow-hidden">
              <div className="flex items-center justify-between border-b border-violet-100 bg-linear-to-r from-violet-50 to-white px-4 py-3">
                <p className="text-xs font-bold text-violet-900 uppercase tracking-wide">Email Template</p>
                <div className="flex items-center gap-2">
                  <button onClick={openReminderPreview} className="inline-flex items-center gap-1 rounded-lg border border-slate-200 px-2.5 py-1.5 text-xs font-semibold text-slate-600 hover:bg-slate-50">
                    <Eye size={11} /> Preview
                  </button>
                  {!editingTemplate ? (
                    <button onClick={() => setEditingTemplate(true)} className="inline-flex items-center gap-1 rounded-lg border border-slate-200 px-2.5 py-1.5 text-xs font-semibold text-slate-600 hover:bg-slate-50">
                      <Edit3 size={11} /> Edit
                    </button>
                  ) : (
                    <div className="flex gap-2">
                      <button onClick={cancelEdit} className="inline-flex items-center gap-1 rounded-lg border border-slate-200 px-2.5 py-1.5 text-xs font-semibold text-slate-600 hover:bg-slate-50">
                        <X size={11} /> Cancel
                      </button>
                      <button onClick={saveTemplate} disabled={savingTemplate || loadingSettings || !!settingsError} className="inline-flex items-center gap-1 rounded-lg bg-slate-900 px-2.5 py-1.5 text-xs font-semibold text-white hover:bg-slate-800 disabled:opacity-50">
                        {savingTemplate ? <Loader2 size={11} className="animate-spin" /> : <Save size={11} />} Save
                      </button>
                    </div>
                  )}
                </div>
              </div>
              {settingsError && (
                <div className="mx-4 mt-3 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700 flex items-center gap-2">
                  <AlertCircle size={12} /> {settingsError}
                </div>
              )}
              {templateSaved && (
                <div className="mx-4 mt-3 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs text-emerald-700 flex items-center gap-2">
                  <Check size={12} /> Template saved
                </div>
              )}
              {loadingSettings ? (
                <LoadingRow label="Loading template…" />
              ) : !editingTemplate ? (
                <div className="p-4 space-y-3">
                  <div>
                    <p className="text-[10px] font-bold uppercase tracking-widest text-slate-400 mb-1">Subject</p>
                    <p className="text-sm text-slate-800">{settings?.reminder_subject || DEFAULT_SETTINGS.reminder_subject}</p>
                  </div>
                  <div>
                    <p className="text-[10px] font-bold uppercase tracking-widest text-slate-400 mb-1">Body</p>
                    <p className="whitespace-pre-line text-sm text-slate-600">{settings?.reminder_body || DEFAULT_SETTINGS.reminder_body}</p>
                  </div>
                  <div className="rounded-lg bg-slate-50 border border-slate-200 px-3 py-2">
                    <p className="text-[10px] text-slate-400">Click <strong>Edit</strong> to change. Variables: <code className="text-slate-600">{`{{name}}`}</code> <code className="text-slate-600">{`{{date}}`}</code> <code className="text-slate-600">{`{{time}}`}</code> <code className="text-slate-600">{`{{link}}`}</code></p>
                  </div>
                </div>
              ) : (
                <div className="p-4 space-y-4">
                  <div className="flex flex-wrap gap-1.5">
                    {['{{name}}', '{{date}}', '{{time}}', '{{link}}'].map(v => (
                      <span key={v} className="rounded border border-slate-200 bg-slate-50 px-2 py-0.5 font-mono text-[10px] text-slate-600">{v}</span>
                    ))}
                  </div>
                  <div>
                    <label className="mb-1 block text-xs font-semibold text-slate-700">Subject</label>
                    <input value={draftSubject} onChange={e => setDraftSubject(e.target.value)} className={baseInputCls} />
                  </div>
                  <div>
                    <label className="mb-1 block text-xs font-semibold text-slate-700">Body</label>
                    <textarea value={draftBody} onChange={e => setDraftBody(e.target.value)} rows={8} className={`${baseInputCls} resize-none`} style={{ lineHeight: '1.6' }} />
                  </div>
                  <div className="rounded-lg border border-slate-200 bg-slate-50 p-3 space-y-1">
                    <p className="text-[10px] font-bold uppercase tracking-widest text-slate-500">Live preview</p>
                    <p className="text-xs font-semibold text-slate-800">{previewSubject}</p>
                    <p className="whitespace-pre-line text-xs text-slate-500">{previewBody}</p>
                  </div>
                </div>
              )}
            </div>
          </div>
        )}

        {/* ── AVAILABILITY BLAST ──────────────────────────────────────────── */}
        {activeTab === 'availability' && (
          <div className="space-y-4">

            <div className="grid gap-4 sm:grid-cols-2">
              {/* Left: term + template */}
              <div className="space-y-4">
                {/* Term */}
                <div className="rounded-xl border border-slate-200 bg-white p-4 space-y-3">
                  <p className="text-xs font-bold text-slate-700 uppercase tracking-wide">Term</p>
                  <select
                    value={blastTermId}
                    onChange={e => { setBlastTermId(e.target.value); setBlastResult(null); setBlastConfirm(false); }}
                    className={baseInputCls}
                  >
                    {terms.length === 0 && <option value="">No terms available</option>}
                    {terms.map(t => <option key={t.id} value={t.id}>{t.name} ({t.status})</option>)}
                  </select>
                  {blastTermId && (
                    <p className="font-mono text-[10px] text-slate-400 break-all">{blastLinkPreview}</p>
                  )}
                </div>

                {/* Template */}
                <div className="rounded-xl border border-slate-200 bg-white overflow-hidden">
                  <div className="flex items-center justify-between border-b border-violet-100 bg-linear-to-r from-violet-50 to-white px-4 py-3">
                    <p className="text-xs font-bold text-violet-900 uppercase tracking-wide">Email Template</p>
                    <div className="flex items-center gap-2">
                      <button onClick={openAvailabilityPreview} className="inline-flex items-center gap-1 rounded-lg border border-slate-200 px-2.5 py-1 text-[11px] font-semibold text-slate-600 hover:bg-slate-50">
                        <Eye size={10} /> Preview
                      </button>
                      <button onClick={() => setEditingBlastTemplate(v => !v)} className="inline-flex items-center gap-1 rounded-lg border border-slate-200 px-2.5 py-1 text-[11px] font-semibold text-slate-600 hover:bg-slate-50">
                        {editingBlastTemplate ? <><X size={10} /> Close</> : <><Edit3 size={10} /> Edit</>}
                      </button>
                    </div>
                  </div>
                  {!editingBlastTemplate ? (
                    <div className="px-4 py-3 space-y-2">
                      <div>
                        <p className="text-[10px] font-bold uppercase tracking-widest text-slate-400 mb-0.5">Subject</p>
                        <p className="text-sm text-slate-800">{blastSubject || <span className="text-slate-400 italic">Empty</span>}</p>
                      </div>
                      <div>
                        <p className="text-[10px] font-bold uppercase tracking-widest text-slate-400 mb-0.5">Body</p>
                        <p className="line-clamp-4 whitespace-pre-line text-xs text-slate-500">{blastBody || <span className="italic">Empty</span>}</p>
                      </div>
                    </div>
                  ) : (
                    <div className="p-4 space-y-3">
                      <div className="flex flex-wrap gap-1.5">
                        {['{{name}}', '{{link}}', '{{term}}', '{{center}}'].map(v => (
                          <span key={v} className="rounded border border-slate-200 bg-slate-50 px-2 py-0.5 font-mono text-[10px] text-slate-600">{v}</span>
                        ))}
                      </div>
                      <div>
                        <label className="mb-1 block text-xs font-semibold text-slate-700">Subject</label>
                        <input value={blastSubject} onChange={e => setBlastSubject(e.target.value)} className={baseInputCls} />
                      </div>
                      <div>
                        <label className="mb-1 block text-xs font-semibold text-slate-700">Body</label>
                        <textarea value={blastBody} onChange={e => setBlastBody(e.target.value)} rows={7} className={`${baseInputCls} resize-none`} style={{ lineHeight: '1.6' }} />
                      </div>
                      {blastTermId && (
                        <div className="rounded-lg border border-slate-200 bg-slate-50 p-3 text-xs space-y-1">
                          <p className="font-bold text-slate-500 uppercase tracking-widest text-[10px]">Preview</p>
                          <p className="font-semibold text-slate-800">{applyTemplate(blastSubject, { name: 'Alex Student', link: blastLinkPreview, term: selectedBlastTerm?.name ?? '', center: settings?.center_name ?? 'Tutoring Center' })}</p>
                          <p className="whitespace-pre-line text-slate-500">{applyTemplate(blastBody, { name: 'Alex Student', link: blastLinkPreview, term: selectedBlastTerm?.name ?? '', center: settings?.center_name ?? 'Tutoring Center' })}</p>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              </div>

              {/* Right: recipients */}
              <div className="rounded-xl border border-slate-200 bg-white overflow-hidden flex flex-col">
                <div className="flex items-center justify-between border-b border-blue-100 bg-linear-to-r from-blue-50 to-white px-4 py-3">
                  <p className="text-xs font-bold text-blue-900 uppercase tracking-wide">
                    Recipients <span className="text-blue-400 font-normal normal-case">({blastRecipients.length})</span>
                  </p>
                  <label className="flex cursor-pointer select-none items-center gap-1.5 text-xs text-slate-500">
                    <Checkbox checked={blastAllChecked} indeterminate={blastSomeChecked && !blastAllChecked} onChange={toggleBlastAll} />
                    {blastAllChecked ? 'Deselect all' : 'Select all'}
                  </label>
                </div>
                {loadingBlastRecipients ? (
                  <LoadingRow label="Loading recipients…" />
                ) : blastRecipients.length === 0 ? (
                  <EmptyState icon={<Users size={22} />} label="No students with email addresses" />
                ) : (
                  <ul className="flex-1 overflow-y-auto divide-y divide-slate-100 max-h-72">
                    {blastRecipients.map(r => (
                      <li
                        key={r.studentId}
                        className="flex cursor-pointer items-center gap-3 px-4 py-2.5 hover:bg-slate-50 transition-colors"
                        onClick={() => { setBlastConfirm(false); toggleBlast(r.studentId); }}
                      >
                        <Checkbox checked={blastSelected.has(r.studentId)} onChange={() => { setBlastConfirm(false); toggleBlast(r.studentId); }} />
                        <div className="min-w-0 flex-1">
                          <p className="text-sm font-semibold text-slate-800">{r.studentName}</p>
                          <p className="truncate text-[10px] text-slate-400"><EmailList student={{ studentEmail: r.studentEmail, momEmail: r.momEmail, dadEmail: r.dadEmail, notifyStudent: r.notifyStudent, notifyMom: r.notifyMom, notifyDad: r.notifyDad } as any} /></p>
                        </div>
                      </li>
                    ))}
                  </ul>
                )}
                <div className="border-t border-slate-100 bg-slate-50 p-4 space-y-3">
                  {blastResult && (
                    <ResultBanner sent={blastResult.sent} failed={blastResult.failed} errors={blastResult.errors} mode={blastResult.mode} redirectedTo={blastResult.redirectedTo} details={blastResult.details} />
                  )}
                  {!blastTermId && (
                    <p className="text-[11px] text-amber-600 font-medium">⚠ Select a term first to generate the availability link.</p>
                  )}
                  <p className="text-[11px] text-amber-600 font-medium">⚠ Availability email blast is temporarily disabled — feature still in progress.</p>
                  <div className="flex items-center justify-between gap-2 flex-wrap">
                    <button onClick={openAvailabilityFormPreview} disabled={!blastTermId} className="inline-flex items-center gap-1 text-xs text-slate-500 hover:text-slate-700 disabled:opacity-40">
                      <Eye size={11} /> Preview form
                    </button>
                    <SendButton
                      onClick={handleBlastSend}
                      loading={blastSending}
                      confirm={blastConfirm}
                      count={blastSelected.size}
                      disabled={true}
                      label="Send availability"
                    />
                  </div>
                </div>
              </div>
            </div>

            {/* ── Slot Preferences Survey ─────────────────────────────────── */}
            <div className="space-y-5 pt-2">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 bg-white border border-slate-200 rounded-xl px-4 py-3.5">
                <div className="flex items-center gap-2.5">
                  <Clipboard className="w-5 h-5 text-indigo-600" />
                  <div>
                    <h2 className="text-sm font-bold text-slate-900 leading-tight">Slot Preferences</h2>
                    <p className="text-xs text-slate-500">Enter paper form choices for each enrolled student</p>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <div className="relative">
                    <select
                      value={spSelectedTermId}
                      onChange={e => setSpSelectedTermId(e.target.value)}
                      className="appearance-none bg-white border border-slate-200 rounded-lg pl-3 pr-8 py-2 text-sm font-medium text-slate-700 focus:outline-none focus:ring-2 focus:ring-indigo-400 cursor-pointer"
                    >
                      {spTerms.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
                    </select>
                    <ChevronDown className="absolute right-2 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-slate-400 pointer-events-none" />
                  </div>
                  <button
                    onClick={spRunScheduler}
                    disabled={spRunning || spPrefCount === 0}
                    className="flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-semibold bg-indigo-600 text-white hover:bg-indigo-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                  >
                    {spRunning ? <Loader2 className="w-4 h-4 animate-spin" /> : <Play className="w-4 h-4" />}
                    Run Scheduler
                  </button>
                </div>
              </div>

              {!spLoading && spSelectedTermId && (
                <div className="flex flex-wrap gap-3">
                  <SpStatPill icon={<Users className="w-3.5 h-3.5" />} label="Enrolled" value={spEnrolledStudents.length} color="blue" />
                  <SpStatPill icon={<Check className="w-3.5 h-3.5" />} label="Preferences entered" value={spPrefCount} color="green" />
                  <SpStatPill icon={<AlertTriangle className="w-3.5 h-3.5" />} label="Awaiting" value={spEnrolledStudents.length - spPrefCount} color={spEnrolledStudents.length - spPrefCount > 0 ? 'amber' : 'gray'} />
                </div>
              )}

              {spProposal && (
                <SpProposalPanel
                  proposal={spProposal}
                  onClose={() => setSpProposal(null)}
                  studentNames={Object.fromEntries(spStudents.map(s => [s.id, s.name]))}
                />
              )}
              {spRunError && (
                <div className="bg-red-50 border border-red-200 rounded-xl px-4 py-3 text-sm text-red-700 flex items-center gap-2">
                  <AlertTriangle className="w-4 h-4 shrink-0" />
                  {spRunError}
                </div>
              )}

              <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
                <div className="px-4 py-3 border-b border-slate-100 flex items-center gap-2">
                  <Search className="w-4 h-4 text-slate-400 shrink-0" />
                  <input
                    value={spSearch}
                    onChange={e => setSpSearch(e.target.value)}
                    placeholder="Search enrolled students…"
                    className="flex-1 text-sm bg-transparent outline-none placeholder:text-slate-400"
                  />
                </div>
                {spLoading ? (
                  <LoadingRow label="Loading students…" />
                ) : spFilteredStudents.length === 0 ? (
                  <EmptyState icon={<Users size={24} />} label={spSelectedTermId ? 'No enrolled students found.' : 'Select a term to begin.'} />
                ) : (
                  <ul className="divide-y divide-slate-100">
                    {spFilteredStudents.map(student => {
                      const enrollment = spEnrollmentMap[student.id]
                      const prefs = enrollment?.slot_preferences ?? null
                      const hasPrefs = Array.isArray(prefs) && prefs.length > 0
                      const isOpen = spOpenStudentId === student.id
                      return (
                        <li key={student.id}>
                          <button
                            onClick={() => setSpOpenStudentId(isOpen ? null : student.id)}
                            className="w-full flex items-center gap-3 px-4 py-3 hover:bg-slate-50 transition-colors text-left"
                          >
                            <div className="flex-1 min-w-0">
                              <div className="flex items-center gap-2 flex-wrap">
                                <span className="text-sm font-semibold text-slate-800 truncate">{student.name}</span>
                                {hasPrefs ? (
                                  <span className="text-[11px] font-semibold bg-emerald-50 text-emerald-700 border border-emerald-200 px-1.5 py-0.5 rounded-full">
                                    {prefs!.length} choice{prefs!.length !== 1 ? 's' : ''}
                                  </span>
                                ) : (
                                  <span className="text-[11px] font-semibold bg-amber-50 text-amber-600 border border-amber-200 px-1.5 py-0.5 rounded-full">
                                    No preferences
                                  </span>
                                )}
                              </div>
                              {hasPrefs && (
                                <div className="mt-0.5 flex flex-wrap gap-1">
                                  {prefs!.map((choice, ci) => (
                                    <span key={ci} className="text-[11px] text-slate-500">
                                      {ci + 1}. {spBlockLabel(choice)}
                                      {ci < prefs!.length - 1 && <span className="mx-1 text-slate-300">·</span>}
                                    </span>
                                  ))}
                                </div>
                              )}
                            </div>
                            {isOpen ? <ChevronDown className="w-4 h-4 text-slate-400 shrink-0" /> : <ChevronRight className="w-4 h-4 text-slate-400 shrink-0" />}
                          </button>
                          {isOpen && (
                            <div className="px-4 pb-4 pt-1 bg-slate-50 border-t border-slate-100">
                              <SlotPreferenceSurvey
                                studentId={student.id}
                                studentName={student.name}
                                termId={spSelectedTermId}
                                sessionTimesByDay={spSessionTimesByDay}
                                initialPreferences={prefs}
                                onSave={newPrefs => handleSpSave(student.id, newPrefs)}
                                onClose={() => setSpOpenStudentId(null)}
                              />
                            </div>
                          )}
                        </li>
                      )
                    })}
                  </ul>
                )}
              </div>
            </div>
          </div>
        )}

        {/* ── GENERAL BLAST ───────────────────────────────────────────────── */}
        {activeTab === 'general' && (
          <div className="space-y-4">

            <div className="grid gap-4 sm:grid-cols-2">
              {/* Compose */}
              <div className="rounded-xl border border-slate-200 bg-white p-4 space-y-3">
                <p className="text-xs font-bold text-slate-700 uppercase tracking-wide">Compose</p>
                <div className="flex flex-wrap gap-1.5">
                  {['{{name}}', '{{center}}'].map(v => (
                    <span key={v} className="rounded border border-slate-200 bg-slate-50 px-2 py-0.5 font-mono text-[10px] text-slate-600">{v}</span>
                  ))}
                </div>
                <div>
                  <label className="mb-1 block text-xs font-semibold text-slate-700">Subject</label>
                  <input value={generalSubject} onChange={e => { setGeneralSubject(e.target.value); setGeneralResult(null); }} placeholder="e.g. Important update from the center" className={baseInputCls} />
                </div>
                <div>
                  <label className="mb-1 block text-xs font-semibold text-slate-700">Body</label>
                  <textarea value={generalBody} onChange={e => { setGeneralBody(e.target.value); setGeneralResult(null); }} rows={8} placeholder={"Hi {{name}},\n\n..."} className={`${baseInputCls} resize-none`} style={{ lineHeight: '1.6' }} />
                </div>
                <button onClick={openGeneralPreview} className="inline-flex items-center gap-1.5 text-xs font-semibold text-slate-500 hover:text-slate-700">
                  <Eye size={11} /> Preview email
                </button>
              </div>

              {/* Recipients */}
              <div className="rounded-xl border border-slate-200 bg-white overflow-hidden flex flex-col">
                <div className="flex items-center justify-between border-b border-blue-100 bg-linear-to-r from-blue-50 to-white px-4 py-3">
                  <p className="text-xs font-bold text-blue-900 uppercase tracking-wide">
                    Recipients <span className="text-blue-400 font-normal normal-case">({blastRecipients.length})</span>
                  </p>
                  <label className="flex cursor-pointer select-none items-center gap-1.5 text-xs text-slate-500">
                    <Checkbox
                      checked={blastRecipients.length > 0 && blastRecipients.every(r => generalSelected.has(r.studentId))}
                      indeterminate={blastRecipients.some(r => generalSelected.has(r.studentId)) && !blastRecipients.every(r => generalSelected.has(r.studentId))}
                      onChange={() => {
                        setGeneralConfirm(false);
                        const allSel = blastRecipients.every(r => generalSelected.has(r.studentId));
                        setGeneralSelected(allSel ? new Set() : new Set(blastRecipients.map(r => r.studentId)));
                      }}
                    />
                    {blastRecipients.every(r => generalSelected.has(r.studentId)) ? 'Deselect all' : 'Select all'}
                  </label>
                </div>
                {loadingBlastRecipients ? (
                  <LoadingRow label="Loading recipients…" />
                ) : blastRecipients.length === 0 ? (
                  <EmptyState icon={<Users size={22} />} label="No students with email addresses" />
                ) : (
                  <ul className="flex-1 overflow-y-auto divide-y divide-slate-100 max-h-72">
                    {blastRecipients.map(r => (
                      <li
                        key={r.studentId}
                        className="flex cursor-pointer items-center gap-3 px-4 py-2.5 hover:bg-slate-50 transition-colors"
                        onClick={() => { setGeneralConfirm(false); setGeneralSelected(prev => { const n = new Set(prev); n.has(r.studentId) ? n.delete(r.studentId) : n.add(r.studentId); return n; }); }}
                      >
                        <Checkbox
                          checked={generalSelected.has(r.studentId)}
                          onChange={() => { setGeneralConfirm(false); setGeneralSelected(prev => { const n = new Set(prev); n.has(r.studentId) ? n.delete(r.studentId) : n.add(r.studentId); return n; }); }}
                        />
                        <div className="min-w-0 flex-1">
                          <p className="text-sm font-semibold text-slate-800">{r.studentName}</p>
                          <p className="truncate text-[10px] text-slate-400"><EmailList student={{ studentEmail: r.studentEmail, momEmail: r.momEmail, dadEmail: r.dadEmail, notifyStudent: r.notifyStudent, notifyMom: r.notifyMom, notifyDad: r.notifyDad } as any} /></p>
                        </div>
                      </li>
                    ))}
                  </ul>
                )}
                <div className="border-t border-slate-100 bg-slate-50 p-4 space-y-3">
                  {generalResult && (
                    <ResultBanner sent={generalResult.sent} failed={generalResult.failed} errors={generalResult.errors} mode={generalResult.mode} redirectedTo={generalResult.redirectedTo} details={generalResult.details} />
                  )}
                  <div className="flex justify-end">
                    <SendButton
                      onClick={handleGeneralSend}
                      loading={generalSending}
                      confirm={generalConfirm}
                      count={generalSelected.size}
                      disabled={generalSelected.size === 0 || generalSending || !generalSubject.trim() || !generalBody.trim()}
                      label="Send email"
                    />
                  </div>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* ── TUTOR SCHEDULES ─────────────────────────────────────────────── */}
        {activeTab === 'tutor' && (
          <div className="space-y-4">

            {/* ── Auto Schedule Cron ───────────────────────────────────────────── */}
            {(() => {
              const isWeekly      = tutorSchedMode === 'weekly'
              const cronJob       = isWeekly ? tutorWeeklyCronJob       : tutorDailyCronJob
              const cronHistory   = isWeekly ? tutorWeeklyCronHistory   : tutorDailyCronHistory
              const cronLoading   = isWeekly ? tutorWeeklyCronLoading   : tutorDailyCronLoading
              const cronSaving    = isWeekly ? tutorWeeklyCronSaving    : tutorDailyCronSaving
              const cronConfigured = isWeekly ? tutorWeeklyCronConfigured : tutorDailyCronConfigured
              const cronTime      = isWeekly ? tutorWeeklyTime          : tutorDailyTime
              const setCronTime   = isWeekly ? setTutorWeeklyTime       : setTutorDailyTime
              const histExpanded  = isWeekly ? tutorWeeklyCronHistExpanded : tutorDailyCronHistExpanded
              const setHistExpanded = isWeekly ? setTutorWeeklyCronHistExpanded : setTutorDailyCronHistExpanded
              const cronType      = isWeekly ? 'tutor-weekly' : 'tutor-daily'
              const envVar        = isWeekly ? 'CRONJOB_ORG_TUTOR_WEEKLY_JOB_ID' : 'CRONJOB_ORG_TUTOR_DAILY_JOB_ID'
              const label         = isWeekly ? 'Weekly Auto-Schedule' : 'Daily Auto-Schedule'
              const description   = isWeekly
                ? 'Automatically sends each tutor their weekly schedule on a set schedule.'
                : 'Automatically sends each tutor their daily schedule on a set schedule.'

              return (
                <div className="rounded-xl border border-slate-200 bg-white overflow-hidden">
                  <div className="border-b border-indigo-100 bg-linear-to-r from-indigo-50 to-white px-4 py-3">
                    <p className="text-xs font-bold text-indigo-900 uppercase tracking-wide">{label}</p>
                    <p className="mt-0.5 text-[11px] text-indigo-400">{description}</p>
                  </div>
                  {cronLoading && cronConfigured === null ? (
                    <div className="flex items-center gap-2 px-4 py-3 text-xs text-slate-400">
                      <Loader2 size={12} className="animate-spin" /> Checking schedule status…
                    </div>
                  ) : cronConfigured === false ? (
                    <div className="px-4 py-3 text-xs text-slate-500">
                      Automatic scheduling isn&apos;t connected. Configure{' '}
                      <code className="rounded bg-slate-100 px-1">CRONJOB_ORG_API_KEY</code> and{' '}
                      <code className="rounded bg-slate-100 px-1">{envVar}</code> to enable.
                    </div>
                  ) : cronConfigured ? (
                    <div className="space-y-4 p-4">
                      {cronJob && (
                        <div className="flex items-center gap-3">
                          <span className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] font-semibold ${cronJob.enabled ? 'bg-emerald-50 text-emerald-700' : 'bg-slate-100 text-slate-500'}`}>
                            <span className={`h-1.5 w-1.5 rounded-full ${cronJob.enabled ? 'bg-emerald-500' : 'bg-slate-400'}`} />
                            {cronJob.enabled ? 'Auto-schedule on' : 'Auto-schedule off'}
                          </span>
                          <button
                            onClick={() => void toggleTutorCronEnabled(cronType)}
                            disabled={cronSaving}
                            className="rounded border border-slate-200 bg-white px-3 py-1 text-xs font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-50"
                          >
                            {cronSaving ? 'Saving…' : cronJob.enabled ? 'Turn off' : 'Turn on'}
                          </button>
                        </div>
                      )}
                      <div className="flex items-end gap-3 flex-wrap">
                        <div>
                          <label className="mb-1 block text-xs font-semibold text-slate-600">Send at</label>
                          <input
                            type="time"
                            value={cronTime}
                            onChange={e => setCronTime(e.target.value)}
                            className="rounded border border-slate-200 px-3 py-2 text-sm text-slate-800 focus:border-slate-400 outline-none"
                          />
                          <p className="mt-1 text-[11px] text-slate-400">Timezone: {cronJob?.schedule?.timezone || DEFAULT_REMINDER_TIMEZONE}</p>
                        </div>
                        <button
                          onClick={() => void saveTutorCronTime(cronType)}
                          disabled={cronSaving}
                          className="mb-5 flex items-center gap-1.5 rounded bg-slate-900 px-3 py-2 text-xs font-semibold text-white hover:bg-slate-700 disabled:opacity-50"
                        >
                          <Save size={11} />
                          {cronSaving ? 'Saving…' : 'Save'}
                        </button>
                      </div>
                      {cronJob && cronJob.nextExecution > 0 && (
                        <p className="text-[11px] text-slate-400">
                          Next send: {new Date(cronJob.nextExecution * 1000).toLocaleString(undefined, { timeZone: cronJob.schedule?.timezone || DEFAULT_REMINDER_TIMEZONE })}
                        </p>
                      )}
                      {cronHistory.length > 0 && (
                        <div>
                          <button
                            onClick={() => setHistExpanded(v => !v)}
                            className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-slate-400 hover:text-slate-600 transition-colors"
                          >
                            <ChevronDown size={11} className={`transition-transform ${histExpanded ? 'rotate-180' : ''}`} />
                            Recent sends ({cronHistory.length})
                          </button>
                          {histExpanded && (
                            <div className="mt-1.5 overflow-y-auto rounded border border-slate-100 max-h-24">
                              {cronHistory.map((h, i) => (
                                <div key={i} className="flex items-center gap-3 border-b border-slate-50 px-3 py-1 last:border-0 text-xs">
                                  <span className={`w-12 shrink-0 rounded-full px-2 py-0.5 text-center font-semibold ${h.status === 1 ? 'bg-emerald-50 text-emerald-700' : 'bg-red-50 text-red-600'}`}>
                                    {h.status === 1 ? 'OK' : 'Fail'}
                                  </span>
                                  <span className="text-slate-500">{new Date(h.date * 1000).toLocaleString()}</span>
                                  <span className="ml-auto text-slate-400">{h.duration}ms</span>
                                </div>
                              ))}
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  ) : null}
                </div>
              )
            })()}

            <div className="rounded-xl border border-slate-200 bg-white p-5 space-y-5">
              {/* Mode toggle */}
              <div className="flex items-center gap-1.5">
                <button
                  onClick={() => { setTutorSchedMode('weekly'); setTutorSchedResult(null); }}
                  className={`rounded-lg px-3 py-1.5 text-xs font-semibold transition-colors ${tutorSchedMode === 'weekly' ? 'bg-slate-900 text-white' : 'border border-slate-200 bg-white text-slate-600 hover:bg-slate-50'}`}
                >Weekly</button>
                <button
                  onClick={() => { setTutorSchedMode('daily'); setTutorSchedResult(null); }}
                  className={`rounded-lg px-3 py-1.5 text-xs font-semibold transition-colors ${tutorSchedMode === 'daily' ? 'bg-slate-900 text-white' : 'border border-slate-200 bg-white text-slate-600 hover:bg-slate-50'}`}
                >Daily</button>
              </div>

              <div className="flex flex-wrap items-end gap-4">
                <div>
                  {tutorSchedMode === 'weekly' ? (
                    <>
                      <label className="mb-1 block text-xs font-semibold text-slate-700">Week starting (Monday)</label>
                      <input
                        type="date"
                        value={tutorSchedWeek}
                        onChange={e => { setTutorSchedWeek(e.target.value); setTutorSchedResult(null); }}
                        className={`${baseInputCls} w-auto`}
                      />
                    </>
                  ) : (
                    <>
                      <label className="mb-1 block text-xs font-semibold text-slate-700">Date</label>
                      <input
                        type="date"
                        value={tutorSchedDay}
                        onChange={e => { setTutorSchedDay(e.target.value); setTutorSchedResult(null); }}
                        className={`${baseInputCls} w-auto`}
                      />
                    </>
                  )}
                </div>
                <div className="rounded-lg border border-slate-100 bg-slate-50 px-4 py-2.5 text-sm">
                  {tutorsWithEmail.length > 0 ? (
                    <><span className="font-bold text-slate-800">{tutorsWithEmail.length}</span> <span className="text-slate-500">tutor{tutorsWithEmail.length !== 1 ? 's' : ''} will receive their schedule</span></>
                  ) : (
                    <span className="text-slate-400">No tutors with email addresses found</span>
                  )}
                </div>
              </div>

              {tutorsWithEmail.length > 0 && (
                <div className="rounded-lg border border-slate-200 bg-slate-50 p-3">
                  <p className="mb-1.5 text-[10px] font-bold uppercase tracking-widest text-slate-500">Tutors</p>
                  <div className="flex flex-wrap gap-1.5">
                    {tutorsWithEmail.map(t => (
                      <span key={t.id} className="rounded-full border border-slate-200 bg-white px-2.5 py-0.5 text-xs font-medium text-slate-700">{t.name}</span>
                    ))}
                  </div>
                </div>
              )}

              {tutorSchedResult && (
                <ResultBanner
                  sent={tutorSchedResult.sent}
                  failed={tutorSchedResult.failed}
                  errors={tutorSchedResult.errors}
                  mode={tutorSchedResult.mode}
                  redirectedTo={tutorSchedResult.redirectedTo}
                  skipped={tutorSchedResult.skipped}
                  reason={tutorSchedResult.reason}
                  details={(tutorSchedResult as any).details}
                />
              )}

              <div className="flex items-center justify-between gap-3 pt-1">
                <button onClick={() => void openTutorSchedulePreview()} className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50">
                  <Eye size={12} /> Preview schedule email
                </button>
                <button
                  onClick={handleSendTutorSchedules}
                  disabled={tutorSchedSending || tutorsWithEmail.length === 0}
                  className="inline-flex items-center gap-2 rounded-lg bg-slate-900 px-4 py-2 text-sm font-semibold text-white hover:bg-slate-800 disabled:opacity-50 transition-colors"
                >
                  {tutorSchedSending ? <><Loader2 size={13} className="animate-spin" /> Sending…</> : <><Send size={13} /> Send to {tutorsWithEmail.length} tutor{tutorsWithEmail.length !== 1 ? 's' : ''}</>}
                </button>
              </div>
            </div>

            {/* Send history */}
            <div className="rounded-xl border border-slate-200 bg-white overflow-hidden">
              <button
                className="flex w-full items-center justify-between px-4 py-3 text-left hover:bg-slate-50 transition-colors"
                onClick={() => setTutorSchedLogsExpanded(p => !p)}
              >
                <div className="flex items-center gap-2">
                  <Clock size={13} className="text-slate-400" />
                  <span className="text-xs font-bold text-slate-700">Send History</span>
                  {loadingTutorSchedLogs ? (
                    <Loader2 size={11} className="animate-spin text-slate-400" />
                  ) : tutorSchedLogs.length > 0 ? (
                    <span className="rounded-full bg-indigo-100 px-2 py-0.5 text-[10px] font-bold text-indigo-700">{tutorSchedLogs.length}</span>
                  ) : null}
                </div>
                {tutorSchedLogsExpanded ? <ChevronUp size={14} className="text-slate-400" /> : <ChevronDown size={14} className="text-slate-400" />}
              </button>
              {tutorSchedLogsExpanded && (
                loadingTutorSchedLogs ? (
                  <LoadingRow label="Loading history…" />
                ) : tutorSchedLogs.length === 0 ? (
                  <EmptyState icon={<Mail size={22} />} label="No tutor schedules sent yet" />
                ) : (
                  <ul className="divide-y divide-slate-100 max-h-80 overflow-y-auto border-t border-slate-100">
                    {tutorSchedLogs.map(log => (
                      <li key={log.id} className="flex items-center justify-between px-4 py-2.5 gap-3">
                        <div className="flex items-center gap-3 min-w-0">
                          {log.status === 'sent' ? (
                            <div className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full border border-emerald-200 bg-emerald-50">
                              <Check size={10} className="text-emerald-600" />
                            </div>
                          ) : (
                            <div className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full border border-red-200 bg-red-50">
                              <AlertCircle size={10} className="text-red-500" />
                            </div>
                          )}
                          <div className="min-w-0">
                            <p className="text-sm font-semibold text-slate-800 truncate">{log.tutor_name}</p>
                            <p className="text-[11px] text-slate-400 truncate">{log.emailed_to}</p>
                            <div className="flex items-center gap-1.5 mt-0.5 flex-wrap">
                              <span className={`text-[9px] font-bold px-1.5 py-0.5 rounded uppercase ${log.mode === 'weekly' ? 'bg-indigo-50 text-indigo-600' : 'bg-sky-50 text-sky-600'}`}>{log.mode}</span>
                              {log.period_label && <span className="text-[10px] text-slate-400">{log.period_label}</span>}
                              {log.trigger === 'cron' && <span className="text-[9px] font-bold px-1.5 py-0.5 rounded bg-slate-100 text-slate-500 uppercase">auto</span>}
                            </div>
                            {log.status === 'failed' && log.error && (
                              <p className="text-[10px] text-red-500 truncate">{log.error}</p>
                            )}
                          </div>
                        </div>
                        <p className="shrink-0 text-[11px] text-slate-400">{formatSentAt(log.sent_at)}</p>
                      </li>
                    ))}
                  </ul>
                )
              )}
            </div>
          </div>
        )}

        {/* ── STUDENT SCHEDULES ──────────────────────────────────────────── */}
        {activeTab === 'student' && (
          <div className="space-y-4">

            <div className="grid gap-4 sm:grid-cols-2">
              {/* Left: term + send */}
              <div className="space-y-4">
                <div className="rounded-xl border border-slate-200 bg-white p-4 space-y-3">
                  <p className="text-xs font-bold text-slate-700 uppercase tracking-wide">Term</p>
                  <select
                    value={studentSchedTermId}
                    onChange={e => { setStudentSchedTermId(e.target.value); setStudentSchedResult(null); setStudentSchedConfirm(false); setStudentSchedLogsExpanded(false); }}
                    className={baseInputCls}
                  >
                    <option value="">— Select a term —</option>
                    {terms.map(t => <option key={t.id} value={t.id}>{t.name} ({t.status})</option>)}
                  </select>
                </div>

                {studentSchedResult && (
                  <ResultBanner
                    sent={studentSchedResult.sent}
                    failed={studentSchedResult.failed}
                    errors={studentSchedResult.errors}
                    mode={studentSchedResult.mode}
                    redirectedTo={studentSchedResult.redirectedTo}
                    skipped={studentSchedResult.skipped}
                    reason={studentSchedResult.reason}
                    details={(studentSchedResult as any).details}
                  />
                )}

                <div className="flex items-center justify-between gap-2 flex-wrap">
                  <button
                    onClick={() => void openStudentSchedulePreview()}
                    className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50"
                  >
                    <Eye size={12} /> Preview schedule email
                  </button>
                  <SendButton
                    onClick={handleSendStudentSchedules}
                    loading={studentSchedSending}
                    confirm={studentSchedConfirm}
                    count={studentSchedSelected.size}
                    disabled={studentSchedSelected.size === 0 || studentSchedSending || !studentSchedTermId}
                    label="Send schedules"
                  />
                </div>
                {!studentSchedTermId && (
                  <p className="text-[11px] text-amber-600 font-medium">⚠ Select a term first.</p>
                )}
              </div>

              {/* Right: recipient list */}
              <div className="rounded-xl border border-slate-200 bg-white overflow-hidden flex flex-col">
                <div className="flex items-center justify-between border-b border-blue-100 bg-linear-to-r from-blue-50 to-white px-4 py-3">
                  <p className="text-xs font-bold text-blue-900 uppercase tracking-wide">
                    Recipients <span className="text-blue-400 font-normal normal-case">({blastRecipients.length})</span>
                  </p>
                  <label className="flex cursor-pointer select-none items-center gap-1.5 text-xs text-slate-500">
                    <Checkbox
                      checked={blastRecipients.length > 0 && blastRecipients.every(r => studentSchedSelected.has(r.studentId))}
                      indeterminate={blastRecipients.some(r => studentSchedSelected.has(r.studentId)) && !blastRecipients.every(r => studentSchedSelected.has(r.studentId))}
                      onChange={() => {
                        setStudentSchedConfirm(false);
                        const allSel = blastRecipients.every(r => studentSchedSelected.has(r.studentId));
                        setStudentSchedSelected(allSel ? new Set() : new Set(blastRecipients.map(r => r.studentId)));
                      }}
                    />
                    {blastRecipients.every(r => studentSchedSelected.has(r.studentId)) ? 'Deselect all' : 'Select all'}
                  </label>
                </div>
                {loadingBlastRecipients ? (
                  <LoadingRow label="Loading recipients…" />
                ) : blastRecipients.length === 0 ? (
                  <EmptyState icon={<Users size={22} />} label="No students with email addresses" />
                ) : (
                  <ul className="flex-1 overflow-y-auto divide-y divide-slate-100 max-h-72">
                    {blastRecipients.map(r => {
                      const lastLog = studentSchedLogs.find(l => l.student_id === r.studentId);
                      return (
                        <li
                          key={r.studentId}
                          className="flex cursor-pointer items-start gap-3 px-4 py-2.5 hover:bg-slate-50 transition-colors"
                          onClick={() => {
                            setStudentSchedConfirm(false);
                            setStudentSchedSelected(prev => { const n = new Set(prev); n.has(r.studentId) ? n.delete(r.studentId) : n.add(r.studentId); return n; });
                          }}
                        >
                          <div className="mt-0.5"><Checkbox
                            checked={studentSchedSelected.has(r.studentId)}
                            onChange={() => {
                              setStudentSchedConfirm(false);
                              setStudentSchedSelected(prev => { const n = new Set(prev); n.has(r.studentId) ? n.delete(r.studentId) : n.add(r.studentId); return n; });
                            }}
                          /></div>
                          <div className="min-w-0 flex-1">
                            <div className="flex items-center gap-2 flex-wrap">
                              <p className="text-sm font-semibold text-slate-800">{r.studentName}</p>
                              {lastLog && lastLog.status === 'sent' && (
                                <span className="inline-flex items-center gap-1 rounded border border-emerald-200 bg-emerald-50 px-1.5 py-0.5 text-[10px] font-semibold text-emerald-700" title={`Sent to ${lastLog.emailed_to}`}>
                                  <Check size={9} /> Sent {formatSentAt(lastLog.sent_at)}
                                </span>
                              )}
                              {lastLog && lastLog.status === 'failed' && (
                                <span className="inline-flex items-center gap-1 rounded border border-red-200 bg-red-50 px-1.5 py-0.5 text-[10px] font-semibold text-red-600" title={lastLog.error ?? 'Send failed'}>
                                  <AlertCircle size={9} /> Failed
                                </span>
                              )}
                            </div>
                            <div className="mt-0.5 text-[11px] text-slate-400">
                              <EmailList student={{ studentEmail: r.studentEmail, momEmail: r.momEmail, dadEmail: r.dadEmail, notifyStudent: r.notifyStudent, notifyMom: r.notifyMom, notifyDad: r.notifyDad } as any} />
                            </div>
                          </div>
                        </li>
                      );
                    })}
                  </ul>
                )}
              </div>
            </div>

            {/* Schedule send history */}
            {studentSchedTermId && (
              <div className="rounded-xl border border-slate-200 bg-white overflow-hidden">
                <button
                  className="flex w-full items-center justify-between px-4 py-3 text-left hover:bg-slate-50 transition-colors"
                  onClick={() => setStudentSchedLogsExpanded(p => !p)}
                >
                  <div className="flex items-center gap-2">
                    <Clock size={13} className="text-slate-400" />
                    <span className="text-xs font-bold text-slate-700">Send History for this term</span>
                    {loadingStudentSchedLogs ? (
                      <Loader2 size={11} className="animate-spin text-slate-400" />
                    ) : studentSchedLogs.length > 0 ? (
                      <span className="rounded-full bg-indigo-100 px-2 py-0.5 text-[10px] font-bold text-indigo-700">{studentSchedLogs.length}</span>
                    ) : null}
                  </div>
                  {studentSchedLogsExpanded ? <ChevronUp size={14} className="text-slate-400" /> : <ChevronDown size={14} className="text-slate-400" />}
                </button>
                {studentSchedLogsExpanded && (
                  loadingStudentSchedLogs ? (
                    <LoadingRow label="Loading history…" />
                  ) : studentSchedLogs.length === 0 ? (
                    <EmptyState icon={<Mail size={22} />} label="No schedules sent for this term yet" />
                  ) : (
                    <ul className="divide-y divide-slate-100 max-h-72 overflow-y-auto border-t border-slate-100">
                      {studentSchedLogs.map(log => (
                        <li key={log.id} className="flex items-center justify-between px-4 py-2.5 gap-3">
                          <div className="flex items-center gap-3 min-w-0">
                            {log.status === 'sent' ? (
                              <div className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full border border-emerald-200 bg-emerald-50">
                                <Check size={10} className="text-emerald-600" />
                              </div>
                            ) : (
                              <div className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full border border-red-200 bg-red-50">
                                <AlertCircle size={10} className="text-red-500" />
                              </div>
                            )}
                            <div className="min-w-0">
                              <p className="text-sm font-semibold text-slate-800 truncate">{log.student_name}</p>
                              <p className="text-[11px] text-slate-400 truncate">{log.emailed_to}</p>
                              {log.status === 'failed' && log.error && (
                                <p className="text-[10px] text-red-500 truncate">{log.error}</p>
                              )}
                            </div>
                          </div>
                          <p className="shrink-0 text-[11px] text-slate-400">{formatSentAt(log.sent_at)}</p>
                        </li>
                      ))}
                    </ul>
                  )
                )}
              </div>
            )}
          </div>
        )}

        {/* ── HISTORY ─────────────────────────────────────────────────────── */}
        {activeTab === 'history' && (
          <div className="space-y-4">

            <div className="overflow-hidden rounded-xl border border-slate-200 bg-white">
              {loadingLogs ? (
                <LoadingRow label="Loading history…" />
              ) : logs.length === 0 ? (
                <EmptyState icon={<Mail size={24} />} label="No reminders sent yet" />
              ) : (
                <div className="max-h-150 overflow-y-auto">
                  {Object.entries(groupedLogs)
                    .sort(([a], [b]) => b.localeCompare(a))
                    .map(([date, entries]) => (
                      <div key={date}>
                        <div className="flex items-center gap-2 border-b border-slate-100 bg-slate-50 px-4 py-2.5">
                          <span className="text-xs font-bold text-slate-700">{date}</span>
                          <span className="rounded-full bg-slate-200 px-2 py-0.5 text-[10px] font-semibold text-slate-600">{entries.length} sent</span>
                        </div>
                        <ul className="divide-y divide-slate-100">
                          {entries.map(log => (
                            <li key={log.id} className="flex items-center justify-between px-4 py-3">
                              <div className="flex items-center gap-3">
                                <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full border border-emerald-200 bg-emerald-50">
                                  <Check size={11} className="text-emerald-600" />
                                </div>
                                <div>
                                  <p className="text-sm font-semibold text-slate-800">{log.student_name}</p>
                                  <p className="text-[11px] text-slate-400">{log.emailed_to}</p>
                                </div>
                              </div>
                              <div className="text-right ml-4 shrink-0">
                                <p className="text-xs font-semibold text-slate-700">{log.session_time}</p>
                                <p className="text-[10px] text-slate-400">{formatSentAt(log.sent_at)}</p>
                              </div>
                            </li>
                          ))}
                        </ul>
                      </div>
                    ))}
                </div>
              )}
            </div>
          </div>
        )}



        </div>{/* end panel content */}
      </div>{/* end max-w-5xl */}

      {/* ── Email preview modal ──────────────────────────────────────────── */}
      {previewModal && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/55 px-4 py-6 backdrop-blur-[1px]"
          onClick={() => { if (!previewLoading) setPreviewModal(null); }}
        >
          <div className="flex w-full max-w-6xl flex-col overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-2xl" onClick={e => e.stopPropagation()}>
            <div className="flex items-start justify-between gap-4 border-b border-slate-200 bg-slate-50 px-5 py-4">
              <div>
                <p className="text-xs font-bold uppercase tracking-widest text-indigo-600">{previewModal.title}</p>
                {previewModal.note && <p className="mt-1 text-xs text-slate-500">{previewModal.note}</p>}
                {previewModal.subject && <p className="mt-2 text-[11px] font-semibold text-slate-700">Subject: {previewModal.subject}</p>}
              </div>
              <button
                onClick={() => setPreviewModal(null)}
                disabled={previewLoading}
                className="inline-flex items-center gap-1 rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-100 disabled:opacity-50"
              >
                <X size={12} /> Close
              </button>
            </div>
            <div className="bg-slate-100 p-4">
              {previewLoading ? (
                <div className="flex min-h-[72vh] items-center justify-center rounded-xl border border-dashed border-slate-300 bg-white text-slate-500">
                  <div className="flex items-center gap-2 text-sm font-semibold">
                    <Loader2 size={14} className="animate-spin" /> Building preview…
                  </div>
                </div>
              ) : (
                <iframe
                  title={previewModal.title}
                  src={previewModal.url}
                  srcDoc={previewModal.url ? undefined : previewModal.html}
                  className="h-[72vh] w-full rounded-xl border border-slate-200 bg-white"
                />
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ── Shared sub-components ──────────────────────────────────────────────────────

// SectionHeader removed — layout uses sidebar nav

function Checkbox({ checked, indeterminate, disabled, onChange }: { checked: boolean; indeterminate?: boolean; disabled?: boolean; onChange: () => void }) {
  return (
    <div
      onClick={e => { e.stopPropagation(); if (!disabled) onChange(); }}
      className={`flex h-4 w-4 shrink-0 cursor-pointer items-center justify-center rounded transition-all ${disabled ? 'cursor-default' : ''}`}
      style={{
        background: checked ? '#0f172a' : indeterminate ? '#e2e8f0' : 'white',
        border: `2px solid ${checked || indeterminate ? '#0f172a' : disabled ? '#e5e7eb' : '#d1d5db'}`,
      }}
    >
      {checked && <Check size={9} color="white" strokeWidth={3} />}
      {indeterminate && !checked && <div className="h-1.5 w-1.5 rounded-sm bg-slate-700" />}
    </div>
  );
}

function StatusBadge({ color, label, icon }: { color: 'green' | 'amber' | 'gray'; label: string; icon?: React.ReactNode }) {
  const map: Record<string, string> = {
    green: 'bg-emerald-50 text-emerald-700 border-emerald-200',
    amber: 'bg-amber-50 text-amber-700 border-amber-200',
    gray:  'bg-slate-100 text-slate-500 border-slate-200',
  };
  return (
    <span className={`inline-flex items-center gap-0.5 rounded-full border px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wide ${map[color]}`}>
      {icon}{label}
    </span>
  );
}

function EmailList({ student }: { student: { studentEmail: string | null; momEmail: string | null; dadEmail: string | null; notifyStudent: boolean; notifyMom: boolean; notifyDad: boolean } }) {
  const entries = [
    student.studentEmail ? { label: 'Student', addr: student.studentEmail, notify: student.notifyStudent } : null,
    student.momEmail     ? { label: 'Mom',     addr: student.momEmail,     notify: student.notifyMom }     : null,
    student.dadEmail     ? { label: 'Dad',     addr: student.dadEmail,     notify: student.notifyDad }     : null,
  ].filter(Boolean) as { label: string; addr: string; notify: boolean }[];

  return (
    <span className="flex flex-col gap-0.5">
      {entries.map((x, i) => (
        <span key={i} className={x.notify ? '' : 'opacity-50'}>
          <span className="font-semibold text-slate-500">{x.label}:</span>{' '}
          <span style={x.notify ? {} : { textDecoration: 'line-through' }}>{x.addr}</span>
          {!x.notify && <span className="ml-1 text-[10px] font-semibold text-amber-500">opted out</span>}
        </span>
      ))}
    </span>
  );
}

function SendButton({ onClick, loading, confirm, count, disabled, label }: { onClick: () => void; loading: boolean; confirm: boolean; count: number; disabled: boolean; label: string }) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className="inline-flex items-center gap-1.5 rounded-lg px-4 py-2 text-sm font-semibold text-white disabled:opacity-50 transition-colors"
      style={{ background: confirm ? '#92400e' : '#0f172a' }}
    >
      {loading ? (
        <><Loader2 size={13} className="animate-spin" /> Sending…</>
      ) : confirm ? (
        <><AlertCircle size={13} /> Confirm — {count} recipient{count !== 1 ? 's' : ''}</>
      ) : (
        <><Send size={13} /> {label} ({count})</>
      )}
    </button>
  );
}

function ResultBanner({ sent, failed, errors, mode, redirectedTo, skipped, reason, details }: { sent: number; failed: number; errors: string[]; mode?: string; redirectedTo?: string | null; skipped?: boolean; reason?: string; details?: { name: string; to: string }[] }) {
  const [expanded, setExpanded] = useState(false);
  const isRedirect = mode === 'redirect';
  const isSuccess = failed === 0 && !skipped;

  return (
    <div className={`rounded-lg border text-xs font-semibold overflow-hidden ${isRedirect ? 'border-amber-300 bg-amber-50 text-amber-800' : isSuccess ? 'border-emerald-200 bg-emerald-50 text-emerald-700' : 'border-red-200 bg-red-50 text-red-700'}`}>
      {isRedirect && (
        <div className="flex items-center gap-2 bg-amber-100 border-b border-amber-200 px-3 py-2">
          <AlertCircle size={13} className="shrink-0" />
          <span className="font-bold">TEST MODE — emails redirected to: {redirectedTo}</span>
        </div>
      )}
      <div className="flex items-start gap-2 px-3 py-2.5">
        {!isRedirect && (isSuccess ? <Check size={13} className="mt-0.5 shrink-0" /> : <AlertCircle size={13} className="mt-0.5 shrink-0" />)}
        <div className="space-y-0.5 flex-1 min-w-0">
          {skipped && reason && <p>{reason}</p>}
          {sent > 0 && <p>{sent} email{sent !== 1 ? 's' : ''} sent successfully.</p>}
          {failed > 0 && <p>{failed} failed.{errors[0] ? ` ${errors[0]}` : ''}</p>}
          {details && details.length > 0 && (
            <div className="mt-1.5">
              <button
                onClick={() => setExpanded(e => !e)}
                className="underline underline-offset-2 opacity-70 hover:opacity-100"
              >
                {expanded ? 'Hide' : 'Show'} who was emailed ({details.length})
              </button>
              {expanded && (
                <ul className="mt-1.5 space-y-0.5 font-normal max-h-48 overflow-y-auto">
                  {details.map((d, i) => (
                    <li key={i} className="flex items-baseline gap-1.5">
                      <span className="font-semibold">{d.name}</span>
                      <span className="opacity-60">→</span>
                      <span className="font-mono break-all opacity-80">{d.to}</span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function LoadingRow({ label }: { label: string }) {
  return (
    <div className="flex items-center gap-2 px-4 py-6 text-slate-400">
      <Loader2 size={13} className="animate-spin" />
      <span className="text-xs">{label}</span>
    </div>
  );
}

function EmptyState({ icon, label }: { icon: React.ReactNode; label: string }) {
  return (
    <div className="flex flex-col items-center justify-center py-10 text-slate-400">
      <div className="mb-2 opacity-40">{icon}</div>
      <p className="text-xs font-medium">{label}</p>
    </div>
  );
}

function SpStatPill({ icon, label, value, color }: { icon: React.ReactNode; label: string; value: number; color: 'blue' | 'green' | 'amber' | 'gray' }) {
  const map: Record<string, string> = {
    blue:  'bg-blue-50 border-blue-200 text-blue-700',
    green: 'bg-emerald-50 border-emerald-200 text-emerald-700',
    amber: 'bg-amber-50 border-amber-200 text-amber-700',
    gray:  'bg-slate-100 border-slate-200 text-slate-500',
  }
  return (
    <div className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full border text-xs font-semibold ${map[color]}`}>
      {icon}
      {value} {label}
    </div>
  )
}

function SpProposalPanel({ proposal, onClose, studentNames }: { proposal: SpProposal; onClose: () => void; studentNames: Record<string, string> }) {
  void studentNames
  const { assignments, unmatched } = proposal
  const byBlock: Record<string, SpSlotAssignment[]> = {}
  for (const a of assignments) {
    const key = a.blocks[0] ?? 'unknown'
    ;(byBlock[key] = byBlock[key] ?? []).push(a)
  }
  const sortedKeys = Object.keys(byBlock).sort()
  return (
    <div className="bg-white rounded-xl border border-indigo-200 overflow-hidden shadow-sm">
      <div className="flex items-center justify-between px-4 py-3 bg-indigo-50 border-b border-indigo-200">
        <div className="flex items-center gap-2">
          <Play className="w-4 h-4 text-indigo-600" />
          <span className="text-sm font-bold text-indigo-900">Scheduler Proposal</span>
          <span className="text-xs bg-indigo-100 text-indigo-700 px-2 py-0.5 rounded-full font-semibold">
            {assignments.length} placed · {unmatched.length} unmatched
          </span>
        </div>
        <button onClick={onClose} className="p-1 rounded hover:bg-indigo-100 text-indigo-400">
          <X className="w-4 h-4" />
        </button>
      </div>
      <div className="p-4 space-y-4">
        {sortedKeys.length > 0 && (
          <div>
            <p className="text-xs font-bold text-slate-500 uppercase tracking-wide mb-2">Placed</p>
            <div className="space-y-2">
              {sortedKeys.map(blockKey => {
                const parsed = parseSpBlock(blockKey)
                const slotLabel = parsed ? `${DOW_LABELS[parsed.dow] ?? `Day ${parsed.dow}`} ${formatTime(parsed.time)}` : blockKey
                return (
                  <div key={blockKey} className="rounded-lg border border-slate-200 overflow-hidden">
                    <div className="bg-slate-50 px-3 py-1.5 text-xs font-bold text-slate-700 border-b border-slate-200">{slotLabel}</div>
                    <ul className="divide-y divide-slate-100">
                      {byBlock[blockKey].map((a, i) => (
                        <li key={i} className="flex items-center gap-2 px-3 py-2 text-xs">
                          <span className={`px-1.5 py-0.5 rounded border text-[10px] font-bold ${spChoiceBadge(a.choiceUsed)}`}>C{a.choiceUsed}</span>
                          <span className="font-semibold text-slate-800">{a.studentName}</span>
                          {a.subject && <span className="text-slate-400">· {a.subject}</span>}
                          <span className="ml-auto text-slate-500">{a.tutorName}</span>
                          {a.blocks.length === 2 && <span className="text-indigo-600 font-semibold">2h</span>}
                        </li>
                      ))}
                    </ul>
                  </div>
                )
              })}
            </div>
          </div>
        )}
        {unmatched.length > 0 && (
          <div>
            <p className="text-xs font-bold text-slate-500 uppercase tracking-wide mb-2">Unmatched ({unmatched.length})</p>
            <ul className="space-y-1">
              {unmatched.map((u, i) => (
                <li key={i} className="flex items-start gap-2 text-xs bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">
                  <AlertTriangle className="w-3.5 h-3.5 text-amber-500 shrink-0 mt-0.5" />
                  <span>
                    <span className="font-semibold text-slate-800">{u.studentName}</span>
                    {u.subject && <span className="text-slate-500"> · {u.subject}</span>}
                    <span className="text-amber-700 ml-1">— {u.reason}</span>
                  </span>
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>
    </div>
  )
}

