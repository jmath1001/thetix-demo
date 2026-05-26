"use client"
import React, { useState, useEffect, useMemo } from 'react';
import { Loader2, BarChart2, Activity, RefreshCw, TrendingUp, TrendingDown, Users, CheckCircle2, Calendar, AlertTriangle, ChevronDown, ChevronUp } from 'lucide-react';
import { supabase } from '@/lib/supabaseClient';
import { DB, getCenterId } from '@/lib/db';
import { toISODate, dayOfWeek, getCentralTimeNow, getWeekStart } from '@/lib/useScheduleData';

type Event = { id: string; event_name: string; properties: Record<string, any>; created_at: string; };
type SessionStudent = { status: string; date: string; isVirtual: boolean; };
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
  session_booked: 'Session booked',
  reassign_used: 'Student reassigned',
  student_removed: 'Student removed',
  recurring_booking_used: 'Recurring booking',
  student_created: 'Student created',
  student_edited: 'Student edited',
  tutor_created: 'Tutor created',
  tutor_edited: 'Tutor edited',
  tutor_deleted: 'Tutor deleted',
  tutor_time_off_added: 'Tutor time off added',
  tutor_time_off_removed: 'Tutor time off removed',
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
  term_created: 'Term created',
  term_updated: 'Term updated',
  term_deleted: 'Term deleted',
  center_settings_saved: 'Settings saved',
  enrollment_form_sent: 'Enrollment form sent',
  blast_sent: 'Email blast sent',
  tutor_schedules_sent: 'Tutor schedules sent',
  student_schedules_sent: 'Student schedules sent',
  auto_reminder_toggled: 'Auto reminder toggled',
  auto_reminder_time_saved: 'Reminder time updated',
  ai_booking_initiated: 'AI booking initiated',
  hours_adjusted: 'Hours adjusted',
  session_record_corrected: 'Session record corrected',
  recurring_session_student_off: 'Student excused from session',
  first_visit: 'First visit',
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
  tutor_time_off_added: 'other',
  tutor_time_off_removed: 'other',
  term_created: 'addition',
  term_updated: 'reschedule',
  term_deleted: 'deletion',
  center_settings_saved: 'other',
  enrollment_form_sent: 'other',
  blast_sent: 'other',
  tutor_schedules_sent: 'other',
  student_schedules_sent: 'other',
  auto_reminder_toggled: 'other',
  auto_reminder_time_saved: 'other',
  ai_booking_initiated: 'addition',
  hours_adjusted: 'other',
  session_record_corrected: 'other',
  recurring_session_student_off: 'deletion',
};

function getOperationType(eventName: string): OperationType {
  return OPERATION_FROM_EVENT[eventName] ?? 'other';
}

// â”€â”€ Bar â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
function Bar({ value, max, color, label, count }: { value: number; max: number; color: string; label: string; count: number }) {
  const pct = max > 0 ? Math.min(100, Math.round((value / max) * 100)) : 0;
  return (
    <div className="flex items-center gap-3">
      <span className="w-48 shrink-0 truncate text-xs font-semibold" style={{ color: '#374151' }}>{label}</span>
      <div className="flex-1 h-3 rounded-full overflow-hidden" style={{ background: '#e5e7eb' }}>
        <div className="h-full rounded-full transition-all duration-300" style={{ width: `${pct}%`, background: color }} />
      </div>
      <span className="w-10 text-right shrink-0 text-sm font-black" style={{ color }}>{count}</span>
    </div>
  );
}

// â”€â”€ KPI card â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
function KPI({ label, value, sub, color, icon }: { label: string; value: string | number; sub?: string; color: string; icon: React.ReactNode }) {
  return (
    <div className="rounded-2xl p-5" style={{ background: 'white', border: '2px solid #e5e7eb' }}>
      <div className="w-9 h-9 rounded-xl flex items-center justify-center mb-3" style={{ background: color }}>
        <span style={{ color: 'white' }}>{icon}</span>
      </div>
      <p className="text-[10px] font-black uppercase tracking-widest mb-1" style={{ color: '#9ca3af' }}>{label}</p>
      <p className="text-4xl font-black leading-none mb-1" style={{ color: '#111827' }}>{value}</p>
      {sub && <p className="text-xs" style={{ color: '#9ca3af' }}>{sub}</p>}
    </div>
  );
}

