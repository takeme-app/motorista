import { View, StyleSheet } from 'react-native';
import { Text } from './Text';

/** Variantes para lista principal Atividades (seções Confirmadas / Planejadas) */
export type ActivitySectionBadge = 'confirmada' | 'planejada';

/** Variantes para status de viagem (Histórico e Detalhes) e envio */
export type TripStatusBadge =
  | 'concluida'
  | 'cancelada'
  | 'reembolsada'
  | 'em_andamento'
  | 'aguardando_inicio'
  | 'em_analise'
  | 'aguardando_motorista';

/** Motivo gravado pelo trigger ao iniciar viagem sem aceite do motorista (bookings/envios/dependentes). */
export const DRIVER_JOURNEY_STARTED_NOT_ACCEPTED_REASON = 'driver_journey_started_not_accepted';

function isDriverJourneyStartedNotAcceptedReason(reason: string | null | undefined): boolean {
  return String(reason ?? '').trim() === DRIVER_JOURNEY_STARTED_NOT_ACCEPTED_REASON;
}

export type StatusBadgeVariant = ActivitySectionBadge | TripStatusBadge;

const VARIANT_STYLES: Record<
  StatusBadgeVariant,
  { backgroundColor: string; color: string }
> = {
  confirmada: { backgroundColor: '#dcfce7', color: '#166534' },
  planejada: { backgroundColor: '#f1f1f1', color: '#525252' },
  concluida: { backgroundColor: '#dcfce7', color: '#166534' },
  cancelada: { backgroundColor: '#e11d48', color: '#FFFFFF' },
  reembolsada: { backgroundColor: '#dbeafe', color: '#1e3a8a' },
  em_andamento: { backgroundColor: '#fef3c7', color: '#0d0d0d' },
  aguardando_inicio: { backgroundColor: '#dcfce7', color: '#166534' },
  em_analise: { backgroundColor: '#e5e5e5', color: '#0d0d0d' },
  aguardando_motorista: { backgroundColor: '#e5e5e5', color: '#0d0d0d' },
};

const VARIANT_LABELS: Record<StatusBadgeVariant, string> = {
  confirmada: 'Confirmada',
  planejada: 'Planejada',
  concluida: 'Concluída',
  cancelada: 'Cancelada',
  reembolsada: 'Reembolsada',
  em_andamento: 'Em andamento',
  aguardando_inicio: 'Aguardando início',
  em_analise: 'Em análise',
  aguardando_motorista: 'Aguardando aceite do motorista',
};

type Props = {
  variant: StatusBadgeVariant;
  label?: string;
};

export function StatusBadge({ variant, label }: Props) {
  const style = VARIANT_STYLES[variant];
  const text = label ?? VARIANT_LABELS[variant];
  return (
    <View style={[styles.badge, { backgroundColor: style.backgroundColor }]}>
      <Text style={[styles.text, { color: style.color }]} numberOfLines={1}>
        {text}
      </Text>
    </View>
  );
}

/** Mapeia só `bookings.status` (sem `scheduled_trips`). Preferir `clientViagemStatusBadge` quando houver viagem. */
export function bookingStatusToBadge(status: string | undefined): TripStatusBadge {
  if (!status) return 'em_analise';
  const s = status.toLowerCase();
  if (s === 'cancelled' || s === 'canceled' || s === 'cancelada') return 'cancelada';
  if (s === 'completed' || s === 'concluido') return 'concluida';
  if (s === 'in_progress' || s === 'em_andamento') return 'em_andamento';
  if (s === 'confirmed') return 'em_andamento';
  if (s === 'paid' || s === 'pending') return 'aguardando_motorista';
  return 'em_analise';
}

/**
 * Combina reserva + viagem agendada (`scheduled_trips.status`).
 * Alinhado ao fluxo motorista: active → em andamento / aguardando; completed → concluída; cancelled em qualquer lado → cancelada.
 */
export function clientViagemStatusBadge(
  bookingStatus: string | undefined,
  tripStatus: string | undefined | null,
  cancellationReason?: string | null,
  driverJourneyStartedAt?: string | null,
): TripStatusBadge {
  const b = String(bookingStatus ?? '').trim().toLowerCase();
  const t = String(tripStatus ?? '').trim().toLowerCase();
  const journeyStarted = Boolean(driverJourneyStartedAt);

  if (b === 'cancelled' || b === 'canceled') {
    if (isDriverJourneyStartedNotAcceptedReason(cancellationReason)) return 'reembolsada';
    return 'cancelada';
  }
  if (t === 'cancelled' || t === 'canceled') {
    return 'cancelada';
  }
  if (t === 'completed') {
    if (b === 'confirmed' || b === 'in_progress') return 'concluida';
    if (b === 'paid' || b === 'pending') return 'reembolsada';
    return 'em_analise';
  }
  if (t === 'active') {
    if (b === 'confirmed' || b === 'in_progress') {
      return journeyStarted ? 'em_andamento' : 'aguardando_inicio';
    }
    if (b === 'paid' || b === 'pending') return 'aguardando_motorista';
    return 'em_analise';
  }
  return bookingStatusToBadge(bookingStatus);
}

