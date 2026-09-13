-- IntroQ: 匿名認証を前提とした所有権ベースの RLS（判断 9 / T5-2）
--
-- これまでは認証が無く、ポリシーがすべて using (true) だった。
-- anon key はバンドルに埋め込まれ公開されるため、鍵を持つ誰でも
-- 全ルームを書き換えられる状態だった。
--
-- 【重要】適用前に Supabase ダッシュボードで
--   Authentication → Sign In / Providers → Anonymous sign-ins
-- を有効にすること。無効のままだとアプリが一切動かなくなる。
--
-- 全体をトランザクションで囲んでいる。
-- ポリシーを drop した直後に create が失敗すると、RLS が有効なのにポリシーが
-- 1 つも無い状態（＝全アクセス拒否）でアプリが停止するため、途中で失敗したら
-- まとめて巻き戻す。
--
-- なお行・テーブル・カラムを削除する操作は含まれていない。
-- ダッシュボードが destructive と警告するのは drop policy に対してであり、
-- そのポリシーは同じスクリプト内で作り直している。

begin;

-- 1) 所有者を記録する列を追加
alter table rooms add column if not exists host_user_id uuid;
alter table participants add column if not exists user_id uuid;

create index if not exists idx_rooms_host_user_id on rooms(host_user_id);
create index if not exists idx_participants_user_id on participants(user_id);

-- 2) 既存の全開ポリシーを破棄
drop policy if exists "rooms_select" on rooms;
drop policy if exists "rooms_insert" on rooms;
drop policy if exists "rooms_update" on rooms;
drop policy if exists "participants_select" on participants;
drop policy if exists "participants_insert" on participants;
drop policy if exists "participants_update" on participants;
drop policy if exists "answers_select" on answers;
drop policy if exists "answers_insert" on answers;
drop policy if exists "answers_update" on answers;

-- 3) rooms: 読み取りは認証済みなら可、書き換えはホストのみ
--    SELECT を開けているのは、ルームコードから参加するために検索が要るため。
--    結果として列挙は防げないが、書き換えを防ぐことを優先する（判断 9）。
create policy "rooms_select" on rooms
  for select to authenticated using (true);

create policy "rooms_insert" on rooms
  for insert to authenticated with check (host_user_id = auth.uid());

create policy "rooms_update" on rooms
  for update to authenticated
  using (host_user_id = auth.uid())
  with check (host_user_id = auth.uid());

-- 4) participants: 自分の行だけ作成・更新できる
create policy "participants_select" on participants
  for select to authenticated using (true);

create policy "participants_insert" on participants
  for insert to authenticated with check (user_id = auth.uid());

create policy "participants_update" on participants
  for update to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

-- 5) answers: 判断 6 で未使用になったが、念のため本人のみに絞っておく
create policy "answers_select" on answers
  for select to authenticated using (true);

create policy "answers_insert" on answers
  for insert to authenticated
  with check (
    participant_id in (select id from participants where user_id = auth.uid())
  );

create policy "answers_update" on answers
  for update to authenticated
  using (
    participant_id in (select id from participants where user_id = auth.uid())
  );

-- DELETE はどのテーブルにもポリシーを作らない（＝すべて拒否される）

commit;
