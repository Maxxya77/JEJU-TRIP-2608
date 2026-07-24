-- Firebase Firestore -> Supabase 마이그레이션 스키마
-- Supabase 대시보드 > SQL Editor 에 전체 붙여넣고 실행하세요.

create extension if not exists pgcrypto;

-- ---------------------------------------------------------
-- places: ALL_PLACES(하드코딩 40개) + custom_places + hidden_places 통합
-- ---------------------------------------------------------
create table places (
  id          text primary key,
  name        text not null,
  category    text not null,
  lat         double precision not null,
  lng         double precision not null,
  description text,
  url         text,
  is_hidden   boolean not null default false,
  created_at  timestamptz not null default now()
);

-- ---------------------------------------------------------
-- schedule: trip_schedule_v6
-- ---------------------------------------------------------
create table schedule (
  id          uuid primary key default gen_random_uuid(),
  day         text not null check (day in ('d1','d2','d3','d4')),
  place_id    text not null references places(id),
  time        text,
  memo        text not null default '',
  sort_order  bigint not null,
  created_at  timestamptz not null default now()
);

-- ---------------------------------------------------------
-- packing_items: packing_items_v3
-- ---------------------------------------------------------
create table packing_items (
  id          uuid primary key default gen_random_uuid(),
  text        text not null,
  seunghyun   boolean not null default false,
  soyoung     boolean not null default false,
  sort_order  bigint not null,
  created_at  timestamptz not null default now()
);

-- ---------------------------------------------------------
-- presence
-- ---------------------------------------------------------
create table presence (
  who         text primary key check (who in ('seunghyun','soyoung')),
  last_seen   bigint
);

-- ---------------------------------------------------------
-- RLS: 켜고 anon(공개 anon key 사용자)에게 전체 허용
-- 2인 전용 앱, 인증 시스템 없음 -> 지금은 전체 허용, 나중에 인증 추가 시 정책만 교체
-- ---------------------------------------------------------
alter table places enable row level security;
alter table schedule enable row level security;
alter table packing_items enable row level security;
alter table presence enable row level security;

create policy "anon full access" on places
  for all to anon using (true) with check (true);

create policy "anon full access" on schedule
  for all to anon using (true) with check (true);

create policy "anon full access" on packing_items
  for all to anon using (true) with check (true);

create policy "anon full access" on presence
  for all to anon using (true) with check (true);

-- ---------------------------------------------------------
-- Realtime: onSnapshot 대체를 위해 각 테이블을 publication에 추가
-- ---------------------------------------------------------
alter publication supabase_realtime add table places;
alter publication supabase_realtime add table schedule;
alter publication supabase_realtime add table packing_items;
alter publication supabase_realtime add table presence;
