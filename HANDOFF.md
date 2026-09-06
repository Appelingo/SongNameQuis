# IntroQ プロジェクト引き継ぎ

## 作りたいもの

ドライブ中の車内エンタメ用「イントロクイズアプリ」。

- ホストがルームを作り、全員の Apple Music ライブラリから曲を集めてプレイリストを作成
- ホスト端末だけが曲を再生（冒頭15秒 → 正解発表後にフル再生）
- ゲストは曲名をテキストで解答し、正解数でランキング
- リアルタイム同期は Supabase Realtime を使用

### ロール
- **ホスト**: ルーム作成・プレイリスト作成・再生制御・正解発表・次の曲へ
- **ゲスト**: ルーム参加・ライブラリ送信・解答入力

### データフロー
1. 全員が Apple Music 認証 → ライブラリ取得
2. ゲストの `{ title, artist }[]` を Supabase `participants.library_tracks` に保存
3. ホストが全員分をマージ・重複排除 → Apple Music にプレイリスト作成
4. ゲーム開始 → 冒頭15秒再生
5. ゲストが解答 → `answers` テーブルに INSERT（Realtime で共有）
6. ホストが正解発表 → 曲名表示 + フル再生
7. 次の曲へ → 最後まで繰り返し → 結果画面

---

## 技術スタック

- **フレームワーク**: React Native (Expo SDK 56) + TypeScript
- **バックエンド/DB**: Supabase（PostgreSQL + Realtime）
- **状態管理**: Zustand
- **音楽**: Apple MusicKit JS（Web のみ。`hooks/useMusicKit.ts`）
- **ナビゲーション**: React Navigation (native-stack)
- **環境変数**: `.env`（`EXPO_PUBLIC_*`）

### 環境変数（`.env`）
```
EXPO_PUBLIC_SUPABASE_URL=
EXPO_PUBLIC_SUPABASE_ANON_KEY=   # Publishable key (sb_publishable_...)
EXPO_PUBLIC_APPLE_MUSIC_DEVELOPER_TOKEN=  # JWT (scripts/generate-apple-music-token.js で生成)
```

### 起動方法
```bash
npm run web   # Web で開発（MusicKit は Web 専用）
# http://localhost:8081
```

---

## フォルダ構成

```
IntroQ/
├── App.tsx                    # ナビゲーション定義
├── index.ts                   # エントリ（process.versions パッチあり）
├── app.config.ts              # Expo 設定（extra に env を渡す）
├── .env / .env.example
│
├── screens/
│   ├── HomeScreen.tsx         # ルーム作成 / 参加
│   ├── LibraryImportScreen.tsx # Apple Music 認証 + ライブラリ送信
│   ├── HostLobbyScreen.tsx    # ホストロビー（参加者一覧・ゲーム開始）
│   └── GuestLobbyScreen.tsx   # ゲスト待機
│
├── navigation/
│   └── types.ts               # RootStackParamList
│
├── store/
│   ├── userStore.ts           # userName, participantId, isHost, hostClientId
│   └── roomStore.ts           # roomId, status, participants, playlistTracks 等
│
├── hooks/
│   ├── useMusicKit.ts         # Apple Music 認証・ライブラリ取得・プレイリスト作成
│   └── useRoomRealtime.ts     # rooms / participants の Realtime 購読
│
├── lib/
│   └── supabase.ts            # 型付き Supabase クライアント
│
├── types/
│   ├── database.ts            # Supabase 型定義
│   ├── musickit.ts
│   └── musickit.d.ts          # MusicKit JS グローバル型
│
├── scripts/
│   ├── generate-apple-music-token.js  # JWT 生成
│   └── AuthKey_*.p8           # Apple 秘密鍵（gitignore）
│
└── supabase/migrations/
    ├── 20250601000000_init.sql              # rooms, participants, answers
    └── 20250827000000_participants_realtime.sql
```

---

## アーキテクチャ

### 画面遷移（現状）
```
Home
  → LibraryImport（全員）
    → HostLobby（ホスト） / GuestLobby（ゲスト）
      → （未実装）HostQuiz / GuestQuiz
        → （未実装）Result
```

### Supabase テーブル
- `rooms`: id, host_id, status (lobby|playing|finished), playlist_tracks, current_track_index
- `participants`: id, room_id, user_name, library_tracks, score
- `answers`: id, room_id, participant_id, track_index, answer_text, is_correct

