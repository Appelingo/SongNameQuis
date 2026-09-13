import { NativeStackScreenProps } from '@react-navigation/native-stack';
import { useRef, useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';

import { ErrorBanner } from '../components/ErrorBanner';
import {
  fetchCatalogSong,
  fetchChartSongs,
  type CatalogSong,
} from '../lib/appleCatalog';
import {
  fetchAndAnalyze,
  getAudioContext,
  playSegment,
  type AnalyzedAudio,
} from '../lib/audioAnalysis';
import { describeError } from '../lib/describeError';
import { INTRO_DURATIONS, type IntroDuration } from '../hooks/usePreviewPlayback';
import type { RootStackParamList } from '../navigation/types';
import { useRoomStore } from '../store/roomStore';

type Props = NativeStackScreenProps<RootStackParamList, 'PreviewLab'>;

/**
 * 【開発用】プレビュー音源でのクイズ体験を検証する画面。
 *
 * 本編ストリームは DRM 保護のため波形を解析できず、冒頭の無音を自動で飛ばせない。
 * プレビュー音源は DRM なしなので、波形から音の立ち上がりを検出して
 * そこから正確に鳴らせる。その代わり「曲の冒頭」ではなくサビ付近になる。
 *
 * どちらがゲームとして良いかを実際に聴いて判断するための画面。
 */
export function PreviewLabScreen(_props: Props) {
  const playlistTracks = useRoomStore((s) => s.playlistTracks);

  const [catalogId, setCatalogId] = useState('1648659991');
  const [duration, setDuration] = useState<IntroDuration>(2);
  const [skipSilence, setSkipSilence] = useState(true);
  const [loading, setLoading] = useState(false);
  const [errorText, setErrorText] = useState<string | null>(null);
  const [song, setSong] = useState<CatalogSong | null>(null);
  const [audio, setAudio] = useState<AnalyzedAudio | null>(null);
  const [loadedMs, setLoadedMs] = useState<number | null>(null);

  const [pool, setPool] = useState<CatalogSong[]>([]);
  const [history, setHistory] = useState<
    { title: string; artist: string; onsetSec: number; previewSec: number }[]
  >([]);

  const sourceRef = useRef<AudioBufferSourceNode | null>(null);

  const stopCurrent = () => {
    if (sourceRef.current) {
      try {
        sourceRef.current.stop();
      } catch {
        // 既に止まっている場合は何もしない
      }
      sourceRef.current = null;
    }
  };

  /** 曲を読み込んで解析し、画面に反映する */
  const loadSong = async (target: CatalogSong) => {
    stopCurrent();
    setLoading(true);
    setErrorText(null);
    setAudio(null);
    setSong(target);
    const startedAt = Date.now();

    try {
      // ユーザー操作を起点に AudioContext を起こす（自動再生ポリシー対策）
      await getAudioContext().resume();

      if (!target.previewUrl) {
        throw new Error('この曲にはプレビュー音源がありません');
      }

      const analyzed = await fetchAndAnalyze(target.previewUrl);
      setAudio(analyzed);
      setLoadedMs(Date.now() - startedAt);
      setHistory((h) =>
        [
          {
            title: target.title,
            artist: target.artist,
            onsetSec: analyzed.onsetSec,
            previewSec: analyzed.buffer.duration,
          },
          ...h,
        ].slice(0, 20),
      );
    } catch (e) {
      console.error('[PreviewLab] load failed', e);
      setErrorText(describeError('プレビュー読み込み', e));
    } finally {
      setLoading(false);
    }
  };

  const handleLoad = async () => {
    const id = catalogId.trim();
    if (!id || loading) return;
    try {
      const fetched = await fetchCatalogSong(id);
      await loadSong(fetched);
    } catch (e) {
      console.error('[PreviewLab] catalog fetch failed', e);
      setErrorText(describeError('カタログ取得', e));
    }
  };

  /** チャートからランダムに 1 曲選んで読み込む。数をこなして傾向を見るため */
  const handleRandom = async () => {
    if (loading) return;
    try {
      let candidates = pool;
      if (candidates.length === 0) {
        setLoading(true);
        candidates = await fetchChartSongs();
        setPool(candidates);
      }
      if (candidates.length === 0) {
        throw new Error('候補曲を取得できませんでした');
      }
      const picked =
        candidates[Math.floor(Math.random() * candidates.length)];
      setCatalogId(picked.id);
      await loadSong(picked);
    } catch (e) {
      console.error('[PreviewLab] random failed', e);
      setErrorText(describeError('ランダム取得', e));
      setLoading(false);
    }
  };

  const handlePlay = () => {
    if (!audio) return;
    stopCurrent();
    const offset = skipSilence ? audio.onsetSec : 0;
    sourceRef.current = playSegment(audio.buffer, offset, duration);
  };

  const handlePlayAll = () => {
    if (!audio) return;
    stopCurrent();
    sourceRef.current = playSegment(audio.buffer, 0, audio.buffer.duration);
  };

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      <Text style={styles.note}>
        開発用の検証画面です。ゲーム本体には影響しません。{'\n'}
        MusicKit を使わず、DRM なしのプレビュー音源を直接解析・再生しています。
      </Text>

      <ErrorBanner message={errorText} onDismiss={() => setErrorText(null)} />

      <Text style={styles.label}>カタログ曲 ID</Text>
      <TextInput
        style={styles.input}
        value={catalogId}
        onChangeText={setCatalogId}
        placeholder="例: 1648659991"
        placeholderTextColor="#555"
        autoCapitalize="none"
      />

      {playlistTracks.length > 0 && (
        <>
          <Text style={styles.label}>出題リストから選ぶ</Text>
          <View style={styles.chipWrap}>
            {playlistTracks.slice(0, 12).map((t, i) => (
              <Pressable
                key={`${t.catalogId}-${i}`}
                style={styles.trackChip}
                onPress={() => setCatalogId(t.catalogId)}
              >
                <Text style={styles.trackChipText} numberOfLines={1}>
                  {t.title}
                </Text>
              </Pressable>
            ))}
          </View>
        </>
      )}

      <Pressable
        style={[styles.primaryButton, loading && styles.disabled]}
        onPress={handleRandom}
        disabled={loading}
      >
        {loading ? (
          <ActivityIndicator color="#fff" />
        ) : (
          <Text style={styles.primaryButtonText}>
            🎲 チャートからランダムに1曲
            {pool.length > 0 ? `（候補 ${pool.length} 曲）` : ''}
          </Text>
        )}
      </Pressable>

      <Pressable
        style={[styles.secondaryButton, loading && styles.disabled]}
        onPress={handleLoad}
        disabled={loading}
      >
        <Text style={styles.secondaryButtonText}>
          上のIDを読み込んで解析
        </Text>
      </Pressable>

      {song && (
        <View style={styles.songBox}>
          <Text style={styles.songTitle}>{song.title}</Text>
          <Text style={styles.songArtist}>{song.artist}</Text>
          <Text style={styles.meta}>
            曲の長さ {(song.durationMs / 1000).toFixed(1)}秒
            {audio ? ` / プレビュー ${audio.buffer.duration.toFixed(1)}秒` : ''}
            {loadedMs !== null ? ` / 読み込み ${loadedMs}ms` : ''}
          </Text>
        </View>
      )}

      {audio && (
        <>
          <Text style={styles.label}>
            波形（赤線が検出した音の立ち上がり = {audio.onsetSec.toFixed(3)}秒）
          </Text>
          <View style={styles.waveform}>
            {audio.peaks.map((p, i) => {
              const posSec = (i / audio.peaks.length) * audio.buffer.duration;
              const isOnset =
                posSec >= audio.onsetSec &&
                posSec <
                  audio.onsetSec + audio.buffer.duration / audio.peaks.length;
              return (
                <View
                  key={i}
                  style={[
                    styles.waveBar,
                    { height: `${Math.max(2, p * 100)}%` },
                    isOnset && styles.waveBarOnset,
                  ]}
                />
              );
            })}
          </View>

          <Pressable
            style={styles.toggleRow}
            onPress={() => setSkipSilence((v) => !v)}
          >
            <View style={[styles.checkbox, skipSilence && styles.checkboxOn]}>
              {skipSilence && <Text style={styles.checkboxMark}>✓</Text>}
            </View>
            <Text style={styles.toggleText}>
              無音を飛ばす（{audio.onsetSec.toFixed(3)}秒から再生）
            </Text>
          </Pressable>

          <Text style={styles.label}>再生する秒数</Text>
          <View style={styles.chipRow}>
            {INTRO_DURATIONS.map((d) => {
              const on = d === duration;
              return (
                <Pressable
                  key={d}
                  style={[styles.chip, on && styles.chipOn]}
                  onPress={() => setDuration(d)}
                >
                  <Text style={[styles.chipText, on && styles.chipTextOn]}>
                    {d}秒
                  </Text>
                </Pressable>
              );
            })}
          </View>

          <Pressable style={styles.primaryButton} onPress={handlePlay}>
            <Text style={styles.primaryButtonText}>
              ▶ {duration}秒だけ再生
            </Text>
          </Pressable>

          <Pressable style={styles.secondaryButton} onPress={handlePlayAll}>
            <Text style={styles.secondaryButtonText}>プレビュー全体を再生</Text>
          </Pressable>

          <Pressable style={styles.secondaryButton} onPress={stopCurrent}>
            <Text style={styles.secondaryButtonText}>停止</Text>
          </Pressable>

          <Text style={styles.note}>
            再生は AudioBufferSourceNode.start(when, offset, duration) を使うので
            サンプル単位で正確です。本編ストリームのように再生位置を監視して
            止める必要がありません。
          </Text>
        </>
      )}

      {history.length > 0 && (
        <>
          <Text style={styles.label}>試した曲（新しい順）</Text>
          {history.map((h, i) => (
            <View key={i} style={styles.historyRow}>
              <Text style={styles.historyTitle} numberOfLines={1}>
                {h.title}
              </Text>
              <Text style={styles.historyMeta}>
                立ち上がり {h.onsetSec.toFixed(2)}秒 / 長さ{' '}
                {h.previewSec.toFixed(0)}秒
              </Text>
            </View>
          ))}
        </>
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#0f0f14' },
  content: { padding: 16, paddingBottom: 40 },
  note: {
    color: '#666',
    fontSize: 12,
    lineHeight: 18,
    marginBottom: 16,
  },
  label: { color: '#888', fontSize: 13, marginBottom: 8, marginTop: 4 },
  input: {
    backgroundColor: '#1c1c24',
    borderRadius: 10,
    padding: 12,
    fontSize: 15,
    color: '#fff',
    borderWidth: 1,
    borderColor: '#2a2a35',
    marginBottom: 16,
  },
  chipWrap: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginBottom: 16 },
  trackChip: {
    backgroundColor: '#1c1c24',
    borderWidth: 1,
    borderColor: '#2a2a35',
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 6,
    maxWidth: 160,
  },
  trackChipText: { color: '#aaa', fontSize: 12 },
  primaryButton: {
    backgroundColor: '#007AFF',
    borderRadius: 12,
    padding: 16,
    alignItems: 'center',
    marginTop: 8,
  },
  primaryButtonText: { color: '#fff', fontSize: 16, fontWeight: '600' },
  secondaryButton: {
    backgroundColor: '#1c1c24',
    borderWidth: 1,
    borderColor: '#2a2a35',
    borderRadius: 12,
    padding: 14,
    alignItems: 'center',
    marginTop: 8,
  },
  secondaryButtonText: { color: '#ccc', fontSize: 14, fontWeight: '600' },
  disabled: { opacity: 0.5 },
  songBox: {
    backgroundColor: '#1c1c24',
    borderRadius: 12,
    padding: 14,
    marginTop: 16,
  },
  songTitle: { color: '#fff', fontSize: 17, fontWeight: '700' },
  songArtist: { color: '#888', fontSize: 14, marginTop: 2 },
  meta: { color: '#666', fontSize: 12, marginTop: 8 },
  waveform: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    height: 100,
    backgroundColor: '#14141b',
    borderRadius: 8,
    paddingHorizontal: 4,
    paddingVertical: 6,
    gap: 1,
    marginBottom: 16,
  },
  waveBar: { flex: 1, backgroundColor: '#3a7fd5', borderRadius: 1 },
  waveBarOnset: { backgroundColor: '#ff5c5c' },
  toggleRow: { flexDirection: 'row', alignItems: 'center', marginBottom: 16 },
  checkbox: {
    width: 22,
    height: 22,
    borderRadius: 5,
    borderWidth: 1,
    borderColor: '#2a2a35',
    backgroundColor: '#1c1c24',
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 10,
  },
  checkboxOn: { backgroundColor: '#007AFF', borderColor: '#007AFF' },
  checkboxMark: { color: '#fff', fontSize: 14, fontWeight: '700' },
  toggleText: { color: '#ccc', fontSize: 14 },
  chipRow: { flexDirection: 'row', gap: 8, marginBottom: 8 },
  chip: {
    flex: 1,
    backgroundColor: '#1c1c24',
    borderWidth: 1,
    borderColor: '#2a2a35',
    borderRadius: 8,
    paddingVertical: 10,
    alignItems: 'center',
  },
  chipOn: { backgroundColor: '#0a2a4d', borderColor: '#007AFF' },
  chipText: { color: '#888', fontSize: 13, fontWeight: '600' },
  chipTextOn: { color: '#4da3ff' },
  historyRow: {
    paddingVertical: 8,
    borderBottomWidth: 1,
    borderBottomColor: '#1c1c24',
  },
  historyTitle: { color: '#ccc', fontSize: 13 },
  historyMeta: { color: '#666', fontSize: 11, marginTop: 2 },
});
