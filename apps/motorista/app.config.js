/**
 * Garante que variáveis do .env entrem no `process.env` quando o Expo avalia a config
 * (monorepo: chaves na raiz ou em apps/motorista).
 */
const fs = require('fs');
const path = require('path');

function mergeEnvFile(absPath) {
  if (!fs.existsSync(absPath)) return;
  const raw = fs.readFileSync(absPath, 'utf8');
  for (const line of raw.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eq = trimmed.indexOf('=');
    if (eq <= 0) continue;
    const key = trimmed.slice(0, eq).trim();
    let val = trimmed.slice(eq + 1).trim();
    if (
      (val.startsWith('"') && val.endsWith('"')) ||
      (val.startsWith("'") && val.endsWith("'"))
    ) {
      val = val.slice(1, -1);
    }
    if (key) process.env[key] = val;
  }
}

mergeEnvFile(path.join(__dirname, '../../.env'));
mergeEnvFile(path.join(__dirname, '.env'));

const appJson = require('./app.json');

const googleMapsKey = (process.env.EXPO_PUBLIC_GOOGLE_MAPS_API_KEY || '').trim();
const mapboxAccessToken = (
  process.env.EXPO_PUBLIC_MAPBOX_ACCESS_TOKEN ||
  process.env.EXPO_PUBLIC_MAPBOX_ACESS_TOKEN ||
  ''
).trim();
const useNativeNavigationFlag = (
  process.env.EXPO_PUBLIC_USE_NATIVE_NAVIGATION ?? '1'
).trim();

if (!mapboxAccessToken) {
  console.warn(
    '[motorista app.config] EXPO_PUBLIC_MAPBOX_ACCESS_TOKEN vazia. O mapa nativo fica indisponível até definir no .env na raiz e rebuild (extra em app.config).',
  );
}

if (!googleMapsKey) {
  // Sem chave no prebuild: o plugin iOS não injeta GMSServices/Pods do Google → mapa cinza com logo.
  console.warn(
    '[motorista app.config] EXPO_PUBLIC_GOOGLE_MAPS_API_KEY vazia. Defina no .env na raiz do repo e rode `npx expo prebuild --clean` (ou novo build EAS).',
  );
}

/** APNs entitlement precisa bater com o tipo de provisioning profile do build. */
const apsEnvironment =
  process.env.EAS_BUILD_PROFILE === 'development' ? 'development' : 'production';

module.exports = {
  expo: {
    ...appJson.expo,
    plugins: [...(appJson.expo.plugins || [])],
    ios: {
      ...appJson.expo.ios,
      config: {
        ...(appJson.expo.ios?.config || {}),
        googleMapsApiKey: googleMapsKey,
      },
      entitlements: {
        ...(appJson.expo.ios?.entitlements || {}),
        'aps-environment': apsEnvironment,
      },
      infoPlist: {
        ...(appJson.expo.ios?.infoPlist || {}),
        UIBackgroundModes: ['fetch', 'remote-notification'],
      },
    },
    android: {
      ...appJson.expo.android,
      config: {
        ...(appJson.expo.android?.config || {}),
        googleMaps: {
          ...(appJson.expo.android?.config?.googleMaps || {}),
          apiKey: googleMapsKey,
        },
      },
    },
    extra: {
      ...(appJson.expo.extra || {}),
      EXPO_PUBLIC_GOOGLE_MAPS_API_KEY: googleMapsKey,
      EXPO_PUBLIC_MAPBOX_ACCESS_TOKEN: mapboxAccessToken,
      EXPO_PUBLIC_USE_NATIVE_NAVIGATION: useNativeNavigationFlag,
    },
  },
};
