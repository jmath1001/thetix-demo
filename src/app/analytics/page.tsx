"use client"
import React, { useState, useEffect, useMemo } from 'react';
import {
  Loader2, BarChart2, Activity, RefreshCw, TrendingUp, TrendingDown,
  Users, CheckCircle2, Calendar, AlertTriangle, ChevronDown, ChevronUp,
  Minus, Zap,
} from 'lucide-react';
import { supabase } from '@/lib/supabaseClient';
import { DB, getCenterId } from '@/lib/db';
import { toISODate, getCentralTimeNow, getWeekStart } from '@/lib/useScheduleData';

type Event = { id: string; event_name: string; properties: Record<string, any>; created_at: string; };
type SessionStudent = { status: string; date: string; isVirtual: boolean; };
type TutorEmailLog = { id: string; tutor_name: string; emailed_to: string; mode: string; period_label: string; trigger: string; status: string; error: string | null; sent_at: string; };
type TrendDir = 'up' | 'down' | 'flat' | 'none';

function getWeekKey(dateStr: string): string {
  return toISODate(getWeekStart(new Date(dateStr)));
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
function safePct(n: number, d: number): number | null { return d > 0 ? Math.round((n / d) * 100) : null; }
function trendDir(curr: number | null, prev: number | null, higherIsBetter = true): TrendDir {
  if (curr === null || prev === null) return 'none';
  if (curr === prev) return 'flat';
  return (curr > prev) === higherIsBetter ? 'up' : 'down';
}
const rc = (v: number | null) => !v ? '#94a3b8' : v >= 80 ? '#16a34a' : v >= 60 ? '#f59e0b' : '#dc2626';

const SOURCE_LABELS: Record<string, string> = {
  inline_today: 'Quick Add (Today)',  inline_week: 'Quick Add (Week)',
  booking_form: 'Full Booking Form',  grid_slot: 'Grid Slot',
  student_page: 'Student Page',       attendance_modal: 'Attendance Modal',
  confirm_link: 'Confirmation Link',  schedule_nav: 'Schedule Nav',
  optimizer: 'Optimizer',
};
const SOURCE_COLORS: Record<string, string> = {
  inline_today: '#6366f1', inline_week: '#8b5cf6', booking_form: '#dc2626',
  grid_slot: '#f59e0b', student_page: '#16a34a', attendance_modal: '#0ea5e9',
  confirm_link: '#2563eb', schedule_nav: '#475569', optimizer: '#7c3aed',
};
const DAY_LABELS = ['', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const DAY_COLORS = ['', '#2563eb', '#7c3aed', '#dc2626', '#d97706', '#16a34a', '#0ea5e9'];
const FRIENDLY: Record<string, string> = {
  attendance_marked: 'Attendance marked', confirmation_updated: 'Confirmation updated',
  session_booked: 'Session booked', reassign_used: 'Student reassigned',
  student_removed: 'Student removed', recurring_booking_used: 'Recurring booking',
  student_created: 'Student created', student_edited: 'Student edited',
  tutor_created: 'Tutor created', tutor_edited: 'Tutor edited',
  tutor_deleted: 'Tutor deleted', tutor_time_off_added: 'Tutor time off added',
  tutor_time_off_removed: 'Tutor time off removed', reminder_sent: 'Reminder sent',
  bulk_remove_sessions: 'Bulk bookings removed', week_cleared_non_recurring: 'Week cleared',
  schedule_builder_confirmed: 'Schedule builder confirmed', students_bulk_deleted: 'Students bulk deleted',
  tutors_bulk_deleted: 'Tutors bulk deleted', students_imported: 'Students imported',
  recurring_series_deleted: 'Series deleted', recurring_series_cancelled: 'Series cancelled',
  recurring_series_edited: 'Series edited', recurring_session_edited: 'Single session edited',
  recurring_session_cancelled: 'Single session cancelled', auto_book_used: 'Auto Book used',
  command_search_submitted: 'Command search submitted', term_created: 'Term created',
  term_updated: 'Term updated', term_deleted: 'Term deleted',
  center_settings_saved: 'Settings saved', enrollment_form_sent: 'Enrollment form sent',
  blast_sent: 'Email blast sent', tutor_schedules_sent: 'Tutor schedules sent',
  student_schedules_sent: 'Student schedules sent', ai_booking_initiated: 'AI booking initiated',
  hours_adjusted: 'Hours adjusted', session_record_corrected: 'Session record corrected',
  recurring_session_student_off: 'Student excused from session', first_visit: 'First visit',
};

// ── SVG Charts ────────────────────────────────────────────────────────────────
function SparkBars({ data, color = '#dc2626' }: { data: number[]; color?: string }) {
  if (!data || data.length === 0) return null;
  const max = Math.max(...data, 1);
  const W = 56, H = 22, barW = 5, gap = 2;
  return (
    <svg viewBox={`0 0 ${W} ${H}`} width={W} height={H} style={{ display: 'block', flexShrink: 0 }}>
      {data.map((v, i) => {
        const bh = Math.max(2, (v / max) * H);
        return <rect key={i} x={i * (barW + gap)} y={H - bh} width={barW} height={bh} rx="1.5"
          fill={color} opacity={i === data.length - 1 ? 1 : 0.35} />;
      })}
    </svg>
  );
}

function AreaChart({ data, color = '#dc2626', showLabels = true }: {
  data: { label: string; value: number }[];
  color?: string; showLabels?: boolean;
}) {
  const [hovered, setHovered] = useState<number | null>(null);
  if (!data || data.length < 2) {
    return <div className="flex items-center justify-center py-6 text-xs italic" style={{ color: '#cbd5e1' }}>Not enough data</div>;
  }
  const W = 400, H = showLabels ? 116 : 84;
  const padT = 8, padB = showLabels ? 40 : 6, padL = 30, padR = 6;
  const cW = W - padL - padR, cH = H - padT - padB;
  const max = Math.max(...data.map(d => d.value), 1);
  const step = cW / (data.length - 1);
  const toX = (i: number) => padL + i * step;
  const toY = (v: number) => padT + cH - (v / max) * cH;
  const pts = data.map((d, i) => ({ x: toX(i), y: toY(d.value), label: d.label, value: d.value }));
  const line = pts.map((p, i) => `${i === 0 ? 'M' : 'L'}${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(' ');
  const area = line + ` L${pts[pts.length - 1].x.toFixed(1)},${(padT + cH).toFixed(1)} L${padL},${(padT + cH).toFixed(1)} Z`;
  const gid = `ag-${color.replace('#', '')}`;
  const showIdx = data.length <= 7
    ? data.map((_, i) => i)
    : data.map((_, i) => i).filter(i => i === 0 || i === data.length - 1 || i % Math.ceil(data.length / 7) === 0);
  const yTicks = [0.25, 0.5, 0.75, 1].map(f => ({ y: padT + cH - f * cH, label: Math.round(f * max).toString() }));
  const hp = hovered !== null ? pts[hovered] : null;
  const tipW = 52, tipH = 26;
  const tipX = hp ? Math.min(Math.max(hp.x - tipW / 2, padL), W - padR - tipW) : 0;
  const tipY = hp ? Math.max(hp.y - tipH - 6, padT) : 0;
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="w-full" style={{ display: 'block' }}>
      <defs>
        <linearGradient id={gid} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={color} stopOpacity={0.22} />
          <stop offset="100%" stopColor={color} stopOpacity={0.01} />
        </linearGradient>
      </defs>
      {/* Y-axis gridlines + labels */}
      {yTicks.map((t, i) => (
        <g key={i}>
          <line x1={padL} y1={t.y.toFixed(1)} x2={W - padR} y2={t.y.toFixed(1)} stroke="#e5e7eb" strokeWidth="0.6" />
          <text x={padL - 4} y={t.y} textAnchor="end" dominantBaseline="middle" fontSize="7" fill="#9ca3af" fontWeight="600">{t.label}</text>
        </g>
      ))}
      <path d={area} fill={`url(#${gid})`} />
      <path d={line} fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
      {/* Invisible hit areas */}
      {pts.map((p, i) => (
        <rect key={`hit-${i}`} x={p.x - (step / 2)} y={padT} width={step} height={cH}
          fill="transparent" style={{ cursor: 'crosshair' }}
          onMouseEnter={() => setHovered(i)} onMouseLeave={() => setHovered(null)} />
      ))}
      {/* Visible dots */}
      {pts.map((p, i) => (
        <circle key={i} cx={p.x} cy={p.y} r={hovered === i ? 4.5 : i === pts.length - 1 ? 3.5 : 2.5} fill={color}
          style={{ pointerEvents: 'none', transition: 'r 0.1s' }} />
      ))}
      {showLabels && showIdx.map(i => {
        const lx = pts[i].x;
        const ly = padT + cH + 8;
        return (
          <text key={i} x={lx} y={ly} textAnchor="end"
            transform={`rotate(-38, ${lx.toFixed(1)}, ${ly.toFixed(1)})`}
            fontSize="9" fill={hovered === i ? color : '#6b7280'} fontWeight="700">
            {pts[i].label}
          </text>
        );
      })}
      {/* Hover tooltip */}
      {hp && (
        <g style={{ pointerEvents: 'none' }}>
          <line x1={hp.x.toFixed(1)} y1={padT} x2={hp.x.toFixed(1)} y2={(padT + cH).toFixed(1)}
            stroke={color} strokeWidth="1" strokeDasharray="3 2" opacity="0.5" />
          <rect x={tipX} y={tipY} width={tipW} height={tipH} rx="5" fill="#1e293b" />
          <text x={tipX + tipW / 2} y={tipY + 8} textAnchor="middle" dominantBaseline="middle" fontSize="7" fontWeight="700" fill="#94a3b8">{hp.label}</text>
          <text x={tipX + tipW / 2} y={tipY + 18} textAnchor="middle" dominantBaseline="middle" fontSize="9.5" fontWeight="900" fill={color}>{hp.value}</text>
        </g>
      )}
    </svg>
  );
}

function polarToCart(cx: number, cy: number, r: number, deg: number) {
  const rad = (deg - 90) * Math.PI / 180;
  return { x: cx + r * Math.cos(rad), y: cy + r * Math.sin(rad) };
}

function DonutChart({ data, size = 140, thickness = 22 }: {
  data: { label: string; value: number; color: string }[]; size?: number; thickness?: number;
}) {
  const total = data.reduce((s, d) => s + d.value, 0);
  if (total === 0) return null;
  const cx = size / 2, cy = size / 2, r = size / 2 - thickness / 2 - 3;
  let startDeg = 0;
  const arcs = data.map(d => {
    const deg = (d.value / total) * 360;
    const endDeg = startDeg + deg;
    const gap = data.length > 1 ? 2.5 : 0;
    if (deg >= 359.5) {
      startDeg = endDeg;
      return { ...d, path: `M ${(cx - r).toFixed(2)} ${cy} A ${r} ${r} 0 1 1 ${(cx - r + 0.01).toFixed(2)} ${cy}` };
    }
    const s = polarToCart(cx, cy, r, startDeg + gap / 2);
    const e = polarToCart(cx, cy, r, endDeg - gap / 2);
    const large = deg - gap > 180 ? 1 : 0;
    const path = `M ${s.x.toFixed(2)} ${s.y.toFixed(2)} A ${r} ${r} 0 ${large} 1 ${e.x.toFixed(2)} ${e.y.toFixed(2)}`;
    startDeg = endDeg;
    return { ...d, path };
  });
  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} style={{ display: 'block', flexShrink: 0 }}>
      {arcs.map((a, i) => <path key={i} d={a.path} fill="none" stroke={a.color} strokeWidth={thickness} strokeLinecap="butt" />)}
      <text x={cx} y={cy - 5} textAnchor="middle" dominantBaseline="middle" fontSize="21" fontWeight="900" fill="#1e293b">{total}</text>
      <text x={cx} y={cy + 13} textAnchor="middle" fontSize="6.5" fontWeight="700" fill="#94a3b8" letterSpacing="0.5">SESSIONS</text>
    </svg>
  );
}

// ── UI Components ─────────────────────────────────────────────────────────────
function KPICard({ label, value, sub, color, icon, trend, trendLabel, sparkData }: {
  label: string; value: string | number; sub?: string; color: string;
  icon: React.ReactNode; trend?: TrendDir; trendLabel?: string; sparkData?: number[];
}) {
  const trendIcon = trend === 'up' ? <TrendingUp size={10} /> : trend === 'down' ? <TrendingDown size={10} /> : <Minus size={10} />;
  const trendColor = trend === 'up' ? '#16a34a' : trend === 'down' ? '#dc2626' : '#94a3b8';
  return (
    <div className="rounded-2xl p-5 flex flex-col gap-3" style={{ background: 'white', border: '2px solid #e5e7eb' }}>
      <div className="flex items-start justify-between">
        <div className="w-9 h-9 rounded-xl flex items-center justify-center shrink-0" style={{ background: color }}>
          <span style={{ color: 'white' }}>{icon}</span>
        </div>
        {sparkData && sparkData.length > 0 && <SparkBars data={sparkData} color={color} />}
      </div>
      <div>
        <p className="text-[10px] font-black uppercase tracking-widest mb-1" style={{ color: '#9ca3af' }}>{label}</p>
        <p className="text-4xl font-black leading-none mb-1.5" style={{ color: '#111827' }}>{value}</p>
        <div className="flex items-center gap-2 flex-wrap">
          {sub && <p className="text-xs" style={{ color: '#9ca3af' }}>{sub}</p>}
          {trend && trend !== 'none' && trendLabel && (
            <span className="flex items-center gap-0.5 text-[10px] font-bold px-1.5 py-0.5 rounded-full"
              style={{ background: `${trendColor}18`, color: trendColor }}>
              {trendIcon}&nbsp;{trendLabel}
            </span>
          )}
        </div>
      </div>
    </div>
  );
}

function Card({ title, sub, children, noPad, action }: {
  title?: string; sub?: string; children: React.ReactNode; noPad?: boolean; action?: React.ReactNode;
}) {
  return (
    <div className="rounded-2xl overflow-hidden h-full" style={{ background: 'white', border: '2px solid #e5e7eb' }}>
      {title && (
        <div className="flex items-start justify-between px-5 pt-5 pb-3">
          <div>
            <p className="text-sm font-black" style={{ color: '#1e293b' }}>{title}</p>
            {sub && <p className="text-[11px] mt-0.5" style={{ color: '#94a3b8' }}>{sub}</p>}
          </div>
          {action}
        </div>
      )}
      <div className={noPad ? '' : 'px-5 pb-5'}>{children}</div>
    </div>
  );
}

function HBar({ label, value, max, color }: { label: string; value: number; max: number; color: string }) {
  const w = max > 0 ? Math.min(100, Math.round((value / max) * 100)) : 0;
  return (
    <div className="flex items-center gap-3">
      <span className="w-36 shrink-0 truncate text-xs font-semibold" style={{ color: '#374151' }}>{label}</span>
      <div className="flex-1 h-2.5 rounded-full overflow-hidden" style={{ background: '#f1f5f9' }}>
        <div className="h-full rounded-full transition-all duration-500" style={{ width: `${w}%`, background: color }} />
      </div>
      <span className="w-8 text-right shrink-0 text-xs font-black" style={{ color }}>{value}</span>
    </div>
  );
}

function Insight({ icon, text, color = '#2563eb' }: { icon: React.ReactNode; text: string; color?: string }) {
  return (
    <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-semibold whitespace-nowrap"
      style={{ background: `${color}10`, color, border: `1.5px solid ${color}22` }}>
      {icon}&nbsp;{text}
    </div>
  );
}

function Collapsible({ title, badge, badgeColor = '#475569', children, defaultOpen = false }: {
  title: string; badge?: number; badgeColor?: string; children: React.ReactNode; defaultOpen?: boolean;
}) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className="rounded-2xl overflow-hidden" style={{ background: 'white', border: '2px solid #e5e7eb' }}>
      <button onClick={() => setOpen(o => !o)} className="w-full flex items-center justify-between px-6 py-4 text-left"
        style={{ background: '#1e293b' }}>
        <div className="flex items-center gap-3">
          <span className="text-sm font-black text-white">{title}</span>
          {badge !== undefined && badge > 0 && (
            <span className="text-[10px] font-black px-2.5 py-0.5 rounded-full" style={{ background: badgeColor, color: 'white' }}>{badge}</span>
          )}
        </div>
        {open ? <ChevronUp size={15} color="#64748b" /> : <ChevronDown size={15} color="#64748b" />}
      </button>
      {open && <div className="p-6">{children}</div>}
    </div>
  );
}

