import { supabase } from '@/lib/supabaseClient';

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
 | 'tutor_edited'
 | 'ai_booking_initiated'
 |'schedule_builder_confirmed'
 |'bulk_remove_sessions'
| 'tutor_deleted'
| 'tutor_created'
 | 'recurring_series_cancelled'
| 'recurring_series_edited'
| 'recurring_session_edited'
| 'recurring_session_cancelled'
  | 'student_edited';

export async function logEvent(
  event_name: EventName,
  properties: Record<string, any> = {}
) {
  try {
    await supabase.from('slake_events').insert({ event_name, properties });
  } catch {
    // never throw — analytics should never break the app
  }
}