import { useNavigation, useRoute } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { useEffect } from 'react';

import type { RootStackParamList } from '../navigation/types';
import { useRoomStore } from '../store/roomStore';
import { useUserStore } from '../store/userStore';

type Nav = NativeStackNavigationProp<RootStackParamList>;

/**
 * rooms.status に応じて画面を移す。ロビー / クイズ / 結果のすべての画面で呼ぶ。
 *
 * ゲストはクイズ中に操作しない（判断 6）ため、'playing' では遷移させず
 * ロビーに留める。ロビー側が status を見て表示だけ切り替える。
 * 'finished' のときだけ、ホストもゲストも結果画面へ移る。
 */
export function useGameNavigation() {
  const navigation = useNavigation<Nav>();
  const route = useRoute();
  const status = useRoomStore((s) => s.status);
  const isHost = useUserStore((s) => s.isHost);

  useEffect(() => {
    let target: keyof RootStackParamList | null = null;
    if (status === 'finished') {
      target = 'Result';
    } else if (status === 'playing' && isHost) {
      target = 'HostQuiz';
    }

    // 既にその画面にいるなら何もしない（replace ループを防ぐ）
    if (!target || route.name === target) return;

    navigation.replace(target);
  }, [status, isHost, navigation, route.name]);
}
