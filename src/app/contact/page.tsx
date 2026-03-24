'use client';
import { useState, useEffect, useCallback } from 'react';
import { createClient } from '@supabase/supabase-js';
import { Mail, Send, Clock, Check, AlertCircle, Edit3, Save, X, RefreshCw, ChevronDown, ChevronUp } from 'lucide-react';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
);

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

export default function ContactCenter() {
  const [settings, setSettings] = useState<Settings | null>(null);
  const [logs, setLogs] = useState<Log[]>([]);
  const [loadingSettings, setLoadingSettings] = useState(true);
  const [loadingLogs, setLoadingLogs] = useState(true);
  const [editingTemplate, setEditingTemplate] = useState(false);
  const [savingTemplate, setSavingTemplate] = useState(false);
  const [templateSaved, setTemplateSaved] = useState(false);
  const [triggeringCron, setTriggeringCron] = useState(false);
  const [cronResult, setCronResult] = useState<{ sent?: number; error?: string } | null>(null);
  const [draftSubject, setDraftSubject] = useState('');
  const [draftBody, setDraftBody] = useState('');
  const [logsExpanded, setLogsExpanded] = useState(true);

  const fetchSettings = useCallback(async () => {
    setLoadingSettings(true);
    const { data } = await supabase.from('slake_center_settings').select('*').single();
    if (data) {
      setSettings(data);
      setDraftSubject(data.reminder_subject ?? '');
      setDraftBody(data.reminder_body ?? '');
    }
    setLoadingSettings(false);
  }, []);

  const fetchLogs = useCallback(async () => {
    setLoadingLogs(true);
    const { data } = await supabase
      .from('slake_reminder_logs')
      .select('*')
      .order('sent_at', { ascending: false })
      .limit(100);
    if (data) setLogs(data);
    setLoadingLogs(false);
  }, []);

  useEffect(() => {
    fetchSettings();
    fetchLogs();
  }, [fetchSettings, fetchLogs]);

  const saveTemplate = async () => {
    if (!settings) return;
    setSavingTemplate(true);
    await supabase
      .from('slake_center_settings')
      .update({ reminder_subject: draftSubject, reminder_body: draftBody })
      .eq('center_name', settings.center_name);
    setSettings(s => s ? { ...s, reminder_subject: draftSubject, reminder_body: draftBody } : s);
    setSavingTemplate(false);
    setTemplateSaved(true);
    setEditingTemplate(false);
    setTimeout(() => setTemplateSaved(false), 3000);
  };

  const cancelEdit = () => {
    setDraftSubject(settings?.reminder_subject ?? '');
    setDraftBody(settings?.reminder_body ?? '');
    setEditingTemplate(false);
  };

  const triggerCron = async () => {
    setTriggeringCron(true);
    setCronResult(null);
    try {
      const res = await fetch('/api/cron/reminders');
      const data = await res.json();
      setCronResult(data);
      if (!data.error) fetchLogs();
    } catch {
      setCronResult({ error: 'Request failed' });
    }
    setTriggeringCron(false);
  };

  // Group logs by date
  const groupedLogs = logs.reduce<Record<string, Log[]>>((acc, log) => {
    const date = log.session_date;
    if (!acc[date]) acc[date] = [];
    acc[date].push(log);
    return acc;
  }, {});

  const formatTime = (iso: string) => {
    try {
      return new Date(iso).toLocaleString('en-US', {
        month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit',
      });
    } catch { return iso; }
  };

  return (
    <div className="min-h-screen" style={{ background: '#fafafa', fontFamily: 'ui-sans-serif, system-ui, sans-serif' }}>
      <div className="max-w-4xl mx-auto px-4 py-8 space-y-6">

        {/* Page header */}
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-black tracking-tight" style={{ color: '#111827' }}>Contact Center</h1>
            <p className="text-sm mt-0.5" style={{ color: '#6b7280' }}>Manage reminder emails and view send history</p>
          </div>
          <button
            onClick={triggerCron}
            disabled={triggeringCron}
            className="flex items-center gap-2 px-4 py-2.5 rounded-xl text-sm font-bold text-white transition-all active:scale-95"
            style={{ background: triggeringCron ? '#9ca3af' : '#dc2626', boxShadow: triggeringCron ? 'none' : '0 2px 8px rgba(220,38,38,0.3)' }}>
            {triggeringCron
              ? <><RefreshCw size={14} className="animate-spin" /> Sending…</>
              : <><Send size={14} /> Send Reminders Now</>}
          </button>
        </div>

        {/* Cron result toast */}
        {cronResult && (
          <div className="flex items-center gap-3 px-4 py-3 rounded-xl text-sm font-semibold"
            style={{
              background: cronResult.error ? '#fef2f2' : '#f0fdf4',
              border: `1px solid ${cronResult.error ? '#fca5a5' : '#86efac'}`,
              color: cronResult.error ? '#dc2626' : '#16a34a',
            }}>
            {cronResult.error
              ? <><AlertCircle size={16} /> Error: {cronResult.error}</>
              : <><Check size={16} /> {cronResult.sent === 0 ? 'No new reminders to send.' : `${cronResult.sent} reminder${cronResult.sent !== 1 ? 's' : ''} sent successfully.`}</>}
          </div>
        )}

        {/* Email template editor */}
        <div className="rounded-2xl overflow-hidden" style={{ background: 'white', border: '1px solid #fca5a5', boxShadow: '0 2px 12px rgba(220,38,38,0.06)' }}>
          {/* Card header */}
          <div className="flex items-center justify-between px-5 py-4" style={{ background: '#dc2626', borderBottom: '1px solid #b91c1c' }}>
            <div className="flex items-center gap-2.5">
              <Mail size={16} color="rgba(255,255,255,0.9)" />
              <span className="text-sm font-black uppercase tracking-wider text-white">Email Template</span>
            </div>
            {!editingTemplate ? (
              <button
                onClick={() => setEditingTemplate(true)}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold transition-all"
                style={{ background: 'rgba(255,255,255,0.2)', color: 'white' }}>
                <Edit3 size={11} /> Edit
              </button>
            ) : (
              <div className="flex items-center gap-2">
                <button onClick={cancelEdit}
                  className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-xs font-bold"
                  style={{ background: 'rgba(255,255,255,0.15)', color: 'rgba(255,255,255,0.8)' }}>
                  <X size={11} /> Cancel
                </button>
                <button onClick={saveTemplate} disabled={savingTemplate}
                  className="flex items-center gap-1 px-3 py-1.5 rounded-lg text-xs font-bold"
                  style={{ background: 'white', color: '#dc2626' }}>
                  <Save size={11} /> {savingTemplate ? 'Saving…' : 'Save'}
                </button>
              </div>
            )}
          </div>

          <div className="p-5 space-y-4">
            {loadingSettings ? (
              <div className="flex items-center gap-2 py-4" style={{ color: '#9ca3af' }}>
                <RefreshCw size={14} className="animate-spin" />
                <span className="text-sm">Loading template…</span>
              </div>
            ) : (
              <>
                {templateSaved && (
                  <div className="flex items-center gap-2 px-3 py-2 rounded-lg text-xs font-semibold"
                    style={{ background: '#f0fdf4', border: '1px solid #86efac', color: '#16a34a' }}>
                    <Check size={12} /> Template saved
                  </div>
                )}

                {/* Variables hint */}
                <div className="flex flex-wrap gap-1.5">
                  {['{{name}}', '{{date}}', '{{time}}', '{{link}}'].map(v => (
                    <span key={v} className="text-[10px] font-mono font-bold px-2 py-1 rounded"
                      style={{ background: '#fff5f5', border: '1px solid #fecaca', color: '#dc2626' }}>
                      {v}
                    </span>
                  ))}
                  <span className="text-[10px] self-center" style={{ color: '#9ca3af' }}>— available variables</span>
                </div>

                {/* Subject */}
                <div>
                  <label className="block text-[10px] font-black uppercase tracking-widest mb-1.5" style={{ color: '#6b7280' }}>Subject</label>
                  {editingTemplate ? (
                    <input
                      value={draftSubject}
                      onChange={e => setDraftSubject(e.target.value)}
                      className="w-full px-3 py-2.5 rounded-xl text-sm border-2 outline-none transition-all"
                      style={{ border: '2px solid #fca5a5', color: '#111827' }}
                      onFocus={e => e.currentTarget.style.borderColor = '#dc2626'}
                      onBlur={e => e.currentTarget.style.borderColor = '#fca5a5'}
                    />
                  ) : (
                    <p className="px-3 py-2.5 rounded-xl text-sm" style={{ background: '#f9fafb', color: '#111827', border: '1px solid #f3f4f6' }}>
                      {settings?.reminder_subject || <span style={{ color: '#9ca3af' }}>No subject set</span>}
                    </p>
                  )}
                </div>

                {/* Body */}
                <div>
                  <label className="block text-[10px] font-black uppercase tracking-widest mb-1.5" style={{ color: '#6b7280' }}>Body</label>
                  {editingTemplate ? (
                    <textarea
                      value={draftBody}
                      onChange={e => setDraftBody(e.target.value)}
                      rows={10}
                      className="w-full px-3 py-2.5 rounded-xl text-sm border-2 outline-none transition-all resize-none"
                      style={{ border: '2px solid #fca5a5', color: '#111827', lineHeight: 1.6 }}
                      onFocus={e => e.currentTarget.style.borderColor = '#dc2626'}
                      onBlur={e => e.currentTarget.style.borderColor = '#fca5a5'}
                    />
                  ) : (
                    <pre className="px-3 py-2.5 rounded-xl text-sm whitespace-pre-wrap"
                      style={{ background: '#f9fafb', color: '#111827', border: '1px solid #f3f4f6', fontFamily: 'inherit', lineHeight: 1.6 }}>
                      {settings?.reminder_body || <span style={{ color: '#9ca3af' }}>No body set</span>}
                    </pre>
                  )}
                </div>
              </>
            )}
          </div>
        </div>

        {/* Sent log */}
        <div className="rounded-2xl overflow-hidden" style={{ background: 'white', border: '1px solid #fca5a5', boxShadow: '0 2px 12px rgba(220,38,38,0.06)' }}>
          <button
            className="w-full flex items-center justify-between px-5 py-4"
            style={{ background: '#dc2626', borderBottom: logsExpanded ? '1px solid #b91c1c' : 'none' }}
            onClick={() => setLogsExpanded(v => !v)}>
            <div className="flex items-center gap-2.5">
              <Clock size={16} color="rgba(255,255,255,0.9)" />
              <span className="text-sm font-black uppercase tracking-wider text-white">Send History</span>
              {logs.length > 0 && (
                <span className="text-[10px] font-black px-2 py-0.5 rounded-full"
                  style={{ background: 'rgba(255,255,255,0.25)', color: 'white' }}>
                  {logs.length}
                </span>
              )}
            </div>
            {logsExpanded ? <ChevronUp size={16} color="rgba(255,255,255,0.8)" /> : <ChevronDown size={16} color="rgba(255,255,255,0.8)" />}
          </button>

          {logsExpanded && (
            <div className="divide-y" style={{ borderColor: '#fee2e2' }}>
              {loadingLogs ? (
                <div className="flex items-center gap-2 px-5 py-6" style={{ color: '#9ca3af' }}>
                  <RefreshCw size={14} className="animate-spin" />
                  <span className="text-sm">Loading history…</span>
                </div>
              ) : logs.length === 0 ? (
                <div className="px-5 py-10 text-center">
                  <Mail size={24} className="mx-auto mb-3" style={{ color: '#fca5a5' }} />
                  <p className="text-sm font-semibold" style={{ color: '#9ca3af' }}>No reminders sent yet</p>
                </div>
              ) : (
                Object.entries(groupedLogs)
                  .sort(([a], [b]) => b.localeCompare(a))
                  .map(([date, entries]) => (
                    <div key={date}>
                      {/* Date group header */}
                      <div className="px-5 py-2 flex items-center gap-2" style={{ background: '#fff5f5' }}>
                        <span className="text-[10px] font-black uppercase tracking-widest" style={{ color: '#dc2626' }}>{date}</span>
                        <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded-full"
                          style={{ background: '#fecaca', color: '#dc2626' }}>
                          {entries.length} sent
                        </span>
                      </div>
                      {/* Entries */}
                      {entries.map(log => (
                        <div key={log.id} className="flex items-center justify-between px-5 py-3"
                          style={{ borderTop: '1px solid #fff5f5' }}>
                          <div className="flex items-center gap-3">
                            <div className="w-7 h-7 rounded-full flex items-center justify-center shrink-0"
                              style={{ background: '#fff5f5', border: '1.5px solid #fca5a5' }}>
                              <Check size={12} style={{ color: '#dc2626' }} />
                            </div>
                            <div>
                              <p className="text-sm font-bold" style={{ color: '#111827' }}>{log.student_name}</p>
                              <p className="text-[11px]" style={{ color: '#9ca3af' }}>{log.emailed_to}</p>
                            </div>
                          </div>
                          <div className="text-right shrink-0 ml-4">
                            <p className="text-[11px] font-semibold" style={{ color: '#6b7280' }}>{log.session_time}</p>
                            <p className="text-[10px]" style={{ color: '#9ca3af' }}>{formatTime(log.sent_at)}</p>
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