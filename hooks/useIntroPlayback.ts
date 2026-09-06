import { useCallback, useEffect, useRef, useState } from 'react';

import { getMusicKitInstance } from './useMusicKit';

const INTRO_MS = 15000;

export function useIntroPlayback() {
  const [playing, setPlaying] = useState(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // 世代番号。曲が変わった後に前のタイマーが止めに来る事故を防ぐ
  const generationRef = useRef(0);

  const clearTimer = useCallback(() => {
    if (timerRef.current !== null) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
  }, []);

  // 画面を離れたら必ず止める
  useEffect(() => {
    return () => {
      generationRef.current += 1;
      clearTimer();
      void getMusicKitInstance()
        .then((music) => music.pause())
        .catch(() => undefined);
    };
  }, [clearTimer]);

  /** 冒頭 15 秒だけ再生する。必ずユーザーのタップを起点に呼ぶこと */
  const playIntro = useCallback(
    async (catalogId: string) => {
      const generation = ++generationRef.current;
      clearTimer();

      const music = await getMusicKitInstance();
      await music.setQueue({ songs: [catalogId] });

      // setQueue はカタログ側で ID が解決できなくても例外を投げず、
      // キューが空のまま静かに終わることがある（Apple 側のカタログ紐付け切れ等）。
      // ここで検知して、呼び出し元が分かるエラーとして扱う。
      if (!music.queue || music.queue.items.length === 0) {
        throw new Error(
          `この曲は再生できませんでした（カタログに存在しない可能性があります: ${catalogId}）`,
        );
      }

      await music.play();
      if (generationRef.current !== generation) return; // 待っている間に曲が変わった
      setPlaying(true);

      timerRef.current = setTimeout(() => {
        if (generationRef.current !== generation) return;
        music.pause();
        setPlaying(false);
        timerRef.current = null;
      }, INTRO_MS);
    },
    [clearTimer],
  );

  /** 正解発表後、頭からフル再生する */
  const playFull = useCallback(async () => {
    generationRef.current += 1;
    clearTimer();
    const music = await getMusicKitInstance();
    await music.seekToTime(0);
    await music.play();
    setPlaying(true);
  }, [clearTimer]);

  const stop = useCallback(async () => {
    generationRef.current += 1;
    clearTimer();
    const music = await getMusicKitInstance();
    music.pause();
    setPlaying(false);
  }, [clearTimer]);

  return { playing, playIntro, playFull, stop };
}
