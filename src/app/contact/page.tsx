'use client';
import { useState, useEffect, useCallback } from 'react';
import { supabase } from '@/lib/supabaseClient';
import { DB } from '@/lib/db';
import {
  Mail, Send, Clock, Check, AlertCircle, Edit3, Save,
  X, RefreshCw, ChevronDown, ChevronUp, Users, Calendar,
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
  studentName: string;
  sessionDate: string;
  sessionTime: string;
  tutorName: string;
  studentEmail: string | null;
  momEmail: string | null;
  dadEmail: string | null;
  reminderSent: boolean;
};

function toISODate(d: Date) { return d.toISOString().split('T')[0]; }
function tomorrow() { const d = new Date(); d.setDate(d.getDate() + 1); return toISODate(d); }
function formatSentAt(iso: string) {
  try { return new Date(iso).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }); }
  catch { return iso; }
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
  const [candidates, setCandidates]               = useState<Candidate[]>([]);
  const [loadingCandidates, setLoadingCandidates] = useState(false);
  const [selected, setSelected]                   = useState<Set<string>>(new Set());
  const [sending, setSending]                     = useState(false);
  const [confirmSend, setConfirmSend]             = useState(false);
  const [sendResult, setSendResult]               = useState<{ sent: number; failed: number; errors: string[]; mode?: string; redirectedTo?: string | null; skipped?: boolean; reason?: string } | null>(null);

  const [logs, setLogs]                 = useState<Log[]>([]);
  const [loadingLogs, setLoadingLogs]   = useState(true);
  const [logsExpanded, setLogsExpanded] = useState(false);

  const formatSettingsError = (message: string) => {
    if (message.toLowerCase().includes('relation') || message.toLowerCase().includes('does not exist')) {
      return `Missing table: ${DB.centerSettings}. Create that table in Supabase.`;
    }
    return `Failed to load ${DB.centerSettings}: ${message}`;
  };

  const fetchSettings = useCallback(async () => {
    setLoadingSettings(true);
    setSettingsError(null);

    const { data, error } = await supabase.from(DB.centerSettings).select('*').limit(1).maybeSingle();

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
      .insert(DEFAULT_SETTINGS)
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
    const { data } = await supabase.from(DB.reminderLogs).select('*').order('sent_at', { ascending: false }).limit(200);
    if (data) setLogs(data);
    setLoadingLogs(false);
  }, []);

  const fetchCandidates = useCallback(async (date: string) => {
    setLoadingCandidates(true);
    setSendResult(null);
    setConfirmSend(false);
    setSelected(new Set());

    try {
      const { data, error } = await (supabase
        .from(DB.sessionStudents)
        .select(`
          id,
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
        .neq('status', 'cancelled') as any);

      if (error) throw error;

      const rows: Candidate[] = (data ?? []).map((r: any) => {
        const sess    = Array.isArray(r[DB.sessions]) ? r[DB.sessions][0] : r[DB.sessions];
        const tutor   = Array.isArray(sess?.[DB.tutors]) ? sess[DB.tutors][0] : sess?.[DB.tutors];
        const student = Array.isArray(r[DB.students]) ? r[DB.students][0] : r[DB.students];
        return {
          rowId:        r.id,
          studentName:  student?.name ?? '—',
          sessionDate:  sess?.session_date ?? date,
          sessionTime:  sess?.time ?? '',
          tutorName:    tutor?.name ?? '—',
          studentEmail: student?.email ?? null,
          momEmail:     student?.mom_email ?? null,
          dadEmail:     student?.dad_email ?? null,
          reminderSent: !!r.reminder_sent,
        };
      }).sort((a: Candidate, b: Candidate) => a.sessionTime.localeCompare(b.sessionTime) || a.studentName.localeCompare(b.studentName));

      setCandidates(rows);
      setSelected(new Set(rows.filter((r: Candidate) => !r.reminderSent && (r.studentEmail || r.momEmail || r.dadEmail)).map((r: Candidate) => r.rowId)));
    } catch (e: any) {
      console.error('Failed to load candidates:', e);
      setCandidates([]);
    }

    setLoadingCandidates(false);
  }, []);

  useEffect(() => { fetchSettings(); fetchLogs(); }, [fetchSettings, fetchLogs]);
  useEffect(() => { fetchCandidates(dispatchDate); }, [dispatchDate, fetchCandidates]);

  const saveTemplate = async () => {
    if (!settings) return;
    setSavingTemplate(true);
    const { error } = await supabase.from(DB.centerSettings)
      .update({ reminder_subject: draftSubject, reminder_body: draftBody })
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
        body: JSON.stringify({ manual: true, sessionStudentIds: [...selected], baseUrl: window.location.origin }),
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
        await Promise.all([fetchCandidates(dispatchDate), fetchLogs()]);
      }
    } catch (e: any) {
      setSendResult({ sent: 0, failed: selected.size, errors: [e.message ?? 'Request failed'] });
    }
    setSending(false);
  };

  const groupedLogs = logs.reduce<Record<string, Log[]>>((acc, log) => {
    const key = log.session_date;
    if (!acc[key]) acc[key] = [];
    acc[key].push(log);
    return acc;
  }, {});

  return (
    <div className="min-h-screen" style={{ background: '#f8fafc', fontFamily: 'Inter, ui-sans-serif, system-ui, sans-serif' }}>
      <div className="max-w-6xl mx-auto px-4 md:px-6 py-8 md:py-10 space-y-6 md:space-y-7">

        <div className="rounded-xl px-6 py-5 md:px-7 md:py-6"
          style={{ background: '#ffffff', border: '1px solid #dbe3ee', boxShadow: '0 8px 22px rgba(15,23,42,0.06)' }}>
          <p className="text-[11px] font-bold uppercase tracking-[0.12em] text-[#64748b]">Operations</p>
          <h1 className="text-2xl md:text-[30px] font-bold tracking-tight text-[#0f172a] mt-1">Contact Center</h1>
          <p className="text-sm mt-1.5 text-[#64748b]">Manage reminder dispatch, template settings, and send history.</p>
        </div>

        {/* Dispatch panel */}
        <div className="rounded-xl overflow-hidden" style={{ background: '#ffffff', border: '1px solid #dbe3ee', boxShadow: '0 10px 26px rgba(15,23,42,0.06)' }}>
          <div className="flex items-center justify-between px-5 md:px-6 py-4" style={{ background: '#0f172a', borderBottom: '1px solid #020617' }}>
            <div className="flex items-center gap-2.5">
              <div className="w-8 h-8 rounded-xl flex items-center justify-center" style={{ background: 'rgba(255,255,255,0.16)' }}>
                <Send size={15} color="rgba(255,255,255,0.95)" />
              </div>
              <div>
                <p className="text-sm font-black uppercase tracking-wider text-white">Send Reminders</p>
                <p className="text-[11px] font-semibold text-[#dbeafe]">Two-step confirmation enabled</p>
              </div>
            </div>
            <div className="flex items-center gap-2 px-3 py-2 rounded-xl" style={{ background: 'rgba(255,255,255,0.14)', border: '1px solid rgba(255,255,255,0.2)' }}>
              <Calendar size={13} color="rgba(255,255,255,0.9)" />
              <input type="date" value={dispatchDate} onChange={e => setDispatchDate(e.target.value)}
                className="text-xs font-extrabold outline-none bg-transparent" style={{ color: 'white', colorScheme: 'dark' }} />
            </div>
          </div>

          <div className="p-5 md:p-6 space-y-4">
            {sendResult && (
              <div className="flex items-start gap-3 px-4 py-3 rounded-xl text-sm font-semibold"
                style={{ background: sendResult.failed > 0 ? '#fef2f2' : '#f0fdf4', border: `1px solid ${sendResult.failed > 0 ? '#fca5a5' : '#86efac'}`, color: sendResult.failed > 0 ? '#dc2626' : '#16a34a' }}>
                {sendResult.failed > 0 ? <AlertCircle size={16} className="shrink-0 mt-0.5" /> : <Check size={16} className="shrink-0 mt-0.5" />}
                <div>
                  {sendResult.mode === 'redirect' && sendResult.redirectedTo && (
                    <p>Protected mode active. Emails were redirected to {sendResult.redirectedTo} and not marked as sent.</p>
                  )}
                  {sendResult.skipped && sendResult.reason && <p>{sendResult.reason}</p>}
                  {sendResult.sent > 0 && <p>{sendResult.sent} reminder{sendResult.sent !== 1 ? 's' : ''} sent.</p>}
                  {sendResult.failed > 0 && <p>{sendResult.failed} failed.{sendResult.errors[0] ? ` (${sendResult.errors[0]})` : ''}</p>}
                </div>
              </div>
            )}

            {!loadingCandidates && candidates.length > 0 && (
              <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
                <label className="flex items-center gap-2.5 cursor-pointer select-none">
                  <div onClick={toggleAll} className="w-4 h-4 rounded flex items-center justify-center shrink-0 transition-all cursor-pointer"
                    style={{ background: allChecked ? '#2563eb' : someChecked ? '#dbeafe' : 'white', border: `2px solid ${allChecked || someChecked ? '#2563eb' : '#d1d5db'}` }}>
                    {allChecked && <Check size={10} color="white" strokeWidth={3} />}
                    {someChecked && !allChecked && <div className="w-1.5 h-1.5 rounded-sm" style={{ background: '#2563eb' }} />}
                  </div>
                  <span className="text-xs font-extrabold" style={{ color: '#1f2937' }}>
                    {allChecked ? 'Deselect all' : `Select all unsent (${selectableIds.length})`}
                  </span>
                </label>
                <button onClick={handleSend} disabled={selected.size === 0 || sending}
                  className="flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl text-sm font-extrabold text-white transition-all active:scale-95"
                  style={{
                    background: selected.size === 0 || sending ? '#9ca3af' : confirmSend ? '#92400e' : '#2563eb',
                    boxShadow: selected.size > 0 && !sending ? '0 10px 24px rgba(37,99,235,0.28)' : 'none',
                  }}>
                  {sending
                    ? <><RefreshCw size={13} className="animate-spin" /> Sending…</>
                    : confirmSend
                      ? <><AlertCircle size={13} /> Confirm send to {selected.size}</>
                      : <><Send size={13} /> Send to {selected.size}</>}
                </button>
              </div>
            )}

            {loadingCandidates ? (
              <div className="flex items-center gap-2 py-6" style={{ color: '#9ca3af' }}>
                <RefreshCw size={14} className="animate-spin" />
                <span className="text-sm">Loading sessions for {dispatchDate}…</span>
              </div>
            ) : candidates.length === 0 ? (
              <div className="py-12 text-center rounded-2xl" style={{ background: '#f8fafc', border: '1px dashed #cbd5e1' }}>
                <Users size={28} className="mx-auto mb-3" style={{ color: '#fca5a5' }} />
                <p className="text-sm font-semibold" style={{ color: '#9ca3af' }}>No sessions found for {dispatchDate}</p>
              </div>
            ) : (
              <div className="rounded-2xl overflow-hidden" style={{ border: '1px solid #e2e8f0', background: '#ffffff' }}>
                {candidates.map((c, i) => {
                  const noEmail    = !c.studentEmail && !c.momEmail && !c.dadEmail;
                  const isDisabled = noEmail || c.reminderSent;
                  const isChecked  = selected.has(c.rowId);
                  return (
                    <div key={c.rowId} className="flex items-center gap-3 px-4 md:px-5 py-3.5 transition-colors"
                      style={{ borderTop: i > 0 ? '1px solid #f1f5f9' : 'none', background: c.reminderSent ? '#f8fafc' : 'white', opacity: noEmail ? 0.45 : 1, cursor: isDisabled ? 'default' : 'pointer' }}
                      onClick={() => !isDisabled && toggleWithConfirmReset(c.rowId)}>
                      <div className="w-4.5 h-4.5 rounded shrink-0 flex items-center justify-center transition-all"
                        style={{ background: isChecked ? '#2563eb' : 'white', border: `2px solid ${isChecked ? '#2563eb' : isDisabled ? '#e5e7eb' : '#d1d5db'}` }}>
                        {isChecked && <Check size={10} color="white" strokeWidth={3} />}
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <p className="text-sm font-extrabold" style={{ color: c.reminderSent ? '#94a3b8' : '#0f172a' }}>{c.studentName}</p>
                          {c.reminderSent && (
                            <span className="inline-flex items-center gap-1 text-[9px] font-black uppercase tracking-wider px-1.5 py-0.5 rounded-full" style={{ background: '#dcfce7', color: '#166534' }}>
                              <Check size={8} strokeWidth={3} /> Sent
                            </span>
                          )}
                          {noEmail && <span className="text-[9px] font-black uppercase tracking-wider px-1.5 py-0.5 rounded-full" style={{ background: '#f3f4f6', color: '#9ca3af' }}>No email</span>}
                        </div>
                        <div className="flex items-center gap-2 mt-0.5 flex-wrap">
                          <span className="text-[11px] font-semibold" style={{ color: '#475569' }}>{c.sessionTime} · {c.tutorName}</span>
                          {(c.studentEmail || c.momEmail || c.dadEmail) && !c.reminderSent && (
                            <span className="text-[10px] font-medium" style={{ color: '#64748b' }}>→ {[c.studentEmail, c.momEmail, c.dadEmail].filter(Boolean).join(', ')}</span>
                          )}
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>

        {/* Email template */}
        <div className="rounded-xl overflow-hidden" style={{ background: '#ffffff', border: '1px solid #dbe3ee', boxShadow: '0 10px 26px rgba(15,23,42,0.06)' }}>
          <div className="flex items-center justify-between px-5 md:px-6 py-4" style={{ background: '#0f172a', borderBottom: '1px solid #020617' }}>
            <div className="flex items-center gap-2.5">
              <div className="w-8 h-8 rounded-xl flex items-center justify-center" style={{ background: 'rgba(255,255,255,0.12)' }}>
                <Mail size={15} color="rgba(255,255,255,0.9)" />
              </div>
              <span className="text-sm font-black uppercase tracking-wider text-white">Email Template</span>
            </div>
            {!editingTemplate ? (
              <button onClick={() => setEditingTemplate(true)} className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold" style={{ background: 'rgba(255,255,255,0.14)', color: '#e2e8f0', border: '1px solid rgba(255,255,255,0.2)' }}>
                <Edit3 size={11} /> Edit
              </button>
            ) : (
              <div className="flex items-center gap-2">
                <button onClick={cancelEdit} className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-xs font-bold" style={{ background: 'rgba(255,255,255,0.12)', color: '#cbd5e1', border: '1px solid rgba(255,255,255,0.2)' }}>
                  <X size={11} /> Cancel
                </button>
                <button onClick={saveTemplate} disabled={savingTemplate} className="flex items-center gap-1 px-3 py-1.5 rounded-lg text-xs font-bold" style={{ background: '#f8fafc', color: '#0f172a' }}>
                  <Save size={11} /> {savingTemplate ? 'Saving…' : 'Save'}
                </button>
              </div>
            )}
          </div>
          <div className="p-5 md:p-6">
            <div className="rounded-2xl px-4 py-4" style={{ background: '#f8fafc', border: '1px solid #e2e8f0' }}>
              <div className="flex items-center justify-between gap-3">
                <div>
                  <p className="text-sm font-extrabold text-[#0f172a]">Template is collapsed</p>
                  <p className="text-xs text-[#64748b] mt-0.5">Open editor only when you need to update subject/body copy.</p>
                </div>
                <button onClick={() => setEditingTemplate(true)}
                  className="flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-bold"
                  style={{ background: '#0f172a', color: 'white' }}>
                  <Edit3 size={11} /> Edit Template
                </button>
              </div>
              {templateSaved && (
                <div className="mt-3 flex items-center gap-2 px-3 py-2 rounded-lg text-xs font-semibold" style={{ background: '#f0fdf4', border: '1px solid #86efac', color: '#166534' }}>
                  <Check size={12} /> Template saved
                </div>
              )}
              {settingsError && (
                <div className="mt-3 px-3 py-2 rounded-lg text-xs font-semibold" style={{ background: '#fef2f2', border: '1px solid #fecaca', color: '#b91c1c' }}>
                  {settingsError}
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Send history */}
        <div className="rounded-xl overflow-hidden" style={{ background: '#ffffff', border: '1px solid #dbe3ee', boxShadow: '0 10px 26px rgba(15,23,42,0.06)' }}>
          <button className="w-full flex items-center justify-between px-5 md:px-6 py-4"
            style={{ background: '#0f172a', borderBottom: logsExpanded ? '1px solid #020617' : 'none' }}
            onClick={() => setLogsExpanded(v => !v)}>
            <div className="flex items-center gap-2.5">
              <div className="w-8 h-8 rounded-xl flex items-center justify-center" style={{ background: 'rgba(255,255,255,0.12)' }}>
                <Clock size={15} color="rgba(255,255,255,0.9)" />
              </div>
              <span className="text-sm font-black uppercase tracking-wider text-white">Send History</span>
              {logs.length > 0 && (
                <span className="text-[10px] font-black px-2 py-0.5 rounded-full" style={{ background: 'rgba(255,255,255,0.15)', color: 'white' }}>{logs.length}</span>
              )}
            </div>
            {logsExpanded ? <ChevronUp size={16} color="rgba(255,255,255,0.6)" /> : <ChevronDown size={16} color="rgba(255,255,255,0.6)" />}
          </button>

          {logsExpanded && (
            <div className="divide-y" style={{ borderColor: '#f3f4f6' }}>
              {loadingLogs ? (
                <div className="flex items-center gap-2 px-5 py-6" style={{ color: '#9ca3af' }}>
                  <RefreshCw size={14} className="animate-spin" /><span className="text-sm">Loading history…</span>
                </div>
              ) : logs.length === 0 ? (
                <div className="px-5 py-10 text-center" style={{ background: '#f8fafc' }}>
                  <Mail size={24} className="mx-auto mb-3" style={{ color: '#d1d5db' }} />
                  <p className="text-sm font-semibold" style={{ color: '#9ca3af' }}>No reminders sent yet</p>
                </div>
              ) : (
                Object.entries(groupedLogs).sort(([a], [b]) => b.localeCompare(a)).map(([date, entries]) => (
                  <div key={date}>
                    <div className="px-5 md:px-6 py-2.5 flex items-center gap-2" style={{ background: '#f8fafc' }}>
                      <span className="text-[10px] font-black uppercase tracking-widest" style={{ color: '#374151' }}>{date}</span>
                      <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded-full" style={{ background: '#e5e7eb', color: '#6b7280' }}>{entries.length} sent</span>
                    </div>
                    {entries.map(log => (
                      <div key={log.id} className="flex items-center justify-between px-5 md:px-6 py-3.5" style={{ borderTop: '1px solid #f1f5f9' }}>
                        <div className="flex items-center gap-3">
                          <div className="w-7 h-7 rounded-full flex items-center justify-center shrink-0" style={{ background: '#f0fdf4', border: '1.5px solid #86efac' }}>
                            <Check size={12} style={{ color: '#16a34a' }} />
                          </div>
                          <div>
                            <p className="text-sm font-extrabold" style={{ color: '#0f172a' }}>{log.student_name}</p>
                            <p className="text-[11px]" style={{ color: '#64748b' }}>{log.emailed_to}</p>
                          </div>
                        </div>
                        <div className="text-right shrink-0 ml-4">
                          <p className="text-[11px] font-semibold" style={{ color: '#475569' }}>{log.session_time}</p>
                          <p className="text-[10px]" style={{ color: '#64748b' }}>{formatSentAt(log.sent_at)}</p>
                        </div>
                      </div>
                    ))}
                  </div>
                ))
              )}
            </div>
          )}
        </div>

        {editingTemplate && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{ background: 'rgba(15,23,42,0.65)', backdropFilter: 'blur(4px)' }}
            onClick={e => { if (e.target === e.currentTarget) cancelEdit(); }}>
            <div className="w-full max-w-3xl rounded-xl overflow-hidden" style={{ background: 'white', border: '1px solid #dbe3ee', boxShadow: '0 24px 64px rgba(15,23,42,0.35)' }}
              onClick={e => e.stopPropagation()}>
              <div className="flex items-center justify-between px-5 py-4" style={{ background: '#0f172a' }}>
                <div className="flex items-center gap-2.5">
                  <Mail size={15} color="rgba(255,255,255,0.9)" />
                  <span className="text-sm font-black uppercase tracking-wider text-white">Edit Email Template</span>
                </div>
                <div className="flex items-center gap-2">
                  <button onClick={cancelEdit} className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-xs font-bold" style={{ background: 'rgba(255,255,255,0.12)', color: '#cbd5e1' }}>
                    <X size={11} /> Cancel
                  </button>
                  <button onClick={saveTemplate} disabled={savingTemplate || loadingSettings || !!settingsError} className="flex items-center gap-1 px-3 py-1.5 rounded-lg text-xs font-bold" style={{ background: '#f8fafc', color: '#0f172a' }}>
                    <Save size={11} /> {savingTemplate ? 'Saving…' : 'Save'}
                  </button>
                </div>
              </div>
              <div className="p-5 space-y-4 max-h-[75vh] overflow-y-auto">
                {loadingSettings ? (
                  <div className="flex items-center gap-2 py-4" style={{ color: '#9ca3af' }}>
                    <RefreshCw size={14} className="animate-spin" /><span className="text-sm">Loading…</span>
                  </div>
                ) : settingsError ? (
                  <div className="px-4 py-3 rounded-xl text-sm font-semibold" style={{ background: '#fef2f2', border: '1px solid #fecaca', color: '#b91c1c' }}>
                    {settingsError}
                  </div>
                ) : (
                  <>
                    <div className="flex flex-wrap gap-1.5 items-center">
                      {['{{name}}', '{{date}}', '{{time}}', '{{link}}'].map(v => (
                        <span key={v} className="text-[10px] font-mono font-bold px-2 py-1 rounded-md" style={{ background: '#f8fafc', border: '1px solid #e2e8f0', color: '#334155' }}>{v}</span>
                      ))}
                      <span className="text-[10px]" style={{ color: '#9ca3af' }}>available variables</span>
                    </div>
                    <div>
                      <label className="block text-[10px] font-black uppercase tracking-widest mb-1.5" style={{ color: '#6b7280' }}>Subject</label>
                      <input value={draftSubject} onChange={e => setDraftSubject(e.target.value)}
                        className="w-full px-3 py-2.5 rounded-xl text-sm outline-none" style={{ border: '2px solid #dbe3ee', color: '#0f172a', background: '#ffffff' }}
                        onFocus={e => e.currentTarget.style.borderColor = '#2563eb'}
                        onBlur={e => e.currentTarget.style.borderColor = '#dbe3ee'} />
                    </div>
                    <div>
                      <label className="block text-[10px] font-black uppercase tracking-widest mb-1.5" style={{ color: '#6b7280' }}>Body</label>
                      <textarea value={draftBody} onChange={e => setDraftBody(e.target.value)} rows={10}
                        className="w-full px-3 py-2.5 rounded-xl text-sm outline-none resize-none" style={{ border: '2px solid #dbe3ee', color: '#0f172a', lineHeight: 1.65 }}
                        onFocus={e => e.currentTarget.style.borderColor = '#2563eb'}
                        onBlur={e => e.currentTarget.style.borderColor = '#dbe3ee'} />
                    </div>
                  </>
                )}
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}