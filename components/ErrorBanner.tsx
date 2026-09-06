import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

type Props = {
  message: string | null;
  onDismiss: () => void;
};

/**
 * 画面内に出すエラー表示。
 * Alert.alert は Web ではブラウザのネイティブダイアログになり、
 * 文言を選択・コピーできないため、デバッグしづらい。
 * ここでは selectable なテキストで出して、そのままコピーできるようにする。
 */
export function ErrorBanner({ message, onDismiss }: Props) {
  if (!message) return null;

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <Text style={styles.title}>エラー</Text>
        <Pressable onPress={onDismiss} hitSlop={8}>
          <Text style={styles.close}>閉じる</Text>
        </Pressable>
      </View>
      <ScrollView style={styles.body}>
        <Text style={styles.message} selectable>
          {message}
        </Text>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    backgroundColor: '#2a1416',
    borderColor: '#5c2a2f',
    borderWidth: 1,
    borderRadius: 12,
    padding: 12,
    marginBottom: 12,
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 6,
  },
  title: {
    color: '#ff6b6b',
    fontSize: 13,
    fontWeight: '700',
  },
  close: {
    color: '#888',
    fontSize: 13,
  },
  body: {
    maxHeight: 160,
  },
  message: {
    color: '#f0d7d7',
    fontSize: 13,
    lineHeight: 19,
    fontFamily: 'monospace',
  },
});
