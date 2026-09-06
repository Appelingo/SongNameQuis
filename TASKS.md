# IntroQ 実装指示書

> 対象: [PLAN.md](PLAN.md) の Phase 0〜7 / 設計判断はすべて **A 案で確定済み**
> 前提資料: [PLAN.md](PLAN.md), [HANDOFF.md](HANDOFF.md), [AGENTS.md](AGENTS.md)

---

## 実装状況（2026-09-03 時点）

| Phase | 状態 | 備考 |
|-------|------|------|
| Phase 0 コード（T0-2〜T0-6） | ✅ 実装済み | **T0-1（`Invalid token` の切り分け）は未着手。Apple Developer Portal での確認が必要** |
| Phase 1（T1-1〜T1-8） | ✅ 実装済み | マイグレーションは**ファイル作成のみ。DB への適用は手動で未実施** |
| Phase 2（T2-1〜T2-4） | ✅ 実装済み | ブラウザでの動作確認は未実施 |
| Phase 3（T3-1） | ✅ 実装済み | 同上 |
| Phase 4（T4-1〜T4-4） | ✅ 実装済み | T4-4 は既存挙動で要件を満たすことを確認しただけ |
| Phase 5（T5-1〜T5-5） | ❌ 未着手 | 判断・実機作業が必要 |
| Phase 6（ネイティブ化） | ❌ 未着手 | 任意 |
| **Phase 7（曲なし参加）** | ❌ **これから実装** | 判断 5。以下 T7-1〜T7-6 |

**未検証であることに注意。** Phase 0〜4 は型チェックとバンドルが通ることまでしか確認できていません。
MusicKit の認証・再生を含む実動作は、ブラウザでの手動テストが必要です。

> ### 【2026-09-06】ホストは Safari を使うこと
> Apple Music の本編再生は DRM で保護されている。Safari は FairPlay、Chrome は Widevine を使うが、
> **Chrome は Widevine を提供しておらず**、MusicKit が Widevine 用ストリームを選んだ時点で
> `MEDIA_LICENSE`（`-42191`）で失敗する。Safari では正常に再生される。
> 詳細と切り分けの経緯は [PLAN.md §9](PLAN.md)。**ゲストは音を鳴らさないのでブラウザは何でもよい。**
>
> 併せて、**`process` シムによる Node 環境誤検出**という実バグを 1 件修正済み
> （`hooks/useMusicKit.ts` の `withProcessHidden()`）。これが無いと `setQueue()` が
> 例外もリクエストも出さないままキューが空になる。

**実装中に見つけて直した設計バグ**（指示書に無かったもの）:
`rooms.host_id` がクライアント生成の無関係な UUID だったため、参加者一覧からホストの行を特定できなかった。
`HomeScreen` でルーム作成後に `host_id` を**ホストの `participants.id`** へ更新するよう修正済み。
結果画面のホスト除外・出題者名表示はこれに依存しています。

---

## 進め方のルール

1. **タスクは番号順に実施する。** 依存関係を考慮した順序になっています。
   例外は「並行可」と明記したもの。
2. **1 タスク = 1 コミット**を目安にする。
3. 各タスクの **完了条件** を満たしてから次に進む。満たせない場合は先に進まず、原因を報告する。
4. **既存の命名・型・スタイルに合わせる。** 新しいライブラリを勝手に追加しない。
   色・レイアウトは既存画面（`#0f0f14` 背景 / `#007AFF` プライマリ / `#1c1c24` カード）を踏襲する。
5. Expo の API を触る際は必ず https://docs.expo.dev/versions/v56.0.0/ の**該当ページ**を読む（[AGENTS.md](AGENTS.md)）。
6. 型チェックは `npx tsc --noEmit` で行う。**タスク完了時に必ず通す。**
7. `.env` と `scripts/AuthKey_*.p8` は絶対にコミットしない。

### 迷ったときの判断基準

- **推測でコードを書かない。** MusicKit の挙動が読めないときは、
  `curl -sL https://js-cdn.music.apple.com/musickit/v3/musickit.js` でバンドルを落として該当箇所を読む。
  Apple の Web ドキュメントは 404 や記述漏れが多く、当てになりません（[PLAN.md §8](PLAN.md) 参照）。
- **UI の作り込みより、状態が壊れないことを優先する。**

---

## 検証済みの前提（推測ではありません）

MusicKit v3 バンドル（`3.2526.0`）を実際に解析した結果です。この通りに書いてください。

| 事項 | 結論 |
|------|------|
| `instance.api` の実体 | `MediaAPIV3` インスタンス |
| `api.music(path, queryParameters, options)` | **存在する。これを使う** |
| `api.post(...)` | **存在しない。使うと `is not a function` で落ちる** |
| POST の body | 自動で `JSON.stringify` されない。**手動で文字列化し `Content-Type` も明示する** |
| `Authorization` / `Media-User-Token` ヘッダ | **自動付与される。自分で付けない** |
| クエリパラメータ | 第 2 引数のオブジェクトで渡す。**自分で `encodeURIComponent` しない** |
| ストアフロント | パスに `{{storefrontId}}` と書けば置換される。**`jp` をハードコードしない** |
| 戻り値 | `{ data }`。ライブラリ取得では `result.data.data` が配列（既存の `unwrapMusicData` の二段アンラップは正しい） |
| `playParams.catalogId` | 実在する。ライブラリ曲のカタログ ID はここから取る |

---

# Phase 0 — 音を鳴らせる状態にする

**この Phase が終わるまで、クイズ画面を書いても検証できません。最優先。**

---

## T0-1 `Invalid token` の原因切り分け（コード変更なし）

**目的**: `MusicKit.configure()` が `Invalid token` を返す原因を、推測ではなく事実として特定する。

**前提（調査済み・再調査不要）**: `.env` の JWT はデコード済みで、
ES256 / `kid` / `iss=RL375LBE96` / 有効期間 180 日ちょうど / 未期限 / 引用符・改行なし。
**形式に問題はありません。トークンの再生成や `scripts/generate-apple-music-token.js` の TEAM_ID/KEY_ID 見直しは行わないでください。**

**やること**（上から順に）:

1. `npm run web` でアプリを開き、DevTools の **Network タブ**で `configure()` が発行するリクエストを特定する。
   **レスポンス本文をそのまま記録する。** Apple が返している理由が答えです。
2. Apple Developer Portal → Certificates, Identifiers & Profiles → **Media IDs** を開き、
   以下を目視確認して記録する:
   - **MusicKit Identifier** が作成されているか
   - そこに開発用オリジン（`http://localhost:8081`）と、将来の配信ドメインが登録されているか
   - Keys の鍵 `47WQV53S52` が **Media Services (MusicKit) 有効**で作られ、その Identifier に紐付いているか
3. 上記 2 に不足があれば設定して再試行する。
4. それでも直らない場合のみ、`ngrok http 8081` などで https の一時ドメインを取り、
   そのドメインを Media ID に登録して再試行する。
   → **localhost が原因なのか / キー設定が原因なのか**の切り分けになる。

**仮説（確度順）**: ① オリジン未登録 ② キーが MusicKit 用でない ③ localhost 非対応。
REST（curl）が 200 を返すのにブラウザだけ落ちるのは、**REST がオリジンを検証しないから**です。

**完了条件**: `LibraryImportScreen` を開くと `Invalid token` が出ず、「準備ができました」画面に到達する。

**このタスクが長引く場合**: T0-2 〜 T0-5 はトークン問題と**完全に独立**しているので、
先にそちらを進めてください。ブロックされたままにしないこと。

---

## T0-2 `types/musickit.d.ts` を実仕様に合わせて書き直す

**目的**: 型定義が実物とズレているため、間違ったコードがコンパイルを通ってしまう。
先に型を正しくして、誤った呼び出し（`api.post`）をコンパイルエラーにする。

**対象**: `types/musickit.d.ts`（全面置き換え）

