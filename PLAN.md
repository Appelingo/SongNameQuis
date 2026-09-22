# IntroQ プロジェクト計画

> 作成日: 2026-09-02 / 前提資料: [HANDOFF.md](HANDOFF.md), [pre-prompt.txt](pre-prompt.txt)
> 実コード（screens / hooks / store / supabase / scripts）を読んだ上での計画です。

---

## 0. ゴール定義

**完成の定義（MVP）**: 車内で 3〜5 人が集まり、全員のライブラリから作った出題リストで、
ホスト端末 1 台の音でイントロクイズを最後まで遊べる。これが**一度も手作業の介入なしに通る**こと。

> **【2026-09-06 更新】** 当初は「解答をテキスト入力して採点しランキングを出す」設計だったが、
> 判断 6 で廃止した。同じ場にいる人同士で遊ぶため、答えは声に出せばよい。詳細は判断 6。

MVP に含めないもの（意識的に後回し）:
- Apple Music 以外のサービス、ネイティブ iOS ビルド、ユーザー認証、ルーム永続化・再訪、
  スコアの永続ランキング、UI の作り込み。

---

## 1. 現状評価

### 動いているもの
ホーム（ルーム作成／参加）、ライブラリ取込画面の UX、ホスト／ゲストロビー、
`rooms` / `participants` の Realtime 購読、Zustand の 2 ストア、Supabase スキーマとクライアント。
土台としては素直で、命名も一貫している。**この構成は変えずに増築する**。

### コードを読んで見つかった、HANDOFF に書かれていない問題

計画上これらが重要なのは、「クイズ画面を作る」より前に潰さないと**クイズ画面が原理的に動かない**ものが混ざっているからです。

| # | 問題 | 影響 | 対応フェーズ |
|---|------|------|------|
| A | **再生用の曲 ID がどこにも残らない** | ホストが曲を再生できない＝クイズが成立しない | Phase 0 |
| B | ライブラリ曲の ID として `playParams.id` を採用している | それはライブラリ内 ID (`i.xxxx`)。**他人のライブラリの曲はホスト端末で再生できない**。必要なのは `playParams.catalogId` | Phase 0 |
| C | `createPlaylist` が `instance.api.post()` を呼んでいる | MusicKit **v3 に `api.post` は存在しない**。バンドル実物で確認済み（§8）。トークン問題を直しても `api.post is not a function` で必ず落ちる | Phase 0 |
| D | 曲順がシャッフルされていない | `mergeAndDedupeTracks` は参加者順に連結するだけ。参加者 1 の曲が延々続く。pre-prompt の「ランダムにピック／誰も不利にならない」を満たさない | Phase 1 |
| E | 出題数に上限がない | 全員のライブラリ全曲（数百〜数千曲）がそのまま出題リストになる | Phase 1 |
| F | `answers` に一意制約が無い | 同じ人が同じ問題に何度も解答を INSERT できる | Phase 1 |
| G | セッション情報が Zustand のメモリだけ | ブラウザをリロードした瞬間に `roomId` / `participantId` を失い、ゲームから脱落する。車内で実際に起きる | Phase 4 |
| H | `answers` / `participants` が Realtime publication に入っているか未確認 | 既存マイグレーションの `alter publication` はコメントアウト済み。手動で入れた記憶に依存している | Phase 1 |
| I | RLS が全開（誰でも任意のルームを update 可能） | MVP としては許容。ただし「知っている人が壊せる」状態であることは自覚しておく | Phase 5 |

### ブロッカー: MusicKit `Invalid token` の診断

`.env` の JWT を実際にデコードして確認しました。結果:

```
header  : { alg: ES256, typ: JWT, kid: 47WQV53S52 }
payload : { iat, exp, iss: RL375LBE96 }   有効期間 180.0 日 / 未期限 / 引用符・改行なし
```

**トークンの形式・期限・Team ID・Key ID・`.env` の書式には問題がありません。**
`scripts/generate-apple-music-token.js` の再実行や書式の直しは、おそらく徒労です。

「REST（curl / node fetch）では 200 が返るのに、ブラウザの `MusicKit.configure()` だけが落ちる」という
症状の非対称性が答えを指しています。**REST はオリジンを見ないが、MusicKit JS はオリジン込みでトークンを検証する**ためです。

原因の仮説（確度順）:

1. **オリジン未登録** — Apple Developer の Media IDs で **MusicKit Identifier** を作り、
   そこに `http://localhost:8081` / 実際の配信ドメインを登録し、キーと紐付ける必要がある。未登録だと `Invalid token`。
2. **キーの種類ちがい** — Keys で作った鍵が **Media Services (MusicKit) を有効にしていない**、
   または MusicKit Identifier に関連付けられていない。
3. `localhost` を Apple 側が受け付けない構成になっている（その場合は https トンネル経由で検証する）。

検証手順（Phase 0 の最初の 30 分でやること）:
- Apple Developer → Certificates, Identifiers & Profiles → **Media IDs** に MusicKit Identifier があるか、
  そこに開発用オリジンが登録されているかを目視確認する。
- ブラウザ DevTools の Network タブで、`configure()` が投げる検証リクエストの**レスポンス本文**を読む。
  推測せず、Apple が返している理由をそのまま読む。
- ダメなら `ngrok` などの https URL でアプリを開き、そのドメインを登録して再試行し、
  「localhost が原因なのか / キー設定が原因なのか」を切り分ける。

---

## 2. 設計判断（すべて A 案で確定）

