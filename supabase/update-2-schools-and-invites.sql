-- ============================================================
-- Update 2: official school lists, stricter landlord invitations.
-- Run once in Supabase → SQL Editor → New query → paste → Run.
-- (Already included in schema.sql for new projects.)
-- ============================================================

-- Where the student studies at home and where they're going (with GPS for travel times).
alter table public.profiles add column if not exists home_university_ror text;
alter table public.profiles add column if not exists host_campus text;
alter table public.profiles add column if not exists host_lat double precision;
alter table public.profiles add column if not exists host_lng double precision;
grant update (home_university_ror, host_campus, host_lat, host_lng) on public.profiles to authenticated;

-- What an invitation is about, shown before the landlord decides to join.
create or replace function public.invite_preview(token text)
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
create or replace function public.accept_invite(token text) returns uuid
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
