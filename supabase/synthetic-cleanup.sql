-- ============================================================
-- Removes ALL synthetic data created by synthetic-data.sql:
-- the fake accounts, their flats, and every swipe, star, view, match,
-- message and contract linked to them. Real accounts are not touched.
-- Run in Supabase → SQL Editor → New query → paste → Run.
-- ============================================================
delete from auth.users where email like '%@synthetic.flatmate.test';

select count(*) as synthetic_accounts_left from auth.users where email like '%@synthetic.flatmate.test';
