"use client"
import React, { useState, useEffect, useMemo } from 'react';
import { Loader2, BarChart2, Activity, RefreshCw, TrendingUp, TrendingDown, Users, CheckCircle2, Calendar, AlertTriangle, ChevronDown, ChevronUp } from 'lucide-react';
import { supabase } from '@/lib/supabaseClient';
import { DB } from '@/lib/db';
import { toISODate, dayOfWeek, getCentralTimeNow, getWeekStart } from '@/lib/useScheduleData';

type Event = { id: string; event_name: string; properties: Record<string, any>; created_at: string; };
type SessionStudent = { status: string; date: string; };
type OperationType = 'addition' | 'confirmation' | 'reschedule' | 'deletion' | 'other';
type InsightRange = 'all' | '7d' | '30d';

function getWeekKey(dateStr: string): string {
  const d = new Date(dateStr);
  const mon = getWeekStart(d);
  return toISODate(mon);
}

function weekLabel(iso: string) {
  return new Date(iso + 'T00:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

function timeAgo(iso: string) {
  const diff = Date.now() - new Date(iso).getTime();
  const m = Math.floor(diff / 60000);
  if (m < 1) return 'just now';
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

const FRIENDLY: Record<string, string> = {
  attendance_marked: 'Attendance marked',
  confirmation_updated: 'Confirmation updated',
  notes_saved: 'Notes saved',
  session_booked: 'Session booked',
  student_card_expanded: 'Student card opened',
  student_searched: 'Student searched',
  modal_opened: 'Session modal opened',
  modal_closed: 'Session modal closed',
  reassign_used: 'Student reassigned',
  student_removed: 'Student removed',
  day_view_changed: 'Day changed',
  week_view_changed: 'Week navigated',
  tab_switched: 'Tab switched',
  booking_form_opened: 'Booking form opened',
  recurring_booking_used: 'Recurring booking',
  metrics_panel_opened: 'Metrics panel opened',
  contact_expanded: 'Contact expanded',
  bluebook_opened: 'Bluebook opened',
  tutor_filter_used: 'Tutor filter used',
  student_created: 'Student created',
  student_deleted: 'Student deleted',
  student_edited: 'Student edited',
  tutor_created: 'Tutor created',
  tutor_edited: 'Tutor edited',
  tutor_deleted: 'Tutor deleted',
  reminder_sent: 'Reminder sent',
  template_saved: 'Template saved',
  bulk_remove_sessions: 'Bulk bookings removed',
  week_cleared_non_recurring: 'Week cleared (non-recurring)',
  schedule_builder_confirmed: 'Schedule builder confirmed',
  students_bulk_deleted: 'Students bulk deleted',
  tutors_bulk_deleted: 'Tutors bulk deleted',
  students_imported: 'Students imported',
  recurring_series_deleted: 'Series deleted',
  recurring_series_cancelled: 'Series cancelled',
  recurring_series_edited: 'Series edited',
  recurring_session_edited: 'Single session edited',
  recurring_session_cancelled: 'Single session cancelled',
  auto_book_used: 'Auto Book used',
  command_search_input: 'Command search input',
  command_search_submitted: 'Command search submitted',
};

const SOURCE_LABELS: Record<string, string> = {
  inline_today: 'Quick Add (Today View)',
  inline_week: 'Quick Add (Week View)',
  booking_form: 'Full Booking Form',
  grid_slot: 'Grid Slot Click',
  student_page: 'Student Page',
  attendance_modal: 'Attendance Modal',
  confirm_link: 'Confirmation Link',
  schedule_nav: 'Schedule Nav',
  optimizer: 'Optimizer',
};

const SOURCE_COLORS: Record<string, string> = {
  inline_today: '#6366f1',
  inline_week: '#8b5cf6',
  booking_form: '#dc2626',
  grid_slot: '#f59e0b',
  student_page: '#16a34a',
  attendance_modal: '#0ea5e9',
  confirm_link: '#2563eb',
  schedule_nav: '#475569',
  optimizer: '#7c3aed',
};

const AUTO_BOOK_ACTION_LABELS: Record<string, string> = {
  menu_open: 'Menu opened',
  batch_book: 'Batch Book',
  single_book: 'Single Book',
  optimize_day: 'Optimize Day',
  optimize_week: 'Optimize Week',
};

const AUTO_BOOK_ACTION_COLORS: Record<string, string> = {
  menu_open: '#475569',
  batch_book: '#16a34a',
  single_book: '#2563eb',
  optimize_day: '#0ea5e9',
  optimize_week: '#7c3aed',
};

const ATTEND_COLORS: Record<string, string> = {
  today_grid: '#dc2626',
  today_panel: '#f97316',
  week_grid: '#2563eb',
  modal: '#7c3aed',
};

const OPERATION_LABELS: Record<OperationType, string> = {
  addition: 'Additions',
  confirmation: 'Confirmations',
  reschedule: 'Reschedules',
  deletion: 'Deletions',
  other: 'Other',
};

const OPERATION_COLORS: Record<OperationType, string> = {
  addition: '#16a34a',
  confirmation: '#2563eb',
  reschedule: '#7c3aed',
  deletion: '#dc2626',
  other: '#94a3b8',
};

const OPERATION_FROM_EVENT: Record<string, OperationType> = {
  session_booked: 'addition',
  recurring_booking_used: 'addition',
  schedule_builder_confirmed: 'addition',
  student_created: 'addition',
  tutor_created: 'addition',
  students_imported: 'addition',

  confirmation_updated: 'confirmation',

  reassign_used: 'reschedule',
  recurring_series_edited: 'reschedule',
  recurring_session_edited: 'reschedule',

  student_removed: 'deletion',
  bulk_remove_sessions: 'deletion',
  week_cleared_non_recurring: 'deletion',
  recurring_series_cancelled: 'deletion',
  recurring_series_deleted: 'deletion',
  recurring_session_cancelled: 'deletion',
  student_deleted: 'deletion',
  students_bulk_deleted: 'deletion',
  tutor_deleted: 'deletion',
  tutors_bulk_deleted: 'deletion',
};

function getOperationType(eventName: string): OperationType {
  return OPERATION_FROM_EVENT[eventName] ?? 'other';
}

// ── Tiny horizontal bar ────────────────────────────────────────────────────────
function HBar({ value, max, color, label, count }: { value: number; max: number; color: string; label: string; count: number }) {
  const pct = max > 0 ? Math.min(100, Math.round((value / max) * 100)) : 0;
  return (
    <div className="flex items-center gap-3">
      <span className="text-[11px] text-[#475569] w-40 shrink-0 truncate">{label}</span>
      <div className="flex-1 h-2 rounded-full bg-[#f1f5f9] overflow-hidden">
        <div className="h-full rounded-full transition-all" style={{ width: `${pct}%`, background: color }} />
      </div>
      <span className="text-[11px] font-black w-8 text-right shrink-0" style={{ color }}>{count}</span>
    </div>
  );
}

// ── KPI card ──────────────────────────────────────────────────────────────────
function KPI({ label, value, sub, color, icon, trend }: { label: string; value: string | number; sub?: string; color: string; icon: React.ReactNode; trend?: 'up' | 'down' | null }) {
  return (
    <div className="bg-white rounded-2xl p-5" style={{ border: '1.5px solid #f1f5f9' }}>
      <div className="flex items-center justify-between mb-3">
        <div className="w-7 h-7 rounded-lg flex items-center justify-center" style={{ background: `${color}18`, color }}>
          {icon}
        </div>
        {trend === 'up' && <TrendingUp size={13} style={{ color: '#16a34a' }} />}
        {trend === 'down' && <TrendingDown size={13} style={{ color: '#dc2626' }} />}
      </div>
      <p className="text-[10px] font-black uppercase tracking-widest text-[#94a3b8] mb-1">{label}</p>
      <p className="text-3xl font-black leading-none" style={{ color }}>{value}</p>
      {sub && <p className="text-[11px] text-[#94a3b8] mt-1.5">{sub}</p>}
    </div>
  );
}

// ── Section wrapper ───────────────────────────────────────────────────────────
function Section({ title, sub, children }: { title: string; sub?: string; children: React.ReactNode }) {
  return (
    <div className="bg-white rounded-2xl overflow-hidden" style={{ border: '1.5px solid #f1f5f9' }}>
      <div className="px-6 py-4" style={{ borderBottom: '1px solid #f8fafc' }}>
        <p className="text-sm font-black text-[#0f172a]">{title}</p>
        {sub && <p className="text-[10px] text-[#94a3b8] mt-0.5">{sub}</p>}
      </div>
      <div className="p-6">{children}</div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────

export default function AnalyticsPage() {
  const [events, setEvents] = useState<Event[]>([]);
  const [sessionStudents, setSessionStudents] = useState<SessionStudent[]>([]);
  const [loading, setLoading] = useState(true);
  const [lastRefresh, setLastRefresh] = useState(new Date());
  const [showAllEvents, setShowAllEvents] = useState(false);
  const [weekRange, setWeekRange] = useState<4 | 8 | 12>(8);
  const [clearConfirm, setClearConfirm] = useState(false);
  const [clearing, setClearing] = useState(false);
  const [clearResult, setClearResult] = useState<string | null>(null);
  const [insightRange, setInsightRange] = useState<InsightRange>('30d');

  const fetchData = async () => {
    setLoading(true);
    const [evRes, sesRes] = await Promise.all([
      supabase.from(DB.events).select('*').order('created_at', { ascending: false }).limit(1000),
      supabase.from(DB.sessions).select(`id, session_date, ${DB.sessionStudents}(id, status)`).order('session_date'),
    ]);
    setEvents(evRes.data ?? []);
    setSessionStudents(
      (sesRes.data ?? []).flatMap((s: any) =>
        (s[DB.sessionStudents] ?? []).map((ss: any) => ({ status: ss.status, date: s.session_date }))
      )
    );
    setLastRefresh(new Date());
    setLoading(false);
  };

  useEffect(() => { fetchData(); }, []);

  const clearBookings = async () => {
    setClearing(true);
    setClearResult(null);
    try {
      const { error: e1 } = await supabase.from(DB.sessionStudents).delete().neq('id', '00000000-0000-0000-0000-000000000000');
      if (e1) throw e1;
      const { error: e2 } = await supabase.from(DB.sessions).delete().neq('id', '00000000-0000-0000-0000-000000000000');
      if (e2) throw e2;
      setClearResult('All bookings cleared.');
      setClearConfirm(false);
      await fetchData();
    } catch (err: any) {
      setClearResult('Error: ' + (err.message ?? 'Unknown error'));
    }
    setClearing(false);
  };

  const today = toISODate(getCentralTimeNow());
  const currentWeek = toISODate(getWeekStart(getCentralTimeNow()));

  // ── Core derived data ──────────────────────────────────────────────────────

  const { totalEvents, last7, bookings, attendanceMarks, uniqueDays } = useMemo(() => {
    const cutoff = new Date(); cutoff.setDate(cutoff.getDate() - 7);
    const bookingEvents = events.filter(e => e.event_name === 'session_booked');
    const attEvents = events.filter(e => e.event_name === 'attendance_marked');
    const days = new Set(events.map(e => e.created_at.slice(0, 10)));
    return {
      totalEvents: events.length,
      last7: events.filter(e => new Date(e.created_at) > cutoff).length,
      bookings: bookingEvents.length,
      attendanceMarks: attEvents.length,
      uniqueDays: days.size,
    };
  }, [events]);

  // ── Booking source breakdown ───────────────────────────────────────────────
  const bookingSources = useMemo(() => {
    const counts: Record<string, number> = {};
    events.filter(e => e.event_name === 'session_booked').forEach(e => {
      const src = e.properties?.source ?? 'unknown';
      counts[src] = (counts[src] ?? 0) + 1;
    });
    return Object.entries(counts).sort((a, b) => b[1] - a[1]);
  }, [events]);

  const maxBookingSource = bookingSources[0]?.[1] ?? 1;

  const insightEvents = useMemo(() => {
    if (insightRange === 'all') return events;

    const days = insightRange === '7d' ? 7 : 30;
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - days);
    return events.filter(event => new Date(event.created_at) >= cutoff);
  }, [events, insightRange]);

  // ── Auto Book + search bar insights ───────────────────────────────────────
  const autoBookInsights = useMemo(() => {
    const autoBookEvents = insightEvents.filter(e => e.event_name === 'auto_book_used');
    const actionCounts: Record<string, number> = {};
    autoBookEvents.forEach(event => {
      const action = String(event.properties?.action ?? 'unknown');
      actionCounts[action] = (actionCounts[action] ?? 0) + 1;
    });

    const topActions = Object.entries(actionCounts).sort((left, right) => right[1] - left[1]);

    const inputEvents = insightEvents.filter(e => e.event_name === 'command_search_input');
    const submitEvents = insightEvents.filter(e => e.event_name === 'command_search_submitted');

    const queryCounts: Record<string, number> = {};
    submitEvents.forEach(event => {
      const query = String(event.properties?.query ?? '').trim();
      if (!query) return;
      queryCounts[query] = (queryCounts[query] ?? 0) + 1;
    });

    const topQueries = Object.entries(queryCounts)
      .sort((left, right) => right[1] - left[1])
      .slice(0, 8);

    const lastSubmittedQuery = submitEvents
      .map(event => String(event.properties?.query ?? '').trim())
      .find(query => query.length > 0) ?? null;

    return {
      autoBookTotal: autoBookEvents.length,
      topActions,
      maxActionCount: topActions[0]?.[1] ?? 1,
      commandSearchInputs: inputEvents.length,
      commandSearchSubmits: submitEvents.length,
      uniqueSubmittedQueries: Object.keys(queryCounts).length,
      topQueries,
      lastSubmittedQuery,
    };
  }, [insightEvents]);

  // ── Attendance source breakdown ────────────────────────────────────────────
  const attendanceSources = useMemo(() => {
    const counts: Record<string, number> = {};
    events.filter(e => e.event_name === 'attendance_marked').forEach(e => {
      const src = e.properties?.source ?? 'unknown';
      counts[src] = (counts[src] ?? 0) + 1;
    });
    return Object.entries(counts).sort((a, b) => b[1] - a[1]);
  }, [events]);

  const maxAttSource = attendanceSources[0]?.[1] ?? 1;

  // ── Operations by type ─────────────────────────────────────────────────────
  const operationBreakdown = useMemo(() => {
    const counts: Record<OperationType, number> = {
      addition: 0,
      confirmation: 0,
      reschedule: 0,
      deletion: 0,
      other: 0,
    };

    events.forEach(e => {
      const type = getOperationType(e.event_name);
      counts[type] += 1;
    });

    return (Object.keys(counts) as OperationType[])
      .map(type => ({
        type,
        count: counts[type],
        label: OPERATION_LABELS[type],
        color: OPERATION_COLORS[type],
      }))
      .filter(item => item.type !== 'other' || item.count > 0);
  }, [events]);

  const maxOperationType = operationBreakdown[0]
    ? Math.max(...operationBreakdown.map(o => o.count), 1)
    : 1;

  // ── Weekly ops table ───────────────────────────────────────────────────────
  const weeklyData = useMemo(() => {
    const past = sessionStudents.filter(s => s.date < today);
    const weeks: Record<string, { present: number; noShow: number; total: number; bookings: number; events: number; attendanceMarks: number }> = {};

    past.forEach(s => {
      const wk = getWeekKey(s.date);
      if (!weeks[wk]) weeks[wk] = { present: 0, noShow: 0, total: 0, bookings: 0, events: 0, attendanceMarks: 0 };
      weeks[wk].total++;
      if (s.status === 'present' || s.status === 'confirmed') weeks[wk].present++;
      if (s.status === 'no-show') weeks[wk].noShow++;
    });

    events.forEach(e => {
      const wk = getWeekKey(e.created_at);
      if (!weeks[wk]) weeks[wk] = { present: 0, noShow: 0, total: 0, bookings: 0, events: 0, attendanceMarks: 0 };
      weeks[wk].events++;
      if (e.event_name === 'session_booked') weeks[wk].bookings++;
      if (e.event_name === 'attendance_marked') weeks[wk].attendanceMarks++;
    });

    return Object.entries(weeks)
      .sort((a, b) => a[0].localeCompare(b[0]))
      .slice(-weekRange)
      .map(([wk, d]) => ({
        week: wk, label: weekLabel(wk), isCurrent: wk === currentWeek, ...d,
        attendanceRate: d.total > 0 ? Math.round((d.present / d.total) * 100) : null,
        noShowRate: d.total > 0 ? Math.round((d.noShow / d.total) * 100) : null,
      }));
  }, [sessionStudents, events, today, weekRange, currentWeek]);

  // ── Feature usage (top 15) ─────────────────────────────────────────────────
  const featureUsage = useMemo(() => {
    const counts: Record<string, number> = {};
    events.forEach(e => { counts[e.event_name] = (counts[e.event_name] ?? 0) + 1; });
    return Object.entries(counts)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 15)
      .map(([name, count]) => ({ name, count, label: FRIENDLY[name] ?? name }));
  }, [events]);

  const maxFeature = featureUsage[0]?.count ?? 1;

  // ── Daily activity (last 14 days) ──────────────────────────────────────────
  const dailyActivity = useMemo(() => {
    const days: Record<string, number> = {};
    for (let i = 13; i >= 0; i--) {
      const d = new Date(); d.setDate(d.getDate() - i);
      days[toISODate(d)] = 0;
    }
    events.forEach(e => {
      const day = e.created_at.slice(0, 10);
      if (day in days) days[day]++;
    });
    return Object.entries(days).map(([date, count]) => ({
      date, count,
      label: new Date(date + 'T00:00:00').toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' }),
      isToday: date === today,
    }));
  }, [events, today]);

  const maxDaily = Math.max(...dailyActivity.map(d => d.count), 1);

  // ── Rate color ─────────────────────────────────────────────────────────────
  const rc = (v: number | null) => !v ? '#94a3b8' : v >= 80 ? '#16a34a' : v >= 60 ? '#f59e0b' : '#dc2626';

  if (loading) return (
    <div className="min-h-screen flex items-center justify-center" style={{ background: '#f8fafc' }}>
      <div className="flex flex-col items-center gap-3">
        <Loader2 size={22} className="animate-spin text-[#dc2626]" />
        <p className="text-xs font-semibold text-[#94a3b8] uppercase tracking-widest">Loading analytics…</p>
      </div>
    </div>
  );

  return (
    <div className="min-h-screen pb-20" style={{ background: '#f8fafc', fontFamily: 'ui-sans-serif, system-ui, sans-serif' }}>

      {/* Header */}
      <div className="sticky top-0 z-40 bg-white border-b border-[#f1f5f9]">
        <div className="max-w-5xl mx-auto px-6 h-14 flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <div className="w-7 h-7 rounded-lg bg-[#dc2626] flex items-center justify-center">
              <BarChart2 size={14} className="text-white" />
            </div>
            <div>
              <h1 className="text-sm font-black text-[#0f172a] leading-none">Analytics</h1>
              <p className="text-[9px] font-bold uppercase tracking-widest text-[#dc2626]">Pilot Dashboard</p>
            </div>
          </div>
          <div className="flex items-center gap-3">
            <p className="text-[10px] text-[#94a3b8]">Updated {timeAgo(lastRefresh.toISOString())}</p>
            <button onClick={fetchData}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold text-[#64748b]"
              style={{ background: '#f1f5f9' }}>
              <RefreshCw size={11} /> Refresh
            </button>
          </div>
        </div>
      </div>

      <div className="max-w-5xl mx-auto px-6 pt-6 space-y-5">

        {/* ── KPIs ── */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <KPI label="Total Actions" value={totalEvents} sub="all time" color="#dc2626" icon={<Activity size={13}/>}/>
          <KPI label="Last 7 Days" value={last7} sub={`across ${uniqueDays} active days`} color="#2563eb" icon={<TrendingUp size={13}/>}/>
          <KPI label="Bookings Logged" value={bookings} sub="via any method" color="#16a34a" icon={<Calendar size={13}/>}/>
          <KPI label="Attendance Marks" value={attendanceMarks} sub="present / no-show / reset" color="#d97706" icon={<CheckCircle2 size={13}/>}/>
        </div>

        {/* ── Daily activity sparkline ── */}
        <Section title="Daily Activity" sub="Last 14 days — events per day">
          <div className="flex items-end gap-1 h-20">
            {dailyActivity.map(d => {
              const pct = Math.max(4, Math.round((d.count / maxDaily) * 100));
              return (
                <div key={d.date} className="flex-1 flex flex-col items-center gap-1 group relative">
                  <div className="absolute bottom-full mb-1 left-1/2 -translate-x-1/2 bg-[#0f172a] text-white text-[9px] font-bold px-2 py-1 rounded-lg whitespace-nowrap opacity-0 group-hover:opacity-100 transition-opacity z-10 pointer-events-none">
                    {d.label}<br/>{d.count} events
                  </div>
                  <div className="w-full rounded-t-sm transition-all"
                    style={{ height: `${pct}%`, background: d.isToday ? '#dc2626' : d.count > 0 ? '#fca5a5' : '#f1f5f9', minHeight: 3 }}/>
                  <span className="text-[7px] text-[#cbd5e1] hidden md:block">
                    {new Date(d.date + 'T00:00:00').toLocaleDateString('en-US', { weekday: 'narrow' })}
                  </span>
                </div>
              );
            })}
          </div>
        </Section>

        {/* ── Booking sources — THE KEY QUESTION ── */}
        <Section title="How Are Bookings Being Made?" sub="This tells you which booking method they prefer">
          {bookingSources.length === 0
            ? <p className="text-xs text-[#94a3b8] italic">No booking events yet</p>
            : (
              <div className="space-y-3">
                {bookingSources.map(([src, count]) => (
                  <HBar key={src}
                    label={SOURCE_LABELS[src] ?? src}
                    value={count} max={maxBookingSource} count={count}
                    color={SOURCE_COLORS[src] ?? '#94a3b8'}/>
                ))}
                <p className="text-[10px] text-[#94a3b8] pt-2 border-t border-[#f8fafc]">
                  If "Quick Add" dominates → inline form is working. If "Full Booking Form" dominates → they prefer the detailed flow.
                </p>
              </div>
            )}
        </Section>

        <Section title="Auto Book + Search Insights" sub="Tracks Auto Book actions and command-bar search behavior">
          <div className="mb-4 flex items-center justify-between gap-3">
            <p className="text-[10px] text-[#94a3b8]">Range applied to this section only</p>
            <div className="flex gap-1">
              {([
                { key: '7d', label: '7d' },
                { key: '30d', label: '30d' },
                { key: 'all', label: 'All' },
              ] as { key: InsightRange; label: string }[]).map(option => (
                <button key={option.key} onClick={() => setInsightRange(option.key)}
                  className="px-2.5 py-1 rounded-lg text-[10px] font-bold transition-all"
                  style={insightRange === option.key
                    ? { background: '#1d4ed8', color: 'white' }
                    : { background: '#f8fafc', color: '#94a3b8' }}>
                  {option.label}
                </button>
              ))}
            </div>
          </div>

          <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-4">
            <KPI label="Auto Book Uses" value={autoBookInsights.autoBookTotal} color="#1d4ed8" icon={<Users size={13}/>}/>
            <KPI label="Search Inputs" value={autoBookInsights.commandSearchInputs} color="#0ea5e9" icon={<Activity size={13}/>}/>
            <KPI label="Search Submits" value={autoBookInsights.commandSearchSubmits} color="#7c3aed" icon={<CheckCircle2 size={13}/>}/>
            <KPI label="Unique Queries" value={autoBookInsights.uniqueSubmittedQueries} color="#16a34a" icon={<BarChart2 size={13}/>}/>
          </div>

          <div className="grid md:grid-cols-2 gap-5">
            <div>
              <p className="text-[10px] font-black uppercase tracking-widest text-[#94a3b8] mb-2">Auto Book Actions</p>
              {autoBookInsights.topActions.length === 0 ? (
                <p className="text-xs text-[#94a3b8] italic">No Auto Book events yet</p>
              ) : (
                <div className="space-y-2.5">
                  {autoBookInsights.topActions.map(([action, count]) => (
                    <HBar
                      key={action}
                      label={AUTO_BOOK_ACTION_LABELS[action] ?? action}
                      value={count}
                      max={autoBookInsights.maxActionCount}
                      count={count}
                      color={AUTO_BOOK_ACTION_COLORS[action] ?? '#94a3b8'}
                    />
                  ))}
                </div>
              )}
            </div>

            <div>
              <p className="text-[10px] font-black uppercase tracking-widest text-[#94a3b8] mb-2">Top Search Queries</p>
              {autoBookInsights.topQueries.length === 0 ? (
                <p className="text-xs text-[#94a3b8] italic">No command searches submitted yet</p>
              ) : (
                <div className="space-y-2">
                  {autoBookInsights.topQueries.map(([query, count]) => (
                    <div key={query} className="flex items-center justify-between gap-3 rounded-lg border border-[#f1f5f9] bg-[#fafafa] px-3 py-2">
                      <span className="text-xs font-semibold text-[#1e293b] truncate">{query}</span>
                      <span className="text-[10px] font-black text-[#64748b] shrink-0">{count}</span>
                    </div>
                  ))}
                </div>
              )}

              <p className="text-[10px] text-[#94a3b8] mt-3">
                Latest submitted query:{' '}
                <span className="font-semibold text-[#475569]">{autoBookInsights.lastSubmittedQuery ?? 'None yet'}</span>
              </p>
            </div>
          </div>
        </Section>

        {/* ── Where attendance is being marked ── */}
        <Section title="Where Is Attendance Being Marked?" sub="Helps you see which UI surface is actually used for marking">
          {attendanceSources.length === 0
            ? <p className="text-xs text-[#94a3b8] italic">No attendance events yet</p>
            : (
              <div className="space-y-3">
                {attendanceSources.map(([src, count]) => (
                  <HBar key={src}
                    label={src.replace(/_/g, ' ').replace(/\b\w/g, l => l.toUpperCase())}
                    value={count} max={maxAttSource} count={count}
                    color={ATTEND_COLORS[src] ?? '#94a3b8'}/>
                ))}
              </div>
            )}
        </Section>

        <Section title="Operations By Type" sub="Separated by additions, confirmations, reschedules, and deletions">
          {operationBreakdown.length === 0
            ? <p className="text-xs text-[#94a3b8] italic">No operation events yet</p>
            : (
              <div className="space-y-3">
                {operationBreakdown.map(op => (
                  <HBar
                    key={op.type}
                    label={op.label}
                    value={op.count}
                    max={maxOperationType}
                    count={op.count}
                    color={op.color}
                  />
                ))}
              </div>
            )}
        </Section>

        {/* ── Weekly ops table ── */}
        <div className="bg-white rounded-2xl overflow-hidden" style={{ border: '1.5px solid #f1f5f9' }}>
          <div className="px-6 py-4 flex items-center justify-between" style={{ borderBottom: '1px solid #f8fafc' }}>
            <div>
              <p className="text-sm font-black text-[#0f172a]">Week-by-Week</p>
              <p className="text-[10px] text-[#94a3b8] mt-0.5">App usage + attendance outcomes</p>
            </div>
            <div className="flex gap-1">
              {([4, 8, 12] as const).map(w => (
                <button key={w} onClick={() => setWeekRange(w)}
                  className="px-2.5 py-1 rounded-lg text-[10px] font-bold transition-all"
                  style={weekRange === w ? { background: '#dc2626', color: 'white' } : { background: '#f8fafc', color: '#94a3b8' }}>
                  {w}w
                </button>
              ))}
            </div>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr style={{ background: '#fafafa', borderBottom: '1px solid #f1f5f9' }}>
                  {['Week', 'App Events', 'Bookings', 'Att. Marks', 'Sessions', 'Attendance %', 'No-show %'].map(h => (
                    <th key={h} className="px-4 py-3 text-left text-[9px] font-black uppercase tracking-widest text-[#94a3b8]">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {weeklyData.length === 0 ? (
                  <tr><td colSpan={7} className="px-5 py-8 text-center text-xs text-[#94a3b8] italic">No data yet</td></tr>
                ) : weeklyData.map((wk, i) => (
                  <tr key={wk.week} style={{ borderBottom: '1px solid #f8fafc', background: wk.isCurrent ? '#fffbf9' : i % 2 === 0 ? 'white' : '#fafafa' }}>
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-2">
                        <span className="text-xs font-bold text-[#1e293b]">{wk.label}</span>
                        {wk.isCurrent && <span className="text-[8px] font-black px-1.5 py-0.5 rounded-full text-white bg-[#dc2626]">NOW</span>}
                      </div>
                    </td>
                    <td className="px-4 py-3">
                      <span className="text-xs font-bold text-[#475569]">{wk.events || <span className="text-[#e2e8f0]">—</span>}</span>
                    </td>
                    <td className="px-4 py-3">
                      <span className="text-xs font-bold" style={{ color: wk.bookings > 0 ? '#16a34a' : '#e2e8f0' }}>{wk.bookings || '—'}</span>
                    </td>
                    <td className="px-4 py-3">
                      <span className="text-xs font-bold" style={{ color: wk.attendanceMarks > 0 ? '#d97706' : '#e2e8f0' }}>{wk.attendanceMarks || '—'}</span>
                    </td>
                    <td className="px-4 py-3">
                      <span className="text-xs font-bold text-[#475569]">{wk.total || <span className="text-[#e2e8f0]">—</span>}</span>
                    </td>
                    <td className="px-4 py-3">
                      {wk.attendanceRate !== null
                        ? <span className="text-xs font-black" style={{ color: rc(wk.attendanceRate) }}>{wk.attendanceRate}%</span>
                        : <span className="text-[#e2e8f0] text-xs">—</span>}
                    </td>
                    <td className="px-4 py-3">
                      {wk.noShowRate !== null
                        ? <span className="text-xs font-black" style={{ color: wk.noShowRate > 20 ? '#dc2626' : '#94a3b8' }}>{wk.noShowRate}%</span>
                        : <span className="text-[#e2e8f0] text-xs">—</span>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        {/* ── Feature usage ── */}
        <Section title="Feature Usage" sub="Which parts of the app get used most">
          {featureUsage.length === 0
            ? <p className="text-xs text-[#94a3b8] italic">No events yet</p>
            : (
              <div className="space-y-2.5">
                {featureUsage.map(f => (
                  <HBar key={f.name} label={f.label} value={f.count} max={maxFeature} count={f.count} color="#dc2626"/>
                ))}
              </div>
            )}
        </Section>

        {/* ── Event feed ── */}
        <div className="bg-white rounded-2xl overflow-hidden" style={{ border: '1.5px solid #f1f5f9' }}>
          <div className="px-6 py-4 flex items-center justify-between" style={{ borderBottom: '1px solid #f8fafc' }}>
            <div>
              <p className="text-sm font-black text-[#0f172a]">Event Feed</p>
              <p className="text-[10px] text-[#94a3b8] mt-0.5">Raw log of all actions</p>
            </div>
            <div className="flex items-center gap-1.5">
              <div className="w-1.5 h-1.5 rounded-full bg-[#16a34a] animate-pulse"/>
              <span className="text-[10px] text-[#94a3b8]">Live</span>
            </div>
          </div>
          <div>
            {events.length === 0 && (
              <div className="px-6 py-8 text-center text-xs text-[#94a3b8] italic">No events yet</div>
            )}
            {(showAllEvents ? events : events.slice(0, 25)).map((e, i) => {
              const label = FRIENDLY[e.event_name] ?? e.event_name;
              const props = e.properties && Object.keys(e.properties).length > 0;
              const src = e.properties?.source;
              const opType = getOperationType(e.event_name);
              return (
                <div key={e.id} className="flex items-start gap-3 px-6 py-3"
                  style={{ borderBottom: '1px solid #f8fafc', background: i % 2 === 0 ? 'white' : '#fafafa' }}>
                  <div className="w-1.5 h-1.5 rounded-full mt-1.5 shrink-0 bg-[#dc2626]"/>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="text-xs font-bold text-[#1e293b]">{label}</span>
                      <span className="text-[9px] font-black px-1.5 py-0.5 rounded-full"
                        style={{ background: `${OPERATION_COLORS[opType]}18`, color: OPERATION_COLORS[opType] }}>
                        {OPERATION_LABELS[opType]}
                      </span>
                      {src && (
                        <span className="text-[9px] font-bold px-1.5 py-0.5 rounded-full"
                          style={{ background: `${SOURCE_COLORS[src] ?? '#94a3b8'}18`, color: SOURCE_COLORS[src] ?? '#94a3b8' }}>
                          {SOURCE_LABELS[src] ?? src}
                        </span>
                      )}
                    </div>
                    {props && (
                      <p className="text-[10px] text-[#94a3b8] mt-0.5 truncate">
                        {Object.entries(e.properties)
                          .filter(([k]) => k !== 'source')
                          .map(([k, v]) => `${k}: ${v}`)
                          .join(' · ')}
                      </p>
                    )}
                  </div>
                  <span className="text-[10px] text-[#cbd5e1] shrink-0 mt-0.5">{timeAgo(e.created_at)}</span>
                </div>
              );
            })}
          </div>
          {events.length > 25 && (
            <div className="px-6 py-3 border-t border-[#f8fafc]">
              <button onClick={() => setShowAllEvents(s => !s)}
                className="flex items-center gap-1.5 text-xs font-bold text-[#64748b]">
                {showAllEvents ? <><ChevronUp size={12}/> Show less</> : <><ChevronDown size={12}/> Show all {events.length} events</>}
              </button>
            </div>
          )}
        </div>

        {/* ── Danger zone ── */}
        <div className="bg-white rounded-2xl overflow-hidden" style={{ border: '1.5px solid #fecaca' }}>
          <div className="px-6 py-4 flex items-center justify-between" style={{ borderBottom: '1px solid #fef2f2' }}>
            <div>
              <p className="text-sm font-black text-[#dc2626]">Danger Zone</p>
              <p className="text-[10px] text-[#94a3b8] mt-0.5">Clear all bookings — use before demo or fresh pilot start</p>
            </div>
          </div>
          <div className="px-6 py-5 space-y-3">
            {clearResult && (
              <div className="px-4 py-2.5 rounded-xl text-xs font-semibold"
                style={{ background: clearResult.startsWith('Error') ? '#fef2f2' : '#f0fdf4', color: clearResult.startsWith('Error') ? '#dc2626' : '#16a34a', border: `1px solid ${clearResult.startsWith('Error') ? '#fecaca' : '#bbf7d0'}` }}>
                {clearResult}
              </div>
            )}
            {!clearConfirm ? (
              <button onClick={() => { setClearConfirm(true); setClearResult(null); }}
                className="flex items-center gap-2 px-4 py-2.5 rounded-xl text-xs font-black uppercase tracking-wider transition-all"
                style={{ background: '#fef2f2', border: '1.5px solid #fecaca', color: '#dc2626' }}>
                Clear All Bookings
              </button>
            ) : (
              <div className="space-y-3">
                <div className="px-4 py-3 rounded-xl" style={{ background: '#fef2f2', border: '1px solid #fecaca' }}>
                  <p className="text-xs font-black text-[#dc2626] mb-1">Are you sure?</p>
                  <p className="text-[11px] text-[#64748b]">This deletes all session bookings and session records. Tutor availability, students, and settings are untouched. This cannot be undone.</p>
                </div>
                <div className="flex gap-2">
                  <button onClick={() => setClearConfirm(false)}
                    className="flex-1 py-2.5 rounded-xl text-xs font-bold"
                    style={{ background: '#f1f5f9', color: '#64748b' }}>
                    Cancel
                  </button>
                  <button onClick={clearBookings} disabled={clearing}
                    className="flex-1 py-2.5 rounded-xl text-xs font-black text-white disabled:opacity-50 transition-all"
                    style={{ background: '#dc2626' }}>
                    {clearing ? 'Clearing…' : 'Yes, Clear Everything'}
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>

        <p className="text-[10px] text-[#cbd5e1] text-center pb-4">
          Attendance rates are only accurate if attendance is consistently marked · Booking source tracking requires logEvent source field in all booking handlers
        </p>
      </div>
    </div>
  );
}