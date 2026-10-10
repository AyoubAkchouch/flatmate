-- ============================================================
-- Update 3: speed, and a ranked feed of flats served 20 at a time.
-- Run once in Supabase → SQL Editor → New query → paste → Run.
-- (Already included in schema.sql for new projects.)
-- ============================================================

-- ---------- Indexes: let the database jump to the rows it needs ----------
create index if not exists listing_views_listing_time on public.listing_views (listing_id, created_at);
create index if not exists swipes_listing_role_time on public.swipes (listing_id, by_role, created_at) where liked;
create index if not exists swipes_seeker on public.swipes (seeker_id, listing_id);
create index if not exists stars_listing_time on public.stars (listing_id, created_at);
create index if not exists listings_active_city on public.listings (active, lower(trim(city)));
create index if not exists listings_owner on public.listings (owner_id);
create index if not exists matches_seeker on public.matches (seeker_id);
create index if not exists matches_owner on public.matches (owner_id);
create index if not exists matches_landlord on public.matches (landlord_id);
create index if not exists messages_match on public.messages (match_id, id);

-- ---------- Views and interest in the last 7 days (counted per group, not per flat) ----------
drop function if exists public.listing_stats();
create or replace function public.listing_stats(ids uuid[] default null)
returns table (listing_id uuid, views_7d int, interested_7d int)
language sql stable security definer set search_path = public as $$
  with l as (select id, baseline_interest from listings where active and (ids is null or id = any(ids))),
  v as (select lv.listing_id, count(*) c from listing_views lv join l on l.id = lv.listing_id
        where lv.created_at > now() - interval '7 days' group by 1),
  s as (select sw.listing_id, count(*) c from swipes sw join l on l.id = sw.listing_id
        where sw.liked and sw.by_role = 'seeker' and sw.created_at > now() - interval '7 days' group by 1),
  st as (select x.listing_id, count(*) c from stars x join l on l.id = x.listing_id
        where x.created_at > now() - interval '7 days' group by 1)
  select l.id, coalesce(v.c, 0)::int, (coalesce(s.c, 0) + coalesce(st.c, 0) + l.baseline_interest)::int
  from l left join v on v.listing_id = l.id left join s on s.listing_id = l.id left join st on st.listing_id = l.id
$$;

-- ---------- What's normal in each city: average interest, median price per m² ----------
create or replace function public.city_benchmarks()
returns table (city_key text, flats int, avg_interest numeric, median_eur_m2 numeric)
language sql stable security definer set search_path = public as $$
  select lower(trim(l.city)), count(*)::int, avg(s.interested_7d),
    percentile_cont(0.5) within group (order by l.rent::numeric / l.size_m2)::numeric
  from listings l join listing_stats(null) s on s.listing_id = l.id
  where l.active
  group by 1
$$;

-- ---------- The seeker's feed: best flats first, 20 at a time, never a dead end ----------
-- Tier 1: close to campus (≤ 45 min) and free for most of the stay.
-- Tier 2: further out or covering less of the stay. Tier 3: anything else in the region.
-- Within a tier, flats are ordered by a score out of 100:
--   dates 30 · commute 30 · value for money 20 · trust (verified host, photos) 10 · new listing 10
-- plus a little randomness so the deck keeps discovering.
create or replace function public.seeker_feed(p_limit int default 20, p_exclude uuid[] default '{}')
returns table (
  id uuid, kind text, title text, city text, area text, lat double precision, lng double precision,
  available_from date, available_to date, size_m2 int, rent int, tags text[], photos text[], owner_id uuid,
  owner_name text, owner_university text, owner_verified boolean,
  minutes int, overlap_pct int, tier int, score int,
  views_7d int, interested_7d int, city_flats int, city_avg_interest numeric, city_median_eur_m2 numeric)
language sql stable security definer set search_path = public as $$
  with me as (select * from profiles where id = auth.uid()),
  cand as (
    select l.*,
      case when me.host_lat is null or l.lat is null then null
        else sqrt(power((l.lat - me.host_lat) * 111, 2) + power((l.lng - me.host_lng) * 111 * cos(radians(me.host_lat)), 2)) end as km,
      case when me.exchange_from is null or l.available_from is null then 1.0
        else greatest(0, least(me.exchange_to, l.available_to) - greatest(me.exchange_from, l.available_from))::numeric
             / greatest(1, me.exchange_to - me.exchange_from) end as overlap
    from listings l, me
    where l.active and l.owner_id <> me.id and not (l.id = any(p_exclude))
      and not exists (select 1 from swipes s where s.seeker_id = me.id and s.listing_id = l.id and s.by_role = 'seeker')
      and (me.host_lat is not null and l.lat is not null
             and abs(l.lat - me.host_lat) < 1.5 and abs(l.lng - me.host_lng) < 2.2   -- same region (~150 km)
           or lower(trim(l.city)) = lower(trim(me.city)))
  ),
  timed as (select c.*, case when km is null then null else round(7 + km * 3.4)::int end as mins from cand c),
  tiered as (
    select t.*,
      case when overlap >= 0.6 and (mins is null or mins <= 45) then 1
           when overlap >= 0.3 and (mins is null or mins <= 75) then 2
           else 3 end as tier
    from timed t where overlap > 0
  ),
  stats as (select * from listing_stats((select array_agg(id) from tiered))),
  bench as (select * from city_benchmarks()),
  scored as (
    select t.*, o.full_name as owner_name, o.home_university as owner_university,
      (o.id_status = 'verified') as owner_verified, st.views_7d, st.interested_7d,
      b.flats as city_flats, b.avg_interest as city_avg_interest, b.median_eur_m2 as city_median_eur_m2,
      ( 30 * least(1, t.overlap)
      + 30 * case when t.mins is null then 0.5 else greatest(0, least(1, 1 - (t.mins - 15) / 45.0)) end
      + 20 * case when b.median_eur_m2 is null then 0.5
               else greatest(0, least(1, (b.median_eur_m2 / (t.rent::numeric / t.size_m2) - 0.7) / 0.6)) end
      + 10 * ((case when o.id_status = 'verified' then 0.5 else 0 end) + (case when cardinality(t.photos) > 0 then 0.5 else 0 end))
      + 10 * greatest(0, 1 - extract(epoch from now() - t.created_at) / (30 * 86400))
      + 6 * random() ) as raw_score
    from tiered t
    join profiles o on o.id = t.owner_id
    left join stats st on st.listing_id = t.id
    left join bench b on b.city_key = lower(trim(t.city))
  )
  select id, kind, title, city, area, lat, lng, available_from, available_to, size_m2, rent, tags, photos, owner_id,
    owner_name, owner_university, owner_verified, mins, round(least(1, overlap) * 100)::int, tier, round(least(100, raw_score))::int,
    coalesce(views_7d, 0), coalesce(interested_7d, 0), city_flats, city_avg_interest, city_median_eur_m2
  from scored
  order by tier, raw_score desc
  limit least(greatest(p_limit, 1), 50)
$$;
