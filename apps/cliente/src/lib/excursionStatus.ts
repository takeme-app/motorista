import type { StatusBadgeVariant } from '../components/StatusBadge';

/**
 * Fonte de verdade do status de excursão exibido ao passageiro (cliente).
 *
 * Deriva a fase real a partir do `status` de `excursion_requests` + os timestamps
 * de embarque, em vez de mapear `status` cru (que vira `in_progress` assim que o
 * preparador abre a tela de embarque, antes de embarcar passageiro).
 *
 * Espelha apps/motorista/src/screens/excursoes/excursionStatus.ts, mas com
 * linguagem voltada ao cliente. "Em andamento" só aparece quando o embarque de
 * ida realmente começou (`check_in_ida_started_at`).
 */
export type ExcursionStatusFields = {
  status?: string | null;
  check_in_ida_started_at?: string | null;
  check_in_volta_started_at?: string | null;
  boarding_ida_done_at?: string | null;
  boarding_volta_done_at?: string | null;
};

export type ExcursionClientStatus = {
  label: string;
  variant: StatusBadgeVariant;
};

export function excursionClientStatus(row: ExcursionStatusFields): ExcursionClientStatus {
  const status = (row.status ?? '').toLowerCase();

  if (status === 'cancelled' || status === 'canceled') {
    return { label: 'Cancelada', variant: 'cancelada' };
  }
  if (status === 'completed' || row.boarding_volta_done_at) {
    return { label: 'Concluída', variant: 'concluida' };
  }
  // Fases de embarque (avaliadas da mais avançada p/ a mais inicial).
  if (row.check_in_volta_started_at) {
    return { label: 'Embarque de volta', variant: 'em_andamento' };
  }
  if (row.boarding_ida_done_at) {
    return { label: 'Em andamento', variant: 'em_andamento' };
  }
  if (row.check_in_ida_started_at) {
    return { label: 'Em embarque (ida)', variant: 'em_andamento' };
  }
  // `in_progress` sem embarque aberto NÃO é "em andamento": trata como agendada.
  if (status === 'scheduled' || status === 'in_progress') {
    return { label: 'Agendada', variant: 'confirmada' };
  }
  if (status === 'approved') {
    return { label: 'Aprovada', variant: 'confirmada' };
  }
  if (status === 'quoted') {
    return { label: 'Orçamento disponível', variant: 'orcamento' };
  }
  return { label: 'Em análise', variant: 'em_analise' };
}

/** True quando a excursão já foi aprovada/confirmada (seção "Confirmadas"). */
export function isExcursionConfirmed(status: string | null | undefined): boolean {
  const s = (status ?? '').toLowerCase();
  return ['approved', 'scheduled', 'in_progress', 'completed'].includes(s);
}
