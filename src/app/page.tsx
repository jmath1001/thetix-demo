'use client';
import { ScheduleProvider } from '@/lib/ScheduleContext';
import MasterDeployment from '@/components/schedule/MasterDeployment';

export default function Home() {
  return (
    <ScheduleProvider>
      <MasterDeployment />
    </ScheduleProvider>
  );
}