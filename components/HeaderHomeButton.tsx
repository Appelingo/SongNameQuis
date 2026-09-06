import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { Pressable, StyleSheet, Text } from 'react-native';

import type { RootStackParamList } from '../navigation/types';
import { useRoomStore } from '../store/roomStore';
import { useUserStore } from '../store/userStore';

type Nav = NativeStackNavigationProp<RootStackParamList>;

/**
 * どの画面からでもセッションを破棄してホームへ戻るヘッダーボタン。
 * ゲーム中の画面にも意図的に置く（通常の「戻る」とは別に、
 * 詰まったときに安全に離脱できる導線として）。
 */
export function HeaderHomeButton() {
  const navigation = useNavigation<Nav>();
  const resetUser = useUserStore((s) => s.reset);
  const resetRoom = useRoomStore((s) => s.reset);

  const handlePress = () => {
    resetUser();
    resetRoom();
    navigation.reset({ index: 0, routes: [{ name: 'Home' }] });
  };

  return (
    <Pressable onPress={handlePress} hitSlop={8} style={styles.button}>
      <Text style={styles.text}>ホーム</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  button: {
    paddingHorizontal: 4,
  },
  text: {
    color: '#4da3ff',
    fontSize: 15,
    fontWeight: '600',
  },
});
