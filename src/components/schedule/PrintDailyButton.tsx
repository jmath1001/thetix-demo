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

    // Build sections grouped by time block
    let sectionsHtml = '';
    let hasAnySessions = false;

    filteredDaySessions.forEach(block => {
      // Collect all tutors that have active students in this block
      const tutorBlocks: Array<{ tutor: Tutor; students: any[] }> = [];
      filteredTodayTutors.forEach(tutor => {
        const session = todaySessionByTutorTime.get(`${tutor.id}|${block.time}`);
        const activeStudents = (session?.students ?? []).filter((st: any) => st.status !== 'cancelled');
        if (activeStudents.length > 0) {
          tutorBlocks.push({ tutor, students: activeStudents });
        }
      });

      if (tutorBlocks.length === 0) return;
      hasAnySessions = true;

      const totalInBlock = tutorBlocks.reduce((sum, tb) => sum + tb.students.length, 0);

      // Dark session header — mirrors the app's dark thead
      sectionsHtml += `
        <div class="session-block">
          <div class="session-header">
            <div class="session-header-left">
              <span class="session-label">${block.label}</span>
              <span class="session-time">${block.display ?? block.time}</span>
            </div>
            <span class="session-count">${totalInBlock} student${totalInBlock !== 1 ? 's' : ''}</span>
          </div>

          <table class="session-table">
            <thead>
              <tr>
                <th class="col-tutor">Tutor</th>
                <th class="col-student">Student</th>
                <th class="col-subject">Subject</th>
                <th class="col-sig">Signature</th>
              </tr>
            </thead>
            <tbody>
      `;

      tutorBlocks.forEach(({ tutor, students }, ti) => {
        const initials = tutor.name.split(' ').map((n: string) => n[0]).join('').slice(0, 2).toUpperCase();
        const isLast = ti === tutorBlocks.length - 1;

        students.forEach((st: any, si: number) => {
          const isFirstRow = si === 0;
          const isLastStudentInTutor = si === students.length - 1;
          const tutorCell = isFirstRow
            ? `<td class="col-tutor tutor-cell" rowspan="${students.length}" style="border-bottom: ${isLast ? 'none' : '2px solid #cbd5e1'}">
                <div class="tutor-inner">
                  <div class="tutor-avatar">${initials}</div>
                  <span class="tutor-name">${tutor.name}</span>
                </div>
               </td>`
            : '';

          sectionsHtml += `
            <tr class="${isLastStudentInTutor && !isLast ? 'tutor-divider' : ''}">
              ${tutorCell}
              <td class="col-student">${st.name}${st.grade ? ` <span class="grade">Gr.${st.grade}</span>` : ''}</td>
              <td class="col-subject">${st.topic ?? ''}</td>
              <td class="col-sig"><div class="sig-line"></div></td>
            </tr>
          `;
        });
      });

      sectionsHtml += `
            </tbody>
          </table>
        </div>
      `;
    });

    if (!hasAnySessions) {
      sectionsHtml = `<div style="padding: 40px; text-align: center; color: #94a3b8; font-size: 14px; border: 2px dashed #e2e8f0; border-radius: 8px;">No active sessions scheduled for this day.</div>`;
    }

    const formattedDate = new Date(todayIso + 'T00:00:00').toLocaleDateString('en-US', {
      weekday: 'long', year: 'numeric', month: 'long', day: 'numeric',
    });

    printWindow.document.write(`
      <!DOCTYPE html>
      <html>
        <head>
          <title>Sign-In Sheet — ${formattedDate}</title>
          <style>
            *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
            body {
              font-family: system-ui, -apple-system, 'Segoe UI', sans-serif;
              background: #fff;
              color: #1e293b;
              padding: 28px 36px;
              font-size: 13px;
            }

            /* ── Page header ── */
            .page-header {
              display: flex;
              align-items: flex-end;
              justify-content: space-between;
              border-bottom: 3px solid #1f2937;
              padding-bottom: 12px;
              margin-bottom: 22px;
            }
            .page-title {
              font-size: 22px;
              font-weight: 800;
              color: #0f172a;
              letter-spacing: -0.02em;
            }
            .page-subtitle {
              font-size: 13px;
              color: #64748b;
              font-weight: 500;
              margin-top: 3px;
            }
            .page-meta {
              text-align: right;
              font-size: 11px;
              color: #94a3b8;
              font-weight: 600;
              text-transform: uppercase;
              letter-spacing: 0.05em;
            }
            .page-meta strong { color: #475569; font-size: 13px; text-transform: none; letter-spacing: 0; }

            /* ── Session block ── */
            .session-block {
              margin-bottom: 20px;
              border-radius: 8px;
              overflow: hidden;
              border: 1.5px solid #cbd5e1;
              page-break-inside: avoid;
            }
            .session-header {
              display: flex;
              align-items: center;
              justify-content: space-between;
              background: #1f2937;
              padding: 9px 14px;
            }
            .session-header-left { display: flex; align-items: baseline; gap: 10px; }
            .session-label {
              font-size: 14px;
              font-weight: 800;
              color: #fff;
              text-transform: uppercase;
              letter-spacing: 0.06em;
            }
            .session-time {
              font-size: 11px;
              color: rgba(255,255,255,0.45);
              font-weight: 500;
            }
            .session-count {
              font-size: 10px;
              font-weight: 700;
              color: rgba(255,255,255,0.6);
              background: rgba(255,255,255,0.1);
              padding: 2px 8px;
              border-radius: 999px;
              text-transform: uppercase;
              letter-spacing: 0.05em;
            }

            /* ── Session table ── */
            .session-table {
              width: 100%;
              border-collapse: collapse;
            }
            .session-table thead tr {
              background: #f8fafc;
              border-bottom: 1.5px solid #e2e8f0;
            }
            .session-table th {
              padding: 7px 12px;
              font-size: 9px;
              font-weight: 700;
              text-transform: uppercase;
              letter-spacing: 0.08em;
              color: #94a3b8;
              text-align: left;
            }
            .session-table td {
              padding: 9px 12px;
              border-bottom: 1px solid #f1f5f9;
              vertical-align: middle;
            }
            .session-table tr:last-child td { border-bottom: none; }
            .tutor-divider td { border-bottom: 1.5px solid #e2e8f0 !important; }

            /* ── Column widths ── */
            .col-tutor  { width: 22%; }
            .col-student { width: 28%; }
            .col-subject { width: 20%; color: #64748b; }
            .col-sig    { width: 30%; }

            /* ── Tutor cell ── */
            .tutor-cell {
              background: #f8fafc;
              border-right: 1.5px solid #e2e8f0 !important;
            }
            .tutor-inner { display: flex; align-items: center; gap: 8px; }
            .tutor-avatar {
              width: 30px; height: 30px;
              border-radius: 50%;
              background: #e0e7ff;
              color: #4338ca;
              font-size: 11px;
              font-weight: 800;
              display: flex; align-items: center; justify-content: center;
              flex-shrink: 0;
              border: 1.5px solid #c7d2fe;
            }
            .tutor-name {
              font-size: 12px;
              font-weight: 700;
              color: #1e293b;
            }

            /* ── Student name ── */
            .col-student { font-weight: 600; color: #0f172a; }
            .grade { font-size: 10px; font-weight: 500; color: #94a3b8; }

            /* ── Signature line ── */
            .sig-line {
              border-bottom: 1.5px solid #94a3b8;
              margin: 6px 8px 6px 0;
              height: 18px;
            }

            @media print {
              body { padding: 16px 20px; }
              .session-block { page-break-inside: avoid; }
            }
          </style>
        </head>
        <body>
          <div class="page-header">
            <div>
              <div class="page-title">Daily Sign-In Sheet</div>
              <div class="page-subtitle">${formattedDate}</div>
            </div>
            <div class="page-meta">
              <div><strong>${todayStudentCount}</strong> students today</div>
              <div style="margin-top:3px;">Printed ${new Date().toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })}</div>
            </div>
          </div>

          ${sectionsHtml}

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