> **確定済み。** 以下はユーザー承認済みで、[TASKS.md](TASKS.md) の指示書はこれを前提に書かれています。
> 変更する場合は指示書も併せて見直しが必要です。
>
> 1. **Web で作り切る**（ネイティブ iOS 化は Phase 6 で別途検討） ── 2026-09-02
> 2. **`playParams.catalogId` を取得時に保存**し、欠損分だけカタログ検索でフォールバック ── 2026-09-02
> 3. **進行同期は `rooms` 行を唯一の真実にする**（Broadcast は使わない） ── 2026-09-02
> 4. **正誤判定は自動正規化マッチ + ホストの手動上書き** ── 2026-09-02
> 5. **曲を提供せずに参加できる**（ホストは Apple Music 認証が必須、ゲストは不要） ── 2026-09-03
> 6. **解答入力と採点を廃止する**（同じ場にいるので口頭で答える） ── 2026-09-06
> 7. **難易度は「冒頭を流す秒数」で 5 段階**。停止判定は壁時計ではなく再生位置で行う ── 2026-09-13
> 8. **出題音源を本編ストリームからプレビュー音源に変更する** ── 2026-09-13
> 9. **公開前に匿名認証を入れ、RLS を所有権ベースにする** ── 2026-09-13
> 10. **出題曲の供給源にジャンル別プリセットを追加する** ── 2026-09-22

計画を進める前に、あなたに決めてほしい／すでに決まっているなら明示しておきたい点です。
以降のフェーズは **すべて「A案」を採用した前提**で書いています。

### 判断 1: プラットフォーム — Web で作り切るか、ネイティブ iOS を目指すか

pre-prompt には「iOS 向け」とありますが、`hooks/useMusicKit.ts` は MusicKit **JS** なので Web 専用です。
実機 iOS でライブラリを読むにはネイティブ MusicKit（Swift 側の実装 + Expo dev build）が必要で、これは別プロジェクト規模の作業です。

- **A案（推奨）: Web で完成させる。** 全員が Safari / Chrome で URL を開いて遊ぶ。
  車内なら「ホストが URL を共有 → 各自ブラウザで開く」で成立する。MVP をこの範囲で完走できる。
- B案: 先にネイティブ化する。→ MVP が数週間遠のく。ゲーム性の検証すらできないまま基盤作業をすることになる。

**A案。** ゲームとして面白いかを先に確かめ、面白ければネイティブ化を Phase 6 として別途検討する。

> **【2026-09-13 更新】判断 8 でプレビュー音源に切り替えたため、この制約は解消した。**
> 以下は本編ストリームを鳴らしていた頃の記録として残す。
>
> **【2026-09-06 追記】ホストのブラウザは Safari 必須だった。**
> Apple Music の本編再生は DRM で保護されており、ブラウザごとに使う DRM が違う。
> Safari は FairPlay、Chrome は Widevine を使うが、**検証機の Chrome は Widevine を提供しておらず**
> (`requestMediaKeySystemAccess('com.widevine.alpha')` が `NotSupportedError`)、
> MusicKit が Widevine 用ストリーム(`flavor: 28:ctrp256`)を選んだ時点で
> ライセンス取得に失敗する(`MEDIA_LICENSE` / `-42191`)。
> Safari では FairPlay 用ストリーム(`flavor: 34:cbcp64`)が選ばれ、正常に再生される。
> 詳細は §9 を参照。**ゲストは音を鳴らさないので、ブラウザは何でもよい。**

### 判断 2: 再生対象の解決方法

ホストが曲を鳴らすには、**ホストのアカウントで再生できるカタログ曲 ID** が要ります。

- **A案（推奨）: ライブラリ取得時に `playParams.catalogId` を拾って保存する。**
  取れなかった曲だけ、プレイリスト確定時にカタログ検索でフォールバックする。
  → API 呼び出しが出題数ぶん（〜20 回）で済む。
- B案: 現状どおり毎回カタログ検索する。→ 数百曲ぶんの検索が直列に走り、ロビーで数分固まる。

**A案。** これは Phase 0-B / 0-C の修正とセットで入れます。

### 判断 3: 進行状態の同期方法 — Broadcast か DB 状態か

HANDOFF では `reveal_answer` / `next_track` を **Broadcast** で送る想定になっています。
ただし Broadcast は**送信時に繋がっていた人にしか届かず、再接続しても復元されません**。
車内はトンネル・電波途切れが日常なので、これは実用上の弱点になります。

- **A案（推奨）: `rooms` 行を唯一の真実にする。** `phase` カラム（`intro` / `answering` / `revealed`）を足し、
  ホストは `rooms` を UPDATE するだけ。ゲストは既存の `rooms` UPDATE 購読で追従する。
  再接続時は `fetchRoom()` するだけで正しい画面に復帰できる。**新しい購読の仕組みを増やさなくて済む**のも利点。
- B案: Broadcast。低遅延だが、状態復元の仕組みを別途作る羽目になり、結局 DB を見に行くことになる。

**A案。** Broadcast は「解答したことを即座に光らせる」程度の演出用途に限って、後から足せば十分です。

### 判断 4: 正誤判定

- **A案（推奨）: 自動正規化マッチ + ホストによる手動上書き。**
  自動判定（小文字化・全半角統一・記号と括弧内 `(feat. ...)` 除去・空白除去）で ○× を付け、
  ホスト画面で各解答をタップして反転できるようにする。表記ゆれは人間が最終判断する。
- B案: 完全自動のみ。→「Lemon」と「レモン」で揉めて場が白ける。
- C案: 完全手動のみ。→ ホストの負担が重く、運転中／助手席では厳しい。

**A案。**

### 判断 5: 曲を提供しない参加を許可する（2026-09-03 追加）

「曲を追加せずに参加する」ボタンを、ホスト・ゲストの両方に用意します。

**なぜ必要か**

- Apple Music に加入していない同乗者でも、解答側として参加できる（現状は全員が有料会員である必要がある）
- ライブラリを他人に見られたくない人が、抜けずに済む
- ホスト自身は出題役でスコア対象外なので、**ホストの曲をあえて出題プールに入れない**運用ができる
- 副次的に、`Invalid token`（Phase 0 のブロッカー）が未解決でも、ゲストはロビーまで到達できる

