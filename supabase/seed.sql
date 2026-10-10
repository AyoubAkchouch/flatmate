-- ============================================================
-- Demo data: five students subletting flats in Paris.
-- Run once after schema.sql. Safe to run again (it skips what exists).
-- Three of these flats (Léa, Sofia, Inès) say yes back automatically,
-- so you can show a match on stage. Delete this data before a real launch.
-- ============================================================

insert into auth.users (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
select '00000000-0000-0000-0000-000000000000', u.id::uuid, 'authenticated', 'authenticated', u.email,
  extensions.crypt(gen_random_uuid()::text, extensions.gen_salt('bf')), now(),
  '{"provider":"email","providers":["email"]}', '{}', now(), now()
from (values
  ('00000000-0000-4000-a000-000000000001', 'lea.demo@flatmate.test'),
  ('00000000-0000-4000-a000-000000000002', 'karim.demo@flatmate.test'),
  ('00000000-0000-4000-a000-000000000003', 'sofia.demo@flatmate.test'),
  ('00000000-0000-4000-a000-000000000004', 'tom.demo@flatmate.test'),
  ('00000000-0000-4000-a000-000000000005', 'ines.demo@flatmate.test')
) as u(id, email)
on conflict (id) do nothing;

update public.profiles p set
  role = 'subletter', full_name = d.name, home_university = d.uni, host_university = d.dest, city = 'Paris',
  exchange_from = '2027-01-06', exchange_to = '2027-06-30',
  id_status = 'verified', student_status = 'verified', onboarded = true
from (values
  ('00000000-0000-4000-a000-000000000001'::uuid, 'Léa Martin', 'Sciences Po', 'McGill University, Montréal'),
  ('00000000-0000-4000-a000-000000000002'::uuid, 'Karim Haddad', 'Université Paris 8', 'Università di Bologna'),
  ('00000000-0000-4000-a000-000000000003'::uuid, 'Sofia Rossi', 'ESSEC', 'Yonsei University, Seoul'),
  ('00000000-0000-4000-a000-000000000004'::uuid, 'Tom Becker', 'Sorbonne Université', 'Humboldt-Universität zu Berlin'),
  ('00000000-0000-4000-a000-000000000005'::uuid, 'Inès Laurent', 'Université Paris Dauphine-PSL', 'University of Toronto')
) as d(id, name, uni, dest)
where p.id = d.id;

insert into public.listings (id, owner_id, kind, title, city, area, address, lat, lng, near_university,
  available_from, available_to, size_m2, rent, lease_rent, tags, landlord_name, demo_auto_match, baseline_interest)
values
  ('00000000-0000-4000-b000-000000000001', '00000000-0000-4000-a000-000000000001', 'whole',
   'Bright studio near Parmentier', 'Paris', '11e · Oberkampf', 'Rue Oberkampf, 75011 Paris', 48.8650, 2.3790,
   'Sciences Po', '2027-01-06', '2027-06-30', 22, 890, 890, '{Furnished,"Metro 3 min","Washing machine"}', 'M. Dubois', true, 14),
  ('00000000-0000-4000-b000-000000000002', '00000000-0000-4000-a000-000000000002', 'room',
   'Room in a 3-person flatshare', 'Paris', 'Saint-Denis · Pleyel', 'Boulevard Anatole France, 93200 Saint-Denis', 48.9190, 2.3440,
   'Université Paris 8', '2027-02-01', '2027-07-15', 12, 540, 560, '{"Shared kitchen","Line 13","Bills included"}', 'Mme Lefèvre', false, 3),
  ('00000000-0000-4000-b000-000000000003', '00000000-0000-4000-a000-000000000003', 'whole',
   'One-bedroom with balcony', 'Paris', '14e · Denfert', 'Avenue du Général Leclerc, 75014 Paris', 48.8340, 2.3320,
   'Sorbonne Université', '2027-01-10', '2027-06-20', 34, 1150, 1200, '{Furnished,Balcony,"Quiet street"}', 'SCI Montparnasse', true, 9),
  ('00000000-0000-4000-b000-000000000004', '00000000-0000-4000-a000-000000000004', 'whole',
   'Small studio by the campus', 'Paris', '5e · Jussieu', 'Rue Linné, 75005 Paris', 48.8460, 2.3550,
   'Sorbonne Université', '2027-01-06', '2027-05-31', 18, 780, 800, '{"Walk to Sorbonne",Furnished}', 'M. Garnier', false, 16),
  ('00000000-0000-4000-b000-000000000005', '00000000-0000-4000-a000-000000000005', 'room',
   'Room with park view', 'Paris', '19e · Buttes-Chaumont', 'Rue Botzaris, 75019 Paris', 48.8800, 2.3830,
   'Université Paris Dauphine-PSL', '2027-01-15', '2027-06-30', 14, 620, 650, '{"Shared bathroom","Near park","Bike storage"}', 'Mme Roche', true, 4)
on conflict (id) do nothing;
