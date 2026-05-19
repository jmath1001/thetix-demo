"use client"
import { useState, useRef, useEffect, useMemo } from 'react';
import { X, Upload, FileText, ChevronRight, Loader2, ClipboardPaste } from 'lucide-react';
import { supabase } from '@/lib/supabaseClient';
import { DB, withCenterPayload, withCenter } from '@/lib/db';
import { logEvent } from '@/lib/analytics';

const STUDENTS = DB.students

const DB_FIELDS = [
  { key: 'name',         label: 'Name',          required: true },
  { key: 'grade',        label: 'Grade' },
  { key: 'school_name',  label: 'School Name' },
  { key: 'subjects',     label: 'Subjects' }, // Added target field
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
  const fls = DB_FIELDS.map(f => ({ key: f.key, fl: f.key.replace(/_/g, '') }))
  headers.forEach(h => {
    const hl = h.toLowerCase().replace(/[^a-z]/g, '')
    if (!hl) return

    // 1. Exact match — handles "Name"→name, "School Name"→school_name, "Mom Name"→mom_name, etc.
    const exact = fls.find(({ fl }) => fl === hl)
    if (exact) { map[h] = exact.key; return }

    // 2. Contextual patterns — must run before generic substring fallbacks
    const isMom    = hl.includes('mom') || hl.includes('mother')
    const isDad    = hl.includes('dad') || hl.includes('father')
    const isParent = hl.includes('parent') && !isMom && !isDad
    const hasName  = hl.includes('name')
    const hasEmail = hl.includes('email')
    const hasPhone = hl.includes('phone') || hl.includes('cell')

    if ((isMom || isParent) && hasName)  { map[h] = 'mom_name';  return }
    if ((isMom || isParent) && hasEmail) { map[h] = 'mom_email'; return }
    if ((isMom || isParent) && hasPhone) { map[h] = 'mom_phone'; return }
    if (isDad && hasName)                { map[h] = 'dad_name';  return }
    if (isDad && hasEmail)               { map[h] = 'dad_email'; return }
    if (isDad && hasPhone)               { map[h] = 'dad_phone'; return }

    if (hl.includes('school'))                                           { map[h] = 'school_name'; return }
    if (hl.includes('grade'))                                            { map[h] = 'grade';       return }
    if (hl.includes('hour'))                                             { map[h] = 'hours_left';  return }
    if (hl.includes('bluebook'))                                         { map[h] = 'bluebook_url'; return }
    if (hl.includes('subject') || hl.includes('course') || hl.includes('class')) { map[h] = 'subjects'; return }

    // 3. Generic fallbacks — only for non-family-context headers
    if (!isMom && !isDad && !isParent && hasEmail) { map[h] = 'email'; return }
    if (!isMom && !isDad && !isParent && hasPhone) { map[h] = 'phone'; return }

    // 4. Name catch-all (student name variants: "First Name", "Full Name", "Student Name")
    if (hasName) { map[h] = 'name'; return }
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
  const [importingLabel, setImportingLabel] = useState('')
  const [centerSubjects, setCenterSubjects] = useState<string[]>([])
  const [existingNames, setExistingNames] = useState<Map<string, string>>(new Map())
  const [loadingExisting, setLoadingExisting] = useState(false)
  const fileRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    fetch('/api/center-subjects')
      .then(r => r.json())
      .then(d => { if (Array.isArray(d?.subjects)) setCenterSubjects(d.subjects) })
      .catch(() => {})
  }, [])

  const ingest = (text: string) => {
    setError('')
    const delimiter = text.includes('\t') ? '\t' : ','
    const { headers, rows } = parseDelimited(text, delimiter)
    if (headers.length === 0) { setError('Could not parse — make sure you copied the header row too.'); return }
    setHeaders(headers)
    setRows(rows)
    setMapping(autoMap(headers))
    setStep('map')
    // Pre-fetch existing student names so we can show a live breakdown
    setLoadingExisting(true)
    withCenter(supabase.from(STUDENTS).select('id, name'))
      .then(({ data }: { data: Array<{ id: string; name: string }> | null }) => {
        const map = new Map<string, string>(
          (data ?? []).map((s: { id: string; name: string }) => [s.name?.toLowerCase().trim(), s.id])
        )
        setExistingNames(map)
      })
      .catch(() => {})
      .finally(() => setLoadingExisting(false))
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

  // Support mapping multiple columns to the same field (e.g., 'subjects')
  const getMapped = (row: string[], field: string) => {
    const headersForField = Object.entries(mapping)
      .filter(([, v]) => v === field)
      .map(([k]) => k)
    if (headersForField.length === 0) return null
    if (headersForField.length === 1) {
      const idx = headers.indexOf(headersForField[0])
      return idx >= 0 ? row[idx] || null : null
    }
    // Multiple columns mapped: return array
    return headersForField
      .map(header => {
        const idx = headers.indexOf(header)
        return idx >= 0 ? row[idx] || null : null
      })
  }

  // Flatten + dedupe subjects from a getMapped result for display
  const getSubjectsPreview = (row: string[]): string => {
    const val = getMapped(row, 'subjects')
    if (!val) return ''
    const parts = Array.isArray(val) ? val : [val]
    return parts
      .filter(Boolean)
      .flatMap(v => (v as string).split(/[,;|]/).map(s => s.trim()).filter(Boolean))
      .filter((v, i, a) => a.indexOf(v) === i)
      .join(', ')
  }

  const validRows = rows.filter(r => {
    const mapped = getMapped(r, 'name')
    if (Array.isArray(mapped)) {
      return mapped.some(Boolean)
    }
    return !!mapped
  })

  const buildRecords = () => validRows.map(row => {
    const rec: any = {}
    DB_FIELDS.forEach(f => {
      const val = getMapped(row, f.key)
      if (f.key === 'subjects') {
        let allSubjects: string[] = []
        if (Array.isArray(val)) {
          val.forEach(v => { if (v) allSubjects.push(...v.split(/[,;|]/).map(s => s.trim()).filter(Boolean)) })
        } else if (typeof val === 'string' && val) {
          allSubjects = val.split(/[,;|]/).map(s => s.trim()).filter(Boolean)
        }
        // Canonicalize against center subjects list (case-insensitive)
        rec[f.key] = allSubjects.map(s => {
          const lower = s.toLowerCase()
          return centerSubjects.find(cs => cs.toLowerCase() === lower) ?? s
        })
      } else {
        rec[f.key] = Array.isArray(val) ? (val.find(Boolean) || null) : (val || null)
      }
    })
    return rec
  })

  const handleImport = async () => {
    setImportingLabel(`Importing ${validRows.length} student${validRows.length !== 1 ? 's' : ''}…`)
    setStep('importing')
    const records = buildRecords()
    let byName = existingNames
    if (byName.size === 0 && !loadingExisting) {
      const { data, error: fetchErr } = await withCenter(supabase.from(STUDENTS).select('id, name'))
      if (fetchErr) { setError(fetchErr.message); setStep('map'); return }
      byName = new Map((data ?? []).map((s: { id: string; name: string }) => [s.name?.toLowerCase().trim(), s.id]))
    }
    const newRecords = records.filter(r => !byName.has((r.name ?? '').toLowerCase().trim()))
    const updateRecords = records.filter(r => byName.has((r.name ?? '').toLowerCase().trim()))
    // Add new students
    if (newRecords.length > 0) {
      const { error } = await supabase.from(STUDENTS).insert(newRecords.map(r => withCenterPayload(r)))
      if (error) { setError(error.message); setStep('map'); return }
    }
    // Update existing students (only mapped, non-blank fields)
    if (updateRecords.length > 0) {
      const mappedFields = [...new Set(Object.values(mapping).filter(Boolean))]
      for (const rec of updateRecords) {
        const id = byName.get((rec.name ?? '').toLowerCase().trim())
        const patch: any = {}
        mappedFields.forEach(f => {
          if (f === 'name') return
          const v = rec[f]
          if (v === null || v === undefined) return
          if (Array.isArray(v) && v.length === 0) return
          patch[f] = v
        })
        if (Object.keys(patch).length > 0) {
          const { error } = await supabase.from(STUDENTS).update(patch).eq('id', id)
          if (error) { setError(error.message); setStep('map'); return }
        }
      }
    }
    logEvent('students_imported', { count: records.length })
    onImported(); onClose()
  }

  const hasMappedName = Object.values(mapping).includes('name')

  const importBreakdown = useMemo(() => {
    const names = validRows.map(r => {
      const v = getMapped(r, 'name')
      const raw = Array.isArray(v) ? (v.find(Boolean) ?? '') : (v ?? '')
      return (raw as string).toLowerCase().trim()
    })
    const matchCount = names.filter(n => n && existingNames.has(n)).length
    const newCount = names.filter(n => n && !existingNames.has(n)).length
    return { newCount, matchCount }
  }, [validRows, existingNames, mapping])
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4"
      style={{ background: 'rgba(15,23,42,0.6)', backdropFilter: 'blur(6px)' }}
      onClick={e => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="bg-white rounded-2xl shadow-2xl w-full overflow-hidden"
        onClick={e => e.stopPropagation()}
        style={{ maxWidth: 780, maxHeight: '90vh', border: '1px solid #e2e8f0', display: 'flex', flexDirection: 'column' }}>

        {/* Header */}
        <div className="px-6 py-4 flex items-center justify-between shrink-0"
          style={{ borderBottom: '1px solid #f1f5f9', background: '#fafafa' }}>
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-lg bg-[#4f46e5] flex items-center justify-center">
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
                  onMouseEnter={e => { const el = e.currentTarget; el.style.borderColor = '#4f46e5'; el.style.background = '#f5f3ff' }}
                  onMouseLeave={e => { const el = e.currentTarget; el.style.borderColor = '#e2e8f0'; el.style.background = '#fafafa' }}>
                  <div className="w-11 h-11 rounded-2xl bg-[#ede9fe] flex items-center justify-center">
                    <FileText size={20} style={{ color: '#4f46e5' }} />
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
                    onFocus={e => { e.currentTarget.style.borderColor = '#4f46e5' }}
                    onBlur={e => { e.currentTarget.style.borderColor = '#e2e8f0' }}
                  />
                  <button onClick={handlePaste}
                    disabled={!pasteText.trim()}
                    className="w-full py-2.5 rounded-xl text-sm font-black text-white disabled:opacity-40 transition-all"
                    style={{ background: '#4f46e5' }}>
                    Parse Data
                  </button>
                </div>
              )}

              {error && <p className="text-xs font-medium" style={{ color: '#dc2626' }}>{error}</p>}

              {/* Field reference */}
              <div className="p-3 rounded-xl" style={{ background: '#f8fafc', border: '1px solid #f1f5f9' }}>
                <p className="text-[9px] font-black text-[#94a3b8] uppercase tracking-widest mb-2">Fields we can import</p>
                <div className="flex flex-wrap gap-1.5">
                  {DB_FIELDS.map(f => (
                    <span key={f.key} className="text-[10px] px-2 py-0.5 rounded-md font-semibold"
                      style={{ background: f.required ? '#ede9fe' : '#f1f5f9', color: f.required ? '#4f46e5' : '#64748b' }}>
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
              <p className="text-[10px] text-[#94a3b8]">
                Tip: you can map multiple columns to <span className="font-bold text-[#64748b]">Subjects</span> — they&apos;ll be merged into one list. Comma-separated values in a single cell also work.
              </p>
              <div className="space-y-2">
                {headers.map((h, hIdx) => (
                  <div key={`${h}-${hIdx}`} className="flex items-center gap-3 rounded-xl p-3"
                    style={{ background: '#ffffff', border: `1px solid ${mapping[h] ? '#c7d2fe' : '#e2e8f0'}` }}>
                    <div className="flex-1 min-w-0">
                      <p className="text-xs font-bold text-[#1e293b] truncate">{h || <span className="italic text-[#94a3b8]">(empty header)</span>}</p>
                      <p className="text-[10px] text-[#94a3b8]">
                        {rows[0]?.[hIdx] ? `e.g. "${rows[0][hIdx]}"` : 'empty column'}
                      </p>
                    </div>
                    <ChevronRight size={12} className="text-[#cbd5e1] shrink-0" />
                    <select
                      value={mapping[h] ?? ''}
                      onChange={e => setMapping(m => ({ ...m, [h]: e.target.value }))}
                      className="rounded-xl border px-3 py-2 text-xs font-black outline-none transition-all"
                      style={{
                        background: mapping[h] ? '#eef2ff' : '#f8fafc',
                        borderColor: mapping[h] ? '#818cf8' : '#cbd5e1',
                        color: mapping[h] ? '#3730a3' : '#334155',
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
              {validRows.length > 0 && (() => {
                const mappedCols = Object.entries(mapping).filter(([, v]) => v).map(([h, field]) => ({ header: h, field }))
                return (
                  <div className="rounded-xl overflow-hidden" style={{ border: '1px solid #e2e8f0' }}>
                    <p className="px-4 py-2 text-[9px] font-black uppercase tracking-widest text-[#64748b]"
                      style={{ background: '#f8fafc', borderBottom: '1px solid #e2e8f0' }}>
                      Preview — first {Math.min(5, validRows.length)} of {validRows.length} rows
                    </p>
                    <div className="overflow-x-auto">
                      <table className="w-full text-xs border-collapse">
                        <thead>
                          <tr style={{ background: '#f8fafc', borderBottom: '1px solid #e2e8f0' }}>
                            {mappedCols.map(({ header, field }) => (
                              <th key={`${header}-${field}`} className="px-3 py-2 text-left font-black text-[#475569] whitespace-nowrap" style={{ borderRight: '1px solid #f1f5f9' }}>
                                {DB_FIELDS.find(f => f.key === field)?.label ?? field}
                                <span className="block text-[9px] font-normal text-[#94a3b8] mt-0.5">{header}</span>
                              </th>
                            ))}
                          </tr>
                        </thead>
                        <tbody>
                          {validRows.slice(0, 5).map((row, i) => (
                            <tr key={i} style={{ borderBottom: '1px solid #f1f5f9', background: i % 2 === 0 ? '#fff' : '#fafafa' }}>
                              {mappedCols.map(({ header, field }) => {
                                const val = field === 'subjects' ? getSubjectsPreview(row) : getMapped(row, field)
                                const display = Array.isArray(val) ? val.filter(Boolean).join(', ') : (val ?? '')
                                return (
                                  <td key={`${header}-${field}`} className="px-3 py-2 text-[#1e293b] max-w-40 truncate" style={{ borderRight: '1px solid #f1f5f9' }}>
                                    {display || <span className="text-[#cbd5e1]">—</span>}
                                  </td>
                                )
                              })}
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                )
              })()}

              {error && <p className="text-xs font-medium" style={{ color: '#dc2626' }}>{error}</p>}
            </div>
          )}

          {/* IMPORTING */}
          {step === 'importing' && (
            <div className="py-16 flex flex-col items-center gap-4">
              <Loader2 size={32} className="animate-spin text-[#4f46e5]" />
              <p className="text-sm font-bold text-[#1e293b]">{importingLabel}</p>
            </div>
          )}
        </div>

        {/* Footer */}
        {step === 'map' && (
          <div className="px-6 py-4 shrink-0"
            style={{ borderTop: '1px solid #f1f5f9', background: '#fafafa' }}>
            <div className="flex items-center justify-between gap-3">
              <div className="text-xs text-[#94a3b8]">
                {loadingExisting ? 'Checking…' : importBreakdown && (
                  <>
                    {importBreakdown.newCount > 0 && <span><span className="font-bold text-[#16a34a]">{importBreakdown.newCount} new</span></span>}
                    {importBreakdown.newCount > 0 && importBreakdown.matchCount > 0 && ' · '}
                    {importBreakdown.matchCount > 0 && <span><span className="font-bold" style={{ color: '#4f46e5' }}>{importBreakdown.matchCount} existing</span> will be updated</span>}
                  </>
                )}
              </div>
              <div className="flex gap-2">
                <button onClick={() => { setStep('upload'); setError('') }}
                  className="px-4 py-2 rounded-lg text-xs font-bold text-[#64748b]" style={{ background: '#f1f5f9' }}>
                  Back
                </button>
                <button
                  onClick={handleImport}
                  disabled={!hasMappedName || validRows.length === 0 || loadingExisting}
                  className="px-5 py-2 rounded-lg text-xs font-black text-white disabled:opacity-40 transition-all"
                  style={{ background: '#4f46e5' }}>
                  Import {validRows.length > 0 ? validRows.length : ''}
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}