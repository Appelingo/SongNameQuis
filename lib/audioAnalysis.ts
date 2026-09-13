/**
 * プレビュー音源（DRM なしの AAC）を解析するための道具。
 *
 * 本編ストリームは DRM 保護されており Web Audio に接続できないため、
 * 波形を扱えるのはこのプレビュー音源だけ。
 */

let audioContext: AudioContext | null = null;

export function getAudioContext(): AudioContext {
  if (!audioContext) {
    const Ctor =
      window.AudioContext ??
      (window as unknown as { webkitAudioContext?: typeof AudioContext })
        .webkitAudioContext;
    if (!Ctor) throw new Error('この環境では Web Audio が使えません');
    audioContext = new Ctor();
  }
  return audioContext;
}

export type AnalyzedAudio = {
  buffer: AudioBuffer;
  /** 表示用に間引いた振幅（0〜1） */
  peaks: number[];
  /** 音が鳴り始める位置（秒） */
  onsetSec: number;
  /** 全体のピーク振幅 */
  maxAmplitude: number;
};

/** 解析の窓幅。5ms 刻みで見れば 0.1 秒の判断には十分細かい */
const WINDOW_SEC = 0.005;
/** 立ち上がりを削らないよう、検出位置から少し手前に戻す */
const PRE_ROLL_SEC = 0.02;
/** 表示用の棒の本数 */
const PEAK_BUCKETS = 120;

export async function fetchAndAnalyze(url: string): Promise<AnalyzedAudio> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`プレビュー取得に失敗しました (HTTP ${res.status})`);
  const arrayBuffer = await res.arrayBuffer();

  const ctx = getAudioContext();
  const buffer = await ctx.decodeAudioData(arrayBuffer);

  // モノラル化して扱う（左右どちらかだけ鳴っている曲を取りこぼさないため最大値を取る）
  const channels: Float32Array[] = [];
  for (let c = 0; c < buffer.numberOfChannels; c++) {
    channels.push(buffer.getChannelData(c));
  }
  const length = buffer.length;
  const sampleRate = buffer.sampleRate;

  const amplitudeAt = (i: number): number => {
    let v = 0;
    for (const ch of channels) {
      const a = Math.abs(ch[i]);
      if (a > v) v = a;
    }
    return v;
  };

  // 全体のピーク
  let maxAmplitude = 0;
  for (let i = 0; i < length; i++) {
    const a = amplitudeAt(i);
    if (a > maxAmplitude) maxAmplitude = a;
  }

  // 無音判定のしきい値。曲全体の音量に対する相対値と、絶対値の大きい方を使う。
  // 相対値だけだと元から静かな曲で誤検出し、絶対値だけだとノイズ混じりの曲で早く反応する。
  const threshold = Math.max(0.004, maxAmplitude * 0.02);

  const windowSamples = Math.max(1, Math.floor(WINDOW_SEC * sampleRate));
  let onsetSec = 0;
  for (let start = 0; start < length; start += windowSamples) {
    const end = Math.min(start + windowSamples, length);
    let windowPeak = 0;
    for (let i = start; i < end; i++) {
      const a = amplitudeAt(i);
      if (a > windowPeak) windowPeak = a;
    }
    if (windowPeak >= threshold) {
      onsetSec = Math.max(0, start / sampleRate - PRE_ROLL_SEC);
      break;
    }
  }

  // 表示用に間引く
  const peaks: number[] = [];
  const bucketSize = Math.max(1, Math.floor(length / PEAK_BUCKETS));
  for (let b = 0; b < PEAK_BUCKETS; b++) {
    const start = b * bucketSize;
    const end = Math.min(start + bucketSize, length);
    let peak = 0;
    for (let i = start; i < end; i++) {
      const a = amplitudeAt(i);
      if (a > peak) peak = a;
    }
    peaks.push(maxAmplitude > 0 ? peak / maxAmplitude : 0);
  }

  return { buffer, peaks, onsetSec, maxAmplitude };
}

/**
 * 指定位置から指定秒数だけ鳴らす。
 * AudioBufferSourceNode.start(when, offset, duration) はサンプル単位で正確なので、
 * 本編ストリームのように再生位置を監視して止める必要がない。
 */
export function playSegment(
  buffer: AudioBuffer,
  offsetSec: number,
  durationSec: number,
): AudioBufferSourceNode {
  const ctx = getAudioContext();
  const source = ctx.createBufferSource();
  source.buffer = buffer;
  source.connect(ctx.destination);
  source.start(0, offsetSec, durationSec);
  return source;
}
