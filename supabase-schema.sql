-- Run this in your Supabase SQL editor at:
-- https://supabase.com/dashboard/project/grevzwujtthmopxkjyhn/sql

create table if not exists donors (
  id text primary key,
  first_name text,
  last_name text,
  address text,
  city text,
  zip text,
  total_donated numeric,
  num_donations integer,
  offices text,
  candidates_donated_to text,
  donor_score integer,
  tier text,
  updated_at timestamptz default now()
);

create table if not exists donations (
  id text primary key,
  donor_id text references donors(id) on delete cascade,
  seq integer,
  amount numeric,
  rpt_year integer,
  file_date text,
  office text,
  candidate_first text,
  candidate_last text,
  com_name text,
  emp_occupation text,
  report_description text
);

create index if not exists donations_donor_id_idx on donations(donor_id);
create index if not exists donors_score_idx on donors(donor_score desc);
create index if not exists donors_tier_idx on donors(tier);
create index if not exists donors_zip_idx on donors(zip);

-- Allow public read/write (no auth needed per requirements)
alter table donors enable row level security;
alter table donations enable row level security;

create policy "Public read donors" on donors for select using (true);
create policy "Public write donors" on donors for all using (true);
create policy "Public read donations" on donations for select using (true);
create policy "Public write donations" on donations for all using (true);
