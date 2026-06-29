import { Platform, Share } from 'react-native';

// expo-sharing é módulo nativo: dev clients antigos podem não tê-lo embutido.
// Carregamos de forma resiliente — se o módulo nativo não existir, caímos no
// Share nativo do React Native (que anexa o arquivo no iOS).
let Sharing: typeof import('expo-sharing') | null = null;
try {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  Sharing = require('expo-sharing') as typeof import('expo-sharing');
} catch {
  Sharing = null;
}

export type ShareFileOptions = {
  /** MIME type do arquivo (ex.: application/pdf). */
  mimeType: string;
  /** Uniform Type Identifier para iOS (ex.: com.adobe.pdf). */
  uti: string;
  /** Título do diálogo de compartilhamento (Android/expo-sharing). */
  dialogTitle: string;
  /** Título usado no fallback do Share nativo do RN. */
  fallbackTitle: string;
};

/**
 * Compartilha um arquivo local (file://) abrindo a folha de compartilhamento
 * nativa. Usa expo-sharing quando o módulo nativo está presente; caso
 * contrário, recorre ao Share do React Native (funciona com arquivo no iOS).
 *
 * @returns `shared: false` quando não há forma de compartilhar arquivo neste
 *          dispositivo (ex.: Android sem expo-sharing nativo).
 */
export async function shareLocalFile(
  fileUri: string,
  opts: ShareFileOptions,
): Promise<{ shared: boolean }> {
  if (Sharing && (await Sharing.isAvailableAsync())) {
    await Sharing.shareAsync(fileUri, {
      mimeType: opts.mimeType,
      dialogTitle: opts.dialogTitle,
      UTI: opts.uti,
    });
    return { shared: true };
  }
  if (Platform.OS === 'ios') {
    await Share.share({ url: fileUri, title: opts.fallbackTitle });
    return { shared: true };
  }
  return { shared: false };
}
