import { NativeStackScreenProps } from '@react-navigation/native-stack';
import { useMemo } from 'react';
import { FlatList, Pressable, StyleSheet, Text, View } from 'react-native';

import type { RootStackParamList } from '../navigation/types';
import { useRoomStore } from '../store/roomStore';
import { useUserStore } from '../store/userStore';

type Props = NativeStackScreenProps<RootStackParamList, 'Result'>;

/**
 * 判断 6 により採点を廃止したため、ランキングではなく
 * 「今日流れた曲」の一覧を出す。「さっきの曲なんだっけ」に答えられるようにするのが目的。
 */
export function ResultScreen({ navigation }: Props) {
  const playlistTracks = useRoomStore((s) => s.playlistTracks);
  const currentTrackIndex = useRoomStore((s) => s.currentTrackIndex);
  const resetRoom = useRoomStore((s) => s.reset);
  const resetUser = useUserStore((s) => s.reset);

  // 実際に流したのは currentTrackIndex の曲まで
  const playedTracks = useMemo(
    () => playlistTracks.slice(0, currentTrackIndex + 1),
    [playlistTracks, currentTrackIndex],
  );

  const handleBackHome = () => {
    resetUser();
    resetRoom();
    navigation.reset({ index: 0, routes: [{ name: 'Home' }] });
  };

  return (
    <View style={styles.container}>
      <Text style={styles.title}>おつかれさまでした</Text>
      <Text style={styles.subtitle}>今日流れた曲（{playedTracks.length} 曲）</Text>

      <FlatList
        data={playedTracks}
        keyExtractor={(item, index) => `${item.catalogId}-${index}`}
        style={styles.list}
        renderItem={({ item, index }) => (
          <View style={styles.row}>
            <Text style={styles.index}>{index + 1}</Text>
            <View style={styles.trackInfo}>
              <Text style={styles.trackTitle} numberOfLines={2}>
                {item.title}
              </Text>
              <Text style={styles.trackArtist} numberOfLines={1}>
                {item.artist}
              </Text>
            </View>
          </View>
        )}
        ListEmptyComponent={
          <Text style={styles.empty}>流れた曲がありません</Text>
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
  subtitle: {
    color: '#888',
    fontSize: 14,
    marginBottom: 20,
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
  index: {
    width: 32,
    color: '#555',
    fontSize: 14,
    fontWeight: '700',
  },
  trackInfo: {
    flex: 1,
  },
  trackTitle: {
    color: '#fff',
    fontSize: 15,
    fontWeight: '600',
  },
  trackArtist: {
    color: '#888',
    fontSize: 13,
    marginTop: 2,
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
