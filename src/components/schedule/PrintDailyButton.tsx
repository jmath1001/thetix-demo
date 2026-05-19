'use client';

import React from 'react';
import { Printer } from 'lucide-react';
import type { Tutor } from '@/lib/useScheduleData';

interface PrintDailyButtonProps {
  todayIso: string;
  dayLabel: string;
  todayStudentCount: number;
  filteredDaySessions: any[];
  filteredTodayTutors: Tutor[];
  todaySessionByTutorTime: Map<string, any>;
}

export function PrintDailyButton({
  todayIso,
  dayLabel,
  todayStudentCount,
  filteredDaySessions,
  filteredTodayTutors,
  todaySessionByTutorTime,
}: PrintDailyButtonProps) {
  
  const handlePrint = () => {
    const printWindow = window.open('', '_blank');
    if (!printWindow) {
      alert('Please allow popups to print the daily sheet.');
      return;
    }

    let rowsHtml = '';
    
    filteredDaySessions.forEach(block => {
      filteredTodayTutors.forEach(tutor => {
        const session = todaySessionByTutorTime.get(`${tutor.id}|${block.time}`);
        const activeStudents = (session?.students ?? []).filter((st: any) => st.status !== 'cancelled');
        
        if (activeStudents.length > 0) {
          const studentNames = activeStudents.map((st: any) => st.name).join(', ');
          const topicsAndNotes = activeStudents
            .map((st: any) => `${st.topic || 'No Topic'}${st.notes ? ` (${st.notes})` : ''}`)
            .join('; ');

          rowsHtml += `
            <tr style="border-bottom: 1px solid #e2e8f0; font-size: 13px; color: #1e293b;">
              <td style="padding: 10px 12px; font-weight: 700; color: #0f172a;">${block.label}</td>
              <td style="padding: 10px 12px; font-weight: 500;">${tutor.name}</td>
              <td style="padding: 10px 12px; font-weight: 600; color: #4338ca;">${studentNames}</td>
              <td style="padding: 10px 12px; color: #475569; font-style: ${topicsAndNotes ? 'normal' : 'italic'};">
                ${topicsAndNotes || 'None'}
              </td>
            </tr>
          `;
        }
      });
    });

    printWindow.document.write(`
      <html>
        <head>
          <title>Daily Roster - ${todayIso}</title>
          <style>
            body { font-family: system-ui, -apple-system, sans-serif; margin: 40px; color: #334155; background: #fff; }
            .header { margin-bottom: 24px; border-bottom: 2px solid #0f172a; padding-bottom: 12px; }
            table { width: 100%; border-collapse: collapse; text-align: left; }
            th { padding: 10px 12px; background-color: #f8fafc; border-bottom: 2px solid #cbd5e1; color: #64748b; font-size: 11px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.05em; }
            @media print {
              body { margin: 20px; }
              tr { page-break-inside: avoid; }
            }
          </style>
        </head>
        <body>
          <div class="header">
            <h1 style="margin: 0 0 6px 0; font-size: 22px; font-weight: 800; color: #0f172a;">Daily Schedule Sheet</h1>
            <div style="font-size: 13px; color: #64748b; font-weight: 500;">
              <strong>Date:</strong> ${todayIso} (${dayLabel}) &middot; 
              <strong>Total Active Students:</strong> ${todayStudentCount}
            </div>
          </div>
          <table>
            <thead>
              <tr>
                <th style="width: 15%;">Time Slot</th>
                <th style="width: 25%;">Tutor</th>
                <th style="width: 30%;">Student(s)</th>
                <th style="width: 30%;">Topic / Notes</th>
              </tr>
            </thead>
            <tbody>
              ${rowsHtml || '<tr><td colspan="4" style="padding: 24px; text-align: center; color: #94a3b8; font-size: 14px;">No active sessions scheduled for this day.</td></tr>'}
            </tbody>
          </table>
          <script>
            window.onload = function() {
              window.print();
              setTimeout(function() { window.close(); }, 300);
            };
          </script>
        </body>
      </html>
    `);

    printWindow.document.close();
  };

  return (
    <button
      onClick={handlePrint}
      className="flex items-center gap-1.5 px-3 py-1.5 bg-slate-900 text-white rounded-lg text-xs font-bold hover:bg-slate-800 transition-colors shadow-sm"
    >
      <Printer size={13} />
      Print Sheet
    </button>
  );
}