```ts
interface Window {
  MusicKit?: typeof MusicKit;
}

declare const MusicKit: {
  configure(config: {
    developerToken: string;
    app: { name: string; build: string };
  }): Promise<MusicKitInstance>;
  getInstance(): MusicKitInstance;
};

/** api.music の第 3 引数。fetchOptions はそのまま fetch() に渡される */
interface MusicKitRequestOptions {
  fetchOptions?: {
    method?: 'GET' | 'POST' | 'PUT' | 'DELETE';
    headers?: Record<string, string>;
    body?: string;
  };
  urlParameters?: Record<string, string>;
}

/** ミドルウェアは { request, response, data } を返すが、使うのは data だけ */
interface MusicKitResponse<T = unknown> {
  data: T;
}

interface MusicKitInstance {
  isAuthorized: boolean;
  authorize(): Promise<string>;
  unauthorize(): Promise<void>;
  api: {
    /** path は先頭スラッシュ付きで書く。{{storefrontId}} が使える */
    music<T = unknown>(
      path: string,
      queryParameters?: Record<string, string | number>,
      options?: MusicKitRequestOptions,
    ): Promise<MusicKitResponse<T>>;
  };
  setQueue(options: { songs: string[]; startPlaying?: boolean }): Promise<void>;
  play(): Promise<void>;
  pause(): void;
  stop(): void;
  seekToTime(time: number): Promise<void>;
  readonly currentPlaybackTime: number;
  readonly nowPlayingItem: { id: string } | null;
}

interface MusicKitApiItem {
  id: string;
  type: string;
  attributes?: {
    name?: string;
    artistName?: string;
    playParams?: {
      id?: string;
      /** ライブラリ曲に対応するカタログ ID。再生にはこれが必要 */
      catalogId?: string;
      isLibrary?: boolean;
      kind?: string;
    };
  };
}
```

**注意**: `api.post` を型から消したので、`hooks/useMusicKit.ts` の `createPlaylist` が
**コンパイルエラーになります。これは想定通り**で、T0-5 で直します。
`configure` の戻り値も `MusicKitInstance | Promise<...>` から `Promise<MusicKitInstance>` に変わっています。

**完了条件**: `npx tsc --noEmit` のエラーが `createPlaylist` 内の `api.post` に限定される。

---

## T0-3 ライブラリ取得で `playParams.catalogId` を拾う

**目的**: 現行コードは `playParams.id`（ライブラリ内 ID `i.xxxx`）を保存しており、
**他の参加者の曲をホスト端末で再生できない**。カタログ ID に修正する。

**対象**: `hooks/useMusicKit.ts` の `fetchAllLibrarySongs`

```ts
async function fetchAllLibrarySongs(
  music: MusicKitInstance,
): Promise<MusicKitTrack[]> {
  const tracks: MusicKitTrack[] = [];
  const limit = 100;
  let offset = 0;
  let hasMore = true;

  while (hasMore) {
    const response = await music.api.music('/v1/me/library/songs', {
      limit,
      offset,
    });

    const items = unwrapMusicData(response);
    for (const item of items) {
      const title = item.attributes?.name ?? '';
      const artist = item.attributes?.artistName ?? '';
      // catalogId が無い曲（ライブラリ限定曲）は出題できないが、
      // 曲数の表示には含めたいのでここでは落とさない
      if (title) {
        tracks.push({
          title,
          artist,
          catalogId: item.attributes?.playParams?.catalogId,
        });
      }
    }

    hasMore = items.length === limit;
    offset += limit;
  }

  return tracks;
}
```

**変更点**:
- `catalogId` の取得元を `playParams.id ?? item.id` → **`playParams.catalogId`** に変更
- パスを `'v1/me/library/songs'` → **`'/v1/me/library/songs'`**（先頭スラッシュ）に統一

**`types/musickit.ts`** も併せて `catalogId?: string` のままで OK（既にオプショナル）。

**完了条件**: 型チェックが通る。T0-1 が解決していれば、
`LibraryImportScreen` で取得した曲の 8 割以上に `catalogId` が入っていることを
`console.log` で 1 度確認する（確認後、ログは消す）。

---

## T0-4 `catalogId` を Supabase まで運ぶ

**目的**: 現状 `LibraryImportScreen` が `{ title, artist }` だけを送信しているため、
せっかく取った `catalogId` が DB に届かない。

**対象 1**: `types/database.ts`

```ts
export type LibraryTrack = {
  title: string;
  artist: string;
  catalogId?: string;
};

/** 出題対象。再生できることを型で保証するため catalogId は必須 */
export type PlaylistTrack = {
  title: string;
  artist: string;
  catalogId: string;
};
```

**対象 2**: `screens/LibraryImportScreen.tsx` の `handleSubmit`

```ts
const tracks: LibraryTrack[] = library.map(({ title, artist, catalogId }) => ({
  title,
  artist,
  catalogId,
}));
```

**注意**: `PlaylistTrack` の `catalogId` を必須にしたことで、
`store/roomStore.ts` の `mergeAndDedupeTracks`（`LibraryTrack[]` を返す）や
`HostLobbyScreen` の呼び出し箇所で型エラーが出ます。**T1-3 で解消するので、ここでは深追いしないこと。**

**完了条件**: Supabase の `participants.library_tracks` に `catalogId` を含む JSON が保存される
（Supabase ダッシュボードの Table Editor で 1 行確認する）。

---

## T0-5 `createPlaylist` を MusicKit v3 の API に書き換える

**目的**: `instance.api.post()` は v3 に存在しない。必ず落ちるコードを直す。

**対象**: `hooks/useMusicKit.ts` の `searchCatalogSongId` と `createPlaylist`

```ts
async function searchCatalogSongId(
  music: MusicKitInstance,
  track: LibraryTrack,
): Promise<string | null> {
  // クエリはオブジェクトで渡す。自分で encodeURIComponent しない。
  // ストアフロントは {{storefrontId}} で自動置換される（jp をハードコードしない）
  const response = await music.api.music<{
    results?: { songs?: { data?: MusicKitApiItem[] } };
  }>('/v1/catalog/{{storefrontId}}/search', {
    term: `${track.title} ${track.artist}`,
    types: 'songs',
    limit: 1,
  });

  return response.data?.results?.songs?.data?.[0]?.id ?? null;
}
```

```ts
const createPlaylist = useCallback(
  async (name: string, tracks: PlaylistTrack[]): Promise<string | null> => {
    if (!isWeb) {
      throw new Error('Web ブラウザで実行してください。');
    }

    const instance = await getMusicKitInstance([
      'music-library-read',
      'music-library-write',
    ]);

    // 出題リストは既に catalogId を持っているので、ここでの検索は不要。
    // 1 リクエストで「作成 + 曲追加」までやる。
    const response = await instance.api.music<{ data?: MusicKitApiItem[] }>(
      '/v1/me/library/playlists',
      {},
      {
        fetchOptions: {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            attributes: {
              name,
              description: 'IntroQ クイズ用プレイリスト',
            },
            relationships: {
              tracks: {
                data: tracks.map((t) => ({ id: t.catalogId, type: 'songs' })),
              },
            },
          }),
        },
      },
    );

    return unwrapMusicData(response)[0]?.id ?? null;
  },
  [isWeb],
);
```

**変更点**:
- `api.post` → `api.music(path, {}, { fetchOptions: { method: 'POST', ... } })`
- **body は手動で `JSON.stringify`**、`Content-Type` も明示（自動ではやってくれない）
- 引数の型を `LibraryTrack[]` → `PlaylistTrack[]` に変更（`catalogId` 必須）
- **曲ごとのカタログ検索ループを削除。** 出題リストは既に `catalogId` を持っているため不要で、
  従来は数百曲ぶんの直列リクエストが走っていた
- 作成と曲追加を **1 リクエストにまとめた**（`relationships.tracks`）

`searchCatalogSongId` は `catalogId` 欠損時のフォールバックとして残しますが、
現時点では呼び出し元がありません。**未使用でも削除しないこと**（T5 で使います）。
未使用警告が出る場合は `// eslint-disable-next-line` ではなく、そのまま残して構いません。

**あわせて**: `getMusicKitInstance` を **export** してください（T2-2 の再生フックから使います）。

```ts
export async function getMusicKitInstance(
  _scopes: MusicKitScope[] = ['music-library-read'],
): Promise<MusicKitInstance> { /* 中身は変更なし */ }
```

**完了条件**: `npx tsc --noEmit` が**エラーゼロ**で通る。

---

## T0-6 再生スモークテスト

