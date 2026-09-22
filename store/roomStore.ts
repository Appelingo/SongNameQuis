import AsyncStorage from '@react-native-async-storage/async-storage';
import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';

import { supabase } from '../lib/supabase';
import type {
  LibraryTrack,
  PlaylistTrack,
  RoomStatus,
  SourceMode,
  TrackPhase,
} from '../types/database';

export type Participant = {
  id: string;
  room_id: string;
  user_name: string;
  user_id: string | null;
  library_tracks: LibraryTrack[];
  skipped_library: boolean;
  score: number;
  created_at: string;
};

type RoomState = {
  roomId: string | null;
  code: string | null;
  sourceMode: SourceMode;
  genreId: string | null;
  genreName: string | null;
  status: RoomStatus;
  phase: TrackPhase;
  hostId: string | null;
  playlistTracks: PlaylistTrack[];
  currentTrackIndex: number;
  participants: Participant[];
  librarySubmitted: boolean;
  setRoom: (payload: {
    roomId: string;
    code?: string | null;
    sourceMode?: SourceMode;
    genreId?: string | null;
    genreName?: string | null;
    status?: RoomStatus;
    phase?: TrackPhase;
    hostId?: string | null;
    playlistTracks?: PlaylistTrack[];
    currentTrackIndex?: number;
  }) => void;
  setPhase: (phase: TrackPhase) => void;
  setParticipants: (participants: Participant[]) => void;
  setLibrarySubmitted: (submitted: boolean) => void;
  upsertParticipant: (participant: Participant) => void;
  fetchParticipants: () => Promise<void>;
  fetchRoom: () => Promise<void>;
  reset: () => void;
};

const initialState = {
  roomId: null as string | null,
  code: null as string | null,
  sourceMode: 'library' as SourceMode,
  genreId: null as string | null,
  genreName: null as string | null,
  status: 'lobby' as RoomStatus,
  phase: 'intro' as TrackPhase,
  hostId: null as string | null,
  playlistTracks: [] as PlaylistTrack[],
  currentTrackIndex: 0,
  participants: [] as Participant[],
  librarySubmitted: false,
};

function hasLibrary(tracks: LibraryTrack[] | null | undefined): boolean {
  return Array.isArray(tracks) && tracks.length > 0;
}

export function mergeAndDedupeTracks(
  participants: Participant[],
): LibraryTrack[] {
  const seen = new Set<string>();
  const merged: LibraryTrack[] = [];

  for (const participant of participants) {
    for (const track of participant.library_tracks ?? []) {
      const key = `${track.title.trim().toLowerCase()}::${track.artist.trim().toLowerCase()}`;
      if (!track.title || seen.has(key)) continue;
      seen.add(key);
      merged.push({ title: track.title, artist: track.artist, catalogId: track.catalogId });
    }
  }

  return merged;
}

export function participantReady(participant: Participant): boolean {
  return hasLibrary(participant.library_tracks) || participant.skipped_library;
}

/** 出題プールに曲を提供した人だけ true */
export function participantContributed(participant: Participant): boolean {
  return hasLibrary(participant.library_tracks);
}

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
 * - catalogId を持つ曲だけを対象にする(ホスト端末で再生できない曲を弾く)
 * - 参加者ごとの採用数を均す(誰も不利にならないように)
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

export const useRoomStore = create<RoomState>()(
  persist(
    (set, get) => ({
      ...initialState,
      setRoom: ({
        roomId,
        code = null,
        sourceMode = 'library',
        genreId = null,
        genreName = null,
        status = 'lobby',
        phase = 'intro',
        hostId = null,
        playlistTracks = [],
        currentTrackIndex = 0,
      }) =>
        set({
          roomId,
          code,
          sourceMode,
          genreId,
          genreName,
          status,
          phase,
          hostId,
          playlistTracks,
          currentTrackIndex,
        }),
      setPhase: (phase) => set({ phase }),
      setParticipants: (participants) => set({ participants }),
      setLibrarySubmitted: (librarySubmitted) => set({ librarySubmitted }),
      upsertParticipant: (participant) =>
        set((state) => {
          const index = state.participants.findIndex((p) => p.id === participant.id);
          if (index === -1) {
            return { participants: [...state.participants, participant] };
          }
          const next = [...state.participants];
          next[index] = participant;
          return { participants: next };
        }),
      fetchParticipants: async () => {
        const roomId = get().roomId;
        if (!roomId) return;

        const { data, error } = await supabase
          .from('participants')
          .select('*')
          .eq('room_id', roomId)
          .order('created_at', { ascending: true });

        if (error) throw error;
        set({ participants: (data ?? []) as Participant[] });
      },
      fetchRoom: async () => {
        const roomId = get().roomId;
        if (!roomId) return;

        const { data, error } = await supabase
          .from('rooms')
          .select('*')
          .eq('id', roomId)
          .single();

        if (error) throw error;
        if (!data) return;

        set({
          code: data.code,
          sourceMode: data.source_mode,
          genreId: data.genre_id,
          genreName: data.genre_name,
          status: data.status,
          phase: data.phase,
          hostId: data.host_id,
          playlistTracks: (data.playlist_tracks ?? []) as PlaylistTrack[],
          currentTrackIndex: data.current_track_index,
        });
      },
      reset: () => set(initialState),
    }),
    {
      name: 'introq-room',
      storage: createJSONStorage(() => AsyncStorage),
      // participants / playlistTracks は復帰時に必ず再取得するので
      // 保存しない(古いデータで一瞬描画される方が害になる)
      partialize: (s) => ({ roomId: s.roomId }),
    },
  ),
);

/**
 * ジャンル別チャートから出題リストを作る（判断 10）。
 * ライブラリと違い参加者ごとの公平性を考える必要がないので、
 * シャッフルして先頭から切るだけでよい。
 */
export function buildPresetTracks(
  songs: { id: string; title: string; artist: string; previewUrl: string | null }[],
  options: { limit?: number } = {},
): PlaylistTrack[] {
  const limit = options.limit ?? QUIZ_TRACK_LIMIT;
  return shuffle(
    songs
      .filter((s) => s.previewUrl !== null && s.title)
      .map((s) => ({
        title: s.title,
        artist: s.artist,
        catalogId: s.id,
        previewUrl: s.previewUrl,
      })),
  ).slice(0, limit);
}
