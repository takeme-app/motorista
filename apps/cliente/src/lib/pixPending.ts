/**
 * Pedido de Pix REAL ainda não liquidado.
 *
 * A assinatura no banco é sempre a mesma nas quatro tabelas: método 'pix',
 * `pix_charge_id` preenchido (o paliativo nunca tem) e `pix_paid_at` nulo.
 * Enquanto isso vale, o motorista não foi acionado — a fila de ofertas não
 * abriu, a notificação não saiu, a excursão não foi aprovada. Mostrar
 * "aguardando aceite do motorista" ou "total pago" nesse estado engana o
 * cliente sobre onde o pedido está.
 */
export type PixPendingFields = {
  /** Aceito por compatibilidade com as linhas; a decisão não depende dele. */
  payment_method?: string | null;
  pix_charge_id?: string | null;
  pix_paid_at?: string | null;
  status?: string | null;
};

const TERMINAL = new Set([
  'cancelled', 'canceled', 'delivered', 'completed', 'refunded',
]);

export function isAwaitingRealPixPayment(row: PixPendingFields | null | undefined): boolean {
  if (!row) return false;
  // `pix_charge_id` SOZINHO já identifica o Pix real: só o create-pix-charge
  // preenche essa coluna, e o paliativo nunca. Não exigir payment_method='pix'
  // é deliberado — na excursão o método só é gravado na liquidação, então
  // checá-lo deixaria o orçamento com cobrança aberta exibindo "Total pago".
  if (!String(row.pix_charge_id ?? '').trim()) return false;
  if (row.pix_paid_at) return false;
  // Pedido já encerrado (cobrança expirou e o cron cancelou) não fica
  // "aguardando pagamento" para sempre.
  return !TERMINAL.has(String(row.status ?? '').trim().toLowerCase());
}
