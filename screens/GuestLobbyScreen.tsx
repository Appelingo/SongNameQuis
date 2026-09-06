import { NativeStackScreenProps } from '@react-navigation/native-stack';
import { FlatList, StyleSheet, Text, View } from 'react-native';

import { useGameNavigation } from '../hooks/useGameNavigation';
import { useRoomRealtime } from '../hooks/useRoomRealtime';
import type { RootStackParamList } from '../navigation/types';
import { participantReady, useRoomStore } from '../store/roomStore';

type Props = NativeStackScreenProps<RootStackParamList, 'GuestLobby'>;

export function GuestLobbyScreen(_props: Props) {
  const roomId = useRoomStore((s) => s.roomId);
  const status = useRoomStore((s) => s.status);
  const participants = useRoomStore((s) => s.participants);

  useRoomRealtime(roomId);
  useGameNavigation();

  const waiting = status === 'lobby';

  return (
    <View style={styles.container}>
      <Text style={styles.title}>{waiting ? '待機中' : 'ゲーム開始'}</Text>
      <Text style={styles.subtitle}>
        {waiting
          ? 'ホストがゲームを準備中...'
          : 'まもなくクイズが始まります...'}
      </Text>
      <Text style={styles.roomId}>ルームID: {roomId}</Text>

      <Text style={styles.section}>参加者一覧</Text>
      <FlatList
        data={participants}
        keyExtractor={(item) => item.id}
        renderItem={({ item }) => {
          const ready = participantReady(item);
          return (
            <View style={styles.row}>
              <Text style={styles.name}>{item.user_name}</Text>
              <Text style={[styles.status, ready ? styles.ready : styles.wait]}>
                {ready ? '準備完了' : 'ライブラリ待ち'}
              </Text>
            </View>
          );
        }}
        ListEmptyComponent={
          <Text style={styles.empty}>参加者を読み込み中...</Text>
        }
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
  title: {
    fontSize: 22,
    fontWeight: '700',
    color: '#fff',
    marginBottom: 4,
  },
  subtitle: {
    color: '#aaa',
    fontSize: 15,
    marginBottom: 8,
  },
  roomId: {
    color: '#666',
    fontFamily: 'monospace',
    fontSize: 12,
    marginBottom: 20,
  },
  section: {
    color: '#888',
    fontSize: 14,
    marginBottom: 8,
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
    fontSize: 16,
    fontWeight: '600',
  },
  status: {
    fontSize: 13,
  },
  ready: {
    color: '#34c759',
  },
  wait: {
    color: '#888',
  },
  empty: {
    color: '#666',
    textAlign: 'center',
    marginTop: 40,
  },
});
