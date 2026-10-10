-- ============================================================
-- Update 6: prices in any currency, profile photos, and the lease flow.
-- Run once in Supabase → SQL Editor → New query → paste → Run.
-- Needs updates 4 and 5 first. (Already included in schema.sql for new projects.)
-- ============================================================

-- ---------- Prices in the flat's own currency ----------
alter table public.listings add column if not exists currency text not null default 'EUR';
do $$ begin
  alter table public.listings add constraint currency_values
    check (currency in ('EUR','USD','GBP','CHF','SEK','DKK','NOK','PLN','CZK','HUF','CAD'));
exception when duplicate_object then null; end $$;
grant insert (currency), update (currency) on public.listings to authenticated;

-- ---------- Profile photos ----------
-- The photo is stored in the listing-photos bucket, in the person's own folder.
alter table public.profiles add column if not exists avatar_url text;
grant update (avatar_url) on public.profiles to authenticated;

-- ---------- Agreeing on the terms ----------
-- The two students each confirm. The landlord doesn't need to be in the chat for this;
-- if they are, they give their consent by signing the lease.
alter table public.matches add column if not exists seeker_agreed_at timestamptz;
alter table public.matches add column if not exists owner_agreed_at timestamptz;

create or replace function public.agree_terms(m uuid) returns void
language plpgsql security definer set search_path = public as $$
declare
  mt matches;
  nm text;
  demo boolean;
begin
  select * into mt from matches where id = m;
  if mt.id is null or not is_match_member(m) then raise exception 'You are not part of this chat.'; end if;
  if mt.status <> 'chatting' then return; end if;
  if auth.uid() = mt.landlord_id then
    raise exception 'The landlord gives consent by signing the lease, once both students agree.';
  end if;
  select full_name into nm from profiles where id = auth.uid();
  if auth.uid() = mt.seeker_id then
    if mt.seeker_agreed_at is not null then return; end if;
    update matches set seeker_agreed_at = now() where id = m;
  else
    if mt.owner_agreed_at is not null then return; end if;
    update matches set owner_agreed_at = now() where id = m;
  end if;
  insert into messages (match_id, kind, body) values (m, 'system', coalesce(nm, 'Someone') || ' agreed to the terms.');

  -- Demo flats: nobody can log in as their tenant, so they agree straight away.
  select demo_auto_match into demo from listings where id = mt.listing_id;
  if demo and auth.uid() = mt.seeker_id and mt.owner_agreed_at is null then
    update matches set owner_agreed_at = now() where id = m;
    insert into messages (match_id, sender_id, body) values (m, mt.owner_id, 'Agreed on my side too. See you soon!');
  end if;

  update matches set status = 'agreed'
    where id = m and status = 'chatting' and seeker_agreed_at is not null and owner_agreed_at is not null;
  if found then
    insert into messages (match_id, kind, body)
      values (m, 'system', 'You both agreed on the terms. The lease is ready, with your names filled in. Open it to read and sign.');
  end if;
end $$;

-- ---------- Signing the lease ----------
-- Each person signs their own line. The lease is fully signed when both students have signed,
-- plus the landlord if they joined the chat.
create or replace function public.sign_contract(m uuid, signature text, tpl text) returns void
language plpgsql security definer set search_path = public as $$
declare
  mt matches;
  c contracts;
begin
  select * into mt from matches where id = m;
  if mt.id is null or not is_match_member(m) then raise exception 'You are not part of this contract.'; end if;
  if mt.status = 'chatting' then raise exception 'Agree on the terms in the chat first.'; end if;
  if signature is null or signature !~ '^data:image/' then raise exception 'Draw your signature first.'; end if;
  select * into c from contracts where match_id = m;
  if c.seeker_signature is null and c.owner_signature is null and c.landlord_signature is null and tpl is not null then
    update contracts set template = tpl where match_id = m;
  end if;
  if auth.uid() = mt.seeker_id then
    update contracts set seeker_signature = signature, seeker_signed_at = now(), updated_at = now() where match_id = m;
  elsif auth.uid() = mt.owner_id then
    update contracts set owner_signature = signature, owner_signed_at = now(), updated_at = now() where match_id = m;
  else
    update contracts set landlord_signature = signature, landlord_signed_at = now(), updated_at = now() where match_id = m;
  end if;
  -- Demo flats: their tenant signs automatically, since nobody can log in as them.
  if exists (select 1 from listings where id = mt.listing_id and demo_auto_match) then
    update contracts set
      owner_signature = 'data:image/svg+xml;utf8,' || replace(replace(
        '<svg xmlns="http://www.w3.org/2000/svg" width="240" height="60"><text x="10" y="42" font-family="cursive" font-size="28" fill="#0A1A45">'
        || (select full_name from profiles where id = mt.owner_id) || '</text></svg>', '#', '%23'), '"', '%22'),
      owner_signed_at = now()
    where match_id = m and owner_signature is null;
  end if;
  if mt.status <> 'signed' and exists (select 1 from contracts where match_id = m
      and seeker_signature is not null and owner_signature is not null
      and (mt.landlord_id is null or landlord_signature is not null)) then
    update matches set status = 'signed' where id = m;
    insert into messages (match_id, kind, body) values (m, 'system', 'The lease is signed. You can save a copy as a PDF from the contract page.');
  end if;
