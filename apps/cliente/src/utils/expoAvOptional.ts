/**
 * Carrega expo-av sob demanda para não quebrar o app se o binário nativo
 * ainda não incluir ExponentAV (dev client antigo). Falhas viram `null`.
 */
export async function loadExpoAv(): Promise<typeof import('expo-av') | null> {
  try {
    return await import('expo-av');
  } catch {
    return null;
  }
}

/**
 * iOS: prepara a sessão de áudio para REPRODUZIR.
 *
 * Sem isto o áudio do chat não toca no iPhone em dois casos:
 *  - aparelho no silencioso (precisa de `playsInSilentModeIOS`);
 *  - logo após gravar um áudio — a sessão fica em modo gravação
 *    (`allowsRecordingIOS: true`) e o som sai pelo alto-falante do ouvido,
 *    em volume baixíssimo, parecendo que não reproduziu.
 *
 * Chamar antes de tocar e ao encerrar uma gravação. Falhas não impedem a reprodução.
 */
export async function configureAudioForPlayback(): Promise<void> {
  const av = await loadExpoAv();
  if (!av) return;
  try {
    await av.Audio.setAudioModeAsync({
      allowsRecordingIOS: false,
      playsInSilentModeIOS: true,
      staysActiveInBackground: false,
    });
  } catch {
    /* não bloqueia a reprodução */
  }
}
