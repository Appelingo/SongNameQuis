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

export type Genre = {
  id: string;
  name: string;
};

/**
 * ジャンル一覧を取得する（判断 10）。
 * 「ミュージック」のような包括的なものも含めて API が返すまま提示する。
 */
export async function fetchGenres(storefront = 'jp'): Promise<Genre[]> {
  const token = getDeveloperToken();
  if (!token) throw new Error('Apple Music の developer token が未設定です');

  const res = await fetch(
    `https://api.music.apple.com/v1/catalog/${storefront}/genres?limit=30&l=ja`,
    { headers: { Authorization: `Bearer ${token}` } },
  );
  if (!res.ok) throw new Error(`ジャンル一覧の取得に失敗しました (HTTP ${res.status})`);

  const json = (await res.json()) as {
    data?: { id: string; attributes?: { name?: string } }[];
  };
  return (json.data ?? []).map((g) => ({
    id: g.id,
    name: g.attributes?.name ?? g.id,
  }));
}

/**
 * ジャンル別の人気チャートを取得する（判断 10）。
 * 実測で全ジャンル 100 曲すべてにプレビュー音源があるが、
 * 念のため無い曲は除外する（プレビューが無いと出題できないため）。
 */
export async function fetchGenreChartSongs(
  genreId: string,
  storefront = 'jp',
  limit = 100,
): Promise<CatalogSong[]> {
  const token = getDeveloperToken();
  if (!token) throw new Error('Apple Music の developer token が未設定です');

  const res = await fetch(
    `https://api.music.apple.com/v1/catalog/${storefront}/charts` +
      `?types=songs&genre=${encodeURIComponent(genreId)}&limit=${limit}&l=ja`,
    { headers: { Authorization: `Bearer ${token}` } },
  );
  if (!res.ok) throw new Error(`チャートの取得に失敗しました (HTTP ${res.status})`);

  const json = (await res.json()) as {
    results?: { songs?: { data?: CatalogSongJson[] }[] };
  };
  const songs = json.results?.songs?.[0]?.data ?? [];
  return songs.map(toCatalogSong).filter((s) => s.previewUrl !== null);
}

export type Storefront = {
  id: string;
  name: string;
};

/**
 * 主要な音楽市場。167 件すべてを並べると選びにくいので、これらを先頭に出す。
 * ここに無い国も一覧の後半から選べる。
 */
const PRIORITY_STOREFRONTS = [
  'jp', 'us', 'gb', 'kr', 'tw', 'cn', 'fr', 'de', 'it', 'es',
  'ca', 'au', 'br', 'mx', 'in', 'id', 'th', 'vn', 'ph', 'se',
];

/** ストアフロント（国・地域）一覧。主要市場を先頭、残りは名前順 */
export async function fetchStorefronts(): Promise<Storefront[]> {
  const token = getDeveloperToken();
  if (!token) throw new Error('Apple Music の developer token が未設定です');

  const res = await fetch('https://api.music.apple.com/v1/storefronts?limit=200', {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) throw new Error(`国一覧の取得に失敗しました (HTTP ${res.status})`);

  const json = (await res.json()) as {
    data?: { id: string; attributes?: { name?: string } }[];
  };
  const all = (json.data ?? []).map((s) => ({
    id: s.id,
    name: s.attributes?.name ?? s.id,
  }));

  const priority: Storefront[] = [];
  for (const id of PRIORITY_STOREFRONTS) {
    const found = all.find((s) => s.id === id);
    if (found) priority.push(found);
  }
  const rest = all
    .filter((s) => !PRIORITY_STOREFRONTS.includes(s.id))
    .sort((a, b) => a.name.localeCompare(b.name));

  return [...priority, ...rest];
}

export type Artist = {
  id: string;
  name: string;
  genres: string[];
  artworkUrl: string | null;
};

/** アーティストを名前で検索する（判断 11） */
export async function searchArtists(
  term: string,
  storefront = 'jp',
  limit = 10,
): Promise<Artist[]> {
  const token = getDeveloperToken();
  if (!token) throw new Error('Apple Music の developer token が未設定です');

  const res = await fetch(
    `https://api.music.apple.com/v1/catalog/${storefront}/search` +
      `?term=${encodeURIComponent(term)}&types=artists&limit=${limit}&l=ja`,
    { headers: { Authorization: `Bearer ${token}` } },
  );
  if (!res.ok) throw new Error(`アーティスト検索に失敗しました (HTTP ${res.status})`);

  const json = (await res.json()) as {
    results?: {
      artists?: {
        data?: {
          id: string;
          attributes?: {
            name?: string;
            genreNames?: string[];
            artwork?: { url?: string };
          };
        }[];
      };
    };
  };

  return (json.results?.artists?.data ?? []).map((a) => ({
    id: a.id,
    name: a.attributes?.name ?? '',
    genres: a.attributes?.genreNames ?? [],
    artworkUrl:
      a.attributes?.artwork?.url?.replace('{w}', '80').replace('{h}', '80') ??
      null,
  }));
}

/**
 * アーティストの人気曲を取得する（判断 11）。
 *
 * `artists/{id}/songs` は limit の上限が 20 で弾かれるため使わない。
 * `view/top-songs` なら 100 曲まで、しかも人気順で取れる。
 */
export async function fetchArtistTopSongs(
  artistId: string,
  storefront = 'jp',
  limit = 100,
): Promise<CatalogSong[]> {
  const token = getDeveloperToken();
  if (!token) throw new Error('Apple Music の developer token が未設定です');

  const res = await fetch(
    `https://api.music.apple.com/v1/catalog/${storefront}/artists/${artistId}` +
      `/view/top-songs?limit=${limit}&l=ja`,
    { headers: { Authorization: `Bearer ${token}` } },
  );
  if (!res.ok) throw new Error(`アーティストの曲の取得に失敗しました (HTTP ${res.status})`);

  // この endpoint は { next, data: [...] } と直接返る
  // （artists/{id}?views=top-songs の入れ子とは形が違う）
  const json = (await res.json()) as { data?: CatalogSongJson[] };
  return (json.data ?? []).map(toCatalogSong).filter((s) => s.previewUrl !== null);
}
