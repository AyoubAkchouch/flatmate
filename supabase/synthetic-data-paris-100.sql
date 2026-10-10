-- ============================================================
-- SYNTHETIC DATA, PARIS REGION ONLY: a small set of fake flats and fake students.
-- Removes any previous synthetic data first, so you can run it again safely.
-- Run in Supabase → SQL Editor → New query → paste → Run. Takes about a minute.
-- Everything it creates uses emails ending in @synthetic.flatmate.test,
-- so synthetic-cleanup.sql can remove all of it in one go.
--
-- Change the two numbers below to make more or fewer.
-- ============================================================
-- Start clean: remove fake data from earlier runs (real accounts are not touched).
delete from auth.users where email like '%@synthetic.flatmate.test';

create temp table syn_params as select
  100 as n_flats,     -- fake flats to sublet (one fake subletter each)
  100 as n_seekers;   -- fake students looking for a flat

select setseed(0.42); -- same "random" data every time you run it

-- ---------- Neighbourhoods: centre, spread (km), market rent per m², how common ----------
create temp table syn_zones (area text, city text, commune text, lat float, lng float, spread float, eur_m2 int, w int);
insert into syn_zones values
 ('1er · Louvre','Paris','75001 Paris',48.8625,2.3363,0.6,38,1), ('2e · Bourse','Paris','75002 Paris',48.8683,2.3428,0.5,37,1),
 ('3e · Marais','Paris','75003 Paris',48.8630,2.3600,0.5,38,2), ('4e · Île Saint-Louis','Paris','75004 Paris',48.8543,2.3576,0.6,39,1),
 ('5e · Quartier latin','Paris','75005 Paris',48.8445,2.3496,0.7,37,4), ('6e · Saint-Germain','Paris','75006 Paris',48.8491,2.3328,0.6,40,2),
 ('7e · Invalides','Paris','75007 Paris',48.8562,2.3121,0.8,39,1), ('8e · Champs-Élysées','Paris','75008 Paris',48.8727,2.3125,0.8,36,1),
 ('9e · Opéra','Paris','75009 Paris',48.8770,2.3373,0.6,35,2), ('10e · Canal Saint-Martin','Paris','75010 Paris',48.8761,2.3607,0.7,33,4),
 ('11e · Oberkampf','Paris','75011 Paris',48.8590,2.3800,0.8,33,6), ('12e · Nation','Paris','75012 Paris',48.8412,2.3876,1.1,31,4),
 ('13e · Butte-aux-Cailles','Paris','75013 Paris',48.8283,2.3622,1.1,30,6), ('14e · Montparnasse','Paris','75014 Paris',48.8292,2.3266,1.0,31,5),
 ('15e · Vaugirard','Paris','75015 Paris',48.8421,2.2989,1.2,32,6), ('16e · Passy','Paris','75016 Paris',48.8604,2.2620,1.4,34,2),
 ('17e · Batignolles','Paris','75017 Paris',48.8873,2.3074,1.0,32,4), ('18e · Montmartre','Paris','75018 Paris',48.8925,2.3484,1.0,30,6),
 ('19e · Buttes-Chaumont','Paris','75019 Paris',48.8871,2.3848,1.0,27,5), ('20e · Belleville','Paris','75020 Paris',48.8634,2.4012,1.0,28,5),
 ('Saint-Denis · Pleyel','Paris','93200 Saint-Denis',48.9300,2.3550,1.2,21,3), ('Montreuil · Croix-de-Chavaux','Paris','93100 Montreuil',48.8580,2.4410,1.0,24,3),
 ('Boulogne-Billancourt','Paris','92100 Boulogne-Billancourt',48.8350,2.2410,0.9,28,2), ('Ivry-sur-Seine','Paris','94200 Ivry-sur-Seine',48.8130,2.3850,0.9,23,2),
 ('Vincennes','Paris','94300 Vincennes',48.8473,2.4390,0.6,28,2), ('Nanterre · Université','Paris','92000 Nanterre',48.8990,2.2130,1.0,21,2);
