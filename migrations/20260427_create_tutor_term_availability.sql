-- Create term-scoped tutor availability table.
-- Includes center_id so data is always center-scoped.

create extension if not exists pgcrypto;

create table if not exists slake_tutor_term_availability (
  id uuid primary key default gen_random_uuid(),
  center_id text not null,
  term_id uuid not null,
  tutor_id uuid not null,
  availability_blocks text[] not null default '{}',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- One override per center+term+tutor.
create unique index if not exists slake_tutor_term_availability_center_term_tutor_uniq
  on slake_tutor_term_availability (center_id, term_id, tutor_id);

-- Fast filter path used by /api/tutor-availability?termId=...
create index if not exists slake_tutor_term_availability_center_term_idx
  on slake_tutor_term_availability (center_id, term_id);

-- Keep foreign keys simple and explicit.
alter table slake_tutor_term_availability
  drop constraint if exists slake_tutor_term_availability_term_fk;

alter table slake_tutor_term_availability
  add constraint slake_tutor_term_availability_term_fk
  foreign key (term_id) references slake_terms (id)
  on delete cascade;

alter table slake_tutor_term_availability
  drop constraint if exists slake_tutor_term_availability_tutor_fk;

alter table slake_tutor_term_availability
  add constraint slake_tutor_term_availability_tutor_fk
  foreign key (tutor_id) references slake_tutors (id)
  on delete cascade;

-- Validate block format like "1-13:30".
alter table slake_tutor_term_availability
  drop constraint if exists slake_tutor_term_availability_blocks_format_ck;

alter table slake_tutor_term_availability
  add constraint slake_tutor_term_availability_blocks_format_ck
  check (
    not exists (
      select 1
      from unnest(availability_blocks) as block
      where block !~ '^[1-7]-([01][0-9]|2[0-3]):[0-5][0-9]$'
    )
  );

-- Update timestamp automatically.
create or replace function slake_set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists slake_tutor_term_availability_set_updated_at
  on slake_tutor_term_availability;

create trigger slake_tutor_term_availability_set_updated_at
before update on slake_tutor_term_availability
for each row
execute function slake_set_updated_at();
