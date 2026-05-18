// Utility to generate a unique browser/device ID and log first visit info
import { logEvent } from '@/lib/analytics';

export function logFirstVisitIfNeeded() {
  if (typeof window === 'undefined') return;
  try {
    const KEY = 'first_visit_id_v1';
    let id = localStorage.getItem(KEY);
    if (!id) {
      id = crypto.randomUUID?.() || Math.random().toString(36).slice(2) + Date.now();
      localStorage.setItem(KEY, id);
      const info = {
        id,
        timestamp: new Date().toISOString(),
        userAgent: navigator.userAgent,
        platform: navigator.platform,
        language: navigator.language,
        screen: `${window.screen.width}x${window.screen.height}`,
      };
      logEvent('first_visit', info);
      // For debugging/verification
      console.log('First visit info logged:', info);
    }
  } catch (e) {
    // Ignore errors
  }
}
