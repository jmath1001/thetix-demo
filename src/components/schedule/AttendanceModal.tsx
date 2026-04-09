"use client"
import { X, UserX, CheckCircle2, Clock, Mail, Phone, ExternalLink, User, FileText, Save, Loader2, Copy, Check } from 'lucide-react';
import { useState, useEffect } from 'react';
import {
  bookStudent,
  removeStudentFromSession,
  updateAttendance,
  updateConfirmationStatus,
  updateSessionNotes,
  formatDate,
  dayOfWeek,
  type Tutor,
} from '@/lib/useScheduleData';
import { MAX_CAPACITY } from '@/components/constants';
import { isTutorAvailable } from './scheduleUtils';

interface AttendanceModalProps {
  selectedSession: any;
  setSelectedSession: (s: any) => void;
  patchSelectedSession: (patch: Record<string, any>) => void;
  modalTab: 'attendance' | 'confirmation' | 'notes';
  setModalTab: (t: 'attendance' | 'confirmation' | 'notes') => void;
  tutors: Tutor[];
  students: any[];
  sessions: any[];
  refetch: () => void;
}

interface ModalContentProps extends AttendanceModalProps {
  s: any;
  student: any;
  studentRecord: any;
  altTutors: Tutor[];
  hasContactInfo: boolean;
  sessionTime: string;
}

function CopyBtn({ value }: { value: string }) {
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    await navigator.clipboard.writeText(value);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };
  return (
    <button onClick={copy}
      className="shrink-0 w-5 h-5 rounded-md flex items-center justify-center transition-all"
      style={{ background: copied ? '#dcfce7' : '#f1f5f9', color: copied ? '#16a34a' : '#94a3b8' }}
      title="Copy">
      {copied ? <Check size={10} /> : <Copy size={10} />}
    </button>
  );
}

function ContactRow({ href, icon, label, copyValue }: { href: string; icon: React.ReactNode; label: string; copyValue?: string }) {
  return (
    <div className="flex items-center gap-2.5 px-3 py-2 rounded-lg" style={{ background: 'rgba(255,255,255,0.6)', border: '1px solid rgba(203,213,225,0.5)' }}>
      <span style={{ color: '#94a3b8' }} className="shrink-0">{icon}</span>
      <a href={href} className="flex-1 text-[12.5px] font-medium truncate" style={{ color: '#1e293b', textDecoration: 'none' }}>
        {label}
      </a>
      {copyValue && <CopyBtn value={copyValue} />}
    </div>
  );
}

