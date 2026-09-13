import { NativeStackScreenProps } from '@react-navigation/native-stack';
import { useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  FlatList,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';

import { useMusicKit } from '../hooks/useMusicKit';
import { supabase } from '../lib/supabase';
import type { RootStackParamList } from '../navigation/types';
import { useRoomStore } from '../store/roomStore';
import { useUserStore } from '../store/userStore';
import type { LibraryTrack } from '../types/database';

type Props = NativeStackScreenProps<RootStackParamList, 'LibraryImport'>;

export function LibraryImportScreen({ navigation }: Props) {
  const roomId = useRoomStore((s) => s.roomId);
  const setLibrarySubmitted = useRoomStore((s) => s.setLibrarySubmitted);
  const userName = useUserStore((s) => s.userName);
  const participantId = useUserStore((s) => s.participantId);
  const isHost = useUserStore((s) => s.isHost);

  const {
    isPrepared,
    isAuthorized,
    library,
    loading,
    preparing,
    error,
    connectAndFetch,
    prepare,
  } = useMusicKit();

  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);

  const goToLobby = () => {
    navigation.replace(isHost ? 'HostLobby' : 'GuestLobby');
  };

  const handleContinue = async () => {
    await connectAndFetch();
  };

  const handleSubmit = async () => {
    if (!participantId || !roomId) {
      Alert.alert('エラー', 'セッション情報が不足しています');
      return;
    }
    if (library.length === 0) {
      Alert.alert('エラー', 'ライブラリに曲がありません');
      return;
    }

    const tracks: LibraryTrack[] = library.map(({ title, artist, catalogId }) => ({
      title,
      artist,
      catalogId,
    }));

    setSubmitting(true);
    try {
      const { error: updateError } = await supabase
        .from('participants')
        .update({ library_tracks: tracks })
        .eq('id', participantId);

      if (updateError) throw updateError;

      setSubmitted(true);
      setLibrarySubmitted(true);
      goToLobby();
    } catch (e) {
      Alert.alert(
        'エラー',
        e instanceof Error ? e.message : '送信に失敗しました',
      );
    } finally {
      setSubmitting(false);
    }
  };

  const handleRetry = async () => {
    const ok = await prepare();
    if (ok) {
      await connectAndFetch();
    }
  };

  const handleSkip = async () => {
    if (!participantId || !roomId) {
      Alert.alert('エラー', 'セッション情報が不足しています');
      return;
    }

    setSubmitting(true);
    try {
      const { error: updateError } = await supabase
        .from('participants')
        .update({ skipped_library: true, library_tracks: [] })
        .eq('id', participantId);

      if (updateError) throw updateError;

      setLibrarySubmitted(true);
      goToLobby();
    } catch (e) {
      Alert.alert(
        'エラー',
        e instanceof Error ? e.message : '送信に失敗しました',
      );
    } finally {
      setSubmitting(false);
    }
  };

  const renderTrack = ({
    item,
    index,
  }: {
    item: LibraryTrack;
    index: number;
  }) => (
    <View style={styles.trackRow}>
      <Text style={styles.trackIndex}>{index + 1}</Text>
      <View style={styles.trackInfo}>
        <Text style={styles.trackTitle} numberOfLines={1}>
          {item.title}
        </Text>
        <Text style={styles.trackArtist} numberOfLines={1}>
          {item.artist}
        </Text>
      </View>
    </View>
  );

  // MusicKit 準備中 / 接続中はロード画面のみ
  if (preparing || loading) {
    return (
      <View style={styles.loadingScreen}>
        <ActivityIndicator size="large" color="#007AFF" />
        <Text style={styles.loadingTitle}>準備しています</Text>
        <Text style={styles.loadingSub}>そのままお待ちください</Text>
      </View>
    );
  }

  if (error && !isAuthorized) {
    return (
      <View style={styles.loadingScreen}>
        <Text style={styles.errorTitle}>うまく接続できませんでした</Text>
        <Text style={styles.loadingSub}>{error}</Text>
        <Pressable style={styles.primaryButton} onPress={handleRetry}>
          <Text style={styles.primaryButtonText}>もう一度試す</Text>
        </Pressable>
        {/* ホストは曲を再生するため Apple Music 認証が必須。スキップは出さない */}
        {!isHost && (
          <Pressable
            style={[styles.secondaryButton, submitting && styles.disabled]}
            onPress={handleSkip}
            disabled={submitting}
          >
            <Text style={styles.secondaryButtonText}>
              Apple Music に接続せずに参加
            </Text>
          </Pressable>
        )}
      </View>
    );
  }

  // 準備完了・未認証: 続ける（ユーザー操作で認証ポップアップを開ける）
  if (isPrepared && !isAuthorized) {
    return (
      <View style={styles.loadingScreen}>
        <Text style={styles.loadingTitle}>準備ができました</Text>
        <Text style={styles.loadingSub}>
          続行するとミュージックライブラリを読み込みます
        </Text>
        <Pressable style={styles.primaryButton} onPress={handleContinue}>
          <Text style={styles.primaryButtonText}>続ける</Text>
        </Pressable>
        {!isHost && (
          <Pressable
            style={[styles.secondaryButton, submitting && styles.disabled]}
            onPress={handleSkip}
            disabled={submitting}
          >
            <Text style={styles.secondaryButtonText}>
              Apple Music に接続せずに参加
            </Text>
          </Pressable>
        )}
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <Text style={styles.header}>
        {userName} さんのライブラリ
        {isHost ? '（ホスト）' : ''}
      </Text>
      <Text style={styles.roomId}>ルームID: {roomId}</Text>
      <Text style={styles.count}>{library.length} 曲を取得しました</Text>
      <FlatList
        data={library}
        keyExtractor={(item, index) => `${item.title}-${item.artist}-${index}`}
        renderItem={renderTrack}
        style={styles.list}
        contentContainerStyle={styles.listContent}
      />
      <Pressable
        style={[
          styles.primaryButton,
          (submitting || submitted) && styles.disabled,
        ]}
        onPress={handleSubmit}
        disabled={submitting || submitted}
      >
        {submitting ? (
          <ActivityIndicator color="#fff" />
        ) : (
          <Text style={styles.primaryButtonText}>
            {submitted ? '送信済み' : 'このリストを送信'}
          </Text>
        )}
      </Pressable>
      <Pressable
        style={[styles.secondaryButton, (submitting || submitted) && styles.disabled]}
        onPress={handleSkip}
        disabled={submitting || submitted}
      >
        <Text style={styles.secondaryButtonText}>曲を追加せずに参加</Text>
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
  loadingScreen: {
    flex: 1,
    backgroundColor: '#0f0f14',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 24,
  },
  loadingTitle: {
    color: '#fff',
    fontSize: 18,
    fontWeight: '600',
    marginTop: 20,
  },
  loadingSub: {
    color: '#888',
    fontSize: 14,
    marginTop: 8,
    textAlign: 'center',
    lineHeight: 20,
  },
  errorTitle: {
    color: '#fff',
    fontSize: 18,
    fontWeight: '600',
    marginBottom: 8,
    textAlign: 'center',
  },
  header: {
    fontSize: 20,
    fontWeight: '700',
    color: '#fff',
    marginBottom: 4,
  },
  roomId: {
    fontSize: 12,
    color: '#666',
    marginBottom: 16,
    fontFamily: 'monospace',
  },
  count: {
    color: '#888',
    fontSize: 14,
    marginBottom: 8,
  },
  list: {
    flex: 1,
  },
  listContent: {
    paddingBottom: 16,
  },
  trackRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: '#1c1c24',
  },
  trackIndex: {
    width: 32,
    color: '#555',
    fontSize: 13,
  },
  trackInfo: {
    flex: 1,
  },
  trackTitle: {
    color: '#fff',
    fontSize: 15,
    fontWeight: '500',
  },
  trackArtist: {
    color: '#888',
    fontSize: 13,
    marginTop: 2,
  },
  primaryButton: {
    backgroundColor: '#007AFF',
    borderRadius: 12,
    padding: 16,
    alignItems: 'center',
    marginTop: 16,
    minWidth: 200,
  },
  primaryButtonText: {
    color: '#fff',
    fontSize: 17,
    fontWeight: '600',
  },
  secondaryButton: {
    backgroundColor: '#1c1c24',
    borderRadius: 12,
    padding: 14,
    alignItems: 'center',
    marginTop: 8,
    borderWidth: 1,
    borderColor: '#2a2a35',
  },
  secondaryButtonText: {
    color: '#888',
    fontSize: 13,
    fontWeight: '600',
  },
  disabled: {
    opacity: 0.5,
  },
});
