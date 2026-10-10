-- ============================================================
-- Flatmate database
-- Run this whole file once: Supabase → SQL Editor → New query → paste → Run.
-- Then run seed.sql the same way to add the demo flats.
-- ============================================================

create extension if not exists pgcrypto with schema extensions;

-- ---------- Settings (one row) ----------
create table public.app_settings (
  id int primary key default 1 check (id = 1),
  auto_approve_checks boolean not null default true  -- true = ID and student checks pass instantly (demo mode)
);
insert into public.app_settings default values;

-- ---------- People ----------
create table public.profiles (
  id uuid primary key references auth.users on delete cascade,
  email text,
  role text check (role in ('seeker','subletter','landlord')),
  full_name text,
  home_university text,
  home_university_ror text,
  host_university text,
  host_campus text,
  host_lat double precision,
  host_lng double precision,
  city text,
  exchange_from date,
  exchange_to date,
  phone text,
  id_status text not null default 'none' check (id_status in ('none','pending','verified','failed')),
  student_status text not null default 'none' check (student_status in ('none','pending','verified','failed','not_needed')),
  onboarded boolean not null default false,
  is_admin boolean not null default false,
  created_at timestamptz not null default now()
);

create function public.handle_new_user() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles (id, email) values (new.id, new.email) on conflict do nothing;
  return new;
end $$;
create trigger on_auth_user_created after insert on auth.users
  for each row execute function public.handle_new_user();

-- ---------- Flats ----------
create table public.listings (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references public.profiles on delete cascade,
  kind text not null default 'whole' check (kind in ('whole','room')),
  title text not null,
  city text not null,
  area text,
  address text,
  lat double precision,
  lng double precision,
  near_university text,
  available_from date,
  available_to date,
  size_m2 int not null check (size_m2 > 0),
  rent int not null check (rent > 0),
  lease_rent int not null check (lease_rent > 0),
  tags text[] not null default '{}',
  photos text[] not null default '{}',
  landlord_name text,
  landlord_email text,
  active boolean not null default true,
  demo_auto_match boolean not null default false, -- demo flats say yes back automatically
  baseline_interest int not null default 0,       -- demo flats start with some interest
  created_at timestamptz not null default now(),
  constraint rent_not_above_lease check (rent <= lease_rent)
);

create table public.swipes (
  id bigint generated always as identity primary key,
  listing_id uuid not null references public.listings on delete cascade,
  seeker_id uuid not null references public.profiles on delete cascade,
  by_role text not null check (by_role in ('seeker','owner')),
  liked boolean not null,
  created_at timestamptz not null default now(),
  unique (listing_id, seeker_id, by_role)
);

create table public.stars (
  user_id uuid not null references public.profiles on delete cascade,
  listing_id uuid not null references public.listings on delete cascade,
  created_at timestamptz not null default now(),
  primary key (user_id, listing_id)
);

create table public.listing_views (
  id bigint generated always as identity primary key,
  listing_id uuid not null references public.listings on delete cascade,
  user_id uuid not null references public.profiles on delete cascade,
  created_at timestamptz not null default now()
);

-- ---------- Matches, chat, contracts ----------
create table public.matches (
  id uuid primary key default gen_random_uuid(),
  listing_id uuid not null references public.listings on delete cascade,
  seeker_id uuid not null references public.profiles on delete cascade,
  owner_id uuid not null references public.profiles on delete cascade,
  landlord_id uuid references public.profiles on delete set null,
  invite_token text not null default encode(extensions.gen_random_bytes(12), 'hex'),
  status text not null default 'chatting' check (status in ('chatting','agreed','signed')),
  created_at timestamptz not null default now(),
  unique (listing_id, seeker_id)
);

create table public.messages (
  id bigint generated always as identity primary key,
  match_id uuid not null references public.matches on delete cascade,
  sender_id uuid references public.profiles on delete set null,
  kind text not null default 'text' check (kind in ('text','system')),
  body text not null check (length(body) between 1 and 2000),
  created_at timestamptz not null default now()
);

