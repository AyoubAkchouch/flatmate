-- ============================================================
-- Update 4: preferences, reviews, and compatibility ranking.
-- Run once in Supabase → SQL Editor → New query → paste → Run.
-- Includes update 3 (speed), so you don't need to run that one separately.
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


-- ---------- Preferences ----------
-- Seekers: what they look for, and what they're like as a flatmate.
alter table public.profiles add column if not exists budget_max int check (budget_max is null or budget_max > 0);
alter table public.profiles add column if not exists kind_pref text not null default 'any';
alter table public.profiles add column if not exists max_commute int not null default 45;
alter table public.profiles add column if not exists must_haves text[] not null default '{}';
alter table public.profiles add column if not exists nice_to_haves text[] not null default '{}';
alter table public.profiles add column if not exists lifestyle text[] not null default '{}';
-- Subletters: who they'd like to sublet to.
alter table public.profiles add column if not exists min_overlap_pct int not null default 60;
alter table public.profiles add column if not exists require_verified boolean not null default true;
alter table public.profiles add column if not exists wanted_lifestyle text[] not null default '{}';
do $$ begin
  alter table public.profiles add constraint kind_pref_values check (kind_pref in ('any','whole','room'));
exception when duplicate_object then null; end $$;
grant update (budget_max, kind_pref, max_commute, must_haves, nice_to_haves, lifestyle,
  min_overlap_pct, require_verified, wanted_lifestyle) on public.profiles to authenticated;

-- ---------- Reviews ----------
alter table public.app_settings add column if not exists allow_early_reviews boolean not null default true; -- demo: review before move-out

create table if not exists public.reviews (
  id bigint generated always as identity primary key,
  match_id uuid not null references public.matches on delete cascade,
  listing_id uuid references public.listings on delete set null,
  author_id uuid not null references public.profiles on delete cascade,
  subject_id uuid not null references public.profiles on delete cascade,  -- the person reviewed
  kind text not null check (kind in ('flat','tenant')),                  -- flat = seeker rates the flat; tenant = subletter rates the seeker
  rating int not null check (rating between 1 and 5),
  comment text check (comment is null or length(comment) <= 1000),
  created_at timestamptz not null default now(),
  unique (match_id, author_id)
);
create index if not exists reviews_listing on public.reviews (listing_id) where kind = 'flat';
create index if not exists reviews_subject on public.reviews (subject_id, kind);
alter table public.reviews enable row level security;
drop policy if exists "reviews readable" on public.reviews;
create policy "reviews readable" on public.reviews for select to authenticated using (true);

-- Write or update your review. Only after a signed contract, and after move-out unless early reviews are allowed.
create or replace function public.submit_review(m uuid, stars int, note text) returns void
language plpgsql security definer set search_path = public as $$
declare mt matches; l listings; early boolean;
begin
  select * into mt from matches where id = m;
  if mt.id is null or auth.uid() not in (mt.seeker_id, mt.owner_id) then
    raise exception 'Only the two students in this sublet can leave a review.';
  end if;
  if mt.status <> 'signed' then raise exception 'You can leave a review once the contract is signed.'; end if;
  select * into l from listings where id = mt.listing_id;
  select allow_early_reviews into early from app_settings where id = 1;
  if not early and l.available_to is not null and current_date < l.available_to then
    raise exception 'You can leave a review after the stay ends, on %.', to_char(l.available_to, 'DD Mon YYYY');
  end if;
  if stars is null or stars < 1 or stars > 5 then raise exception 'Choose between 1 and 5 stars.'; end if;
  insert into reviews (match_id, listing_id, author_id, subject_id, kind, rating, comment)
  values (m, mt.listing_id, auth.uid(),
          case when auth.uid() = mt.seeker_id then mt.owner_id else mt.seeker_id end,
          case when auth.uid() = mt.seeker_id then 'flat' else 'tenant' end,
          stars, nullif(trim(note), ''))
  on conflict (match_id, author_id) do update set rating = excluded.rating, comment = excluded.comment, created_at = now();
end $$;

create or replace function public.set_early_reviews(on_off boolean) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not is_admin() then raise exception 'Only admins can change this.'; end if;
  update app_settings set allow_early_reviews = on_off where id = 1;
end $$;

