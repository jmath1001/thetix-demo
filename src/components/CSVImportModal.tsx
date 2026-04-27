"use client"
import { useState, useRef } from 'react';
import { X, Upload, FileText, ChevronRight, Loader2, ClipboardPaste } from 'lucide-react';
import { supabase } from '@/lib/supabaseClient';
import { DB, withCenterPayload } from '@/lib/db';
import { logEvent } from '@/lib/analytics';

const STUDENTS = DB.students

const DB_FIELDS = [
  { key: 'name',         label: 'Name',          required: true },
  { key: 'grade',        label: 'Grade' },
  { key: 'email',        label: 'Student Email' },
  { key: 'phone',        label: 'Student Phone' },
  { key: 'mom_name',     label: 'Mom Name' },
  { key: 'mom_email',    label: 'Mom Email' },
  { key: 'mom_phone',    label: 'Mom Phone' },
  { key: 'dad_name',     label: 'Dad Name' },
  { key: 'dad_email',    label: 'Dad Email' },
  { key: 'dad_phone',    label: 'Dad Phone' },
  { key: 'bluebook_url', label: 'Bluebook URL' },
  { key: 'hours_left',   label: 'Hours Left' },
]

function autoMap(headers: string[]): Record<string, string> {
  const map: Record<string, string> = {}
  headers.forEach(h => {
    const hl = h.toLowerCase().replace(/[^a-z]/g, '')
    const match = DB_FIELDS.find(f => {
      const fl = f.key.replace(/_/g, '')
      return (
        hl === fl ||
        hl.includes(fl) ||
        fl.includes(hl) ||
        ((hl.includes('parent') || hl.includes('mom') || hl.includes('mother')) && hl.includes('name') && f.key === 'mom_name') ||
        ((hl.includes('parent') || hl.includes('mom') || hl.includes('mother')) && hl.includes('email') && f.key === 'mom_email') ||
        ((hl.includes('parent') || hl.includes('mom') || hl.includes('mother')) && (hl.includes('phone') || hl.includes('cell')) && f.key === 'mom_phone') ||
        ((hl.includes('dad') || hl.includes('father')) && hl.includes('name') && f.key === 'dad_name') ||
        ((hl.includes('dad') || hl.includes('father')) && hl.includes('email') && f.key === 'dad_email') ||
        ((hl.includes('dad') || hl.includes('father')) && (hl.includes('phone') || hl.includes('cell')) && f.key === 'dad_phone') ||
        (!hl.includes('parent') && !hl.includes('mom') && !hl.includes('mother') && !hl.includes('dad') && !hl.includes('father') && hl.includes('email') && f.key === 'email') ||
        (!hl.includes('parent') && !hl.includes('mom') && !hl.includes('mother') && !hl.includes('dad') && !hl.includes('father') && (hl.includes('phone') || hl.includes('cell')) && f.key === 'phone') ||
        (hl.includes('grade') && f.key === 'grade') ||
        ((hl === 'name' || hl === 'studentname' || hl === 'fullname') && f.key === 'name') ||
        (hl.includes('hour') && f.key === 'hours_left') ||
        (hl.includes('bluebook') && f.key === 'bluebook_url')
      )
    })
    if (match) map[h] = match.key
  })
  return map
}

function parseDelimited(text: string, delimiter: string): { headers: string[]; rows: string[][] } {
  const lines = text.trim().split('\n').map(l =>
    l.split(delimiter).map(c => c.trim().replace(/^"|"$/g, '').trim())
  )
  if (lines.length < 2) return { headers: [], rows: [] }
  return { headers: lines[0], rows: lines.slice(1).filter(r => r.some(c => c)) }
}

type Step = 'upload' | 'map' | 'importing'
type Mode = 'file' | 'paste'

interface Props {
  onClose: () => void
  onImported: () => void
}