**ホストとゲストで条件が違う。これが実装上の肝です。**

| | Apple Music 認証 | ライブラリ提供 | 理由 |
|---|---|---|---|
| ホスト | **必須** | 任意（スキップ可） | 曲を鳴らすのはホスト端末。再生には Music User Token が要る |
| ゲスト | **不要** | 任意（スキップ可） | ゲストは解答するだけで、音は鳴らさない |

したがって **ホストのスキップボタンは「認証後」にしか出せません。**
認証前にスキップさせると、ゲーム開始後の初回再生で認証ポップアップが出て進行が止まります。

**「まだ提出していない」と「提出しないと決めた」を区別する必要がある**

現在の `participantReady()` は `library_tracks.length > 0` だけを見ています。
スキップした人は `library_tracks` が空のままなので、**このままだとホストの開始ゲートが永久に閉じます。**

- **A案（採用）: `participants.skipped_library`（boolean）を追加**し、
  `participantReady = 曲がある || スキップ済み` に変える。
- B案: `library_status text ('pending' | 'submitted' | 'skipped')`。表現力は高いが、
  既存の `library_tracks` 判定と二重管理になる。

**A案。** 既存の最小限のスキーマ方針に合わせます。

**受け入れるトレードオフ**

出題リストは参加者のライブラリから作るため、**曲を出した人は自分の曲を知っている分だけ有利**です。
裏を返すと、スキップした人は構造的にやや不利になります。これは本人の選択の結果なので許容します。
pre-prompt の「誰も不利にならない」は、**曲を出した人どうしの曲数を均す**ことで担保する、という理解です
（`buildQuizTracks` のラウンドロビンで実装済み）。

**全員がスキップした場合**は出題リストが 0 件になります。ホストの開始処理で弾き、
「全員が曲を提供していないため出題できない」と明示します。

### 判断 6: 解答入力と採点を廃止する（2026-09-06 追加）

**このアプリは、同じ車内にいる人同士で遊ぶ。** その前提を突き詰めると、解答入力欄は不要どころか有害である。

**廃止する理由**

1. **テキスト入力は「誰が最初に答えたか」を判定できない。** 同じ場にいるなら、声を上げた瞬間に順序は
   自明である。入力欄を挟むと、タイピング速度の差が勝敗を左右する。**現実の早押しより劣化した仕組み**になる。
2. **運転中・車内での文字入力は危険で、かつ面倒。**
3. 解答入力が消えれば、正誤判定の根拠も消えるので**採点とランキングも道連れで不要**になる。

**廃止するもの**

- 解答入力欄（`GuestQuizScreen`）
- `answers` テーブルの利用と、その Realtime 購読
- 正誤の自動判定（`lib/answerMatch.ts`）とホストによる ○× 手動修正
- `participants.score` とランキング表示

> テーブルとカラム自体は残す（DROP しない）。使わなくなるだけ。将来戻す可能性があり、
> 消しても得るものが無いため。

**残すもの**

- ルーム作成・参加、ライブラリ取込（スキップ含む）
- **出題リスト生成の公平性ロジック**（`buildQuizTracks` のラウンドロビン + シャッフル）。
  採点が無くても「特定の人の曲ばかり流れる」と場が白けるので、これは価値が残る。
- ホストの再生制御（イントロ 15 秒 → 正解表示 + フル再生 → 次の曲）

**副次的な効果: ゲストはクイズ中に何も操作しなくなる。**
そのため**ゲスト画面を Realtime で更新する必要もほぼ消える**。
Realtime が要るのは「ホストがロビーで参加者の準備状況を見る」場面だけになり、
同期まわりの失敗の余地が大きく減る。

**新しいゲーム進行**

```
ホスト: [イントロ再生（0.1〜10秒 / 難易度で可変）] → 全員が声で答える → [正解を見る]（曲名表示 + フル再生） → [次の曲へ]
ゲスト: 操作なし。「ホストの画面を見てください」とだけ表示。
最後  : 流れた曲の一覧を表示（「さっきの曲なんだっけ」に答えられる）
```

**将来もし採点を戻すなら**、テキスト入力ではなく
**ホストが正解者の名前をタップして 1 点入れる**方式にする。そちらの方が現実の早押しと矛盾しない。

### 判断 7: 難易度トグルと、再生停止の測り方（2026-09-13 追加）

冒頭を何秒流すかを **0.1 / 1 / 2 / 5 / 10 秒**の 5 段階から選べるようにする（既定 2 秒）。
ホストのクイズ画面に置き、いつでも切り替えられる。ゲストには見せない（見る画面が無いため）。

**実装上の肝: 壁時計で測ってはいけない。**

当初の実装は `play()` を呼んでから `setTimeout(15000)` で止めていた。これは誤り。
ストリーミングは **再生が実際に始まるまでの待ちが数秒単位でばらつく**（実測で
`play()` の解決までに約 6 秒かかったログがある）。その待ち時間がまるごと誤差になるため、
0.1 秒のような短さは**原理的に実現できない**。

→ **曲の再生位置（`currentPlaybackTime`）を監視して止める。**
`requestAnimationFrame` で約 16ms ごとに見るので、0.1 秒でも実用上のずれに収まる。
起動の遅れが何秒あっても、鳴る長さは指定秒数で一定になる。

**「楽曲を保存しておけば速いのでは」への回答: できないし、必要ない。**

- **できない**: Apple Music の楽曲は FairPlay で DRM 保護されている。MusicKit JS から
  復号済み音声を取り出して保存する手段は無く、仮にできても規約違反になる。
- **必要ない**: 精度の問題は上記のとおり測り方で解決する。
  残る「押してから鳴るまでの待ち」は、**出題が切り替わった時点で次の曲を
  `setQueue()` でキューに積んでおく**ことで短縮する（`useIntroPlayback.prepare()`）。

