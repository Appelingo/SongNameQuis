import AsyncStorage from '@react-native-async-storage/async-storage';
import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';

type UserState = {
  userName: string;
  participantId: string | null;
  hostClientId: string | null;
  isHost: boolean;
  setUserName: (userName: string) => void;
  setSession: (payload: {
    userName: string;
    participantId: string;
    isHost: boolean;
    hostClientId?: string | null;
  }) => void;
  reset: () => void;
};

const initialState = {
  userName: '',
  participantId: null as string | null,
  hostClientId: null as string | null,
  isHost: false,
};

export const useUserStore = create<UserState>()(
  persist(
    (set) => ({
      ...initialState,
      setUserName: (userName) => set({ userName }),
      setSession: ({ userName, participantId, isHost, hostClientId = null }) =>
        set({ userName, participantId, isHost, hostClientId }),
      reset: () => set(initialState),
    }),
    {
      name: 'introq-user',
      storage: createJSONStorage(() => AsyncStorage),
      partialize: (s) => ({
        userName: s.userName,
        participantId: s.participantId,
        hostClientId: s.hostClientId,
        isHost: s.isHost,
      }),
    },
  ),
);
