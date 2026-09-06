export type RoomStatus = 'lobby' | 'playing' | 'finished';
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
          library_tracks: LibraryTrack[];
          skipped_library: boolean;
          score: number;
          created_at: string;
        };
        Insert: {
          id?: string;
          room_id: string;
          user_name: string;
          library_tracks?: LibraryTrack[];
          skipped_library?: boolean;
          score?: number;
          created_at?: string;
        };
        Update: {
          id?: string;
          room_id?: string;
          user_name?: string;
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
    Functions: Record<string, never>;
    Enums: {
      room_status: RoomStatus;
      track_phase: TrackPhase;
    };
    CompositeTypes: Record<string, never>;
  };
};
