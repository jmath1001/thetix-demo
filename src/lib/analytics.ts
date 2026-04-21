import { supabase } from '@/lib/supabaseClient';
import { DB } from '@/lib/db';

const DEMO_SEGMENT_COOKIE = 'gs_demo_segment';

export type EventName =
  | 'attendance_marked'
  | 'confirmation_updated'
  | 'notes_saved'
  | 'session_booked'
  | 'student_card_expanded'
  | 'student_searched'
  | 'modal_opened'
  | 'modal_closed'
  | 'reassign_used'
  | 'student_removed'
  | 'day_view_changed'
  | 'week_view_changed'
  | 'tab_switched'
  | 'booking_form_opened'
  | 'recurring_booking_used'
  | 'metrics_panel_opened'
  | 'contact_expanded'
  | 'bluebook_opened'
  | 'tutor_filter_used'
  | 'student_created'
  | 'student_deleted'
  | 'reminder_sent'
  | 'template_saved'
  | 'tutors_bulk_deleted'
  | 'tutor_edited'
  | 'students_imported'
  | 'ai_booking_initiated'
  | 'schedule_builder_confirmed'
  | 'bulk_remove_sessions'
  | 'students_bulk_deleted'
  | 'tutor_deleted'
  | 'tutor_created'
  | 'recurring_series_cancelled'
  | 'recurring_series_deleted'
  | 'recurring_series_edited'
  | 'recurring_session_edited'
  | 'recurring_session_cancelled'
  | 'student_edited'
  | 'week_cleared_non_recurring'
  | 'auto_book_used'
  | 'command_search_input'
  | 'command_search_submitted';

function getCookieValue(name: string): string | null {
  if (typeof document === 'undefined') return null;

  const all = document.cookie;
  if (!all) return null;

  const target = `${name}=`;
  const match = all
    .split(';')
    .map((part) => part.trim())
    .find((part) => part.startsWith(target));

  if (!match) return null;
  return decodeURIComponent(match.slice(target.length));
}

function withDemoSegment(properties: Record<string, any>): Record<string, any> {
  const segment = getCookieValue(DEMO_SEGMENT_COOKIE);
  if (!segment) return properties;
  if (properties.visitor_segment) return properties;

  return {
    ...properties,
    visitor_segment: segment,
  };
}

export async function logEvent(
  event_name: EventName,
  properties: Record<string, any> = {}
) {
  try {
    await supabase
      .from(DB.events)
      .insert({ event_name, properties: withDemoSegment(properties) });
  } catch {
    // never throw — analytics should never break the app
  }
}