create temp table syn_zone_pick as
  select row_number() over () as id, z.* from syn_zones z, generate_series(1, z.w);

-- ---------- Schools fake students are going to (approximate main sites) ----------
create temp table syn_schools (name text, city text, lat float, lng float, w int);
insert into syn_schools values
 ('Sorbonne Université','Paris',48.8466,2.3560,6), ('Université Paris 1 Panthéon-Sorbonne','Paris',48.8487,2.3436,5),
 ('Sciences Po','Paris',48.8541,2.3283,5), ('Université Paris Cité','Paris',48.8290,2.3810,5),
 ('Université Sorbonne Nouvelle','Paris',48.8467,2.3986,3), ('Université Paris Dauphine-PSL','Paris',48.8708,2.2740,3),
 ('Université Paris Nanterre','Paris',48.9033,2.2125,3), ('Université Paris 8','Paris',48.9450,2.3630,2),
 ('Conservatoire national des arts et métiers','Paris',48.8667,2.3553,1), ('École normale supérieure - PSL','Paris',48.8419,2.3440,1);
create temp table syn_school_pick as
  select row_number() over () as id, s.* from syn_schools s, generate_series(1, s.w);

-- ---------- Names and universities ----------
create temp table syn_words as select
 array['Léa','Hugo','Chloé','Louis','Inès','Jules','Manon','Arthur','Camille','Nathan','Sarah','Lucas','Emma','Théo','Zoé','Yanis','Lina','Adam','Clara','Rayan','Jade','Malo','Anaïs','Sacha','Elif','Mehdi','Aya','Noah','Salomé','Karim']::text[] as fr_first,
 array['Martin','Bernard','Dubois','Thomas','Robert','Petit','Durand','Leroy','Moreau','Simon','Laurent','Lefebvre','Michel','Garcia','David','Bertrand','Roux','Vincent','Fournier','Morel','Girard','Andre','Mercier','Blanc','Haddad','Benali','Nguyen','Diallo','Rossi','Fontaine']::text[] as fr_last,
 array['Amara','Diego','Mei','Lukas','Sofia','Kenji','Aisha','Mateo','Priya','Oliver','Hana','Mohammed','Isabella','Jonas','Fatima','Ji-woo','Lucía','Emeka','Ingrid','Ravi','Valentina','Tomás','Yuki','Chiara','Kwame','Ana','Elias','Zainab','Mia','Arjun']::text[] as int_first,
 array['Okafor','García','Wang','Müller','Rossi','Tanaka','Khan','Silva','Sharma','Smith','Kim','Hassan','Romero','Schmidt','Ali','Park','Fernández','Eze','Andersen','Patel','Costa','Novak','Sato','Bianchi','Mensah','Kowalski','Haddad','Ndiaye','Johansson','Reddy']::text[] as int_last,
 array['Sorbonne Université','Sciences Po','Université Paris Cité','Université Paris 1 Panthéon-Sorbonne','Université Paris Dauphine-PSL','Université Paris Nanterre','Université Paris 8','ESSEC','Université Paris-Saclay']::text[] as fr_unis,
 array['McGill University','Universidad de Buenos Aires','University of Lagos','Humboldt-Universität zu Berlin','Università di Bologna','Yonsei University','University of Toronto','Universidad Nacional Autónoma de México','University of Delhi','University of Melbourne','Universidade de São Paulo','KU Leuven','Universitat de Barcelona','University of Cape Town','Kyoto University','Uppsala University','Jagiellonian University','University of Edinburgh','Universidad de los Andes','American University of Beirut']::text[] as int_unis,
 array['Furnished','Bills included','Washing machine','Wi-Fi','Balcony','Near public transport','Bike storage','Quiet street']::text[] as tags,
 array['Bright','Cosy','Quiet','Sunny','Renovated','Charming','Calm','Spacious','Modern','Top-floor']::text[] as adj;

