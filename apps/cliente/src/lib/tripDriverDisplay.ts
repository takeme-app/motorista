/** Texto para linha de veículo (checkout / acompanhamento). */
export function formatVehicleDescription(
  model?: string | null,
  year?: number | null,
  plate?: string | null
): string {
  const modelClean = model?.trim() ?? '';
  const yearPart = year != null && year > 0 ? String(year) : '';
  const modelPart = [modelClean, yearPart].filter(Boolean).join(' ').trim();
  const plateClean = plate?.trim() ?? '';
  if (modelPart && plateClean) return `${modelPart} • Placa ${plateClean}`;
  if (plateClean) return `Placa ${plateClean}`;
  if (modelPart) return modelPart;
  return 'Veículo a confirmar';
}

/** Exibição da nota (profiles.rating pode ser null ou 0). */
export function formatDriverRatingLabel(rating: number): string {
  if (rating > 0 && rating <= 5) return rating.toFixed(1);
  return '—';
}

/** Preço da corrida em centavos → texto pt-BR (lista de viagens / checkout). */
export function formatTripFareBrl(cents: number | null | undefined): string {
  if (cents == null || cents < 0) return '—';
  return `R$ ${(cents / 100).toFixed(2).replace('.', ',')}`;
}

/**
 * Lista Atividades / resumos: `bookings.amount_cents` (e equivalentes) é o total pago pelo cliente.
 * Evita confusão com preço de rota, repasse ao motorista ou subtotais internos.
 */
export function formatActivityTotalPaidLine(
  cents: number | null | undefined,
  paymentMethod?: string | null,
  options?: {
    /** Pix real gerado e ainda não liquidado (ver lib/pixPending). */
    awaitingPixPayment?: boolean;
    /** Excursão ainda em orçamento: o valor é proposta, não cobrança. */
    quoteOnly?: boolean;
  },
): string {
  if (cents == null || cents < 0) return '—';
  // Pix REAL pendente: nem "pago" nem "a pagar no fim" — está esperando o
  // pagamento AGORA, e nada anda até ele entrar.
  if (options?.awaitingPixPayment) {
    return `Aguardando pagamento · ${formatTripFareBrl(cents)}`;
  }
  if (options?.quoteOnly) {
    return `Valor do orçamento · ${formatTripFareBrl(cents)}`;
  }
  // Pix paliativo/dinheiro são pagos no fim da corrida — não estão "pagos" na reserva.
  const pm = (paymentMethod ?? '').toLowerCase();
  const label = pm === 'pix' || pm === 'cash' || pm === 'dinheiro' ? 'Total a pagar' : 'Total pago';
  return `${label} · ${formatTripFareBrl(cents)}`;
}
