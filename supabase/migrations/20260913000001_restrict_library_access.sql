-- IntroQ: ライブラリの閲覧範囲を絞り、使い終わったら消す
--
-- participants.library_tracks には参加者の Apple Music ライブラリが「全曲」入る。
-- 音楽の趣味は個人を推測させ得る情報なので、
--   1) 同じルームの参加者以外には見せない
--   2) 出題リストを作った時点で消す（保持期間を最小化する）
-- の 2 点で扱いを絞る。

begin;

-- 1) 自分が参加しているルームかどうかを判定する
--
--    participants のポリシー内で participants を参照すると RLS が再帰するため、
--    security definer 関数に逃がす（関数の中では RLS が適用されない）。
create or replace function public.is_room_member(target_room uuid)
returns boolean
language sql
security definer
stable
set search_path = public
as $$
  select exists (
    select 1 from participants
    where room_id = target_room
      and user_id = auth.uid()
  );
$$;

revoke all on function public.is_room_member(uuid) from public;
grant execute on function public.is_room_member(uuid) to authenticated;

-- 2) participants の閲覧を同じルームの参加者に限定する
--
--    user_id = auth.uid() を or で残しているのは、参加直後に
--    insert ... returning で自分の行を読み返すため。
--    ルーム所属の判定だけに頼ると、その一瞬で弾かれる可能性がある。
drop policy if exists "participants_select" on participants;
create policy "participants_select" on participants
  for select to authenticated
  using (
    user_id = auth.uid()
    or public.is_room_member(room_id)
  );

-- 3) 出題リスト確定後にライブラリを消すための関数
--
--    ホストは他人の participants 行を更新できない（所有権ベースの RLS）ため、
--    security definer 関数を通す。ホスト本人かどうかは関数の中で検証する。
create or replace function public.clear_room_libraries(target_room uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not exists (
    select 1 from rooms
    where id = target_room
      and host_user_id = auth.uid()
  ) then
    raise exception 'このルームのホストのみ実行できます';
  end if;

  update participants
    set library_tracks = '[]'::jsonb
    where room_id = target_room;
end;
$$;

revoke all on function public.clear_room_libraries(uuid) from public;
grant execute on function public.clear_room_libraries(uuid) to authenticated;

commit;
