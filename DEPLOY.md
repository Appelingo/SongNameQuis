# IntroQ デプロイ手順

> 公開先: **https://song-name-quis.vercel.app/** （2026-09-13 公開・再生まで動作確認済み）
> 対象: Vercel への公開 / 最終更新 2026-09-13
> 関連: [PLAN.md](PLAN.md)（設計判断）, [TASKS.md](TASKS.md)（実装指示）

このアプリは**完全な静的サイト**です。サーバーサイドの処理は 1 行もありません。
バックエンドは Supabase（ホスト済み）と Apple Music API だけなので、
EC2 のようなサーバーは不要で、無料の静的ホスティングで足ります。

---

## 0. 前提（これが済んでいないと動きません）

| # | 項目 | 確認方法 |
|---|------|----------|
| 1 | **Supabase の匿名サインインが有効** | Authentication → Sign In / Providers → Anonymous sign-ins が ON |
| 2 | **マイグレーションが全て適用済み** | 下の SQL で確認 |
| 3 | **Realtime の publication に 3 テーブルが登録済み** | 下の SQL で確認 |

1 が未設定だと、RLS が `auth.uid()` を要求するのに誰もサインインできず、**アプリが一切動きません**（判断 9）。

```sql
-- マイグレーションの適用状況をまとめて確認
select
  (select count(*) from information_schema.columns
    where table_name='rooms' and column_name='phase')          as rooms_phase,
  (select count(*) from information_schema.columns
    where table_name='rooms' and column_name='code')           as rooms_code,
  (select count(*) from information_schema.columns
    where table_name='rooms' and column_name='host_user_id')   as rooms_host_user_id,
  (select count(*) from information_schema.columns
    where table_name='participants' and column_name='skipped_library') as skipped_library,
  (select count(*) from information_schema.columns
    where table_name='participants' and column_name='user_id') as participants_user_id;
-- すべて 1 なら OK

-- Realtime の配信対象（rooms / participants / answers の 3 つが必要）
select tablename from pg_publication_tables where pubname = 'supabase_realtime';

-- RLS のポリシーと関数（判断 9・ライブラリ保護）
select tablename, policyname from pg_policies
where schemaname = 'public' order by tablename, policyname;
-- rooms / participants / answers に select・insert・update が揃っていれば OK

select proname from pg_proc
where proname in ('is_room_member', 'clear_room_libraries');
-- 2 行返れば OK
```

### マイグレーションの適用順

`supabase/migrations/` の**ファイル名の順**に SQL Editor で実行します。
最後の 2 本は今回追加したものです。

| ファイル | 内容 |
|---|---|
| `20260913000000_auth_rls.sql` | 匿名認証前提の所有権ベース RLS（判断 9） |
| `20260913000001_restrict_library_access.sql` | ライブラリの閲覧制限と、使用後の削除関数 |

どちらもトランザクションで囲んであるので、途中で失敗すれば巻き戻ります。

---

## 1. 環境変数

ビルド時に JS バンドルへ**埋め込まれます**。Vercel の管理画面で設定してください。

| 変数名 | 内容 |
|--------|------|
| `EXPO_PUBLIC_SUPABASE_URL` | Supabase のプロジェクト URL |
| `EXPO_PUBLIC_SUPABASE_ANON_KEY` | Supabase の publishable key |
| `EXPO_PUBLIC_APPLE_MUSIC_DEVELOPER_TOKEN` | Apple Music の developer token（JWT） |

> **3 つとも公開されます。** `EXPO_PUBLIC_*` は仕様上バンドルに焼き込まれ、
> 誰でもブラウザから抽出できます。これは避けられません。
> だからこそ RLS を所有権ベースにしてあります（判断 9）。

ローカルの値は `.env` にあります（`.gitignore` 済み。**絶対にコミットしない**）。

---

## 2. デプロイ

### 方法 A: Git 連携（推奨）

一度設定すれば、以降は push するだけで公開されます。

