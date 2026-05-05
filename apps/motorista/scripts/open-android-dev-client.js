/**
 * Abre o dev client já instalado apontando para o Metro na porta desejada.
 * Útil com dois apps: cliente em 8081, motorista em 8082 — use `8082` aqui.
 *
 * Uso: node scripts/open-android-dev-client.js [porta]
 * Padrão: REACT_NATIVE_PACKAGER_PORT ou 8081
 */
const { spawnSync } = require('child_process');
const path = require('path');
const { findAdb, resolveAdbSerial } = require('./adb-reverse');

const appDir = path.resolve(__dirname, '..');
const metroPort =
  process.argv[2] || process.env.REACT_NATIVE_PACKAGER_PORT || '8081';

process.env.REACT_NATIVE_PACKAGER_PORT = String(metroPort);

spawnSync(process.execPath, [path.join(__dirname, 'adb-reverse.js')], {
  cwd: appDir,
  env: process.env,
  stdio: 'inherit',
  shell: false,
});

const adb = findAdb();
if (!adb) {
  console.error('[open-android-dev-client] adb não encontrado.');
  process.exit(1);
}
const serial = process.env.ANDROID_SERIAL || resolveAdbSerial(adb);
const adbPrefix = serial ? ['-s', serial] : [];
const qemu = spawnSync(adb, [...adbPrefix, 'shell', 'getprop', 'ro.kernel.qemu'], {
  encoding: 'utf8',
});
const isEmu = (qemu.stdout || '').trim() === '1';
const hostUrl = isEmu ? `http://10.0.2.2:${metroPort}` : `http://127.0.0.1:${metroPort}`;
const deep =
  'exp+take-me-motorista://expo-development-client/?url=' + encodeURIComponent(hostUrl);

console.log('\n[open-android-dev-client] Abrindo em ' + hostUrl + '\n');

const r = spawnSync(
  adb,
  [...adbPrefix, 'shell', 'am', 'start', '-a', 'android.intent.action.VIEW', '-d', deep],
  { stdio: 'inherit', shell: false },
);

process.exit(r.status ?? 1);