> それでも待ちが気になる場合の次の一手は、**無音で一瞬再生してライセンス取得とバッファリングを
> 先に済ませる**方法。ただし音が漏れる危険があるため、実測して必要と判断してから入れる。

### 判断 8: 出題音源をプレビュー音源に変更する（2026-09-13 追加）

クイズで鳴らす音を、**MusicKit の本編ストリームから、カタログ API が返すプレビュー音源
（`previews[0].url`）に変更する。** 検証画面で実際に遊んで比較した上での判断。

**採用理由（実際に聴いて決めた）**

再生される箇所が曲によってサビだったりイントロだったりアウトロだったりと一定しない。
当初はこれを欠点と考えていたが、**遊んでみると、どこが来るか分からない方が面白い**と判断した。

**副次的に解消される問題（こちらも大きい）**

| これまでの問題 | プレビュー音源での状況 |
|---|---|
| DRM のため**ホストは Safari 必須**（Chrome は Widevine 非対応、§9） | **解消。** プレビューは DRM 無し（`mp4a` のみで `sinf`/`enca` 無し）なので、どのブラウザでも鳴る |
| 再生開始までのラグ、無音先読みという込み入った実装 | **解消。** 1MB 程度のファイルを取得してデコードし、メモリに置くだけ |
| 秒数の精度が出ない（再生位置を監視して止める必要があった） | **解消。** `AudioBufferSourceNode.start(when, offset, duration)` はサンプル単位で正確 |
| 波形を解析できず、冒頭の無音を飛ばせない | **解消。** Web Audio に接続できるので、音の立ち上がりを検出して飛ばせる |

**MusicKit は「ライブラリ取込」専用になる。**
参加者の曲を集めるには Music User Token が要るため MusicKit は残るが、
**再生経路からは完全に外れる**。したがって:

- ホストのブラウザ制約が無くなる
- 「正解を見る」での再生もプレビュー 30 秒を流す（本編フル再生にすると DRM が戻ってきてしまうため）

**データの持ち方**

`PlaylistTrack` に `previewUrl` を追加する。`rooms.playlist_tracks` は jsonb なので**マイグレーション不要**。
出題リストを作る時点でカタログ API に一括問い合わせ（`/v1/catalog/{sf}/songs?ids=...`）して埋める。
プレビューが無い曲は出題対象から外す。

**残る制約**

- プレビューの位置は API から分からない。どこが切り出されているかは鳴らしてみるまで不明（それが面白さでもある）
- プレビュー音源を試聴以外の用途で使うことが Apple の規約上どう解釈されるかは未確認。身内で遊ぶ範囲での利用にとどめる判断

### 判断 9: 匿名認証を入れて RLS を所有権ベースにする（2026-09-13 追加）

一般公開するにあたり、RLS を実効性のあるものにする（T5-2）。

**前提の整理: 認証が無い限り RLS は機能しない**

現状は Supabase Auth を使わず、参加者をクライアント生成の UUID で識別している。
RLS ポリシーは `auth.uid()` のような**検証可能な身元**が無いと「この人がホストか」を判断できない。
つまり現状ではどんなポリシーを書いても `using (true)` と実質同じで、
**anon key を持つ誰でも全ルームを書き換えられる**。anon key はバンドルに埋め込まれ公開される。

→ **Supabase の匿名サインイン（`signInAnonymously()`）を入れる。**
各クライアントが本物の `auth.uid()` を持つので、初めて所有権を検証できる。
UI 上の変更は無く、ユーザーには見えない。

**ポリシーの方針**

| テーブル | SELECT | INSERT | UPDATE |
|---|---|---|---|
| `rooms` | 認証済みなら可 | `host_user_id = auth.uid()` を強制 | **ホスト本人のみ** |
| `participants` | 認証済みなら可 | `user_id = auth.uid()` を強制 | **本人の行のみ** |
| `answers` | 認証済みなら可 | 本人のみ | 本人のみ |

DELETE はどのテーブルにもポリシーを作らない（＝すべて拒否）。

**意図的に残す穴: 列挙は防げない**

ルームコードで参加するには、まず `rooms` を検索できる必要がある。
そのため SELECT は認証済みユーザーに開けたままにする。
結果として、**匿名サインインさえすれば全ルームのニックネームと曲名は読める**。

これを塞ぐには「コードを渡すと参加処理まで済ませる」SECURITY DEFINER 関数を用意し、
テーブルへの直接 SELECT を閉じる必要がある。今回はやらない。
読めて困る情報がニックネームと曲名だけであり、
**書き換えを防ぐこと（進行中のゲームを壊されないこと）の方が実害が大きい**ためこちらを優先する。

**運用上の注意**

- **Supabase ダッシュボードで匿名サインインを有効にする必要がある。** 無効のままだと全機能が動かない
- セッションは AsyncStorage に保存される（`lib/supabase.ts` で設定済み）。
  ブラウザのデータを消すと**自分が作ったルームの操作権を失う**。ゲームは使い捨てなので許容する

### 判断 10: ジャンル別プリセットを追加する（2026-09-22 追加）

出題曲の供給源を「参加者のライブラリ」だけでなく、
**Apple Music のジャンル別人気チャート**からも選べるようにする。

**効果: ゲストは Apple Music が無くても遊べる**

従来はライブラリ取込が必須で、**参加者全員**が Apple Music を求められる場面があった。
プリセットならゲスト側は契約も認証も不要になる。
ただし**ホストの認証は必須**とする（後述の規約上の判断）。

**API 調査結果（2026-09-22 実測）**