create function pg_temp.pick(a text[]) returns text language sql volatile as $$ select a[1 + floor(random() * array_length(a, 1))::int] $$;
-- Semester dates: most exchanges are spring 2027, some full year or summer.
create function pg_temp.dates(row_no int, out d_from date, out d_to date) language plpgsql volatile as $$
declare r float := random();
begin
  if r < 0.70 then d_from := date '2027-01-02' + floor(random()*20)::int; d_to := date '2027-06-12' + floor(random()*30)::int;
  elsif r < 0.85 then d_from := date '2027-08-25' + floor(random()*18)::int; d_to := date '2028-06-05' + floor(random()*30)::int;
  else d_from := date '2027-05-25' + floor(random()*20)::int; d_to := date '2027-08-10' + floor(random()*22)::int;
  end if;
end $$;

-- ---------- Fake subletters and their flats ----------
create temp table syn_owners as
select g, gen_random_uuid() as id, z.area, z.city, z.commune, z.lat, z.lng, z.spread, z.eur_m2,
  case when random() < 0.65 then 'whole' else 'room' end as kind,
  random() as r_size, random() as r_price, (random() + random() - 1) as jx, (random() + random() - 1) as jy,
  pg_temp.pick(w.fr_first) || ' ' || pg_temp.pick(w.fr_last) as full_name, pg_temp.pick(w.fr_unis) as uni,
  pg_temp.pick(w.int_unis) as dest, d.d_from, d.d_to
from generate_series(1, (select n_flats from syn_params)) g
cross join lateral (select 1 + floor(random() * (select count(*) from syn_zone_pick))::int + g * 0 as zi) pickz
join syn_zone_pick z on z.id = pickz.zi
cross join syn_words w
cross join lateral pg_temp.dates(g) d;

