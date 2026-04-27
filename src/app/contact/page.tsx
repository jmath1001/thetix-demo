'use client';
import { useState, useEffect, useCallback } from 'react';
import { supabase } from '@/lib/supabaseClient';
import { DB, withCenter } from '@/lib/db';
import {
  Mail, Send, Clock, Check, AlertCircle, Edit3, Save,
  X, RefreshCw, ChevronDown, ChevronUp, Users, Calendar,
  Megaphone, Loader2,
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
};

const baseInputCls = 'w-full rounded border border-slate-200 bg-white px-3 py-2 text-sm text-slate-800 outline-none focus:border-slate-400 focus:ring-2 focus:ring-slate-100';

function toISODate(d: Date) { return d.toISOString().split('T')[0]; }
function tomorrow() { const d = new Date(); d.setDate(d.getDate() + 1); return toISODate(d); }
function formatSentAt(iso: string) {
  try { return new Date(iso).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }); }
  catch { return iso; }
}

function applyTemplate(template: string, values: Record<string, string>) {
  return template.replace(/{{\s*(name|date|time|link)\s*}}/gi, (_, key: string) => values[key.toLowerCase()] ?? '');
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

  // Announcement blast state
  const [blastTermId, setBlastTermId]                       = useState('');
const [blastSubject, setBlastSubject]                     = useState('Availability Is Now Open – Submit Your Preferences');
  const [blastBody, setBlastBody]                           = useState("Hi {{name}},\n\nWe're now collecting availability for the upcoming term. Please use the link below to submit your preferred schedule.\n\n{{link}}\n\nThank you,\n{{center}}");
  const [blastRecipients, setBlastRecipients]               = useState<BlastRecipient[]>([]);
  const [blastSelected, setBlastSelected]                   = useState<Set<string>>(new Set());
  const [loadingBlastRecipients, setLoadingBlastRecipients] = useState(false);
  const [blastSending, setBlastSending]                     = useState(false);
  const [blastConfirm, setBlastConfirm]                     = useState(false);
  const [blastResult, setBlastResult]                       = useState<{ sent: number; failed: number; errors: string[]; mode?: string; redirectedTo?: string | null } | null>(null);
  const [blastExpanded, setBlastExpanded]                   = useState(false);
  const [editingBlastTemplate, setEditingBlastTemplate]     = useState(false);

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
        supabase.from(DB.students).select('id, name, email, mom_email, dad_email')
      ).order('name', { ascending: true });
      if (error) throw error;
      const recipients: BlastRecipient[] = (data ?? [])
        .map((s: any) => ({
          studentId: s.id,
          studentName: s.name ?? 'â€”',
          studentEmail: s.email ?? null,
          momEmail: s.mom_email ?? null,
          dadEmail: s.dad_email ?? null,
        }))
        .filter((r: BlastRecipient) => r.studentEmail || r.momEmail || r.dadEmail);
      setBlastRecipients(recipients);
      setBlastSelected(new Set(recipients.map((r: BlastRecipient) => r.studentId)));
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
            dad_email
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
          studentName:  student?.name ?? 'â€”',
          sessionDate:  sess?.session_date ?? date,
          sessionTime:  sess?.time ?? '',
          tutorName:    tutor?.name ?? 'â€”',
          studentEmail: student?.email ?? null,
          momEmail:     student?.mom_email ?? null,
          dadEmail:     student?.dad_email ?? null,
          reminderSent: !!r.reminder_sent,
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
      setSelected(new Set(filteredRows.filter((r: Candidate) => !r.reminderSent && (r.studentEmail || r.momEmail || r.dadEmail)).map((r: Candidate) => r.rowId)));
    } catch (e: any) {
      console.error('Failed to load candidates:', e);
      setCandidates([]);
    }

    setLoadingCandidates(false);
  }, []);

  useEffect(() => { fetchSettings(); fetchLogs(); fetchTerms(); fetchBlastRecipients(); }, [fetchSettings, fetchLogs, fetchTerms, fetchBlastRecipients]);
  useEffect(() => { fetchCandidates(dispatchDate, selectedTermId || undefined); }, [dispatchDate, selectedTermId, fetchCandidates]);

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

  const selectedBlastTerm = terms.find(t => t.id === blastTermId);
  const blastLinkPreview = typeof window !== 'undefined'
    ? `${window.location.origin}/booking?termId=${blastTermId}`
    : `https://example.com/booking?termId=${blastTermId}`;

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

  return (
    <div className="min-h-screen bg-slate-50 px-4 py-5">
      <div className="mx-auto w-full max-w-5xl rounded-2xl border border-slate-200 bg-white shadow-sm">

        {/* â”€â”€â”€ Page Header â”€â”€â”€ */}
        <div className="flex items-center gap-3 border-b border-slate-100 px-5 py-4">
          <div className="flex h-8 w-8 items-center justify-center rounded bg-slate-900 text-white">
            <Mail size={15} />
          </div>
          <div>
            <p className="text-[10px] font-bold uppercase tracking-widest text-slate-400">Operations</p>
            <h1 className="text-base font-bold text-slate-900">Contact Center</h1>
          </div>
        </div>

        <div className="space-y-5 p-5">

          {/* â”€â”€â”€ Send Reminders â”€â”€â”€ */}
          <div className="rounded-lg border border-slate-200 bg-slate-50 p-4">
            <div className="mb-3 flex flex-wrap items-start justify-between gap-3">
              <div>
                <p className="text-[10px] font-bold uppercase tracking-widest text-slate-400">Send Reminders</p>
                <p className="text-xs text-slate-500">Dispatch session reminders. Two-step confirmation enabled.</p>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <div className="flex items-center gap-1.5 rounded border border-slate-200 bg-white px-2.5 py-1.5">
                  <Calendar size={11} className="text-slate-400" />
                  <input
                    type="date"
                    value={dispatchDate}
                    onChange={e => setDispatchDate(e.target.value)}
                    className="bg-transparent text-xs text-slate-700 outline-none"
                  />
                </div>
                <div className="flex items-center gap-1.5 rounded border border-slate-200 bg-white px-2.5 py-1.5">
                  <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400">Term</span>
                  <select
                    value={selectedTermId}
                    onChange={e => setSelectedTermId(e.target.value)}
                    className="bg-transparent text-xs text-slate-700 outline-none"
                  >
                    {terms.length === 0 && <option value="">No terms</option>}
                    {terms.map(term => (
                      <option key={term.id} value={term.id}>{term.name}</option>
                    ))}
                  </select>
                </div>
              </div>
            </div>

            {sendResult && (
              <div className={`mb-3 flex items-start gap-2 rounded border px-3 py-2.5 text-xs font-semibold ${sendResult.failed > 0 ? 'border-red-200 bg-red-50 text-red-700' : 'border-emerald-200 bg-emerald-50 text-emerald-700'}`}>
                {sendResult.failed > 0 ? <AlertCircle size={13} className="mt-0.5 shrink-0" /> : <Check size={13} className="mt-0.5 shrink-0" />}
                <div>
                  {sendResult.mode === 'redirect' && sendResult.redirectedTo && (
                    <p>Protected mode â€” redirected to {sendResult.redirectedTo}.</p>
                  )}
                  {sendResult.skipped && sendResult.reason && <p>{sendResult.reason}</p>}
                  {sendResult.sent > 0 && <p>{sendResult.sent} reminder{sendResult.sent !== 1 ? 's' : ''} sent.</p>}
                  {sendResult.failed > 0 && <p>{sendResult.failed} failed.{sendResult.errors[0] ? ` (${sendResult.errors[0]})` : ''}</p>}
                </div>
              </div>
            )}

            {!loadingCandidates && candidates.length > 0 && (
              <div className="mb-3 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                <label className="flex cursor-pointer select-none items-center gap-2">
                  <div
                    onClick={toggleAll}
                    className="flex h-4 w-4 shrink-0 cursor-pointer items-center justify-center rounded transition-all"
                    style={{ background: allChecked ? '#0f172a' : someChecked ? '#e2e8f0' : 'white', border: `2px solid ${allChecked || someChecked ? '#0f172a' : '#d1d5db'}` }}
                  >
                    {allChecked && <Check size={9} color="white" strokeWidth={3} />}
                    {someChecked && !allChecked && <div className="h-1.5 w-1.5 rounded-sm bg-slate-700" />}
                  </div>
                  <span className="text-xs font-semibold text-slate-700">
                    {allChecked ? 'Deselect all' : `Select all unsent (${selectableIds.length})`}
                  </span>
                </label>
                <button
                  onClick={handleSend}
                  disabled={selected.size === 0 || sending}
                  className="inline-flex items-center justify-center gap-1.5 rounded px-3 py-1.5 text-xs font-semibold text-white disabled:opacity-50"
                  style={{ background: confirmSend ? '#92400e' : '#0f172a' }}
                >
                  {sending
                    ? <><Loader2 size={12} className="animate-spin" /> Sendingâ€¦</>
                    : confirmSend
                      ? <><AlertCircle size={12} /> Confirm â€” send to {selected.size}</>
                      : <><Send size={12} /> Send to {selected.size}</>}
                </button>
              </div>
            )}

            {loadingCandidates ? (
              <div className="flex items-center gap-2 py-4 text-slate-400">
                <Loader2 size={13} className="animate-spin" />
                <span className="text-xs">Loading sessions for {dispatchDate}â€¦</span>
              </div>
            ) : candidates.length === 0 ? (
              <div className="rounded border border-dashed border-slate-200 bg-white py-8 text-center">
                <Users size={22} className="mx-auto mb-2 text-slate-300" />
                <p className="text-xs font-semibold text-slate-400">No sessions found for {dispatchDate}</p>
              </div>
            ) : (
              <div className="overflow-hidden rounded border border-slate-200 bg-white">
                {candidates.map((c, i) => {
                  const noEmail    = !c.studentEmail && !c.momEmail && !c.dadEmail;
                  const isDisabled = noEmail || c.reminderSent;
                  const isChecked  = selected.has(c.rowId);
                  return (
                    <div
                      key={c.rowId}
                      className="flex items-center gap-3 px-3 py-3 transition-colors"
                      style={{ borderTop: i > 0 ? '1px solid #f1f5f9' : 'none', background: c.reminderSent ? '#f8fafc' : 'white', opacity: noEmail ? 0.45 : 1, cursor: isDisabled ? 'default' : 'pointer' }}
                      onClick={() => !isDisabled && toggleWithConfirmReset(c.rowId)}
                    >
                      <div
                        className="flex h-4 w-4 shrink-0 items-center justify-center rounded transition-all"
                        style={{ background: isChecked ? '#0f172a' : 'white', border: `2px solid ${isChecked ? '#0f172a' : isDisabled ? '#e5e7eb' : '#d1d5db'}` }}
                      >
                        {isChecked && <Check size={9} color="white" strokeWidth={3} />}
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex flex-wrap items-center gap-1.5">
                          <p className="text-sm font-semibold" style={{ color: c.reminderSent ? '#94a3b8' : '#0f172a' }}>{c.studentName}</p>
                          {c.reminderSent && (
                            <span className="inline-flex items-center gap-1 rounded-full bg-emerald-100 px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wider text-emerald-700">
                              <Check size={7} strokeWidth={3} /> Sent
                            </span>
                          )}
                          {noEmail && <span className="rounded-full bg-slate-100 px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wider text-slate-400">No email</span>}
                        </div>
                        <div className="mt-0.5 flex flex-wrap items-center gap-2">
                          <span className="text-[11px] text-slate-500">{c.sessionTime} Â· {c.tutorName}</span>
                          {(c.studentEmail || c.momEmail || c.dadEmail) && !c.reminderSent && (
                            <span className="text-[10px] text-slate-400">â†’ {[c.studentEmail, c.momEmail, c.dadEmail].filter(Boolean).join(', ')}</span>
                          )}
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          {/* â”€â”€â”€ Announcement Blast â”€â”€â”€ */}
          <div className="rounded-lg border border-slate-200 bg-slate-50 p-4">
            <div className="flex items-start justify-between gap-3">
              <div>
                <div className="flex items-center gap-2">
                  <Megaphone size={12} className="text-slate-400" />
                  <p className="text-[10px] font-bold uppercase tracking-widest text-slate-400">Announcement Blast</p>
                </div>
                <p className="mt-0.5 text-xs text-slate-500">Send a mass email to all students &amp; parents with a per-term availability link.</p>
              </div>
              <button
                onClick={() => setBlastExpanded(v => !v)}
                className="inline-flex shrink-0 items-center gap-1.5 rounded border border-slate-200 bg-white px-2.5 py-1.5 text-[11px] font-semibold text-slate-700 hover:bg-slate-50"
              >
                {blastExpanded ? <ChevronUp size={11} /> : <ChevronDown size={11} />}
                {blastExpanded ? 'Collapse' : 'Expand'}
              </button>
            </div>

            {blastExpanded && (
              <div className="mt-4 space-y-4">
                {/* Term selector */}
                <div>
                  <label className="mb-1 block text-xs font-semibold text-slate-500">Term (availability link will be scoped to this term)</label>
                  <select
                    value={blastTermId}
                    onChange={e => {
                      const newTermId = e.target.value;
                      setBlastTermId(newTermId);
                      setBlastResult(null);
                      setBlastConfirm(false);
                      const t = terms.find(t => t.id === newTermId);
                      if (t?.name) {
                        setBlastSubject(`Availability Is Now Open for ${t.name} – Submit Your Preferences`);
                        setBlastBody(`Hi {{name}},\n\nWe're now collecting availability for ${t.name}. Please use the link below to submit your preferred schedule.\n\n{{link}}\n\nThank you,\n{{center}}`);
                      }
                    }}
                    className={baseInputCls}
                  >
                    {terms.length === 0 && <option value="">No terms available</option>}
                    {terms.map(t => (
                      <option key={t.id} value={t.id}>{t.name} ({t.status})</option>
                    ))}
                  </select>
                  {blastTermId && (
                    <p className="mt-1 font-mono text-[11px] text-slate-400">{blastLinkPreview}</p>
                  )}
                </div>

                {/* Email template */}
                <div className="overflow-hidden rounded border border-slate-200 bg-white">
                  <div className="flex items-center justify-between border-b border-slate-100 px-3 py-2.5">
                    <p className="text-xs font-semibold text-slate-700">Email Template</p>
                    <button
                      onClick={() => setEditingBlastTemplate(v => !v)}
                      className="inline-flex items-center gap-1 rounded border border-slate-200 bg-slate-50 px-2 py-1 text-[11px] font-semibold text-slate-600 hover:bg-slate-100"
                    >
                      {editingBlastTemplate ? <><X size={10} /> Close</> : <><Edit3 size={10} /> Edit</>}
                    </button>
                  </div>
                  {!editingBlastTemplate ? (
                    <div className="space-y-1.5 px-3 py-3">
                      <div>
                        <p className="text-[10px] font-bold uppercase tracking-widest text-slate-400">Subject</p>
                        <p className="mt-0.5 text-sm text-slate-700">{blastSubject || '(empty)'}</p>
                      </div>
                      <div>
                        <p className="text-[10px] font-bold uppercase tracking-widest text-slate-400">Body</p>
                        <p className="mt-0.5 line-clamp-3 whitespace-pre-line text-xs text-slate-500">{blastBody || '(empty)'}</p>
                      </div>
                    </div>
                  ) : (
                    <div className="space-y-3 p-3">
                      <div className="flex flex-wrap items-center gap-1.5">
                        {['{{name}}', '{{link}}', '{{term}}', '{{center}}'].map(v => (
                          <span key={v} className="rounded border border-slate-200 bg-slate-50 px-2 py-0.5 font-mono text-[10px] text-slate-600">{v}</span>
                        ))}
                        <span className="text-[10px] text-slate-400">available variables</span>
                      </div>
                      <div>
                        <label className="mb-1 block text-xs font-semibold text-slate-500">Subject</label>
                        <input value={blastSubject} onChange={e => setBlastSubject(e.target.value)} className={baseInputCls} />
                      </div>
                      <div>
                        <label className="mb-1 block text-xs font-semibold text-slate-500">Body</label>
                        <textarea value={blastBody} onChange={e => setBlastBody(e.target.value)} rows={7} className={`${baseInputCls} resize-none`} style={{ lineHeight: '1.6' }} />
                      </div>
                      {blastTermId && (
                        <div className="space-y-1.5 rounded border border-slate-200 bg-slate-50 p-3">
                          <p className="text-[10px] font-bold uppercase tracking-widest text-slate-400">Preview</p>
                          <p className="text-xs font-semibold text-slate-700">
                            {applyTemplate(blastSubject, {
                              name: 'Alex Student',
                              link: blastLinkPreview,
                              term: selectedBlastTerm?.name ?? '',
                              center: settings?.center_name ?? 'Tutoring Center',
                            })}
                          </p>
                          <p className="whitespace-pre-line text-xs text-slate-500">
                            {applyTemplate(blastBody, {
                              name: 'Alex Student',
                              link: blastLinkPreview,
                              term: selectedBlastTerm?.name ?? '',
                              center: settings?.center_name ?? 'Tutoring Center',
                            })}
                          </p>
                        </div>
                      )}
                    </div>
                  )}
                </div>

                {/* Recipient list */}
                <div>
                  <div className="mb-2 flex items-center justify-between">
                    <p className="text-xs font-semibold text-slate-500">
                      Recipients â€” {blastRecipients.length} student{blastRecipients.length !== 1 ? 's' : ''} with email
                    </p>
                    <label className="flex cursor-pointer select-none items-center gap-1.5 text-xs text-slate-500">
                      <div
                        onClick={toggleBlastAll}
                        className="flex h-4 w-4 shrink-0 cursor-pointer items-center justify-center rounded transition-all"
                        style={{ background: blastAllChecked ? '#0f172a' : blastSomeChecked ? '#e2e8f0' : 'white', border: `2px solid ${blastAllChecked || blastSomeChecked ? '#0f172a' : '#d1d5db'}` }}
                      >
                        {blastAllChecked && <Check size={9} color="white" strokeWidth={3} />}
                        {blastSomeChecked && !blastAllChecked && <div className="h-1.5 w-1.5 rounded-sm bg-slate-700" />}
                      </div>
                      {blastAllChecked ? 'Deselect all' : 'Select all'}
                    </label>
                  </div>

                  {loadingBlastRecipients ? (
                    <div className="flex items-center gap-2 py-4 text-slate-400">
                      <Loader2 size={13} className="animate-spin" />
                      <span className="text-xs">Loading recipientsâ€¦</span>
                    </div>
                  ) : blastRecipients.length === 0 ? (
                    <div className="rounded border border-dashed border-slate-200 bg-white py-6 text-center">
                      <Users size={20} className="mx-auto mb-2 text-slate-300" />
                      <p className="text-xs text-slate-400">No students with email addresses found</p>
                    </div>
                  ) : (
                    <div className="max-h-56 overflow-y-auto rounded border border-slate-200 bg-white">
                      {blastRecipients.map((r, i) => {
                        const isChecked = blastSelected.has(r.studentId);
                        const emails = [r.studentEmail, r.momEmail, r.dadEmail].filter(Boolean);
                        return (
                          <div
                            key={r.studentId}
                            className="flex cursor-pointer items-center gap-3 px-3 py-2.5 transition-colors hover:bg-slate-50"
                            style={{ borderTop: i > 0 ? '1px solid #f1f5f9' : 'none' }}
                            onClick={() => { setBlastConfirm(false); toggleBlast(r.studentId); }}
                          >
                            <div
                              className="flex h-4 w-4 shrink-0 items-center justify-center rounded transition-all"
                              style={{ background: isChecked ? '#0f172a' : 'white', border: `2px solid ${isChecked ? '#0f172a' : '#d1d5db'}` }}
                            >
                              {isChecked && <Check size={9} color="white" strokeWidth={3} />}
                            </div>
                            <div className="min-w-0 flex-1">
                              <p className="text-sm font-semibold text-slate-800">{r.studentName}</p>
                              <p className="truncate text-[10px] text-slate-400">{emails.join(', ')}</p>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>

                {blastResult && (
                  <div className={`flex items-start gap-2 rounded border px-3 py-2.5 text-xs font-semibold ${blastResult.failed > 0 ? 'border-red-200 bg-red-50 text-red-700' : 'border-emerald-200 bg-emerald-50 text-emerald-700'}`}>
                    {blastResult.failed > 0 ? <AlertCircle size={13} className="mt-0.5 shrink-0" /> : <Check size={13} className="mt-0.5 shrink-0" />}
                    <div>
                      {blastResult.mode === 'redirect' && blastResult.redirectedTo && (
                        <p>Protected mode â€” redirected to {blastResult.redirectedTo}.</p>
                      )}
                      {blastResult.sent > 0 && <p>{blastResult.sent} announcement{blastResult.sent !== 1 ? 's' : ''} sent.</p>}
                      {blastResult.failed > 0 && <p>{blastResult.failed} failed.{blastResult.errors[0] ? ` (${blastResult.errors[0]})` : ''}</p>}
                    </div>
                  </div>
                )}

                <div className="flex items-center justify-between gap-3">
                  {!blastTermId && (
                    <p className="text-xs text-amber-600">Select a term to generate the availability link.</p>
                  )}
                  <div className="ml-auto">
                    <button
                      onClick={handleBlastSend}
                      disabled={blastSelected.size === 0 || blastSending || !blastTermId}
                      className="inline-flex items-center gap-1.5 rounded px-3 py-1.5 text-xs font-semibold text-white disabled:opacity-50"
                      style={{ background: blastConfirm ? '#92400e' : '#0f172a' }}
                    >
                      {blastSending
                        ? <><Loader2 size={12} className="animate-spin" /> Sendingâ€¦</>
                        : blastConfirm
                          ? <><AlertCircle size={12} /> Confirm â€” blast to {blastSelected.size}</>
                          : <><Megaphone size={12} /> Blast to {blastSelected.size} student{blastSelected.size !== 1 ? 's' : ''}</>}
                    </button>
                  </div>
                </div>
              </div>
            )}
          </div>

          {/* â”€â”€â”€ Reminder Email Template â”€â”€â”€ */}
          <div className="rounded-lg border border-slate-200 bg-slate-50 p-4">
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="text-[10px] font-bold uppercase tracking-widest text-slate-400">Reminder Email Template</p>
                <p className="text-xs text-slate-500">Subject and body used for session reminder emails.</p>
              </div>
              {!editingTemplate ? (
                <button
                  onClick={() => setEditingTemplate(true)}
                  className="inline-flex shrink-0 items-center gap-1.5 rounded border border-slate-200 bg-white px-2.5 py-1.5 text-[11px] font-semibold text-slate-700 hover:bg-slate-50"
                >
                  <Edit3 size={10} /> Edit
                </button>
              ) : (
                <div className="flex items-center gap-2">
                  <button onClick={cancelEdit} className="inline-flex items-center gap-1 rounded border border-slate-200 bg-white px-2.5 py-1.5 text-[11px] font-semibold text-slate-600 hover:bg-slate-50">
                    <X size={10} /> Cancel
                  </button>
                  <button onClick={saveTemplate} disabled={savingTemplate || loadingSettings || !!settingsError} className="inline-flex items-center gap-1 rounded bg-slate-900 px-2.5 py-1.5 text-[11px] font-semibold text-white hover:bg-slate-800 disabled:opacity-50">
                    {savingTemplate ? <Loader2 size={10} className="animate-spin" /> : <Save size={10} />} Save
                  </button>
                </div>
              )}
            </div>

            {templateSaved && (
              <div className="mt-3 flex items-center gap-1.5 rounded border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs font-semibold text-emerald-700">
                <Check size={12} /> Template saved
              </div>
            )}
            {settingsError && (
              <div className="mt-3 rounded border border-red-200 bg-red-50 px-3 py-2 text-xs font-medium text-red-700">{settingsError}</div>
            )}

            {editingTemplate && (
              <div className="mt-4 space-y-3">
                {loadingSettings ? (
                  <div className="flex items-center gap-2 py-3 text-slate-400">
                    <Loader2 size={13} className="animate-spin" /><span className="text-xs">Loadingâ€¦</span>
                  </div>
                ) : (
                  <>
                    <div className="flex flex-wrap items-center gap-1.5">
                      {['{{name}}', '{{date}}', '{{time}}', '{{link}}'].map(v => (
                        <span key={v} className="rounded border border-slate-200 bg-white px-2 py-0.5 font-mono text-[10px] text-slate-600">{v}</span>
                      ))}
                      <span className="text-[10px] text-slate-400">available variables</span>
                    </div>
                    <div>
                      <label className="mb-1 block text-xs font-semibold text-slate-500">Subject</label>
                      <input value={draftSubject} onChange={e => setDraftSubject(e.target.value)} className={baseInputCls} />
                    </div>
                    <div>
                      <label className="mb-1 block text-xs font-semibold text-slate-500">Body</label>
                      <textarea value={draftBody} onChange={e => setDraftBody(e.target.value)} rows={8} className={`${baseInputCls} resize-none`} style={{ lineHeight: '1.6' }} />
                    </div>
                    <div className="space-y-2 rounded border border-slate-200 bg-white p-3">
                      <p className="text-[10px] font-bold uppercase tracking-widest text-slate-400">Preview</p>
                      <p className="text-xs font-semibold text-slate-700">{previewSubject}</p>
                      <p className="whitespace-pre-line text-xs text-slate-500">{previewBody}</p>
                    </div>
                  </>
                )}
              </div>
            )}

            {!editingTemplate && !templateSaved && !settingsError && (
              <p className="mt-2 text-xs text-slate-400">Click Edit to update the subject and body used in session reminder emails.</p>
            )}
          </div>

          {/* â”€â”€â”€ Send History â”€â”€â”€ */}
          <div className="rounded-lg border border-slate-200 bg-slate-50 p-4">
            <button className="flex w-full items-center justify-between" onClick={() => setLogsExpanded(v => !v)}>
              <div>
                <div className="flex items-center gap-2">
                  <Clock size={12} className="text-slate-400" />
                  <p className="text-[10px] font-bold uppercase tracking-widest text-slate-400">Send History</p>
                  {logs.length > 0 && (
                    <span className="rounded-full bg-slate-200 px-1.5 py-0.5 text-[10px] font-semibold text-slate-600">{logs.length}</span>
                  )}
                </div>
                <p className="mt-0.5 text-left text-xs text-slate-500">Log of all reminder emails dispatched.</p>
              </div>
              {logsExpanded ? <ChevronUp size={14} className="text-slate-400" /> : <ChevronDown size={14} className="text-slate-400" />}
            </button>

            {logsExpanded && (
              <div className="mt-3 overflow-hidden rounded border border-slate-200 bg-white">
                {loadingLogs ? (
                  <div className="flex items-center gap-2 px-3 py-4 text-slate-400">
                    <Loader2 size={13} className="animate-spin" /><span className="text-xs">Loading historyâ€¦</span>
                  </div>
                ) : logs.length === 0 ? (
                  <div className="px-3 py-8 text-center">
                    <Mail size={20} className="mx-auto mb-2 text-slate-300" />
                    <p className="text-xs text-slate-400">No reminders sent yet</p>
                  </div>
                ) : (
                  Object.entries(groupedLogs).sort(([a], [b]) => b.localeCompare(a)).map(([date, entries]) => (
                    <div key={date}>
                      <div className="flex items-center gap-2 border-b border-slate-100 bg-slate-50 px-3 py-2">
                        <span className="text-[10px] font-bold uppercase tracking-widest text-slate-500">{date}</span>
                        <span className="rounded-full bg-slate-200 px-1.5 py-0.5 text-[10px] font-semibold text-slate-500">{entries.length} sent</span>
                      </div>
                      {entries.map(log => (
                        <div key={log.id} className="flex items-center justify-between border-b border-slate-100 px-3 py-3 last:border-b-0">
                          <div className="flex items-center gap-2.5">
                            <div className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full border border-emerald-200 bg-emerald-50">
                              <Check size={10} className="text-emerald-600" />
                            </div>
                            <div>
                              <p className="text-sm font-semibold text-slate-800">{log.student_name}</p>
                              <p className="text-[11px] text-slate-400">{log.emailed_to}</p>
                            </div>
                          </div>
                          <div className="ml-4 shrink-0 text-right">
                            <p className="text-[11px] font-semibold text-slate-600">{log.session_time}</p>
                            <p className="text-[10px] text-slate-400">{formatSentAt(log.sent_at)}</p>
                          </div>
                        </div>
                      ))}
                    </div>
                  ))
                )}
              </div>
            )}
          </div>

        </div>
      </div>
    </div>
  );
}
