"use client"
import { memo, useState } from 'react';
import { updateSessionNotes } from '@/lib/useScheduleData';

export const NotesEditor = memo(function NotesEditor({
  rowId,
  initialNotes,
  onSaved,
}: {
  rowId: any;
  initialNotes: string;
  onSaved: () => void;
}) {
  const [notes, setNotes] = useState(initialNotes);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  const handleSave = async () => {
    setSaving(true);
    try {
      await updateSessionNotes({ rowId, notes: notes || null });
      onSaved();
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    } catch (err) { console.error(err); }
    setSaving(false);
  };

  return (
    <div className="p-4 border-b border-[#f0ece8]">
      <div className="flex items-center justify-between mb-2">
        <p className="text-[9px] font-black text-[#a8a29e] uppercase tracking-widest">Session Notes</p>
        {saved && <span className="text-[9px] font-bold text-[#16a34a] uppercase tracking-wider">Saved ✓</span>}
      </div>
      <textarea
        className="w-full px-3 py-2.5 rounded-xl text-sm text-[#1c1917] border-2 border-[#e7e3dd] focus:border-[#6d28d9] outline-none transition-all resize-none"
        placeholder="Add notes about this session…"
        rows={notes ? 4 : 2}
        value={notes}
        onChange={e => { setNotes(e.target.value); setSaved(false); }}
      />
      <button
        onClick={handleSave}
        disabled={saving}
        className="mt-2 w-full py-2 rounded-xl text-[10px] font-black uppercase tracking-wider transition-all"
        style={{ background: saving ? '#e7e3dd' : '#6d28d9', color: saving ? '#a8a29e' : 'white' }}>
        {saving ? 'Saving…' : saved ? '✓ Saved' : 'Save Notes'}
      </button>
    </div>
  );
});