| 項目 | 結果 |
|---|---|
| ジャンル一覧 | `/v1/catalog/{sf}/genres` で 20 件（J-Pop, K-Pop, クラシック, ヒップホップ, アニメ, 演歌 など） |
| ジャンル別チャート | `/v1/catalog/{sf}/charts?types=songs&genre={id}&limit=100` で 100 曲。`next` で追加取得も可 |
| プレビュー音源 | 試した 8 ジャンルすべてで **100/100 曲**に存在 |
| ライブラリ側のジャンル | `genreNames` が最初から入っている（現状は保存時に捨てている） |

**ルームに「出題ソース」を持たせる**

`rooms.source_mode`（`'library'` / `'preset'`）を追加する。
これが**ライブラリ取込画面を通すかどうか**を決める。

```
preset  : Home → （取込なし）→ ロビー → ホストがジャンルを選んで開始
library : Home → ライブラリ取込 → ロビー → 開始（従来どおり）
```

- **モードはルーム作成時に決める**。参加者が取込画面を通るかが変わるため
- **ジャンルはロビーで選ぶ**。開始直前に変えられる方が使い勝手がよい
- preset では誰もライブラリを出さないので、**ホストの開始ゲート（全員準備完了）は適用しない**

**【2026-09-22 追記】プリセットでもホストの Apple Music 認証は必須にする**

当初は「プリセットなら認証も契約も不要で遊べる」と設計したが、**規約面で危うい**と判断して撤回した。

- Apple のガイダンスは MusicKit を
  *"intended for simple music playback by Apple Music subscribers"* と明示している
- プレビュー URL のみを使う統合は**グレーゾーン**とされ、Apple Developer Forums でも
  同種の質問に明確な回答が見当たらない
- さらに本実装は MusicKit のプレイヤーを使わず、プレビュー音源を自前で
  ダウンロードして 0.1 秒単位に切り刻んでおり、「simple music playback」から遠い

→ **ホストは必ず Apple Music に接続してからでないとゲームを開始できない。**
契約者が自分の権限で音楽を鳴らし、同席者がそれを聴く、という構図に揃える。
ゲストは引き続き認証も契約も不要。

> 確実な答えが要る場合は Apple Developer Relations に照会すること。
> 現状は「安全側に倒した」判断であり、許諾を確認したわけではない。

**残すトレードオフ**

pre-prompt の原点である「みんなのライブラリから曲を集める」からは離れる。
知らない曲ばかりでは盛り上がらない可能性もあるため、**両モードを併存させる**。

ライブラリ側のジャンル絞り込みは今回見送る。ライブラリは英語表記（`"Hip-Hop/Rap"`）、
カタログは日本語（`"ヒップホップ／ラップ"`）で**表記が揃っておらず**、対応付けの設計が要るため。

---

## 3. アーキテクチャ更新案

### データモデル差分

**作成済み**（適用は手動。[TASKS.md](TASKS.md) の T1-1 / T4-3 参照）

```sql
-- supabase/migrations/20260902000000_quiz_phase.sql
-- 進行フェーズを rooms に持たせる（判断 3-A）
create type track_phase as enum ('intro', 'answering', 'revealed');
alter table rooms add column phase track_phase not null default 'intro';

-- 同一問題への多重解答を防ぐ（問題 F）
alter table answers
  add constraint answers_unique_per_track unique (room_id, participant_id, track_index);

-- supabase/migrations/20260902000001_room_code.sql
-- 車内で口頭共有できる 6 桁コード
alter table rooms add column code text unique;
```

**これから追加（判断 5）**

```sql
-- supabase/migrations/2026xxxxxxxxxx_skip_library.sql
-- 「まだ出していない」と「出さないと決めた」を区別する
alter table participants
  add column skipped_library boolean not null default false;
```

**Realtime publication は手で確認する。**
既に登録済みの状態で `alter publication` を流すとエラーになり、マイグレーション全体が止まるため、
マイグレーションファイルには含めません（問題 H）。

```sql
select tablename from pg_publication_tables where pubname = 'supabase_realtime';
-- 不足しているものだけを追加する
alter publication supabase_realtime add table public.participants;
alter publication supabase_realtime add table public.answers;
```

`playlist_tracks` の各要素は `{ title, artist, catalogId }`（`types/database.ts` の `PlaylistTrack` は既にこの形）。
`library_tracks` も `LibraryTrack` に `catalogId?: string` を足して同じ形に揃えます。

### 状態の持ち方

| 状態 | 置き場所 | 理由 |
|------|---------|------|
| 現在の曲番号・フェーズ・出題リスト | `rooms` テーブル（Realtime） | 全員が同じものを見る必要があり、再接続で復元したい |
| 各人の解答 | `answers` テーブル（Realtime） | 履歴が要る／後から集計する |
| スコア | `participants.score`（ホストが更新） | 集計を毎回やり直さずに済む。`answers` からの再計算でいつでも検証可能 |
| 自分が解答を送ったか / 入力中テキスト | Zustand（ローカル） | 他人に見せる必要がない |
| roomId / participantId / isHost | Zustand + AsyncStorage | リロード復帰のため（問題 G） |
| ライブラリを出したか / スキップしたか | `participants.library_tracks` + `skipped_library`（Realtime） | ホストの開始ゲートの判定に全員ぶん必要（判断 5） |

### 画面遷移（目標）

```
Home
 └→ LibraryImport（全員）
      │    ├ ライブラリを送信
      │    └ 「曲を追加せずに参加」（判断 5 / ゲストは Apple Music 認証なしでも通れる）
      ├→ HostLobby  ─ rooms.status='playing' ─→ HostQuiz ─ 'finished' ─→ Result
      └→ GuestLobby ───────────（画面はそのまま）──────────→ 'finished' ─→ Result
                     status='playing' になっても遷移しない。
                     「ゲーム中。ホストの画面を見てください」と表示を変えるだけ（判断 6）。
```

`GuestQuizScreen` は判断 6 で削除。ゲストはクイズ中に操作しないため、画面を持つ必要がない。