**目的**: 「ホスト端末で、他人のライブラリ由来の曲が鳴る」ことを、
クイズ画面を作る前に確認する。**Phase 0 の本丸はここです。**

**対象**: `screens/HostLobbyScreen.tsx`（**一時的なデバッグ UI。T2-3 完了後に削除する**）

参加者一覧の下に一時ボタンを置き、以下を実行する:

```ts
const handleSmokeTest = async () => {
  const merged = mergeAndDedupeTracks(participants).filter((t) => t.catalogId);
  const target = merged[0];
  if (!target?.catalogId) {
    Alert.alert('テスト', '再生可能な曲がありません');
    return;
  }
  const music = await getMusicKitInstance();
  await music.setQueue({ songs: [target.catalogId] });
  await music.play();
  setTimeout(() => music.pause(), 15000);
  Alert.alert('テスト', `${target.title} / ${target.artist} を15秒再生します`);
};
```

**注意**: ブラウザの自動再生制限があるため、**必ずユーザーのタップを起点に `play()` を呼ぶ**こと。
`useEffect` の中から呼ぶと無音のまま失敗します。

**完了条件**（Phase 0 の受入条件）:
**ホスト端末のブラウザで、ホスト以外の参加者のライブラリ由来の曲が 15 秒だけ鳴って止まる。**

> **重要な判断ポイント**: この時点で「鳴る」ことさえ確認できれば Phase 1 に進んでよいです。
> Apple Music 側へのプレイリスト作成（T0-5）が別の理由で失敗しても、**Phase 1 は開始できます。**
> 出題リストは `rooms.playlist_tracks` に持つので、再生に Apple Music のプレイリストは不要です。
> プレイリスト作成が難航したら **T5-1 に先送りしてください。** そこで止まらないこと。

---

# Phase 1 — 出題リストとゲーム進行の土台

---

## T1-1 マイグレーション追加

**対象**: `supabase/migrations/20260902000000_quiz_phase.sql`（新規）

```sql
-- IntroQ: クイズ進行フェーズと解答の整合性

-- 1) 進行フェーズを rooms に持たせる（Broadcast ではなく DB を唯一の真実にする）
create type track_phase as enum ('intro', 'answering', 'revealed');
alter table rooms add column phase track_phase not null default 'intro';

-- 2) 同一問題への多重解答を防ぐ
alter table answers
  add constraint answers_unique_per_track
  unique (room_id, participant_id, track_index);
```

**publication は別途、手で確認してください**（既に追加済みだと `alter publication` はエラーになるため、
マイグレーションに含めると適用が止まります）。

```sql
-- 現状を確認
select tablename from pg_publication_tables where pubname = 'supabase_realtime';

-- 不足しているものだけ追加する
alter publication supabase_realtime add table public.participants;
alter publication supabase_realtime add table public.answers;
```

**完了条件**: `rooms` に `phase` 列が存在し、`pg_publication_tables` に
`rooms` / `participants` / `answers` の 3 つが揃っている。

---

## T1-2 `types/database.ts` の更新

**対象**: `types/database.ts`

- `export type TrackPhase = 'intro' | 'answering' | 'revealed';` を追加
- `rooms` の `Row` / `Insert` / `Update` に `phase` を追加（`Insert`/`Update` はオプショナル）
- `Enums` に `track_phase: TrackPhase` を追加
- 画面から使う `Answer` 型を export する:

```ts
export type Answer = {
  id: string;
  room_id: string;
  participant_id: string;
  track_index: number;
  answer_text: string;
  is_correct: boolean | null;
  answered_at: string;
};
```

`answers` の `Row` はこの `Answer` を参照する形にして、定義の二重管理を避けてください。

**完了条件**: `npx tsc --noEmit` が通る。

---

## T1-3 出題リスト生成 `buildQuizTracks`

**目的**: 現行の `mergeAndDedupeTracks` は参加者順に連結するだけで、
**シャッフルも曲数上限も無く、参加者ごとの曲数も偏る**。
pre-prompt の「ランダムにピック」「誰も不利にならない」を構造で担保する。

**対象**: `store/roomStore.ts`

```ts
export const QUIZ_TRACK_LIMIT = 20;

function shuffle<T>(items: T[]): T[] {
  const a = [...items];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

/**
 * 参加者全員のライブラリから出題リストを作る。
 * - catalogId を持つ曲だけを対象にする（ホスト端末で再生できない曲を弾く）
 * - 参加者ごとの採用数を均す（誰も不利にならないように）
 * - 全体をシャッフルしてから limit 曲に切る
 */
export function buildQuizTracks(
  participants: Participant[],
  options: { limit?: number } = {},
): PlaylistTrack[] {
  const limit = options.limit ?? QUIZ_TRACK_LIMIT;
  const seen = new Set<string>();

  // 重複曲は「先に処理された参加者」のものになるため、
  // 参加者の順序自体もシャッフルして偏りを避ける
  const perParticipant = shuffle(participants).map((participant) => {
    const list: PlaylistTrack[] = [];
    for (const track of participant.library_tracks ?? []) {
      if (!track.title || !track.catalogId) continue;
      const key = `${track.title.trim().toLowerCase()}::${track.artist.trim().toLowerCase()}`;
      if (seen.has(key)) continue;
      seen.add(key);
      list.push({
        title: track.title,
        artist: track.artist,
        catalogId: track.catalogId,
      });
    }
    return shuffle(list);
  });

  // ラウンドロビンで 1 曲ずつ取る → 参加者ごとの採用数が最大 1 曲差に収まる
  const picked: PlaylistTrack[] = [];
  for (let i = 0; picked.length < limit; i++) {
    let advanced = false;
    for (const list of perParticipant) {
      if (i >= list.length) continue;
      picked.push(list[i]);
      advanced = true;
      if (picked.length >= limit) break;
    }
    if (!advanced) break; // 全員の曲を使い切った
  }

  return shuffle(picked);
}
```

**`mergeAndDedupeTracks` は削除しないこと。** ロビーの曲数表示などで使えるため残します。
ただし `HostLobbyScreen` のゲーム開始処理は `buildQuizTracks` を使うように差し替えます（T1-8）。

**完了条件**:
- 型チェックが通る
- 参加者 2 人 × 各 10 曲（`catalogId` あり）で呼ぶと、**20 曲・各参加者 10 曲ずつ**返る
- 参加者 2 人 × 各 3 曲で呼ぶと **6 曲**返る（`limit` に満たなくても落ちない）
- `catalogId` を持たない曲が結果に含まれない

---

## T1-4 ナビゲーションに 3 画面を追加

**対象 1**: `navigation/types.ts`

```ts
export type RootStackParamList = {
  Home: undefined;
  LibraryImport: undefined;
  HostLobby: undefined;
  GuestLobby: undefined;
  HostQuiz: undefined;
  GuestQuiz: undefined;
  Result: undefined;
};
```

**対象 2**: `App.tsx` に 3 つの `Stack.Screen` を追加。

- `HostQuiz` / `GuestQuiz`: `options={{ title: 'イントロクイズ', headerBackVisible: false }}`
  （ゲーム中に戻られると状態が壊れるため、戻るボタンを消す）
- `Result`: `options={{ title: '結果', headerBackVisible: false }}`

まずは「画面名と最低限の文字だけ表示する空コンポーネント」で 3 ファイルを作り、
遷移が通ることを先に確認してください。中身は T2 以降で埋めます。

**完了条件**: 型チェックが通り、アプリがエラーなく起動する。

---

## T1-5 `roomStore` にゲーム状態を追加

**対象**: `store/roomStore.ts`

追加する state:

```ts
phase: TrackPhase;              // 現在の曲の進行フェーズ
answers: Answer[];              // 現在のルームの解答（全曲ぶん）
submittedTrackIndex: number | null;  // 自分が解答を送った曲番号（ゲスト用）
```

追加するアクション:

```ts
setPhase: (phase: TrackPhase) => void;
setAnswers: (answers: Answer[]) => void;
upsertAnswer: (answer: Answer) => void;      // id 一致で置換、なければ追加
setSubmittedTrackIndex: (index: number | null) => void;
fetchAnswers: () => Promise<void>;           // room_id で全件取得
```

**`fetchRoom` を更新**して `phase` も反映してください（現在は `phase` を読んでいません）。
`initialState` にも 3 つを追加し、`reset()` で確実に初期化されるようにすること。