insert into auth.users (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
select '00000000-0000-0000-0000-000000000000', id, 'authenticated', 'authenticated', 'owner-' || g || '@synthetic.flatmate.test',
  '', now(), '{"provider":"email","providers":["email"]}', '{}', now(), now()
from syn_owners;

update public.profiles p set role = 'subletter', full_name = o.full_name, home_university = o.uni, host_university = o.dest,
  city = o.city, exchange_from = o.d_from, exchange_to = o.d_to, id_status = 'verified', student_status = 'verified', onboarded = true
from syn_owners o where p.id = o.id;

insert into public.listings (owner_id, kind, title, city, area, address, lat, lng, available_from, available_to,
  size_m2, rent, lease_rent, tags, landlord_name, active, created_at)
select o.id, o.kind,
  case when o.kind = 'room' then pg_temp.pick(w.adj) || ' room in a ' || (2 + floor(random()*3)::int) || '-person flatshare'
       when sz < 22 then pg_temp.pick(w.adj) || ' studio in ' || split_part(o.area, ' · ', 2)
       else pg_temp.pick(w.adj) || ' one-bedroom in ' || split_part(o.area, ' · ', 2) end,
  o.city, o.area, (1 + floor(random()*140)::int) || ' rue ' || pg_temp.pick(w.fr_last) || ', ' || o.commune,
  o.lat + o.jy * o.spread / 111.0, o.lng + o.jx * o.spread / (111.0 * cos(radians(o.lat))),
  o.d_from, o.d_to, sz, price, price + (floor(random()*7)::int * 10),
  coalesce((select array_agg(t) from unnest(w.tags) t where random() < 0.35 + o.g * 0), '{}'),
  case when random() < 0.5 then 'M. ' else 'Mme ' end || pg_temp.pick(w.fr_last), true,
  now() - random() * interval '20 days'
from syn_owners o cross join syn_words w
cross join lateral (select case when o.kind = 'room' then 9 + floor(o.r_size * 8)::int
                                when o.r_size < 0.55 then 12 + floor(o.r_size / 0.55 * 14)::int
                                else 26 + floor((o.r_size - 0.55) / 0.45 * 22)::int end as sz) s
cross join lateral (select greatest(case when o.kind = 'room' then 300 when o.city = 'Paris' then 480 else 340 end, round(
  case when o.kind = 'room' then (o.eur_m2 * 0.62 * s.sz + 180)
       else o.eur_m2 * s.sz end * (0.82 + o.r_price * 0.40) / 10) * 10)::int as price) pr;

-- ---------- Fake students looking for a flat ----------
create temp table syn_seekers as
select g, gen_random_uuid() as id, sc.name as school, sc.city, sc.lat + (random() - 0.5) * 0.004 as lat, sc.lng + (random() - 0.5) * 0.006 as lng,
  pg_temp.pick(w.int_first) || ' ' || pg_temp.pick(w.int_last) as full_name, pg_temp.pick(w.int_unis) as uni, d.d_from, d.d_to,
  (case when random() < 0.3 then 600 else 800 end + floor(random() * 6)::int * 100) as budget
from generate_series(1, (select n_seekers from syn_params)) g
cross join lateral (select 1 + floor(random() * (select count(*) from syn_school_pick))::int + g * 0 as si) picks
join syn_school_pick sc on sc.id = picks.si
cross join syn_words w
cross join lateral pg_temp.dates(g) d;

insert into auth.users (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
select '00000000-0000-0000-0000-000000000000', id, 'authenticated', 'authenticated', 'seeker-' || g || '@synthetic.flatmate.test',
  '', now(), '{"provider":"email","providers":["email"]}', '{}', now(), now()
from syn_seekers;

update public.profiles p set role = 'seeker', full_name = s.full_name, home_university = s.uni, host_university = s.school,
  host_lat = s.lat, host_lng = s.lng, city = s.city, exchange_from = s.d_from, exchange_to = s.d_to,
  id_status = 'verified', student_status = 'verified', onboarded = true
from syn_seekers s where p.id = s.id;

analyze syn_seekers; analyze public.listings;

-- ---------- Activity over the last 7 days, so demand badges mean something ----------
-- Each fake student looks at ~25 flats in their city with overlapping dates, and says yes
-- to the ones that are close to their school and within budget.
create temp table syn_seen as
select s.id as seeker_id, c.id as listing_id, c.dist_km, c.rent, s.budget,
  row_number() over (partition by s.id order by c.dist_km * 25 + greatest(0, c.rent - s.budget) + random() * 120) as rk
from syn_seekers s
cross join lateral (
  select l.id, l.rent,
    sqrt(power((l.lat - s.lat) * 111, 2) + power((l.lng - s.lng) * 111 * cos(radians(s.lat)), 2)) as dist_km
  from public.listings l
  where l.city = s.city and l.owner_id <> s.id and l.available_from <= s.d_to and l.available_to >= s.d_from
    and l.active and not l.demo_auto_match and s.g > 0
  order by random() limit 25) c;

insert into public.listing_views (listing_id, user_id, created_at)
select listing_id, seeker_id, now() - random() * interval '7 days' from syn_seen;

insert into public.swipes (listing_id, seeker_id, by_role, liked, created_at)
select listing_id, seeker_id, 'seeker', rk <= 4 and rent <= budget * 1.1, now() - random() * interval '7 days'
from syn_seen where rk <= 10;

insert into public.stars (user_id, listing_id, created_at)
select seeker_id, listing_id, now() - random() * interval '7 days' from syn_seen where rk <= 2 and random() < 0.5;

-- A third of the fake flats say yes back automatically, so a real student can get a match on stage.
-- (Set after the activity above, so fake students don't create thousands of matches.)
update public.listings set demo_auto_match = (random() < 0.33)
where owner_id in (select id from syn_owners);

select (select count(*) from syn_owners) as fake_flats, (select count(*) from syn_seekers) as fake_students,
  (select count(*) from syn_seen) as views, (select count(*) from syn_seen where rk <= 10) as swipes;