遷移のトリガーは**すべて `rooms.status` の変化**に統一します。ホストも自分で `navigate` せず、
自分が書いた UPDATE を Realtime で受け取って遷移する。こうするとホストとゲストで遷移ロジックが 1 本になり、
ホスト画面だけ状態がズレる事故が消えます。

---

## 4. フェーズ計画

各フェーズに**受入条件（これが確認できたら次へ進む）**を付けています。
1 フェーズごとに手を止めて動作確認する運用を想定しています。

### Phase 0 — 音を鳴らせる状態にする（最優先・ここが全体の生死を分ける）

これが終わるまで、クイズ画面を書いても検証できません。

1. **`Invalid token` の切り分け**（§1 の検証手順）。Apple Developer の Media IDs 設定を直す。
2. **`playParams.catalogId` を拾う**（問題 B）。`fetchAllLibrarySongs` の `catalogId` 採用元を
   `playParams.id` → `playParams.catalogId` に変更し、取れない曲は `catalogId` なしで通す。
3. **`catalogId` を Supabase まで運ぶ**（問題 A）。`LibraryImportScreen` の送信で `catalogId` を落とさない。
   `LibraryTrack` 型に `catalogId?` を追加。`mergeAndDedupeTracks` も維持する。
4. **`createPlaylist` を MusicKit v3 の API に直す**（問題 C）。
   `api.post` を `api.music(path, params, { fetchOptions: { method: 'POST', body } })` 形式に置き換える。
   `types/musickit.d.ts` の `api` 型定義も併せて更新。
5. **再生の最小検証**。ホストロビーに一時的なデバッグボタンを置き、
   `setQueue({ songs: [catalogId] })` → `play()` → 15 秒後 `pause()` が実機ブラウザで鳴ることを確認する。

**受入条件**: ホスト端末のブラウザで、他の参加者のライブラリ由来の曲が 15 秒だけ鳴って止まる。
（プレイリスト作成が通ること自体は必須ではない。**鳴ること**が本質。）

> 補足: 5 が通れば、実は「Apple Music にプレイリストを作る」機能は MVP に必須ではありません。
> 出題リストは `rooms.playlist_tracks` に持っているので、再生は `setQueue` だけで足ります。
> プレイリスト作成が難航するなら **Phase 5 に降ろす**のが正しい判断です。

### Phase 1 — 出題リストとゲーム進行の土台

1. マイグレーション（§3）を追加・適用する。`phase` / 一意制約 / publication。
2. **出題リスト生成を作り直す**（問題 D・E）。`store/roomStore.ts` に
   `buildQuizTracks(participants, { limit: 20 })` を追加:
   - `catalogId` を持つ曲だけを対象にする
   - 参加者ごとの採用数を均す（ラウンドロビンで 1 曲ずつ取る）→「誰も不利にならない」を構造で担保
   - 全体をシャッフルしてから `limit` 曲に切る
   - 既存の `mergeAndDedupeTracks` は重複排除部品として内部で再利用する
3. `navigation/types.ts` と `App.tsx` に `HostQuiz` / `GuestQuiz` / `Result` を追加。
4. `useRoomRealtime` を拡張: `rooms` の `phase` を反映、`answers` の INSERT/UPDATE を購読。
5. `store/roomStore.ts` にゲーム状態を追加: `phase`, `answers`, `myAnswerSubmitted`。
6. `rooms.status` の変化を監視して自動遷移するフックを 1 本作り、両ロビーと両クイズ画面で使う。

**受入条件**: ホストが「開始」を押すと、**ホストとゲストの両方**が空のクイズ画面に遷移する。
`rooms.playlist_tracks` が 20 曲・シャッフル済み・参加者ごとの曲数が均等になっている。

### Phase 2 — クイズ画面（コア）

**HostQuiz**
- 現在の曲番号 / 全体数、`phase` に応じた UI
- 「イントロ再生」: `setQueue` → `play()` → 15 秒で `pause()`、`phase='answering'` に更新
- 参加者の解答一覧（Realtime で流入、`phase='revealed'` まで**内容は伏せて「解答済み」だけ表示**）
- 「正解発表」: `phase='revealed'` に更新 → 曲名・アーティスト表示 + フル再生（`play()` を再開）
- 各解答の ○× を自動判定で初期化し、**タップで反転**（判断 4-A）。確定時に `participants.score` を加算
- 「次の曲へ」: `current_track_index + 1`, `phase='intro'`。最終曲なら `status='finished'`

**GuestQuiz**
- `phase='answering'` の間だけテキスト入力 + 送信（送信後はロック、1 問 1 回）
- `phase='revealed'` で正解と全員の解答・○× を表示
- 自分の現在スコアを常時表示

**共通**
- ホストも 1 プレイヤーとして解答できるか → **できない**方針にする（曲名が見えているため）。
  ホストは出題役に徹し、スコア対象外。UI でもそう明示する。

**受入条件**: 2 タブ（ホスト / ゲスト）で 3 曲ぶん、イントロ再生 → 解答 → 正解発表 → 次の曲、が破綻なく回る。

### Phase 3 — 結果画面

- `status='finished'` で全員が `Result` に遷移
- スコア降順ランキング（同点は同順位）、正解した曲の一覧
- 「ホームに戻る」で Zustand と永続化をリセット

**受入条件**: 最終曲の「次へ」で全員が結果画面に行き、順位が正しい。

### Phase 4 — 実戦での堅牢性（車内で必ず起きること）

1. **リロード復帰**（問題 G）。`roomId` / `participantId` / `isHost` を AsyncStorage に保存し、
   起動時に復元 → `fetchRoom()` + `fetchParticipants()` → `status` と `phase` に応じた画面へ直行。
