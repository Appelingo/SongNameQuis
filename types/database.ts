export type RoomStatus = 'lobby' | 'playing' | 'finished';
/** 出題曲の供給源（判断 10）。preset はライブラリ取込を通さない */
export type SourceMode = 'library' | 'preset';
export type TrackPhase = 'intro' | 'answering' | 'revealed';

export type LibraryTrack = {
  title: string;
  artist: string;
  catalogId?: string;
};

/** 出題対象。再生できることを型で保証するため catalogId は必須 */
export type PlaylistTrack = {
  title: string;
  artist: string;
  catalogId: string;
  /**
   * プレビュー音源の URL（判断 8）。出題リストを作る時点で埋める。
   * rooms.playlist_tracks は jsonb なのでマイグレーションは不要。
   * 取得できなかった曲は出題対象から外すが、古いルームのデータには
   * 入っていないことがあるため null を許容する。
   */
  previewUrl?: string | null;
};

export type Answer = {
  id: string;
  room_id: string;
  participant_id: string;
  track_index: number;
  answer_text: string;
  is_correct: boolean | null;
  answered_at: string;
};

export type Database = {
  public: {
    Tables: {
      rooms: {
        Row: {
          id: string;
          code: string | null;
          host_id: string;
          /** ルームを作った匿名ユーザーの auth.uid()。RLS の所有権判定に使う（判断 9） */
          host_user_id: string | null;
          source_mode: SourceMode;
          storefront: string;
          storefront_name: string | null;
          genre_id: string | null;
          genre_name: string | null;
          status: RoomStatus;
          phase: TrackPhase;
          playlist_tracks: PlaylistTrack[];
          current_track_index: number;
          created_at: string;
        };
        Insert: {
          id?: string;
          code?: string | null;
          host_id: string;
          host_user_id?: string | null;
          source_mode?: SourceMode;
          storefront?: string;
          storefront_name?: string | null;
          genre_id?: string | null;
          genre_name?: string | null;
          status?: RoomStatus;
          phase?: TrackPhase;
          playlist_tracks?: PlaylistTrack[];
          current_track_index?: number;
          created_at?: string;
        };
        Update: {
          id?: string;
          code?: string | null;
          host_id?: string;
          host_user_id?: string | null;
          source_mode?: SourceMode;
          storefront?: string;
          storefront_name?: string | null;
          genre_id?: string | null;
          genre_name?: string | null;
          status?: RoomStatus;
          phase?: TrackPhase;
          playlist_tracks?: PlaylistTrack[];
          current_track_index?: number;
          created_at?: string;
        };
        Relationships: [];
      };
      participants: {
        Row: {
          id: string;
          room_id: string;
          user_name: string;
          /** 参加者本人の auth.uid()。RLS の所有権判定に使う（判断 9） */
          user_id: string | null;
          library_tracks: LibraryTrack[];
          skipped_library: boolean;
          score: number;
          created_at: string;
        };
        Insert: {
          id?: string;
          room_id: string;
          user_name: string;
          user_id?: string | null;
          library_tracks?: LibraryTrack[];
          skipped_library?: boolean;
          score?: number;
          created_at?: string;
        };
        Update: {
          id?: string;
          room_id?: string;
          user_name?: string;
          user_id?: string | null;
          library_tracks?: LibraryTrack[];
          skipped_library?: boolean;
          score?: number;
          created_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'participants_room_id_fkey';
            columns: ['room_id'];
            isOneToOne: false;
            referencedRelation: 'rooms';
            referencedColumns: ['id'];
          },
        ];
      };
      answers: {
        Row: Answer;
        Insert: {
          id?: string;
          room_id: string;
          participant_id: string;
          track_index: number;
          answer_text: string;
          is_correct?: boolean | null;
          answered_at?: string;
        };
        Update: {
          id?: string;
          room_id?: string;
          participant_id?: string;
          track_index?: number;
          answer_text?: string;
          is_correct?: boolean | null;
          answered_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'answers_room_id_fkey';
            columns: ['room_id'];
            isOneToOne: false;
            referencedRelation: 'rooms';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'answers_participant_id_fkey';
            columns: ['participant_id'];
            isOneToOne: false;
            referencedRelation: 'participants';
            referencedColumns: ['id'];
          },
        ];
      };
    };
    Views: Record<string, never>;
    Functions: {
      /** 出題リスト確定後に、そのルームの参加者のライブラリを消す（ホストのみ実行可） */
      clear_room_libraries: {
        Args: { target_room: string };
        Returns: undefined;
      };
      /** 自分がそのルームの参加者かどうか。participants の RLS が内部で使う */
      is_room_member: {
        Args: { target_room: string };
        Returns: boolean;
      };
    };
    Enums: {
      room_status: RoomStatus;
      source_mode: SourceMode;
      track_phase: TrackPhase;
    };
    CompositeTypes: Record<string, never>;
  };
};