-- ---------- Ranked flats for a seeker ----------
-- Tier 1: fits everything (dates, commute, budget, flat or room, must-haves).
-- Tier 2: close but misses something (a bit far, a bit over budget, a must-have missing).
-- Tier 3: anything else in the region, so the deck never runs dry.
-- Score out of 100 within a tier:
--   dates 25 · commute 25 · budget 15 · value for the area 5 · wishes 10 · trust and ratings 15 · new 5
--   plus up to 4 points of randomness to keep discovering.
drop function if exists public.seeker_feed(int, uuid[]);
create function public.seeker_feed(p_limit int default 20, p_exclude uuid[] default '{}')
returns table (
  id uuid, kind text, title text, city text, area text, lat double precision, lng double precision,
  available_from date, available_to date, size_m2 int, rent int, tags text[], photos text[], owner_id uuid,
  owner_name text, owner_university text, owner_verified boolean,
  minutes int, overlap_pct int, tier int, score int, missing text[], kind_ok boolean, budget_max int,
  flat_rating numeric, flat_reviews int,
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
             and abs(l.lat - me.host_lat) < 1.5 and abs(l.lng - me.host_lng) < 2.2
           or lower(trim(l.city)) = lower(trim(me.city)))
  ),
  feat as (
    select c.*,
      case when c.km is null then null else round(7 + c.km * 3.4)::int end as mins,
      me.budget_max as budget, me.max_commute as maxc,
      array(select x from unnest(me.must_haves) x where not (x = any(c.tags))) as missing,
      cardinality(me.must_haves) as must_n,
      (me.kind_pref = 'any' or me.kind_pref = c.kind) as kind_ok,
      cardinality(me.nice_to_haves) as nice_n,
      (select count(*) from unnest(me.nice_to_haves) x where x = any(c.tags)) as nice_hit
    from cand c, me
    where c.overlap > 0
  ),
  tiered as (
    select f.*,
      case when f.overlap >= 0.6 and (f.mins is null or f.mins <= f.maxc)
                and (f.budget is null or f.rent <= f.budget * 1.05) and f.kind_ok and cardinality(f.missing) = 0 then 1
           when f.overlap >= 0.3 and (f.mins is null or f.mins <= f.maxc + 30)
                and (f.budget is null or f.rent <= f.budget * 1.25) then 2
           else 3 end as tier
    from feat f
  ),
  stats as (select * from listing_stats((select array_agg(t.id) from tiered t))),
  bench as (select * from city_benchmarks()),
  rated as (select r.listing_id, avg(r.rating) as avg_r, count(*)::int as n from reviews r
            where r.kind = 'flat' and r.listing_id in (select t.id from tiered t) group by 1),
  scored as (
    select t.*, o.full_name as owner_name, o.home_university as owner_university, (o.id_status = 'verified') as owner_verified,
      st.views_7d, st.interested_7d, b.flats as city_flats, b.avg_interest as city_avg_interest, b.median_eur_m2 as city_median_eur_m2,
      rr.avg_r, rr.n as n_reviews,
      ( 25 * least(1, t.overlap)
      + 25 * case when t.mins is null then 0.5 when t.mins <= 15 then 1
                  else greatest(0, 1 - (t.mins - 15)::numeric / greatest(15, t.maxc)) end
      + 15 * case when t.budget is null then 0.5
                  when t.rent <= t.budget then 0.6 + 0.4 * least(1, (t.budget - t.rent)::numeric / (0.3 * t.budget))
                  else 0.6 * greatest(0, 1 - (t.rent - t.budget)::numeric / (0.25 * t.budget)) end
      + 5 * case when b.median_eur_m2 is null then 0.5
                 else greatest(0, least(1, (b.median_eur_m2 / (t.rent::numeric / t.size_m2) - 0.7) / 0.6)) end
      + 10 * ((case when t.kind_ok then 0.4 else 0 end)
              + 0.6 * (case when t.nice_n = 0 then 1 else t.nice_hit::numeric / t.nice_n end))
           * (1 - cardinality(t.missing)::numeric / greatest(1, t.must_n))
      + 15 * ((case when o.id_status = 'verified' then 0.33 else 0 end)
              + (case when cardinality(t.photos) > 0 then 0.2 else 0 end)
              + 0.47 * coalesce(rr.avg_r / 5.0, 0.6))
      + 5 * greatest(0, 1 - extract(epoch from now() - t.created_at) / (30 * 86400))
      + 4 * random() ) as raw_score
    from tiered t
    join profiles o on o.id = t.owner_id
    left join stats st on st.listing_id = t.id
    left join bench b on b.city_key = lower(trim(t.city))
    left join rated rr on rr.listing_id = t.id
  )
  select id, kind, title, city, area, lat, lng, available_from, available_to, size_m2, rent, tags, photos, owner_id,
    owner_name, owner_university, owner_verified, mins, round(least(1, overlap) * 100)::int, tier,
    round(least(100, raw_score))::int, missing, kind_ok, budget,
    round(avg_r, 1), coalesce(n_reviews, 0),
    coalesce(views_7d, 0), coalesce(interested_7d, 0), city_flats, city_avg_interest, city_median_eur_m2
  from scored
  order by tier, raw_score desc
  limit least(greatest(p_limit, 1), 50)
