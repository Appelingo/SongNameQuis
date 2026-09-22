-- IntroQ: 出題曲の供給源をルームごとに選べるようにする（判断 10）
--
-- 'library' : 参加者のライブラリから出題（従来）
-- 'preset'  : Apple Music のジャンル別人気チャートから出題
--
-- preset では誰もライブラリを出さないため、ライブラリ取込画面を通さない。
-- その判定にこの列を使う。

begin;

create type source_mode as enum ('library', 'preset');
alter table rooms add column source_mode source_mode not null default 'library';

-- 選んだジャンル（preset のときのみ使う）。Apple の genre id と表示名。
alter table rooms add column genre_id text;
alter table rooms add column genre_name text;

commit;
