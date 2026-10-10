-- ============================================================
-- RESET: deletes EVERY account and everything linked to them.
--   Real accounts (yours included), demo flats, synthetic students and flats,
--   swipes, stars, views, matches, chats, contracts, reviews, verification records.
-- Keeps: the tables, security rules, ranking functions and app settings.
-- This cannot be undone. Supabase's free plan has no automatic backup.
-- Run in Supabase → SQL Editor → New query → paste → Run.
-- ============================================================

-- What's there before.
select (select count(*) from auth.users) as accounts, (select count(*) from public.listings) as flats,
  (select count(*) from public.matches) as matches, (select count(*) from public.messages) as messages;

begin;

-- Deleting the accounts removes, through the database's links, their profiles, flats, swipes,
-- stars, views, matches, messages, contracts, reviews and verification records.
delete from auth.users;

-- Belt and braces: anything left in the app's own tables.
truncate public.reviews, public.messages, public.contracts, public.matches, public.swipes, public.stars,
  public.listing_views, public.verifications, public.listings, public.profiles restart identity cascade;

commit;

-- Uploaded files (flat photos, ID documents). Newer Supabase projects block deleting files with SQL;
-- if you see a notice below, empty the two buckets from Storage in the dashboard instead.
do $$ begin
  delete from storage.objects where bucket_id in ('listing-photos', 'verification');
exception when others then
  raise notice 'Files not deleted from SQL (%). Empty the listing-photos and verification buckets from Storage.', sqlerrm;
end $$;

-- What's left: everything should be 0.
select (select count(*) from auth.users) as accounts, (select count(*) from public.profiles) as profiles,
  (select count(*) from public.listings) as flats, (select count(*) from public.matches) as matches,
  (select count(*) from public.messages) as messages, (select count(*) from public.reviews) as reviews,
  (select count(*) from storage.objects where bucket_id in ('listing-photos', 'verification')) as files;
