/**
 * Gera AAB (Android App Bundle) release do app Cliente no PC.
 * Faz bump da versão (patch) no package.json, passa versão ao Gradle e gera
 * android/app/build/outputs/bundle/release/take-me-cliente-{versão}.aab
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

// Versão: bump por padrão; use SKIP_VERSION_BUMP=1 para manter a versão atual
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

console.log('Building release AAB (Bundle)...\n');
// Força o Metro/Expo a usar apps/cliente como raiz no monorepo
const buildEnv = {
  ...process.env,
  EXPO_PROJECT_ROOT: appDir,
  EXPO_NO_METRO_WORKSPACE_ROOT: '1',
};
const result = spawnSync(
  gradlew,
  ['app:bundleRelease', '-x', 'lint', '-x', 'test', `-PversionName=${newVersion}`, `-PversionCode=${versionCode}`],
  {
    cwd: androidDir,
    env: buildEnv,
    stdio: 'inherit',
    shell: true,
  }
);

if (result.status === 0) {
  const outputDir = path.join(androidDir, 'app', 'build', 'outputs', 'bundle', 'release');
  const defaultAab = path.join(outputDir, 'app-release.aab');
  const aabName = `take-me-cliente-${newVersion}.aab`;
  const aabPath = path.join(outputDir, aabName);

  if (fs.existsSync(defaultAab)) {
    if (fs.existsSync(aabPath)) fs.unlinkSync(aabPath);
    fs.renameSync(defaultAab, aabPath);
  }

  console.log('\nAAB gerado:', aabPath);
  console.log('Use este arquivo para subir na Google Play Store.');
}
process.exit(result.status ?? 1);