create table public.contracts (
  match_id uuid primary key references public.matches on delete cascade,
  template text not null default 'standard',
  seeker_signature text, seeker_signed_at timestamptz,
  owner_signature text, owner_signed_at timestamptz,
  landlord_signature text, landlord_signed_at timestamptz,
  updated_at timestamptz not null default now()
);

-- ---------- Verification ----------
create table public.verifications (
  id bigint generated always as identity primary key,
  user_id uuid not null references public.profiles on delete cascade,
  kind text not null check (kind in ('identity','student')),
  document_type text,
  files text[] not null default '{}',
  status text not null default 'pending' check (status in ('pending','verified','failed')),
  created_at timestamptz not null default now(),
  reviewed_at timestamptz
);

-- ============================================================
-- Helper functions
-- ============================================================
create function public.is_admin() returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce((select is_admin from profiles where id = auth.uid()), false)
$$;

create function public.is_match_member(m uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from matches where id = m and auth.uid() in (seeker_id, owner_id, landlord_id))
$$;

-- When both sides say yes, create the match, its chat and its contract.
create function public.on_swipe() returns trigger
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
        values (mid, 'system', 'You both said yes. Say hello, then add the landlord when you are ready to agree.');
      if l.demo_auto_match then
        insert into messages (match_id, sender_id, body)
          values (mid, l.owner_id, 'Hi! Happy you like the place. When does your exchange start exactly?');
      end if;
    end if;
  end if;
  return new;
end $$;
create trigger swipe_match after insert on public.swipes
  for each row execute function public.on_swipe();

-- What an invitation is about, shown before the landlord decides to join.
create function public.invite_preview(token text)
returns table (title text, area text, city text, rent int, owner_name text, seeker_name text,
               landlord_taken boolean, expected_email text)
language sql stable security definer set search_path = public as $$
  select l.title, l.area, l.city, l.rent, o.full_name, s.full_name,
    m.landlord_id is not null,
    -- Only a hint, like "m•••@gmail.com", never the full address.
    case when l.landlord_email is null or l.landlord_email = '' then null
      else left(l.landlord_email, 1) || '•••@' || split_part(l.landlord_email, '@', 2) end
  from matches m
  join listings l on l.id = m.listing_id
  join profiles o on o.id = m.owner_id
  join profiles s on s.id = m.seeker_id
  where m.invite_token = token
$$;

-- Joining is only for landlord accounts, and only for the expected email when the tenant gave one.
create function public.accept_invite(token text) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  m matches;
  me profiles;
  expected text;
begin
  select * into m from matches where invite_token = token;
  if m.id is null then raise exception 'This invitation link is not valid.'; end if;
  select * into me from profiles where id = auth.uid();
  if me.role is distinct from 'landlord' then
    raise exception 'Only a landlord account can accept this invitation. Log out and sign in as the landlord.';
  end if;
  if auth.uid() in (m.seeker_id, m.owner_id) then
    raise exception 'You are already part of this chat as a student.';
  end if;
  select landlord_email into expected from listings where id = m.listing_id;
  if expected is not null and expected <> '' and lower(expected) <> lower(me.email) then
    raise exception 'This invitation was sent to a different email address. Sign in with the email the tenant gave.';
  end if;
  if m.landlord_id is not null and m.landlord_id <> auth.uid() then
    raise exception 'Another landlord already joined this chat.';
  end if;
  if m.landlord_id is null then
    update matches set landlord_id = auth.uid() where id = m.id;
    insert into messages (match_id, kind, body)
      values (m.id, 'system', coalesce(me.full_name, 'The landlord') || ' (landlord) joined the chat.');
  end if;
  return m.id;
end $$;

