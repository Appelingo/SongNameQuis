import { NativeStackScreenProps } from '@react-navigation/native-stack';
import { useMemo } from 'react';
import { FlatList, Pressable, StyleSheet, Text, View } from 'react-native';

import type { RootStackParamList } from '../navigation/types';
import { useRoomStore } from '../store/roomStore';
import { useUserStore } from '../store/userStore';

type Props = NativeStackScreenProps<RootStackParamList, 'Result'>;

type RankedParticipant = {
  id: string;
  user_name: string;
  score: number;
  rank: number;
};

function rankParticipants(
  players: { id: string; user_name: string; score: number }[],
): RankedParticipant[] {
  const sorted = [...players].sort((a, b) => b.score - a.score);
  const ranked: RankedParticipant[] = [];
  let rank = 0;
  let prevScore: number | null = null;

  sorted.forEach((p, index) => {
    if (prevScore === null || p.score !== prevScore) {
      rank = index + 1;
      prevScore = p.score;
    }
    ranked.push({ ...p, rank });
  });

  return ranked;
}

export function ResultScreen({ navigation }: Props) {
  const participants = useRoomStore((s) => s.participants);
  // rooms.host_id はホストの participants.id と同じ値になっている
  // （HomeScreen でルーム作成後に更新している）ため、誰から見ても
  // ホストの行を一意に特定できる。
  const hostId = useRoomStore((s) => s.hostId);
  const resetRoom = useRoomStore((s) => s.reset);
  const myParticipantId = useUserStore((s) => s.participantId);
  const resetUser = useUserStore((s) => s.reset);

  const ranking = useMemo(() => {
    const players = participants
      .filter((p) => p.id !== hostId)
      .map((p) => ({ id: p.id, user_name: p.user_name, score: p.score }));
    return rankParticipants(players);
  }, [participants, hostId]);

  const hostName = participants.find((p) => p.id === hostId)?.user_name ?? '';

  const handleBackHome = () => {
    resetUser();
    resetRoom();
    navigation.reset({ index: 0, routes: [{ name: 'Home' }] });
  };

  return (
    <View style={styles.container}>
      <Text style={styles.title}>結果発表</Text>
      {hostName ? <Text style={styles.hostLine}>出題者: {hostName}</Text> : null}

      <FlatList
        data={ranking}
        keyExtractor={(item) => item.id}
        style={styles.list}
        renderItem={({ item }) => {
          const isMe = item.id === myParticipantId;
          return (
            <View style={[styles.row, isMe && styles.rowMe]}>
              <Text style={styles.rank}>{item.rank}</Text>
              <Text style={[styles.name, isMe && styles.nameMe]}>
                {item.user_name}
                {isMe ? '（あなた）' : ''}
              </Text>
              <Text style={styles.score}>{item.score} 問正解</Text>
            </View>
          );
        }}
        ListEmptyComponent={
          <Text style={styles.empty}>参加者がいませんでした</Text>
        }
      />

      <Pressable style={styles.primaryButton} onPress={handleBackHome}>
        <Text style={styles.primaryButtonText}>ホームに戻る</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#0f0f14',
    padding: 16,
  },
  title: {
    fontSize: 24,
    fontWeight: '700',
    color: '#fff',
    marginBottom: 4,
  },
  hostLine: {
    color: '#666',
    fontSize: 13,
    marginBottom: 20,
  },
  list: {
    flex: 1,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 14,
    borderBottomWidth: 1,
    borderBottomColor: '#1c1c24',
  },
  rowMe: {
    backgroundColor: '#0f1a2e',
  },
  rank: {
    width: 32,
    color: '#888',
    fontSize: 18,
    fontWeight: '700',
  },
  name: {
    flex: 1,
    color: '#fff',
    fontSize: 16,
    fontWeight: '600',
  },
  nameMe: {
    color: '#4da3ff',
  },
  score: {
    color: '#888',
    fontSize: 14,
  },
  empty: {
    color: '#666',
    textAlign: 'center',
    marginTop: 40,
  },
  primaryButton: {
    backgroundColor: '#007AFF',
    borderRadius: 12,
    padding: 16,
    alignItems: 'center',
    marginTop: 16,
  },
  primaryButtonText: {
    color: '#fff',
    fontSize: 17,
    fontWeight: '600',
  },
});
