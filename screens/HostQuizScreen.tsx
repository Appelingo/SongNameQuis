import { NativeStackScreenProps } from '@react-navigation/native-stack';
import { useMemo, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';

import { ErrorBanner } from '../components/ErrorBanner';
import { useGameNavigation } from '../hooks/useGameNavigation';
import { useIntroPlayback } from '../hooks/useIntroPlayback';
import { useRoomRealtime } from '../hooks/useRoomRealtime';
import { judgeAnswer } from '../lib/answerMatch';
import { describeError } from '../lib/describeError';
import { supabase } from '../lib/supabase';
import type { RootStackParamList } from '../navigation/types';
import { answersForTrack, useRoomStore, type Participant } from '../store/roomStore';
import { useUserStore } from '../store/userStore';
import type { Answer } from '../types/database';

type Props = NativeStackScreenProps<RootStackParamList, 'HostQuiz'>;

export function HostQuizScreen(_props: Props) {
  const roomId = useRoomStore((s) => s.roomId);
  const phase = useRoomStore((s) => s.phase);
  const playlistTracks = useRoomStore((s) => s.playlistTracks);
  const currentTrackIndex = useRoomStore((s) => s.currentTrackIndex);
  const participants = useRoomStore((s) => s.participants);
  const answers = useRoomStore((s) => s.answers);
  const myParticipantId = useUserStore((s) => s.participantId);
  const setPhase = useRoomStore((s) => s.setPhase);

  useRoomRealtime(roomId);
  useGameNavigation();
  const { playIntro, playFull } = useIntroPlayback();

  const [busy, setBusy] = useState(false);
  const [errorText, setErrorText] = useState<string | null>(null);

  const track = playlistTracks[currentTrackIndex];
  const isLast = currentTrackIndex >= playlistTracks.length - 1;

  // ホストは出題役でありスコア対象外
  const players = useMemo(
    () => participants.filter((p) => p.id !== myParticipantId),
    [participants, myParticipantId],
  );

  const currentAnswers = useMemo(
    () => answersForTrack(answers, currentTrackIndex),
    [answers, currentTrackIndex],
  );

  const answersByParticipant = useMemo(() => {
    const map = new Map<string, Answer>();
    for (const a of currentAnswers) map.set(a.participant_id, a);
    return map;
  }, [currentAnswers]);

  const handlePlayIntro = async () => {
    if (!track || !roomId || busy) return;
    setBusy(true);
    try {
      await playIntro(track.catalogId);
      const { error } = await supabase
        .from('rooms')
        .update({ phase: 'answering' })
        .eq('id', roomId);
      if (error) throw error;
      // 書き込みは成功しているので、Realtime の往復を待たずに自分の画面を進める。
      // Realtime が届けばそれが上書きするだけで、矛盾しない。
      setPhase('answering');
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
      const results = await Promise.all(
        currentAnswers.map((a) =>
          supabase
            .from('answers')
            .update({ is_correct: judgeAnswer(a.answer_text, track) })
            .eq('id', a.id),
        ),
      );
      const answerError = results.find((r) => r.error)?.error;
      if (answerError) throw answerError;

      const { error } = await supabase
        .from('rooms')
        .update({ phase: 'revealed' })
        .eq('id', roomId);
      if (error) throw error;
      setPhase('revealed');

      await playFull();
    } catch (e) {
      console.error('[handleReveal] failed', e);
      setErrorText(describeError('正解発表', e));
    } finally {
      setBusy(false);
    }
  };

  const handleToggleCorrect = async (answer: Answer) => {
    if (busy) return;
    const { error } = await supabase
      .from('answers')
      .update({ is_correct: !answer.is_correct })
      .eq('id', answer.id);
    if (error) {
      console.error('[handleToggleCorrect] failed', error);
      setErrorText(describeError('正誤の変更', error));
    }
  };

  const handleNext = async () => {
    if (!roomId || busy) return;
    setBusy(true);
    try {
      const correctIds = currentAnswers
        .filter((a) => a.is_correct)
        .map((a) => a.participant_id);

      await Promise.all(
        correctIds.map((id) => {
          const p = participants.find((x) => x.id === id);
          if (!p) return Promise.resolve();
          return supabase.from('participants').update({ score: p.score + 1 }).eq('id', id);
        }),
      );

      const { error } = await supabase
        .from('rooms')
        .update(
          isLast
            ? { status: 'finished' }
            : { current_track_index: currentTrackIndex + 1, phase: 'intro' },
        )
        .eq('id', roomId);

      if (error) throw error;

      // 同上。status を進めた場合の画面遷移は useGameNavigation が拾う。
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

  const answeredCount = currentAnswers.length;

  return (
    <View style={styles.container}>
      <Text style={styles.progress}>
        第 {currentTrackIndex + 1} 問 / {playlistTracks.length}
      </Text>
      <Text style={styles.hostNote}>あなたは出題役です（スコア対象外）</Text>

      <ErrorBanner message={errorText} onDismiss={() => setErrorText(null)} />

      {phase === 'revealed' ? (
        <View style={styles.revealBox}>
          <Text style={styles.trackTitle}>{track.title}</Text>
          <Text style={styles.trackArtist}>{track.artist}</Text>
        </View>
      ) : (
        <View style={styles.hiddenBox}>
          <Text style={styles.hiddenText}>
            {phase === 'intro' ? '準備完了' : `${answeredCount} 人が解答済み`}
          </Text>
        </View>
      )}

      {phase === 'intro' && (
        <Pressable
          style={[styles.primaryButton, busy && styles.disabled]}
          onPress={handlePlayIntro}
          disabled={busy}
        >
          {busy ? (
            <ActivityIndicator color="#fff" />
          ) : (
            <Text style={styles.primaryButtonText}>▶ イントロ再生（15秒）</Text>
          )}
        </Pressable>
      )}

      {phase === 'answering' && (
        <Pressable
          style={[styles.primaryButton, busy && styles.disabled]}
          onPress={handleReveal}
          disabled={busy}
        >
          {busy ? (
            <ActivityIndicator color="#fff" />
          ) : (
            <Text style={styles.primaryButtonText}>🔊 正解発表</Text>
          )}
        </Pressable>
      )}

      {phase === 'revealed' && (
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
      )}

      <Text style={styles.section}>解答状況</Text>
      <FlatList
        data={players}
        keyExtractor={(item) => item.id}
        style={styles.list}
        renderItem={({ item }: { item: Participant }) => {
          const answer = answersByParticipant.get(item.id);
          const revealed = phase === 'revealed';

          return (
            <View style={styles.row}>
              <Text style={styles.name}>{item.user_name}</Text>
              {revealed ? (
                <Pressable
                  style={styles.answerTap}
                  onPress={() => answer && handleToggleCorrect(answer)}
                  disabled={!answer}
                >
                  <Text style={styles.answerText} numberOfLines={1}>
                    {answer ? answer.answer_text : '未解答'}
                  </Text>
                  {answer && (
                    <View
                      style={[
                        styles.badge,
                        answer.is_correct ? styles.badgeCorrect : styles.badgeWrong,
                      ]}
                    >
                      <Text style={styles.badgeText}>
                        {answer.is_correct ? '○' : '✕'}
                      </Text>
                    </View>
                  )}
                </Pressable>
              ) : (
                <Text style={answer ? styles.statusDone : styles.statusWait}>
                  {answer ? '● 解答済み' : '○ 未解答'}
                </Text>
              )}
            </View>
          );
        }}
        ListEmptyComponent={<Text style={styles.empty}>参加者がいません</Text>}
      />
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
    marginBottom: 4,
  },
  hostNote: {
    color: '#666',
    fontSize: 12,
    marginBottom: 16,
  },
  hiddenBox: {
    backgroundColor: '#1c1c24',
    borderRadius: 12,
    padding: 24,
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
    padding: 24,
    alignItems: 'center',
    marginBottom: 16,
  },
  trackTitle: {
    color: '#fff',
    fontSize: 22,
    fontWeight: '700',
  },
  trackArtist: {
    color: '#9fd6b8',
    fontSize: 15,
    marginTop: 4,
  },
  primaryButton: {
    backgroundColor: '#007AFF',
    borderRadius: 12,
    padding: 16,
    alignItems: 'center',
    marginBottom: 16,
  },
  primaryButtonText: {
    color: '#fff',
    fontSize: 17,
    fontWeight: '600',
  },
  disabled: {
    opacity: 0.5,
  },
  section: {
    color: '#888',
    fontSize: 14,
    marginBottom: 8,
  },
  list: {
    flex: 1,
  },
  row: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: '#1c1c24',
  },
  name: {
    color: '#fff',
    fontSize: 15,
    fontWeight: '600',
    width: 90,
  },
  statusDone: {
    color: '#34c759',
    fontSize: 13,
  },
  statusWait: {
    color: '#666',
    fontSize: 13,
  },
  answerTap: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'flex-end',
    gap: 8,
  },
  answerText: {
    color: '#ccc',
    fontSize: 14,
    flexShrink: 1,
  },
  badge: {
    minWidth: 28,
    borderRadius: 6,
    paddingHorizontal: 8,
    paddingVertical: 4,
    alignItems: 'center',
  },
  badgeCorrect: {
    backgroundColor: '#0a3d2a',
  },
  badgeWrong: {
    backgroundColor: '#4a1616',
  },
  badgeText: {
    color: '#fff',
    fontSize: 13,
    fontWeight: '700',
  },
  empty: {
    color: '#666',
    textAlign: 'center',
    marginTop: 40,
  },
});