**派生値はストアに持たせず、画面側で計算する**方針にします（既存の `participantReady` と同じ発想）。
以下のセレクタ関数を `roomStore.ts` に追加してください:

```ts
export function answersForTrack(answers: Answer[], trackIndex: number): Answer[] {
  return answers.filter((a) => a.track_index === trackIndex);
}
```

**完了条件**: 型チェックが通る。

---

## T1-6 `useRoomRealtime` を拡張

**目的**: `rooms.phase` の反映と、`answers` の購読を追加する。

**対象**: `hooks/useRoomRealtime.ts`

1. 既存の `rooms` UPDATE ハンドラに **`phase` の反映を追加**する
   （現在 `status` / `host_id` / `playlist_tracks` / `current_track_index` のみ）。
2. 同じ channel に `answers` の購読を追加する:

```ts
.on(
  'postgres_changes',
  {
    event: '*',
    schema: 'public',
    table: 'answers',
    filter: `room_id=eq.${roomId}`,
  },
  (payload) => {
    if (payload.eventType === 'DELETE') return; // 解答は削除しない運用
    const row = payload.new as Answer;
    if (row?.id) useRoomStore.getState().upsertAnswer(row);
  },
)
```

3. 購読開始時の初期同期に `fetchRoom()` と `fetchAnswers()` を追加する
   （現在は `fetchParticipants()` のみ）。**再接続時の取りこぼしを埋める**ために重要です。

**注意**: `useEffect` の依存配列に、ストアから取り出した関数をすべて正しく入れてください。
Zustand の関数参照は安定しているため再購読ループにはなりませんが、
**`useRoomStore.getState()` を使う場合は依存に入れない**こと（既存コードの書き方に合わせる）。

**完了条件**: ホスト側で `rooms` を手動 UPDATE すると、ゲスト側の Zustand の `phase` が変わる
（React DevTools か `console.log` で確認）。

---

## T1-7 状態駆動の自動遷移フック

**目的**: `rooms.status` の変化だけで全員が同じ画面に移る仕組みを 1 本作る。
**ホストも自分で `navigate` せず、自分が書いた UPDATE を Realtime で受け取って遷移する。**
こうするとホスト／ゲストで遷移ロジックが 1 本になり、ホスト画面だけ状態がズレる事故が消えます。

**対象**: `hooks/useGameNavigation.ts`（新規）

```ts
import { useNavigation, useRoute } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { useEffect } from 'react';

import type { RootStackParamList } from '../navigation/types';
import { useRoomStore } from '../store/roomStore';
import { useUserStore } from '../store/userStore';

type Nav = NativeStackNavigationProp<RootStackParamList>;

/**
 * rooms.status に応じて全員を同じ画面へ移す。
 * ロビー / クイズ / 結果のすべての画面で呼ぶ。
 */
export function useGameNavigation() {
  const navigation = useNavigation<Nav>();
  const route = useRoute();
  const status = useRoomStore((s) => s.status);
  const isHost = useUserStore((s) => s.isHost);

  useEffect(() => {
    const target: keyof RootStackParamList | null =
      status === 'playing'
        ? isHost
          ? 'HostQuiz'
          : 'GuestQuiz'
        : status === 'finished'
          ? 'Result'
          : null;

    // 既にその画面にいるなら何もしない（replace ループを防ぐ）
    if (!target || route.name === target) return;

    navigation.replace(target);
  }, [status, isHost, navigation, route.name]);
}
```

このフックを `HostLobbyScreen` / `GuestLobbyScreen` / `HostQuizScreen` / `GuestQuizScreen` で呼びます。

**完了条件**: ホストが `rooms.status` を `playing` にすると、
**ホストとゲストの両方**がそれぞれのクイズ画面に自動遷移する。

---

## T1-8 `HostLobbyScreen` のゲーム開始処理を差し替え

**対象**: `screens/HostLobbyScreen.tsx` の `handleStart`

```ts
const handleStart = async () => {
  if (!roomId) {
    Alert.alert('エラー', 'ルーム情報が見つかりません');
    return;
  }
  if (!allReady) {
    Alert.alert('まだ準備中', '全員のライブラリが揃うまでゲームを開始できません');
    return;
  }

  setStarting(true);
  try {
    const quizTracks = buildQuizTracks(participants);
    if (quizTracks.length === 0) {
      throw new Error(
        '出題できる曲がありません。Apple Music のカタログにある曲を含むライブラリが必要です。',
      );
    }

    // プレイリスト作成は「あると嬉しい」機能。失敗してもゲームは開始する。
    try {
      await createPlaylist(`IntroQ ${userName}`, quizTracks);
    } catch (e) {
      console.warn('[playlist] 作成に失敗しましたが、ゲームは続行します', e);
    }

    const { error } = await supabase
      .from('rooms')
      .update({
        playlist_tracks: quizTracks,
        current_track_index: 0,
        phase: 'intro',
        status: 'playing',
      })
      .eq('id', roomId);

    if (error) throw error;
    // 画面遷移は useGameNavigation が status の変化を受けて行う
  } catch (e) {
    Alert.alert('エラー', e instanceof Error ? e.message : 'ゲーム開始に失敗しました');
  } finally {
    setStarting(false);
  }
};
```

**重要な変更点**:
- `mergeAndDedupeTracks` → **`buildQuizTracks`**
- **プレイリスト作成の失敗でゲーム開始を止めない**（本質的な機能ではないため）
- `phase: 'intro'` を明示的にリセット
- `Alert` での「次の実装で追加します」を削除し、**自分では `navigate` しない**
- `useGameNavigation()` をこの画面で呼ぶ

**あわせて**: T0-6 で追加したスモークテスト用のデバッグボタンは、この段階ではまだ残しておいて構いません
（T2-3 完了時に削除）。

**完了条件**（Phase 1 の受入条件）:
ホストが「開始」を押すと、**ホストとゲストの両方**が空のクイズ画面に遷移する。
`rooms.playlist_tracks` が最大 20 曲・シャッフル済み・参加者ごとの曲数が均等になっている。

---

# Phase 2 — クイズ画面（コア）

---

## T2-1 正誤判定ロジック

**対象**: `lib/answerMatch.ts`（新規）

```ts
import type { PlaylistTrack } from '../types/database';

/**
 * 曲名の表記ゆれを吸収する。
 * 全角/半角、大文字/小文字、(feat. ...) などの付加情報、記号・空白の差を無視する。
 */
export function normalizeTitle(input: string): string {
  return input
    .normalize('NFKC') // 全角英数 → 半角、互換文字の統一
    .toLowerCase()
    .replace(/[(（\[【].*?[)）\]】]/g, '') // (feat. X) / 【MV】 などを除去
    .replace(/\s+/g, '')
    .replace(/[-_'"’‘“”.,!?、。・~〜/\\|:;：；]/g, '')
    .trim();
}

/** 自動判定。ホストが手動で覆せるため、ここでは完全一致のみの厳しめ判定でよい */
export function judgeAnswer(answerText: string, track: PlaylistTrack): boolean {
  const normalized = normalizeTitle(answerText);
  if (!normalized) return false;
  return normalized === normalizeTitle(track.title);
}
```

**方針**: 部分一致やあいまい一致（レーベンシュタイン距離など）は**入れないでください**。
誤って正解にする方が体験として悪く、**ホストの手動上書きで十分カバーできる**ためです。

**完了条件**: 以下がすべて `true`（一時的なスクリプトか手動で確認）:
- `judgeAnswer('lemon', { title: 'Lemon (feat. X)' })`
- `judgeAnswer('ＬＥＭＯＮ', { title: 'Lemon' })`
- `judgeAnswer('  Lemon  ', { title: 'Lemon' })`

そして `judgeAnswer('レモン', { title: 'Lemon' })` は `false`（ホストが手で直す領域）。

---

## T2-2 イントロ再生フック

**対象**: `hooks/useIntroPlayback.ts`（新規）

