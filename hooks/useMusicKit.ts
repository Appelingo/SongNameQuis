/// <reference path="../types/musickit.d.ts" />

import Constants from 'expo-constants';
import { useCallback, useEffect, useState } from 'react';
import { Platform } from 'react-native';

import type { LibraryTrack, PlaylistTrack } from '../types/database';
import type { MusicKitTrack } from '../types/musickit';

const MUSICKIT_SCRIPT_URL =
  'https://js-cdn.music.apple.com/musickit/v3/musickit.js';
const MUSICKIT_LOADED_EVENT = 'musickitloaded';

type MusicKitScope = 'music-library-read' | 'music-library-write';

let musicKitReadyPromise: Promise<void> | null = null;
let configuredInstance: MusicKitInstance | null = null;

function getDeveloperToken(): string {
  return (
    Constants.expoConfig?.extra?.appleMusicDeveloperToken ??
    process.env.EXPO_PUBLIC_APPLE_MUSIC_DEVELOPER_TOKEN ??
    ''
  ).trim();
}

function isMusicKitReady(): boolean {
  return (
    typeof window !== 'undefined' &&
    typeof window.MusicKit?.configure === 'function'
  );
}

/**
 * Expo/Metro のブラウザ向け process には versions が無いことがある。
 * MusicKit は process.versions.node を読んで落ちるため、先に null を入れて回避する。
 */
function patchProcessForMusicKit(): void {
  if (typeof process === 'undefined') return;
  try {
    // undefined / 欠落どちらでも MusicKit が window.Buffer 側に寄るよう null にする
    Object.defineProperty(process, 'versions', {
      value: null,
      writable: true,
      configurable: true,
    });
  } catch {
    try {
      process.versions = null;
    } catch {
      // ignore
    }
  }
}

function waitForMusicKitReady(timeoutMs = 15000): Promise<void> {
  return new Promise((resolve, reject) => {
    if (isMusicKitReady()) {
      resolve();
      return;
    }

    const started = Date.now();

    const onLoaded = () => {
      // configure が付くまで短くポーリング
      const poll = () => {
        if (isMusicKitReady()) {
          cleanup();
          resolve();
          return;
        }
        if (Date.now() - started > timeoutMs) {
          cleanup();
          reject(new Error('MusicKit.configure が利用できません'));
          return;
        }
        requestAnimationFrame(poll);
      };
      poll();
    };

    const onError = () => {
      cleanup();
      reject(new Error('MusicKit スクリプトの読み込みに失敗しました'));
    };

    const cleanup = () => {
      clearInterval(timer);
      document.removeEventListener(MUSICKIT_LOADED_EVENT, onLoaded);
      document.removeEventListener('musickiterror', onError);
    };

    document.addEventListener(MUSICKIT_LOADED_EVENT, onLoaded, { once: true });
    document.addEventListener('musickiterror', onError, { once: true });

    // イベントを取りこぼした場合の保険
    const timer = setInterval(() => {
      if (isMusicKitReady()) {
        cleanup();
        resolve();
      } else if (Date.now() - started > timeoutMs) {
        cleanup();
        reject(new Error('MusicKit の読み込みがタイムアウトしました'));
      }
    }, 200);
  });
}

/**
 * MusicKit v3 は script onload 直後では未準備。
 * musickitloaded イベントを待つ必要がある。
 */
function loadMusicKitScript(): Promise<void> {
  if (Platform.OS !== 'web' || typeof document === 'undefined') {
    return Promise.reject(
      new Error('Apple MusicKit は Web ブラウザでのみ利用できます。'),
    );
  }

  // 必ずスクリプト挿入前にパッチ
  patchProcessForMusicKit();

  if (isMusicKitReady()) {
    return Promise.resolve();
  }

  if (musicKitReadyPromise) {
    return musicKitReadyPromise;
  }

  musicKitReadyPromise = (async () => {
    try {
      // 前回失敗で壊れた script が残っている場合は外す
      if (!isMusicKitReady()) {
        document
          .querySelectorAll(`script[src="${MUSICKIT_SCRIPT_URL}"]`)
          .forEach((el) => el.remove());
        // 壊れたグローバルも捨てる
        try {
          delete window.MusicKit;
        } catch {
          // ignore
        }
      }

      patchProcessForMusicKit();

      const script = document.createElement('script');
      script.src = MUSICKIT_SCRIPT_URL;
      script.async = true;

      const loadPromise = new Promise<void>((resolve, reject) => {
        script.onload = () => resolve();
        script.onerror = () =>
          reject(new Error('MusicKit スクリプトの読み込みに失敗しました'));
      });

      document.head.appendChild(script);
      await loadPromise;
      await waitForMusicKitReady();

      if (!isMusicKitReady()) {
        throw new Error('MusicKit.configure が利用できません');
      }
    } catch (e) {
      musicKitReadyPromise = null;
      throw e;
    }
  })();

  return musicKitReadyPromise;
}

/**
 * MusicKit は configure() のときに Runtime を組み立て、その中で
 * `isNodeEnvironment = (globalThis.process !== undefined)` を **一度だけ** 確定させる。
 *
 * Expo Web は process のシムを定義しているため、これが true になり、
 * MusicKit は自分が Node 上で動いていると誤認する。その結果 setQueue() は
 *   `if (!this._isPlaybackSupported()) return void warn('Playback is not supported')`
 * で即 return し、例外もネットワークリクエストも出さないままキューが空になる（＝無音）。
 *
 * configure() の間だけ process を隠して、ブラウザとして認識させる。
 * 判定結果は Runtime に保持されるため、隠すのはこの一瞬だけでよい。
 *
 * 注: 既存の `process.versions = null` パッチ（index.ts）は、スクリプト読み込み時に
 * 評価される別の判定（process.versions.node を見る方）用なので、そちらも引き続き必要。
 */
