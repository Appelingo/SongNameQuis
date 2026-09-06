-- IntroQ: 曲を提供せずに参加できるようにする（判断 5）
-- library_tracks が空なだけの「未提出」と区別するための列
alter table participants
  add column skipped_library boolean not null default false;
