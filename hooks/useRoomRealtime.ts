import { useEffect } from 'react';

import { supabase } from '../lib/supabase';
import { useRoomStore, type Participant } from '../store/roomStore';
import type { Answer, PlaylistTrack, RoomStatus, TrackPhase } from '../types/database';

/**
 * ロビー／ゲーム中共通: rooms・participants・answers の変更を購読する。
 * 進行状態は rooms 行を唯一の真実にしているため、再接続のたびに
 * fetchRoom / fetchParticipants / fetchAnswers を呼び直して取りこぼしを埋める。
 */
export function useRoomRealtime(roomId: string | null) {
  const setParticipants = useRoomStore((s) => s.setParticipants);
  const upsertParticipant = useRoomStore((s) => s.upsertParticipant);
  const fetchParticipants = useRoomStore((s) => s.fetchParticipants);
  const fetchRoom = useRoomStore((s) => s.fetchRoom);
  const fetchAnswers = useRoomStore((s) => s.fetchAnswers);
  const upsertAnswer = useRoomStore((s) => s.upsertAnswer);

  useEffect(() => {
    if (!roomId) return;

    void fetchRoom();
    void fetchParticipants();
    void fetchAnswers();

    const channel = supabase
      .channel(`room:${roomId}`)
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'participants',
          filter: `room_id=eq.${roomId}`,
        },
        (payload) => {
          if (payload.eventType === 'DELETE') {
            const oldRow = payload.old as { id?: string };
            if (!oldRow.id) return;
            const current = useRoomStore.getState().participants;
            setParticipants(current.filter((p) => p.id !== oldRow.id));
            return;
          }

          const row = payload.new as Participant;
          if (row?.id) upsertParticipant(row);
        },
      )
      .on(
        'postgres_changes',
        {
          event: 'UPDATE',
          schema: 'public',
          table: 'rooms',
          filter: `id=eq.${roomId}`,
        },
        (payload) => {
          console.log('[realtime] rooms UPDATE received:', payload.new);
          const row = payload.new as {
            status?: RoomStatus;
            phase?: TrackPhase;
            host_id?: string;
            playlist_tracks?: PlaylistTrack[];
            current_track_index?: number;
          };
          useRoomStore.setState({
            status: row.status ?? useRoomStore.getState().status,
            phase: row.phase ?? useRoomStore.getState().phase,
            hostId: row.host_id ?? useRoomStore.getState().hostId,
            playlistTracks:
              (row.playlist_tracks as PlaylistTrack[] | undefined) ??
              useRoomStore.getState().playlistTracks,
            currentTrackIndex:
              row.current_track_index ??
              useRoomStore.getState().currentTrackIndex,
          });
        },
      )
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
          if (row?.id) upsertAnswer(row);
        },
      )
      .subscribe((status, err) => {
        console.log('[realtime] channel status:', status, err ?? '');
        if (status === 'SUBSCRIBED') {
          void fetchRoom();
          void fetchParticipants();
          void fetchAnswers();
        }
      });

    return () => {
      void supabase.removeChannel(channel);
    };
  }, [
    roomId,
    fetchRoom,
    fetchParticipants,
    fetchAnswers,
    setParticipants,
    upsertParticipant,
    upsertAnswer,
  ]);
}
