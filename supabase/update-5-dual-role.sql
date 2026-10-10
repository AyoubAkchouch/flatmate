-- ============================================================
-- Update 5: seekers who also sublet their own flat.
-- Run once in Supabase → SQL Editor → New query → paste → Run.
-- Needs update 4 first. (Already included in schema.sql for new projects.)
-- ============================================================

-- The city of the student's home university, used to pre-fill their own flat's listing.
alter table public.profiles add column if not exists home_city text;
-- Which side a seeker who also lists a flat is looking at: 'seeker' or 'provider'.
alter table public.profiles add column if not exists view_mode text not null default 'seeker';
do $$ begin
  alter table public.profiles add constraint view_mode_values check (view_mode in ('seeker','provider'));
exception when duplicate_object then null; end $$;
grant update (home_city, view_mode) on public.profiles to authenticated;