export function CSVImportModal({ onClose, onImported }: Props) {
  const [mode, setMode] = useState<Mode>('file')
  const [step, setStep] = useState<Step>('upload')
  const [headers, setHeaders] = useState<string[]>([])
  const [rows, setRows] = useState<string[][]>([])
  const [mapping, setMapping] = useState<Record<string, string>>({})
  const [pasteText, setPasteText] = useState('')
  const [error, setError] = useState('')
  const fileRef = useRef<HTMLInputElement>(null)

  const ingest = (text: string) => {
    setError('')
    // Try tab first (Google Sheets), fall back to comma
    const delimiter = text.includes('\t') ? '\t' : ','
    const { headers, rows } = parseDelimited(text, delimiter)
    if (headers.length === 0) { setError('Could not parse — make sure you copied the header row too.'); return }
    setHeaders(headers)
    setRows(rows)
    setMapping(autoMap(headers))
    setStep('map')
  }

  const handleFile = (file: File) => {
    const reader = new FileReader()
    reader.onload = e => ingest(e.target?.result as string)
    reader.readAsText(file)
  }

  const handlePaste = () => {
    if (!pasteText.trim()) { setError('Nothing pasted yet.'); return }
    ingest(pasteText)
  }

  const getMapped = (row: string[], field: string) => {
    const header = Object.entries(mapping).find(([, v]) => v === field)?.[0]
    if (!header) return null
    const idx = headers.indexOf(header)
    return idx >= 0 ? row[idx] || null : null
  }

  const validRows = rows.filter(r => getMapped(r, 'name'))

  const handleImport = async () => {
    setStep('importing')
    const records = validRows.map(row => {
      const rec: any = {}
      DB_FIELDS.forEach(f => { rec[f.key] = getMapped(row, f.key) || null })
      return rec
    })
    const { error } = await supabase.from(STUDENTS).insert(records.map(record => withCenterPayload(record)))
    if (error) { setError(error.message); setStep('map'); return }
    logEvent('students_imported', { count: records.length })
    onImported()
    onClose()
  }

  const hasMappedName = Object.values(mapping).includes('name')

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4"
      style={{ background: 'rgba(15,23,42,0.6)', backdropFilter: 'blur(6px)' }}
      onClick={e => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="bg-white rounded-2xl shadow-2xl w-full overflow-hidden"
        onClick={e => e.stopPropagation()}
        style={{ maxWidth: 600, maxHeight: '88vh', border: '1px solid #e2e8f0', display: 'flex', flexDirection: 'column' }}>

        {/* Header */}
        <div className="px-6 py-4 flex items-center justify-between shrink-0"
          style={{ borderBottom: '1px solid #f1f5f9', background: '#fafafa' }}>
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-lg bg-[#dc2626] flex items-center justify-center">
              <Upload size={14} className="text-white" />
            </div>
            <div>
              <p className="text-sm font-black text-[#0f172a]">Import Students</p>
              <p className="text-[10px] text-[#94a3b8] uppercase tracking-widest font-bold">
                {step === 'upload' ? 'Choose source' : step === 'map' ? `Map columns · ${rows.length} rows` : 'Importing...'}
              </p>
            </div>
          </div>
          <button onClick={onClose} className="w-7 h-7 rounded-full flex items-center justify-center text-[#94a3b8]"
            style={{ background: '#f1f5f9' }}>
            <X size={13} />
          </button>
        </div>

        {/* Body */}
        <div className="overflow-y-auto flex-1">

          {/* UPLOAD STEP */}
          {step === 'upload' && (
            <div className="p-6 space-y-4">

              {/* Mode tabs */}
              <div className="flex gap-2 p-1 rounded-xl" style={{ background: '#f1f5f9' }}>
                {(['file', 'paste'] as Mode[]).map(m => (
                  <button key={m} onClick={() => { setMode(m); setError('') }}
                    className="flex-1 flex items-center justify-center gap-2 py-2 rounded-lg text-xs font-bold transition-all"
                    style={mode === m
                      ? { background: '#fff', color: '#0f172a', boxShadow: '0 1px 3px rgba(0,0,0,0.08)' }
                      : { background: 'transparent', color: '#94a3b8' }}>
                    {m === 'file' ? <><FileText size={13} /> Upload CSV</> : <><ClipboardPaste size={13} /> Paste from Spreadsheet</>}
                  </button>
                ))}
              </div>

              {/* File upload */}
              {mode === 'file' && (
                <div
                  onDrop={e => { e.preventDefault(); if (e.dataTransfer.files[0]) handleFile(e.dataTransfer.files[0]) }}
                  onDragOver={e => e.preventDefault()}
                  onClick={() => fileRef.current?.click()}
                  className="rounded-xl cursor-pointer flex flex-col items-center justify-center gap-3 py-12 transition-all"
                  style={{ border: '2px dashed #e2e8f0', background: '#fafafa' }}
                  onMouseEnter={e => { const el = e.currentTarget; el.style.borderColor = '#dc2626'; el.style.background = '#fff5f5' }}
                  onMouseLeave={e => { const el = e.currentTarget; el.style.borderColor = '#e2e8f0'; el.style.background = '#fafafa' }}>
                  <div className="w-11 h-11 rounded-2xl bg-[#fef2f2] flex items-center justify-center">
                    <FileText size={20} style={{ color: '#dc2626' }} />
                  </div>
                  <div className="text-center">
                    <p className="text-sm font-bold text-[#1e293b]">Drop CSV file here</p>
                    <p className="text-xs text-[#94a3b8] mt-0.5">or click to browse</p>
                  </div>
                  <input ref={fileRef} type="file" accept=".csv,.tsv,.txt" className="hidden"
                    onChange={e => { if (e.target.files?.[0]) handleFile(e.target.files[0]) }} />
                </div>
              )}

              {/* Paste mode */}
              {mode === 'paste' && (
                <div className="space-y-3">
                  <div className="p-3 rounded-xl text-xs text-[#475569] leading-relaxed"
                    style={{ background: '#f0fdf4', border: '1px solid #bbf7d0' }}>
                    <p className="font-bold text-[#16a34a] mb-1">How to paste from Google Sheets:</p>
                    <p>Select your cells including the header row → <kbd className="px-1 py-0.5 rounded text-[10px] font-mono bg-white border border-[#e2e8f0]">⌘C</kbd> → paste below</p>
                  </div>
                  <textarea
                    value={pasteText}
                    onChange={e => setPasteText(e.target.value)}
                    placeholder="Paste your spreadsheet data here..."
                    rows={8}
                    className="w-full px-4 py-3 text-sm rounded-xl resize-none outline-none font-mono"
                    style={{ background: '#f8fafc', border: '1.5px solid #e2e8f0', color: '#1e293b', lineHeight: 1.5 }}
                    onFocus={e => { e.currentTarget.style.borderColor = '#dc2626' }}
                    onBlur={e => { e.currentTarget.style.borderColor = '#e2e8f0' }}
                  />
                  <button onClick={handlePaste}
                    disabled={!pasteText.trim()}
                    className="w-full py-2.5 rounded-xl text-sm font-black text-white disabled:opacity-40 transition-all"
                    style={{ background: '#dc2626' }}>
                    Parse Data
                  </button>
                </div>
              )}

              {error && <p className="text-xs text-[#dc2626] font-medium">{error}</p>}

              {/* Field reference */}
              <div className="p-3 rounded-xl" style={{ background: '#f8fafc', border: '1px solid #f1f5f9' }}>
                <p className="text-[9px] font-black text-[#94a3b8] uppercase tracking-widest mb-2">Fields we can import</p>
                <div className="flex flex-wrap gap-1.5">
                  {DB_FIELDS.map(f => (
                    <span key={f.key} className="text-[10px] px-2 py-0.5 rounded-md font-semibold"
                      style={{ background: f.required ? '#fef2f2' : '#f1f5f9', color: f.required ? '#dc2626' : '#64748b' }}>
                      {f.label}{f.required ? ' *' : ''}
                    </span>
                  ))}
                </div>
              </div>
            </div>
          )}

          {/* MAP STEP */}
          {step === 'map' && (
            <div className="p-6 space-y-3">
              <p className="text-xs text-[#64748b]">
                We auto-matched what we could. Fix anything that looks wrong — unmatched columns are skipped.
              </p>
              <div className="space-y-2">
                {headers.map(h => (
                  <div key={h} className="flex items-center gap-3 rounded-2xl p-3 shadow-[0_6px_18px_rgba(15,23,42,0.05)]"
                    style={{ background: '#ffffff', border: `1px solid ${mapping[h] ? '#fda4af' : '#cbd5e1'}` }}>
                    <div className="flex-1 min-w-0">
                      <p className="text-xs font-bold text-[#1e293b] truncate">{h}</p>
                      <p className="text-[10px] text-[#94a3b8]">
                        {rows[0]?.[headers.indexOf(h)] ? `e.g. "${rows[0][headers.indexOf(h)]}"` : 'empty'}
                      </p>
                    </div>
                    <ChevronRight size={12} className="text-[#cbd5e1] shrink-0" />
                    <select
                      value={mapping[h] ?? ''}
                      onChange={e => setMapping(m => ({ ...m, [h]: e.target.value }))}
                      className="rounded-xl border px-3 py-2 text-xs font-black outline-none transition-all"
                      style={{
                        background: mapping[h] ? '#fff1f2' : '#f8fafc',
                        borderColor: mapping[h] ? '#f87171' : '#94a3b8',
                        color: mapping[h] ? '#991b1b' : '#334155',
                        minWidth: 160,
                      }}>
                      <option value="">— Skip —</option>
                      {DB_FIELDS.map(f => (
                        <option key={f.key} value={f.key}>{f.label}</option>
                      ))}
                    </select>
                  </div>
                ))}
              </div>

              {/* Preview */}
              {validRows.length > 0 && (
                <div className="rounded-xl overflow-hidden" style={{ border: '1px solid #e2e8f0' }}>
                  <p className="px-4 py-2 text-[9px] font-black uppercase tracking-widest text-[#94a3b8]"
                    style={{ background: '#f8fafc', borderBottom: '1px solid #f1f5f9' }}>
                    Preview · first 3 rows
                  </p>
                  <div className="divide-y divide-[#f1f5f9]">
                    {validRows.slice(0, 3).map((row, i) => (
                      <div key={i} className="px-4 py-2.5 flex gap-4 text-xs">
                        <span className="font-bold text-[#0f172a] w-28 shrink-0 truncate">{getMapped(row, 'name')}</span>
                        {getMapped(row, 'grade') && <span className="text-[#64748b]">Gr. {getMapped(row, 'grade')}</span>}
                        {getMapped(row, 'email') && <span className="text-[#94a3b8] truncate">{getMapped(row, 'email')}</span>}
                        {getMapped(row, 'mom_name') && <span className="text-[#94a3b8] truncate">{getMapped(row, 'mom_name')}</span>}
                        {getMapped(row, 'dad_name') && <span className="text-[#94a3b8] truncate">{getMapped(row, 'dad_name')}</span>}
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {error && <p className="text-xs text-[#dc2626] font-medium">{error}</p>}
            </div>
          )}

          {/* IMPORTING */}
          {step === 'importing' && (
            <div className="py-16 flex flex-col items-center gap-4">
              <Loader2 size={32} className="animate-spin text-[#dc2626]" />
              <p className="text-sm font-bold text-[#1e293b]">Importing {validRows.length} students...</p>
            </div>
          )}
        </div>

        {/* Footer */}
        {step === 'map' && (
          <div className="px-6 py-4 flex items-center justify-between shrink-0"
            style={{ borderTop: '1px solid #f1f5f9', background: '#fafafa' }}>
            <div className="text-xs text-[#94a3b8]">
              <span className="font-bold text-[#1e293b]">{rows.length}</span> rows ·{' '}
              <span className="font-bold text-[#dc2626]">{validRows.length}</span> with name ·{' '}
              <span className="font-bold text-[#64748b]">{rows.length - validRows.length}</span> skipped
            </div>
            <div className="flex gap-2">
              <button onClick={() => { setStep('upload'); setError('') }}
                className="px-4 py-2 rounded-lg text-xs font-bold text-[#64748b]" style={{ background: '#f1f5f9' }}>
                Back
              </button>
              <button onClick={handleImport} disabled={!hasMappedName || validRows.length === 0}
                className="px-5 py-2 rounded-lg text-xs font-black text-white disabled:opacity-40 transition-all"
                style={{ background: '#dc2626' }}>
                Import {validRows.length} Students
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}