create function public.agree_terms(m uuid) returns void
language plpgsql security definer set search_path = public as $$
declare nm text;
begin
  if not is_match_member(m) then raise exception 'You are not part of this chat.'; end if;
  if not exists (select 1 from matches where id = m and landlord_id is not null) then
    raise exception 'Add the landlord to the chat before agreeing.';
  end if;
  update matches set status = 'agreed' where id = m and status = 'chatting';
  if found then
    select full_name into nm from profiles where id = auth.uid();
    insert into messages (match_id, kind, body)
      values (m, 'system', coalesce(nm, 'Someone') || ' marked the terms as agreed. The contract is ready to sign.');
  end if;
end $$;

-- Each person signs their own line of the contract.
create function public.sign_contract(m uuid, signature text, tpl text) returns void
language plpgsql security definer set search_path = public as $$
declare
  mt matches;
  c contracts;
begin
  select * into mt from matches where id = m;
  if mt.id is null or not is_match_member(m) then raise exception 'You are not part of this contract.'; end if;
  if mt.status = 'chatting' then raise exception 'Agree on the terms in the chat first.'; end if;
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
  -- Demo flats: the demo student signs automatically, since nobody can log in as them.
  if exists (select 1 from listings where id = mt.listing_id and demo_auto_match) then
    update contracts set
      owner_signature = 'data:image/svg+xml;utf8,' || replace(replace(
        '<svg xmlns="http://www.w3.org/2000/svg" width="240" height="60"><text x="10" y="42" font-family="cursive" font-size="28" fill="#16233F">'
        || (select full_name from profiles where id = mt.owner_id) || '</text></svg>', '#', '%23'), '"', '%22'),
      owner_signed_at = now()
    where match_id = m and owner_signature is null;
  end if;
  if exists (select 1 from contracts where match_id = m and seeker_signature is not null
             and owner_signature is not null and landlord_signature is not null) then
    update matches set status = 'signed' where id = m;
    insert into messages (match_id, kind, body) values (m, 'system', 'The contract is signed by all three of you.');
  end if;
end $$;

-- Submit an ID or student document. Demo mode approves it straight away.
create function public.submit_verification(check_kind text, doc_type text, file_paths text[]) returns text
language plpgsql security definer set search_path = public as $$
declare
  auto boolean;
  st text;
begin
  select auto_approve_checks into auto from app_settings where id = 1;
  st := case when auto then 'verified' else 'pending' end;
  insert into verifications (user_id, kind, document_type, files, status, reviewed_at)
    values (auth.uid(), check_kind, doc_type, file_paths, st, case when auto then now() end);
  if check_kind = 'identity' then
    update profiles set id_status = st where id = auth.uid();
  else
    update profiles set student_status = st where id = auth.uid();
  end if;
  return st;
end $$;

create function public.skip_student_check() returns void
language sql security definer set search_path = public as $$
  update profiles set student_status = 'not_needed' where id = auth.uid() and role = 'landlord';
$$;

create function public.review_verification(vid bigint, approve boolean) returns void
language plpgsql security definer set search_path = public as $$
declare v verifications; st text;
begin
  if not is_admin() then raise exception 'Only admins can review checks.'; end if;
  st := case when approve then 'verified' else 'failed' end;
  update verifications set status = st, reviewed_at = now() where id = vid returning * into v;
  if v.kind = 'identity' then
    update profiles set id_status = st where id = v.user_id;
  else
    update profiles set student_status = st where id = v.user_id;
  end if;
end $$;

create function public.set_auto_approve(on_off boolean) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not is_admin() then raise exception 'Only admins can change this.'; end if;
  update app_settings set auto_approve_checks = on_off where id = 1;
end $$;

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


-- ============================================================
-- Security: who can read and change what
-- ============================================================
alter table public.app_settings enable row level security;
alter table public.profiles enable row level security;
alter table public.listings enable row level security;
alter table public.swipes enable row level security;
alter table public.stars enable row level security;
alter table public.listing_views enable row level security;
alter table public.matches enable row level security;
alter table public.messages enable row level security;
alter table public.contracts enable row level security;
alter table public.verifications enable row level security;

