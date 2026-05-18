'use client';
import { useState, useEffect, useCallback } from 'react';
import { supabase } from '@/lib/supabaseClient';
import { DB, withCenter } from '@/lib/db';
import {
  Mail, Send, Clock, Check, AlertCircle, Edit3, Save,
  X, RefreshCw, ChevronDown, ChevronUp, Users, Calendar,
  Megaphone, Loader2, Eye,
} from 'lucide-react';
import { logEvent } from '@/lib/analytics';

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
  reminder_subject: string;
  reminder_body: string;
};

const DEFAULT_SETTINGS: Settings = {
  center_name: 'Tutoring Center',
  center_email: '',
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

const baseInputCls = 'w-full rounded border border-slate-200 bg-white px-3 py-2 text-sm text-slate-800 outline-none focus:border-slate-400 focus:ring-2 focus:ring-slate-100';
const BRAND_BLUE = '#0f172a';
const BRAND_RED = '#991b1b';

function toISODate(d: Date) { return d.toISOString().split('T')[0]; }
function tomorrow() { const d = new Date(); d.setDate(d.getDate() + 1); return toISODate(d); }
function addDaysIso(iso: string, days: number) { const d = new Date(`${iso}T00:00:00`); d.setDate(d.getDate() + days); return toISODate(d); }
function formatSentAt(iso: string) {
  try { return new Date(iso).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }); }
  catch { return iso; }
}

function applyTemplate(template: string, values: Record<string, string>) {
  return template.replace(/{{\s*(name|date|time|link)\s*}}/gi, (_, key: string) => values[key.toLowerCase()] ?? '');
}

