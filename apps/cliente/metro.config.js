const { getDefaultConfig } = require('expo/metro-config');
const path = require('path');
const fs = require('fs');

const { loadEnv } = require('./scripts/load-env');
loadEnv(__dirname);

const projectRoot = __dirname;
const monorepoRoot = path.resolve(projectRoot, '../..');

const config = getDefaultConfig(projectRoot);

// Garante que o Metro use a pasta do app como raiz (build local / monorepo)
config.projectRoot = projectRoot;
// Dev: mesma raiz HTTP que o metro na raiz do monorepo (URLs estáveis no Dev Client).
// Release/embed: build-release-apk.js define EXPO_NO_METRO_WORKSPACE_ROOT=1; o expo-updates
// precisa que URLs de entrada coincidam com projectRoot, senão resolve /index.ts na raiz do repo.
const serverRoot =
  process.env.EXPO_NO_METRO_WORKSPACE_ROOT === '1' ? projectRoot : monorepoRoot;
config.server = { ...(config.server ?? {}), unstable_serverRoot: serverRoot };
config.watchFolders = [monorepoRoot];
config.resolver.nodeModulesPaths = [
  path.resolve(projectRoot, 'node_modules'),
  path.resolve(monorepoRoot, 'node_modules'),
];

// Corrige resolução de ./picker no @react-native-community/datetimepicker (só existe picker.android.js / picker.ios.js)
const originalResolveRequest = config.resolver.resolveRequest;
config.resolver.resolveRequest = (context, moduleName, platform) => {
  const origin = context.originModulePath || '';
  const normalizedOrigin = origin.replace(/\\/g, '/');
  if (
    normalizedOrigin.includes('@react-native-community/datetimepicker') &&
    (moduleName === './picker' || moduleName.endsWith('/picker'))
  ) {
    const ext = platform === 'ios' ? '.ios.js' : '.android.js';
    const dir = path.dirname(origin);
    const candidate = path.join(dir, 'picker' + ext);
    if (fs.existsSync(candidate)) {
      return { type: 'sourceFile', filePath: candidate };
    }
  }
  if (originalResolveRequest) {
    return originalResolveRequest(context, moduleName, platform);
  }
  return context.resolveRequest(context, moduleName, platform);
};

module.exports = config;