function WeekRangeToggle({ value, onChange }: { value: 4 | 8 | 12; onChange: (v: 4 | 8 | 12) => void }) {
  return (
    <div className="flex gap-1">
      {([4, 8, 12] as const).map(w => (
        <button key={w} onClick={() => onChange(w)}
          className="px-2.5 py-1 rounded-lg text-[10px] font-bold transition-all"
          style={value === w ? { background: '#1e293b', color: 'white' } : { background: '#e5e7eb', color: '#6b7280' }}>
          {w}w
        </button>
      ))}
    </div>
  );
}

// ── Main Component ────────────────────────────────────────────────────────────
export default function AnalyticsPage() {
  const [events, setEvents] = useState<Event[]>([]);
  const [sessionStudents, setSessionStudents] = useState<SessionStudent[]>([]);
  const [studentCount, setStudentCount] = useState<number>(0);
  const [tutorCount, setTutorCount] = useState<number>(0);
  const [tutorEmailLogs, setTutorEmailLogs] = useState<TutorEmailLog[]>([]);
  const [loading, setLoading] = useState(true);
  const [lastRefresh, setLastRefresh] = useState(new Date());
  const [weekRange, setWeekRange] = useState<4 | 8 | 12>(8);
  const [showAllEvents, setShowAllEvents] = useState(false);
  const [clearConfirm, setClearConfirm] = useState(false);
  const [clearing, setClearing] = useState(false);
  const [clearResult, setClearResult] = useState<string | null>(null);

  const fetchData = async () => {
    setLoading(true);
    const centerId = getCenterId();
    const [evRes, sesRes, stuRes, tutRes, tutLogRes] = await Promise.all([
      supabase.from(DB.events).select('*').eq('center_id', centerId).order('created_at', { ascending: false }),
      supabase.from(DB.sessions)
        .select(`id, session_date, ${DB.sessionStudents}(id, status, is_virtual)`)
        .eq('center_id', centerId).order('session_date'),
      supabase.from(DB.students).select('id', { count: 'exact', head: true }).eq('center_id', centerId),
      supabase.from(DB.tutors).select('id', { count: 'exact', head: true }).eq('center_id', centerId),
      supabase.from(DB.tutorScheduleLogs).select('id, tutor_name, emailed_to, mode, period_label, trigger, status, error, sent_at')
        .eq('center_id', centerId).order('sent_at', { ascending: false }).limit(200),
    ]);
    setEvents(evRes.data ?? []);
    setSessionStudents(
      (sesRes.data ?? []).flatMap((s: any) =>
        (s[DB.sessionStudents] ?? []).map((ss: any) => ({ status: ss.status, date: s.session_date, isVirtual: ss.is_virtual ?? false }))
      )
    );
    setStudentCount(stuRes.count ?? 0);
    setTutorCount(tutRes.count ?? 0);
    setTutorEmailLogs(tutLogRes.data ?? []);
    setLastRefresh(new Date());
    setLoading(false);
  };

  useEffect(() => { fetchData(); }, []);

  const today = toISODate(getCentralTimeNow());
  const currentWeek = toISODate(getWeekStart(getCentralTimeNow()));

  const { thisWeekStart, lastWeekStart, thirtyDaysAgo, prev30Start } = useMemo(() => {
    const now = getCentralTimeNow();
    const thisWk = getWeekStart(now);
    const lastWk = new Date(thisWk); lastWk.setDate(lastWk.getDate() - 7);
    const t30 = new Date(now); t30.setDate(t30.getDate() - 30);
    const p30 = new Date(t30); p30.setDate(p30.getDate() - 30);
    return {
      thisWeekStart: toISODate(thisWk), lastWeekStart: toISODate(lastWk),
      thirtyDaysAgo: toISODate(t30), prev30Start: toISODate(p30),
    };
  }, []);

  const pastSessions = useMemo(() => sessionStudents.filter(s => s.date < today), [sessionStudents, today]);

  const { thisWeekCount, lastWeekCount } = useMemo(() => {
    const nextWeek = toISODate(new Date(new Date(thisWeekStart + 'T00:00:00').getTime() + 7 * 86400000));
    return {
      thisWeekCount: sessionStudents.filter(s => s.date >= thisWeekStart && s.date < nextWeek).length,
      lastWeekCount: sessionStudents.filter(s => s.date >= lastWeekStart && s.date < thisWeekStart).length,
    };
  }, [sessionStudents, thisWeekStart, lastWeekStart]);

  const { attRate30, noShowRate30, prevAttRate30, prevNoShowRate30 } = useMemo(() => {
    const last30 = pastSessions.filter(s => s.date >= thirtyDaysAgo);
    const prev30 = pastSessions.filter(s => s.date >= prev30Start && s.date < thirtyDaysAgo);
    return {
      attRate30: safePct(last30.filter(s => s.status === 'present').length, last30.length),
      noShowRate30: safePct(last30.filter(s => s.status === 'no-show').length, last30.length),
      prevAttRate30: safePct(prev30.filter(s => s.status === 'present').length, prev30.length),
      prevNoShowRate30: safePct(prev30.filter(s => s.status === 'no-show').length, prev30.length),
    };
  }, [pastSessions, thirtyDaysAgo, prev30Start]);

  const virtualStats = useMemo(() => {
    const virtual = sessionStudents.filter(s => s.isVirtual).length;
    const total = sessionStudents.length;
    return { virtual, inPerson: total - virtual, total, pct: safePct(virtual, total) ?? 0 };
  }, [sessionStudents]);

  const dailyActivity = useMemo(() => {
    const days: Record<string, number> = {};
    for (let i = 13; i >= 0; i--) {
      const d = new Date(); d.setDate(d.getDate() - i);
      days[toISODate(d)] = 0;
    }
    events.forEach(e => { const day = e.created_at.slice(0, 10); if (day in days) days[day]++; });
    return Object.entries(days).map(([date, value]) => ({
      value,
      label: new Date(date + 'T00:00:00').toLocaleDateString('en-US', { month: 'numeric', day: 'numeric' }),
    }));
  }, [events]);

  const weeklyAttendance = useMemo(() => {
    const weeks: Record<string, { present: number; total: number; noShow: number; bookings: number }> = {};
    pastSessions.forEach(s => {
      const wk = getWeekKey(s.date);
      if (!weeks[wk]) weeks[wk] = { present: 0, total: 0, noShow: 0, bookings: 0 };
      weeks[wk].total++;
      if (s.status === 'present') weeks[wk].present++;
      if (s.status === 'no-show') weeks[wk].noShow++;
    });
    events.filter(e => e.event_name === 'session_booked').forEach(e => {
      const wk = getWeekKey(e.created_at);
      if (!weeks[wk]) weeks[wk] = { present: 0, total: 0, noShow: 0, bookings: 0 };
      weeks[wk].bookings++;
    });
    return Object.entries(weeks)
      .sort((a, b) => a[0].localeCompare(b[0])).slice(-weekRange)
      .map(([wk, d]) => ({
        week: wk, label: weekLabel(wk), isCurrent: wk === currentWeek,
        value: safePct(d.present, d.total) ?? 0,
        attendanceRate: safePct(d.present, d.total),
        noShowRate: safePct(d.noShow, d.total),
        present: d.present, total: d.total, bookings: d.bookings,
      }));
  }, [pastSessions, events, weekRange, currentWeek]);

  const statusBreakdown = useMemo(() => {
    const counts: Record<string, number> = { present: 0, 'no-show': 0, scheduled: 0, cancelled: 0 };
    sessionStudents.forEach(s => { counts[s.status] = (counts[s.status] ?? 0) + 1; });
    return [
      { label: 'Present', value: counts.present, color: '#16a34a' },
      { label: 'No-Show', value: counts['no-show'], color: '#dc2626' },
      { label: 'Scheduled', value: counts.scheduled, color: '#2563eb' },
      { label: 'Cancelled', value: counts.cancelled, color: '#94a3b8' },
    ].filter(s => s.value > 0);
  }, [sessionStudents]);

  const dayOfWeekData = useMemo(() => {
    const counts: Record<number, number> = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0, 6: 0 };
    sessionStudents.forEach(s => {
      const d = new Date(s.date + 'T00:00:00').getDay();
      const mapped = d === 0 ? 7 : d;
      if (mapped in counts) counts[mapped]++;
    });
    return Object.entries(counts)
      .map(([day, value]) => ({ day: Number(day), label: DAY_LABELS[Number(day)], value, color: DAY_COLORS[Number(day)] }))
      .filter(d => d.value > 0).sort((a, b) => b.value - a.value);
  }, [sessionStudents]);
  const maxDayCount = dayOfWeekData[0]?.value ?? 1;

  const bookingSources = useMemo(() => {
    const counts: Record<string, number> = {};
    events.filter(e => e.event_name === 'session_booked').forEach(e => {
      const src = e.properties?.source ?? 'unknown';
      counts[src] = (counts[src] ?? 0) + 1;
    });
    return Object.entries(counts).sort((a, b) => b[1] - a[1]);
  }, [events]);
  const maxBookingSource = bookingSources[0]?.[1] ?? 1;
  const totalBookings = bookingSources.reduce((s, [, c]) => s + c, 0);

  const weeklySessionSpark = useMemo(() => {
    const weeks: Record<string, number> = {};
    sessionStudents.forEach(s => { const wk = getWeekKey(s.date); weeks[wk] = (weeks[wk] ?? 0) + 1; });
    return Object.entries(weeks).sort((a, b) => a[0].localeCompare(b[0])).slice(-8).map(([, c]) => c);
  }, [sessionStudents]);

  const attRateSpark = weeklyAttendance.map(w => w.value);

  const { totalActions, last30Actions } = useMemo(() => ({
    totalActions: events.length,
    last30Actions: events.filter(e => e.created_at.slice(0, 10) >= thirtyDaysAgo).length,
  }), [events, thirtyDaysAgo]);

  const actionsSpark = useMemo(() => {
    const days: Record<string, number> = {};
    for (let i = 7; i >= 0; i--) { const d = new Date(); d.setDate(d.getDate() - i); days[toISODate(d)] = 0; }
    events.forEach(e => { const day = e.created_at.slice(0, 10); if (day in days) days[day]++; });
    return Object.values(days);
  }, [events]);

  const commsBreakdown = useMemo(() => {
    const cats = [
      { key: 'reminder_sent', label: 'Reminders', color: '#dc2626' },
      { key: 'blast_sent', label: 'Email Blasts', color: '#7c3aed' },
      { key: 'tutor_schedules_sent', label: 'Tutor Schedules', color: '#2563eb' },
      { key: 'student_schedules_sent', label: 'Student Schedules', color: '#059669' },
      { key: 'enrollment_form_sent', label: 'Enrollment Forms', color: '#d97706' },
    ];
    return cats.map(c => ({ ...c, count: events.filter(e => e.event_name === c.key).length })).filter(c => c.count > 0);
  }, [events]);
  const maxComms = Math.max(...commsBreakdown.map(c => c.count), 1);
  const totalEmails = commsBreakdown.reduce((s, c) => s + c.count, 0);

  const weekDiff = thisWeekCount - lastWeekCount;
  const weekTrendLabel = lastWeekCount > 0 || thisWeekCount > 0
    ? `${weekDiff >= 0 ? '+' : ''}${weekDiff} vs last wk` : undefined;
  const attDiff = attRate30 !== null && prevAttRate30 !== null ? attRate30 - prevAttRate30 : null;
  const nsDiff = noShowRate30 !== null && prevNoShowRate30 !== null ? noShowRate30 - prevNoShowRate30 : null;
  const busiestDay = dayOfWeekData[0];
  const topSource = bookingSources[0];

  const clearBookings = async () => {
    setClearing(true); setClearResult(null);
    try {
      const centerId = getCenterId();
      const { data: sessions } = await supabase.from(DB.sessions).select('id').eq('center_id', centerId);
      const ids = (sessions ?? []).map((s: any) => s.id);
      if (ids.length > 0) {
        const { error: e1 } = await supabase.from(DB.sessionStudents).delete().in('session_id', ids);
        if (e1) throw e1;
      }
      const { error: e2 } = await supabase.from(DB.sessions).delete().eq('center_id', centerId);
      if (e2) throw e2;
      setClearResult('All bookings cleared.'); setClearConfirm(false); await fetchData();
    } catch (err: any) { setClearResult('Error: ' + (err.message ?? 'Unknown error')); }
    setClearing(false);
  };

  if (loading) return (
    <div className="min-h-screen flex items-center justify-center" style={{ background: '#f1f5f9' }}>
      <div className="flex flex-col items-center gap-3">
        <Loader2 size={22} className="animate-spin" style={{ color: '#dc2626' }} />
        <p className="text-xs font-semibold uppercase tracking-widest" style={{ color: '#9ca3af' }}>Loading analytics...</p>
      </div>
    </div>
  );

  return (
    <div className="min-h-screen pb-20" style={{ background: '#f1f5f9' }}>

      {/* Header */}
      <div className="sticky top-0 z-40" style={{ background: 'white', borderBottom: '2px solid #e5e7eb' }}>
        <div className="max-w-6xl mx-auto px-6 h-14 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-lg flex items-center justify-center" style={{ background: '#dc2626' }}>
              <BarChart2 size={15} color="white" />
            </div>
            <div>
              <h1 className="text-sm font-black leading-none" style={{ color: '#0f172a' }}>Analytics</h1>
              <p className="text-[9px] font-bold uppercase tracking-widest" style={{ color: '#dc2626' }}>Operations Dashboard</p>
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

      <div className="max-w-6xl mx-auto px-6 pt-6 space-y-5">

        {/* KPI Cards */}
        <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-5 gap-3">
          <KPICard label="Total Actions" value={totalActions}
            sub={`${last30Actions} in last 30 days`} color="#0ea5e9" icon={<Activity size={15} />}
            sparkData={actionsSpark} />
          <KPICard label="Sessions This Week" value={thisWeekCount} sub="slot-students booked"
            color="#dc2626" icon={<Calendar size={15} />}
            trend={trendDir(thisWeekCount, lastWeekCount, true)} trendLabel={weekTrendLabel}
            sparkData={weeklySessionSpark} />
          <KPICard label="30-Day Attendance" value={attRate30 !== null ? `${attRate30}%` : '—'}
            sub="of sessions held" color="#16a34a" icon={<CheckCircle2 size={15} />}
            trend={trendDir(attRate30, prevAttRate30, true)}
            trendLabel={attDiff !== null ? `${attDiff >= 0 ? '+' : ''}${attDiff}% vs prev` : undefined}
            sparkData={attRateSpark} />
          <KPICard label="30-Day No-Show Rate" value={noShowRate30 !== null ? `${noShowRate30}%` : '—'}
            sub="of sessions held" color="#d97706" icon={<AlertTriangle size={15} />}
            trend={trendDir(noShowRate30, prevNoShowRate30, false)}
            trendLabel={nsDiff !== null ? `${nsDiff >= 0 ? '+' : ''}${nsDiff}% vs prev` : undefined} />
          <KPICard label="Active Students" value={studentCount} sub={`${tutorCount} tutor${tutorCount !== 1 ? 's' : ''}`}
            color="#7c3aed" icon={<Users size={15} />} />
        </div>

        {/* Insight Pills */}
        {(busiestDay || topSource || attRate30 !== null || virtualStats.total > 0) && (
          <div className="flex flex-wrap gap-2">
            {busiestDay && <Insight icon={<Calendar size={11} />}
              text={`Busiest day: ${busiestDay.label} (${busiestDay.value} sessions)`} color="#2563eb" />}
            {topSource && <Insight icon={<Zap size={11} />}
              text={`Top booking method: ${SOURCE_LABELS[topSource[0]] ?? topSource[0]}`} color="#7c3aed" />}
            {attRate30 !== null && <Insight icon={<TrendingUp size={11} />}
              text={`${attRate30 >= 80 ? 'Strong' : attRate30 >= 60 ? 'Moderate' : 'Low'} attendance — ${attRate30}% this month`}
              color={rc(attRate30)} />}
            {virtualStats.total > 0 && virtualStats.virtual > 0 && (
              <Insight icon={<Activity size={11} />}
                text={`${virtualStats.pct}% virtual (${virtualStats.virtual} of ${virtualStats.total})`} color="#0ea5e9" />
            )}
          </div>
        )}

        {/* Daily Activity Chart */}
        <Card title="Daily Activity" sub="Total actions logged per day — last 14 days">
          <AreaChart data={dailyActivity} color="#dc2626" showLabels />
        </Card>

        {/* Weekly Attendance Trend + Session Status Donut */}
        <div className="grid md:grid-cols-5 gap-4">
          <div className="md:col-span-3">
            <Card title="Weekly Attendance Rate" sub="% of sessions where the student was present"
              action={<WeekRangeToggle value={weekRange} onChange={setWeekRange} />}>
              {weeklyAttendance.length < 2
                ? <p className="text-sm italic py-4" style={{ color: '#94a3b8' }}>Not enough data yet</p>
                : <AreaChart data={weeklyAttendance.map(w => ({ label: w.label, value: w.value }))} color="#16a34a" showLabels />}
            </Card>
          </div>
          <div className="md:col-span-2">
            <Card title="Session Status" sub="All-time breakdown">
              {statusBreakdown.length === 0
                ? <p className="text-sm italic py-4" style={{ color: '#94a3b8' }}>No session data</p>
                : (
                  <div className="flex items-center gap-5">
                    <DonutChart data={statusBreakdown} size={130} thickness={20} />
                    <div className="space-y-2.5 flex-1 min-w-0">
                      {statusBreakdown.map(s => {
                        const pct = safePct(s.value, statusBreakdown.reduce((a, b) => a + b.value, 0));
                        return (
                          <div key={s.label}>
                            <div className="flex items-center justify-between mb-1">
                              <div className="flex items-center gap-1.5">
                                <div className="w-2.5 h-2.5 rounded-full" style={{ background: s.color }} />
                                <span className="text-xs font-semibold" style={{ color: '#374151' }}>{s.label}</span>
                              </div>
                              <span className="text-xs font-black" style={{ color: s.color }}>{s.value}</span>
                            </div>
                            <div className="h-1.5 rounded-full overflow-hidden" style={{ background: '#f1f5f9' }}>
                              <div className="h-full rounded-full" style={{ width: `${pct ?? 0}%`, background: s.color }} />
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                )}
            </Card>
          </div>
        </div>

        {/* Day of Week + Booking Methods */}
        <div className="grid md:grid-cols-2 gap-4">
          <Card title="Sessions by Day of Week" sub="Total session-students per weekday (all time)">
            {dayOfWeekData.length === 0
              ? <p className="text-sm italic" style={{ color: '#94a3b8' }}>No data</p>
              : <div className="space-y-3">{dayOfWeekData.map(d => <HBar key={d.day} label={d.label} value={d.value} max={maxDayCount} color={d.color} />)}</div>}
          </Card>
          <Card title="Booking Methods" sub={`${totalBookings} total session bookings`}>
            {bookingSources.length === 0
              ? <p className="text-sm italic" style={{ color: '#94a3b8' }}>No booking data</p>
              : <div className="space-y-3">{bookingSources.map(([src, count]) => <HBar key={src} label={SOURCE_LABELS[src] ?? src} value={count} max={maxBookingSource} color={SOURCE_COLORS[src] ?? '#94a3b8'} />)}</div>}
          </Card>
        </div>

        {/* Virtual vs In-Person */}
        {virtualStats.total > 0 && virtualStats.virtual > 0 && (
          <Card title="Virtual vs. In-Person">
            <div className="space-y-3">
              <div className="flex items-center gap-3">
                <span className="text-xs font-semibold w-20 text-right shrink-0" style={{ color: '#374151' }}>In-Person</span>
                <div className="flex-1 h-5 rounded-full overflow-hidden flex" style={{ background: '#f1f5f9' }}>
                  <div className="h-full rounded-l-full transition-all duration-500"
                    style={{ width: `${100 - virtualStats.pct}%`, background: '#2563eb' }} />
                  <div className="h-full rounded-r-full transition-all duration-500"
                    style={{ width: `${virtualStats.pct}%`, background: '#0ea5e9' }} />
                </div>
                <span className="text-xs font-semibold w-16 shrink-0" style={{ color: '#374151' }}>Virtual</span>
              </div>
              <div className="flex items-center justify-between px-20 text-xs font-black">
                <span style={{ color: '#2563eb' }}>{virtualStats.inPerson} ({100 - virtualStats.pct}%)</span>
                <span style={{ color: '#0ea5e9' }}>{virtualStats.virtual} ({virtualStats.pct}%)</span>
              </div>
            </div>
          </Card>
        )}

        {/* Week-by-Week History Table */}
        <Card title="Week-by-Week History" noPad
          action={<div className="px-5 pt-5"><WeekRangeToggle value={weekRange} onChange={setWeekRange} /></div>}>
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr style={{ background: '#f8fafc', borderTop: '1.5px solid #e5e7eb', borderBottom: '1.5px solid #e5e7eb' }}>
                  {['Week', 'Bookings', 'Sessions', 'Attendance', 'No-Show'].map(h => (
                    <th key={h} className="px-5 py-2.5 text-left text-[9px] font-black uppercase tracking-widest" style={{ color: '#94a3b8' }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {weeklyAttendance.length === 0
                  ? <tr><td colSpan={5} className="px-5 py-8 text-center text-xs italic" style={{ color: '#9ca3af' }}>No data yet</td></tr>
                  : weeklyAttendance.map((wk, i) => (
                    <tr key={wk.week} style={{ borderBottom: '1px solid #f1f5f9', background: wk.isCurrent ? '#fff8f8' : i % 2 === 0 ? 'white' : '#fafafa' }}>
                      <td className="px-5 py-3">
                        <div className="flex items-center gap-2">
                          <span className="text-xs font-bold" style={{ color: '#1e293b' }}>{wk.label}</span>
                          {wk.isCurrent && <span className="text-[8px] font-black px-1.5 py-0.5 rounded-full text-white" style={{ background: '#dc2626' }}>NOW</span>}
                        </div>
                      </td>
                      <td className="px-5 py-3"><span className="text-sm font-black" style={{ color: wk.bookings > 0 ? '#16a34a' : '#d1d5db' }}>{wk.bookings || '—'}</span></td>
                      <td className="px-5 py-3"><span className="text-sm font-semibold" style={{ color: wk.total > 0 ? '#374151' : '#d1d5db' }}>{wk.total || '—'}</span></td>
                      <td className="px-5 py-3">
                        {wk.attendanceRate !== null
                          ? <span className="text-sm font-black" style={{ color: rc(wk.attendanceRate) }}>{wk.attendanceRate}%</span>
                          : <span style={{ color: '#d1d5db' }}>—</span>}
                      </td>
                      <td className="px-5 py-3">
                        {wk.noShowRate !== null
                          ? <span className="text-sm font-black" style={{ color: (wk.noShowRate ?? 0) > 20 ? '#dc2626' : '#64748b' }}>{wk.noShowRate}%</span>
                          : <span style={{ color: '#d1d5db' }}>—</span>}
                      </td>
                    </tr>
                  ))}
              </tbody>
            </table>
          </div>
        </Card>

        {/* Communications Sent */}
        {totalEmails > 0 && (
          <Collapsible title="Communications Sent" badge={totalEmails} badgeColor="#7c3aed" defaultOpen={false}>
            <div className="space-y-3">
              {commsBreakdown.map(c => <HBar key={c.key} label={c.label} value={c.count} max={maxComms} color={c.color} />)}
            </div>
          </Collapsible>
        )}

        {/* Tutor Email Logs */}
        <Collapsible title="Tutor Schedule Emails" badge={tutorEmailLogs.length} badgeColor="#2563eb" defaultOpen={tutorEmailLogs.length > 0}>
          {tutorEmailLogs.length === 0
            ? <p className="text-sm italic text-center py-4" style={{ color: '#9ca3af' }}>No emails sent yet.</p>
            : (
              <div className="rounded-xl overflow-hidden" style={{ border: '1.5px solid #e5e7eb' }}>
                <table className="w-full">
                  <thead>
                    <tr style={{ background: '#f8fafc', borderBottom: '1.5px solid #e5e7eb' }}>
                      {['Tutor', 'Sent To', 'Type', 'Period', 'Trigger', 'Status', 'When'].map(h => (
                        <th key={h} className="px-4 py-2.5 text-left text-[9px] font-black uppercase tracking-widest" style={{ color: '#94a3b8' }}>{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {tutorEmailLogs.map((log, i) => (
                      <tr key={log.id} style={{ borderBottom: '1px solid #f1f5f9', background: i % 2 === 0 ? 'white' : '#fafafa' }}>
                        <td className="px-4 py-3 text-xs font-bold" style={{ color: '#1e293b' }}>{log.tutor_name || '—'}</td>
                        <td className="px-4 py-3 text-xs" style={{ color: '#6b7280' }}>{log.emailed_to}</td>
                        <td className="px-4 py-3">
                          <span className="text-[9px] font-black px-1.5 py-0.5 rounded-full uppercase"
                            style={{ background: log.mode === 'weekly' ? '#eef2ff' : '#f0fdf4', color: log.mode === 'weekly' ? '#4f46e5' : '#16a34a' }}>
                            {log.mode}
                          </span>
                        </td>
                        <td className="px-4 py-3 text-xs" style={{ color: '#374151' }}>{log.period_label}</td>
                        <td className="px-4 py-3">
                          <span className="text-[9px] font-black px-1.5 py-0.5 rounded-full uppercase"
                            style={{ background: log.trigger === 'manual' ? '#fff7ed' : '#f1f5f9', color: log.trigger === 'manual' ? '#d97706' : '#475569' }}>
                            {log.trigger}
                          </span>
                        </td>
                        <td className="px-4 py-3">
                          {log.status === 'sent'
                            ? <span className="text-[10px] font-black" style={{ color: '#16a34a' }}>✓ Sent</span>
                            : (
                              <span className="text-[10px] font-black" style={{ color: '#dc2626' }}
                                title={log.error ?? undefined}>✗ Failed</span>
                            )}
                        </td>
                        <td className="px-4 py-3 text-[10px]" style={{ color: '#9ca3af' }}>{timeAgo(log.sent_at)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
        </Collapsible>

        {/* Event Log */}
        <Collapsible title="Event Log" badge={events.length} badgeColor="#475569" defaultOpen={false}>
          {events.length === 0
            ? <p className="text-sm italic text-center py-4" style={{ color: '#9ca3af' }}>No events yet.</p>
            : (
              <>
                <div className="rounded-xl overflow-hidden" style={{ border: '1.5px solid #e5e7eb' }}>
                  {(showAllEvents ? events : events.slice(0, 25)).map((e, i) => {
                    const label = FRIENDLY[e.event_name] ?? e.event_name;
                    const src = e.properties?.source;
                    const subject = e.properties?.studentName ?? e.properties?.tutorName ?? null;
                    return (
                      <div key={e.id} className="flex items-start gap-3 px-4 py-3"
                        style={{ borderBottom: '1px solid #f1f5f9', background: i % 2 === 0 ? 'white' : '#fafafa' }}>
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 flex-wrap">
                            <span className="text-xs font-bold" style={{ color: '#1e293b' }}>{label}</span>
                            {subject && (
                              <span className="text-[10px] font-bold" style={{ color: '#2563eb' }}>{subject}</span>
                            )}
                            {src && (
                              <span className="text-[9px] font-bold px-1.5 py-0.5 rounded-full"
                                style={{ background: `${SOURCE_COLORS[src] ?? '#94a3b8'}22`, color: SOURCE_COLORS[src] ?? '#94a3b8' }}>
                                {SOURCE_LABELS[src] ?? src}
                              </span>
                            )}
                          </div>
                          <span className="text-[10px]" style={{ color: '#94a3b8' }}>{new Date(e.created_at).toLocaleString()}</span>
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

        {/* Danger Zone */}
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
                  {clearing ? 'Clearing...' : 'Yes, delete everything'}
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
