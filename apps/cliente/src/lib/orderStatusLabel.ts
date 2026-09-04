import { isAwaitingRealPixPayment, type PixPendingFields } from './pixPending';

/**
 * Rótulo em português para o status de encomenda e envio de dependente.
 *
 * Existe porque o detalhe da viagem exibia o valor cru do banco — o cliente
 * lia "Status: cancelled", "pending_review", "in_progress". Os dois compartilham
 * o mesmo CHECK no banco:
 *   pending_review | confirmed | in_progress | delivered | cancelled
 */
const LABELS: Record<string, string> = {
  pending_review: 'Em análise',
  confirmed: 'Confirmado',
  in_progress: 'Em andamento',
  delivered: 'Entregue',
  cancelled: 'Cancelado',
  canceled: 'Cancelado',
};

/**
 * Pix real não liquidado manda sobre o status: o pedido existe, mas nada anda
 * até o pagamento entrar — é a mesma regra do selo e da faixa.
 * Status desconhecido cai em "Em análise" em vez de vazar o valor do banco.
 */
export function orderStatusLabelPt(row: PixPendingFields | null | undefined): string {
  if (isAwaitingRealPixPayment(row)) return 'Aguardando pagamento';
  const raw = String(row?.status ?? '').trim().toLowerCase();
  return LABELS[raw] ?? 'Em análise';
}
