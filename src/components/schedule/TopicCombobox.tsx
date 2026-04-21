'use client';
import { useState, useRef, useEffect } from 'react';

interface Props {
  value: string;
  topics: string[];
  onChange: (val: string) => void;
  disabled?: boolean;
  size?: 'md' | 'sm';
}

export function TopicCombobox({ value, topics, onChange, disabled, size = 'md' }: Props) {
  const [open, setOpen] = useState(false);
  const [input, setInput] = useState(value);
  const [typed, setTyped] = useState(false); // true once user modifies input after opening
  const containerRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // keep input in sync when external value changes (e.g. after save)
  useEffect(() => {
    if (!open) { setInput(value); setTyped(false); }
  }, [value, open]);

  // show all when just opened; filter only once user has typed something different
  const filtered = typed
    ? topics.filter(t => t.toLowerCase().includes(input.toLowerCase()))
    : topics;

  const commit = (val: string) => {
    const v = val.trim() || value;
    setInput(v);
    setOpen(false);
    setTyped(false);
    if (v !== value) onChange(v);
  };

  // close on outside click/tap
  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent | TouchEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        commit(input);
      }
    };
    document.addEventListener('mousedown', handler);
    document.addEventListener('touchstart', handler);
    return () => {
      document.removeEventListener('mousedown', handler);
      document.removeEventListener('touchstart', handler);
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, input]);

  const textCls = size === 'sm' ? 'text-[9px]' : 'text-[10px]';

  return (
    <div
      ref={containerRef}
      className="relative shrink-0"
      onClick={e => e.stopPropagation()}
      onMouseDown={e => e.stopPropagation()}
      onPointerDown={e => e.stopPropagation()}
    >
      {open ? (
        <input
          ref={inputRef}
          value={input}
          disabled={disabled}
          placeholder="Type subject…"
          autoFocus
          onChange={e => { setInput(e.target.value); setTyped(true); }}
          onKeyDown={e => {
            if (e.key === 'Enter') { e.preventDefault(); commit(input); }
            if (e.key === 'Escape') { setInput(value); setOpen(false); setTyped(false); }
            if (e.key === 'ArrowDown') {
              e.preventDefault();
              const first = containerRef.current?.querySelector<HTMLDivElement>('[data-opt]');
              first?.focus();
            }
          }}
          className={`w-24 ${textCls} font-semibold px-1.5 py-0.5 rounded border border-[#6366f1] bg-white text-[#111827] shadow-sm outline-none`}
        />
      ) : (
        <button
          type="button"
          disabled={disabled}
          onClick={() => { setTyped(false); setOpen(true); }}
          className={`flex items-center gap-0.5 ${textCls} font-bold text-[#111827] hover:text-[#6366f1] transition-colors cursor-pointer bg-transparent border-none outline-none`}
        >
          <span className="truncate max-w-24">{value || 'Subject'}</span>
          <svg width="8" height="8" viewBox="0 0 8 8" fill="none" className="shrink-0 opacity-50">
            <path d="M1.5 3L4 5.5L6.5 3" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
          </svg>
        </button>
      )}

      {open && (
        <div className="absolute left-0 top-full mt-1 bg-white rounded-xl shadow-xl border border-[#e5e7eb] overflow-hidden"
          style={{ minWidth: 140, zIndex: 200 }}>
          {/* if user typed something not in list, offer to save it */}
          {input.trim() && !topics.some(t => t.toLowerCase() === input.trim().toLowerCase()) && (
            <div
              data-opt
              tabIndex={0}
              onMouseDown={e => { e.preventDefault(); commit(input); }}
              onKeyDown={e => { if (e.key === 'Enter') commit(input); }}
              className="px-3 py-1.5 text-[11px] font-semibold text-[#6366f1] hover:bg-[#f3f0ff] cursor-pointer flex items-center gap-1.5 border-b border-[#f3f4f6]"
            >
              <span className="text-[10px]">✏️</span> Use &ldquo;{input.trim()}&rdquo;
            </div>
          )}
          {filtered.map((topic, i) => (
            <div
              key={topic}
              data-opt
              tabIndex={0}
              onMouseDown={e => { e.preventDefault(); commit(topic); }}
              onKeyDown={e => {
                if (e.key === 'Enter') commit(topic);
                if (e.key === 'ArrowDown') {
                  e.preventDefault();
                  const opts = containerRef.current?.querySelectorAll<HTMLDivElement>('[data-opt]');
                  opts?.[i + 1]?.focus();
                }
                if (e.key === 'ArrowUp') {
                  e.preventDefault();
                  const opts = containerRef.current?.querySelectorAll<HTMLDivElement>('[data-opt]');
                  if (i === 0) inputRef.current?.focus();
                  else opts?.[i - 1]?.focus();
                }
              }}
              className={`px-3 py-1.5 text-[11px] font-medium cursor-pointer flex items-center gap-1.5 transition-colors ${
                topic === value
                  ? 'bg-[#f3f0ff] text-[#6d28d9] font-semibold'
                  : 'text-[#374151] hover:bg-[#f9fafb]'
              }`}
            >
              {topic === value && <span className="text-[10px] text-[#7c3aed]">✓</span>}
              {topic}
            </div>
          ))}
          {/* permanent custom entry row */}
          <div
            data-opt
            tabIndex={0}
            onMouseDown={e => { e.preventDefault(); setInput(''); setTyped(true); inputRef.current?.focus(); }}
            onKeyDown={e => { if (e.key === 'Enter') { setInput(''); setTyped(true); inputRef.current?.focus(); } }}
            className="px-3 py-1.5 text-[11px] font-semibold text-[#6b7280] hover:bg-[#f9fafb] cursor-pointer flex items-center gap-1.5 border-t border-[#f3f4f6]"
          >
            <span className="text-[10px]">✏️</span> Type custom…
          </div>
        </div>
      )}
    </div>
  );
}
