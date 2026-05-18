'use client';
import { Suspense, useEffect } from 'react';
import { ScheduleProvider } from '@/lib/ScheduleContext';
import MasterDeployment from '@/components/schedule/MasterDeployment';
import { logFirstVisitIfNeeded } from '@/lib/firstVisit';

export default function Home() {
  useEffect(() => {
    logFirstVisitIfNeeded();
  }, []);
  return (
    <ScheduleProvider>
      <Suspense fallback={null}>
        <MasterDeployment />
      </Suspense>
    </ScheduleProvider>
  );
}