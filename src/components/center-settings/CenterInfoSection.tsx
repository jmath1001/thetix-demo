'use client'

import { baseInputCls } from './constants'

type Props = {
  editing: boolean
  centerName: string
  setCenterName: (v: string) => void
  centerShortName: string
  setCenterShortName: (v: string) => void
  centerEmail: string
  setCenterEmail: (v: string) => void
  centerPhone: string
  setCenterPhone: (v: string) => void
  centerAddress: string
  setCenterAddress: (v: string) => void
}

const readonlyInputCls = 'w-full rounded border border-transparent bg-slate-50 px-3 py-2 text-sm text-slate-700'

export function CenterInfoSection({
  editing,
  centerName, setCenterName,
  centerShortName, setCenterShortName,
  centerEmail, setCenterEmail,
  centerPhone, setCenterPhone,
  centerAddress, setCenterAddress,
}: Props) {
  return (
    <div>
      <p className="mb-2 text-[11px] font-bold uppercase tracking-widest text-slate-400">Center Info</p>
      <div className="grid grid-cols-1 gap-2 md:grid-cols-2">
        <div>
          <label className="mb-1 block text-xs font-semibold text-slate-500">Center Name</label>
          {editing
            ? <input value={centerName} onChange={e => setCenterName(e.target.value)} className={baseInputCls} placeholder="My Tutoring Center" />
            : <p className={readonlyInputCls}>{centerName || <span className="text-slate-400">—</span>}</p>
          }
        </div>
        <div>
          <label className="mb-1 block text-xs font-semibold text-slate-500">Short Name</label>
          {editing
            ? <input value={centerShortName} onChange={e => setCenterShortName(e.target.value.slice(0, 3))} maxLength={3} className={baseInputCls} placeholder="TC" />
            : <p className={readonlyInputCls}>{centerShortName || <span className="text-slate-400">—</span>}</p>
          }
        </div>
        <div>
          <label className="mb-1 block text-xs font-semibold text-slate-500">Director Email(s)</label>
          {editing
            ? <input value={centerEmail} onChange={e => setCenterEmail(e.target.value)} className={baseInputCls} placeholder="director@yourcenter.com" />
            : <p className={readonlyInputCls}>{centerEmail || <span className="text-slate-400">—</span>}</p>
          }
        </div>
        <div>
          <label className="mb-1 block text-xs font-semibold text-slate-500">Phone</label>
          {editing
            ? <input value={centerPhone} onChange={e => setCenterPhone(e.target.value)} className={baseInputCls} placeholder="(555) 555-5555" />
            : <p className={readonlyInputCls}>{centerPhone || <span className="text-slate-400">—</span>}</p>
          }
        </div>
        <div className="md:col-span-2">
          <label className="mb-1 block text-xs font-semibold text-slate-500">Address</label>
          {editing
            ? <input value={centerAddress} onChange={e => setCenterAddress(e.target.value)} className={baseInputCls} placeholder="123 Main St, City, State 12345" />
            : <p className={readonlyInputCls}>{centerAddress || <span className="text-slate-400">—</span>}</p>
          }
        </div>
      </div>
    </div>
  )
}
