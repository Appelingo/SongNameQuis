-- IntroQ: 出題曲の供給源をルームごとに選べるようにする（判断 10）
--
-- 'library' : 参加者のライブラリから出題（従来）
-- 'preset'  : Apple Music のジャンル別人気チャートから出題
--
-- preset では誰もライブラリを出さないため、ライブラリ取込画面を通さない。
-- その判定にこの列を使う。
--
-- 【冪等性】このファイルは途中まで適用された状態から再実行しても通るように
-- 書いてある（型の重複作成を避け、列は if not exists を使う）。

begin;

-- enum は create type ... if not exists が使えないため、存在確認してから作る
do $$
begin
  if not exists (select 1 from pg_type where typname = 'source_mode') then
    create type source_mode as enum ('library', 'preset');
  end if;
end
$$;

alter table rooms
  add column if not exists source_mode source_mode not null default 'library';

-- 選んだジャンル（preset のときのみ使う）。Apple の genre id と表示名。
--
-- 【注意】ジャンル ID はストアフロント（国）ごとに異なる。
-- 例: jp の 27 は J-Pop だが、us/kr で 27 を指定すると
--     400 "Genre '27' is not allowed" になる。
-- そのため storefront と genre_id は必ず対で扱うこと。
alter table rooms add column if not exists storefront text not null default 'jp';
alter table rooms add column if not exists storefront_name text;
alter table rooms add column if not exists genre_id text;
alter table rooms add column if not exists genre_name text;

commit;
