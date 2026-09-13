import { useCallback, useEffect, useRef, useState } from 'react';

import { fetchCatalogSong } from '../lib/appleCatalog';
import {
  fetchAndAnalyze,
  getAudioContext,
  playSegment,
  type AnalyzedAudio,
} from '../lib/audioAnalysis';
import type { PlaylistTrack } from '../types/database';

/** 難易度（何秒流すか）。小さいほど難しい */
export const INTRO_DURATIONS = [0.1, 1, 2, 5, 10] as const;
export type IntroDuration = (typeof INTRO_DURATIONS)[number];
export const DEFAULT_INTRO_DURATION: IntroDuration = 2;

/**
 * 解析済み音源のキャッシュ。画面の再マウントで消えないようフックの外に置く。
 * 1 曲あたり 30 秒ぶんの PCM なので、出題 20 曲でも許容範囲。
 */
const cache = new Map<string, AnalyzedAudio>();

/**
 * プレビュー音源でクイズを鳴らすためのフック（判断 8）。
 *
 * 本編ストリームと違い DRM が無いので Web Audio に載せられる。その結果、
 * - どのブラウザでも鳴る（Safari 必須の制約が無い）
 * - start(when, offset, duration) でサンプル単位に正確な長さで鳴らせる
 * - 波形から音の立ち上がりを検出して、冒頭の無音を飛ばせる
 */
export function usePreviewPlayback() {
  const [playing, setPlaying] = useState(false);
  const [preparing, setPreparing] = useState(false);
  const sourceRef = useRef<AudioBufferSourceNode | null>(null);

  const stop = useCallback(() => {
    if (sourceRef.current) {
      try {
        sourceRef.current.stop();
      } catch {
        // 既に停止済みなら何もしない
      }
      sourceRef.current = null;
    }
    setPlaying(false);
  }, []);

  // 画面を離れたら必ず止める
  useEffect(() => stop, [stop]);

  /**
   * プレビュー URL を解決する。
   *
   * 通常は出題リスト作成時に埋まっているが、判断 8 より前に作られたルームには
   * 入っていない。その場合は catalogId から取り直す（1 曲ぶんの追加リクエストで済む）。
   */
  const resolvePreviewUrl = useCallback(
    async (track: PlaylistTrack): Promise<string> => {
      if (track.previewUrl) return track.previewUrl;

      const song = await fetchCatalogSong(track.catalogId);
      if (!song.previewUrl) {
        throw new Error(
          `この曲にはプレビュー音源がありません（${track.title}）。次の曲に進んでください。`,
        );
      }
      return song.previewUrl;
    },
    [],
  );

  const loadInto = useCallback(
    async (track: PlaylistTrack): Promise<AnalyzedAudio> => {
      const url = await resolvePreviewUrl(track);
      const analyzed = await fetchAndAnalyze(url);
      cache.set(track.catalogId, analyzed);
      return analyzed;
    },
    [resolvePreviewUrl],
  );

  /** 音源を取得・デコード・解析してキャッシュする */
  const prepare = useCallback(
    async (track: PlaylistTrack) => {
      if (cache.has(track.catalogId)) return;

      setPreparing(true);
      try {
        await loadInto(track);
      } catch (e) {
        // 先読みの失敗は致命的ではない。実際に押されたときに取り直す
        console.warn('[preview] prepare failed', e);
      } finally {
        setPreparing(false);
      }
    },
    [loadInto],
  );

  const load = useCallback(
    async (track: PlaylistTrack): Promise<AnalyzedAudio> => {
      const cached = cache.get(track.catalogId);
      if (cached) return cached;
      return loadInto(track);
    },
    [loadInto],
  );

  /** 冒頭（無音を除いた立ち上がり）から指定秒数だけ鳴らす */
  const playIntro = useCallback(
    async (track: PlaylistTrack, durationSec: number) => {
      stop();
      // ユーザー操作を起点に AudioContext を起こす（自動再生ポリシー対策）
      await getAudioContext().resume();
      const audio = await load(track);
      sourceRef.current = playSegment(audio.buffer, audio.onsetSec, durationSec);
      setPlaying(true);
    },
    [load, stop],
  );

  /** 正解表示後、プレビュー全体を流す */
  const playFull = useCallback(
    async (track: PlaylistTrack) => {
      stop();
      await getAudioContext().resume();
      const audio = await load(track);
      sourceRef.current = playSegment(
        audio.buffer,
        audio.onsetSec,
        audio.buffer.duration - audio.onsetSec,
      );
      setPlaying(true);
    },
    [load, stop],
  );

  return { playing, preparing, prepare, playIntro, playFull, stop };
}
