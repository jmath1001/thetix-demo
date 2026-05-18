-- Drop the auto-generated FK (no cascade) that blocks tutor deletes.
-- The migration 20260427 already created slake_tutor_term_availability_tutor_fk
-- with ON DELETE CASCADE, but the original auto-named constraint survived.

alter table slake_tutor_term_availability
  drop constraint if exists slake_tutor_term_availability_tutor_id_fkey;

-- Re-confirm the cascade constraint is in place (idempotent).
alter table slake_tutor_term_availability
  drop constraint if exists slake_tutor_term_availability_tutor_fk;

alter table slake_tutor_term_availability
  add constraint slake_tutor_term_availability_tutor_fk
  foreign key (tutor_id) references slake_tutors (id)
  on delete cascade;
