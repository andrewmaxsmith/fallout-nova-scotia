create table if not exists public.game_state (
  id text primary key,
  state jsonb not null,
  updated_at timestamptz not null default now()
);

insert into public.game_state (id, state)
values ('primary', '{"version":2,"players":{}}'::jsonb)
on conflict (id) do nothing;
