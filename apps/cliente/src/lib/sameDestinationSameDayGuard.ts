import { supabase } from './supabase';

const DEST_MATCH = 0.002;

/**
 * Coordenadas fallback usadas no app quando o destino não tem lat/lng (SearchTrip / PlanRide).
 * Comparar duas viagens só por geo nesses pontos gera **falso positivo** (“mesmo destino”) para
 * reservas diferentes — ignoramos linhas com esse par ao checar duplicidade por coordenadas.
 */
const APP_FALLBACK_DEST_LAT = -7.3305;
const APP_FALLBACK_DEST_LNG = -35.3335;

/** Chave YYYY-MM-DD no fuso de São Paulo (mesmo critério de “dia” da viagem no app). */
export function calendarDayKeySaoPaulo(isoOrDate: string | Date): string {
  const d = typeof isoOrDate === 'string' ? new Date(isoOrDate) : isoOrDate;
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Sao_Paulo',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(d);
}

function destMatches(
  destLat: number,
  destLng: number,
  lat: number | null | undefined,
  lng: number | null | undefined,
): boolean {
  if (lat == null || lng == null) return false;
  return Math.abs(destLat - lat) < DEST_MATCH && Math.abs(destLng - lng) < DEST_MATCH;
}

/** Destino gravado com o fallback genérico do app (sem geocode real) — não usar para bloquear por geo. */
function isLikelyAppFallbackDestination(lat: number | null | undefined, lng: number | null | undefined): boolean {
  if (lat == null || lng == null) return false;
  return (
    Math.abs(lat - APP_FALLBACK_DEST_LAT) < 1e-8 && Math.abs(lng - APP_FALLBACK_DEST_LNG) < 1e-8
  );
}

type StJoin = {
  departure_at?: string | null;
  status?: string | null;
} | { departure_at?: string | null; status?: string | null }[] | null;

function scheduledTripMetaFromJoin(st: StJoin): { departureAt: string | null; tripStatus: string | null } {
  if (!st) return { departureAt: null, tripStatus: null };
  const row = Array.isArray(st) ? st[0] : st;
  const dep = row?.departure_at;
  const departureAt = typeof dep === 'string' && dep.length > 0 ? dep : null;
  const ts = row?.status;
  const tripStatus = typeof ts === 'string' && ts.length > 0 ? ts : null;
  return { departureAt, tripStatus };
}

/**
 * Impede nova reserva de **viagem de passageiro** quando já existe booking ativo
 * para a mesma viagem/rota do mesmo motorista ou para o mesmo destino no mesmo dia.
 *
 * Encomendas e envios de dependentes são propostas diferentes: podem coexistir
 * com a viagem do passageiro e não devem ser bloqueados por esta guarda.
 */
export async function getDuplicateDestinationSameDayMessage(args: {
  userId: string;
  destLat: number;
  destLng: number;
  /** Dia de referência YYYY-MM-DD (SP), ex.: saída da `scheduled_trip` ou hoje para envio imediato. */
  dayKey: string;
  /**
   * Viagem agendada que o usuário está tentando reservar (só fluxo de booking de passageiro).
   * Evita confundir “mesmo destino noutro horário” com “continuar esta mesma viagem”.
   */
  currentScheduledTripId?: string | null;
}): Promise<string | null> {
  const { userId, destLat, destLng, dayKey, currentScheduledTripId } = args;

  const { data: bookings, error: bErr } = await supabase
    .from('bookings')
    .select(
      'id, scheduled_trip_id, destination_lat, destination_lng, status, created_at, scheduled_trips(departure_at, status)',
    )
    .eq('user_id', userId)
    .in('status', ['pending', 'paid', 'confirmed'])
    .order('created_at', { ascending: false })
    .limit(200);
  if (!bErr && Array.isArray(bookings)) {
    type BookingRow = {
      id?: string;
      scheduled_trip_id?: string | null;
      destination_lat?: number;
      destination_lng?: number;
      status?: string;
      scheduled_trips?: StJoin;
    };

    const rows = bookings as BookingRow[];

    if (currentScheduledTripId?.trim()) {
      const sid = currentScheduledTripId.trim();
      for (const row of rows) {
        if (String(row.scheduled_trip_id ?? '') !== sid) continue;
        const { tripStatus } = scheduledTripMetaFromJoin(row.scheduled_trips ?? null);
        /** Só bloqueia mesma `scheduled_trip` se a oferta ainda está ativa no banco (embed visível). */
        if (tripStatus !== 'active') continue;

        const st = row.status;
        if (st === 'pending') {
          return 'Você já tem uma reserva pendente de pagamento para esta viagem. Em Atividades, veja a viagem em «Planejada» e conclua ou cancele antes de tentar de novo.';
        }
        if (st === 'paid' || st === 'confirmed') {
          return 'Você já possui uma reserva para esta viagem. Veja em Atividades.';
        }
      }
    }

    for (const row of rows) {
      const { departureAt: depIso, tripStatus } = scheduledTripMetaFromJoin(row.scheduled_trips ?? null);
      /**
       * Duplicidade “mesmo destino / mesmo dia” só faz sentido contra **viagens ainda ativas**.
       * Com RLS, `scheduled_trips` null ou status ≠ active ⇒ viagem encerrada ou ilegível → não bloquear.
       */
      if (tripStatus !== 'active') continue;
      if (!depIso) continue;
      if (calendarDayKeySaoPaulo(depIso) !== dayKey) continue;
      if (isLikelyAppFallbackDestination(row.destination_lat, row.destination_lng)) continue;
      if (destMatches(destLat, destLng, row.destination_lat, row.destination_lng)) {
        return 'Você já tem uma viagem solicitada para este destino neste dia. Cancele ou escolha outro dia ou destino.';
      }
    }
  }

  return null;
}
