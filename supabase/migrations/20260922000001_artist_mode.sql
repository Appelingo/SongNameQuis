-- IntroQ: アーティストを指定して出題するモード（判断 11）
--
-- source_mode に 'artist' を追加し、選んだアーティストをルームに記録する。
-- 複数アーティストを選べるため jsonb の配列で持つ。
--
-- 【冪等性】途中まで適用された状態から再実行しても通るように書いてある。

begin;

-- enum への値追加。既にあれば何もしない
do $$
begin
  if not exists (
    select 1 from pg_enum e
    join pg_type t on t.oid = e.enumtypid
    where t.typname = 'source_mode' and e.enumlabel = 'artist'
  ) then
    alter type source_mode add value 'artist';
  end if;
end
$$;

-- 選んだアーティスト: [{ id, name }, ...]
-- storefront と対で扱う（アーティスト ID もストアフロント依存のため）
alter table rooms add column if not exists artists jsonb not null default '[]'::jsonb;

commit;
