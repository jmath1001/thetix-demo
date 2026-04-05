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

type Candidate = {
  rowId: string;
  studentName: string;
  sessionDate: string;
  sessionTime: string;
  tutorName: string;
  studentEmail: string | null;
  parentEmail: string | null;
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
  const [sendResult, setSendResult]               = useState<{ sent: number; failed: number; errors: string[] } | null>(null);

  const [logs, setLogs]                 = useState<Log[]>([]);
  const [loadingLogs, setLoadingLogs]   = useState(true);
  const [logsExpanded, setLogsExpanded] = useState(true);

  const fetchSettings = useCallback(async () => {
    setLoadingSettings(true);
    const { data } = await supabase.from(DB.centerSettings).select('*').single();
    if (data) { setSettings(data); setDraftSubject(data.reminder_subject ?? ''); setDraftBody(data.reminder_body ?? ''); }
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
            parent_email
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
          parentEmail:  student?.parent_email ?? null,
          reminderSent: !!r.reminder_sent,
        };
      }).sort((a: Candidate, b: Candidate) => a.sessionTime.localeCompare(b.sessionTime) || a.studentName.localeCompare(b.studentName));

      setCandidates(rows);
      setSelected(new Set(rows.filter((r: Candidate) => !r.reminderSent && (r.studentEmail || r.parentEmail)).map((r: Candidate) => r.rowId)));
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
    await supabase.from(DB.centerSettings)
      .update({ reminder_subject: draftSubject, reminder_body: draftBody })
      .eq('center_name', settings.center_name);
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

  const selectableIds = candidates.filter(c => !c.reminderSent && (c.studentEmail || c.parentEmail)).map(c => c.rowId);
  const allChecked  = selectableIds.length > 0 && selectableIds.every(id => selected.has(id));
  const someChecked = selectableIds.some(id => selected.has(id));

  const toggle = (id: string) => setSelected(prev => {
    const next = new Set(prev); next.has(id) ? next.delete(id) : next.add(id); return next;
  });
  const toggleAll = () => setSelected(allChecked ? new Set() : new Set(selectableIds));

  const handleSend = async () => {
    if (selected.size === 0) return;
    setSending(true); setSendResult(null);
    try {
      const res = await fetch('/api/cron/reminders', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ manual: true, sessionStudentIds: [...selected] }),
      });
      const data = await res.json();
      if (data.error) {
        setSendResult({ sent: 0, failed: selected.size, errors: [data.error] });
      } else {
        setSendResult({ sent: data.sent ?? 0, failed: data.failed ?? 0, errors: data.errors ?? [] });
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
    <div className="min-h-screen" style={{ background: '#fafafa', fontFamily: 'ui-sans-serif, system-ui, sans-serif' }}>
      <div className="max-w-4xl mx-auto px-4 py-8 space-y-6">

        <div>
          <h1 className="text-2xl font-black tracking-tight" style={{ color: '#111827' }}>Contact Center</h1>
          <p className="text-sm mt-0.5" style={{ color: '#6b7280' }}>Send session reminders and manage email templates</p>
        </div>

        {/* Dispatch panel */}
        <div className="rounded-2xl overflow-hidden" style={{ background: 'white', border: '1px solid #fca5a5', boxShadow: '0 2px 12px rgba(220,38,38,0.06)' }}>
          <div className="flex items-center justify-between px-5 py-4" style={{ background: '#dc2626', borderBottom: '1px solid #b91c1c' }}>
            <div className="flex items-center gap-2.5">
              <Send size={16} color="rgba(255,255,255,0.9)" />
              <span className="text-sm font-black uppercase tracking-wider text-white">Send Reminders</span>
            </div>
            <div className="flex items-center gap-2 px-3 py-1.5 rounded-xl" style={{ background: 'rgba(255,255,255,0.15)' }}>
              <Calendar size={13} color="rgba(255,255,255,0.8)" />
              <input type="date" value={dispatchDate} onChange={e => setDispatchDate(e.target.value)}
                className="text-xs font-bold outline-none bg-transparent" style={{ color: 'white', colorScheme: 'dark' }} />
            </div>
          </div>

          <div className="p-5 space-y-4">
            {sendResult && (
              <div className="flex items-start gap-3 px-4 py-3 rounded-xl text-sm font-semibold"
                style={{ background: sendResult.failed > 0 ? '#fef2f2' : '#f0fdf4', border: `1px solid ${sendResult.failed > 0 ? '#fca5a5' : '#86efac'}`, color: sendResult.failed > 0 ? '#dc2626' : '#16a34a' }}>
                {sendResult.failed > 0 ? <AlertCircle size={16} className="shrink-0 mt-0.5" /> : <Check size={16} className="shrink-0 mt-0.5" />}
                <div>
                  {sendResult.sent > 0 && <p>{sendResult.sent} reminder{sendResult.sent !== 1 ? 's' : ''} sent.</p>}
                  {sendResult.failed > 0 && <p>{sendResult.failed} failed.{sendResult.errors[0] ? ` (${sendResult.errors[0]})` : ''}</p>}
                </div>
              </div>
            )}

            {!loadingCandidates && candidates.length > 0 && (
              <div className="flex items-center justify-between">
                <label className="flex items-center gap-2.5 cursor-pointer select-none">
                  <div onClick={toggleAll} className="w-4 h-4 rounded flex items-center justify-center shrink-0 transition-all cursor-pointer"
                    style={{ background: allChecked ? '#dc2626' : someChecked ? '#fecaca' : 'white', border: `2px solid ${allChecked || someChecked ? '#dc2626' : '#d1d5db'}` }}>
                    {allChecked && <Check size={10} color="white" strokeWidth={3} />}
                    {someChecked && !allChecked && <div className="w-1.5 h-1.5 rounded-sm" style={{ background: '#dc2626' }} />}
                  </div>
                  <span className="text-xs font-bold" style={{ color: '#374151' }}>
                    {allChecked ? 'Deselect all' : `Select all unsent (${selectableIds.length})`}
                  </span>
                </label>
                <button onClick={handleSend} disabled={selected.size === 0 || sending}
                  className="flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-bold text-white transition-all active:scale-95"
                  style={{ background: selected.size === 0 || sending ? '#9ca3af' : '#dc2626', boxShadow: selected.size > 0 && !sending ? '0 2px 8px rgba(220,38,38,0.3)' : 'none' }}>
                  {sending ? <><RefreshCw size={13} className="animate-spin" /> Sending…</> : <><Send size={13} /> Send to {selected.size}</>}
                </button>
              </div>
            )}

            {loadingCandidates ? (
              <div className="flex items-center gap-2 py-6" style={{ color: '#9ca3af' }}>
                <RefreshCw size={14} className="animate-spin" />
                <span className="text-sm">Loading sessions for {dispatchDate}…</span>
              </div>
            ) : candidates.length === 0 ? (
              <div className="py-10 text-center">
                <Users size={28} className="mx-auto mb-3" style={{ color: '#fca5a5' }} />
                <p className="text-sm font-semibold" style={{ color: '#9ca3af' }}>No sessions found for {dispatchDate}</p>
              </div>
            ) : (
              <div className="rounded-xl overflow-hidden" style={{ border: '1px solid #f3f4f6' }}>
                {candidates.map((c, i) => {
                  const noEmail    = !c.studentEmail && !c.parentEmail;
                  const isDisabled = noEmail || c.reminderSent;
                  const isChecked  = selected.has(c.rowId);
                  return (
                    <div key={c.rowId} className="flex items-center gap-3 px-4 py-3 transition-colors"
                      style={{ borderTop: i > 0 ? '1px solid #f3f4f6' : 'none', background: c.reminderSent ? '#f9fafb' : 'white', opacity: noEmail ? 0.45 : 1, cursor: isDisabled ? 'default' : 'pointer' }}
                      onClick={() => !isDisabled && toggle(c.rowId)}>
                      <div className="w-4 h-4 rounded shrink-0 flex items-center justify-center transition-all"
                        style={{ background: isChecked ? '#dc2626' : 'white', border: `2px solid ${isChecked ? '#dc2626' : isDisabled ? '#e5e7eb' : '#d1d5db'}` }}>
                        {isChecked && <Check size={10} color="white" strokeWidth={3} />}
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <p className="text-sm font-bold" style={{ color: c.reminderSent ? '#9ca3af' : '#111827' }}>{c.studentName}</p>
                          {c.reminderSent && (
                            <span className="inline-flex items-center gap-1 text-[9px] font-black uppercase tracking-wider px-1.5 py-0.5 rounded-full" style={{ background: '#dcfce7', color: '#16a34a' }}>
                              <Check size={8} strokeWidth={3} /> Sent
                            </span>
                          )}
                          {noEmail && <span className="text-[9px] font-black uppercase tracking-wider px-1.5 py-0.5 rounded-full" style={{ background: '#f3f4f6', color: '#9ca3af' }}>No email</span>}
                        </div>
                        <div className="flex items-center gap-2 mt-0.5 flex-wrap">
                          <span className="text-[11px] font-semibold" style={{ color: '#6b7280' }}>{c.sessionTime} · {c.tutorName}</span>
                          {(c.studentEmail || c.parentEmail) && !c.reminderSent && (
                            <span className="text-[10px]" style={{ color: '#9ca3af' }}>→ {[c.studentEmail, c.parentEmail].filter(Boolean).join(', ')}</span>
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
        <div className="rounded-2xl overflow-hidden" style={{ background: 'white', border: '1px solid #e5e7eb', boxShadow: '0 1px 6px rgba(0,0,0,0.04)' }}>
          <div className="flex items-center justify-between px-5 py-4" style={{ background: '#1f2937', borderBottom: '1px solid #111827' }}>
            <div className="flex items-center gap-2.5">
              <Mail size={16} color="rgba(255,255,255,0.7)" />
              <span className="text-sm font-black uppercase tracking-wider text-white">Email Template</span>
            </div>
            {!editingTemplate ? (
              <button onClick={() => setEditingTemplate(true)} className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold" style={{ background: 'rgba(255,255,255,0.1)', color: 'rgba(255,255,255,0.8)' }}>
                <Edit3 size={11} /> Edit
              </button>
            ) : (
              <div className="flex items-center gap-2">
                <button onClick={cancelEdit} className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-xs font-bold" style={{ background: 'rgba(255,255,255,0.1)', color: 'rgba(255,255,255,0.7)' }}>
                  <X size={11} /> Cancel
                </button>
                <button onClick={saveTemplate} disabled={savingTemplate} className="flex items-center gap-1 px-3 py-1.5 rounded-lg text-xs font-bold" style={{ background: 'white', color: '#1f2937' }}>
                  <Save size={11} /> {savingTemplate ? 'Saving…' : 'Save'}
                </button>
              </div>
            )}
          </div>
          <div className="p-5 space-y-4">
            {loadingSettings ? (
              <div className="flex items-center gap-2 py-4" style={{ color: '#9ca3af' }}>
                <RefreshCw size={14} className="animate-spin" /><span className="text-sm">Loading…</span>
              </div>
            ) : (
              <>
                {templateSaved && (
                  <div className="flex items-center gap-2 px-3 py-2 rounded-lg text-xs font-semibold" style={{ background: '#f0fdf4', border: '1px solid #86efac', color: '#16a34a' }}>
                    <Check size={12} /> Template saved
                  </div>
                )}
                <div className="flex flex-wrap gap-1.5 items-center">
                  {['{{name}}', '{{date}}', '{{time}}', '{{link}}'].map(v => (
                    <span key={v} className="text-[10px] font-mono font-bold px-2 py-1 rounded" style={{ background: '#f3f4f6', border: '1px solid #e5e7eb', color: '#374151' }}>{v}</span>
                  ))}
                  <span className="text-[10px]" style={{ color: '#9ca3af' }}>available variables</span>
                </div>
                <div>
                  <label className="block text-[10px] font-black uppercase tracking-widest mb-1.5" style={{ color: '#6b7280' }}>Subject</label>
                  {editingTemplate ? (
                    <input value={draftSubject} onChange={e => setDraftSubject(e.target.value)}
                      className="w-full px-3 py-2.5 rounded-xl text-sm outline-none" style={{ border: '2px solid #e5e7eb', color: '#111827' }}
                      onFocus={e => e.currentTarget.style.borderColor = '#dc2626'}
                      onBlur={e => e.currentTarget.style.borderColor = '#e5e7eb'} />
                  ) : (
                    <p className="px-3 py-2.5 rounded-xl text-sm" style={{ background: '#f9fafb', color: '#111827', border: '1px solid #f3f4f6' }}>
                      {settings?.reminder_subject || <span style={{ color: '#9ca3af' }}>No subject set</span>}
                    </p>
                  )}
                </div>
                <div>
                  <label className="block text-[10px] font-black uppercase tracking-widest mb-1.5" style={{ color: '#6b7280' }}>Body</label>
                  {editingTemplate ? (
                    <textarea value={draftBody} onChange={e => setDraftBody(e.target.value)} rows={10}
                      className="w-full px-3 py-2.5 rounded-xl text-sm outline-none resize-none" style={{ border: '2px solid #e5e7eb', color: '#111827', lineHeight: 1.6 }}
                      onFocus={e => e.currentTarget.style.borderColor = '#dc2626'}
                      onBlur={e => e.currentTarget.style.borderColor = '#e5e7eb'} />
                  ) : (
                    <pre className="px-3 py-2.5 rounded-xl text-sm whitespace-pre-wrap" style={{ background: '#f9fafb', color: '#111827', border: '1px solid #f3f4f6', fontFamily: 'inherit', lineHeight: 1.6 }}>
                      {settings?.reminder_body || <span style={{ color: '#9ca3af' }}>No body set</span>}
                    </pre>
                  )}
                </div>
              </>
            )}
          </div>
        </div>

        {/* Send history */}
        <div className="rounded-2xl overflow-hidden" style={{ background: 'white', border: '1px solid #e5e7eb', boxShadow: '0 1px 6px rgba(0,0,0,0.04)' }}>
          <button className="w-full flex items-center justify-between px-5 py-4"
            style={{ background: '#1f2937', borderBottom: logsExpanded ? '1px solid #111827' : 'none' }}
            onClick={() => setLogsExpanded(v => !v)}>
            <div className="flex items-center gap-2.5">
              <Clock size={16} color="rgba(255,255,255,0.7)" />
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
                <div className="px-5 py-10 text-center">
                  <Mail size={24} className="mx-auto mb-3" style={{ color: '#d1d5db' }} />
                  <p className="text-sm font-semibold" style={{ color: '#9ca3af' }}>No reminders sent yet</p>
                </div>
              ) : (
                Object.entries(groupedLogs).sort(([a], [b]) => b.localeCompare(a)).map(([date, entries]) => (
                  <div key={date}>
                    <div className="px-5 py-2 flex items-center gap-2" style={{ background: '#f9fafb' }}>
                      <span className="text-[10px] font-black uppercase tracking-widest" style={{ color: '#374151' }}>{date}</span>
                      <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded-full" style={{ background: '#e5e7eb', color: '#6b7280' }}>{entries.length} sent</span>
                    </div>
                    {entries.map(log => (
                      <div key={log.id} className="flex items-center justify-between px-5 py-3" style={{ borderTop: '1px solid #f9fafb' }}>
                        <div className="flex items-center gap-3">
                          <div className="w-7 h-7 rounded-full flex items-center justify-center shrink-0" style={{ background: '#f0fdf4', border: '1.5px solid #86efac' }}>
                            <Check size={12} style={{ color: '#16a34a' }} />
                          </div>
                          <div>
                            <p className="text-sm font-bold" style={{ color: '#111827' }}>{log.student_name}</p>
                            <p className="text-[11px]" style={{ color: '#9ca3af' }}>{log.emailed_to}</p>
                          </div>
                        </div>
                        <div className="text-right shrink-0 ml-4">
                          <p className="text-[11px] font-semibold" style={{ color: '#6b7280' }}>{log.session_time}</p>
                          <p className="text-[10px]" style={{ color: '#9ca3af' }}>{formatSentAt(log.sent_at)}</p>
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
  );
}