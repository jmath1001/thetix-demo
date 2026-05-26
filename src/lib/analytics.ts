import { supabase } from '@/lib/supabaseClient';
import { DB, getCenterId } from '@/lib/db';

export type EventName =
  | 'attendance_marked'
  | 'confirmation_updated'
  | 'session_booked'
  | 'reassign_used'
  | 'student_removed'
  | 'recurring_booking_used'
  | 'student_created'
  | 'student_edited'
  | 'reminder_sent'
  | 'template_saved'
  | 'tutors_bulk_deleted'
  | 'tutor_edited'
  | 'tutor_time_off_added'
  | 'tutor_time_off_removed'
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
  | 'recurring_session_student_off'
  | 'week_cleared_non_recurring'
  | 'auto_book_used'
  | 'command_search_input'
  | 'command_search_submitted'
  | 'hours_adjusted'
  | 'session_record_corrected'
  | 'term_created'
  | 'term_updated'
  | 'term_deleted'
  | 'center_settings_saved'
  | 'enrollment_form_sent'
  | 'blast_sent'
  | 'tutor_schedules_sent'
  | 'student_schedules_sent'
  | 'first_visit'
  | 'auto_reminder_toggled'
  | 'auto_reminder_time_saved';

export async function logEvent(
  event_name: EventName,
  properties: Record<string, any> = {}
) {
  try {
    await supabase.from(DB.events).insert({ event_name, properties, center_id: getCenterId() });
  } catch {
    // never throw — analytics should never break the app
  }
}