// â”€â”€ Collapsible section â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
function Collapsible({ title, sub, badge, badgeColor = '#dc2626', children, defaultOpen = true }: {
  title: string; sub?: string; badge?: number | string; badgeColor?: string;
  children: React.ReactNode; defaultOpen?: boolean;
}) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className="rounded-2xl overflow-hidden" style={{ background: 'white', border: '2px solid #e2e8f0' }}>
      <button
        onClick={() => setOpen(o => !o)}
        className="w-full flex items-center justify-between px-6 py-4 text-left"
        style={{ background: '#1e293b' }}>
        <div className="flex items-center gap-3 min-w-0">
          <span className="text-sm font-black text-white">{title}</span>
          {badge !== undefined && Number(badge) > 0 && (
            <span className="text-[10px] font-black px-2.5 py-0.5 rounded-full shrink-0" style={{ background: badgeColor, color: 'white' }}>
              {badge}
            </span>
          )}
          {sub && <span className="text-[11px] text-slate-400 hidden md:block">{sub}</span>}
        </div>
        {open ? <ChevronUp size={15} color="#64748b" /> : <ChevronDown size={15} color="#64748b" />}
      </button>
      {open && <div className="p-6">{children}</div>}
    </div>
  );
}

// â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

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

  const [firstVisits, setFirstVisits] = useState<Event[]>([]);
  const [studentDateExceptions, setStudentDateExceptions] = useState<any[]>([]);
  const fetchData = async () => {
    setLoading(true);
    const centerId = getCenterId();
    const [evRes, sesRes, fvRes, excRes] = await Promise.all([
      supabase.from(DB.events).select('*').eq('center_id', centerId).order('created_at', { ascending: false }).limit(1000),
      supabase.from(DB.sessions).select(`id, session_date, ${DB.sessionStudents}(id, status, is_virtual)`).eq('center_id', centerId).order('session_date'),
      supabase.from(DB.events).select('*').eq('center_id', centerId).eq('event_name', 'first_visit').order('created_at', { ascending: false }).limit(1000),
      supabase.from(DB.studentDateExceptions).select('id, exception_date, reason, created_at, student_id').eq('center_id', centerId).order('exception_date', { ascending: false }).limit(500),
    ]);
    setEvents(evRes.data ?? []);
    setSessionStudents(
      (sesRes.data ?? []).flatMap((s: any) =>
        (s[DB.sessionStudents] ?? []).map((ss: any) => ({ status: ss.status, date: s.session_date, isVirtual: ss.is_virtual ?? false }))
      )
    );
    setFirstVisits(fvRes.data ?? []);
    setStudentDateExceptions(excRes.data ?? []);
    setLastRefresh(new Date());
    setLoading(false);
  };
  // Unique first visits by device/browser (id)
  const uniqueFirstVisits = useMemo(() => {
    const seen = new Set();
    const visits: Event[] = [];
    for (const v of firstVisits) {
      const id = v.properties?.id;
      if (id && !seen.has(id)) {
        seen.add(id);
        visits.push(v);
      }
    }
    return visits;
  }, [firstVisits]);

  useEffect(() => { fetchData(); }, []);

  const clearBookings = async () => {
    setClearing(true);
    setClearResult(null);
    try {
      const centerId = getCenterId();
      const { data: sessions } = await supabase.from(DB.sessions).select('id').eq('center_id', centerId);
      const sessionIds = (sessions ?? []).map((s: any) => s.id);
      if (sessionIds.length > 0) {
        const { error: e1 } = await supabase.from(DB.sessionStudents).delete().in('session_id', sessionIds);
        if (e1) throw e1;
      }
      const { error: e2 } = await supabase.from(DB.sessions).delete().eq('center_id', centerId);
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

  // â”€â”€ Core derived data â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

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

  // â”€â”€ Booking source breakdown â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
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

  // â”€â”€ Auto Book + search bar insights â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
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

  // â”€â”€ Attendance source breakdown â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  const attendanceSources = useMemo(() => {
    const counts: Record<string, number> = {};
    events.filter(e => e.event_name === 'attendance_marked').forEach(e => {
      const src = e.properties?.source ?? 'unknown';
      counts[src] = (counts[src] ?? 0) + 1;
    });
    return Object.entries(counts).sort((a, b) => b[1] - a[1]);
  }, [events]);

  const maxAttSource = attendanceSources[0]?.[1] ?? 1;

  // â”€â”€ Operations by type â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
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

  // â”€â”€ Weekly ops table â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
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

  // â”€â”€ Feature usage (top 15) â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  const featureUsage = useMemo(() => {
    const counts: Record<string, number> = {};
    events.forEach(e => { counts[e.event_name] = (counts[e.event_name] ?? 0) + 1; });
    return Object.entries(counts)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 15)
      .map(([name, count]) => ({ name, count, label: FRIENDLY[name] ?? name }));
  }, [events]);

  const maxFeature = featureUsage[0]?.count ?? 1;

  // â”€â”€ Daily activity (last 14 days) â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
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

  // â”€â”€ Student & Tutor Management â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  const mgmtActivity = useMemo(() => {
    const studentEvents = ['student_created', 'student_edited', 'student_deleted', 'students_bulk_deleted', 'students_imported'];
    const tutorEvents   = ['tutor_created', 'tutor_edited', 'tutor_deleted', 'tutors_bulk_deleted'];
    const counts: Record<string, number> = {};
    events.forEach(e => {
      if (studentEvents.includes(e.event_name) || tutorEvents.includes(e.event_name)) {
        counts[e.event_name] = (counts[e.event_name] ?? 0) + 1;
      }
    });
    return Object.entries(counts).sort((a, b) => b[1] - a[1]);
  }, [events]);
  const maxMgmt = mgmtActivity[0]?.[1] ?? 1;

  // â”€â”€ Communications breakdown â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  const commsBreakdown = useMemo(() => {
    const categories = [
      { key: 'reminder_sent',          label: 'Reminders',           color: '#dc2626' },
      { key: 'blast_sent',             label: 'Email Blasts',        color: '#7c3aed' },
      { key: 'tutor_schedules_sent',   label: 'Tutor Schedules',     color: '#2563eb' },
      { key: 'student_schedules_sent', label: 'Student Schedules',   color: '#059669' },
      { key: 'enrollment_form_sent',   label: 'Enrollment Forms',    color: '#d97706' },
    ];
    return categories.map(c => ({
      ...c,
      count: events.filter(e => e.event_name === c.key).length,
    })).filter(c => c.count > 0);
  }, [events]);
  const maxComms = Math.max(...commsBreakdown.map(c => c.count), 1);
  const totalEmailsSent = commsBreakdown.reduce((sum, c) => sum + c.count, 0);

  // â”€â”€ Center config activity â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  const centerActivity = useMemo(() => {
    const cats = [
      { key: 'term_created',        label: 'Terms created',   color: '#16a34a' },
      { key: 'term_updated',        label: 'Terms updated',   color: '#f59e0b' },
      { key: 'term_deleted',        label: 'Terms deleted',   color: '#dc2626' },
      { key: 'center_settings_saved', label: 'Settings saved', color: '#2563eb' },
      { key: 'enrollment_form_sent', label: 'Enrollment forms sent', color: '#7c3aed' },
    ];
    return cats.map(c => ({
      ...c,
      count: events.filter(e => e.event_name === c.key).length,
    })).filter(c => c.count > 0);
  }, [events]);
  const maxCenter = centerActivity[0]?.count ?? 1;

  // â”€â”€ Virtual vs In-Person â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  const virtualStats = useMemo(() => {
    const virtual = sessionStudents.filter(s => s.isVirtual).length;
    const inPerson = sessionStudents.filter(s => !s.isVirtual).length;
    const total = sessionStudents.length;
    return { virtual, inPerson, total, pct: total > 0 ? Math.round((virtual / total) * 100) : 0 };
  }, [sessionStudents]);

  // â”€â”€ Student time off â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  const studentTimeOffStats = useMemo(() => {
    const total = studentDateExceptions.length;
    const upcoming = studentDateExceptions.filter(e => e.exception_date >= today).slice(0, 10);
    const reasons: Record<string, number> = {};
    studentDateExceptions.forEach(e => {
      const r = (e.reason as string | null)?.trim() || 'No reason given';
      reasons[r] = (reasons[r] ?? 0) + 1;
    });
    const topReasons = Object.entries(reasons).sort((a, b) => b[1] - a[1]).slice(0, 6);
    return { total, upcoming, topReasons, maxReason: topReasons[0]?.[1] ?? 1 };
  }, [studentDateExceptions, today]);

  // â”€â”€ Rate color â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  const rc = (v: number | null) => !v ? '#94a3b8' : v >= 80 ? '#16a34a' : v >= 60 ? '#f59e0b' : '#dc2626';

  if (loading) return (
    <div className="min-h-screen flex items-center justify-center" style={{ background: '#f1f5f9' }}>
      <div className="flex flex-col items-center gap-3">
        <Loader2 size={22} className="animate-spin" style={{ color: '#dc2626' }} />
        <p className="text-xs font-semibold uppercase tracking-widest" style={{ color: '#9ca3af' }}>Loading analyticsâ€¦</p>
      </div>
    </div>
  );

  return (
    <div className="min-h-screen pb-20" style={{ background: '#f1f5f9' }}>

      {/* â”€â”€ Header â”€â”€ */}
      <div className="sticky top-0 z-40" style={{ background: 'white', borderBottom: '2px solid #e5e7eb' }}>
        <div className="max-w-5xl mx-auto px-6 h-14 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-lg flex items-center justify-center" style={{ background: '#dc2626' }}>
              <BarChart2 size={15} color="white" />
            </div>
            <div>
              <h1 className="text-sm font-black leading-none" style={{ color: '#0f172a' }}>Analytics</h1>
              <p className="text-[9px] font-bold uppercase tracking-widest" style={{ color: '#dc2626' }}>Pilot Dashboard</p>
            </div>
          </div>
          <div className="flex items-center gap-3">
            <span className="text-[11px]" style={{ color: '#9ca3af' }}>Updated {timeAgo(lastRefresh.toISOString())}</span>
            <button onClick={fetchData}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold"
              style={{ background: '#f1f5f9', color: '#374151', border: '1.5px solid #e5e7eb' }}>
              <RefreshCw size={11} /> Refresh
            </button>
          </div>
        </div>
      </div>

      <div className="max-w-5xl mx-auto px-6 pt-6 space-y-4">

        {/* â”€â”€ KPIs â”€â”€ */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <KPI label="Total Actions" value={totalEvents} sub="all time" color="#dc2626" icon={<Activity size={15}/>}/>
          <KPI label="Bookings Made" value={bookings} sub="any method" color="#16a34a" icon={<Calendar size={15}/>}/>
          <KPI label="Emails Sent" value={totalEmailsSent} sub="all types" color="#7c3aed" icon={<CheckCircle2 size={15}/>}/>
          <KPI label="Attendance Marks" value={attendanceMarks} sub="present Â· no-show" color="#d97706" icon={<Users size={15}/>}/>
        </div>

        {/* â”€â”€ Bookings â”€â”€ */}
        <Collapsible title="Bookings" badge={bookings} badgeColor="#16a34a" defaultOpen={true}>
          {bookings === 0 ? (
            <p className="text-sm italic" style={{ color: '#9ca3af' }}>No bookings recorded yet.</p>
          ) : (
            <div className="space-y-8">
              {/* Source breakdown */}
              <div>
                <p className="text-[10px] font-black uppercase tracking-widest mb-4" style={{ color: '#6b7280' }}>Booking Source</p>
                {bookingSources.length === 0 ? (
                  <p className="text-xs italic" style={{ color: '#9ca3af' }}>No source data</p>
                ) : (
                  <div className="space-y-3">
                    {bookingSources.map(([src, count]) => (
                      <Bar key={src} label={SOURCE_LABELS[src] ?? src} value={count} max={maxBookingSource} count={count} color={SOURCE_COLORS[src] ?? '#94a3b8'}/>
                    ))}
                  </div>
                )}
              </div>

              {/* Week-by-week */}
              <div>
                <div className="flex items-center justify-between mb-4">
                  <p className="text-[10px] font-black uppercase tracking-widest" style={{ color: '#6b7280' }}>Week by Week</p>
                  <div className="flex gap-1">
                    {([4, 8, 12] as const).map(w => (
                      <button key={w} onClick={() => setWeekRange(w)}
                        className="px-2.5 py-1 rounded-lg text-[10px] font-bold transition-all"
                        style={weekRange === w ? { background: '#1e293b', color: 'white' } : { background: '#e5e7eb', color: '#6b7280' }}>
                        {w}w
                      </button>
                    ))}
                  </div>
                </div>
                <div className="rounded-xl overflow-hidden" style={{ border: '2px solid #e5e7eb' }}>
                  <table className="w-full">
                    <thead>
                      <tr style={{ background: '#1e293b' }}>
                        {['Week', 'Bookings', 'Sessions', 'Attendance %', 'No-Show %'].map(h => (
                          <th key={h} className="px-4 py-3 text-left text-[9px] font-black uppercase tracking-widest" style={{ color: '#94a3b8' }}>{h}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {weeklyData.length === 0 ? (
                        <tr><td colSpan={5} className="px-5 py-8 text-center text-xs italic" style={{ color: '#9ca3af' }}>No data yet</td></tr>
                      ) : weeklyData.map((wk, i) => (
                        <tr key={wk.week} style={{ borderBottom: '1px solid #f1f5f9', background: wk.isCurrent ? '#fef9f9' : i % 2 === 0 ? 'white' : '#fafafa' }}>
                          <td className="px-4 py-3">
                            <div className="flex items-center gap-2">
                              <span className="text-xs font-bold" style={{ color: '#1e293b' }}>{wk.label}</span>
                              {wk.isCurrent && <span className="text-[8px] font-black px-1.5 py-0.5 rounded-full text-white" style={{ background: '#dc2626' }}>NOW</span>}
                            </div>
                          </td>
                          <td className="px-4 py-3">
                            <span className="text-sm font-black" style={{ color: wk.bookings > 0 ? '#16a34a' : '#d1d5db' }}>{wk.bookings || 'â€”'}</span>
                          </td>
                          <td className="px-4 py-3">
                            <span className="text-sm font-semibold" style={{ color: wk.total > 0 ? '#374151' : '#d1d5db' }}>{wk.total || 'â€”'}</span>
                          </td>
                          <td className="px-4 py-3">
                            {wk.attendanceRate !== null
                              ? <span className="text-sm font-black" style={{ color: rc(wk.attendanceRate) }}>{wk.attendanceRate}%</span>
                              : <span style={{ color: '#d1d5db' }}>â€”</span>}
                          </td>
                          <td className="px-4 py-3">
                            {wk.noShowRate !== null
                              ? <span className="text-sm font-black" style={{ color: wk.noShowRate > 20 ? '#dc2626' : '#64748b' }}>{wk.noShowRate}%</span>
                              : <span style={{ color: '#d1d5db' }}>â€”</span>}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
          )}
        </Collapsible>

        {/* â”€â”€ Notifications â”€â”€ */}
        <Collapsible title="Notifications Sent" badge={totalEmailsSent} badgeColor="#7c3aed" defaultOpen={true}>
          {totalEmailsSent === 0 ? (
            <p className="text-sm italic" style={{ color: '#9ca3af' }}>No emails sent yet.</p>
          ) : (
            <div className="space-y-3">
              {commsBreakdown.map(c => (
                <Bar key={c.key} label={c.label} value={c.count} max={maxComms} count={c.count} color={c.color}/>
              ))}
            </div>
          )}
        </Collapsible>

        {/* â”€â”€ Operations Breakdown â”€â”€ */}
        <Collapsible title="Operation Types" defaultOpen={false} sub="Additions Â· Deletions Â· Confirmations Â· Reschedules">
          {operationBreakdown.length === 0 ? (
            <p className="text-sm italic" style={{ color: '#9ca3af' }}>No events yet.</p>
          ) : (
            <div className="space-y-3">
              {operationBreakdown.map(op => (
                <Bar key={op.type} label={op.label} value={op.count} max={maxOperationType} count={op.count} color={op.color}/>
              ))}
            </div>
          )}
        </Collapsible>

        {/* â”€â”€ Event Log â”€â”€ */}
        <Collapsible title="Event Log" badge={events.length} badgeColor="#475569" defaultOpen={false}>
          {events.length === 0 ? (
            <p className="text-sm italic text-center py-4" style={{ color: '#9ca3af' }}>No events yet.</p>
          ) : (
            <>
              <div className="rounded-xl overflow-hidden" style={{ border: '2px solid #e5e7eb' }}>
                {(showAllEvents ? events : events.slice(0, 25)).map((e, i) => {
                  const label = FRIENDLY[e.event_name] ?? e.event_name;
                  const hasProps = e.properties && Object.keys(e.properties).length > 0;
                  const src = e.properties?.source;
                  const opType = getOperationType(e.event_name);
                  return (
                    <div key={e.id} className="flex items-start gap-3 px-4 py-3"
                      style={{ borderBottom: '1px solid #f1f5f9', background: i % 2 === 0 ? 'white' : '#fafafa' }}>
                      <div className="w-2 h-2 rounded-full mt-1.5 shrink-0" style={{ background: OPERATION_COLORS[opType] }}/>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="text-xs font-bold" style={{ color: '#1e293b' }}>{label}</span>
                          <span className="text-[9px] font-black px-1.5 py-0.5 rounded-full"
                            style={{ background: `${OPERATION_COLORS[opType]}22`, color: OPERATION_COLORS[opType] }}>
                            {OPERATION_LABELS[opType]}
                          </span>
                          {src && (
                            <span className="text-[9px] font-bold px-1.5 py-0.5 rounded-full"
                              style={{ background: `${SOURCE_COLORS[src] ?? '#94a3b8'}22`, color: SOURCE_COLORS[src] ?? '#94a3b8' }}>
                              {SOURCE_LABELS[src] ?? src}
                            </span>
                          )}
                        </div>
                        <div className="flex items-center gap-2 mt-0.5">
                          <span className="text-[10px]" style={{ color: '#94a3b8' }}>{new Date(e.created_at).toLocaleString()}</span>
                          {hasProps && (
                            <span className="text-[10px] italic truncate max-w-xs" style={{ color: '#94a3b8' }}>
                              {Object.entries(e.properties).filter(([k]) => k !== 'source').map(([k, v]) => `${k}: ${v}`).join(' · ')}
                            </span>
                          )}
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
              {events.length > 25 && (
                <button onClick={() => setShowAllEvents(v => !v)}
                  className="w-full py-2 text-xs font-bold rounded-lg mt-2"
                  style={{ background: '#f1f5f9', color: '#374151', border: '1.5px solid #e5e7eb' }}>
                  {showAllEvents ? 'Show less' : `Show all ${events.length} events`}
                </button>
              )}
            </>
          )}
        </Collapsible>

        {/* ── Danger Zone ── */}
        <div className="rounded-2xl overflow-hidden" style={{ border: '2px solid #fca5a5' }}>
          <div className="px-5 py-4" style={{ background: '#fff5f5' }}>
            <p className="text-xs font-black uppercase tracking-widest mb-1" style={{ color: '#dc2626' }}>Danger Zone</p>
            <p className="text-xs mb-3" style={{ color: '#6b7280' }}>Permanently clear all bookings and session records for this center. Cannot be undone.</p>
            {clearResult && (
              <div className="mb-3 text-xs font-semibold" style={{ color: clearResult.startsWith('Error') ? '#dc2626' : '#16a34a' }}>{clearResult}</div>
            )}
            {!clearConfirm ? (
              <button onClick={() => setClearConfirm(true)}
                className="px-4 py-2 rounded-lg text-xs font-black"
                style={{ background: '#fca5a5', color: '#7f1d1d', border: '1.5px solid #fca5a5' }}>
                Clear All Bookings
              </button>
            ) : (
              <div className="flex items-center gap-2">
                <button onClick={clearBookings} disabled={clearing}
                  className="px-4 py-2 rounded-lg text-xs font-black text-white"
                  style={{ background: '#dc2626', opacity: clearing ? 0.6 : 1 }}>
                  {clearing ? 'Clearing…' : 'Yes, delete everything'}
                </button>
                <button onClick={() => setClearConfirm(false)}
                  className="px-4 py-2 rounded-lg text-xs font-bold"
                  style={{ background: '#f1f5f9', color: '#374151', border: '1.5px solid #e5e7eb' }}>
                  Cancel
                </button>
              </div>
            )}
          </div>
        </div>

      </div>
    </div>
  );
}