1. GitHub にリポジトリを push する
2. [vercel.com](https://vercel.com) で **Add New → Project** → そのリポジトリを選ぶ
3. ビルド設定は `vercel.json` に書いてあるので**そのままで良い**
   - Build Command: `npx expo export --platform web`
   - Output Directory: `dist`
4. **Environment Variables** に上記 3 つを登録する
5. **Deploy**

### 方法 B: CLI で手早く

```bash
npm install -g vercel   # 初回のみ
vercel login

# ローカルでビルドしたものをそのまま上げる
npm run build:web
vercel deploy dist --prod
```

この方法だと環境変数は**ローカルの `.env` の値がビルド時に焼き込まれます**。
Vercel 側の環境変数設定は不要ですが、値を変えるたびに手元でビルドし直す必要があります。

---

## 3. 公開直後に必ず確認すること

**最優先: Apple Music の認証が新しいドメインで通るか。**

> **【2026-09-13 実測】`song-name-quis.vercel.app` では、Apple 側への追加登録なしで
> 認証・ライブラリ取込・再生まで通った。** 長く未確認だった T0-1 はこれで決着。
> ただし独自ドメインに変える場合は、再度ここから確認すること。

弾かれる場合は、Apple Developer の
Certificates, Identifiers & Profiles → **Media IDs** の MusicKit Identifier に
デプロイ先ドメインを登録する必要があります。

順に確認してください。

1. サイトを開く → ホーム画面が出る（= 匿名サインイン成功）
2. ルームを作る → **ルームコードが表示される**（= RLS の insert が通っている）
3. ライブラリ取込 → **Apple Music の認証ポップアップが出て、曲一覧が表示される** ← ここが関門
4. 別の端末からコードで参加 → **ホストのロビーに即座に表示される**（= Realtime が動いている）
5. ゲーム開始 → イントロ再生 → 正解を見る → 次の曲
6. 最後まで進む → 流れた曲一覧が出る

3 で失敗する場合は、ブラウザの Console と Network を見て、
Apple が返しているエラー内容をそのまま読んでください（推測しないこと）。

---

## 4. 既知の制約

| 項目 | 内容 | 対応 |
|------|------|------|
| **トークンの期限** | Apple developer token は **2027-02-23** に失効 | `node scripts/generate-apple-music-token.js` で再発行 → 環境変数を更新 → **再デプロイ** |
| **Supabase の一時停止** | 無料プランは 1 週間アクセスが無いとプロジェクトが停止 | 遊ぶ前にダッシュボードから復帰させる |
| **ルーム列挙** | 匿名サインインすれば全ルームのニックネームと曲名は読める | 意図的に残した穴（判断 9）。書き換えは防いである |
| **匿名ユーザーの蓄積** | `auth.users` に溜まり続ける | 1 ブラウザ 1 ユーザーなので通常は問題にならない。増えすぎたら古い行を削除 |
| **ライブラリ取込には Apple Music 契約が必要** | 曲を提供する人のみ。**再生には不要** | ゲストは「曲を追加せずに参加」で契約なしでも遊べる（判断 5） |

**再生に DRM を使わなくなった**ため（判断 8）、ホストのブラウザは Safari でなくても構いません。

---

## 5. スキーマ変更を伴う更新の順序（重要）

**Vercel は Git 連携のため、`git push` した瞬間に本番へ反映されます。**
マイグレーションを伴う変更では、順序を間違えると本番が壊れます。

```
誤: push → 公開される → まだ DB にカラムが無い → ルーム作成が失敗
正: マイグレーション適用 → 適用を確認 → push
```

**必ずこの順で行うこと。**

1. Supabase の SQL Editor でマイグレーションを適用
2. 下のクエリで適用されたことを**確認**
3. それから `git push`

```sql
-- 例: 追加したカラムが存在するか確認してから push する
select column_name from information_schema.columns
where table_name = 'rooms' order by column_name;
```

> 実際に 2026-09-22、`source_mode` のマイグレーション適用前に push してしまい、
> 本番のルーム作成が一時的に失敗する状態になった。

新しいカラムには**必ず `default` を付ける**こと。既存行が埋まらないと、
適用した瞬間に既存データが不正になります。

---

## 6. 更新・切り戻し

- **更新**: Git 連携なら push するだけ。CLI なら `npm run build:web && vercel deploy dist --prod`
- **切り戻し**: Vercel の Deployments 一覧から以前のデプロイを選び **Promote to Production**
- **環境変数を変えたとき**: Vercel は自動で再ビルドしないので、**手動で Redeploy が必要**
