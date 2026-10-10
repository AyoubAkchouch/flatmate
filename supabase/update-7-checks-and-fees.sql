-- ============================================================
-- Update 7: seekers verify only when they first say yes to a flat,
-- and Flatmate's service fee is paid before signing.
-- Run once in Supabase → SQL Editor → New query → paste → Run.
-- Needs update 6 first. (Already included in schema.sql for new projects.)
-- ============================================================

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
