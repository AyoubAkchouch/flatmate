-- ============================================================
-- Five synthetic flats in New York City, priced in US dollars, with photos.
-- Also creates a demo student going to Columbia, so you can see these flats and try
-- the whole flow (match → chat → agree → lease → sign):
--     email:    demo.nyc@synthetic.flatmate.test
--     password: FlatmateDemo-2026
-- Needs update-6-currency-photos-lease.sql first.
-- Run in Supabase → SQL Editor → New query → paste → Run. Safe to run again.
-- synthetic-cleanup.sql removes all of it.
--
-- Photos are free Unsplash photos (unsplash.com/license), loaded from Unsplash.
-- Credits: Frolicsome Fairy, Sam Jotham Sutharson, Quincy Rose, Clay Banks, Bee, Zoshua Colah,
-- Alexander Korte, Andrea Lacasse, Hiroko Nishimura. Interiors are illustrative, not the actual flats.
-- Rents: typical New York asking rents for 2026 in each neighbourhood.
-- ============================================================

-- ---------- The five students subletting their New York flat ----------
insert into auth.users (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
select '00000000-0000-0000-0000-000000000000', u.id::uuid, 'authenticated', 'authenticated', u.email,
  extensions.crypt(gen_random_uuid()::text, extensions.gen_salt('bf')), now(),
  '{"provider":"email","providers":["email"]}', '{}', now(), now()
from (values
  ('00000000-0000-4000-b000-000000000001', 'nyc-owner-1@synthetic.flatmate.test'),
  ('00000000-0000-4000-b000-000000000002', 'nyc-owner-2@synthetic.flatmate.test'),
  ('00000000-0000-4000-b000-000000000003', 'nyc-owner-3@synthetic.flatmate.test'),
  ('00000000-0000-4000-b000-000000000004', 'nyc-owner-4@synthetic.flatmate.test'),
  ('00000000-0000-4000-b000-000000000005', 'nyc-owner-5@synthetic.flatmate.test')
) as u(id, email)
on conflict (id) do nothing;

update public.profiles p set
  role = 'subletter', full_name = d.name, home_university = d.uni, host_university = d.dest,
  city = 'New York', home_city = 'New York',
  exchange_from = '2027-01-05', exchange_to = '2027-06-15',
  id_status = 'verified', student_status = 'verified', onboarded = true,
  min_overlap_pct = 50, require_verified = true
from (values
  ('00000000-0000-4000-b000-000000000001'::uuid, 'Maya Goldberg',  'Columbia University',  'Sciences Po, Paris'),
  ('00000000-0000-4000-b000-000000000002'::uuid, 'Daniel Okafor',  'Pratt Institute',      'Politecnico di Milano'),
  ('00000000-0000-4000-b000-000000000003'::uuid, 'Priya Raman',    'New York University',  'University College London'),
  ('00000000-0000-4000-b000-000000000004'::uuid, 'Lucas Ferreira', 'The New School',       'Universidad Complutense de Madrid'),
  ('00000000-0000-4000-b000-000000000005'::uuid, 'Hannah Kim',     'Columbia University',  'Humboldt-Universität zu Berlin')
) as d(id, name, uni, dest)
where p.id = d.id;

-- ---------- Their flats ----------
insert into public.listings (id, owner_id, kind, title, city, area, address, lat, lng,
  available_from, available_to, size_m2, rent, lease_rent, currency, tags, photos,
  landlord_name, landlord_email, demo_auto_match, baseline_interest)
values
  ('00000000-0000-4000-b100-000000000001', '00000000-0000-4000-b000-000000000001', 'whole',
   'Sunny studio by Columbia', 'New York', 'Morningside Heights', '520 W 112th St, Apt 4B, New York, NY 10025',
   40.8044, -73.9643, '2027-01-08', '2027-05-31', 30, 2700, 2700, 'USD',
   array['Furnished','Wi-Fi','Near public transport','Quiet street'],
   array['https://images.unsplash.com/photo-1714153542012-6164546db890?w=1200&q=80&auto=format&fit=crop',
         'https://images.unsplash.com/photo-1673384131443-0e2c3cb3f934?w=1200&q=80&auto=format&fit=crop',
         'https://images.unsplash.com/photo-1768065640135-e17bc3652f49?w=1200&q=80&auto=format&fit=crop'],
   'Robert Alvarez', 'r.alvarez@example.com', true, 9),

  ('00000000-0000-4000-b100-000000000002', '00000000-0000-4000-b000-000000000002', 'room',
   'Room in a Park Slope brownstone', 'New York', 'Park Slope, Brooklyn', '343 7th St, Apt 2, Brooklyn, NY 11215',
   40.6703, -73.9822, '2027-01-10', '2027-06-10', 14, 1700, 1750, 'USD',
   array['Furnished','Washing machine','Wi-Fi','Quiet street'],
   array['https://images.unsplash.com/photo-1713283391486-b92cda2562e8?w=1200&q=80&auto=format&fit=crop',
         'https://images.unsplash.com/photo-1784318519037-7ee0b1668e95?w=1200&q=80&auto=format&fit=crop',
         'https://images.unsplash.com/photo-1786254554660-4bb2deb40831?w=1200&q=80&auto=format&fit=crop'],
   'Grace Whitfield', 'grace.whitfield@example.com', true, 6),

  ('00000000-0000-4000-b100-000000000003', '00000000-0000-4000-b000-000000000003', 'whole',
   'Chelsea one-bedroom near the High Line', 'New York', 'Chelsea', '441 W 21st St, Apt 3F, New York, NY 10011',
   40.7463, -74.0040, '2027-01-05', '2027-05-25', 50, 4400, 4600, 'USD',
   array['Furnished','Bills included','Wi-Fi','Near public transport'],
   array['https://images.unsplash.com/photo-1713453076348-1dd57aa31a64?w=1200&q=80&auto=format&fit=crop',
         'https://images.unsplash.com/photo-1673384131620-a6ec8bff239b?w=1200&q=80&auto=format&fit=crop',
         'https://images.unsplash.com/photo-1722291238642-cec5a451913d?w=1200&q=80&auto=format&fit=crop'],
   'Chen Property Group', 'leasing@chen-property.example.com', true, 14),

  ('00000000-0000-4000-b100-000000000004', '00000000-0000-4000-b000-000000000004', 'room',
   'Room in an East Village walk-up', 'New York', 'East Village', '112 E 7th St, Apt 5, New York, NY 10009',
   40.7265, -73.9851, '2027-01-12', '2027-05-28', 11, 1550, 1600, 'USD',
   array['Furnished','Wi-Fi','Near public transport'],
   array['https://images.unsplash.com/photo-1714153760214-5e86aa688fc3?w=1200&q=80&auto=format&fit=crop',
         'https://images.unsplash.com/photo-1775746981330-b10308c4613d?w=1200&q=80&auto=format&fit=crop',
         'https://images.unsplash.com/photo-1708968799842-465ce8a255d7?w=1200&q=80&auto=format&fit=crop'],
   'Sal Benedetti', 'sal.benedetti@example.com', true, 11),

  ('00000000-0000-4000-b100-000000000005', '00000000-0000-4000-b000-000000000005', 'whole',
   'Astoria one-bedroom by the N/W train', 'New York', 'Astoria, Queens', '31-14 30th Ave, Apt 2R, Astoria, NY 11102',
   40.7672, -73.9215, '2027-01-04', '2027-06-14', 55, 2450, 2450, 'USD',
   array['Furnished','Washing machine','Wi-Fi','Near public transport','Bike storage'],
   array['https://images.unsplash.com/photo-1757792859308-b8d2115a0010?w=1200&q=80&auto=format&fit=crop',
         'https://images.unsplash.com/photo-1774311237295-a65a4c1ff38a?w=1200&q=80&auto=format&fit=crop',
         'https://images.unsplash.com/photo-1746407758049-c0d78a765635?w=1200&q=80&auto=format&fit=crop'],
   'Eleni Papadakis', 'eleni.papadakis@example.com', true, 5)
on conflict (id) do update set
  title = excluded.title, area = excluded.area, address = excluded.address, lat = excluded.lat, lng = excluded.lng,
  available_from = excluded.available_from, available_to = excluded.available_to, size_m2 = excluded.size_m2,
  rent = excluded.rent, lease_rent = excluded.lease_rent, currency = excluded.currency, tags = excluded.tags,
  photos = excluded.photos, landlord_name = excluded.landlord_name, landlord_email = excluded.landlord_email,
  demo_auto_match = excluded.demo_auto_match, baseline_interest = excluded.baseline_interest, active = true;

-- ---------- Demo student going to Columbia (you can log in as them) ----------
do $$
declare
  uid constant uuid := '00000000-0000-4000-b000-0000000000aa';
  demo_email constant text := 'demo.nyc@synthetic.flatmate.test';
  demo_password constant text := 'FlatmateDemo-2026';
  col text;
begin
  insert into auth.users (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
    raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
  values ('00000000-0000-0000-0000-000000000000', uid, 'authenticated', 'authenticated', demo_email,
    extensions.crypt(demo_password, extensions.gen_salt('bf')), now(),
    '{"provider":"email","providers":["email"]}', '{}', now(), now())
  on conflict (id) do update set encrypted_password = excluded.encrypted_password, email = excluded.email;

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
  end if;

  update public.profiles set
    email = demo_email, role = 'seeker', full_name = 'Camille Laurent',
    home_university = 'Sorbonne Université', home_city = 'Paris',
    host_university = 'Columbia University', host_campus = 'Columbia University, Morningside campus',
    host_lat = 40.8075, host_lng = -73.9626, city = 'New York',
    exchange_from = '2027-01-12', exchange_to = '2027-05-20',
    id_status = 'verified', student_status = 'verified', onboarded = true, view_mode = 'seeker',
    budget_max = 3000, kind_pref = 'any', max_commute = 45,
    must_haves = array['Furnished'], nice_to_haves = array['Wi-Fi','Near public transport'],
    lifestyle = array['Non-smoker','Tidy']
  where id = uid;
end $$;

-- What was added.
select l.title, l.area, '$' || l.rent || ' / month' as rent, p.full_name as subletter
from public.listings l join public.profiles p on p.id = l.owner_id
where l.id::text like '00000000-0000-4000-b100-%' order by l.rent;
