-- IntroQ: クイズ進行フェーズと解答の整合性

-- 1) 進行フェーズを rooms に持たせる（Broadcast ではなく DB を唯一の真実にする）
create type track_phase as enum ('intro', 'answering', 'revealed');
alter table rooms add column phase track_phase not null default 'intro';

-- 2) 同一問題への多重解答を防ぐ
alter table answers
  add constraint answers_unique_per_track
  unique (room_id, participant_id, track_index);