```ts
import { useCallback, useEffect, useRef, useState } from 'react';

import { getMusicKitInstance } from './useMusicKit';

const INTRO_MS = 15000;

export function useIntroPlayback() {
  const [playing, setPlaying] = useState(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // 世代番号。曲が変わった後に前のタイマーが止めに来る事故を防ぐ
  const generationRef = useRef(0);

  const clearTimer = useCallback(() => {
    if (timerRef.current !== null) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
  }, []);

  // 画面を離れたら必ず止める
  useEffect(() => {
    return () => {
      generationRef.current += 1;
      clearTimer();
      void getMusicKitInstance()
        .then((music) => music.pause())
        .catch(() => undefined);
    };
  }, [clearTimer]);

  /** 冒頭 15 秒だけ再生する。必ずユーザーのタップを起点に呼ぶこと */
  const playIntro = useCallback(
    async (catalogId: string) => {
      const generation = ++generationRef.current;
      clearTimer();

      const music = await getMusicKitInstance();
      await music.setQueue({ songs: [catalogId] });
      await music.play();
      if (generationRef.current !== generation) return; // 待っている間に曲が変わった
      setPlaying(true);

      timerRef.current = setTimeout(() => {
        if (generationRef.current !== generation) return;
        music.pause();
        setPlaying(false);
        timerRef.current = null;
      }, INTRO_MS);
    },
    [clearTimer],
  );

  /** 正解発表後、頭からフル再生する */
  const playFull = useCallback(async () => {
    generationRef.current += 1;
    clearTimer();
    const music = await getMusicKitInstance();
    await music.seekToTime(0);
    await music.play();
    setPlaying(true);
  }, [clearTimer]);

  const stop = useCallback(async () => {
    generationRef.current += 1;
    clearTimer();
    const music = await getMusicKitInstance();
    music.pause();
    setPlaying(false);
  }, [clearTimer]);

  return { playing, playIntro, playFull, stop };
}
```

**設計上の要点**（変更しないでください）:
- **世代番号による無効化**。`await` を挟むうちに次の曲へ進むと、
  古いタイマーが新しい曲を止めてしまう。これは実際に起きます。
- **アンマウント時に必ず `pause()`**。結果画面に移っても音が鳴り続ける事故を防ぐ。
- **`play()` はユーザー操作起点でのみ呼ぶ**。`useEffect` から自動で呼ぶと
  ブラウザの自動再生ポリシーで無音のまま失敗します。

---

## T2-3 `HostQuizScreen`

**対象**: `screens/HostQuizScreen.tsx`

### 画面構成

```
┌────────────────────────────┐
│ 第 3 問 / 20                        │ ← currentTrackIndex + 1 / playlistTracks.length
│                                     │
│ [ phase === 'revealed' のときだけ ]  │
│   Lemon                             │ ← 曲名
│   米津玄師                           │ ← アーティスト
│                                     │
│ ┌─────────────────────┐ │
│ │  ▶ イントロ再生（15秒）      │ │ ← phase: intro
│ │  🔊 正解発表                  │ │ ← phase: answering
│ │  ⏭ 次の曲へ / 結果を見る      │ │ ← phase: revealed
│ └─────────────────────┘ │
│                                     │
│ 解答状況                             │
│  たろう   ● 解答済み                  │ ← revealed 前は内容を伏せる
│  はなこ   ○ 未解答                    │
│  ── revealed 後 ──                  │
│  たろう   「れもん」        [✕→○]     │ ← タップで正誤を反転
│  はなこ   「Lemon」         [○]      │
└────────────────────────────┘
```

### 状態と操作の対応

| `phase` | 表示 | ボタン |
|---------|------|--------|
| `intro` | 曲名は伏せる / 解答数のみ | 「イントロ再生（15秒）」 |
| `answering` | 曲名は伏せる / 誰が解答済みかのみ | 「正解発表」 |
| `revealed` | 曲名・アーティスト・全員の解答と正誤 | 「次の曲へ」（最終曲なら「結果を見る」） |

### 実装のポイント

**冒頭で呼ぶフック**:
```ts
useRoomRealtime(roomId);
useGameNavigation();
const { playIntro, playFull } = useIntroPlayback();
```

**現在の曲**: `const track = playlistTracks[currentTrackIndex];`
`track` が `undefined` の場合は「読み込み中」を表示して早期 return すること（リロード直後に起こります）。

**イントロ再生**:
```ts
const handlePlayIntro = async () => {
  if (!track || !roomId) return;
  await playIntro(track.catalogId);
  await supabase.from('rooms').update({ phase: 'answering' }).eq('id', roomId);
};
```
再生開始と `phase` 更新をこの順で行うこと。**先に `phase` を変えると、
再生に失敗したのにゲストが解答できる状態になります。**

**正解発表**:
```ts
const handleReveal = async () => {
  if (!track || !roomId) return;

  const current = answersForTrack(answers, currentTrackIndex);

  // 1) 自動判定を answers に書き込む
  await Promise.all(
    current.map((a) =>
      supabase
        .from('answers')
        .update({ is_correct: judgeAnswer(a.answer_text, track) })
        .eq('id', a.id),
    ),
  );

  // 2) フェーズを進めてから、フル再生
  await supabase.from('rooms').update({ phase: 'revealed' }).eq('id', roomId);
  await playFull();
};
```

**正誤の手動上書き**: 各解答行をタップしたら `is_correct` を反転して `answers` を UPDATE する。
Realtime で自分にも返ってくるので、**ローカル state は持たずストアの値をそのまま描画する**こと。

**スコア確定**: `handleNext` の中で、**その問題の正解者だけ** `participants.score` を +1 する。
```ts
const correctIds = answersForTrack(answers, currentTrackIndex)
  .filter((a) => a.is_correct)
  .map((a) => a.participant_id);

await Promise.all(
  correctIds.map((id) => {
    const p = participants.find((x) => x.id === id);
    if (!p) return Promise.resolve();
    return supabase.from('participants').update({ score: p.score + 1 }).eq('id', id);
  }),
);
```
> スコアを「次へ」の時点で確定するのは、**発表中にホストが正誤を何度でも直せるようにするため**です。
> 発表時に加算すると、手動修正のたびに加減算の帳尻合わせが必要になります。

**次の曲へ**:
```ts
const isLast = currentTrackIndex >= playlistTracks.length - 1;
await supabase
  .from('rooms')
  .update(
    isLast
      ? { status: 'finished' }
      : { current_track_index: currentTrackIndex + 1, phase: 'intro' },
  )
  .eq('id', roomId);
```
画面遷移は `useGameNavigation` が行うので、ここでは `navigate` しないこと。

**ホストは解答者ではない**: ホストには曲名が見えているため、スコア対象外です。
解答一覧からホスト自身を除外し、画面に「あなたは出題役です」と明示してください。
ホストの `participants` 行は残したまま、表示とスコア加算の対象から外す方針です。

**二重押し防止**: 各ボタンに処理中フラグを持たせ、連打で `current_track_index` が
2 つ進む事故を防いでください。

**あわせて**: T0-6 のデバッグボタンを `HostLobbyScreen` から削除する。

**完了条件**: ホスト画面だけで、3 問ぶんの
「イントロ再生 → 正解発表 → 次の曲へ」が破綻なく回る。

---

## T2-4 `GuestQuizScreen`

**対象**: `screens/GuestQuizScreen.tsx`

### 状態と操作の対応

| `phase` | 表示 |
|---------|------|
| `intro` | 「ホストが再生を準備しています」/ 入力欄は無効 |
| `answering` | テキスト入力 + 送信ボタン。送信後は入力をロックし「解答を送信しました」 |
| `revealed` | 正解の曲名・アーティスト、全員の解答と正誤、自分が正解したか |

**冒頭で呼ぶフック**: `useRoomRealtime(roomId);` と `useGameNavigation();`
（**`useIntroPlayback` は呼ばない。音が鳴るのはホスト端末だけです。**）

**解答送信**:
```ts
const handleSubmit = async () => {
  const text = answerText.trim();
  if (!text || !roomId || !participantId) return;

  const { error } = await supabase.from('answers').insert({
    room_id: roomId,
    participant_id: participantId,
    track_index: currentTrackIndex,
    answer_text: text,
  });

  // 一意制約違反 = 既に解答済み。エラーではなく「送信済み」として扱う
  if (error && error.code !== '23505') {
    Alert.alert('エラー', '解答を送信できませんでした');
    return;
  }

  setSubmittedTrackIndex(currentTrackIndex);
  setAnswerText('');
};
```

