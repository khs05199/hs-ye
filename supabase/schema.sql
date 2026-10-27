-- =====================================================================
-- HS & YE — Supabase 설정 SQL
-- Supabase 대시보드 > SQL Editor > New query 에 전체를 붙여넣고 Run 하세요.
-- ★ 먼저 아래 두 이메일을 우리 둘의 실제 이메일(소문자)로 바꿔 주세요. ★
-- =====================================================================

create or replace function public.is_couple()
returns boolean language sql stable as $$
  select lower(coalesce(auth.jwt() ->> 'email', '')) = any (array[
    'khs05199@gmail.com',          -- HS
    '예은이이메일@example.com'       -- YE  ← 바꿔 주세요
  ]);
$$;

-- 네 개의 표: 장소, 플랜, 추억, 설정. 각 줄은 id + data(JSON)
create table if not exists public.places   (id text primary key, data jsonb not null, updated_at timestamptz default now());
create table if not exists public.plans    (id text primary key, data jsonb not null, updated_at timestamptz default now());
create table if not exists public.memories (id text primary key, data jsonb not null, updated_at timestamptz default now());
create table if not exists public.meta     (id text primary key, data jsonb not null, updated_at timestamptz default now());

-- 우리 둘만 읽고 쓸 수 있게 잠그기
do $$
declare t text;
begin
  foreach t in array array['places','plans','memories','meta'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('drop policy if exists couple_all on public.%I', t);
    execute format('create policy couple_all on public.%I for all to authenticated using (public.is_couple()) with check (public.is_couple())', t);
    execute format('alter table public.%I replica identity full', t);
  end loop;
end $$;

-- 실시간 동기화 켜기 (한 명이 바꾸면 다른 폰에 바로 반영)
do $$
declare t text;
begin
  foreach t in array array['places','plans','memories','meta'] loop
    begin
      execute format('alter publication supabase_realtime add table public.%I', t);
    exception when duplicate_object then null;
    end;
  end loop;
end $$;

-- 사진 저장소 (비공개)
insert into storage.buckets (id, name, public)
values ('photos', 'photos', false)
on conflict (id) do nothing;

drop policy if exists couple_photos_select on storage.objects;
drop policy if exists couple_photos_insert on storage.objects;
drop policy if exists couple_photos_update on storage.objects;
drop policy if exists couple_photos_delete on storage.objects;
create policy couple_photos_select on storage.objects for select to authenticated using (bucket_id = 'photos' and public.is_couple());
create policy couple_photos_insert on storage.objects for insert to authenticated with check (bucket_id = 'photos' and public.is_couple());
create policy couple_photos_update on storage.objects for update to authenticated using (bucket_id = 'photos' and public.is_couple());
create policy couple_photos_delete on storage.objects for delete to authenticated using (bucket_id = 'photos' and public.is_couple());
