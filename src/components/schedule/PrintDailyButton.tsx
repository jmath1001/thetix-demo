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

    const activeTutors = filteredTodayTutors.filter(tutor =>
      filteredDaySessions.some(block => {
        const session = todaySessionByTutorTime.get(`${tutor.id}|${block.time}`);
        return (session?.students ?? []).some((st: any) => st.status !== 'cancelled');
      })
    );

    const formattedDate = new Date(todayIso + 'T00:00:00').toLocaleDateString('en-US', {
      weekday: 'long', year: 'numeric', month: 'long', day: 'numeric',
    });

    const theadCells = filteredDaySessions.map(block => {
      const total = filteredTodayTutors.reduce((sum, tutor) => {
        const s = todaySessionByTutorTime.get(`${tutor.id}|${block.time}`);
        return sum + (s?.students ?? []).filter((st: any) => st.status !== 'cancelled').length;
      }, 0);
      return `<th>${block.label}<br><span class="sub">${block.display ?? block.time}${total > 0 ? ` · ${total}` : ''}</span></th>`;
    }).join('');

    const tbodyRows = activeTutors.map(tutor => {
      const blockCells = filteredDaySessions.map(block => {
        const session = todaySessionByTutorTime.get(`${tutor.id}|${block.time}`);
        const activeStudents = (session?.students ?? []).filter((st: any) => st.status !== 'cancelled');
        if (activeStudents.length === 0) return `<td class="empty"></td>`;
        const rows = activeStudents.map((st: any) =>
          `<div class="sr"><span class="sn">${st.name}${st.grade ? ` <em>${st.grade}</em>` : ''}</span><span class="ss">${st.topic ?? ''}</span><div class="sig"></div></div>`
        ).join('');
        return `<td>${rows}</td>`;
      }).join('');

      return `<tr><td class="tutor">${tutor.name}</td>${blockCells}</tr>`;
    }).join('');

    const tableHtml = activeTutors.length === 0
      ? `<p style="padding:20px;color:#999;">No active sessions scheduled.</p>`
      : `<table><thead><tr><th class="tutor-h">Instructor</th>${theadCells}</tr></thead><tbody>${tbodyRows}</tbody></table>`;

    printWindow.document.write(`<!DOCTYPE html><html><head>
      <title>Daily Sheet — ${formattedDate}</title>
      <style>
        *{box-sizing:border-box;margin:0;padding:0}
        @page{size:landscape;margin:8mm}
        html{-webkit-print-color-adjust:exact;print-color-adjust:exact}
        body{font-family:Arial,sans-serif;font-size:10px;color:#000;background:#fff}
        #hdr{display:flex;justify-content:space-between;align-items:flex-end;border-bottom:2px solid #000;padding-bottom:5px;margin-bottom:8px}
        #hdr .title{font-size:15px;font-weight:700}
        #hdr .date{font-size:10px;color:#555;margin-top:2px}
        #hdr .meta{font-size:9px;color:#555;text-align:right}
        table{width:100%;border-collapse:collapse;table-layout:fixed}
        th,td{border:1px solid #aaa;vertical-align:top;padding:3px 4px;word-wrap:break-word}
        thead tr{background:#1f2937;color:#fff}
        th{font-size:9px;font-weight:700;text-align:center;text-transform:uppercase;letter-spacing:.04em}
        th .sub{font-size:8px;font-weight:400;opacity:.65;text-transform:none;letter-spacing:0}
        th.tutor-h{text-align:left;width:90px}
        td.tutor{background:#e8ecf0;font-weight:700;font-size:9px;vertical-align:middle;width:90px}
        td.empty{background:repeating-linear-gradient(45deg,#eee,#eee 3px,#e5e5e5 3px,#e5e5e5 6px)}
        .sr{padding:2px 0;border-bottom:1px solid #e5e5e5}
        .sr:last-child{border-bottom:none}
        .sn{display:block;font-weight:700;font-size:9px}
        .sn em{font-style:normal;font-weight:400;font-size:8px;color:#777}
        .ss{display:block;font-size:8px;color:#555}
        .sig{border-bottom:1px solid #999;height:12px;margin-top:4px}
      </style>
    </head><body>
      <div id="hdr">
        <div><div class="title">Daily Sign-In Sheet</div><div class="date">${formattedDate}</div></div>
        <div class="meta">${todayStudentCount} students &nbsp;·&nbsp; Printed ${new Date().toLocaleTimeString('en-US',{hour:'numeric',minute:'2-digit'})}</div>
      </div>
      ${tableHtml}
      <script>
        window.onload=function(){
          var body=document.body;
          var naturalH=body.scrollHeight;
          // landscape letter with 8mm margins ≈ 757px usable height at 96dpi
          var fitH=757;
          if(naturalH>fitH){
            var z=fitH/naturalH;
            body.style.zoom=z;
          }
          window.print();
          setTimeout(function(){window.close();},400);
        };
      <\/script>
    </body></html>`);

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