import type { PlaylistTrack } from '../types/database';

/**
 * 曲名の表記ゆれを吸収する。
 * 全角/半角、大文字/小文字、(feat. ...) などの付加情報、記号・空白の差を無視する。
 */
export function normalizeTitle(input: string): string {
  return input
    .normalize('NFKC') // 全角英数 → 半角、互換文字の統一
    .toLowerCase()
    .replace(/[(（\[【].*?[)）\]】]/g, '') // (feat. X) / 【MV】 などを除去
    .replace(/\s+/g, '')
    .replace(/[-_'"’‘“”.,!?、。・~〜/\\|:;：；]/g, '')
    .trim();
}

/** 自動判定。ホストが手動で覆せるため、ここでは完全一致のみの厳しめ判定でよい */
export function judgeAnswer(answerText: string, track: PlaylistTrack): boolean {
  const normalized = normalizeTitle(answerText);
  if (!normalized) return false;
  return normalized === normalizeTitle(track.title);
}