**曲が変わったら入力をリセット**する:
```ts
useEffect(() => {
  setAnswerText('');
}, [currentTrackIndex]);
```
`submittedTrackIndex !== currentTrackIndex` を「まだ解答していない」の判定に使うので、
`submittedTrackIndex` はここでリセットしなくて構いません。

**自分のスコア**を常時ヘッダに表示すること（`participants` から自分の行を引く）。

**完了条件**（Phase 2 の受入条件）:
ブラウザのタブを 2 つ（ホスト / ゲスト）開き、**3 曲ぶん**
「イントロ再生 → ゲストが解答 → 正解発表 → 次の曲」が破綻なく回る。
ゲスト側で正解数が正しく増える。

---

# Phase 3 — 結果画面

## T3-1 `ResultScreen`

**対象**: `screens/ResultScreen.tsx`

- `participants` を `score` 降順で並べたランキング。**同点は同順位**にする
  （1, 1, 3 のように、同点の次は人数ぶん飛ばす）
- ホストは出題役なのでランキングから除外し、別途「出題者: ○○」と表示する
- 自分の行をハイライトする
- 「ホームに戻る」で `useUserStore.reset()` / `useRoomStore.reset()` を呼び、
  `navigation.reset({ index: 0, routes: [{ name: 'Home' }] })` でスタックごと戻す
  （`replace` だと履歴が残り、戻るボタンでゲームに戻れてしまう）

**この画面では `useGameNavigation()` を呼ばないこと。** `status` は既に `finished` なので、
呼ぶと自分自身への `replace` を試みることになります（`route.name` ガードで防げますが、意図が不明瞭になります）。

**完了条件**（Phase 3 の受入条件）:
最終曲の「結果を見る」で全員が結果画面に遷移し、順位が正しい。

---

# Phase 4 — 実戦での堅牢性

> ここからは「車内で実際に起きること」への対策です。**Phase 3 まで通してから着手してください。**

## T4-1 セッションの永続化

**目的**: 現在 `roomId` / `participantId` は Zustand のメモリのみ。
**ブラウザをリロードした瞬間にゲームから脱落します。** 車内では普通に起きます。

**対象**: `store/userStore.ts` / `store/roomStore.ts`

`zustand/middleware` の `persist` を使い、`@react-native-async-storage/async-storage` に保存します。
AsyncStorage は Expo SDK 56 で Web を含む全プラットフォーム対応です
（https://docs.expo.dev/versions/v56.0.0/sdk/async-storage/ 参照。追加インストール不要、導入済み）。

```ts
import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';
import AsyncStorage from '@react-native-async-storage/async-storage';

export const useUserStore = create<UserState>()(
  persist(
    (set) => ({ /* 既存の実装のまま */ }),
    {
      name: 'introq-user',
      storage: createJSONStorage(() => AsyncStorage),
      partialize: (s) => ({
        userName: s.userName,
        participantId: s.participantId,
        hostClientId: s.hostClientId,
        isHost: s.isHost,
      }),
    },
  ),
);
```

`roomStore` は **`roomId` だけを永続化**してください。
`participants` / `answers` / `playlistTracks` は復帰時に必ず再取得するので保存不要です
（古いデータで一瞬描画されるほうが害になります）。

**復帰処理**: `App.tsx` で、永続化された `roomId` があれば
`fetchRoom()` → `fetchParticipants()` → `fetchAnswers()` を実行し、
`status` と `phase` に応じた画面を初期ルートにする。
`persist` の復元は非同期なので、`useUserStore.persist.hasHydrated()` を待ってから
ナビゲータを描画すること（それまではスプラッシュ/ローディングを出す）。

**完了条件**: ゲーム中にゲストがブラウザをリロードしても、同じ問題の画面に戻ってこられる。

---

## T4-2 再接続時の再同期

**対象**: `hooks/useRoomRealtime.ts`

`.subscribe()` にコールバックを渡し、`'SUBSCRIBED'` になるたびに
`fetchRoom()` / `fetchParticipants()` / `fetchAnswers()` を実行する。

```ts
.subscribe((status) => {
  if (status === 'SUBSCRIBED') {
    void fetchRoom();
    void fetchParticipants();
    void fetchAnswers();
  }
});
```

**これで十分**です。進行状態をすべて `rooms` 行に置いた（設計判断 3-A）ので、
再取得するだけで整合します。Broadcast を使っていたらこうはいきません。

**完了条件**: DevTools でネットワークを 30 秒オフラインにして戻すと、
その間に進んだ問題番号に自動で追いつく。

---

## T4-3 短いルームコード

**目的**: UUID は車内で口頭共有できません。**UX ではなく実用性の問題**なので優先度は高いです。

1. マイグレーションで `rooms.code text unique` を追加（6 文字）。
   紛らわしい文字（`0/O`、`1/I/l`）を除いた英数字から生成する。
2. `HomeScreen` のルーム作成でコードを生成して INSERT、参加は `code` で検索する
   （現在は `id` で検索している）。
3. `HostLobbyScreen` にコードを大きく表示し、コピーボタンを付ける。

**完了条件**: 6 文字のコードを口頭で伝えて参加できる。

---

## T4-4 途中参加・途中離脱

以下を決めて実装する:
- `status !== 'lobby'` のルームには参加できない（**実装済み**。動作を確認するだけ）
- ゲームの途中でゲストが離脱した場合、そのゲストの解答を待たずにホストが進行できること
  （**現状の設計で既に満たしています**。ホストは任意のタイミングで発表できるため。確認のみ）
- ホストが離脱した場合はゲームが止まる。**MVP では許容**し、
  ゲスト画面に「ホストの操作を待っています」と出すに留める

**完了条件**: 上記 3 点の挙動を実際に確認し、必要な文言だけ追加する。

---

# Phase 5 — 仕上げ

## T5-1 Apple Music プレイリスト作成の完成
T0-5 を先送りしていた場合はここで完成させる。`catalogId` 欠損曲は `searchCatalogSongId` でフォールバックする。

## T5-2 RLS の見直し
現在すべてのテーブルが `using (true)` で全開。最低限、`rooms` の UPDATE を絞る。
**MVP の遊びやすさを壊さない範囲で**行うこと。認証の導入まではしない。

## T5-3 エラーハンドリングの通し見直し
`Alert.alert` に頼りすぎている箇所を、画面内のインライン表示に変える。
特にクイズ中は Alert がゲームの流れを止めるため避ける。

## T5-4 Node.js のバージョン更新
現在 `v20.12.0`。Expo SDK 56 の推奨は `>=20.19.4`。警告が出続けているので上げる。

## T5-5 実車での通し確認
実際に車内で 1 ゲーム通す。**ここで見つかる問題が一番重要です。**

---

# Phase 7 — 曲を提供しない参加（判断 5）

> **Phase 5 / 6 より先に実装します。** 番号は追加順で、実施順ではありません。
> 設計の根拠は [PLAN.md の判断 5](PLAN.md) を読んでから着手してください。

「曲を追加せずに参加する」ボタンをホスト・ゲストの両方に用意します。

**この Phase で絶対に外してはいけない 2 点**

1. **ホストは Apple Music 認証をスキップできない。** 曲を鳴らすのはホスト端末で、再生には
   Music User Token が要ります。スキップできるのは「ライブラリの提供」だけです。
   → **ホストのスキップボタンは認証後の画面にしか置かない。**
2. **「まだ出していない」と「出さないと決めた」は別物。** どちらも `library_tracks` が空なので、
   DB に区別する列がないとホストの開始ゲートが永久に閉じます。

---

## T7-1 マイグレーション追加

**対象**: `supabase/migrations/20260903000000_skip_library.sql`（新規）

```sql
-- IntroQ: 曲を提供せずに参加できるようにする（判断 5）
-- library_tracks が空なだけの「未提出」と区別するための列
alter table participants
  add column skipped_library boolean not null default false;
```

**完了条件**: `participants` に `skipped_library` 列が存在し、既存行がすべて `false` になっている。

> 適用は Supabase ダッシュボードの SQL Editor から手動で行います（CLI 未導入のため）。

---

## T7-2 型定義の更新

**対象 1**: `types/database.ts` の `participants`

`Row` に `skipped_library: boolean;`、`Insert` / `Update` に `skipped_library?: boolean;` を追加。

