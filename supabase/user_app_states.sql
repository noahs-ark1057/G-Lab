create table if not exists public.user_app_states (
  user_id uuid primary key references auth.users (id) on delete cascade,
  email text,
  saved_decks jsonb not null default '[]'::jsonb,
  favorites jsonb not null default '[]'::jsonb,
  theme text not null default 'light' check (theme in ('light', 'red')),
  reference_history jsonb not null default '[]'::jsonb,
  updated_at timestamptz not null default timezone('utc', now())
);

create or replace function public.set_user_app_states_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = timezone('utc', now());
  return new;
end;
$$;

drop trigger if exists trg_user_app_states_updated_at on public.user_app_states;
create trigger trg_user_app_states_updated_at
before update on public.user_app_states
for each row
execute function public.set_user_app_states_updated_at();

alter table public.user_app_states enable row level security;

revoke all on public.user_app_states from anon;
grant select, insert, update on public.user_app_states to authenticated;

drop policy if exists "user_app_states_select_own" on public.user_app_states;
create policy "user_app_states_select_own"
on public.user_app_states
for select
to authenticated
using ((select auth.uid()) = user_id);

drop policy if exists "user_app_states_insert_own" on public.user_app_states;
create policy "user_app_states_insert_own"
on public.user_app_states
for insert
to authenticated
with check ((select auth.uid()) = user_id);

drop policy if exists "user_app_states_update_own" on public.user_app_states;
create policy "user_app_states_update_own"
on public.user_app_states
for update
to authenticated
using ((select auth.uid()) = user_id)
with check ((select auth.uid()) = user_id);
