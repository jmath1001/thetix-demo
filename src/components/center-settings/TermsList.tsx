'use client'

import type { TermRow } from './types'

type Props = {
  terms: TermRow[]
  termsLoading: boolean
  activatingTermId: string | null
  termSaving: boolean
  termFormOpen: boolean
  onNewTerm: () => void
  onEdit: (term: TermRow) => void
  onDelete: (id: string) => void
  onSetCurrent: (id: string) => void
}

const STATUS_COLORS: Record<string, string> = {
  active: 'bg-emerald-100 text-emerald-700',
  upcoming: 'bg-sky-100 text-sky-700',
  completed: 'bg-slate-100 text-slate-500',
}

export function TermsList({
  terms,
  termsLoading,
  activatingTermId,
  termSaving,
  termFormOpen,
  onNewTerm,
  onEdit,
  onDelete,
  onSetCurrent,
}: Props) {
  return (
    <div>
      {termsLoading ? (
        <p className="text-xs text-slate-400">Loading terms…</p>
      ) : terms.length === 0 ? (
        <p className="rounded border border-dashed border-slate-200 px-4 py-3 text-xs text-slate-400">No terms yet.</p>
      ) : (
        <div className="space-y-2">
          {terms.map(term => (
            <div key={term.id} className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-slate-100 bg-slate-50 px-4 py-3">
              <div>
                <div className="flex items-center gap-2">
                  <span className="font-semibold text-slate-800 text-sm">{term.name}</span>
                  <span className={`rounded px-1.5 py-0.5 text-[10px] font-bold ${STATUS_COLORS[term.status] ?? 'bg-slate-100 text-slate-500'}`}>
                    {term.status}
                  </span>
                </div>
                <p className="mt-0.5 text-[11px] text-slate-500">{term.start_date} → {term.end_date}</p>
              </div>
              <div className="flex flex-wrap gap-1.5">
                {term.status !== 'active' && (
                  <button type="button" disabled={activatingTermId === term.id}
                    onClick={() => onSetCurrent(term.id)}
                    className="rounded border border-slate-200 bg-white px-2.5 py-1 text-[11px] font-semibold text-slate-600 hover:bg-emerald-50 hover:text-emerald-700 disabled:opacity-50"
                  >
                    {activatingTermId === term.id ? 'Setting…' : 'Set Current'}
                  </button>
                )}
                <button type="button" onClick={() => onEdit(term)}
                  className="rounded border border-slate-200 bg-white px-2.5 py-1 text-[11px] font-semibold text-slate-600 hover:bg-indigo-50 hover:text-indigo-700"
                >Edit</button>
                <button type="button" onClick={() => onDelete(term.id)}
                  className="rounded border border-slate-200 bg-white px-2.5 py-1 text-[11px] font-semibold text-slate-600 hover:bg-red-50 hover:text-red-600"
                >Delete</button>
              </div>
            </div>
          ))}
        </div>
      )}

      {!termFormOpen && (
        <button onClick={onNewTerm} disabled={termSaving}
          className="mt-3 rounded border border-slate-200 bg-white px-3.5 py-2 text-[11px] font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-50"
        >+ Add Term</button>
      )}
    </div>
  )
}