**対象 2**: `store/roomStore.ts` の `Participant` 型に `skipped_library: boolean;` を追加。

**完了条件**: `node node_modules/typescript/lib/tsc.js --noEmit` が通る。

> 補足: `npx tsc` は `node_modules/.bin/tsc` のシムが壊れていて動きません。
> 上のように `node node_modules/typescript/lib/tsc.js` を直接叩いてください。

---

## T7-3 準備完了の判定を変える

**目的**: スキップした人を「準備完了」として扱う。**ここを直さないとゲームが永久に始まりません。**

**対象**: `store/roomStore.ts`

```ts
export function participantReady(participant: Participant): boolean {
  return hasLibrary(participant.library_tracks) || participant.skipped_library;
}

/** 出題プールに曲を提供した人だけ true */
export function participantContributed(participant: Participant): boolean {
  return hasLibrary(participant.library_tracks);
}
```

`participantContributed` を新設するのは、ロビーの表示で
「準備は終わっているが曲は出していない」を区別して見せるためです（T7-5）。

**`buildQuizTracks` は変更不要**です。`catalogId` を持つ曲だけを拾う実装なので、
`library_tracks` が空の参加者は自然に無視され、ラウンドロビンも空リストを読み飛ばします。

**完了条件**: 型チェックが通る。参加者 2 人のうち 1 人が `skipped_library: true`・もう 1 人が曲ありのとき、
`participants.every(participantReady)` が `true` になる。

---

## T7-4 `LibraryImportScreen` にスキップボタンを追加

**対象**: `screens/LibraryImportScreen.tsx`

この画面は 4 つの状態を出し分けています。**どの状態にボタンを出すかがホスト／ゲストで違います。**

| 画面の状態 | 条件 | ゲスト | ホスト |
|---|---|---|---|
| 読み込み中 | `preparing \|\| loading` | 出さない | 出さない |
| 接続エラー | `error && !isAuthorized` | **出す** | 出さない |
| 準備完了・未認証 | `isPrepared && !isAuthorized` | **出す** | 出さない |
| ライブラリ一覧（認証済み） | 上記以外 | **出す** | **出す** |

ホストにエラー時・未認証時のスキップを出さないのは、**認証しないと曲を再生できない**からです。
ホストがその状態で先に進むと、ゲーム開始後の初回再生で認証ポップアップが出て進行が止まります。

**スキップ処理**:

```ts
const handleSkip = async () => {
  if (!participantId || !roomId) {
    Alert.alert('エラー', 'セッション情報が不足しています');
    return;
  }

  setSubmitting(true);
  try {
    const { error: updateError } = await supabase
      .from('participants')
      .update({ skipped_library: true, library_tracks: [] })
      .eq('id', participantId);

    if (updateError) throw updateError;

    setLibrarySubmitted(true);
    goToLobby();
  } catch (e) {
    Alert.alert('エラー', e instanceof Error ? e.message : '送信に失敗しました');
  } finally {
    setSubmitting(false);
  }
};
```

**ボタンの文言**:
- ゲストの未認証／エラー時: `Apple Music に接続せずに参加`
- 認証済みの一覧画面: `曲を追加せずに参加`

いずれも既存の `styles.secondaryButton`（`#1c1c24` 背景・枠線あり）を使い、主導線より弱く見せること。

**逆方向の遷移は作らないこと。** 一度スキップした人が後から曲を出す導線は、
`skipped_library` を戻す処理が要り、ロビーの状態表示も揺れます。MVP では不要です。

**完了条件**: ゲストが Apple Music にまったく触れずにロビーへ到達でき、
`participants` 行が `skipped_library = true` になっている。

---

## T7-5 `HostLobbyScreen` の表示と開始条件

**対象**: `screens/HostLobbyScreen.tsx`

1. **参加者一覧**に「曲なしで参加」を出す。`participantReady` と `participantContributed` の両方を使う:

| 状態 | 表示 |
|---|---|
| 曲あり | `N 曲受信済み` / バッジ `OK` |
| スキップ済み | `曲なしで参加` / バッジ `OK` |
| どちらでもない | `ライブラリ待ち` / バッジ `…` |

2. **開始ボタンのゲート**は `allReady`（＝全員 `participantReady`）のままでよい。T7-3 の変更で
   スキップ済みが自動的に数に入ります。

3. **曲が 1 曲も集まらなかった場合のエラー文言を変える**。既存の `handleStart` にある:

```ts
throw new Error(
  '出題できる曲がありません。Apple Music のカタログにある曲を含むライブラリが必要です。',
);
```

を、全員スキップのケースが分かる文言にする:

```ts
const contributors = participants.filter(participantContributed).length;
if (quizTracks.length === 0) {
  throw new Error(
    contributors === 0
      ? '全員が「曲を追加せずに参加」を選んでいるため、出題できる曲がありません。誰か 1 人はライブラリを提供してください。'
      : '出題できる曲がありません。Apple Music のカタログにある曲が 1 曲も見つかりませんでした。',
  );
}
```

4. 参加者数の見出しに、曲を提供した人数も添えると状況が読めます（任意）:
   `参加者 3/3 準備完了（うち 2 人が曲を提供）`

**完了条件**: 1 人がスキップ・1 人が曲ありの状態でゲームを開始でき、
全員スキップのときは上記の専用メッセージが出る。

---

## T7-6 リロード復帰の判定を直す

**目的**: スキップした人がブラウザをリロードすると、`LibraryImport` に戻されてしまう。

**対象**: `App.tsx` の `resolveInitialRoute`

```ts
const me = useRoomStore.getState().participants.find((p) => p.id === participantId);
const done = (me?.library_tracks?.length ?? 0) > 0 || (me?.skipped_library ?? false);
if (done) return isHost ? 'HostLobby' : 'GuestLobby';

return 'LibraryImport';
```

**この修正を忘れると T7-4 の意味が半減します。** スキップは「Apple Music を触りたくない」人のための
機能なのに、リロードのたびに取込画面へ送り返されるからです。

**完了条件**（Phase 7 の受入条件）:
**Apple Music に一度も接続していないゲストが、ロビー → クイズ → 結果まで通しで遊べる。**
途中でリロードしても取込画面に戻されない。

---

# Phase 8 — 解答入力と採点の廃止（判断 6）

> **Phase 5 / 6 より先に実装します。** 設計の根拠は [PLAN.md の判断 6](PLAN.md)。
> **削除が主体のタスクなので、着手前にコミットしておくこと。**

同じ場にいる人同士で遊ぶ前提に合わせ、解答入力・採点・ランキングを廃止する。

**方針の要点**

- テーブルとカラム（`answers`、`participants.score`）は **DROP しない**。使わなくなるだけ。
  将来戻す可能性があり、消しても得るものが無い。
- **`buildQuizTracks` の公平性ロジックは残す。** 採点が無くても
  「特定の人の曲ばかり流れる」と場が白けるため。

---

## T8-1 `GuestQuizScreen` を削除し、ゲストはロビーに留める

**対象**: `screens/GuestQuizScreen.tsx`（削除）、`screens/GuestLobbyScreen.tsx`、
`navigation/types.ts`、`App.tsx`

ゲストはクイズ中に操作しないので、専用画面を持たせない。

1. `screens/GuestQuizScreen.tsx` を削除
2. `RootStackParamList` から `GuestQuiz` を削除、`App.tsx` の `Stack.Screen` も削除
3. `GuestLobbyScreen` の表示を `status` で出し分ける:

| `status` | 表示 |
|---|---|
| `lobby` | 「待機中 / ホストがゲームを準備中...」＋ 参加者一覧（現状のまま） |
| `playing` | **「ゲーム中です。ホストの画面を見てください」** |
| `finished` | `Result` へ遷移（`useGameNavigation` が処理） |

4. `hooks/useGameNavigation.ts` を修正:
   - `status === 'playing'` のとき、**ホストのみ** `HostQuiz` へ遷移させる
   - ゲストは遷移しない（ロビーに留まる）
   - `status === 'finished'` は従来どおり全員 `Result` へ

**完了条件**: ゲストがゲーム中もロビー画面に留まり、「ホストの画面を見てください」と表示される。

---

## T8-2 `HostQuizScreen` から解答一覧と採点を削除

