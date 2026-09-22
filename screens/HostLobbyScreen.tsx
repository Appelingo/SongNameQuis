import { NativeStackScreenProps } from '@react-navigation/native-stack';
import { useEffect, useMemo, useState } from 'react';
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
import { getMusicKitInstance } from '../hooks/useMusicKit';
import {
  fetchCatalogSongsByIds,
  fetchGenreChartSongs,
  fetchGenres,
  type Genre,
} from '../lib/appleCatalog';
import { useRoomRealtime } from '../hooks/useRoomRealtime';
import { supabase } from '../lib/supabase';
import type { RootStackParamList } from '../navigation/types';
import {
  buildPresetTracks,
  buildQuizTracks,
  participantContributed,
  participantReady,
  useRoomStore,
} from '../store/roomStore';

type Props = NativeStackScreenProps<RootStackParamList, 'HostLobby'>;

export function HostLobbyScreen(_props: Props) {
  const roomId = useRoomStore((s) => s.roomId);
  const code = useRoomStore((s) => s.code);
  const participants = useRoomStore((s) => s.participants);
  const sourceMode = useRoomStore((s) => s.sourceMode);
  const isPreset = sourceMode === 'preset';
  const [genres, setGenres] = useState<Genre[]>([]);
  const [genreId, setGenreId] = useState<string | null>(null);
  // プリセットでもホストは Apple Music 認証が必須（判断 10 の追記）。
  // 「契約者が自分の権限で鳴らし、同席者が聴く」構図に揃えるため。
  const [musicConnected, setMusicConnected] = useState(false);
  const [connecting, setConnecting] = useState(false);
  const [starting, setStarting] = useState(false);
  const [copied, setCopied] = useState(false);

  useRoomRealtime(roomId);
  useGameNavigation();

  const handleConnectMusic = async () => {
    if (connecting) return;
    setConnecting(true);
    try {
      const music = await getMusicKitInstance();
      setMusicConnected(music.isAuthorized);
      if (!music.isAuthorized) {
        Alert.alert('接続できませんでした', 'Apple Music の認証が完了しませんでした');
      }
    } catch (e) {
      Alert.alert(
        'エラー',
        e instanceof Error ? e.message : 'Apple Music に接続できませんでした',
      );
    } finally {
      setConnecting(false);
    }
  };

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
  // プリセットでは誰もライブラリを出さないので、準備完了の判定を適用しない（判断 10）
  const allReady = isPreset
    ? participants.length > 0
    : participants.length > 0 && readyCount === participants.length;

  useEffect(() => {
    if (!isPreset || genres.length > 0) return;
    void fetchGenres()
      .then((list) => {
        setGenres(list);
        setGenreId((current) => current ?? list[0]?.id ?? null);
      })
      .catch((e) => {
        console.warn('[genres] 取得に失敗しました', e);
        Alert.alert('エラー', 'ジャンル一覧を取得できませんでした');
      });
  }, [isPreset, genres.length]);

  const handleStart = async () => {
    if (!roomId) {
      Alert.alert('エラー', 'ルーム情報が見つかりません');
      return;
    }
    if (!allReady) {
      Alert.alert(
        'まだ準備中',
        isPreset
          ? '参加者がいません'
          : '全員のライブラリが揃うまでゲームを開始できません',
      );
      return;
    }
    if (isPreset && !musicConnected) {
      Alert.alert(
        'Apple Music への接続が必要です',
        '曲を再生するホストは Apple Music に接続してください。参加者は不要です。',
      );
      return;
    }
    if (isPreset && !genreId) {
      Alert.alert('ジャンル未選択', '出題するジャンルを選んでください');
      return;
    }

    setStarting(true);
    try {
      let quizTracks;
      let genreName: string | null = null;

      if (isPreset) {
        // プリセットはチャートの時点でプレビュー URL が揃っているので、
        // ライブラリ経路のような後追いのカタログ照会は要らない。
        genreName = genres.find((g) => g.id === genreId)?.name ?? null;
        const songs = await fetchGenreChartSongs(genreId!);
        quizTracks = buildPresetTracks(songs);
        if (quizTracks.length === 0) {
          throw new Error('このジャンルから出題できる曲が見つかりませんでした');
        }
      } else {
        quizTracks = await buildFromLibraries();
      }

      const { error } = await supabase
        .from('rooms')
        .update({
          playlist_tracks: quizTracks,
          current_track_index: 0,
          phase: 'intro',
          status: 'playing',
          genre_id: isPreset ? genreId : null,
          genre_name: genreName,
        })
        .eq('id', roomId);

      if (error) throw error;

      // 出題リストを作った時点で、個人のライブラリはもう不要。
      // 音楽の趣味は個人を推測させ得る情報なので、保持し続けない。
      const { error: clearError } = await supabase.rpc('clear_room_libraries', {
        target_room: roomId,
      });
      if (clearError) {
        console.warn('[cleanup] ライブラリの削除に失敗しました', clearError);
      }
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

  /** ライブラリ経路の出題リスト生成（従来どおり） */
  const buildFromLibraries = async () => {
      const candidates = buildQuizTracks(participants);
      if (candidates.length === 0) {
        throw new Error(
          contributorCount === 0
            ? '全員が「曲を追加せずに参加」を選んでいるため、出題できる曲がありません。誰か 1 人はライブラリを提供してください。'
            : '出題できる曲がありません。Apple Music のカタログにある曲が 1 曲も見つかりませんでした。',
        );
      }

      // 出題音源はプレビュー（判断 8）。ここで URL を一括取得して出題リストに埋める。
      // 1 リクエストで 20 曲ぶん揃うので、ゲーム中はカタログ API を叩かなくて済む。
      const storefront = (await getMusicKitInstance()).storefrontId || 'jp';
      const catalog = await fetchCatalogSongsByIds(
        candidates.map((t) => t.catalogId),
        storefront,
      );
      const quizTracks = candidates
        .map((t) => ({
          ...t,
          previewUrl: catalog.get(t.catalogId)?.previewUrl ?? null,
        }))
        .filter((t) => t.previewUrl !== null);

      if (quizTracks.length === 0) {
        throw new Error(
          '出題できる曲がありません。プレビュー音源が取得できる曲が 1 曲もありませんでした。',
        );
      }
      return quizTracks;
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

      {isPreset ? (
        <>
          <Pressable
            style={[styles.connectBox, musicConnected && styles.connectBoxOn]}
            onPress={musicConnected ? undefined : handleConnectMusic}
            disabled={musicConnected || connecting}
          >
            <Text style={[styles.connectText, musicConnected && styles.connectTextOn]}>
              {connecting
                ? '接続中...'
                : musicConnected
                  ? 'Apple Music に接続済み'
                  : 'Apple Music に接続する（ホストのみ必要）'}
            </Text>
            {!musicConnected && !connecting && (
              <Text style={styles.connectHint}>
                曲を再生するホストの接続が必要です。参加者は不要です。
              </Text>
            )}
          </Pressable>

          <Text style={styles.section}>出題するジャンル</Text>
          <View style={styles.genreWrap}>
            {genres.length === 0 ? (
              <Text style={styles.genreLoading}>ジャンルを読み込み中...</Text>
            ) : (
              genres.map((g) => {
                const on = g.id === genreId;
                return (
                  <Pressable
                    key={g.id}
                    style={[styles.genreChip, on && styles.genreChipOn]}
                    onPress={() => setGenreId(g.id)}
                  >
                    <Text style={[styles.genreText, on && styles.genreTextOn]}>
                      {g.name}
                    </Text>
                  </Pressable>
                );
              })
            )}
          </View>
          <Text style={styles.section}>参加者 {participants.length} 人</Text>
        </>
      ) : (
        <Text style={styles.section}>
          参加者 {readyCount}/{participants.length} 準備完了（うち {contributorCount} 人が曲を提供）
        </Text>
      )}

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
                {!isPreset && (
                  <Text style={styles.meta}>
                    {contributed
                      ? `${item.library_tracks.length} 曲受信済み`
                      : item.skipped_library
                        ? '曲なしで参加'
                        : 'ライブラリ待ち'}
                  </Text>
                )}
              </View>
              {!isPreset && (
                <View
                  style={[styles.badge, ready ? styles.badgeReady : styles.badgeWait]}
                >
                  <Text style={styles.badgeText}>{ready ? 'OK' : '…'}</Text>
                </View>
              )}
            </View>
          );
        }}
        ListEmptyComponent={
          <Text style={styles.empty}>参加者がまだいません</Text>
        }
      />

      <Pressable
        style={[
          styles.primaryButton,
          (!allReady || starting || (isPreset && !musicConnected)) && styles.disabled,
        ]}
        onPress={handleStart}
        disabled={!allReady || starting || (isPreset && !musicConnected)}
      >
        {starting ? (
          <ActivityIndicator color="#fff" />
        ) : (
          <Text style={styles.primaryButtonText}>ゲーム開始</Text>
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
  connectBox: {
    backgroundColor: '#2a2416',
    borderWidth: 1,
    borderColor: '#5c4a2a',
    borderRadius: 12,
    padding: 14,
    marginBottom: 20,
  },
  connectBoxOn: { backgroundColor: '#0a3d2a', borderColor: '#1c6b4a' },
  connectText: { color: '#e8c87a', fontSize: 14, fontWeight: '600' },
  connectTextOn: { color: '#7fd6a8' },
  connectHint: { color: '#8a7a55', fontSize: 11, marginTop: 4, lineHeight: 16 },
  genreWrap: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
    marginBottom: 20,
  },
  genreLoading: { color: '#666', fontSize: 13 },
  genreChip: {
    backgroundColor: '#1c1c24',
    borderWidth: 1,
    borderColor: '#2a2a35',
    borderRadius: 16,
    paddingHorizontal: 12,
    paddingVertical: 7,
  },
  genreChipOn: { backgroundColor: '#0a2a4d', borderColor: '#007AFF' },
  genreText: { color: '#999', fontSize: 13, fontWeight: '600' },
  genreTextOn: { color: '#4da3ff' },
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
