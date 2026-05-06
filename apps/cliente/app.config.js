/**
 * Configuração do Expo com suporte a variáveis de ambiente.
 * Usado pelo EAS Build: EXPO_PUBLIC_* e segredos são injetados no build.
 *
 * Carrega `.env` subindo pastas desde `apps/cliente` (monorepo) e expõe Supabase em `extra`
 * para o runtime via `expo-constants` (o Metro também carrega o mesmo env em `metro.config.js`).
 */
const { loadEnv } = require('./scripts/load-env');
loadEnv(__dirname);

const appJson = require('./app.json');

function supabaseFromEnv() {
  return {
    url:
      process.env.EXPO_PUBLIC_SUPABASE_URL ||
      process.env.SUPABASE_URL ||
      '',
    anonKey:
      process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY ||
      process.env.SUPABASE_ANON_KEY ||
      '',
  };
}

const sb = supabaseFromEnv();

/** APNs entitlement precisa bater com o tipo de provisioning profile do build. */
const apsEnvironment =
  process.env.EAS_BUILD_PROFILE === 'development' ? 'development' : 'production';

const expo = {
  ...appJson.expo,
  extra: {
    ...(appJson.expo.extra || {}),
    supabaseUrl: sb.url,
    supabaseAnonKey: sb.anonKey,
  },
  ios: {
    ...appJson.expo.ios,
    entitlements: {
      ...(appJson.expo.ios?.entitlements || {}),
      'aps-environment': apsEnvironment,
    },
    infoPlist: {
      ...(appJson.expo.ios?.infoPlist || {}),
      ITSAppUsesNonExemptEncryption: false,
      UIBackgroundModes: ['fetch', 'remote-notification'],
    },
  },
  plugins: [
    ...(appJson.expo.plugins || []),
    'expo-font',
    [
      '@rnmapbox/maps',
      {
        /** Mesmo motorista: SDK Mapbox nativo (evita estilo/paleta do fork MapLibre). */
        RNMapboxMapsImpl: 'mapbox',
      },
    ],
  ],
  android: {
    ...appJson.expo.android,
    config: {
      ...(appJson.expo.android?.config || {}),
      googleMaps: {
        apiKey: process.env.EXPO_PUBLIC_GOOGLE_MAPS_API_KEY || '',
      },
    },
  },
};

module.exports = { expo };