2. **通信断からの復帰**。Realtime 再購読時に必ず `fetchRoom()` / `fetchParticipants()` / 解答再取得を行い、
   取りこぼした状態を埋める（判断 3-A を採ったので、これだけで整合する）。
3. **ルーム ID の共有**。UUID は口頭で読めない。**6 桁の短いルームコード**を `rooms` に追加するか、
   最低でもコピーボタンと QR 表示を付ける。→ 車内 UX に直結するので、優先度は見た目より高い。
4. 遅れて参加した人、途中離脱した人の扱いを決めて実装する。

**受入条件**: ゲームの途中でゲストがブラウザをリロードしても、同じ問題の画面に戻ってこられる。

### Phase 5 — 仕上げ

- Apple Music プレイリスト作成（Phase 0 から降ろした場合はここ）
- RLS の見直し（問題 I）。最低限、`host_id` を知らないと `rooms` を UPDATE できないようにする
- エラーハンドリングの通し見直し、`Alert` に頼りすぎている箇所のインライン化
- Node を `>=20.19.4` に上げる（現在 v20.12.0 で警告が出続けている）
- 実車での通し確認

### Phase 6 —（任意）ネイティブ iOS 化

判断 1 で A 案を採ったため、ゲーム性の検証が済んでから改めて検討する。
MusicKit JS はここでは使えないので、Swift の MusicKit を叩く Expo Module + dev build が必要。**別プロジェクト規模**。

---

## 5. 実装メモ

### 正誤判定の正規化

```ts
// 例: "Lemon (feat. X)" / "ＬＥＭＯＮ" / "lemon" をすべて "lemon" に寄せる
function normalizeTitle(s: string): string {
  return s
    .normalize('NFKC')            // 全角英数 → 半角、互換文字の統一
    .toLowerCase()
    .replace(/\(.*?\)|\[.*?\]|（.*?）/g, '')   // (feat. ...) 等を除去
    .replace(/[\s\-_'"‘’“”.,!?、。・]/g, '')  // 記号と空白を除去
    .trim();
}
```
完全一致で判定し、ホストが手動で上書きできるようにする（判断 4-A）。

### 15 秒再生

- ブラウザの自動再生制限があるため、**必ずホストのタップ操作を起点に** `play()` を呼ぶ。
- `setQueue` → `play()` → `setTimeout(15000)` で `pause()`。
  画面遷移やアンマウント時にタイマーを必ず `clearTimeout` する（曲が変わってから前のタイマーが止めに来る事故を防ぐ）。
- 正解発表後のフル再生は、頭から聴かせるなら `seekToTime(0)` してから `play()`。
- `types/musickit.d.ts` に `seekToTime` / `playbackState` / `nowPlayingItem` の型を追加する。

### ホストの `catalogId` 欠損対策

他人のライブラリ限定曲（カタログに存在しない曲）はホスト端末で再生できません。
Phase 1 の `buildQuizTracks` で `catalogId` を持たない曲を**そもそも出題対象から除外**することで、
「再生ボタンを押したら鳴らない」という最悪の体験を構造的に避けます。

---

## 6. リスク

| リスク | 影響 | 対応 |
|--------|------|------|
| `Invalid token` が Apple 側の設定変更を要し、時間が読めない | 全体が止まる | Phase 0 の切り分けを最優先。Apple のレスポンス本文を読んで推測を排する |
| Apple Music 加入者しか遊べない | 遊べる人が限られる | **判断 5 で概ね解消。** ゲストは「曲を追加せずに参加」で加入なしでも遊べる。加入が必須なのは再生するホストだけ |
| **ホストのブラウザが Safari でないと再生できない** | ホストだけ環境が限定される | DRM の制約で回避不能（§9）。ホスト用の案内に明記し、将来的にはアプリ側で警告を出す |
| 全員がライブラリ提供をスキップすると出題できない | ゲームが始められない | ホストの開始処理で弾き、理由を明示する（判断 5） |
| MusicKit v3 の API 仕様（v2 からの破壊的変更） | 実装が空振りする | `api.post` の件が既に実例。**書く前に v3 のドキュメントで確認する** |
| 車内の電波品質 | ゲームが中断する | Phase 4。状態を DB に集約した判断 3-A が効いてくる |
| Expo SDK 56 の仕様 | 手戻り | [AGENTS.md](AGENTS.md) の通り https://docs.expo.dev/versions/v56.0.0/ を都度参照 |

---

## 7. 次のアクション

**まず Phase 0-1（`Invalid token` の切り分け）だけをやる。** ここが通らない限り他は絵に描いた餅です。
Apple Developer の Media IDs 画面の状態と、DevTools で見えた `configure()` のレスポンス本文が分かれば、
そのまま Phase 0-2 以降のコード修正に進めます。

なお **Phase 0-2 〜 0-4（`catalogId` の取得・伝搬、`api.post` の修正）はトークン問題と独立**しているので、
Apple の設定確認と並行して先に着手できます。

---

## 8. 検証ログ: MusicKit v3 の API 実仕様

Apple のドキュメント URL が 404 だったため、**CDN で実際に配信されているバンドルを取得して直接確認**しました。
以下は推測ではなく、実装の読み取り結果です。

対象: `https://js-cdn.music.apple.com/musickit/v3/musickit.js` / 内部バージョン `3.2526.0`

### 確認できたこと

