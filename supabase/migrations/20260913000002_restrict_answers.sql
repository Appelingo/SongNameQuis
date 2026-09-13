-- IntroQ: answers の閲覧も同じルームの参加者に限定する
--
-- participants は同ルーム限定にしたが、answers を絞り忘れていた。
-- 実測したところ、匿名サインインしただけで他人の answer_text が読める状態だった。
--
-- 解答入力機能は判断 6 で廃止済みのため新規データは増えないが、
-- 過去データが残っており、一貫性の観点からも塞いでおく。

begin;

drop policy if exists "answers_select" on answers;
create policy "answers_select" on answers
  for select to authenticated
  using (public.is_room_member(room_id));

commit;