async function withProcessHidden<T>(fn: () => Promise<T>): Promise<T> {
  const globalRef = globalThis as { process?: unknown };
  const saved = globalRef.process;
  try {
    globalRef.process = undefined;
    return await fn();
  } finally {
    globalRef.process = saved;
  }
}

async function ensureConfigured(): Promise<MusicKitInstance> {
  await loadMusicKitScript();

  const developerToken = getDeveloperToken();
  if (!developerToken) {
    throw new Error(
      'EXPO_PUBLIC_APPLE_MUSIC_DEVELOPER_TOKEN が未設定です。Apple Developer で MusicKit トークンを発行してください。',
    );
  }

  if (!window.MusicKit || typeof window.MusicKit.configure !== 'function') {
    throw new Error('MusicKit が利用できません');
  }

  if (!configuredInstance) {
    const musicKit = window.MusicKit;
    configuredInstance = await withProcessHidden(() =>
      musicKit.configure({
        developerToken,
        app: {
          name: 'IntroQ',
          build: '1.0.0',
        },
      }),
    );
  }

  return configuredInstance ?? window.MusicKit.getInstance();
}

export async function getMusicKitInstance(
  _scopes: MusicKitScope[] = ['music-library-read'],
): Promise<MusicKitInstance> {
  const instance = await ensureConfigured();

  if (!instance.isAuthorized) {
    await instance.authorize();
  }

  return instance;
}

/** MusicKit JS v3 の api.music は { data: { data: [...] } } を返すことがある */
function unwrapMusicData(response: unknown): MusicKitApiItem[] {
  if (!response || typeof response !== 'object') return [];
  const root = response as { data?: unknown };
  if (Array.isArray(root.data)) return root.data as MusicKitApiItem[];
  if (root.data && typeof root.data === 'object') {
    const nested = root.data as { data?: unknown };
    if (Array.isArray(nested.data)) return nested.data as MusicKitApiItem[];
  }
  return [];
}

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

export function useMusicKit(options?: { includeWriteScope?: boolean }) {
  const [isReady, setIsReady] = useState(false);
  const [isPrepared, setIsPrepared] = useState(false);
  const [isAuthorized, setIsAuthorized] = useState(false);
  const [library, setLibrary] = useState<MusicKitTrack[]>([]);
  const [loading, setLoading] = useState(false);
  const [preparing, setPreparing] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const isWeb = Platform.OS === 'web';

  const prepare = useCallback(async () => {
    if (!isWeb) {
      setError('この画面はWebブラウザで開いてください。');
      setPreparing(false);
      return false;
    }
    if (!getDeveloperToken()) {
      setError('接続の準備に失敗しました。しばらくしてから再度お試しください。');
      setPreparing(false);
      return false;
    }

    setPreparing(true);
    setError(null);
    try {
      await ensureConfigured();
      setIsPrepared(true);
      setIsReady(true);
      return true;
    } catch (e) {
      console.error('[MusicKit prepare failed]', e);
      setError('接続の準備に失敗しました。もう一度試すを押してください。');
      setIsPrepared(false);
      configuredInstance = null;
      musicKitReadyPromise = null;
      return false;
    } finally {
      setPreparing(false);
    }
  }, [isWeb]);

  useEffect(() => {
    void prepare();
  }, [prepare]);

  const authorize = useCallback(async () => {
    if (!isWeb) {
      setError('この画面はWebブラウザで開いてください。');
      return;
    }

    setLoading(true);
    setError(null);
    try {
      const scopes: MusicKitScope[] = options?.includeWriteScope
        ? ['music-library-read', 'music-library-write']
        : ['music-library-read'];
      const instance = await getMusicKitInstance(scopes);
      setIsAuthorized(instance.isAuthorized);
      setIsPrepared(true);
      setIsReady(true);
    } catch {
      setError('認証に失敗しました。もう一度お試しください。');
      setIsAuthorized(false);
    } finally {
      setLoading(false);
    }
  }, [isWeb, options?.includeWriteScope]);

  const fetchLibrary = useCallback(async () => {
    if (!isWeb) return;

    setLoading(true);
    setError(null);
    try {
      const instance = await getMusicKitInstance();
      const tracks = await fetchAllLibrarySongs(instance);
      setLibrary(tracks);
      setIsAuthorized(true);
      setIsPrepared(true);
      setIsReady(true);
    } catch {
      setError('ライブラリの取得に失敗しました。もう一度お試しください。');
    } finally {
      setLoading(false);
    }
  }, [isWeb]);

  const connectAndFetch = useCallback(async () => {
    if (!isWeb) return;
    setLoading(true);
    setError(null);
    try {
      const instance = await getMusicKitInstance(
        options?.includeWriteScope
          ? ['music-library-read', 'music-library-write']
          : ['music-library-read'],
      );
      setIsAuthorized(instance.isAuthorized);
      const tracks = await fetchAllLibrarySongs(instance);
      setLibrary(tracks);
      setIsPrepared(true);
      setIsReady(true);
    } catch {
      setError('接続に失敗しました。もう一度お試しください。');
      setIsAuthorized(false);
    } finally {
      setLoading(false);
    }
  }, [isWeb, options?.includeWriteScope]);

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

  return {
    isWeb,
    isReady,
    isPrepared,
    isAuthorized,
    library,
    loading,
    preparing,
    error,
    prepare,
    authorize,
    fetchLibrary,
    connectAndFetch,
    createPlaylist,
  };
}