/**
 * Envio na lista Atividades: distingue “aguardando aceite” na viagem ativa e “reembolsada” após início sem aceite.
 */
export function clientShipmentActivityStatusBadge(
  status: string | undefined,
  cancellationReason: string | null | undefined,
  driverId: string | null | undefined,
  tripStatus: string | undefined | null,
  options?: { skipDriverIdConfirmedCheck?: boolean },
  driverJourneyStartedAt?: string | null,
): TripStatusBadge {
  const s = String(status ?? '').trim().toLowerCase();
  const t = String(tripStatus ?? '').trim().toLowerCase();
  const journeyStarted = Boolean(driverJourneyStartedAt);

  if (s === 'cancelled' && isDriverJourneyStartedNotAcceptedReason(cancellationReason)) {
    return 'reembolsada';
  }
  if (t === 'active') {
    if (s === 'pending_review') return 'aguardando_motorista';
    if (
      !options?.skipDriverIdConfirmedCheck &&
      s === 'confirmed' &&
      !String(driverId ?? '').trim()
    ) {
      return 'aguardando_motorista';
    }
    if ((s === 'confirmed' || s === 'in_progress') && !journeyStarted) {
      return 'aguardando_inicio';
    }
  }
  // Defesa: viagem concluída/cancelada, mas a encomenda ficou presa em `confirmed`/`in_progress`
  // (estado órfão, sem PIN final). Mostra "Em análise" em vez de "Em andamento" para não enganar.
  if ((t === 'completed' || t === 'cancelled' || t === 'canceled') &&
      (s === 'confirmed' || s === 'in_progress')) {
    return 'em_analise';
  }
  return shipmentStatusToBadge(status);
}

/**
 * Dependente: não há `driver_id` na linha de `dependent_shipments` (motorista vem de `scheduled_trips`).
 * Sem `skipDriverIdConfirmedCheck`, `confirmed` + viagem ativa cairia sempre em «aguardando motorista».
 */
export function clientDependentActivityStatusBadge(
  status: string | undefined,
  cancellationReason: string | null | undefined,
  tripStatus: string | undefined | null,
  driverJourneyStartedAt?: string | null,
): TripStatusBadge {
  return clientShipmentActivityStatusBadge(
    status,
    cancellationReason,
    null,
    tripStatus,
    { skipDriverIdConfirmedCheck: true },
    driverJourneyStartedAt,
  );
}

/** Mapeia status do backend para variante do badge (shipments.status). Inclui awaiting_driver para quando o app motorista existir. */
export function shipmentStatusToBadge(status: string | undefined): TripStatusBadge {
  if (!status) return 'em_analise';
  const s = status.toLowerCase();
  if (s === 'delivered') return 'concluida';
  if (s === 'cancelled' || s === 'canceled') return 'cancelada';
  if (s === 'awaiting_driver') return 'aguardando_motorista';
  if (s === 'in_progress' || s === 'confirmed') return 'em_andamento';
  if (s === 'pending_review') return 'em_analise';
  return 'em_analise';
}

/** `dependent_shipments.status` — mesmos estados de fluxo que envios. */
export function dependentShipmentStatusToBadge(status: string | undefined): TripStatusBadge {
  return shipmentStatusToBadge(status);
}

/** `excursion_requests.status` → variante do badge (rótulo costuma vir separado em Atividades). */
export function excursionRequestStatusToBadge(status: string | undefined): TripStatusBadge {
  if (!status) return 'em_analise';
  const s = status.toLowerCase();
  if (s === 'completed') return 'concluida';
  if (s === 'cancelled' || s === 'canceled') return 'cancelada';
  if (s === 'in_progress') return 'em_andamento';
  if (['scheduled', 'approved'].includes(s)) return 'aguardando_motorista';
  return 'em_analise';
}

const styles = StyleSheet.create({
  badge: {
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 20,
    alignSelf: 'flex-start',
  },
  text: {
    fontSize: 12,
    fontWeight: '600',
  },
});
