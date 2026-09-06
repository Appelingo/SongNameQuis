-- IntroQ: 車内で口頭共有できる短いルームコード
-- 生成はアプリ側で行う（0/O, 1/I/L のような紛らわしい文字を除いた英数字 6 桁）

alter table rooms add column code text unique;
