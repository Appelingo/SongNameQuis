import { NavigationContainer } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { StatusBar } from 'expo-status-bar';
import { useEffect, useState } from 'react';
import { ActivityIndicator, StyleSheet, View } from 'react-native';

import { HeaderHomeButton } from './components/HeaderHomeButton';
import type { RootStackParamList } from './navigation/types';
import { GuestLobbyScreen } from './screens/GuestLobbyScreen';
import { HomeScreen } from './screens/HomeScreen';
import { HostLobbyScreen } from './screens/HostLobbyScreen';
import { HostQuizScreen } from './screens/HostQuizScreen';
import { LibraryImportScreen } from './screens/LibraryImportScreen';
import { PreviewLabScreen } from './screens/PreviewLabScreen';
import { ResultScreen } from './screens/ResultScreen';
import { ensureAnonymousSession } from './lib/supabase';
import { useRoomStore } from './store/roomStore';
import { useUserStore } from './store/userStore';

const Stack = createNativeStackNavigator<RootStackParamList>();

function waitForHydration(store: {
  persist: {
    hasHydrated: () => boolean;
    onFinishHydration: (cb: () => void) => () => void;
  };
}): Promise<void> {
  if (store.persist.hasHydrated()) return Promise.resolve();
  return new Promise((resolve) => {
    const unsubscribe = store.persist.onFinishHydration(() => {
      unsubscribe();
      resolve();
    });
  });
}

/**
 * 永続化された roomId / participantId があれば、ルームの現在状態を取得して
 * その続きの画面から再開できるようにする。取得に失敗したらセッションを捨てて Home へ。
 */
async function resolveInitialRoute(): Promise<keyof RootStackParamList> {
  await Promise.all([
    waitForHydration(useUserStore),
    waitForHydration(useRoomStore),
  ]);

  // RLS が auth.uid() を前提にしているため、何をするより先に匿名セッションを作る（判断 9）
  await ensureAnonymousSession();

  const { roomId } = useRoomStore.getState();
  const { participantId, isHost } = useUserStore.getState();

  if (!roomId || !participantId) return 'Home';

  try {
    await useRoomStore.getState().fetchRoom();
    await useRoomStore.getState().fetchParticipants();
  } catch {
    useUserStore.getState().reset();
    useRoomStore.getState().reset();
    return 'Home';
  }

  const { status } = useRoomStore.getState();
  if (status === 'finished') return 'Result';
  // ゲストはクイズ中もロビーに留まる（判断 6）
  if (status === 'playing') return isHost ? 'HostQuiz' : 'GuestLobby';

  // プリセットではライブラリ取込を通さない（判断 10）
  if (useRoomStore.getState().sourceMode === 'preset') {
    return isHost ? 'HostLobby' : 'GuestLobby';
  }

  const me = useRoomStore.getState().participants.find((p) => p.id === participantId);
  const done = (me?.library_tracks?.length ?? 0) > 0 || (me?.skipped_library ?? false);
  if (done) return isHost ? 'HostLobby' : 'GuestLobby';

  return 'LibraryImport';
}

export default function App() {
  const [initialRoute, setInitialRoute] = useState<keyof RootStackParamList | null>(null);

  useEffect(() => {
    void resolveInitialRoute().then(setInitialRoute);
  }, []);

  if (!initialRoute) {
    return (
      <View style={styles.loading}>
        <ActivityIndicator size="large" color="#007AFF" />
      </View>
    );
  }

  return (
    <NavigationContainer>
      <StatusBar style="light" />
      <Stack.Navigator
        initialRouteName={initialRoute}
        screenOptions={{
          headerStyle: { backgroundColor: '#0f0f14' },
          headerTintColor: '#fff',
          headerTitleStyle: { fontWeight: '600' },
          contentStyle: { backgroundColor: '#0f0f14' },
          headerRight: () => <HeaderHomeButton />,
        }}
      >
        <Stack.Screen
          name="Home"
          component={HomeScreen}
          options={{ headerShown: false }}
        />
        <Stack.Screen
          name="LibraryImport"
          component={LibraryImportScreen}
          options={{ title: 'ライブラリ取込' }}
        />
        <Stack.Screen
          name="HostLobby"
          component={HostLobbyScreen}
          options={{ title: 'ホストロビー' }}
        />
        <Stack.Screen
          name="GuestLobby"
          component={GuestLobbyScreen}
          options={{ title: 'ロビー' }}
        />
        <Stack.Screen
          name="HostQuiz"
          component={HostQuizScreen}
          options={{ title: 'イントロクイズ', headerBackVisible: false }}
        />
        <Stack.Screen
          name="Result"
          component={ResultScreen}
          options={{ title: '結果', headerBackVisible: false }}
        />
        <Stack.Screen
          name="PreviewLab"
          component={PreviewLabScreen}
          options={{ title: 'プレビュー音源ラボ（開発用）' }}
        />
      </Stack.Navigator>
    </NavigationContainer>
  );
}

const styles = StyleSheet.create({
  loading: {
    flex: 1,
    backgroundColor: '#0f0f14',
    justifyContent: 'center',
    alignItems: 'center',
  },
});
