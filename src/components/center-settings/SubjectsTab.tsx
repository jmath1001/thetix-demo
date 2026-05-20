'use client'

import { Loader2, Plus, Save, Trash2 } from 'lucide-react'
import { baseInputCls } from './constants'

type Props = {
  centerSubjects: string[]
  subjectsLoading: boolean
  subjectsSaving: boolean
  newSubjectInput: string
  setNewSubjectInput: (v: string) => void
  onSave: () => void
  onAdd: () => void
  onRemove: (s: string) => void
}

export function SubjectsTab({
  centerSubjects,
  subjectsLoading,
  subjectsSaving,
  newSubjectInput,
  setNewSubjectInput,
  onSave,
  onAdd,
  onRemove,
}: Props) {
  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between">
        <p className="text-[11px] font-bold uppercase tracking-widest text-slate-400">Subjects</p>
        <button onClick={onSave} disabled={subjectsSaving}
          className="flex items-center gap-1.5 rounded px-3 py-1.5 text-xs font-semibold text-white transition-opacity disabled:opacity-50"
          style={{ background: '#0f172a' }}
        >
          {subjectsSaving ? <Loader2 size={11} className="animate-spin" /> : <Save size={11} />}
          Save
        </button>
      </div>
      <p className="text-xs text-slate-500">These subjects appear in student and tutor profiles. Changes apply to new bookings.</p>

      {subjectsLoading ? (
        <div className="flex items-center gap-2 text-xs text-slate-400"><Loader2 size={13} className="animate-spin" />Loading…</div>
      ) : (
        <>
          <div className="flex flex-wrap gap-2">
            {centerSubjects.map(s => (
              <span key={s} className="flex items-center gap-1.5 rounded-lg border px-2.5 py-1 text-xs font-semibold" style={{ background: '#f8fafc', borderColor: '#e2e8f0', color: '#0f172a' }}>
                {s}
                <button type="button" onClick={() => onRemove(s)} className="ml-0.5 rounded text-slate-400 transition-colors hover:text-red-500">
                  <Trash2 size={11} />
                </button>
              </span>
            ))}
            {centerSubjects.length === 0 && <p className="text-xs text-slate-400">No subjects yet. Add one below.</p>}
          </div>
          <div className="flex items-center gap-2">
            <input
              type="text"
              value={newSubjectInput}
              onChange={e => setNewSubjectInput(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); onAdd() } }}
              placeholder="New subject…"
              className={baseInputCls + ' max-w-xs'}
            />
            <button type="button" onClick={onAdd} disabled={!newSubjectInput.trim()}
              className="flex items-center gap-1.5 rounded px-3 py-2 text-xs font-semibold text-white disabled:opacity-40"
              style={{ background: '#6d28d9' }}
            >
              <Plus size={12} /> Add
            </button>
          </div>
        </>
      )}
    </div>
  )
}
