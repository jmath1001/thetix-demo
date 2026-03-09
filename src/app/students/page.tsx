"use client"
import React, { useState, useEffect, useCallback } from 'react';
import { Plus, Trash2, GraduationCap, Loader2, Save, X, Search, User, Mail, Hash } from 'lucide-react';
import { supabase } from '@/lib/supabaseClient';

// ─── Student Row Component ───────────────────────────────────────────────────

function StudentRow({ student, onRefetch }: { student: any; onRefetch: () => void }) {
  const [isEditing, setIsEditing] = useState(false);
  const [draft, setDraft] = useState(student);
  const [saving, setSaving] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);

  const handleUpdate = async () => {
    setSaving(true);
    const { error } = await supabase
      .from('slake_students')
      .update({ name: draft.name, grade: parseInt(draft.grade) })
      .eq('id', student.id);
    
    if (!error) {
      onRefetch();
      setIsEditing(false);
    }
    setSaving(false);
  };

  const handleDelete = async () => {
    if (!confirmDelete) {
      setConfirmDelete(true);
      return;
    }
    await supabase.from('slake_students').delete().eq('id', student.id);
    onRefetch();
  };

  return (
    <div className="bg-white border border-stone-200 rounded-xl transition-all hover:shadow-sm overflow-hidden">
      <div className="p-4 flex flex-col md:flex-row md:items-center justify-between gap-4">
        
        {/* Student Info / Edit Fields */}
        <div className="flex items-center gap-4 flex-1">
          <div className="w-10 h-10 rounded-full bg-violet-100 text-violet-700 flex items-center justify-center font-bold shrink-0">
            {student.name.charAt(0).toUpperCase()}
          </div>
          
          {isEditing ? (
            <div className="flex flex-wrap gap-2 flex-1">
              <input 
                value={draft.name} 
                onChange={e => setDraft({...draft, name: e.target.value})}
                className="px-3 py-1.5 border rounded-lg text-sm focus:ring-2 focus:ring-violet-500 outline-none"
                placeholder="Name"
              />
              <input 
                type="number" 
                value={draft.grade} 
                onChange={e => setDraft({...draft, grade: e.target.value})}
                className="w-20 px-3 py-1.5 border rounded-lg text-sm focus:ring-2 focus:ring-violet-500 outline-none"
                placeholder="Grade"
              />
            </div>
          ) : (
            <div>
              <h3 className="font-semibold text-stone-900">{student.name}</h3>
              <p className="text-xs text-stone-500 uppercase tracking-wider font-medium">Grade {student.grade}</p>
            </div>
          )}
        </div>

        {/* Action Buttons */}
        <div className="flex items-center gap-2 self-end md:self-center">
          {isEditing ? (
            <>
              <button onClick={() => { setIsEditing(false); setDraft(student); }} className="p-2 text-stone-400 hover:text-stone-600">
                <X size={18} />
              </button>
              <button onClick={handleUpdate} disabled={saving} className="flex items-center gap-2 px-4 py-2 bg-violet-600 text-white rounded-lg text-xs font-bold hover:bg-violet-700 disabled:opacity-50">
                {saving ? <Loader2 size={14} className="animate-spin" /> : <Save size={14} />} Save
              </button>
            </>
          ) : (
            <>
              <button onClick={() => setIsEditing(true)} className="px-3 py-1.5 text-xs font-semibold text-stone-600 border border-stone-200 rounded-lg hover:bg-stone-50">
                Edit
              </button>
              <button 
                onClick={handleDelete}
                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors ${confirmDelete ? 'bg-red-600 text-white' : 'text-stone-400 hover:text-red-600'}`}
              >
                <Trash2 size={14} /> {confirmDelete ? 'Confirm?' : ''}
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

// ─── Main Admin Page ─────────────────────────────────────────────────────────

export default function StudentAdminPage() {
  const [students, setStudents] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [adding, setAdding] = useState(false);
  const [search, setSearch] = useState('');
  const [newStudent, setNewStudent] = useState({ name: '', grade: '' });

  const fetchData = useCallback(async () => {
    setLoading(true);
    const { data } = await supabase.from('slake_students').select('*').order('name');
    setStudents(data || []);
    setLoading(false);
  }, []);

  useEffect(() => { fetchData(); }, [fetchData]);

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newStudent.name || !newStudent.grade) return;
    
    await supabase.from('slake_students').insert([{
      name: newStudent.name,
      grade: parseInt(newStudent.grade),
    }]);
    
    setAdding(false);
    setNewStudent({ name: '', grade: '' });
    fetchData();
  };

  const filtered = students.filter(s => s.name.toLowerCase().includes(search.toLowerCase()));

  return (
    <div className="min-h-screen bg-[#F9F8F6] text-stone-900 font-sans pb-20">
      {/* Navbar */}
      <nav className="sticky top-0 z-50 bg-white/80 backdrop-blur-md border-b border-stone-200">
        <div className="max-w-4xl mx-auto px-6 h-16 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="bg-violet-600 p-1.5 rounded-lg shadow-sm shadow-violet-200">
              <GraduationCap className="text-white" size={20} />
            </div>
            <h1 className="font-bold text-lg tracking-tight">Student Directory</h1>
          </div>
          <button 
            onClick={() => setAdding(true)}
            className="bg-violet-600 hover:bg-violet-700 text-white px-4 py-2 rounded-xl text-sm font-bold flex items-center gap-2 transition-all active:scale-95"
          >
            <Plus size={18} /> Add Student
          </button>
        </div>
      </nav>

      <main className="max-w-4xl mx-auto px-6 pt-8 space-y-6">
        
        {/* Search Bar */}
        <div className="relative group">
          <Search className="absolute left-4 top-1/2 -translate-y-1/2 text-stone-400 group-focus-within:text-violet-500 transition-colors" size={18} />
          <input 
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Search by name..."
            className="w-full pl-12 pr-4 py-3.5 bg-white border border-stone-200 rounded-2xl shadow-sm outline-none focus:ring-2 focus:ring-violet-500/20 focus:border-violet-500 transition-all"
          />
        </div>

        {/* Add Student Modal-ish Form */}
        {adding && (
          <div className="bg-white border-2 border-violet-500 rounded-2xl p-6 shadow-xl shadow-violet-100 animate-in fade-in zoom-in duration-200">
            <div className="flex justify-between mb-4">
              <h2 className="font-bold text-lg text-violet-900">New Student Profile</h2>
              <button onClick={() => setAdding(false)} className="text-stone-400 hover:text-stone-600"><X size={20} /></button>
            </div>
            <form onSubmit={handleCreate} className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <div className="md:col-span-2 space-y-1">
                <label className="text-xs font-bold text-stone-500 ml-1">NAME</label>
                <input 
                  required
                  value={newStudent.name}
                  onChange={e => setNewStudent({...newStudent, name: e.target.value})}
                  className="w-full px-4 py-2.5 bg-stone-50 border border-stone-200 rounded-xl focus:bg-white outline-none"
                  placeholder="e.g. Alex Johnson"
                />
              </div>
              <div className="space-y-1">
                <label className="text-xs font-bold text-stone-500 ml-1">GRADE</label>
                <input 
                  required
                  type="number"
                  value={newStudent.grade}
                  onChange={e => setNewStudent({...newStudent, grade: e.target.value})}
                  className="w-full px-4 py-2.5 bg-stone-50 border border-stone-200 rounded-xl focus:bg-white outline-none"
                  placeholder="1-12"
                />
              </div>
              <button type="submit" className="md:col-span-3 mt-2 bg-violet-600 text-white py-3 rounded-xl font-bold hover:bg-violet-700 transition-colors">
                Register Student
              </button>
            </form>
          </div>
        )}

        {/* List Content */}
        <div className="space-y-3">
          {loading ? (
            <div className="flex flex-col items-center py-20 text-stone-400">
              <Loader2 className="animate-spin mb-2" />
              <p className="text-sm">Fetching student records...</p>
            </div>
          ) : filtered.length > 0 ? (
            filtered.map(s => <StudentRow key={s.id} student={s} onRefetch={fetchData} />)
          ) : (
            <div className="text-center py-20 bg-white rounded-2xl border border-dashed border-stone-300">
              <p className="text-stone-400">No student records found.</p>
            </div>
          )}
        </div>
      </main>
    </div>
  );
}