import AsyncStorage from '@react-native-async-storage/async-storage';
import { createClient } from '@supabase/supabase-js';
import Constants from 'expo-constants';
import { Platform } from 'react-native';

import type { Database } from '../types/database';

const supabaseUrl =
  Constants.expoConfig?.extra?.supabaseUrl ??
  process.env.EXPO_PUBLIC_SUPABASE_URL ??
  '';

const supabaseAnonKey =
  Constants.expoConfig?.extra?.supabaseAnonKey ??
  process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY ??
  '';

if (!supabaseUrl || !supabaseAnonKey) {
  console.warn(
    'Supabase URL / Anon Key が未設定です。.env に EXPO_PUBLIC_SUPABASE_URL と EXPO_PUBLIC_SUPABASE_ANON_KEY を設定してください。',
  );
}

export const supabase = createClient<Database>(supabaseUrl, supabaseAnonKey, {
  auth: {
    storage: AsyncStorage,
    autoRefreshToken: true,
    persistSession: true,
    detectSessionInUrl: Platform.OS === 'web',
  },
});

/**
 * 匿名セッションを確保する（判断 9）。
 *
 * RLS を所有権ベースにしたため、auth.uid() が無いと読み書きが一切できない。
 * セッションは AsyncStorage に保存されるので、リロードしても同じ uid が保たれ、
 * 自分が作ったルームの操作権を維持できる。
 *
 * Supabase ダッシュボードで匿名サインインが無効だとここで失敗する。
 */
export async function ensureAnonymousSession(): Promise<string> {
  const { data } = await supabase.auth.getSession();
  if (data.session?.user?.id) return data.session.user.id;

  const { data: signedIn, error } = await supabase.auth.signInAnonymously();
  if (error || !signedIn.session?.user?.id) {
    throw new Error(
      'Supabase の匿名サインインに失敗しました。ダッシュボードの Authentication → Sign In / Providers で Anonymous sign-ins が有効か確認してください。' +
        (error ? `（${error.message}）` : ''),
    );
  }
  return signedIn.session.user.id;
}

/** 現在の匿名ユーザー ID。未サインインなら null */
export async function getCurrentUserId(): Promise<string | null> {
  const { data } = await supabase.auth.getSession();
  return data.session?.user?.id ?? null;
}