function buildAnnouncementHtml(centerName: string, bodyText: string, availabilityLink: string) {
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

function buildScheduleHtml(centerName: string, tutorName: string, schedule: ScheduleEntry[], periodLabel: string): string {
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
      </td></tr>
    </table>
    </td></tr>
  </table>
</body>
</html>`;
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
  const [selectedTermId, setSelectedTermId]       = useState('');
  const [candidates, setCandidates]               = useState<Candidate[]>([]);
  const [loadingCandidates, setLoadingCandidates] = useState(false);
  const [selected, setSelected]                   = useState<Set<string>>(new Set());
  const [sending, setSending]                     = useState(false);
  const [confirmSend, setConfirmSend]             = useState(false);
  const [sendResult, setSendResult]               = useState<{ sent: number; failed: number; errors: string[]; mode?: string; redirectedTo?: string | null; skipped?: boolean; reason?: string } | null>(null);

  const [logs, setLogs]                 = useState<Log[]>([]);
  const [loadingLogs, setLoadingLogs]   = useState(true);
  const [logsExpanded, setLogsExpanded] = useState(false);

  // Availability email blast state (per-term, sends booking link)
  const [blastTermId, setBlastTermId]                       = useState('');
  const [blastSubject, setBlastSubject]                     = useState('');
  const [blastBody, setBlastBody]                           = useState('');
  const [blastRecipients, setBlastRecipients]               = useState<BlastRecipient[]>([]);
  const [blastSelected, setBlastSelected]                   = useState<Set<string>>(new Set());
  const [loadingBlastRecipients, setLoadingBlastRecipients] = useState(false);
  const [blastSending, setBlastSending]                     = useState(false);
  const [blastConfirm, setBlastConfirm]                     = useState(false);
  const [blastResult, setBlastResult]                       = useState<{ sent: number; failed: number; errors: string[]; mode?: string; redirectedTo?: string | null } | null>(null);
  const [blastExpanded, setBlastExpanded]                   = useState(false);
  const [editingBlastTemplate, setEditingBlastTemplate]     = useState(false);

  // General email blast state (freeform, no term required)
  const [generalSubject, setGeneralSubject]   = useState('');
  const [generalBody, setGeneralBody]         = useState('');
  const [generalSelected, setGeneralSelected] = useState<Set<string>>(new Set());
  const [generalSending, setGeneralSending]   = useState(false);
  const [generalConfirm, setGeneralConfirm]   = useState(false);
  const [generalResult, setGeneralResult]     = useState<{ sent: number; failed: number; errors: string[]; mode?: string; redirectedTo?: string | null } | null>(null);
  const [generalExpanded, setGeneralExpanded] = useState(false);

  // Tutor schedule email state
  const [tutorSchedExpanded, setTutorSchedExpanded]   = useState(false);
  const [tutorSchedWeek, setTutorSchedWeek]           = useState(() => {
    const d = new Date(); const dow = d.getDay(); d.setDate(d.getDate() + (dow === 0 ? -6 : 1 - dow)); return toISODate(d);
  });
  const [tutorsWithEmail, setTutorsWithEmail]         = useState<{ id: string; name: string; email: string }[]>([]);
  const [tutorSchedSending, setTutorSchedSending]     = useState(false);
  const [tutorSchedResult, setTutorSchedResult]       = useState<{ sent: number; failed: number; errors: string[]; mode?: string; redirectedTo?: string | null; skipped?: boolean; reason?: string } | null>(null);
  const [previewModal, setPreviewModal]               = useState<EmailPreview | null>(null);
  const [previewLoading, setPreviewLoading]           = useState(false);

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
      setSelectedTermId(preferred?.id ?? '');
      setBlastTermId(preferred?.id ?? '');
      if (preferred?.name) {
        setBlastSubject(`Availability Is Now Open for ${preferred.name} – Submit Your Preferences`);
        setBlastBody(`Hi {{name}},\n\nWe're now collecting availability for ${preferred.name}. Please use the link below to submit your preferred schedule.\n\n{{link}}\n\nThank you,\n{{center}}`);
      }
    } catch (err) {
      console.error('Failed to load terms:', err);
      setTerms([]);
      setSelectedTermId('');
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

  const fetchCandidates = useCallback(async (date: string, termId?: string) => {
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

      let filteredRows = rows;
      if (termId) {
        const { data: enrollmentRows, error: enrollmentError } = await withCenter(
          supabase
            .from(DB.termEnrollments)
            .select('student_id')
            .eq('term_id', termId)
        );
        if (enrollmentError) throw enrollmentError;

        const enrolledStudentIds = new Set((enrollmentRows ?? []).map((row: any) => row.student_id));
        filteredRows = rows.filter(row => enrolledStudentIds.has(row.studentId));
      }

      setCandidates(filteredRows);
      setSelected(new Set(filteredRows.filter((r: Candidate) =>
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
  useEffect(() => { fetchCandidates(dispatchDate, selectedTermId || undefined); }, [dispatchDate, selectedTermId, fetchCandidates]);

  const handleSendTutorSchedules = async () => {
    setTutorSchedSending(true);
    setTutorSchedResult(null);
    try {
      const res = await fetch('/api/send-tutor-schedule', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tutorIds: tutorsWithEmail.map(t => t.id), mode: 'weekly', date: tutorSchedWeek }),
      });
      const data = await res.json();
      if (!res.ok) setTutorSchedResult({ sent: 0, failed: tutorsWithEmail.length, errors: [data.error ?? 'Request failed'] });
      else setTutorSchedResult(data);
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
          termId: selectedTermId || null,
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
        });
        logEvent('reminder_sent', { sent: data.sent ?? 0, failed: data.failed ?? 0, date: dispatchDate });
        await Promise.all([fetchCandidates(dispatchDate, selectedTermId || undefined), fetchLogs()]);
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
        });
        logEvent('reminder_sent', { sent: data.sent ?? 0, termId: blastTermId });
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
        });
        logEvent('reminder_sent', { sent: data.sent ?? 0 });
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
      html: buildPreviewFrameHtml(subject, buildAnnouncementHtml(sampleCenter, body, blastTermId ? sampleLink : '')),
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
      html: buildPreviewFrameHtml(subject, buildAnnouncementHtml(sampleCenter, body, '')),
      note: `Previewing ${sampleName}.`,
    });
  };

  const openTutorSchedulePreview = async () => {
    const previewTutor = tutorsWithEmail[0];
    if (!previewTutor) {
      setPreviewLoading(false);
      setPreviewModal({
        title: 'Tutor Weekly Schedule Preview',
        subject: 'No tutor available',
        html: buildPreviewFrameHtml('No tutor available', '<!DOCTYPE html><html><body style="margin:0;padding:32px;font-family:ui-sans-serif,system-ui,sans-serif;background:#f8fafc;color:#0f172a;"><p style="font-size:14px;font-weight:700;">No tutors with email addresses are available to preview.</p></body></html>'),
        note: 'Add a tutor email to preview a weekly schedule.',
      });
      return;
    }

    setPreviewLoading(true);
    try {
      const fromDate = tutorSchedWeek;
      const toDate = addDaysIso(fromDate, 6);
      const startFmt = new Date(`${fromDate}T00:00:00`).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
      const endFmt = new Date(`${toDate}T00:00:00`).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
      const periodLabel = `Week of ${startFmt}–${endFmt}`;
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

      const centerName = settings?.center_name ?? DEFAULT_SETTINGS.center_name;
      const subject = `Your weekly schedule — ${periodLabel}`;
      const html = buildScheduleHtml(centerName, previewTutor.name ?? 'Tutor', schedule, periodLabel);
      setPreviewModal({
        title: 'Tutor Weekly Schedule Preview',
        subject,
        html: buildPreviewFrameHtml(subject, html),
        note: `Previewing ${previewTutor.name ?? 'Tutor'} for ${periodLabel}.`,
      });
    } catch (error: any) {
      setPreviewModal({
        title: 'Tutor Weekly Schedule Preview',
        subject: 'Preview unavailable',
        html: buildPreviewFrameHtml('Preview unavailable', `<div style="padding:32px;font-family:ui-sans-serif,system-ui,sans-serif;color:#991b1b;background:#fff;">${error?.message ?? 'Failed to load preview.'}</div>`),
        note: error?.message ?? 'Failed to load preview.',
      });
    } finally {
      setPreviewLoading(false);
    }
  };

  const [activeTab, setActiveTab] = useState<'reminders' | 'availability' | 'general' | 'tutor' | 'template' | 'history'>('reminders');

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

      {/* ── Page header ────────────────────────────────────────────────── */}
      <div className="border-b border-slate-200 bg-white px-6 py-4">
        <div className="mx-auto max-w-4xl flex items-center gap-3">
          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-slate-900 text-white">
            <Mail size={16} />
          </div>
          <div>
            <h1 className="text-lg font-bold text-slate-900 leading-tight">Contact Center</h1>
            <p className="text-xs text-slate-500">Send emails, reminders, and announcements</p>
          </div>
        </div>
      </div>

      {/* ── Tab bar ─────────────────────────────────────────────────────── */}
      <div className="border-b border-slate-200 bg-white px-6">
        <div className="mx-auto max-w-4xl">
          <nav className="flex gap-1 overflow-x-auto">
            {([
              { id: 'reminders',    label: 'Reminders',         icon: <Send size={13} /> },
              { id: 'availability', label: 'Availability',      icon: <Megaphone size={13} /> },
              { id: 'general',      label: 'General Blast',     icon: <Mail size={13} /> },
              { id: 'tutor',        label: 'Tutor Schedules',   icon: <Calendar size={13} /> },
              { id: 'template',     label: 'Email Template',    icon: <Edit3 size={13} /> },
              { id: 'history',      label: 'Send History',      icon: <Clock size={13} />, badge: logs.length || null },
            ] as const).map(tab => (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id)}
                className={`flex shrink-0 items-center gap-1.5 border-b-2 px-3 py-3 text-xs font-semibold transition-colors ${
                  activeTab === tab.id
                    ? 'border-indigo-600 text-indigo-600'
                    : 'border-transparent text-slate-500 hover:text-slate-800'
                }`}
              >
                {tab.icon}
                {tab.label}
                {'badge' in tab && tab.badge ? (
                  <span className="rounded-full bg-slate-200 px-1.5 py-0.5 text-[10px] font-bold text-slate-600">{tab.badge}</span>
                ) : null}
              </button>
            ))}
          </nav>
        </div>
      </div>

      {/* ── Tab panels ──────────────────────────────────────────────────── */}
      <div className="mx-auto max-w-4xl px-6 py-6">

        {/* ── REMINDERS ─────────────────────────────────────────────────── */}
        {activeTab === 'reminders' && (
          <div className="space-y-4">
            <SectionHeader
              icon={<Send size={15} className="text-indigo-600" />}
              title="Send Session Reminders"
              description="Select a date, pick the students to remind, and dispatch. A second click confirms before sending."
            />

            {/* Controls row */}
            <div className="flex flex-wrap items-end gap-3 rounded-xl border border-slate-200 bg-white p-4">
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
              <div>
                <label className="mb-1 block text-xs font-semibold text-slate-600">Filter by term</label>
                <select
                  value={selectedTermId}
                  onChange={e => setSelectedTermId(e.target.value)}
                  className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-800 outline-none focus:border-indigo-400"
                >
                  {terms.length === 0 && <option value="">No terms</option>}
                  {terms.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
                </select>
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
              />
            )}

            {/* Candidate list */}
            <div className="overflow-hidden rounded-xl border border-slate-200 bg-white">
              <div className="flex items-center justify-between border-b border-slate-100 px-4 py-3">
                <div className="flex items-center gap-2">
                  {selectableIds.length > 0 && (
                    <Checkbox checked={allChecked} indeterminate={someChecked && !allChecked} onChange={toggleAll} />
                  )}
                  <span className="text-xs font-semibold text-slate-600">
                    {loadingCandidates ? 'Loading…' : `${candidates.length} student${candidates.length !== 1 ? 's' : ''} on ${dispatchDate}`}
                  </span>
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
                <ul className="divide-y divide-slate-100">
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
                <div className="border-t border-slate-100 bg-slate-50 px-4 py-3 flex justify-end">
                  <SendButton
                    onClick={handleSend}
                    loading={sending}
                    confirm={confirmSend}
                    count={selected.size}
                    disabled={selected.size === 0 || sending}
                    label="Send reminders"
                  />
                </div>
              )}
            </div>
          </div>
        )}

        {/* ── AVAILABILITY BLAST ──────────────────────────────────────────── */}
        {activeTab === 'availability' && (
          <div className="space-y-4">
            <SectionHeader
              icon={<Megaphone size={15} className="text-indigo-600" />}
              title="Availability Email Blast"
              description="Send enrollment links to students and parents for a specific term. Recipients click the link to submit their preferred schedule."
            />

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
                  <div className="flex items-center justify-between border-b border-slate-100 px-4 py-3">
                    <p className="text-xs font-bold text-slate-700 uppercase tracking-wide">Email Template</p>
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
                <div className="flex items-center justify-between border-b border-slate-100 px-4 py-3">
                  <p className="text-xs font-bold text-slate-700 uppercase tracking-wide">
                    Recipients <span className="text-slate-400 font-normal normal-case">({blastRecipients.length})</span>
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
                    <ResultBanner sent={blastResult.sent} failed={blastResult.failed} errors={blastResult.errors} mode={blastResult.mode} redirectedTo={blastResult.redirectedTo} />
                  )}
                  {!blastTermId && (
                    <p className="text-[11px] text-amber-600 font-medium">⚠ Select a term first to generate the availability link.</p>
                  )}
                  <div className="flex items-center justify-between gap-2 flex-wrap">
                    <button onClick={openAvailabilityFormPreview} disabled={!blastTermId} className="inline-flex items-center gap-1 text-xs text-slate-500 hover:text-slate-700 disabled:opacity-40">
                      <Eye size={11} /> Preview form
                    </button>
                    <SendButton
                      onClick={handleBlastSend}
                      loading={blastSending}
                      confirm={blastConfirm}
                      count={blastSelected.size}
                      disabled={blastSelected.size === 0 || blastSending || !blastTermId}
                      label="Send availability"
                    />
                  </div>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* ── GENERAL BLAST ───────────────────────────────────────────────── */}
        {activeTab === 'general' && (
          <div className="space-y-4">
            <SectionHeader
              icon={<Mail size={15} className="text-indigo-600" />}
              title="General Email Blast"
              description="Write any message and send it to any students and parents. No term required."
            />

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
                <div className="flex items-center justify-between border-b border-slate-100 px-4 py-3">
                  <p className="text-xs font-bold text-slate-700 uppercase tracking-wide">
                    Recipients <span className="text-slate-400 font-normal normal-case">({blastRecipients.length})</span>
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
                    <ResultBanner sent={generalResult.sent} failed={generalResult.failed} errors={generalResult.errors} mode={generalResult.mode} redirectedTo={generalResult.redirectedTo} />
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
            <SectionHeader
              icon={<Calendar size={15} className="text-indigo-600" />}
              title="Tutor Weekly Schedules"
              description="Email each tutor a summary of their sessions for the selected week."
            />

            <div className="rounded-xl border border-slate-200 bg-white p-5 space-y-5">
              <div className="flex flex-wrap items-end gap-4">
                <div>
                  <label className="mb-1 block text-xs font-semibold text-slate-700">Week starting (Monday)</label>
                  <input
                    type="date"
                    value={tutorSchedWeek}
                    onChange={e => { setTutorSchedWeek(e.target.value); setTutorSchedResult(null); }}
                    className={`${baseInputCls} w-auto`}
                  />
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
          </div>
        )}

        {/* ── TEMPLATE ────────────────────────────────────────────────────── */}
        {activeTab === 'template' && (
          <div className="space-y-4">
            <SectionHeader
              icon={<Edit3 size={15} className="text-indigo-600" />}
              title="Reminder Email Template"
              description="Customize the subject and body used when session reminders are sent. Variables are replaced with real data when sending."
            />

            {settingsError && (
              <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700 flex items-center gap-2">
                <AlertCircle size={14} /> {settingsError}
              </div>
            )}
            {templateSaved && (
              <div className="rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-700 flex items-center gap-2">
                <Check size={14} /> Template saved successfully
              </div>
            )}

            <div className="rounded-xl border border-slate-200 bg-white overflow-hidden">
              <div className="flex items-center justify-between border-b border-slate-100 px-4 py-3">
                <p className="text-xs font-bold text-slate-700 uppercase tracking-wide">Template</p>
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
                    <p className="text-[10px] text-slate-400">Click <strong>Edit</strong> to change the subject or body. Use variables: <code className="text-slate-600">{`{{name}}`}</code>, <code className="text-slate-600">{`{{date}}`}</code>, <code className="text-slate-600">{`{{time}}`}</code>, <code className="text-slate-600">{`{{link}}`}</code></p>
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

        {/* ── HISTORY ─────────────────────────────────────────────────────── */}
        {activeTab === 'history' && (
          <div className="space-y-4">
            <SectionHeader
              icon={<Clock size={15} className="text-indigo-600" />}
              title="Send History"
              description="A log of all reminder emails that have been dispatched."
            />

            <div className="overflow-hidden rounded-xl border border-slate-200 bg-white">
              {loadingLogs ? (
                <LoadingRow label="Loading history…" />
              ) : logs.length === 0 ? (
                <EmptyState icon={<Mail size={24} />} label="No reminders sent yet" />
              ) : (
                <div>
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

      </div>

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

function SectionHeader({ icon, title, description }: { icon: React.ReactNode; title: string; description: string }) {
  return (
    <div className="flex items-start gap-3 rounded-xl border border-slate-200 bg-white px-4 py-3.5">
      <div className="mt-0.5">{icon}</div>
      <div>
        <h2 className="text-sm font-bold text-slate-900">{title}</h2>
        <p className="text-xs text-slate-500 mt-0.5">{description}</p>
      </div>
    </div>
  );
}

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
    student.studentEmail ? { addr: student.studentEmail, notify: student.notifyStudent } : null,
    student.momEmail     ? { addr: student.momEmail,     notify: student.notifyMom }     : null,
    student.dadEmail     ? { addr: student.dadEmail,     notify: student.notifyDad }     : null,
  ].filter(Boolean) as { addr: string; notify: boolean }[];

  return (
    <>
      {entries.map((x, i) => (
        <span key={i} style={x.notify ? {} : { textDecoration: 'line-through', opacity: 0.5 }}>
          {i > 0 ? ', ' : ''}{x.addr}
        </span>
      ))}
    </>
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

function ResultBanner({ sent, failed, errors, mode, redirectedTo, skipped, reason }: { sent: number; failed: number; errors: string[]; mode?: string; redirectedTo?: string | null; skipped?: boolean; reason?: string }) {
  const isSuccess = failed === 0 && !skipped;
  return (
    <div className={`flex items-start gap-2 rounded-lg border px-3 py-2.5 text-xs font-semibold ${isSuccess ? 'border-emerald-200 bg-emerald-50 text-emerald-700' : 'border-amber-200 bg-amber-50 text-amber-700'}`}>
      {isSuccess ? <Check size={13} className="mt-0.5 shrink-0" /> : <AlertCircle size={13} className="mt-0.5 shrink-0" />}
      <div className="space-y-0.5">
        {skipped && reason && <p>{reason}</p>}
        {mode === 'redirect' && redirectedTo && <p>Protected mode — redirected to {redirectedTo}.</p>}
        {sent > 0 && <p>{sent} email{sent !== 1 ? 's' : ''} sent successfully.</p>}
        {failed > 0 && <p>{failed} failed.{errors[0] ? ` ${errors[0]}` : ''}</p>}
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

