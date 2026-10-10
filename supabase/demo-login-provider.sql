-- ============================================================
-- DEMO LOGIN for a synthetic Paris subletter.
-- Picks the synthetic subletter in Paris with the most students waiting for an answer,
-- and lets you log in as them:
--     email:    demo.provider@synthetic.flatmate.test
--     password: FlatmateDemo-2026      (change it below if you like)
-- Run in Supabase → SQL Editor → New query → paste → Run. Safe to run again.
-- synthetic-cleanup.sql removes this account along with the other fake data.
-- ============================================================
do $$
declare
  uid uuid;
  col text;
  demo_email constant text := 'demo.provider@synthetic.flatmate.test';
  demo_password constant text := 'FlatmateDemo-2026';
begin
  select l.owner_id into uid
  from public.listings l
  join auth.users u on u.id = l.owner_id
  join public.swipes s on s.listing_id = l.id and s.by_role = 'seeker' and s.liked
  where (u.email like 'owner-%@synthetic.flatmate.test' or u.email = demo_email)
    and l.city = 'Paris' and l.active
    and not exists (select 1 from public.swipes o where o.listing_id = s.listing_id and o.seeker_id = s.seeker_id and o.by_role = 'owner')
  group by l.owner_id
  order by count(*) desc
  limit 1;
  if uid is null then
    raise exception 'No synthetic Paris subletter with waiting students. Run synthetic-data-paris-100.sql first.';
  end if;

  -- If an earlier run gave the demo email to someone else, give that account its old-style address back.
  update auth.users set email = 'owner-demo-' || left(id::text, 8) || '@synthetic.flatmate.test'
    where email = demo_email and id <> uid;
  update public.profiles set email = 'owner-demo-' || left(id::text, 8) || '@synthetic.flatmate.test'
    where email = demo_email and id <> uid;

  update auth.users set email = demo_email,
    encrypted_password = extensions.crypt(demo_password, extensions.gen_salt('bf')),
    email_confirmed_at = coalesce(email_confirmed_at, now())
  where id = uid;
  update public.profiles set email = demo_email where id = uid;

  -- Supabase's login expects these text fields to be empty rather than missing.
  for col in select column_name from information_schema.columns
    where table_schema = 'auth' and table_name = 'users'
      and column_name in ('confirmation_token', 'recovery_token', 'email_change_token_new', 'email_change',
                          'email_change_token_current', 'phone_change', 'phone_change_token', 'reauthentication_token')
  loop
    execute format('update auth.users set %I = coalesce(%I, '''') where id = $1', col, col) using uid;
  end loop;

  -- An email identity, which Supabase uses for password logins.
  if not exists (select 1 from auth.identities where user_id = uid and provider = 'email') then
    begin
      insert into auth.identities (id, user_id, provider_id, provider, identity_data, last_sign_in_at, created_at, updated_at)
      values (gen_random_uuid(), uid, uid::text, 'email',
              jsonb_build_object('sub', uid::text, 'email', demo_email, 'email_verified', true), now(), now(), now());
    exception when undefined_column then
      insert into auth.identities (id, user_id, provider, identity_data, last_sign_in_at, created_at, updated_at)
      values (uid::text, uid, 'email', jsonb_build_object('sub', uid::text, 'email', demo_email), now(), now(), now());
    end;
  else
    update auth.identities set identity_data = identity_data || jsonb_build_object('email', demo_email)
    where user_id = uid and provider = 'email';
  end if;
end $$;

-- Who you'll be logged in as.
select p.full_name as you_are, l.title as your_flat, l.area, l.rent,
  (select count(*) from public.swipes s where s.listing_id = l.id and s.by_role = 'seeker' and s.liked
     and not exists (select 1 from public.swipes o where o.listing_id = s.listing_id and o.seeker_id = s.seeker_id and o.by_role = 'owner'))
    as students_waiting
from public.profiles p join public.listings l on l.owner_id = p.id
where p.email = 'demo.provider@synthetic.flatmate.test';
