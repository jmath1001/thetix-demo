"use client"
import { X, UserX } from 'lucide-react';
import {
  bookStudent,
  removeStudentFromSession,
  updateAttendance,
  formatDate,
  dayOfWeek,
  type Tutor,
} from '@/lib/useScheduleData';
import { MAX_CAPACITY } from '@/components/constants';
import { isTutorAvailable } from './scheduleUtils';
import { NotesEditor } from './NotesEditor';

interface AttendanceModalProps {
  selectedSession: any;
  setSelectedSession: (s: any) => void;
  modalTab: 'session' | 'notes' | 'contact';
  setModalTab: (t: 'session' | 'notes' | 'contact') => void;
  tutors: Tutor[];
  students: any[];
  sessions: any[];
  refetch: () => void;
}

export function AttendanceModal({
  selectedSession,
  setSelectedSession,
  modalTab,
  setModalTab,
  tutors,
  students,
  sessions,
  refetch,
}: AttendanceModalProps) {
  if (!selectedSession) return null;

  const s = selectedSession;
  const student = s.activeStudent;
  const sessionDow = dayOfWeek(s.date);
  const sessionTime = s.time ?? s.block?.time;
  const originalTutor = tutors.find(t => t.id === s.tutorId);
  const studentRecord = students.find(st => st.id === student.id);

  const altTutors = tutors.filter(t => {
    if (t.id === s.tutorId) return false;
    if (t.cat !== originalTutor?.cat) return false;
    if (!t.availability.includes(sessionDow)) return false;
    if (!isTutorAvailable(t, sessionDow, sessionTime)) return false;
    const altSession = sessions.find(ss => ss.date === s.date && ss.tutorId === t.id && ss.time === sessionTime);
    if (altSession && altSession.students.length >= MAX_CAPACITY) return false;
    return true;
  });

  const currentStatus = student.status;

  const handleAttendance = async (status: 'scheduled' | 'present' | 'no-show') => {
    try {
      await updateAttendance({ sessionId: s.id, studentId: student.id, status });
      refetch();
      setSelectedSession(null);
    } catch (err) { console.error(err); }
  };

  const handleRemove = async () => {
    try {
      await removeStudentFromSession({ sessionId: s.id, studentId: student.id });
      refetch();
      setSelectedSession(null);
    } catch (err) { console.error(err); }
  };

  const handleReassign = async (newTutor: Tutor) => {
    try {
      await removeStudentFromSession({ sessionId: s.id, studentId: student.id });
      const studentObj = students.find(st => st.id === student.id) ?? {
        id: student.id, name: student.name, subject: student.topic,
        grade: student.grade ?? null, hoursLeft: 0, availabilityBlocks: [],
        email: null, phone: null, parent_name: null, parent_email: null,
        parent_phone: null, bluebook_url: null,
      };
      await bookStudent({ tutorId: newTutor.id, date: s.date, time: sessionTime, student: studentObj, topic: student.topic });
      refetch();
      setSelectedSession(null);
    } catch (err: any) {
      alert(err.message || 'Reassignment failed');
    }
  };

  const tab = modalTab;
  const setTab = (t: 'session' | 'notes' | 'contact') => setModalTab(t);

  const ModalInner = () => (
    <>
      {/* Header */}
      <div className="p-4 bg-[#faf9f7] border-b border-[#e7e3dd] flex items-center justify-between shrink-0">
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 rounded-full bg-[#ede9fe] flex items-center justify-center text-sm font-black text-[#6d28d9] shrink-0">
            {student.name.charAt(0)}
          </div>
          <div>
            <p className="text-sm font-black text-[#1c1917] leading-tight">{student.name}</p>
            <p className="text-[10px] text-[#a8a29e] font-medium">{student.grade ? `Gr.${student.grade} · ` : ''}{student.topic}</p>
          </div>
        </div>
        <button onClick={() => setSelectedSession(null)} className="w-8 h-8 flex items-center justify-center rounded-full bg-white border border-[#e7e3dd] text-[#78716c] shrink-0">
          <X size={15} />
        </button>
      </div>

      {/* Session info strip */}
      <div className="px-4 py-2 bg-white border-b border-[#f0ece8] flex items-center gap-1.5 flex-wrap shrink-0">
        <span className="text-[10px] font-black px-2 py-0.5 rounded-md bg-[#1c1917] text-white uppercase tracking-wider">{s.dayName}</span>
        <span className="text-[10px] text-[#78716c]">{formatDate(s.date)}</span>
        <span className="text-[#d4cfc9]">·</span>
        <span className="text-[10px] text-[#78716c]">{s.block?.label ?? sessionTime}</span>
        <span className="text-[#d4cfc9]">·</span>
        <span className="text-[10px] font-semibold text-[#6d28d9]">{s.tutorName}</span>
        {student.confirmationStatus && student.confirmationStatus !== 'pending' && (
          <>
            <span className="text-[#d4cfc9]">·</span>
            <span className="text-[9px] font-black px-2 py-0.5 rounded-lg"
              style={{
                background: student.confirmationStatus === 'confirmed' ? '#dcfce7' : student.confirmationStatus === 'cancelled' ? '#fee2e2' : '#ede9fe',
                color: student.confirmationStatus === 'confirmed' ? '#15803d' : student.confirmationStatus === 'cancelled' ? '#dc2626' : '#6d28d9',
              }}>
              {student.confirmationStatus === 'confirmed' ? '✓ Confirmed' : student.confirmationStatus === 'cancelled' ? '✕ Cancelled' : '↗ Reschedule Requested'}
            </span>
          </>
        )}
      </div>

      {/* Tabs */}
      <div className="flex border-b border-[#f0ece8] px-4 shrink-0 bg-white">
        {([
          { key: 'session', label: 'Session' },
          { key: 'notes', label: 'Notes' },
          { key: 'contact', label: 'Contact' },
        ] as const).map(t => (
          <button key={t.key} onClick={() => setTab(t.key)}
            className="px-3 py-2.5 text-[10px] font-black uppercase tracking-widest transition-all border-b-2 -mb-px"
            style={tab === t.key ? { color: '#6d28d9', borderColor: '#6d28d9' } : { color: '#a8a29e', borderColor: 'transparent' }}>
            {t.label}
          </button>
        ))}
      </div>

      {/* Tab content */}
      <div className="overflow-y-auto flex-1">

        {/* SESSION TAB */}
        {tab === 'session' && (
          <>
            <div className="p-4 border-b border-[#f0ece8]">
              <p className="text-[9px] font-black text-[#a8a29e] uppercase tracking-widest mb-2">Attendance</p>
              <div className="flex gap-2 mb-2">
                {([
                  { status: 'present', label: 'Present', activeStyle: { background: '#dcfce7', borderColor: '#16a34a', color: '#15803d' } },
                  { status: 'no-show', label: 'No-show', activeStyle: { background: '#fee2e2', borderColor: '#dc2626', color: '#b91c1c' } },
                  { status: 'scheduled', label: 'Scheduled', activeStyle: { background: '#fef3c7', borderColor: '#f59e0b', color: '#b45309' } },
                ] as const).map(({ status, label, activeStyle }) => (
                  <button key={status} onClick={() => handleAttendance(status)}
                    className="flex-1 py-2.5 rounded-xl font-black text-[10px] uppercase tracking-wider transition-all active:scale-95 border-2"
                    style={currentStatus === status ? activeStyle : { background: 'white', borderColor: '#e7e3dd', color: '#a8a29e' }}>
                    {label}
                  </button>
                ))}
              </div>
              <button onClick={handleRemove}
                className="w-full flex items-center justify-center gap-2 py-2.5 rounded-xl text-xs font-bold uppercase tracking-wider border border-dashed border-[#fca5a5] text-[#ef4444] hover:bg-[#fff1f1] transition-all">
                <UserX size={12} strokeWidth={2} /> Remove from Session
              </button>
            </div>
            {altTutors.length > 0 && (
              <div className="p-4">
                <p className="text-[9px] font-black text-[#a8a29e] uppercase tracking-widest mb-2">Reassign to</p>
                <div className="space-y-2">
                  {altTutors.map(t => {
                    const altSession = sessions.find(ss => ss.date === s.date && ss.tutorId === t.id && ss.time === sessionTime);
                    const spotsUsed = altSession ? altSession.students.length : 0;
                    return (
                      <div key={t.id} className="flex items-center justify-between p-3 rounded-xl border-2 border-[#f0ece8] hover:border-[#c4b5fd] hover:bg-[#faf9ff] transition-all">
                        <div className="flex items-center gap-2.5">
                          <div className="w-7 h-7 rounded-full bg-[#ede9fe] flex items-center justify-center text-xs font-black text-[#6d28d9]">
                            {t.name.charAt(0)}
                          </div>
                          <div>
                            <p className="text-xs font-bold text-[#1c1917]">{t.name}</p>
                            <p className="text-[9px] text-[#a8a29e] uppercase">{spotsUsed}/{MAX_CAPACITY} spots</p>
                          </div>
                        </div>
                        <button onClick={() => handleReassign(t)}
                          className="px-3 py-1.5 rounded-lg text-[10px] font-black uppercase tracking-wider text-white bg-[#6d28d9] hover:bg-[#5b21b6] transition-all active:scale-95">
                          Move
                        </button>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}
          </>
        )}

        {/* NOTES TAB */}
        {tab === 'notes' && (
          <div className="p-4">
            <NotesEditor rowId={student.rowId} initialNotes={student.notes ?? ''} onSaved={refetch} />
          </div>
        )}

        {/* CONTACT TAB */}
        {tab === 'contact' && (
          <div className="p-4 space-y-4">
            {studentRecord?.bluebook_url ? (
              <a href={studentRecord.bluebook_url} target="_blank" rel="noopener noreferrer"
                className="flex items-center justify-between w-full px-4 py-3 rounded-xl border-2 border-[#bbf7d0] bg-[#f0fdf4] hover:bg-[#dcfce7] transition-all">
                <div className="flex items-center gap-2.5">
                  <div className="w-8 h-8 rounded-lg bg-[#16a34a] flex items-center justify-center text-white text-[10px] font-black">XL</div>
                  <div>
                    <p className="text-xs font-black text-[#15803d]">Bluebook</p>
                    <p className="text-[9px] text-[#16a34a]">Open in SharePoint →</p>
                  </div>
                </div>
              </a>
            ) : (
              <div className="px-4 py-3 rounded-xl border border-dashed border-[#e7e3dd] text-center">
                <p className="text-xs text-[#a8a29e] italic">No Bluebook linked</p>
                <p className="text-[9px] text-[#c4bfba] mt-0.5">Add URL in Student Directory</p>
              </div>
            )}

            <div>
              <p className="text-[9px] font-black text-[#a8a29e] uppercase tracking-widest mb-2">Student</p>
              <div className="space-y-2">
                {studentRecord?.email && (
                  <a href={`mailto:${studentRecord.email}`} className="flex items-center gap-2.5 px-3 py-2.5 rounded-xl bg-[#f7f4ef] hover:bg-[#f0ece8] transition-all">
                    <span className="text-[9px] font-black text-[#a8a29e] uppercase w-12 shrink-0">Email</span>
                    <span className="text-sm text-[#1c1917] truncate">{studentRecord.email}</span>
                  </a>
                )}
                {studentRecord?.phone && (
                  <a href={`tel:${studentRecord.phone}`} className="flex items-center gap-2.5 px-3 py-2.5 rounded-xl bg-[#f7f4ef] hover:bg-[#f0ece8] transition-all">
                    <span className="text-[9px] font-black text-[#a8a29e] uppercase w-12 shrink-0">Phone</span>
                    <span className="text-sm text-[#1c1917]">{studentRecord.phone}</span>
                  </a>
                )}
                {!studentRecord?.email && !studentRecord?.phone && (
                  <p className="text-xs text-[#c4bfba] italic px-1">No contact info</p>
                )}
              </div>
            </div>

            {(studentRecord?.parent_name || studentRecord?.parent_email || studentRecord?.parent_phone) && (
              <div>
                <p className="text-[9px] font-black text-[#a8a29e] uppercase tracking-widest mb-2">Parent / Guardian</p>
                <div className="space-y-2">
                  {studentRecord?.parent_name && (
                    <div className="flex items-center gap-2.5 px-3 py-2.5 rounded-xl bg-[#f7f4ef]">
                      <span className="text-[9px] font-black text-[#a8a29e] uppercase w-12 shrink-0">Name</span>
                      <span className="text-sm text-[#1c1917]">{studentRecord.parent_name}</span>
                    </div>
                  )}
                  {studentRecord?.parent_email && (
                    <a href={`mailto:${studentRecord.parent_email}`} className="flex items-center gap-2.5 px-3 py-2.5 rounded-xl bg-[#f7f4ef] hover:bg-[#f0ece8] transition-all">
                      <span className="text-[9px] font-black text-[#a8a29e] uppercase w-12 shrink-0">Email</span>
                      <span className="text-sm text-[#1c1917] truncate">{studentRecord.parent_email}</span>
                    </a>
                  )}
                  {studentRecord?.parent_phone && (
                    <a href={`tel:${studentRecord.parent_phone}`} className="flex items-center gap-2.5 px-3 py-2.5 rounded-xl bg-[#f7f4ef] hover:bg-[#f0ece8] transition-all">
                      <span className="text-[9px] font-black text-[#a8a29e] uppercase w-12 shrink-0">Phone</span>
                      <span className="text-sm text-[#1c1917]">{studentRecord.parent_phone}</span>
                    </a>
                  )}
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </>
  );

  return (
    <div className="fixed inset-0 z-50" style={{ background: 'rgba(28,16,8,0.7)', backdropFilter: 'blur(8px)' }}>
      <div className="hidden md:flex items-center justify-center h-full p-4">
        <div className="w-full max-w-md bg-white rounded-2xl overflow-hidden border border-[#e7e3dd] shadow-2xl flex flex-col" style={{ maxHeight: 'min(600px, 90vh)' }}>
          <ModalInner />
        </div>
      </div>
      <div className="md:hidden flex flex-col h-full">
        <div className="flex-1" onClick={() => setSelectedSession(null)} />
        <div className="bg-white rounded-t-2xl border-t border-[#e7e3dd] shadow-2xl flex flex-col" style={{ maxHeight: '85vh' }}>
          <div className="flex justify-center pt-3 pb-1 shrink-0">
            <div className="w-10 h-1 rounded-full bg-[#e7e3dd]" />
          </div>
          <ModalInner />
        </div>
      </div>
    </div>
  );
}