function ModalContent({
  s, student, studentRecord, altTutors, hasContactInfo, sessionTime,
  selectedSession, setSelectedSession, patchSelectedSession,
  modalTab, setModalTab, tutors, students, sessions, refetch,
}: ModalContentProps) {
  const currentStatus = student.status;
  const currentConf = student.confirmationStatus ?? null;

  const [notesEditing, setNotesEditing] = useState(false);
  const [notesDraft, setNotesDraft] = useState<string>(student.notes ?? '');
  const [notesSaving, setNotesSaving] = useState(false);

  useEffect(() => {
    if (!notesEditing) setNotesDraft(student.notes ?? '');
  }, [student.notes, notesEditing]);

  const handleAttendance = async (status: 'scheduled' | 'present' | 'no-show') => {
    patchSelectedSession({ status });
    try { await updateAttendance({ sessionId: s.id, studentId: student.id, status }); refetch(); }
    catch (err) { patchSelectedSession({ status: currentStatus }); console.error(err); }
  };

  const handleConfirmation = async (status: 'confirmed' | null) => {
    patchSelectedSession({ confirmationStatus: status });
    try { await updateConfirmationStatus({ rowId: student.rowId, status }); refetch(); }
    catch (err) { patchSelectedSession({ confirmationStatus: currentConf }); console.error(err); }
  };

  const handleSaveNotes = async () => {
    setNotesSaving(true);
    try {
      await updateSessionNotes({ rowId: student.rowId, notes: notesDraft });
      patchSelectedSession({ notes: notesDraft });
      refetch(); setNotesEditing(false);
    } catch (err) { console.error(err); }
    setNotesSaving(false);
  };

  const handleRemove = async () => {
    try { await removeStudentFromSession({ sessionId: s.id, studentId: student.id }); refetch(); setSelectedSession(null); }
    catch (err) { console.error(err); }
  };

  const handleReassign = async (newTutor: Tutor) => {
    try {
      await removeStudentFromSession({ sessionId: s.id, studentId: student.id });
      const studentObj = students.find(st => st.id === student.id) ?? {
        id: student.id, name: student.name, subject: student.topic, grade: student.grade ?? null,
        hoursLeft: 0, availabilityBlocks: [], email: null, phone: null,
        parent_name: null, parent_email: null, parent_phone: null, bluebook_url: null,
      };
      await bookStudent({ tutorId: newTutor.id, date: s.date, time: sessionTime, student: studentObj, topic: student.topic });
      refetch(); setSelectedSession(null);
    } catch (err: any) { alert(err.message || 'Reassignment failed'); }
  };

  const initials = student.name.split(' ').map((n: string) => n[0]).join('').slice(0, 2).toUpperCase();
  const blockLabel = s.block?.label ?? sessionTime;
  const cr = studentRecord;

  const attendanceCfg = {
    present:   { label: 'Present',   active: { bg: '#f0fdf4', border: '#16a34a', text: '#15803d' } },
    'no-show': { label: 'No-show',   active: { bg: '#fff1f2', border: '#f43f5e', text: '#be123c' } },
    scheduled: { label: 'Unmarked',  active: { bg: '#f8fafc', border: '#94a3b8', text: '#475569' } },
  } as const;

  return (
    <div className="flex flex-col h-full overflow-hidden">

      {/* HEADER */}
      <div className="shrink-0 px-5 pt-5 pb-4 flex items-center justify-between gap-4">
        <div className="flex items-center gap-3 min-w-0">
          <div className="shrink-0 w-10 h-10 rounded-xl flex items-center justify-center text-sm font-black text-white"
            style={{ background: 'linear-gradient(135deg, #4f46e5, #7c3aed)' }}>
            {initials}
          </div>
          <div className="min-w-0">
            <h2 className="text-[16px] font-black text-[#0f172a] leading-tight truncate">{student.name}</h2>
            <div className="flex items-center gap-1.5 mt-0.5">
              <span className="text-[11px] font-semibold text-[#64748b]">{student.topic}</span>
              {student.grade && <>
                <span className="text-[#cbd5e1] text-[10px]">·</span>
                <span className="text-[11px] text-[#94a3b8]">Gr. {student.grade}</span>
              </>}
            </div>
          </div>
        </div>
        <button onClick={() => setSelectedSession(null)}
          className="shrink-0 w-7 h-7 rounded-full flex items-center justify-center transition-all"
          style={{ background: '#f1f5f9', color: '#94a3b8' }}
          onMouseEnter={e => { (e.currentTarget as HTMLElement).style.background = '#e2e8f0'; }}
          onMouseLeave={e => { (e.currentTarget as HTMLElement).style.background = '#f1f5f9'; }}>
          <X size={13} />
        </button>
      </div>

      {/* SESSION CONTEXT */}
      <div className="shrink-0 mx-5 mb-3 px-3 py-2 rounded-lg flex items-center gap-2 flex-wrap"
        style={{ background: '#f8fafc', border: '1px solid #e2e8f0' }}>
        <span className="text-[9px] font-black px-2 py-0.5 rounded-md uppercase tracking-wider text-white"
          style={{ background: '#4f46e5' }}>{s.dayName}</span>
        <span className="text-[11px] text-[#475569]">{formatDate(s.date)}</span>
        <span className="text-[#e2e8f0]">·</span>
        <span className="text-[11px] text-[#64748b]">{blockLabel}</span>
        <span className="text-[#e2e8f0]">·</span>
        <span className="text-[11px] font-semibold text-[#334155]">{s.tutorName}</span>
      </div>

      {/* TAB BAR */}
      <div className="shrink-0 flex px-5 gap-0" style={{ borderBottom: '1px solid #f1f5f9' }}>
        {(['attendance', 'confirmation', 'notes'] as const).map(tab => (
          <button key={tab} onClick={() => setModalTab(tab)}
            className="py-2.5 mr-5 text-[10px] font-black uppercase tracking-widest border-b-2 -mb-px flex items-center gap-1.5 transition-all"
            style={modalTab === tab ? { color: '#4f46e5', borderColor: '#4f46e5' } : { color: '#94a3b8', borderColor: 'transparent' }}>
            {tab === 'attendance' ? 'Attendance' : tab === 'confirmation' ? 'Confirmation' : 'Notes'}
            {tab === 'notes' && student.notes && <span className="w-1.5 h-1.5 rounded-full bg-[#4f46e5]" />}
          </button>
        ))}
      </div>

      {/* BODY */}
      <div className="flex-1 overflow-y-auto">
        {modalTab === 'attendance' && (
          <div className="p-5 space-y-4">

            {/* ATTENDANCE */}
            <div>
              <p className="text-[9px] font-black text-[#94a3b8] uppercase tracking-widest mb-2">Attendance</p>
              <div className="grid grid-cols-3 gap-2">
                {(['present', 'no-show', 'scheduled'] as const).map(status => {
                  const cfg = attendanceCfg[status];
                  const active = currentStatus === status;
                  return (
                    <button key={status} onClick={() => handleAttendance(status)}
                      className="py-2 rounded-lg text-[11px] font-bold transition-all active:scale-[0.98]"
                      style={active
                        ? { background: cfg.active.bg, border: `1.5px solid ${cfg.active.border}`, color: cfg.active.text }
                        : { background: '#f8fafc', border: '1.5px solid #e2e8f0', color: '#94a3b8' }}>
                      {cfg.label}
                    </button>
                  );
                })}
              </div>
            </div>

            {/* CONTACT */}
            <div>
              <p className="text-[9px] font-black text-[#94a3b8] uppercase tracking-widest mb-2">Contact</p>
              <div className="rounded-xl overflow-hidden" style={{ border: '1px solid #e2e8f0', background: '#fafafa' }}>

                {/* Bluebook */}
                <div className="px-3 pt-3 pb-2">
                  <p className="text-[9px] font-bold text-[#94a3b8] uppercase tracking-wider mb-1.5">Bluebook</p>
                  {cr?.bluebook_url ? (
                    <div className="flex items-center gap-2 px-2.5 py-2 rounded-lg" style={{ background: '#f0fdf4', border: '1px solid #bbf7d0' }}>
                      <ExternalLink size={11} style={{ color: '#16a34a' }} className="shrink-0" />
                      <a href={cr.bluebook_url} target="_blank" rel="noopener noreferrer"
                        className="flex-1 text-[12px] font-semibold truncate" style={{ color: '#15803d', textDecoration: 'none' }}>
                        Open in SharePoint
                      </a>
                      <CopyBtn value={cr.bluebook_url} />
                    </div>
                  ) : (
                    <div className="px-2.5 py-2 rounded-lg text-[12px] text-[#94a3b8]" style={{ background: '#f1f5f9', border: '1px solid #e2e8f0' }}>
                      No link on file
                    </div>
                  )}
                </div>

                <div style={{ height: 1, background: '#f1f5f9', margin: '0 12px' }} />

                {/* Student */}
                <div className="px-3 pt-2 pb-2">
                  <p className="text-[9px] font-bold text-[#94a3b8] uppercase tracking-wider mb-1.5 flex items-center gap-1"><User size={8} /> Student</p>
                  <div className="space-y-1">
                    {cr?.email && <ContactRow href={`mailto:${cr.email}`} icon={<Mail size={11} />} label={cr.email} copyValue={cr.email} />}
                    {cr?.phone && <ContactRow href={`tel:${cr.phone}`} icon={<Phone size={11} />} label={cr.phone} copyValue={cr.phone} />}
                    {!cr?.email && !cr?.phone && (
                      <div className="px-2.5 py-2 rounded-lg text-[12px] text-[#94a3b8]" style={{ background: '#f1f5f9', border: '1px solid #e2e8f0' }}>No student contact on file</div>
                    )}
                  </div>
                </div>

                <div style={{ height: 1, background: '#f1f5f9', margin: '0 12px' }} />

                {/* Parent */}
                <div className="px-3 pt-2 pb-3">
                  <p className="text-[9px] font-bold text-[#94a3b8] uppercase tracking-wider mb-1.5">Parent / Guardian</p>
                  <div className="space-y-1">
                    {(cr?.mom_name || cr?.mom_email || cr?.mom_phone) && (
                      <div className="border-l-2 border-[#f59e0b] pl-2.5 py-1.5">
                        <p className="text-[8px] font-bold text-[#f59e0b] uppercase tracking-wider mb-1">Mother</p>
                        <div className="space-y-1">
                          {cr?.mom_name && (
                            <div className="flex items-center gap-2.5 px-2.5 py-2 rounded-lg" style={{ background: 'rgba(255,255,255,0.6)', border: '1px solid rgba(203,213,225,0.5)' }}>
                              <User size={11} style={{ color: '#94a3b8' }} className="shrink-0" />
                              <span className="flex-1 text-[12.5px] font-medium text-[#1e293b]">{cr.mom_name}</span>
                              <CopyBtn value={cr.mom_name} />
                            </div>
                          )}
                          {cr?.mom_email && <ContactRow href={`mailto:${cr.mom_email}`} icon={<Mail size={11} />} label={cr.mom_email} copyValue={cr.mom_email} />}
                          {cr?.mom_phone && <ContactRow href={`tel:${cr.mom_phone}`} icon={<Phone size={11} />} label={cr.mom_phone} copyValue={cr.mom_phone} />}
                        </div>
                      </div>
                    )}
                    {(cr?.dad_name || cr?.dad_email || cr?.dad_phone) && (
                      <div className="border-l-2 border-[#3b82f6] pl-2.5 py-1.5">
                        <p className="text-[8px] font-bold text-[#3b82f6] uppercase tracking-wider mb-1">Father</p>
                        <div className="space-y-1">
                          {cr?.dad_name && (
                            <div className="flex items-center gap-2.5 px-2.5 py-2 rounded-lg" style={{ background: 'rgba(255,255,255,0.6)', border: '1px solid rgba(203,213,225,0.5)' }}>
                              <User size={11} style={{ color: '#94a3b8' }} className="shrink-0" />
                              <span className="flex-1 text-[12.5px] font-medium text-[#1e293b]">{cr.dad_name}</span>
                              <CopyBtn value={cr.dad_name} />
                            </div>
                          )}
                          {cr?.dad_email && <ContactRow href={`mailto:${cr.dad_email}`} icon={<Mail size={11} />} label={cr.dad_email} copyValue={cr.dad_email} />}
                          {cr?.dad_phone && <ContactRow href={`tel:${cr.dad_phone}`} icon={<Phone size={11} />} label={cr.dad_phone} copyValue={cr.dad_phone} />}
                        </div>
                      </div>
                    )}
                    {cr?.parent_name && (
                      <div className="flex items-center gap-2.5 px-2.5 py-2 rounded-lg" style={{ background: 'rgba(255,255,255,0.6)', border: '1px solid rgba(203,213,225,0.5)' }}>
                        <User size={11} style={{ color: '#94a3b8' }} className="shrink-0" />
                        <span className="flex-1 text-[12.5px] font-medium text-[#1e293b]">{cr.parent_name}</span>
                        <CopyBtn value={cr.parent_name} />
                      </div>
                    )}
                    {cr?.parent_email && <ContactRow href={`mailto:${cr.parent_email}`} icon={<Mail size={11} />} label={cr.parent_email} copyValue={cr.parent_email} />}
                    {cr?.parent_phone && <ContactRow href={`tel:${cr.parent_phone}`} icon={<Phone size={11} />} label={cr.parent_phone} copyValue={cr.parent_phone} />}
                    {!cr?.mom_name && !cr?.mom_email && !cr?.mom_phone && !cr?.dad_name && !cr?.dad_email && !cr?.dad_phone && !cr?.parent_name && !cr?.parent_email && !cr?.parent_phone && (
                      <div className="px-2.5 py-2 rounded-lg text-[12px] text-[#94a3b8]" style={{ background: '#f1f5f9', border: '1px solid #e2e8f0' }}>No parent contact on file</div>
                    )}
                  </div>
                </div>
              </div>
            </div>

            {/* REASSIGN */}
            {altTutors.length > 0 && (
              <div>
                <p className="text-[9px] font-black text-[#94a3b8] uppercase tracking-widest mb-2">Reassign to</p>
                <div className="space-y-1.5">
                  {altTutors.map(t => {
                    const alt = sessions.find(ss => ss.date === s.date && ss.tutorId === t.id && ss.time === sessionTime);
                    const used = alt ? alt.students.length : 0;
                    return (
                      <div key={t.id} className="flex items-center justify-between px-3 py-2.5 rounded-xl"
                        style={{ background: '#f8fafc', border: '1px solid #e2e8f0' }}>
                        <div className="flex items-center gap-2.5">
                          <div className="w-7 h-7 rounded-lg bg-[#eef2ff] text-[#4f46e5] flex items-center justify-center text-xs font-black">
                            {t.name.charAt(0)}
                          </div>
                          <div>
                            <p className="text-[13px] font-bold text-[#1e293b]">{t.name}</p>
                            <p className="text-[10px] text-[#94a3b8]">{used}/{MAX_CAPACITY} students</p>
                          </div>
                        </div>
                        <button onClick={() => handleReassign(t)}
                          className="px-3 py-1.5 rounded-lg text-[11px] font-bold text-white transition-all active:scale-95"
                          style={{ background: '#1e293b' }}>
                          Move
                        </button>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}

            {/* REMOVE */}
            <button onClick={handleRemove}
              className="w-full py-2 rounded-xl text-[11px] font-bold uppercase tracking-wider flex items-center justify-center gap-2 transition-all"
              style={{ border: '1px dashed #fca5a5', color: '#ef4444', background: 'transparent' }}
              onMouseEnter={e => { (e.currentTarget as HTMLElement).style.background = '#fff1f2'; }}
              onMouseLeave={e => { (e.currentTarget as HTMLElement).style.background = 'transparent'; }}>
              <UserX size={12} strokeWidth={2} /> Remove from Session
            </button>
          </div>
        )}

        {/* CONFIRMATION TAB */}
        {modalTab === 'confirmation' && (
          <div className="p-5 space-y-4">
            <div>
              <p className="text-[9px] font-black text-[#94a3b8] uppercase tracking-widest mb-2">Confirmation</p>
              <div className="grid grid-cols-2 gap-2">
                {([
                  { val: 'confirmed' as const, label: 'Confirmed', icon: <CheckCircle2 size={12} />, activeColor: '#16a34a', activeBg: '#f0fdf4', activeBorder: '#16a34a' },
                  { val: null, label: 'Not yet', icon: <Clock size={12} />, activeColor: '#be123c', activeBg: '#fff1f2', activeBorder: '#f43f5e' },
                ]).map(({ val, label, icon, activeColor, activeBg, activeBorder }) => {
                  const active = currentConf === val;
                  return (
                    <button key={String(val)} onClick={() => handleConfirmation(val)}
                      className="py-2 rounded-lg text-[11px] font-bold flex items-center justify-center gap-1.5 transition-all active:scale-[0.98]"
                      style={active
                        ? { background: activeBg, border: `1.5px solid ${activeBorder}`, color: activeColor }
                        : { background: '#f8fafc', border: '1.5px solid #e2e8f0', color: '#94a3b8' }}>
                      {icon}{label}
                    </button>
                  );
                })}
              </div>
            </div>
          </div>
        )}

        {/* NOTES TAB */}
        {modalTab === 'notes' && (
          <div className="p-5">
            <div className="flex items-center justify-between mb-3">
              <p className="text-[9px] font-black text-[#94a3b8] uppercase tracking-widest">Session Notes</p>
              <div className="flex items-center gap-2">
                {notesEditing ? (
                  <>
                    <button onClick={() => { setNotesDraft(student.notes ?? ''); setNotesEditing(false); }}
                      className="px-3 py-1.5 rounded-lg text-[11px] font-bold text-[#64748b]" style={{ background: '#f1f5f9' }}>
                      Cancel
                    </button>
                    <button onClick={handleSaveNotes} disabled={notesSaving}
                      className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[11px] font-black text-white disabled:opacity-40"
                      style={{ background: '#1e293b' }}>
                      {notesSaving ? <Loader2 size={11} className="animate-spin" /> : <Save size={11} />} Save
                    </button>
                  </>
                ) : (
                  <button onClick={() => setNotesEditing(true)}
                    className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[11px] font-bold"
                    style={{ background: '#eef2ff', color: '#4f46e5' }}>
                    <FileText size={11} /> Edit
                  </button>
                )}
              </div>
            </div>
            {notesEditing ? (
              <textarea value={notesDraft} onChange={e => setNotesDraft(e.target.value)}
                placeholder="Add session notes…" autoFocus rows={8}
                className="w-full px-4 py-3 text-sm rounded-xl resize-none outline-none"
                style={{ background: 'white', border: '1.5px solid #4f46e5', color: '#1e293b', fontFamily: 'inherit', lineHeight: 1.6 }} />
            ) : (
              <div onClick={() => setNotesEditing(true)}
                className="px-4 py-3 rounded-xl cursor-text min-h-40 transition-all"
                style={{ background: '#f8fafc', border: '1px solid #e2e8f0' }}
                onMouseEnter={e => { (e.currentTarget as HTMLElement).style.borderColor = '#cbd5e1'; }}
                onMouseLeave={e => { (e.currentTarget as HTMLElement).style.borderColor = '#e2e8f0'; }}>
                {student.notes
                  ? <p className="text-sm text-[#1e293b] whitespace-pre-wrap leading-relaxed">{student.notes}</p>
                  : <p className="text-sm text-[#cbd5e1] italic">No notes yet — click to add</p>}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

export function AttendanceModal(props: AttendanceModalProps) {
  const { selectedSession, setSelectedSession } = props;
  if (!selectedSession) return null;

  const s = selectedSession;
  const student = s.activeStudent;
  const sessionTime = s.time ?? s.block?.time;
  const sessionDow = dayOfWeek(s.date);
  const originalTutor = props.tutors.find(t => t.id === s.tutorId);
  const studentId = student?.id ?? student?.student_id ?? student?.studentId ?? null;
  const studentName = student?.name?.trim?.().toLowerCase?.();
  const studentRecord = props.students.find(st =>
    (studentId != null && String(st.id) === String(studentId)) ||
    (studentName && String(st.name ?? '').trim().toLowerCase() === studentName)
  );
  
  // Construct parent info — only use explicit parent_* fields, NOT mom/dad fallbacks
  const parentName = studentRecord?.parent_name ?? studentRecord?.parentName ?? 
    student?.parent_name ?? student?.parentName ?? null;
  
  const parentEmail = studentRecord?.parent_email ?? studentRecord?.parentEmail ?? 
    student?.parent_email ?? student?.parentEmail ?? null;
  
  const parentPhone = studentRecord?.parent_phone ?? studentRecord?.parentPhone ?? 
    student?.parent_phone ?? student?.parentPhone ?? null;
  
  const contactInfo = {
    email: studentRecord?.email ?? studentRecord?.student_email ?? student?.email ?? student?.student_email ?? null,
    phone: studentRecord?.phone ?? studentRecord?.student_phone ?? student?.phone ?? student?.student_phone ?? null,
    bluebook_url: studentRecord?.bluebook_url ?? studentRecord?.bluebookUrl ?? student?.bluebook_url ?? student?.bluebookUrl ?? null,
    parent_name: parentName,
    parent_email: parentEmail,
    parent_phone: parentPhone,
    mom_name: studentRecord?.mom_name ?? student?.mom_name ?? null,
    mom_email: studentRecord?.mom_email ?? student?.mom_email ?? null,
    mom_phone: studentRecord?.mom_phone ?? student?.mom_phone ?? null,
    dad_name: studentRecord?.dad_name ?? student?.dad_name ?? null,
    dad_email: studentRecord?.dad_email ?? student?.dad_email ?? null,
    dad_phone: studentRecord?.dad_phone ?? student?.dad_phone ?? null,
  };

  const altTutors = props.tutors.filter(t => {
    if (t.id === s.tutorId) return false;
    if (t.cat !== originalTutor?.cat) return false;
    if (!t.availability.includes(sessionDow)) return false;
    if (!isTutorAvailable(t, sessionDow, sessionTime)) return false;
    const alt = props.sessions.find(ss => ss.date === s.date && ss.tutorId === t.id && ss.time === sessionTime);
    if (alt && alt.students.length >= MAX_CAPACITY) return false;
    return true;
  });

  const hasContactInfo = !!(
    contactInfo?.email || contactInfo?.phone || contactInfo?.bluebook_url ||
    contactInfo?.parent_name || contactInfo?.parent_email || contactInfo?.parent_phone
  );

  const contentProps: ModalContentProps = {
    ...props, s, student, studentRecord: contactInfo, altTutors, hasContactInfo, sessionTime,
  };

  return (
    <div className="fixed inset-0 z-50" style={{ background: 'rgba(15,23,42,0.45)', backdropFilter: 'blur(8px)' }}>
      <div className="hidden md:flex items-center justify-center h-full p-6">
        <div className="w-full rounded-2xl overflow-hidden flex flex-col"
          style={{ maxWidth: 440, maxHeight: 'min(680px, 92vh)', background: 'rgba(255,255,255,0.92)', backdropFilter: 'blur(20px)', border: '1px solid rgba(255,255,255,0.8)', boxShadow: '0 24px 48px rgba(0,0,0,0.18), 0 0 0 1px rgba(255,255,255,0.5)' }}>
          <ModalContent {...contentProps} />
        </div>
      </div>
      <div className="md:hidden flex flex-col h-full">
        <div className="flex-1" onClick={() => setSelectedSession(null)} />
        <div className="rounded-t-2xl flex flex-col" style={{ maxHeight: '92vh', background: 'rgba(255,255,255,0.95)', backdropFilter: 'blur(20px)', border: '1px solid rgba(255,255,255,0.8)', boxShadow: '0 -8px 32px rgba(0,0,0,0.12)' }}>
          <div className="flex justify-center pt-3 pb-1 shrink-0">
            <div className="w-8 h-1 rounded-full bg-[#e2e8f0]" />
          </div>
          <ModalContent {...contentProps} />
        </div>
      </div>
    </div>
  );
}