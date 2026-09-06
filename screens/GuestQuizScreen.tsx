import { NativeStackScreenProps } from '@react-navigation/native-stack';
import { useEffect, useMemo, useState } from 'react';
import {
  Alert,
  FlatList,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';

import { useGameNavigation } from '../hooks/useGameNavigation';
import { useRoomRealtime } from '../hooks/useRoomRealtime';
import { supabase } from '../lib/supabase';
import type { RootStackParamList } from '../navigation/types';
import { answersForTrack, useRoomStore } from '../store/roomStore';
import { useUserStore } from '../store/userStore';

type Props = NativeStackScreenProps<RootStackParamList, 'GuestQuiz'>;

export function GuestQuizScreen(_props: Props) {
  const roomId = useRoomStore((s) => s.roomId);
  const phase = useRoomStore((s) => s.phase);
  const playlistTracks = useRoomStore((s) => s.playlistTracks);
  const currentTrackIndex = useRoomStore((s) => s.currentTrackIndex);
  const participants = useRoomStore((s) => s.participants);
  const answers = useRoomStore((s) => s.answers);
  const submittedTrackIndex = useRoomStore((s) => s.submittedTrackIndex);
  const setSubmittedTrackIndex = useRoomStore((s) => s.setSubmittedTrackIndex);

  const participantId = useUserStore((s) => s.participantId);

  useRoomRealtime(roomId);
  useGameNavigation();

  const [answerText, setAnswerText] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const track = playlistTracks[currentTrackIndex];
  const hasSubmitted = submittedTrackIndex === currentTrackIndex;

  const currentAnswers = useMemo(
    () => answersForTrack(answers, currentTrackIndex),
    [answers, currentTrackIndex],
  );

  const me = useMemo(
    () => participants.find((p) => p.id === participantId),
    [participants, participantId],
  );

  const myAnswer = useMemo(
    () => currentAnswers.find((a) => a.participant_id === participantId),
    [currentAnswers, participantId],
  );

  // 曲が変わったら入力をリセット
  useEffect(() => {
    setAnswerText('');
  }, [currentTrackIndex]);

  const handleSubmit = async () => {
    const text = answerText.trim();
    if (!text || !roomId || !participantId || submitting) return;

    setSubmitting(true);
    try {
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
    } finally {
      setSubmitting(false);
    }
  };

  if (!track) {
    return (
      <View style={styles.loadingScreen}>
        <Text style={styles.loadingText}>読み込み中...</Text>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <Text style={styles.progress}>
          第 {currentTrackIndex + 1} 問 / {playlistTracks.length}
        </Text>
        <Text style={styles.score}>スコア: {me?.score ?? 0}</Text>
      </View>

      {phase === 'intro' && (
        <View style={styles.hiddenBox}>
          <Text style={styles.hiddenText}>ホストが再生を準備しています...</Text>
        </View>
      )}

      {phase === 'answering' && (
        <View style={styles.answerBox}>
          {hasSubmitted || myAnswer ? (
            <Text style={styles.submittedText}>
              解答を送信しました:「{myAnswer?.answer_text ?? answerText}」
            </Text>
          ) : (
            <>
              <TextInput
                style={styles.input}
                value={answerText}
                onChangeText={setAnswerText}
                placeholder="曲名を入力"
                placeholderTextColor="#666"
                autoCapitalize="none"
                editable={!submitting}
                onSubmitEditing={handleSubmit}
              />
              <Pressable
                style={[
                  styles.primaryButton,
                  (!answerText.trim() || submitting) && styles.disabled,
                ]}
                onPress={handleSubmit}
                disabled={!answerText.trim() || submitting}
              >
                <Text style={styles.primaryButtonText}>解答する</Text>
              </Pressable>
            </>
          )}
        </View>
      )}

      {phase === 'revealed' && (
        <>
          <View style={styles.revealBox}>
            <Text style={styles.trackTitle}>{track.title}</Text>
            <Text style={styles.trackArtist}>{track.artist}</Text>
          </View>

          <Text style={styles.section}>みんなの解答</Text>
          <FlatList
            data={currentAnswers}
            keyExtractor={(item) => item.id}
            style={styles.list}
            renderItem={({ item }) => {
              const owner = participants.find((p) => p.id === item.participant_id);
              return (
                <View style={styles.row}>
                  <Text style={styles.name}>{owner?.user_name ?? '???'}</Text>
                  <View style={styles.answerRow}>
                    <Text style={styles.answerText} numberOfLines={1}>
                      {item.answer_text}
                    </Text>
                    <View
                      style={[
                        styles.badge,
                        item.is_correct ? styles.badgeCorrect : styles.badgeWrong,
                      ]}
                    >
                      <Text style={styles.badgeText}>
                        {item.is_correct ? '○' : '✕'}
                      </Text>
                    </View>
                  </View>
                </View>
              );
            }}
            ListEmptyComponent={
              <Text style={styles.empty}>解答した人がいませんでした</Text>
            }
          />
        </>
      )}
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
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 16,
  },
  progress: {
    fontSize: 20,
    fontWeight: '700',
    color: '#fff',
  },
  score: {
    fontSize: 15,
    color: '#007AFF',
    fontWeight: '600',
  },
  hiddenBox: {
    backgroundColor: '#1c1c24',
    borderRadius: 12,
    padding: 32,
    alignItems: 'center',
  },
  hiddenText: {
    color: '#888',
    fontSize: 15,
  },
  answerBox: {
    gap: 12,
  },
  input: {
    backgroundColor: '#1c1c24',
    borderRadius: 12,
    padding: 14,
    fontSize: 16,
    color: '#fff',
    borderWidth: 1,
    borderColor: '#2a2a35',
  },
  submittedText: {
    color: '#34c759',
    fontSize: 15,
    textAlign: 'center',
    padding: 24,
  },
  primaryButton: {
    backgroundColor: '#007AFF',
    borderRadius: 12,
    padding: 16,
    alignItems: 'center',
  },
  primaryButtonText: {
    color: '#fff',
    fontSize: 17,
    fontWeight: '600',
  },
  disabled: {
    opacity: 0.5,
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
  answerRow: {
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
