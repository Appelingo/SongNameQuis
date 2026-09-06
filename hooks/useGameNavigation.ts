import { useNavigation, useRoute } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { useEffect } from 'react';

import type { RootStackParamList } from '../navigation/types';
import { useRoomStore } from '../store/roomStore';
import { useUserStore } from '../store/userStore';

type Nav = NativeStackNavigationProp<RootStackParamList>;

/**
 * rooms.status に応じて全員を同じ画面へ移す。
 * ロビー / クイズ / 結果のすべての画面で呼ぶ。
 * ホストも自分で navigate せず、自分が書いた UPDATE を Realtime で受け取って遷移する。
 */
export function useGameNavigation() {
  const navigation = useNavigation<Nav>();
  const route = useRoute();
  const status = useRoomStore((s) => s.status);
  const isHost = useUserStore((s) => s.isHost);

  useEffect(() => {
    const target: keyof RootStackParamList | null =
      status === 'playing'
        ? isHost
          ? 'HostQuiz'
          : 'GuestQuiz'
        : status === 'finished'
          ? 'Result'
          : null;

    // 既にその画面にいるなら何もしない（replace ループを防ぐ）
    if (!target || route.name === target) return;

    navigation.replace(target);
  }, [status, isHost, navigation, route.name]);
}
