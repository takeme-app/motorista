/**
 * Pix paliativo (Stripe Pix ainda não habilitado).
 *
 * Tela com QR + copia-e-cola FIXOS da chave Pix oficial Take Me. O valor é apenas
 * exibido (o cliente digita manualmente no app do banco). Ao tocar "pagar com Pix"
 * o pedido é efetivado após PIX_EFFECTIVATE_SECONDS (simula o aguardo do pagamento).
 *
 * ⚠️ PREENCHER: cole aqui a copia-e-cola Pix COMPLETA (a da documentação está
 * mascarada com ***). O QR estático em `assets/pix-qr.png` deve ser o QR oficial
 * correspondente a esta mesma string.
 */
export const PIX_COPIA_E_COLA =
  '00020126460014BR.GOV.BCB.PIX0124financeiro@takeme.com.br5204000053039865802BR5901N6001C62070503***63040B2F';

/** Tempo exibido na tela (visual) antes do código "expirar". */
export const PIX_DISPLAY_TIMER_SECONDS = 300; // 5 min

/** Após este tempo o pedido é efetivado e o botão "Realizei o Pagamento" habilita. */
export const PIX_EFFECTIVATE_SECONDS = 10;
