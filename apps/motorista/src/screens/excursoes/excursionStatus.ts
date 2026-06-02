/**
 * Configuração de status, ordenação e timeline das excursões (preparador).
 * Centralizado para ColetasExcursoesScreen e DetalhesExcursaoScreen usarem o
 * mesmo visual/lógica (antes estava duplicado inline em cada tela).
 */

export type StatusConfig = { label: string; bg: string; text: string; border: string };

export const STATUS_MAP: Record<string, StatusConfig> = {
  contacted:       { label: 'Em andamento',        bg: '#FEF3C7', text: '#92400E', border: '#C9A227' },
  in_progress:     { label: 'Em andamento',        bg: '#FEF3C7', text: '#92400E', border: '#C9A227' },
  scheduled:       { label: 'Em andamento',        bg: '#FEF3C7', text: '#92400E', border: '#C9A227' },
  active:          { label: 'Em andamento',        bg: '#FEF3C7', text: '#92400E', border: '#C9A227' },
  payment_done:    { label: 'Pagamento realizado', bg: '#DBEAFE', text: '#1E40AF', border: '#E5E7EB' },
  paid:            { label: 'Pagamento realizado', bg: '#DBEAFE', text: '#1E40AF', border: '#E5E7EB' },
  approved:        { label: 'Pagamento realizado', bg: '#DBEAFE', text: '#1E40AF', border: '#E5E7EB' },
  quoted:          { label: 'Orçamento enviado',   bg: '#E0E7FF', text: '#3730A3', border: '#E5E7EB' },
  in_analysis:     { label: 'Em análise',          bg: '#F3F4F6', text: '#374151', border: '#E5E7EB' },
  pending:         { label: 'Pendente',            bg: '#F3F4F6', text: '#374151', border: '#E5E7EB' },
  pending_rating:  { label: 'Avaliação Pendente',  bg: '#E8EEF9', text: '#1E3A5F', border: '#E5E7EB' },
  confirmed:       { label: 'Concluído',           bg: '#D1FAE5', text: '#065F46', border: '#E5E7EB' },
  completed:       { label: 'Concluído',           bg: '#D1FAE5', text: '#065F46', border: '#E5E7EB' },
  cancelled:       { label: 'Cancelado',           bg: '#FEE2E2', text: '#991B1B', border: '#E5E7EB' },
};

export const DEFAULT_STATUS: StatusConfig = { label: 'Pendente', bg: '#F3F4F6', text: '#374151', border: '#E5E7EB' };

export function statusCfg(status: string): StatusConfig {
  return STATUS_MAP[status] ?? DEFAULT_STATUS;
}

/** Prioridade de ordenação na lista plana (menor = topo). */
const STATUS_PRIORITY: Record<string, number> = {
  in_progress: 0, scheduled: 0, contacted: 0, active: 0,
  approved: 1, paid: 1, payment_done: 1,
  quoted: 2, in_analysis: 2, pending: 2,
  pending_rating: 3,
  confirmed: 4, completed: 4,
  cancelled: 5,
};

export function statusOrder(status: string): number {
  return STATUS_PRIORITY[status] ?? 2.5;
}

/** Status em que faz sentido oferecer o fluxo de embarque na lista. */
export const BOARDING_STATUSES = new Set([
  'approved', 'scheduled', 'in_progress', 'payment_done', 'paid', 'active',
]);

/**
 * Estado do botão de embarque (ida → volta) a partir dos timestamps da excursão.
 * check_in_*_started_at = fase aberta; boarding_*_done_at = fase finalizada.
 * Fluxo: Iniciar embarque (ida) → Continuar embarque (ida) → Iniciar embarque de
 * volta → Continuar embarque de volta → Embarque concluído (desabilitado).
 */
export type BoardingFlags = {
  check_in_ida_started_at?: string | null;
  check_in_volta_started_at?: string | null;
  boarding_ida_done_at?: string | null;
  boarding_volta_done_at?: string | null;
};

export type BoardingCta = { phase: 'ida' | 'volta'; label: string; done: boolean };

export function boardingCta(x: BoardingFlags): BoardingCta {
  if (x.boarding_volta_done_at) return { phase: 'volta', label: 'Embarque concluído', done: true };
  if (x.check_in_volta_started_at) return { phase: 'volta', label: 'Continuar embarque de volta', done: false };
  if (x.boarding_ida_done_at) return { phase: 'volta', label: 'Iniciar embarque de volta', done: false };
  if (x.check_in_ida_started_at) return { phase: 'ida', label: 'Continuar embarque', done: false };
  return { phase: 'ida', label: 'Iniciar embarque', done: false };
}

export function fleetTypeLabel(v: string | null | undefined): string {
  if (!v) return 'Van';
  const m: Record<string, string> = {
    carro: 'Carro',
    van: 'Van',
    micro_onibus: 'Micro-ônibus',
    onibus: 'Ônibus Executivo',
  };
  return m[v] ?? v;
}

export const TIMELINE_LABELS = ['Pedido feito', 'Pagamento aprovado', 'Embarque confirmado', 'Ônibus partiu'];

export function timelineSteps(status: string): boolean[] {
  const afterPayment = [
    'approved', 'scheduled', 'in_progress', 'completed',
    'payment_done', 'paid', 'pending_rating', 'confirmed',
  ];
  const afterBoarding = ['scheduled', 'in_progress', 'completed', 'confirmed'];
  const afterDeparted = ['in_progress', 'completed'];
  return [
    true,
    afterPayment.includes(status),
    afterBoarding.includes(status),
    afterDeparted.includes(status),
  ];
}

export function formatTimelineSubtitle(iso: string | null): string {
  if (!iso) return '—';
  try {
    const d = new Date(iso);
    const months = ['Jan', 'Fev', 'Mar', 'Abr', 'Mai', 'Jun', 'Jul', 'Ago', 'Set', 'Out', 'Nov', 'Dez'];
    const day = d.getDate().toString().padStart(2, '0');
    const mon = months[d.getMonth()] ?? '';
    const time = d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
    return `${day} ${mon}, ${time}`;
  } catch {
    return '—';
  }
}