### Realtime（現状）
- ✅ `rooms` UPDATE（status, current_track_index）
- ✅ `participants` INSERT/UPDATE/DELETE
- ❌ `answers` INSERT 購読（未実装）
- ❌ Broadcast（正解発表 / 次の曲へ）（未実装）

### Zustand
- `useUserStore`: セッション情報（ホームでセット、画面間で共有）
- `useRoomStore`: ルーム状態・参加者・プレイリスト。`mergeAndDedupeTracks()` で曲マージ

### MusicKit（Web 専用）
- `hooks/useMusicKit.ts` が CDN から `musickit/v3/musickit.js` を動的読み込み
- Expo Web では `process.versions` が undefined のため、`index.ts` と `useMusicKit.ts` で `process.versions = null` パッチを適用
- `musickitloaded` イベント待ち → `MusicKit.configure()` → `authorize()` → ライブラリ API

---

## 実装済み

| 項目 | 状態 |
|------|------|
| Supabase マイグレーション | ✅ |
| lib/supabase.ts | ✅ |
| Zustand（user / room） | ✅ |
| useMusicKit（認証・ライブラリ・プレイリスト） | ⚠️ Web で Invalid token エラー |
| ホーム画面 | ✅ |
| ライブラリ取込画面 | ✅（ロード画面 UX あり） |
| ホスト / ゲストロビー | ✅ |
| useRoomRealtime | ✅（rooms + participants） |
| クイズ画面（ホスト / ゲスト） | ❌ |
| 結果画面 | ❌ |
| answers Realtime / Broadcast | ❌ |

---

## 既知の問題（ブロッカー）

### MusicKit `Invalid token`
- ブラウザで `MusicKit.configure()` 時に `Error: Invalid token` が発生
- Apple REST API（curl / node fetch）では同じ JWT で 200 が返る
- 想定原因: JWT の origin 制限、`.env` の読み込み、トークン形式（余分な引用符・改行）、Team ID / Key ID の不一致
- 対応候補: トークン再生成、`scripts/generate-apple-music-token.js` の TEAM_ID/KEY_ID 確認、origin 付き JWT、configure 直前のトークン検証ログ

### その他
- MusicKit は **Web のみ**（実機 iOS/Android ではライブラリ取込不可）
- Node.js は `>=20.19.4` 推奨（現状 v20.12 で警告）

---

## 今後の Plan

### Phase 0: ブロッカー解消（最優先）
1. MusicKit `Invalid token` の解消
2. ライブラリ取込 → ロビーまで E2E で通す

### Phase 1: ゲーム進行の土台
1. ロビー → クイズ画面への遷移（`rooms.status === 'playing'`）
2. ナビゲーションに `HostQuiz` / `GuestQuiz` 追加
3. ゲーム用 Zustand 拡張（現在曲、正解発表済み、解答送信済み）
4. Realtime: `answers` INSERT 購読、Broadcast（reveal_answer / next_track）

### Phase 2: クイズ画面（コア）
**ホスト**
- 冒頭15秒再生（setQueue → play → タイマーで pause）
- 再生/停止、参加者解答一覧
- 正解発表、次の曲へ

**ゲスト**
- 解答入力 + 送信
- 正解発表後に他参加者の解答表示

**共通**
- スコア更新、最終曲で `status = 'finished'` → 結果画面

### Phase 3: 結果画面
- 正解数ランキング、「ホームに戻る」

### Phase 4: 仕上げ
- E2E テスト、エラーハンドリング、UX（ルームIDコピー、進行表示）

---

## 実装時の注意

- Expo SDK 56 のドキュメントを参照: https://docs.expo.dev/versions/v56.0.0/
- 変更は最小限に。既存の命名・型・画面構成に合わせる
- `.p8` や `.env` はコミットしない
- 一度に全部作らず、Phase 単位で進める
- 実装後は「次に何を実装しますか？」と確認する流れでよい

---

## 参考: pre-prompt の画面一覧（未実装含む）

1. ホーム ✅
2. ライブラリ取込 ✅
3. ロビー（ホスト）✅
4. ロビー待機（ゲスト）✅
5. クイズ（ホスト）❌
6. クイズ（ゲスト）❌
7. 結果 ❌
