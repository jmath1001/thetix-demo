'use client';
import { useState } from 'react';
import { usePathname } from 'next/navigation';
import {
  Calendar, Users, GraduationCap,
  Repeat, Mail, Settings, ChevronLeft, ChevronRight,
} from 'lucide-react';

const ENV_CENTER_NAME  = process.env.NEXT_PUBLIC_CENTER_NAME       ?? 'Scheduler';
const ENV_CENTER_SHORT = process.env.NEXT_PUBLIC_CENTER_SHORT_NAME ?? 'S';

const navItems = [
  { name: 'Schedule',  icon: Calendar,      href: '/' },
  { name: 'Recurring', icon: Repeat,        href: '/recurring' },
  { name: 'Tutors',    icon: Users,         href: '/tutor' },
  { name: 'Students',  icon: GraduationCap, href: '/students' },
  { name: 'Center',    icon: Settings,      href: '/center-settings' },
  { name: 'Contact',   icon: Mail,          href: '/contact' },
];

/* ─── shared accent colours ──────────────────────────── */
const ACCENT      = '#4f46e5';
const ACCENT_DARK = '#3730a3';
const ACCENT_BG   = '#eef2ff';
const LOGO_RED    = '#dc2626';
const LOGO_RED_DARK = '#b91c1c';

function setNavCookie(value: boolean) {
  document.cookie = `navbarCollapsed=${value};path=/;max-age=31536000`;
}

export function Navbar({
  initialCollapsed = false,
  centerName: nameProp,
  centerShort: shortProp,
}: {
  initialCollapsed?: boolean;
  centerName?: string;
  centerShort?: string;
}) {
  const CENTER_NAME  = nameProp  ?? ENV_CENTER_NAME;
  const CENTER_SHORT = shortProp ?? ENV_CENTER_SHORT;
  const [collapsed, setCollapsed] = useState(initialCollapsed);
  const pathname = usePathname();
  const current = pathname || '/';

  return (
    <>
      {/* ── Desktop sidebar ─────────────────────────────────────────────── */}
      <aside
        className="hidden md:flex md:sticky md:top-0 md:h-screen md:shrink-0 flex-col z-40"
        style={{
          width: collapsed ? 64 : 224,
          transition: 'width 0.2s ease',
          background: '#ffffff',
          borderRight: '1px solid #e5e7eb',
        }}
      >
        {/* ── Header ─────────────────────────────────────── */}
        <div
          className="flex items-center shrink-0 px-3"
          style={{
            height: 56,
            borderBottom: '1px solid #f3f4f6',
            justifyContent: collapsed ? 'center' : 'flex-start',
            gap: collapsed ? 0 : 10,
          }}
        >
          {/* Brand logo — always visible, always links home */}
          <a
            href="/"
            title={CENTER_NAME}
            className="flex items-center justify-center rounded-lg shrink-0"
            style={{
              width: 32,
              height: 32,
              background: LOGO_RED,
              textDecoration: 'none',
              flexShrink: 0,
            }}
          >
            <span className="text-white font-bold text-[10px] leading-none select-none">
              {CENTER_SHORT.slice(0, 2).toUpperCase()}
            </span>
          </a>

          {!collapsed && (
            <>
              <span
                className="font-semibold text-[13.5px] truncate flex-1"
                style={{ color: '#111827', letterSpacing: '-0.01em' }}
              >
                {CENTER_NAME}
              </span>
              <button
                onClick={() => { setCollapsed(true); setNavCookie(true); }}
                title="Full View"
                className="flex items-center justify-center rounded-lg shrink-0"
                style={{ width: 28, height: 28, color: '#9ca3af', background: 'transparent', border: 'none', cursor: 'pointer', transition: 'color 0.15s, background 0.15s' }}
                onMouseEnter={e => { (e.currentTarget as HTMLElement).style.color = ACCENT; (e.currentTarget as HTMLElement).style.background = ACCENT_BG; }}
                onMouseLeave={e => { (e.currentTarget as HTMLElement).style.color = '#9ca3af'; (e.currentTarget as HTMLElement).style.background = 'transparent'; }}
              >
                <ChevronLeft size={15} />
              </button>
            </>
          )}
        </div>

        {/* ── Expand button (collapsed only) ─────────────── */}
        {collapsed && (
          <div className="flex justify-center px-2 pt-2.5">
            <button
              onClick={() => { setCollapsed(false); setNavCookie(false); }}
              title="Expand sidebar"
              className="flex items-center justify-center rounded-lg"
              style={{ width: 40, height: 30, color: '#9ca3af', background: 'transparent', border: 'none', cursor: 'pointer', transition: 'color 0.15s, background 0.15s' }}
              onMouseEnter={e => { (e.currentTarget as HTMLElement).style.color = ACCENT; (e.currentTarget as HTMLElement).style.background = ACCENT_BG; }}
              onMouseLeave={e => { (e.currentTarget as HTMLElement).style.color = '#9ca3af'; (e.currentTarget as HTMLElement).style.background = 'transparent'; }}
            >
              <ChevronRight size={15} />
            </button>
          </div>
        )}

        {/* ── Nav items ──────────────────────────────────── */}
        <nav className="flex flex-col gap-0.5 px-2 py-3 flex-1">
          {navItems.map(({ name, icon: Icon, href }) => {
            const active = href === '/'
              ? current === '/'
              : current === href || current.startsWith(`${href}/`)
            return (
              <a
                key={name}
                href={href}
                title={collapsed ? name : undefined}
                className="flex items-center rounded-lg"
                style={{
                  gap: 10,
                  padding: collapsed ? '8px 0' : '7px 10px',
                  justifyContent: collapsed ? 'center' : 'flex-start',
                  background: active ? ACCENT_BG : 'transparent',
                  color: active ? ACCENT : '#6b7280',
                  fontWeight: active ? 600 : 500,
                  fontSize: 13,
                  textDecoration: 'none',
                  transition: 'background 0.12s, color 0.12s',
                }}
                onMouseEnter={e => { if (!active) (e.currentTarget as HTMLElement).style.background = '#f9fafb'; }}
                onMouseLeave={e => { if (!active) (e.currentTarget as HTMLElement).style.background = 'transparent'; }}
              >
                <Icon size={16} style={{ flexShrink: 0, color: active ? ACCENT : '#9ca3af' }} />
                {!collapsed && <span className="truncate">{name}</span>}
              </a>
            );
          })}

        </nav>

        <div className="h-3 shrink-0" />
      </aside>

      {/* ── Mobile bottom tab bar ────────────────────────────────────────── */}
      <nav
        className="md:hidden fixed bottom-0 left-0 right-0 z-50 flex items-center justify-around px-2 py-1"
        style={{ background: '#ffffff', borderTop: '1px solid #f3f4f6', boxShadow: '0 -2px 8px rgba(0,0,0,0.06)' }}
      >
        {navItems.map(({ name, icon: Icon, href }) => {
          const active = href === '/'
            ? current === '/'
            : current === href || current.startsWith(`${href}/`)
          return (
            <a
              key={name}
              href={href}
              className="flex flex-col items-center gap-0.5 px-3 py-1.5 rounded-xl"
              style={{ textDecoration: 'none', color: active ? ACCENT : '#9ca3af' }}
            >
              <Icon size={18} />
              <span style={{ fontSize: 9, fontWeight: active ? 700 : 500 }}>{name}</span>
            </a>
          );
        })}
      </nav>
    </>
  );
}