$$;

-- ---------- Ranked applicants for a subletter ----------
-- Students who said yes to one of your flats and you haven't answered yet, best first.
-- Score out of 100: how much of your free period they use 30 · their commute from your flat 15 ·
-- lifestyle match 20 · their ratings as a tenant 15 · verified 15 · their budget covers your rent 5.
create or replace function public.owner_applicants()
returns table (
  listing_id uuid, listing_title text, rent int, seeker_id uuid, full_name text, home_university text, host_university text,
  exchange_from date, exchange_to date, id_status text, student_status text, lifestyle text[], lifestyle_hits int, wanted_n int,
  minutes int, cover_pct int, meets_dates boolean, budget_max int, tenant_rating numeric, tenant_reviews int, score int, liked_at timestamptz)
language sql stable security definer set search_path = public as $$
  with me as (select * from profiles where id = auth.uid()),
  apps as (
    select s.listing_id, s.seeker_id, s.created_at
    from swipes s join listings l on l.id = s.listing_id, me
    where l.owner_id = me.id and s.by_role = 'seeker' and s.liked
      and not exists (select 1 from swipes o where o.listing_id = s.listing_id and o.seeker_id = s.seeker_id and o.by_role = 'owner')
  ),
  f as (
    select a.listing_id, a.seeker_id, a.created_at, l.title, l.rent,
      p.full_name, p.home_university, p.host_university, p.exchange_from, p.exchange_to, p.id_status, p.student_status,
      p.lifestyle, p.budget_max, me.wanted_lifestyle, me.min_overlap_pct, me.require_verified,
      case when p.exchange_from is null or l.available_from is null then 1.0
        else greatest(0, least(p.exchange_to, l.available_to) - greatest(p.exchange_from, l.available_from))::numeric
             / greatest(1, l.available_to - l.available_from) end as cover,
      case when p.host_lat is null or l.lat is null then null
        else round(7 + 3.4 * sqrt(power((l.lat - p.host_lat) * 111, 2) + power((l.lng - p.host_lng) * 111 * cos(radians(p.host_lat)), 2)))::int end as mins,
      (select count(*) from unnest(me.wanted_lifestyle) x where x = any(p.lifestyle))::int as hits,
      (select avg(r.rating) from reviews r where r.subject_id = p.id and r.kind = 'tenant') as avg_r,
      (select count(*) from reviews r where r.subject_id = p.id and r.kind = 'tenant')::int as n_r
    from apps a join listings l on l.id = a.listing_id join profiles p on p.id = a.seeker_id, me
  )
  select listing_id, title, rent, seeker_id, full_name, home_university, host_university, exchange_from, exchange_to,
    id_status, student_status, lifestyle, hits, cardinality(wanted_lifestyle), mins, round(least(1, cover) * 100)::int,
    cover * 100 >= min_overlap_pct, budget_max, round(avg_r, 1), n_r,
    round(greatest(0,
        30 * least(1, cover)
      + 15 * case when mins is null then 0.5 when mins <= 15 then 1 else greatest(0, 1 - (mins - 15) / 60.0) end
      + 20 * case when cardinality(wanted_lifestyle) = 0 then 0.7 else hits::numeric / cardinality(wanted_lifestyle) end
      + 15 * coalesce(avg_r / 5.0, 0.6)
      + 15 * ((case when id_status = 'verified' then 0.6 else 0 end) + (case when student_status = 'verified' then 0.4 else 0 end))
      + 5 * case when budget_max is null then 0.5 when budget_max >= rent then 1 else 0 end
      - case when require_verified and id_status <> 'verified' then 40 else 0 end
      - case when cover * 100 < min_overlap_pct then 20 else 0 end))::int,
    created_at
  from f
  order by 21 desc, created_at
$$;
