import { NativeStackScreenProps } from '@react-navigation/native-stack';
import { useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import * as Crypto from 'expo-crypto';

import { generateRoomCode, normalizeRoomCode } from '../lib/roomCode';
import { ensureAnonymousSession, supabase } from '../lib/supabase';
import type { RootStackParamList } from '../navigation/types';
import type { SourceMode } from '../types/database';
import { useRoomStore } from '../store/roomStore';
import { useUserStore } from '../store/userStore';

type Props = NativeStackScreenProps<RootStackParamList, 'Home'>;

function generateClientId(): string {
  return Crypto.randomUUID();
}

export function HomeScreen({ navigation }: Props) {
  const [userName, setUserName] = useState('');
  const [roomCode, setRoomCode] = useState('');
  const [loading, setLoading] = useState(false);
  const [mode, setMode] = useState<'select' | 'join'>('select');
  const [sourceMode, setSourceMode] = useState<SourceMode>('preset');

  const setSession = useUserStore((s) => s.setSession);
  const resetUser = useUserStore((s) => s.reset);
  const setRoom = useRoomStore((s) => s.setRoom);
  const resetRoom = useRoomStore((s) => s.reset);

  const validateUserName = (): boolean => {
    const trimmed = userName.trim();
    if (!trimmed) {
      Alert.alert('入力エラー', 'ニックネームを入力してください');
      return false;
    }
    return true;
  };

  const handleCreateRoom = async () => {
    if (!validateUserName()) return;

    setLoading(true);
    const hostId = generateClientId();
    const trimmedName = userName.trim();

    try {
      resetUser();
      resetRoom();

      // RLS が所有権を auth.uid() で判定するため、先にセッションを確保する（判断 9）
      const userId = await ensureAnonymousSession();

      // コードの衝突は稀だが、念のため数回だけ再試行する
      let room: {
        id: string;
        code: string | null;
        status: 'lobby' | 'playing' | 'finished';
        host_id: string;
        source_mode: SourceMode;
      } | null = null;
      let lastError: unknown = null;
      for (let attempt = 0; attempt < 3 && !room; attempt++) {
        const { data, error } = await supabase
          .from('rooms')
          .insert({
            host_id: hostId,
            code: generateRoomCode(),
            host_user_id: userId,
            source_mode: sourceMode,
          })
          .select('id, code, status, host_id, source_mode')
          .single();

        if (!error && data) {
          room = data;
          break;
        }
        lastError = error;
        if (error?.code !== '23505') break; // コード重複以外は即座に諦める
      }

      if (!room) {
        throw lastError ?? new Error('ルーム作成に失敗しました');
      }

      const { data: participant, error: participantError } = await supabase
        .from('participants')
        .insert({
          room_id: room.id,
          user_name: trimmedName,
          user_id: userId,
        })
        .select('id')
        .single();

      if (participantError || !participant) {
        throw participantError ?? new Error('参加者登録に失敗しました');
      }

      // rooms.host_id を「ホストの participants.id」に更新する。
      // これにより、参加者一覧の中からホストの行を全員が特定できる
      // （ランキングからホストを除外する・出題者名を表示する、など）。
      const { error: hostIdError } = await supabase
        .from('rooms')
        .update({ host_id: participant.id })
        .eq('id', room.id);

      if (hostIdError) throw hostIdError;

      setSession({
        userName: trimmedName,
        participantId: participant.id,
        isHost: true,
        hostClientId: hostId,
      });
      setRoom({
        roomId: room.id,
        code: room.code,
        sourceMode: room.source_mode,
        status: room.status,
        hostId: participant.id,
      });

      // プリセットならライブラリ取込は不要なので、そのままロビーへ（判断 10）
      navigation.navigate(
        room.source_mode === 'preset' ? 'HostLobby' : 'LibraryImport',
      );
    } catch (e) {
      Alert.alert(
        'エラー',
        e instanceof Error ? e.message : 'ルームを作成できませんでした',
      );
    } finally {
      setLoading(false);
    }
  };

  const handleJoinRoom = async () => {
    if (!validateUserName()) return;

    const code = normalizeRoomCode(roomCode);
    if (!code) {
      Alert.alert('入力エラー', 'ルームコードを入力してください');
      return;
    }

    setLoading(true);
    const trimmedName = userName.trim();

    try {
      resetUser();
      resetRoom();

      const userId = await ensureAnonymousSession();

      const { data: room, error: roomError } = await supabase
        .from('rooms')
        .select('id, code, status, host_id, source_mode')
        .eq('code', code)
        .single();

      if (roomError || !room) {
        Alert.alert('エラー', 'ルームが見つかりません。コードを確認してください。');
        return;
      }

      if (room.status !== 'lobby') {
        Alert.alert('エラー', 'このルームはすでにゲームが始まっています。');
        return;
      }

      const { data: participant, error: participantError } = await supabase
        .from('participants')
        .insert({
          room_id: room.id,
          user_name: trimmedName,
          user_id: userId,
        })
        .select('id')
        .single();

      if (participantError) {
        if (participantError.code === '23505') {
          Alert.alert('エラー', '同じニックネームの参加者が既にいます。');
        } else {
          throw participantError;
        }
        return;
      }

      if (!participant) {
        throw new Error('参加者登録に失敗しました');
      }

      setSession({
        userName: trimmedName,
        participantId: participant.id,
        isHost: false,
      });
      setRoom({
        roomId: room.id,
        code: room.code,
        sourceMode: room.source_mode,
        status: room.status,
        hostId: room.host_id,
      });

      navigation.navigate(
        room.source_mode === 'preset' ? 'GuestLobby' : 'LibraryImport',
      );
    } catch (e) {
      Alert.alert(
        'エラー',
        e instanceof Error ? e.message : 'ルームに参加できませんでした',
      );
    } finally {
      setLoading(false);
    }
  };

  if (mode === 'join') {
    return (
      <View style={styles.container}>
        <Text style={styles.title}>ルームに参加</Text>
        <Text style={styles.label}>ニックネーム</Text>
        <TextInput
          style={styles.input}
          value={userName}
          onChangeText={setUserName}
          placeholder="例: たろう"
          autoCapitalize="none"
        />
        <Text style={styles.label}>ルームコード</Text>
        <TextInput
          style={styles.input}
          value={roomCode}
          onChangeText={setRoomCode}
          placeholder="ホストから共有された6桁のコード"
          autoCapitalize="characters"
          maxLength={6}
        />
        {loading ? (
          <ActivityIndicator size="large" color="#007AFF" />
        ) : (
          <>
            <Pressable style={styles.primaryButton} onPress={handleJoinRoom}>
              <Text style={styles.primaryButtonText}>参加する</Text>
            </Pressable>
            <Pressable
              style={styles.secondaryButton}
              onPress={() => setMode('select')}
            >
              <Text style={styles.secondaryButtonText}>戻る</Text>
            </Pressable>
          </>
        )}
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <Text style={styles.appTitle}>IntroQ</Text>
      <Text style={styles.subtitle}>イントロクイズ</Text>

      <Text style={styles.label}>ニックネーム</Text>
      <TextInput
        style={styles.input}
        value={userName}
        onChangeText={setUserName}
        placeholder="例: たろう"
        autoCapitalize="none"
      />

      <Text style={styles.label}>出題する曲</Text>
      <View style={styles.modeRow}>
        <Pressable
          style={[styles.modeChip, sourceMode === 'preset' && styles.modeChipOn]}
          onPress={() => setSourceMode('preset')}
        >
          <Text style={[styles.modeTitle, sourceMode === 'preset' && styles.modeTitleOn]}>
            ジャンルから
          </Text>
          <Text style={styles.modeDesc}>人気曲から出題{'\n'}参加者は Apple Music 不要</Text>
        </Pressable>
        <Pressable
          style={[styles.modeChip, sourceMode === 'library' && styles.modeChipOn]}
          onPress={() => setSourceMode('library')}
        >
          <Text style={[styles.modeTitle, sourceMode === 'library' && styles.modeTitleOn]}>
            みんなの曲から
          </Text>
          <Text style={styles.modeDesc}>各自のライブラリ{'\n'}全員 Apple Music が必要</Text>
        </Pressable>
      </View>

      {loading ? (
        <ActivityIndicator size="large" color="#007AFF" />
      ) : (
        <>
          <Pressable style={styles.primaryButton} onPress={handleCreateRoom}>
            <Text style={styles.primaryButtonText}>ルームを作る</Text>
          </Pressable>
          <Pressable
            style={styles.secondaryButton}
            onPress={() => setMode('join')}
          >
            <Text style={styles.secondaryButtonText}>ルームに参加する</Text>
          </Pressable>
          <Pressable
            style={styles.devLink}
            onPress={() => navigation.navigate('PreviewLab')}
          >
            <Text style={styles.devLinkText}>開発用: プレビュー音源ラボ</Text>
          </Pressable>
        </>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    padding: 24,
    justifyContent: 'center',
    backgroundColor: '#0f0f14',
  },
  appTitle: {
    fontSize: 36,
    fontWeight: '800',
    color: '#fff',
    textAlign: 'center',
    marginBottom: 4,
  },
  subtitle: {
    fontSize: 16,
    color: '#888',
    textAlign: 'center',
    marginBottom: 40,
  },
  title: {
    fontSize: 24,
    fontWeight: '700',
    color: '#fff',
    marginBottom: 24,
  },
  label: {
    fontSize: 14,
    color: '#aaa',
    marginBottom: 8,
  },
  input: {
    backgroundColor: '#1c1c24',
    borderRadius: 12,
    padding: 14,
    fontSize: 16,
    color: '#fff',
    marginBottom: 20,
    borderWidth: 1,
    borderColor: '#2a2a35',
  },
  primaryButton: {
    backgroundColor: '#007AFF',
    borderRadius: 12,
    padding: 16,
    alignItems: 'center',
    marginBottom: 12,
  },
  primaryButtonText: {
    color: '#fff',
    fontSize: 17,
    fontWeight: '600',
  },
  secondaryButton: {
    backgroundColor: '#1c1c24',
    borderRadius: 12,
    padding: 16,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: '#2a2a35',
  },
  secondaryButtonText: {
    color: '#fff',
    fontSize: 17,
    fontWeight: '600',
  },
  modeRow: { flexDirection: 'row', gap: 10, marginBottom: 24 },
  modeChip: {
    flex: 1,
    backgroundColor: '#1c1c24',
    borderWidth: 1,
    borderColor: '#2a2a35',
    borderRadius: 12,
    padding: 14,
  },
  modeChipOn: { backgroundColor: '#0a2a4d', borderColor: '#007AFF' },
  modeTitle: { color: '#ccc', fontSize: 15, fontWeight: '700' },
  modeTitleOn: { color: '#4da3ff' },
  modeDesc: { color: '#777', fontSize: 11, marginTop: 4, lineHeight: 16 },
  devLink: {
    marginTop: 24,
    alignItems: 'center',
  },
  devLinkText: {
    color: '#555',
    fontSize: 13,
  },
});