**対象**: `screens/HostQuizScreen.tsx`

残すのは再生制御だけにする。

**削除するもの**:
- 解答状況の `FlatList`（`players` / `answersByParticipant` / `currentAnswers`）
- `handleToggleCorrect`（○× の手動修正）
- `handleReveal` 内の `answers` への `is_correct` 書き込み
- `handleNext` 内のスコア加算（`participants.score` の更新）
- `judgeAnswer` / `answersForTrack` / `Answer` 型のインポート

**残す / 変更するもの**:
- `handlePlayIntro`: そのまま（15 秒再生 → `phase='answering'`）
- `handleReveal`: **`phase='revealed'` にして `playFull()` するだけ**に簡素化
- `handleNext`: **曲を進めるだけ**に簡素化
- `ErrorBanner` と `describeError` は残す（再生失敗の調査に必要）

**画面構成**:

```
第 3 問 / 20
┌─────────────────────┐
│  Lemon / 米津玄師          │ ← phase==='revealed' のときだけ
└─────────────────────┘
[ ▶ イントロ再生（15秒） ]  ← intro
[ 🔊 正解を見る          ]  ← answering
[ ⏭ 次の曲へ / 結果を見る ]  ← revealed
```

「あなたは出題役です（スコア対象外）」の文言は、スコア自体が無くなるので削除する。

**完了条件**: ホスト画面で 3 曲ぶん、再生 → 正解表示 → 次の曲、が回る。

---

## T8-3 `ResultScreen` を「流れた曲一覧」に作り替える

**対象**: `screens/ResultScreen.tsx`

ランキングを廃止し、**その日流れた曲の一覧**を出す。
「さっきの曲なんだっけ」に答えられるようにするのが目的。

- `playlistTracks` を上から順に「1. 曲名 / アーティスト」で表示
- 実際に流したのは `currentTrackIndex` までなので、**そこまでで切る**
- `rankParticipants` とスコア関連の表示をすべて削除
- 「ホームに戻る」は現状のまま（`reset()` + `navigation.reset`）

**完了条件**: 最終曲の後、流れた曲が順番に一覧表示される。

---

## T8-4 使われなくなるコードの削除

- `lib/answerMatch.ts` を削除（`judgeAnswer` / `normalizeTitle`）
- `store/roomStore.ts` から `answers` / `submittedTrackIndex` の state とアクション
  （`setAnswers` / `upsertAnswer` / `setSubmittedTrackIndex` / `fetchAnswers` / `answersForTrack`）を削除
- `hooks/useRoomRealtime.ts` から **`answers` の購読と `fetchAnswers()` 呼び出し**を削除
- `types/database.ts` の `Answer` 型は残してよい（テーブルは残すため）

**`participants` の購読は残すこと。** ホストがロビーで準備状況を見るのに必要。

**完了条件**: `node node_modules/typescript/lib/tsc.js --noEmit` が通り、
未使用インポートが残っていない。

---

## T8-5 動作確認

**構成**: ホスト = Mac の Safari（`http://localhost:8081`）、
ゲスト = 同じ Wi-Fi のスマホ（`http://<MacのLAN IP>:8081`）

1. ゲストがライブラリを送信すると、**ホストのロビーに即座に反映される**（participants の Realtime）
2. ホストが開始 → ホストだけクイズ画面へ。ゲストはロビーのまま表示が変わる
3. 3 曲ぶん、再生 → 正解表示 → 次の曲
4. 最後まで進むと、全員が結果画面（流れた曲一覧）へ

**完了条件**: 上記が通しで動く。

---

# Phase 6 —（任意）ネイティブ iOS 化

設計判断 1 で「Web で作り切る」を選んだため、**ゲーム性の検証が済んでから**改めて検討します。
MusicKit JS は使えないので、Swift の MusicKit を叩く Expo Module + dev build が必要で、**別プロジェクト規模**です。
Phase 5 まで完了し、実際に遊んで面白いと確認できてから起票してください。

---

# 付録

## やってはいけないこと

- **`api.post()` を使う** — v3 に存在しません（[PLAN.md §8](PLAN.md)）
- **`playParams.id` を再生に使う** — ライブラリ内 ID なので他人の曲が鳴りません
- **`v1/catalog/jp/...` のようにストアフロントをハードコードする** — `{{storefrontId}}` を使う
- **`api.music` の POST で body を文字列化し忘れる** — 自動ではやってくれません
- **Broadcast で進行を同期する** — 設計判断 3-A で不採用。再接続で状態が壊れます
- **`useEffect` から `play()` を呼ぶ** — ブラウザの自動再生ポリシーで無音失敗します
- **画面側で `navigate` してゲームを進める** — 遷移は `useGameNavigation` に一本化しています
- **あいまい一致で正誤判定する** — 誤正解は体験を壊します。手動上書きで十分です
- **ホストに「Apple Music 認証前」のスキップボタンを出す** — 曲を鳴らすのはホスト端末です。
  認証を飛ばすと、ゲーム開始後の初回再生で認証ポップアップが出て進行が止まります（判断 5 / T7-4）
- **スキップを `library_tracks` が空かどうかだけで判定する** — 「まだ出していない」と区別できず、
  ホストの開始ゲートが永久に閉じます。`skipped_library` 列で明示的に区別してください（T7-3）
- **`globalThis.process` が存在する状態で `MusicKit.configure()` を呼ぶ** — MusicKit が Node 環境と誤認し、
  `setQueue()` が無言で何もしなくなる。`withProcessHidden()` を経由すること（[PLAN.md §9](PLAN.md)）
- **再生できない原因をアプリのコードだけで探す** — DRM/ブラウザ側の要因があり得る。
  素の HTML ページで再現するか先に確かめると早い
- **`.env` / `scripts/AuthKey_*.p8` をコミットする**

## 各 Phase の受入条件（再掲）

| Phase | 受入条件 |
|-------|----------|
| 0 | ホスト端末で、**他の参加者の**ライブラリ由来の曲が 15 秒だけ鳴って止まる |
| 1 | 「開始」でホストとゲストの両方がクイズ画面に遷移。出題リストが 20 曲・シャッフル済み・参加者ごと均等 |
| 2 | 2 タブで 3 曲ぶん、イントロ再生 → 解答 → 正解発表 → 次の曲、が破綻なく回る |
| 3 | 最終曲の後に全員が結果画面へ遷移し、順位が正しい |
| 4 | ゲーム途中でリロードしても同じ問題に復帰できる |
| 5 | 実車で 1 ゲーム完走できる |
| 7 | **Apple Music に一度も接続していないゲストが、ロビー → クイズ → 結果まで通しで遊べる** |

## ファイル別の変更マップ

| ファイル | タスク |
|----------|--------|
| ファイル | タスク |
|----------|--------|
| `types/musickit.d.ts` | T0-2（全面書き換え） |
| `types/database.ts` | T0-4, T1-2, **T7-2** |
| `hooks/useMusicKit.ts` | T0-3, T0-5 |
| `hooks/useRoomRealtime.ts` | T1-6, T4-2 |
| `hooks/useGameNavigation.ts` | T1-7（新規） |
| `hooks/useIntroPlayback.ts` | T2-2（新規） |
| `lib/answerMatch.ts` | T2-1（新規） |
| `lib/roomCode.ts` | T4-3（新規） |
| `store/roomStore.ts` | T1-3, T1-5, T4-1, T4-3, **T7-2, T7-3** |
| `store/userStore.ts` | T4-1 |
| `navigation/types.ts` | T1-4 |
| `App.tsx` | T1-4, T4-1, **T7-6** |
| `screens/LibraryImportScreen.tsx` | T0-4, **T7-4** |
| `screens/HostLobbyScreen.tsx` | T0-6, T1-8, T2-3, T4-3, **T7-5** |
| `screens/GuestLobbyScreen.tsx` | T1-7 |
| `screens/HostQuizScreen.tsx` | T1-4, T2-3（新規） |
| `screens/GuestQuizScreen.tsx` | T1-4, T2-4（新規） |
| `screens/ResultScreen.tsx` | T1-4, T3-1（新規） |
| `screens/HomeScreen.tsx` | T4-3 |
| `supabase/migrations/` | T1-1, T4-3, **T7-1** |