| 事項 | 結果 |
|------|------|
| `instance.api` の実体 | `MediaAPIService._initializeAPI` が `this._api = p.v3` としており、**`MediaAPIV3` インスタンス**が返る |
| `api.music(...)` | **存在する。** `MediaAPIV3` のコンストラクタが realm 名（`music`）をキーに `Object.defineProperty(this, 'music', { value: session.request.bind(session) })` で動的定義している。→ 現行コードの `api.music(...)` は正しい |
| `api.post(...)` | **存在しない。** バンドル全体に `post(` のメソッド定義が無い。`MediaAPIV3` は `configure` / `storefrontId` / realm アクセサのみ |
| `api.music` の引数 | `request(path, queryParameters, options)`。`options.fetchOptions` が `fetch()` の第 2 引数にそのまま渡る |
| POST の body | **自動で `JSON.stringify` されない。** `fetchMiddlewareFactory` は `fetch(url, fetchOptions)` を素通しするだけ。**手動で文字列化し、`Content-Type: application/json` も明示する必要がある** |
| 認証ヘッダ | `Authorization: Bearer <developerToken>` と `Media-User-Token` は `defaultOptions.fetchOptions.headers` として自動付与される。自前で付けなくてよい |
| URL テンプレート | `parameterizeString` により `{{storefrontId}}` が使える（`defaultUrlParameters` に注入済み）。ストアフロントをハードコードした `v1/catalog/jp/...` は `{{storefrontId}}` に置き換えるべき |
| 戻り値の形 | ミドルウェアが `{ request, response, data }` を返す。`data` が JSON 本体なので、ライブラリ取得では `result.data.data` が配列。**現行の `unwrapMusicData` の二段アンラップは正しい** |
| `playParams.catalogId` | バンドル内に `createHelper("catalog-id", ({ catalogId, container }) => ...)` があり、ライブラリ項目のカタログ ID として実在する。判断 2-A の前提は正しい |

### この検証から導かれる修正

```ts
// ❌ 現行（v2 の API。v3 には存在しない）
await instance.api.post('v1/me/library/playlists', { attributes: { name } });

// ✅ v3
await instance.api.music('/v1/me/library/playlists', {}, {
  fetchOptions: {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ attributes: { name, description } }),
  },
});
```

> 今後 MusicKit 周りで挙動が読めなくなったら、同じ手法（バンドルを落として該当箇所を読む）が最短です。
> Apple の Web ドキュメントは欠落・404 が多く、当てになりません。

---

## 9. 検証ログ: 「音が鳴らない」の原因特定（2026-09-06）

長時間を要したので、経緯と結論を残す。**結論から言うと、アプリのコードの問題は 1 つだけで、
最終的に音を止めていたのは環境要因（ブラウザの DRM）だった。**

### 最終結論

| | Chrome | Safari |
|---|---|---|
| `com.widevine.alpha` | **NotSupportedError** | 非対応（不要） |
| `com.apple.fps`（FairPlay） | — | **OK / `createMediaKeys` 成功** |
| MusicKit が選んだ flavor | `28:ctrp256`（Widevine 系） | **`34:cbcp64`（FairPlay 系）** |
| 結果 | `MEDIA_LICENSE` / `-42191` で停止 | **`playbackState=2` で再生** |

**ホストは Safari を使うこと。** Chrome は Widevine を提供しておらず、
MusicKit が Widevine 用の暗号化ストリームを選んだ時点でライセンス取得に失敗する。

### 途中で潰した、本当のコードのバグ（1 件）

**`process` シムによる Node 環境の誤検出。** MusicKit は `configure()` 時に Runtime を組み立て、
その中で `isNodeEnvironment = (globalThis.process !== undefined)` を **一度だけ**確定させる。
Expo Web は `process` のシムを定義しているため、これが `true` になり、MusicKit は自分が Node 上で
動いていると誤認する。結果 `setQueue()` は冒頭の `_isPlaybackSupported()` で即 return し、
**例外もネットワークリクエストも出さないまま**キューが空になっていた。

→ `hooks/useMusicKit.ts` の `withProcessHidden()` で、`configure()` の間だけ `process` を隠して解決。
既存の `index.ts` の `process.versions = null` パッチは**別の判定用**（`process.versions.node` を見る方）
なので、両方必要。

### 誤診した仮説と、その反証

同じ轍を踏まないように残す。

| 仮説 | 反証 |
|------|------|
| 特定の曲のカタログ ID が無効 | 別の有効な ID（`1648659991`、jp/us 両方で 200）でも同じ失敗。**最初にこう結論づけたのは誤り** |
| `setQueue({songs:[...]})` のキー名が違う | バンドルの `Ao` 配列に `"songs"` が含まれる。キー名は正しい |
| ストアフロント不一致 | `storefrontId=jp` に正しく解決。ブラウザからのカタログ照会も 200 |
| HTTPS が必要 | 自己署名証明書の `https://localhost:8443` でも**同じ `MEDIA_LICENSE`**。HTTPS は無関係 |
| ライセンスサーバーに拒否されている | `acquireWebPlaybackLicense` は **200 OK**。拒否ではなく、取得後の復号段階で失敗 |
| `play()` が `pause()` に中断される（Chrome の警告） | 症状であって原因ではない。`MEDIA_LICENSE` → `onPlaybackError` → `stop()` → `pause()` の順 |

### 効いた調査手法

- **`HTMLMediaElement.prototype.play/pause` を monkey-patch して `console.trace`。**
  これで `startLicenseSession → acquirePlaybackLicense → _throw → onPlaybackError → stop → pause`
  という因果が一撃で見えた。ここが転換点。
- **Expo を通さない素の HTML ページで再現させる。**
  React/Expo/`process` シムを全部排除しても同じエラーが出たことで、
  アプリのコードが原因ではないと確定できた。
  （テストページの作り方は「素の HTML + MusicKit + イベント全ログ」。再現に有効なので手法として記録）
- **`requestMediaKeySystemAccess()` で DRM の対応状況を直接調べる。** これで Chrome/Safari の差が確定した。

### 反省

「複数の曲で失敗している」というユーザーの指摘を受けるまで、
1 曲のカタログ ID が無効だったという**誤った結論のまま進めかけた**。
症状が系統的かどうかを先に確かめるべきだった。
また、素の HTML での切り分けをもっと早くやるべきだった（ユーザーからの提案で実施）。
