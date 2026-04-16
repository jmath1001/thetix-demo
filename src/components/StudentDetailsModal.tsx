interface StudentDetailsModalProps {
  student: any;
  onClose: () => void;
}

export default function StudentDetailsModal({ student, onClose }: StudentDetailsModalProps) {
  return (
    <div className="fixed inset-0 bg-black bg-opacity-30 flex items-center justify-center z-50"
      onClick={e => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="bg-white p-6 rounded shadow-lg w-80" onClick={e => e.stopPropagation()}>
        <h2 className="text-lg font-bold mb-4">{student.name}</h2>
        <p><strong>Subject:</strong> {student.subject}</p>
        <p><strong>Hours Left:</strong> {student.hoursLeft}</p>
        {student.tutor && <p><strong>Tutor:</strong> {student.tutor}</p>}
        {student.day && <p><strong>Day:</strong> {student.day}</p>}
        {student.time && <p><strong>Time:</strong> {student.time}</p>}

        <div className="flex justify-end mt-4">
          <button onClick={onClose} className="px-4 py-2 bg-gray-200 rounded">
            Close
          </button>
        </div>
      </div>
    </div>
  );
}
