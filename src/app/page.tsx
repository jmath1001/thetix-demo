'use client';
import React, { useState } from "react";
import MasterGrid from "@/components/MasterGrid";
import { useScheduleData, getWeekStart } from '@/lib/useScheduleData';
import { Loader2 } from "lucide-react";

export default function Home() {
  const [weekStart] = useState<Date>(() => getWeekStart(new Date()));
  const { tutors, sessions, loading } = useScheduleData(weekStart);

  if (loading) return (
    <div className="w-full h-[80vh] flex items-center justify-center">
      <Loader2 size={32} className="text-[#6d28d9] animate-spin" />
    </div>
  );

  return (
    <div className="w-full">
      {/* Full-width header section */}
      
      
      {/* Full-width Master Grid */}
      <div className="w-full">
        <MasterGrid />
      </div>
    </div>
  );
}