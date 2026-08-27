import { Platform, PermissionsAndroid } from 'react-native';
import { supabase } from './supabase';

/**
 * iOS: o token APNs chega de forma assíncrona depois de `registerDeviceForRemoteMessages()`.
 * Chamar `getToken()` antes disso lança "No APNS token specified before fetching FCM Token"
 * e o registro falha silenciosamente — o aparelho nunca recebe push. Aguarda alguns
 * ciclos curtos antes de desistir.
 */
async function waitForApnsToken(
  messagingInstance: { getAPNSToken: () => Promise<string | null> },
  attempts = 10,
  delayMs = 500,
): Promise<string | null> {
  for (let i = 0; i < attempts; i++) {
    try {
      const apns = await messagingInstance.getAPNSToken();
      if (apns) return apns;
    } catch {
      /* tenta de novo */
    }
    await new Promise((r) => setTimeout(r, delayMs));
  }
  return null;
}

/**
 * Obtém token FCM e associa ao perfil autenticado (login / Home).
 * Android: pede POST_NOTIFICATIONS no Android 13+. iOS: pede autorização e
 * registra para remote messages antes de getToken().
 */
export async function syncClienteProfileFcmToken(): Promise<void> {
  if (Platform.OS !== 'android' && Platform.OS !== 'ios') return;
  try {
    const messaging = (await import('@react-native-firebase/messaging')).default;
    if (Platform.OS === 'android') {
      if (typeof Platform.Version === 'number' && Platform.Version >= 33) {
        const status = await PermissionsAndroid.request(
          PermissionsAndroid.PERMISSIONS.POST_NOTIFICATIONS,
        );
        if (status !== PermissionsAndroid.RESULTS.GRANTED) return;
      }
    } else {
      const auth = await messaging().requestPermission();
      const ok =
        auth === messaging.AuthorizationStatus.AUTHORIZED ||
        auth === messaging.AuthorizationStatus.PROVISIONAL;
      if (!ok) return;
      await messaging().registerDeviceForRemoteMessages();
      const apns = await waitForApnsToken(messaging());
      if (!apns) {
        // Quase sempre significa APNs Auth Key ausente no projeto Firebase (ou
        // perfil de provisionamento sem Push). Sem APNs não existe token FCM no iOS.
        console.warn(
          '[clienteFcm] APNs token indisponível — push iOS não será registrado. ' +
            'Verifique a APNs Auth Key (.p8) no Firebase e a capability Push Notifications.',
        );
        return;
      }
    }
    const {
      data: { session },
    } = await supabase.auth.getSession();
    if (!session?.user?.id) return;
    const token = await messaging().getToken();
    if (!token) return;
    const { error } = await supabase.rpc('upsert_profile_fcm_token', {
      p_fcm_token: token,
      p_platform: Platform.OS,
      p_app_slug: 'cliente',
    });
    if (error) console.warn('upsert_profile_fcm_token', error.message);
  } catch (e) {
    console.warn('syncClienteProfileFcmToken', e);
  }
}

/** Remove vínculo do token atual no Supabase e invalida token local (logout). */
export async function unregisterClienteProfileFcmToken(): Promise<void> {
  if (Platform.OS !== 'android' && Platform.OS !== 'ios') return;
  try {
    const messaging = (await import('@react-native-firebase/messaging')).default;
    const {
      data: { session },
    } = await supabase.auth.getSession();
    if (!session?.user?.id) return;
    const token = await messaging().getToken();
    if (token) {
      await supabase
        .from('profile_fcm_tokens')
        .delete()
        .eq('profile_id', session.user.id)
        .eq('fcm_token', token);
    }
    await messaging().deleteToken();
  } catch (e) {
    console.warn('unregisterClienteProfileFcmToken', e);
  }
}
