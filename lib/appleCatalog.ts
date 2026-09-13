import Constants from 'expo-constants';

function getDeveloperToken(): string {
  return (
    Constants.expoConfig?.extra?.appleMusicDeveloperToken ??
    process.env.EXPO_PUBLIC_APPLE_MUSIC_DEVELOPER_TOKEN ??
    ''
  ).trim();
}

export type CatalogSong = {
  id: string;
  title: string;
  artist: string;
  durationMs: number;
  previewUrl: string | null;
};

/**
 * カタログの曲情報を取得する。MusicKit を経由せず developer token だけで叩く。
 * プレビュー音源は DRM 保護されていないので、ここから先は MusicKit が要らない。
 */
export async function fetchCatalogSong(
  catalogId: string,
  storefront = 'jp',
): Promise<CatalogSong> {
  const token = getDeveloperToken();
  if (!token) throw new Error('Apple Music の developer token が未設定です');

  const res = await fetch(
    `https://api.music.apple.com/v1/catalog/${storefront}/songs/${catalogId}`,
    { headers: { Authorization: `Bearer ${token}` } },
  );

  if (!res.ok) {
    throw new Error(`カタログ取得に失敗しました (HTTP ${res.status})`);
  }

  const json = (await res.json()) as {
    data?: {
      id: string;
      attributes?: {
        name?: string;
        artistName?: string;
        durationInMillis?: number;
        previews?: { url?: string }[];
      };
    }[];
  };

  const song = json.data?.[0];
  if (!song) throw new Error('曲が見つかりませんでした');

  return {
    id: song.id,
    title: song.attributes?.name ?? '',
    artist: song.attributes?.artistName ?? '',
    durationMs: song.attributes?.durationInMillis ?? 0,
    previewUrl: song.attributes?.previews?.[0]?.url ?? null,
  };
}

type CatalogSongJson = {
  id: string;
  attributes?: {
    name?: string;
    artistName?: string;
    durationInMillis?: number;
    previews?: { url?: string }[];
  };
};

function toCatalogSong(song: CatalogSongJson): CatalogSong {
  return {
    id: song.id,
    title: song.attributes?.name ?? '',
    artist: song.attributes?.artistName ?? '',
    durationMs: song.attributes?.durationInMillis ?? 0,
    previewUrl: song.attributes?.previews?.[0]?.url ?? null,
  };
}

/**
 * チャート上位の曲をまとめて取得する。
 * 1 リクエストでプレビュー URL 付きの候補が揃うので、
 * 「いろいろな曲で試す」用途にちょうどよい。
 */
export async function fetchChartSongs(
  storefront = 'jp',
  limit = 50,
): Promise<CatalogSong[]> {
  const token = getDeveloperToken();
  if (!token) throw new Error('Apple Music の developer token が未設定です');

  const res = await fetch(
    `https://api.music.apple.com/v1/catalog/${storefront}/charts?types=songs&limit=${limit}&l=ja`,
    { headers: { Authorization: `Bearer ${token}` } },
  );
  if (!res.ok) throw new Error(`チャート取得に失敗しました (HTTP ${res.status})`);

  const json = (await res.json()) as {
    results?: { songs?: { data?: CatalogSongJson[] }[] };
  };

  const songs = json.results?.songs?.[0]?.data ?? [];
  return songs.map(toCatalogSong).filter((s) => s.previewUrl !== null);
}

/**
 * 複数の曲をまとめて取得する。カタログ API は ids で最大 300 件まで一括照会できるので、
 * 出題リスト 20 曲ぶんのプレビュー URL を 1 リクエストで揃えられる。
 */
export async function fetchCatalogSongsByIds(
  catalogIds: string[],
  storefront = 'jp',
): Promise<Map<string, CatalogSong>> {
  const result = new Map<string, CatalogSong>();
  if (catalogIds.length === 0) return result;

  const token = getDeveloperToken();
  if (!token) throw new Error('Apple Music の developer token が未設定です');

  const CHUNK = 250;
  for (let i = 0; i < catalogIds.length; i += CHUNK) {
    const ids = catalogIds.slice(i, i + CHUNK).join(',');
    const res = await fetch(
      `https://api.music.apple.com/v1/catalog/${storefront}/songs?ids=${ids}`,
      { headers: { Authorization: `Bearer ${token}` } },
    );
    if (!res.ok) {
      throw new Error(`カタログ一括取得に失敗しました (HTTP ${res.status})`);
    }
    const json = (await res.json()) as { data?: CatalogSongJson[] };
    for (const song of json.data ?? []) {
      result.set(song.id, toCatalogSong(song));
    }
  }

  return result;
}
