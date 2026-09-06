import { NativeStackScreenProps } from '@react-navigation/native-stack';
import { useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  FlatList,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';

import { useGameNavigation } from '../hooks/useGameNavigation';
import { useMusicKit } from '../hooks/useMusicKit';
import { useRoomRealtime } from '../hooks/useRoomRealtime';
import { supabase } from '../lib/supabase';
import type { RootStackParamList } from '../navigation/types';
import {
  buildQuizTracks,
  participantContributed,
  participantReady,
  useRoomStore,
} from '../store/roomStore';
import { useUserStore } from '../store/userStore';

type Props = NativeStackScreenProps<RootStackParamList, 'HostLobby'>;

export function HostLobbyScreen(_props: Props) {
  const roomId = useRoomStore((s) => s.roomId);
  const code = useRoomStore((s) => s.code);
  const participants = useRoomStore((s) => s.participants);
  const { createPlaylist } = useMusicKit({ includeWriteScope: true });
  const userName = useUserStore((s) => s.userName);
  const [starting, setStarting] = useState(false);
  const [copied, setCopied] = useState(false);

  useRoomRealtime(roomId);
  useGameNavigation();

  const handleCopyCode = async () => {
    if (!code) return;
    try {
      await navigator.clipboard.writeText(code);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // クリップボード API が使えない環境では何もしない（コードは画面に表示済み）
    }
  };

  const readyCount = useMemo(
    () => participants.filter(participantReady).length,
    [participants],
  );
  const contributorCount = useMemo(
    () => participants.filter(participantContributed).length,
    [participants],
  );
  const allReady =
    participants.length > 0 && readyCount === participants.length;

  const handleStart = async () => {
    if (!roomId) {
      Alert.alert('エラー', 'ルーム情報が見つかりません');
      return;
    }
    if (!allReady) {
      Alert.alert(
        'まだ準備中',
        '全員のライブラリが揃うまでゲームを開始できません',
      );
      return;
    }

    setStarting(true);
    try {
      const quizTracks = buildQuizTracks(participants);
      if (quizTracks.length === 0) {
        throw new Error(
          contributorCount === 0
            ? '全員が「曲を追加せずに参加」を選んでいるため、出題できる曲がありません。誰か 1 人はライブラリを提供してください。'
            : '出題できる曲がありません。Apple Music のカタログにある曲が 1 曲も見つかりませんでした。',
        );
      }

      // プレイリスト作成は「あると嬉しい」機能。失敗してもゲームは開始する。
      try {
        await createPlaylist(`IntroQ ${userName}`, quizTracks);
      } catch (e) {
        console.warn('[playlist] 作成に失敗しましたが、ゲームは続行します', e);
      }

      const { error } = await supabase
        .from('rooms')
        .update({
          playlist_tracks: quizTracks,
          current_track_index: 0,
          phase: 'intro',
          status: 'playing',
        })
        .eq('id', roomId);

      if (error) throw error;
      // 画面遷移は useGameNavigation が status の変化を受けて行う
    } catch (e) {
      Alert.alert(
        'エラー',
        e instanceof Error ? e.message : 'ゲーム開始に失敗しました',
      );
    } finally {
      setStarting(false);
    }
  };

  return (
    <View style={styles.container}>
      <Text style={styles.title}>ホストロビー</Text>

      <Pressable style={styles.codeBox} onPress={handleCopyCode}>
        <Text style={styles.codeLabel}>ルームコード</Text>
        <Text style={styles.code}>{code ?? '----'}</Text>
        <Text style={styles.codeHint}>
          {copied ? 'コピーしました' : 'タップでコピー・このコードを参加者に共有'}
        </Text>
      </Pressable>

      <Text style={styles.section}>
        参加者 {readyCount}/{participants.length} 準備完了（うち {contributorCount} 人が曲を提供）
      </Text>

      <FlatList
        data={participants}
        keyExtractor={(item) => item.id}
        style={styles.list}
        renderItem={({ item }) => {
          const ready = participantReady(item);
          const contributed = participantContributed(item);
          return (
            <View style={styles.row}>
              <View style={styles.rowText}>
                <Text style={styles.name}>{item.user_name}</Text>
                <Text style={styles.meta}>
                  {contributed
                    ? `${item.library_tracks.length} 曲受信済み`
                    : item.skipped_library
                      ? '曲なしで参加'
                      : 'ライブラリ待ち'}
                </Text>
              </View>
              <View
                style={[styles.badge, ready ? styles.badgeReady : styles.badgeWait]}
              >
                <Text style={styles.badgeText}>{ready ? 'OK' : '…'}</Text>
              </View>
            </View>
          );
        }}
        ListEmptyComponent={
          <Text style={styles.empty}>参加者がまだいません</Text>
        }
      />

      <Pressable
        style={[styles.primaryButton, (!allReady || starting) && styles.disabled]}
        onPress={handleStart}
        disabled={!allReady || starting}
      >
        {starting ? (
          <ActivityIndicator color="#fff" />
        ) : (
          <Text style={styles.primaryButtonText}>
            プレイリスト作成＆ゲーム開始
          </Text>
        )}
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
    fontSize: 22,
    fontWeight: '700',
    color: '#fff',
    marginBottom: 4,
  },
  codeBox: {
    backgroundColor: '#1c1c24',
    borderRadius: 12,
    padding: 16,
    alignItems: 'center',
    marginBottom: 20,
    borderWidth: 1,
    borderColor: '#2a2a35',
  },
  codeLabel: {
    color: '#888',
    fontSize: 13,
  },
  code: {
    color: '#fff',
    fontSize: 36,
    fontWeight: '800',
    letterSpacing: 6,
    marginVertical: 4,
  },
  codeHint: {
    color: '#666',
    fontSize: 12,
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
    alignItems: 'center',
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: '#1c1c24',
  },
  rowText: {
    flex: 1,
  },
  name: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '600',
  },
  meta: {
    color: '#888',
    fontSize: 13,
    marginTop: 2,
  },
  badge: {
    minWidth: 40,
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 6,
    alignItems: 'center',
  },
  badgeReady: {
    backgroundColor: '#0a3d2a',
  },
  badgeWait: {
    backgroundColor: '#2a2a35',
  },
  badgeText: {
    color: '#fff',
    fontSize: 12,
    fontWeight: '700',
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
    marginTop: 12,
  },
  primaryButtonText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '600',
  },
  disabled: {
    opacity: 0.5,
  },
});
