/**
 * Apple Music Developer Token (JWT) 生成スクリプト
 *
 * 使い方:
 *   1. Keys でダウンロードした AuthKey_XXXXXXXXXX.p8 をこのディレクトリに置く
 *   2. 下の TEAM_ID / KEY_ID / PRIVATE_KEY_PATH を自分の値に書き換える
 *   3. npm install jsonwebtoken
 *   4. node scripts/generate-apple-music-token.js
 *   5. 出力された JWT を .env の EXPO_PUBLIC_APPLE_MUSIC_DEVELOPER_TOKEN に貼る
 *
 * 注意: .p8 は git にコミットしないこと
 */
const fs = require('fs');
const path = require('path');

let jwt;
try {
  jwt = require('jsonwebtoken');
} catch {
  console.error('jsonwebtoken がありません。先に実行してください: npm install jsonwebtoken');
  process.exit(1);
}

// ===== ここを書き換える =====
const TEAM_ID = 'RL375LBE96'; // Membership の Team ID（10文字）
const KEY_ID = '47WQV53S52'; // Keys の Key ID（10文字）
const PRIVATE_KEY_PATH = path.join(__dirname, 'AuthKey_47WQV53S52.p8');
const EXPIRES_IN = '180d'; // 最大 180 日
// ============================

if (TEAM_ID.includes('X') || KEY_ID.includes('X')) {
  console.error('TEAM_ID / KEY_ID を自分の値に書き換えてから再実行してください。');
  process.exit(1);
}

if (!fs.existsSync(PRIVATE_KEY_PATH)) {
  console.error(`秘密鍵が見つかりません: ${PRIVATE_KEY_PATH}`);
  process.exit(1);
}

const privateKey = fs.readFileSync(PRIVATE_KEY_PATH);

const token = jwt.sign({}, privateKey, {
  algorithm: 'ES256',
  expiresIn: EXPIRES_IN,
  issuer: TEAM_ID,
  header: {
    alg: 'ES256',
    kid: KEY_ID,
  },
});

console.log('\n=== Apple Music Developer Token ===\n');
console.log(token);
console.log('\nこれを .env に設定してください:');
console.log('EXPO_PUBLIC_APPLE_MUSIC_DEVELOPER_TOKEN=<上のJWT>\n');
