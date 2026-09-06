/**
 * 画面に出す用にエラーの中身をできるだけ落とさず文字列化する。
 * Error の message だけだと Supabase の code / details / hint や
 * MusicKit の独自プロパティが消えてしまい、原因調査で詰まるため。
 */
export function describeError(context: string, error: unknown): string {
  const lines = [`[${context}] でエラーが発生しました`];

  if (error instanceof Error) {
    lines.push(`${error.name}: ${error.message}`);
  } else if (typeof error === 'string') {
    lines.push(error);
  }

  if (error && typeof error === 'object') {
    const record = error as Record<string, unknown>;
    for (const key of ['code', 'details', 'hint', 'status', 'statusCode', 'reason']) {
      const value = record[key];
      if (value !== undefined && value !== null && value !== '') {
        lines.push(`${key}: ${String(value)}`);
      }
    }
  }

  // 上で拾えなかった情報が残っている場合に備えて、全体も出しておく
  try {
    const dump = JSON.stringify(
      error,
      Object.getOwnPropertyNames(Object(error)) as string[],
      2,
    );
    if (dump && dump !== '{}' && dump !== 'null') {
      lines.push('---', dump);
    }
  } catch {
    // 循環参照などで失敗しても、上の行だけで十分なので握りつぶす
  }

  return lines.join('\n');
}