end $$;

-- ---------- New match message ----------
create or replace function public.on_swipe() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  l listings;
  mid uuid;
begin
  if not new.liked then return new; end if;
  select * into l from listings where id = new.listing_id;

  if new.by_role = 'seeker' and l.demo_auto_match then
    insert into swipes (listing_id, seeker_id, by_role, liked)
      values (new.listing_id, new.seeker_id, 'owner', true) on conflict do nothing;
    return new;
  end if;

  if exists (select 1 from swipes where listing_id = new.listing_id and seeker_id = new.seeker_id
             and liked and by_role <> new.by_role) then
    insert into matches (listing_id, seeker_id, owner_id)
      values (new.listing_id, new.seeker_id, l.owner_id)
      on conflict (listing_id, seeker_id) do nothing
      returning id into mid;
    if mid is not null then
      insert into contracts (match_id) values (mid);
      insert into messages (match_id, kind, body)
        values (mid, 'system', 'You both said yes. Talk through the dates, rent and house rules. When you both tap "Agree on terms", the lease is filled in for you to sign.');
      if l.demo_auto_match then
        insert into messages (match_id, sender_id, body)
          values (mid, l.owner_id, 'Hi! Happy you like the place. When does your exchange start exactly?');
      end if;
    end if;
  end if;
  return new;
end $$;

-- ---------- Invitation preview shows the flat's currency ----------
drop function if exists public.invite_preview(text);
create function public.invite_preview(token text)
returns table (title text, area text, city text, rent int, owner_name text, seeker_name text,
               landlord_taken boolean, expected_email text, currency text)
language sql stable security definer set search_path = public as $$
  select l.title, l.area, l.city, l.rent, o.full_name, s.full_name,
    m.landlord_id is not null,
    -- Only a hint, like "m•••@gmail.com", never the full address.
    case when l.landlord_email is null or l.landlord_email = '' then null
      else left(l.landlord_email, 1) || '•••@' || split_part(l.landlord_email, '@', 2) end,
    l.currency
  from matches m
  join listings l on l.id = m.listing_id
  join profiles o on o.id = m.owner_id
  join profiles s on s.id = m.seeker_id
  where m.invite_token = token
$$;
grant execute on function public.invite_preview(text) to anon, authenticated;

-- ---------- Ranked feeds also return the currency and profile photos ----------
drop function if exists public.seeker_feed(int, uuid[]);
create function public.seeker_feed(p_limit int default 20, p_exclude uuid[] default '{}')
returns table (
  id uuid, kind text, title text, city text, area text, lat double precision, lng double precision,
  available_from date, available_to date, size_m2 int, rent int, tags text[], photos text[], owner_id uuid,
  owner_name text, owner_university text, owner_verified boolean,
  minutes int, overlap_pct int, tier int, score int, missing text[], kind_ok boolean, budget_max int,
  flat_rating numeric, flat_reviews int,
  views_7d int, interested_7d int, city_flats int, city_avg_interest numeric, city_median_eur_m2 numeric,
  currency text, owner_avatar text)
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
    select t.*, o.full_name as owner_name, o.avatar_url as owner_avatar, o.home_university as owner_university, (o.id_status = 'verified') as owner_verified,
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
    coalesce(views_7d, 0), coalesce(interested_7d, 0), city_flats, city_avg_interest, city_median_eur_m2,
    currency, owner_avatar
  from scored
  order by tier, raw_score desc
  limit least(greatest(p_limit, 1), 50)
$$;

-- ---------- Ranked applicants for a subletter ----------
-- Students who said yes to one of your flats and you haven't answered yet, best first.
-- Score out of 100: how much of your free period they use 30 · their commute from your flat 15 ·
-- lifestyle match 20 · their ratings as a tenant 15 · verified 15 · their budget covers your rent 5.
drop function if exists public.owner_applicants();
create function public.owner_applicants()
returns table (
  listing_id uuid, listing_title text, rent int, seeker_id uuid, full_name text, home_university text, host_university text,
  exchange_from date, exchange_to date, id_status text, student_status text, lifestyle text[], lifestyle_hits int, wanted_n int,
  minutes int, cover_pct int, meets_dates boolean, budget_max int, tenant_rating numeric, tenant_reviews int, score int, liked_at timestamptz,
  currency text, avatar_url text)
language sql stable security definer set search_path = public as $$
  with me as (select * from profiles where id = auth.uid()),
  apps as (
    select s.listing_id, s.seeker_id, s.created_at
    from swipes s join listings l on l.id = s.listing_id, me
    where l.owner_id = me.id and s.by_role = 'seeker' and s.liked
      and not exists (select 1 from swipes o where o.listing_id = s.listing_id and o.seeker_id = s.seeker_id and o.by_role = 'owner')
  ),
  f as (
    select a.listing_id, a.seeker_id, a.created_at, l.title, l.rent, l.currency, p.avatar_url,
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
    created_at, currency, avatar_url
  from f
  order by 21 desc, created_at
$$;

grant execute on function public.seeker_feed(int, uuid[]) to authenticated;
grant execute on function public.owner_applicants() to authenticated;
