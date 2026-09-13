import { NativeStackScreenProps } from '@react-navigation/native-stack';
import { useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';

import { ErrorBanner } from '../components/ErrorBanner';
import { useGameNavigation } from '../hooks/useGameNavigation';
import {
  DEFAULT_INTRO_DURATION,
  INTRO_DURATIONS,
  usePreviewPlayback,
  type IntroDuration,
} from '../hooks/usePreviewPlayback';
import { useRoomRealtime } from '../hooks/useRoomRealtime';
import { describeError } from '../lib/describeError';
import { supabase } from '../lib/supabase';
import type { RootStackParamList } from '../navigation/types';
import { useRoomStore } from '../store/roomStore';

type Props = NativeStackScreenProps<RootStackParamList, 'HostQuiz'>;

/**
 * ホストの出題画面。判断 6 により、解答入力も採点も持たない。
 * イントロ 15 秒再生 → 正解表示（フル再生）→ 次の曲、の 3 操作だけ。
 * 参加者は声で答えるので、アプリ側で解答を受け取る必要がない。
 */
export function HostQuizScreen(_props: Props) {
  const roomId = useRoomStore((s) => s.roomId);
  const phase = useRoomStore((s) => s.phase);
  const playlistTracks = useRoomStore((s) => s.playlistTracks);
  const currentTrackIndex = useRoomStore((s) => s.currentTrackIndex);
  const setPhase = useRoomStore((s) => s.setPhase);

  useRoomRealtime(roomId);
  useGameNavigation();
  const { playIntro, playFull, prepare, preparing, stop } = usePreviewPlayback();

  const [busy, setBusy] = useState(false);
  const [errorText, setErrorText] = useState<string | null>(null);
  const [introDuration, setIntroDuration] =
    useState<IntroDuration>(DEFAULT_INTRO_DURATION);

  const track = playlistTracks[currentTrackIndex];
  const isLast = currentTrackIndex >= playlistTracks.length - 1;

  // 出題が切り替わったら、その曲と次の曲を先に取得・デコードしておく。
  //
  // 依存に track オブジェクトを入れてはいけない。Realtime で rooms の更新が
  // 返ってくるたびに playlist_tracks が JSON から作り直され、中身が同じでも
  // 参照が変わるため、効果が無駄に再実行される。
  const trackCatalogId = track?.catalogId;
  useEffect(() => {
    if (!trackCatalogId) return;
    const current = playlistTracks[currentTrackIndex];
    const next = playlistTracks[currentTrackIndex + 1];
    if (current) void prepare(current);
    if (next) void prepare(next);
  }, [trackCatalogId, currentTrackIndex, playlistTracks, prepare]);

  // 何度でも押せる。DB は触らない。
  // 「聞かせる」操作と「正解を出す」操作を分けたので、進行状態を動かす必要がない。
  const handlePlayIntro = async () => {
    if (!track || busy) return;
    setBusy(true);
    try {
      await playIntro(track, introDuration);
    } catch (e) {
      console.error('[handlePlayIntro] failed', e);
      setErrorText(describeError('イントロ再生', e));
    } finally {
      setBusy(false);
    }
  };

  const handleReveal = async () => {
    if (!track || !roomId || busy) return;
    setBusy(true);
    try {
      const { error } = await supabase
        .from('rooms')
        .update({ phase: 'revealed' })
        .eq('id', roomId);
      if (error) throw error;
      setPhase('revealed');

      await playFull(track);
    } catch (e) {
      console.error('[handleReveal] failed', e);
      setErrorText(describeError('正解表示', e));
    } finally {
      setBusy(false);
    }
  };

  const handleNext = async () => {
    if (!roomId || busy) return;
    setBusy(true);
    try {
      const { error } = await supabase
        .from('rooms')
        .update(
          isLast
            ? { status: 'finished' }
            : { current_track_index: currentTrackIndex + 1, phase: 'intro' },
        )
        .eq('id', roomId);
      if (error) throw error;

      // 正解表示で再生しているので、必ず止めてから次に進む
      stop();

      // 'finished' の場合の画面遷移は useGameNavigation が拾う。
      if (isLast) {
        useRoomStore.setState({ status: 'finished' });
      } else {
        useRoomStore.setState({
          currentTrackIndex: currentTrackIndex + 1,
          phase: 'intro',
        });
      }
    } catch (e) {
      console.error('[handleNext] failed', e);
      setErrorText(describeError('次の曲へ', e));
    } finally {
      setBusy(false);
    }
  };

  if (!track) {
    return (
      <View style={styles.loadingScreen}>
        <ActivityIndicator size="large" color="#007AFF" />
        <Text style={styles.loadingText}>読み込み中...</Text>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <Text style={styles.progress}>
        第 {currentTrackIndex + 1} 問 / {playlistTracks.length}
      </Text>

      <ErrorBanner message={errorText} onDismiss={() => setErrorText(null)} />

      <Text style={styles.sectionLabel}>難易度（冒頭を流す秒数）</Text>
      <View style={styles.difficultyRow}>
        {INTRO_DURATIONS.map((d) => {
          const selected = d === introDuration;
          return (
            <Pressable
              key={d}
              style={[styles.difficultyChip, selected && styles.difficultyChipOn]}
              onPress={() => setIntroDuration(d)}
            >
              <Text
                style={[
                  styles.difficultyText,
                  selected && styles.difficultyTextOn,
                ]}
              >
                {d}秒
              </Text>
            </Pressable>
          );
        })}
      </View>

      {phase === 'revealed' ? (
        <View style={styles.revealBox}>
          <Text style={styles.trackTitle}>{track.title}</Text>
          <Text style={styles.trackArtist}>{track.artist}</Text>
        </View>
      ) : (
        <View style={styles.hiddenBox}>
          <Text style={styles.hiddenText}>
            何度でも聞き直せます
          </Text>
        </View>
      )}

      {phase === 'revealed' ? (
        <Pressable
          style={[styles.primaryButton, busy && styles.disabled]}
          onPress={handleNext}
          disabled={busy}
        >
          {busy ? (
            <ActivityIndicator color="#fff" />
          ) : (
            <Text style={styles.primaryButtonText}>
              {isLast ? '結果を見る' : '⏭ 次の曲へ'}
            </Text>
          )}
        </Pressable>
      ) : (
        <>
          {/* 何度でも押せる。聞き直しは出題の一部なので制限しない */}
          <Pressable
            style={[styles.primaryButton, busy && styles.disabled]}
            onPress={handlePlayIntro}
            disabled={busy}
          >
            {busy ? (
              <ActivityIndicator color="#fff" />
            ) : (
              <Text style={styles.primaryButtonText}>
                ▶ イントロ再生（{introDuration}秒）
              </Text>
            )}
          </Pressable>

          <Pressable
            style={[styles.secondaryButton, busy && styles.disabled]}
            onPress={handleReveal}
            disabled={busy}
          >
            <Text style={styles.secondaryButtonText}>🔊 正解を見る</Text>
          </Pressable>
        </>
      )}

      <Text style={styles.hint}>
        {preparing
          ? '曲を読み込んでいます...'
          : '参加者は声で答えます。答えが出たら「正解を見る」を押してください。'}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#0f0f14',
    padding: 16,
  },
  loadingScreen: {
    flex: 1,
    backgroundColor: '#0f0f14',
    justifyContent: 'center',
    alignItems: 'center',
  },
  loadingText: {
    color: '#888',
    marginTop: 16,
  },
  progress: {
    fontSize: 20,
    fontWeight: '700',
    color: '#fff',
    marginBottom: 16,
  },
  sectionLabel: {
    color: '#888',
    fontSize: 13,
    marginBottom: 8,
  },
  difficultyRow: {
    flexDirection: 'row',
    gap: 8,
    marginBottom: 20,
  },
  difficultyChip: {
    flex: 1,
    backgroundColor: '#1c1c24',
    borderWidth: 1,
    borderColor: '#2a2a35',
    borderRadius: 8,
    paddingVertical: 10,
    alignItems: 'center',
  },
  difficultyChipOn: {
    backgroundColor: '#0a2a4d',
    borderColor: '#007AFF',
  },
  difficultyText: {
    color: '#888',
    fontSize: 13,
    fontWeight: '600',
  },
  difficultyTextOn: {
    color: '#4da3ff',
  },
  hiddenBox: {
    backgroundColor: '#1c1c24',
    borderRadius: 12,
    padding: 32,
    alignItems: 'center',
    marginBottom: 16,
  },
  hiddenText: {
    color: '#888',
    fontSize: 15,
  },
  revealBox: {
    backgroundColor: '#0a3d2a',
    borderRadius: 12,
    padding: 32,
    alignItems: 'center',
    marginBottom: 16,
  },
  trackTitle: {
    color: '#fff',
    fontSize: 24,
    fontWeight: '700',
    textAlign: 'center',
  },
  trackArtist: {
    color: '#9fd6b8',
    fontSize: 16,
    marginTop: 6,
    textAlign: 'center',
  },
  primaryButton: {
    backgroundColor: '#007AFF',
    borderRadius: 12,
    padding: 18,
    alignItems: 'center',
  },
  primaryButtonText: {
    color: '#fff',
    fontSize: 18,
    fontWeight: '600',
  },
  secondaryButton: {
    backgroundColor: '#1c1c24',
    borderWidth: 1,
    borderColor: '#2a2a35',
    borderRadius: 12,
    padding: 16,
    alignItems: 'center',
    marginTop: 10,
  },
  secondaryButtonText: {
    color: '#ccc',
    fontSize: 16,
    fontWeight: '600',
  },
  disabled: {
    opacity: 0.5,
  },
  hint: {
    color: '#555',
    fontSize: 13,
    textAlign: 'center',
    marginTop: 20,
    lineHeight: 19,
  },
});
