/**
 * Canal de atendimento oficial da Take Me.
 *
 * Ponto ÚNICO da verdade: antes o número vivia duplicado em cada tela dos apps
 * (cliente e motorista), com valores divergentes e de placeholder — trocar em um
 * lugar deixava os outros apontando para um número inexistente.
 */

/** Somente dígitos, com DDI — formato exigido pelo link do WhatsApp. */
export const SUPPORT_PHONE_E164_DIGITS = '559830238383';

/** Exibição ao usuário. */
export const SUPPORT_PHONE_DISPLAY = '+55 98 3023-8383';

/** `tel:` para discagem. */
export const SUPPORT_PHONE_TEL_URL = `tel:+${SUPPORT_PHONE_E164_DIGITS}`;

/**
 * Link do WhatsApp. `text` opcional já abre a conversa com a mensagem preenchida.
 */
export function supportWhatsAppUrl(text?: string): string {
  const base = `https://wa.me/${SUPPORT_PHONE_E164_DIGITS}`;
  const msg = text?.trim();
  return msg ? `${base}?text=${encodeURIComponent(msg)}` : base;
}

/** Link do WhatsApp sem mensagem — atalho para uso direto em `Linking.openURL`. */
export const SUPPORT_WHATSAPP_URL = supportWhatsAppUrl();
