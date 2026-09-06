-- participants の Realtime 購読を有効化
alter table participants replica identity full;

-- publication への追加（既に追加済みならエラーになるので、必要に応じて手動で確認）
-- alter publication supabase_realtime add table public.participants;