create policy "settings readable" on public.app_settings for select to authenticated using (true);

create policy "profiles readable" on public.profiles for select to authenticated using (true);
create policy "edit own profile" on public.profiles for update to authenticated using (id = auth.uid());
-- People can edit their details, but not their verification status or admin flag.
revoke update on public.profiles from authenticated, anon;
grant update (role, full_name, home_university, home_university_ror, host_university, host_campus, host_lat, host_lng,
  city, exchange_from, exchange_to, phone, onboarded)
  on public.profiles to authenticated;

create policy "listings readable" on public.listings for select to authenticated using (true);
create policy "create own listing" on public.listings for insert to authenticated with check (owner_id = auth.uid());
create policy "edit own listing" on public.listings for update to authenticated using (owner_id = auth.uid());
create policy "delete own listing" on public.listings for delete to authenticated using (owner_id = auth.uid());
revoke insert, update on public.listings from authenticated, anon;
grant insert (owner_id, kind, title, city, area, address, lat, lng, near_university, available_from, available_to,
  size_m2, rent, lease_rent, tags, photos, landlord_name, landlord_email, active) on public.listings to authenticated;
grant update (kind, title, city, area, address, lat, lng, near_university, available_from, available_to,
  size_m2, rent, lease_rent, tags, photos, landlord_name, landlord_email, active) on public.listings to authenticated;

create policy "see swipes about me or my flats" on public.swipes for select to authenticated using (
  seeker_id = auth.uid() or exists (select 1 from listings l where l.id = listing_id and l.owner_id = auth.uid()));
create policy "swipe" on public.swipes for insert to authenticated with check (
  (by_role = 'seeker' and seeker_id = auth.uid())
  or (by_role = 'owner' and exists (select 1 from listings l where l.id = listing_id and l.owner_id = auth.uid())));

create policy "own stars" on public.stars for all to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());

create policy "record views" on public.listing_views for insert to authenticated with check (user_id = auth.uid());

create policy "see my matches" on public.matches for select to authenticated
  using (auth.uid() in (seeker_id, owner_id, landlord_id));

create policy "read chat" on public.messages for select to authenticated using (is_match_member(match_id));
create policy "write chat" on public.messages for insert to authenticated
  with check (sender_id = auth.uid() and kind = 'text' and is_match_member(match_id));

create policy "read contract" on public.contracts for select to authenticated using (is_match_member(match_id));

create policy "own checks" on public.verifications for select to authenticated using (user_id = auth.uid() or is_admin());

-- ============================================================
-- File storage
-- ============================================================
insert into storage.buckets (id, name, public) values ('listing-photos', 'listing-photos', true)
  on conflict (id) do nothing;
insert into storage.buckets (id, name, public) values ('verification', 'verification', false)
  on conflict (id) do nothing;

create policy "upload own flat photos" on storage.objects for insert to authenticated
  with check (bucket_id = 'listing-photos' and (storage.foldername(name))[1] = auth.uid()::text);
create policy "upload own documents" on storage.objects for insert to authenticated
  with check (bucket_id = 'verification' and (storage.foldername(name))[1] = auth.uid()::text);
create policy "read own documents or admin" on storage.objects for select to authenticated
  using (bucket_id = 'verification' and ((storage.foldername(name))[1] = auth.uid()::text or public.is_admin()));

-- ============================================================
-- Live updates for chat and contracts
-- ============================================================
alter publication supabase_realtime add table public.messages, public.matches, public.contracts;

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

-- The city of the student's home university, used to pre-fill their own flat's listing.
alter table public.profiles add column if not exists home_city text;
-- Which side a seeker who also lists a flat is looking at: 'seeker' or 'provider'.
alter table public.profiles add column if not exists view_mode text not null default 'seeker';
do $$ begin
  alter table public.profiles add constraint view_mode_values check (view_mode in ('seeker','provider'));
