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
  /** ユーザーのストアフロント（'jp' など）。カタログ照会の地域指定に使う */
  readonly storefrontId: string;
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
  volume: number;
  readonly currentPlaybackTime: number;
  readonly nowPlayingItem: { id: string } | null;
  readonly playbackState: number;
  readonly queue: { items: unknown[] } | null;
  addEventListener(event: string, callback: (payload: unknown) => void): void;
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
