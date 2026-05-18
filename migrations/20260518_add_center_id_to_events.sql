-- Add center_id to slake_events so analytics can be scoped per center.
alter table slake_events
  add column if not exists center_id text;

create index if not exists idx_slake_events_center_id
  on slake_events (center_id);