exception when duplicate_object then null; end $$;
grant update (home_city, view_mode) on public.profiles to authenticated;

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


-- ---------- Checks before saying yes ----------
-- Seekers can browse without checks. Saying yes to a flat needs both checks sent
-- (approved, or waiting for review). Scripts run from the SQL Editor aren't affected.
create or replace function public.require_checks_to_like() returns trigger
language plpgsql security definer set search_path = public as $$
declare p profiles;
begin
  if new.by_role <> 'seeker' or not new.liked or auth.uid() is null then return new; end if;
  select * into p from profiles where id = new.seeker_id;
  if p.id_status not in ('verified', 'pending') or p.student_status not in ('verified', 'pending', 'not_needed') then
    raise exception 'Verify your identity and student status before saying yes to a flat.';
  end if;
  return new;
end $$;
drop trigger if exists swipe_requires_checks on public.swipes;
create trigger swipe_requires_checks before insert on public.swipes
  for each row execute function public.require_checks_to_like();

-- ---------- Service fee ----------
-- 6% of one month's rent, rounded to the nearest whole unit, split between the two students.
alter table public.contracts add column if not exists seeker_fee int;
alter table public.contracts add column if not exists owner_fee int;
alter table public.contracts add column if not exists seeker_paid_at timestamptz;
alter table public.contracts add column if not exists owner_paid_at timestamptz;
alter table public.contracts add column if not exists seeker_payment_ref text;
alter table public.contracts add column if not exists owner_payment_ref text;

create or replace function public.fee_split(rent int, out total int, out seeker_part int, out owner_part int)
language sql immutable as $$
  select round(rent * 0.06)::int, round(round(rent * 0.06) / 2.0)::int,
         (round(rent * 0.06) - round(round(rent * 0.06) / 2.0))::int
$$;

-- Prototype payment: records the payment without charging anything.
-- A real launch would confirm the payment with a provider (Stripe, Adyen…) before this.
create or replace function public.pay_fee(m uuid) returns text
language plpgsql security definer set search_path = public as $$
declare
  mt matches;
  l listings;
  f record;
  ref text := 'FM-' || upper(encode(extensions.gen_random_bytes(4), 'hex'));
begin
  select * into mt from matches where id = m;
  if mt.id is null or not is_match_member(m) then raise exception 'You are not part of this lease.'; end if;
  if mt.status = 'chatting' then raise exception 'Agree on the terms in the chat first.'; end if;
  if auth.uid() not in (mt.seeker_id, mt.owner_id) then raise exception 'Only the two students pay the service fee.'; end if;
  select * into l from listings where id = mt.listing_id;
  select * into f from fee_split(l.rent);
  update contracts set seeker_fee = f.seeker_part, owner_fee = f.owner_part where match_id = m;
  if auth.uid() = mt.seeker_id then
    update contracts set seeker_paid_at = now(), seeker_payment_ref = ref where match_id = m and seeker_paid_at is null;
  else
    update contracts set owner_paid_at = now(), owner_payment_ref = ref where match_id = m and owner_paid_at is null;
  end if;
  -- Demo flats: their tenant pays their half straight away.
  if l.demo_auto_match then
    update contracts set owner_paid_at = now(), owner_payment_ref = 'FM-' || upper(encode(extensions.gen_random_bytes(4), 'hex'))
    where match_id = m and owner_paid_at is null;
  end if;
  return ref;
end $$;

-- Signing now needs your half of the fee paid first.
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
  if (auth.uid() = mt.seeker_id and c.seeker_paid_at is null) or (auth.uid() = mt.owner_id and c.owner_paid_at is null) then
    raise exception 'Pay your half of the Flatmate service fee before signing.';
  end if;
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
