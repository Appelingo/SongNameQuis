-- IntroQ: イントロクイズアプリ 初期スキーマ

create extension if not exists "pgcrypto";

-- ルーム状態
create type room_status as enum ('lobby', 'playing', 'finished');

-- ルーム
create table rooms (
  id uuid primary key default gen_random_uuid(),
  host_id uuid not null,
  status room_status not null default 'lobby',
  playlist_tracks jsonb not null default '[]'::jsonb,
  current_track_index int not null default 0,
  created_at timestamptz not null default now()
);

-- 参加者
create table participants (
  id uuid primary key default gen_random_uuid(),
  room_id uuid not null references rooms(id) on delete cascade,
  user_name text not null,
  library_tracks jsonb not null default '[]'::jsonb,
  score int not null default 0,
  created_at timestamptz not null default now(),
  unique (room_id, user_name)
);

-- 解答
create table answers (
  id uuid primary key default gen_random_uuid(),
  room_id uuid not null references rooms(id) on delete cascade,
  participant_id uuid not null references participants(id) on delete cascade,
  track_index int not null,
  answer_text text not null,
  is_correct boolean,
  answered_at timestamptz not null default now()
);

create index idx_participants_room_id on participants(room_id);
create index idx_answers_room_id on answers(room_id);
create index idx_answers_room_track on answers(room_id, track_index);

-- Realtime 用
alter table rooms replica identity full;
alter table answers replica identity full;

-- RLS（MVP: 匿名アクセス可。本番では Supabase Auth と連携して絞る）
alter table rooms enable row level security;
alter table participants enable row level security;
alter table answers enable row level security;

create policy "rooms_select" on rooms for select using (true);
create policy "rooms_insert" on rooms for insert with check (true);
create policy "rooms_update" on rooms for update using (true);

create policy "participants_select" on participants for select using (true);
create policy "participants_insert" on participants for insert with check (true);
create policy "participants_update" on participants for update using (true);

create policy "answers_select" on answers for select using (true);
create policy "answers_insert" on answers for insert with check (true);
create policy "answers_update" on answers for update using (true);
