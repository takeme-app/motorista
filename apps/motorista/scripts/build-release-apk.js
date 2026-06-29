/**
 * Gera APK release do app Motorista no PC (para distribuição interna).
 * Faz bump da versão (patch) no package.json, passa versão ao Gradle e gera
 * android/app/build/outputs/apk/release/take-me-motorista-{versão}.apk
 *
 * SKIP_VERSION_BUMP=1 mantém a versão atual (útil quando o bump já foi feito
 * manualmente ou em CI).
 */
const path = require('path');
const fs = require('fs');
const { spawnSync } = require('child_process');
const { trySetJavaHomeFromAndroidStudio, candidateJavaHomes } = require('./resolve-java-home');

const appDir = path.resolve(__dirname, '..');
const androidDir = path.join(appDir, 'android');
const gradlew = path.join(androidDir, process.platform === 'win32' ? 'gradlew.bat' : 'gradlew');
const packagePath = path.join(appDir, 'package.json');

if (!trySetJavaHomeFromAndroidStudio()) {
  console.error('JAVA_HOME não definido e nenhum JDK encontrado nos caminhos usuais do Android Studio:');
  candidateJavaHomes().forEach((c) => console.error('  -', c));
  console.error('\nDefina JAVA_HOME, por exemplo (macOS + Android Studio na pasta Aplicativos):');
  console.error(
    '  export JAVA_HOME="/Applications/Android Studio.app/Contents/jbr/Contents/Home"'
  );
  process.exit(1);
}

if (!fs.existsSync(gradlew)) {
  console.error('Gradle wrapper não encontrado em', androidDir);
  process.exit(1);
}

const pkg = JSON.parse(fs.readFileSync(packagePath, 'utf8'));
const match = (pkg.version || '1.0.0').match(/^(\d+)\.(\d+)\.(\d+)$/);
if (!match) {
  console.error('package.json "version" deve ser semver (ex: 1.0.0). Atual:', pkg.version);
  process.exit(1);
}
const major = parseInt(match[1], 10);
const minor = parseInt(match[2], 10);
const patch = parseInt(match[3], 10);
const skipBump = process.env.SKIP_VERSION_BUMP === '1' || process.env.SKIP_VERSION_BUMP === 'true';
const newVersion = skipBump ? `${major}.${minor}.${patch}` : `${major}.${minor}.${patch + 1}`;
const versionCode = major * 10000 + minor * 100 + (skipBump ? patch : patch + 1);
if (!skipBump) {
  pkg.version = newVersion;
  fs.writeFileSync(packagePath, JSON.stringify(pkg, null, 2) + '\n', 'utf8');
}
console.log(`Versão: ${newVersion} (versionCode ${versionCode})${skipBump ? ' (sem bump)' : ''}\n`);

console.log('Building release APK do Motorista...\n');
// Força o Metro/Expo a usar apps/motorista como raiz no monorepo (evita erro de resolução de módulos).
const buildEnv = {
  ...process.env,
  EXPO_PROJECT_ROOT: appDir,
  EXPO_NO_METRO_WORKSPACE_ROOT: '1',
};
const result = spawnSync(
  gradlew,
  ['app:assembleRelease', '-x', 'lint', '-x', 'test', `-PversionName=${newVersion}`, `-PversionCode=${versionCode}`],
  {
    cwd: androidDir,
    env: buildEnv,
    stdio: 'inherit',
    shell: true,
  }
);

if (result.status === 0) {
  const outputDir = path.join(androidDir, 'app', 'build', 'outputs', 'apk', 'release');
  const defaultApk = path.join(outputDir, 'app-release.apk');
  const apkName = `take-me-motorista-${newVersion}.apk`;
  const apkPath = path.join(outputDir, apkName);

  if (fs.existsSync(defaultApk)) {
    if (fs.existsSync(apkPath)) fs.unlinkSync(apkPath);
    fs.renameSync(defaultApk, apkPath);
  }

  console.log('\nAPK gerado:', apkPath);
  console.log('Instale no celular ou envie pelo canal de distribuição interna.');
}
process.exit(result.status ?? 1);
