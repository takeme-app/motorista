import { useState, useCallback, useEffect, useRef } from 'react';
import {
  View,
  TouchableOpacity,
  StyleSheet,
  ScrollView,
  ActivityIndicator,
  Image,
} from 'react-native';
import { Text } from '../components/Text';
import { useFocusEffect } from '@react-navigation/native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';
import { MaterialIcons } from '@expo/vector-icons';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import type { RootStackParamList } from '../navigation/types';
import { supabase } from '../lib/supabase';
import { createOrGetBookingConversation } from '../lib/bookingConversation';
import { createOrGetShipmentConversation } from '../lib/shipmentConversation';
import { useAppAlert } from '../contexts/AppAlertContext';
import { storageUrl } from '../utils/storageUrl';
import { getUserErrorMessage } from '../utils/errorMessage';

type Props = NativeStackScreenProps<RootStackParamList, 'PendingRequests'>;

const GOLD = '#C9A227';

type RequestItem = {
  id: string;
  kind: 'booking' | 'shipment' | 'shipment_offer' | 'dependent_shipment';
  /** Oferta ainda não liberada no banco (`current_offer_driver_id` nulo); só atualizar / aguardar. */
  shipmentOfferPendingSystem?: boolean;
  /** scheduledTripId — para navegar para TripDetail após aceitar */
  scheduledTripId: string;
  origin: string;
  destination: string;
  /** Horário de partida da viagem (ISO) */
  departureAt: string;
  timeLabel: string;
  priceCents: number | null;
  userName: string;
  userAvatar: string | null;
  userRating: number | null;
  minutesAgo: number;
  /** passageiros (apenas kind booking) */
  passengerCount: number;
  /** tamanho do pacote (apenas kind shipment) */
  packageSizeLabel: string;
  /** malas declaradas no envio de dependente */
  dependentBagsCount: number;
  /** 30min antes da partida */
  expiresAt: Date;
  rawId: string;
};

function minutesAgoFn(iso: string): number {
  return Math.floor((Date.now() - new Date(iso).getTime()) / 60000);
}

function formatCents(cents: number | null): string {
  if (cents == null) return 'A combinar';
  return (cents / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}

function formatTime(iso: string | null): string {
  if (!iso) return '—';
  try {
    const d = new Date(iso);
    return d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
  } catch { return '—'; }
}

function shortAddr(addr: string): string {
  return addr.split(',')[0]?.trim() ?? addr;
}

function packageSizeLabelDb(size: string | null | undefined): string {
  switch (size) {
    case 'pequeno': return 'Pequeno';
    case 'medio': return 'Médio';
    case 'grande': return 'Grande';
    default: return size?.trim() ? size : 'Pacote';
  }
}

/** Prazo do assignment no banco; se ausente/inválido, usa o fallback (ex.: partida − 30 min). */
function expiresAtFromAssignment(iso: string | null | undefined, fallback: Date): Date {
  if (iso) {
    const d = new Date(iso);
    if (!Number.isNaN(d.getTime())) return d;
  }
  return fallback;
}

/** Só listar pedidos cuja viagem ainda está aberta (corrida concluída/cancelada → some da fila). */
function tripStatusAllowsPendingRequests(status: string | null | undefined): boolean {
  const s = String(status ?? '').trim().toLowerCase();
  return s === 'scheduled' || s === 'active';
}

function nestedScheduledTripStatus(
  st: { status?: string | null } | { status?: string | null }[] | null | undefined,
): string | null {
  if (!st) return null;
  return Array.isArray(st) ? (st[0]?.status ?? null) : (st.status ?? null);
}

function requestItemPriority(item: RequestItem): number {
  switch (item.kind) {
    case 'shipment_offer':
      return 0;
    case 'booking':
      return 1;
    case 'dependent_shipment':
      return 2;
    case 'shipment':
      return 3;
  }
}

function dedupePendingRequests(items: RequestItem[]): RequestItem[] {
  const byEntity = new Map<string, RequestItem>();
  for (const item of items) {
    const entityKey =
      item.kind === 'shipment' || item.kind === 'shipment_offer'
        ? `shipment:${item.rawId}`
        : `${item.kind}:${item.rawId}`;
    const current = byEntity.get(entityKey);
    if (!current || requestItemPriority(item) < requestItemPriority(current)) {
      byEntity.set(entityKey, item);
    }
  }
  return Array.from(byEntity.values());
}

/** Countdown até o limite (ex.: 30 min antes da partida). HH:mm:ss; urgente nos últimos 5 min. */
function formatCountdown(expiresAt: Date): { label: string; urgent: boolean } | null {
  const ms = expiresAt.getTime() - Date.now();
  if (ms <= 0) return null;
  const totalSecs = Math.floor(ms / 1000);
  const h = Math.floor(totalSecs / 3600);
  const m = Math.floor((totalSecs % 3600) / 60);
  const s = totalSecs % 60;
  const label = `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  return { label, urgent: totalSecs < 5 * 60 };
}

export function PendingRequestsScreen({ navigation }: Props) {
  const { showAlert } = useAppAlert();
  const [items, setItems] = useState<RequestItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [actioning, setActioning] = useState<string | null>(null);
  const [userId, setUserId] = useState<string | null>(null);
  // Tick a cada segundo para atualizar countdowns
  const [, setTick] = useState(0);
  const tickRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    tickRef.current = setInterval(() => setTick((t) => t + 1), 1000);
    return () => { if (tickRef.current) clearInterval(tickRef.current); };
  }, []);

  const load = useCallback(async (opts?: { silent?: boolean }) => {
    const silent = opts?.silent === true;
    if (!silent) setLoading(true);
    const { data: { user } } = await supabase.auth.getUser();
    if (!user?.id) {
      setItems([]);
      if (!silent) setLoading(false);
      return;
    }
    setUserId(user.id);

    const { data: assignmentRows } = await supabase
      .from('worker_assignments')
      .select('entity_type, entity_id, expires_at')
      .eq('worker_id', user.id)
      .eq('status', 'assigned');

    const assignmentExpiresAt = new Map<string, string | null>();
    for (const row of (assignmentRows ?? []) as {
      entity_type: string;
      entity_id: string;
      expires_at: string | null;
    }[]) {
      assignmentExpiresAt.set(`${row.entity_type}:${row.entity_id}`, row.expires_at);
    }

    // Bookings pendentes nas viagens deste motorista (apenas viagem scheduled/active)
    const { data: bookings } = await supabase
      .from('bookings')
      .select(
        'id, origin_address, destination_address, passenger_count, amount_cents, created_at, scheduled_trip_id, user_id, scheduled_trips!inner(departure_at, driver_id, status)',
      )
      .in('status', ['pending', 'paid'])
      .limit(50);

    const filtered = ((bookings ?? []) as unknown[]).filter((b: unknown) => {
      const row = b as {
        scheduled_trips?: { driver_id?: string; status?: string } | { driver_id?: string; status?: string }[];
      };
      const trip = Array.isArray(row.scheduled_trips) ? row.scheduled_trips[0] : row.scheduled_trips;
      if (trip?.driver_id !== user.id) return false;
      return tripStatusAllowsPendingRequests(trip?.status);
    });

    const all: RequestItem[] = [];

    await supabase.rpc('shipment_process_expired_driver_offers');

    // Ofertas já vêm filtradas por current_offer_driver_id; não exigir cidade do perfil
    // (motorista sem city / origem com grafia diferente ocultava a solicitação indevidamente).
    const { data: offerRowsRaw } = await supabase
      .from('shipments')
      .select(
        'id, origin_address, destination_address, amount_cents, created_at, user_id, package_size, current_offer_expires_at, scheduled_trip_id, scheduled_trips(status)',
      )
      .eq('current_offer_driver_id', user.id)
      .in('status', ['pending_review', 'confirmed'])
      .is('driver_id', null)
      .limit(20);

    const offerRows = ((offerRowsRaw ?? []) as unknown[]).filter((row: unknown) => {
      const r = row as {
        scheduled_trip_id?: string | null;
        scheduled_trips?: { status?: string | null } | { status?: string | null }[] | null;
      };
      const tid = r.scheduled_trip_id;
      if (tid == null || tid === '') return true;
      return tripStatusAllowsPendingRequests(nestedScheduledTripStatus(r.scheduled_trips));
    });

    const offerSeen = new Set((offerRows ?? []).map((r: { id: string }) => r.id));

    const { data: preferredWaitRaw } = await supabase
      .from('shipments')
      .select(
        'id, origin_address, destination_address, amount_cents, created_at, user_id, package_size, current_offer_expires_at, scheduled_trip_id, scheduled_trips(status)',
      )
      .eq('client_preferred_driver_id', user.id)
      .is('current_offer_driver_id', null)
      .is('driver_id', null)
      .in('status', ['pending_review', 'confirmed'])
      .limit(20);

    const preferredWaitRows = ((preferredWaitRaw ?? []) as unknown[]).filter((row: unknown) => {
      const r = row as {
        scheduled_trip_id?: string | null;
        scheduled_trips?: { status?: string | null } | { status?: string | null }[] | null;
      };
      const tid = r.scheduled_trip_id;
      if (tid == null || tid === '') return true;
      return tripStatusAllowsPendingRequests(nestedScheduledTripStatus(r.scheduled_trips));
    });

    for (const s of (offerRows ?? []) as {
      id: string;
      origin_address: string;
      destination_address: string;
      amount_cents: number;
      created_at: string;
      user_id: string;
      package_size: string;
      current_offer_expires_at: string | null;
      scheduled_trip_id: string | null;
    }[]) {
      const expIso = s.current_offer_expires_at;
      const expiresAt = expIso
        ? new Date(expIso)
        : new Date(new Date(s.created_at).getTime() + 30 * 60 * 1000);
      const offerDeadlineIso = expIso ?? expiresAt.toISOString();
      const { data: prof } = await supabase
        .from('profiles')
        .select('full_name, avatar_url, rating')
        .eq('id', s.user_id)
        .maybeSingle();
      const p = prof as { full_name?: string; avatar_url?: string; rating?: number } | null;
      all.push({
        id: `shipment_offer_${s.id}`,
        kind: 'shipment_offer',
        rawId: s.id,
        scheduledTripId: s.scheduled_trip_id ?? '',
        origin: s.origin_address,
        destination: s.destination_address,
        departureAt: offerDeadlineIso,
        timeLabel: formatTime(offerDeadlineIso),
        priceCents: s.amount_cents,
        userName: p?.full_name ?? 'Cliente',
        userAvatar: p?.avatar_url ?? null,
        userRating: p?.rating != null ? Number(p.rating) : null,
        minutesAgo: minutesAgoFn(s.created_at),
        passengerCount: 0,
        packageSizeLabel: packageSizeLabelDb(s.package_size),
        dependentBagsCount: 0,
        expiresAt,
        shipmentOfferPendingSystem: false,
      });
    }

    for (const s of (preferredWaitRows ?? []) as {
      id: string;
      origin_address: string;
      destination_address: string;
      amount_cents: number;
      created_at: string;
      user_id: string;
      package_size: string;
      current_offer_expires_at: string | null;
      scheduled_trip_id: string | null;
    }[]) {
      if (offerSeen.has(s.id)) continue;
      offerSeen.add(s.id);
      const expIso = s.current_offer_expires_at;
      const expiresAt = expIso
        ? new Date(expIso)
        : new Date(new Date(s.created_at).getTime() + 30 * 60 * 1000);
      const offerDeadlineIso = expIso ?? expiresAt.toISOString();
      const { data: prof } = await supabase
        .from('profiles')
        .select('full_name, avatar_url, rating')
        .eq('id', s.user_id)
        .maybeSingle();
      const p = prof as { full_name?: string; avatar_url?: string; rating?: number } | null;
      all.push({
        id: `shipment_offer_${s.id}`,
        kind: 'shipment_offer',
        rawId: s.id,
        scheduledTripId: s.scheduled_trip_id ?? '',
        origin: s.origin_address,
        destination: s.destination_address,
        departureAt: offerDeadlineIso,
        timeLabel: formatTime(offerDeadlineIso),
        priceCents: s.amount_cents,
        userName: p?.full_name ?? 'Cliente',
        userAvatar: p?.avatar_url ?? null,
        userRating: p?.rating != null ? Number(p.rating) : null,
        minutesAgo: minutesAgoFn(s.created_at),
        passengerCount: 0,
        packageSizeLabel: packageSizeLabelDb(s.package_size),
        dependentBagsCount: 0,
        expiresAt,
        shipmentOfferPendingSystem: true,
      });
    }

    for (const b of filtered) {
      const row = b as {
        id: string; origin_address: string; destination_address: string;
        passenger_count: number; amount_cents: number; created_at: string;
        scheduled_trip_id: string; user_id: string;
        scheduled_trips: { departure_at: string };
      };
      const { data: prof } = await supabase
        .from('profiles').select('full_name, avatar_url, rating').eq('id', row.user_id).maybeSingle();
      const p = prof as { full_name?: string; avatar_url?: string; rating?: number } | null;
      const depAt = row.scheduled_trips?.departure_at;
      const fallbackExp = new Date(new Date(depAt).getTime() - 30 * 60 * 1000);
      const expiresAt = expiresAtFromAssignment(
        assignmentExpiresAt.get(`booking:${row.id}`),
        fallbackExp,
      );

      all.push({
        id: `booking_${row.id}`,
        kind: 'booking',
        rawId: row.id,
        scheduledTripId: row.scheduled_trip_id,
        origin: row.origin_address,
        destination: row.destination_address,
        departureAt: depAt,
        timeLabel: formatTime(depAt),
        priceCents: row.amount_cents,
        userName: p?.full_name ?? 'Passageiro',
        userAvatar: p?.avatar_url ?? null,
        userRating: p?.rating != null ? Number(p.rating) : null,
        minutesAgo: minutesAgoFn(row.created_at),
        passengerCount: row.passenger_count,
        packageSizeLabel: '',
        dependentBagsCount: 0,
        expiresAt,
      });
    }

    // Encomendas sem base na rota deste motorista: aguardam aceite (como passageiros pendentes)
    const { data: myTrips } = await supabase
      .from('scheduled_trips')
      .select('id, departure_at')
      .eq('driver_id', user.id)
      .in('status', ['scheduled', 'active']);
    const tripRows = (myTrips ?? []) as { id: string; departure_at: string }[];
    const tripDeparture = new Map(tripRows.map((t) => [t.id, t.departure_at]));
    const tripIds = tripRows.map((t) => t.id);

    if (tripIds.length > 0) {
      const { data: shipRows } = await supabase
        .from('shipments')
        .select(
          'id, origin_address, destination_address, amount_cents, created_at, user_id, package_size, scheduled_trip_id, client_preferred_driver_id, current_offer_driver_id, driver_offer_index',
        )
        .in('scheduled_trip_id', tripIds)
        .is('driver_id', null)
        .in('status', ['pending_review', 'confirmed'])
        .limit(50);

      for (const s of (shipRows ?? []) as {
        id: string;
        origin_address: string;
        destination_address: string;
        amount_cents: number;
        created_at: string;
        user_id: string;
        package_size: string;
        scheduled_trip_id: string;
        client_preferred_driver_id: string | null;
        current_offer_driver_id: string | null;
        driver_offer_index: number | null;
      }[]) {
        // A oferta dirigida é a fonte canônica para encomendas escolhidas pelo
        // cliente. Sem isso, o mesmo envio aparece também como "encomenda da
        // rota", gerando dois cards e dois botões de aceite.
        if (offerSeen.has(s.id)) continue;
        if (s.current_offer_driver_id || s.client_preferred_driver_id || (s.driver_offer_index ?? -1) >= 0) {
          continue;
        }
        const depAt = tripDeparture.get(s.scheduled_trip_id);
        if (!depAt) continue;
        const { data: prof } = await supabase
          .from('profiles')
          .select('full_name, avatar_url, rating')
          .eq('id', s.user_id)
          .maybeSingle();
        const p = prof as { full_name?: string; avatar_url?: string; rating?: number } | null;
        const fallbackExp = new Date(new Date(depAt).getTime() - 30 * 60 * 1000);
        const expiresAt = expiresAtFromAssignment(
          assignmentExpiresAt.get(`shipment:${s.id}`),
          fallbackExp,
        );
        all.push({
          id: `shipment_${s.id}`,
          kind: 'shipment',
          rawId: s.id,
          scheduledTripId: s.scheduled_trip_id,
          origin: s.origin_address,
          destination: s.destination_address,
          departureAt: depAt,
          timeLabel: formatTime(depAt),
          priceCents: s.amount_cents,
          userName: p?.full_name ?? 'Cliente',
          userAvatar: p?.avatar_url ?? null,
          userRating: p?.rating != null ? Number(p.rating) : null,
          minutesAgo: minutesAgoFn(s.created_at),
          passengerCount: 0,
          packageSizeLabel: packageSizeLabelDb(s.package_size),
          dependentBagsCount: 0,
          expiresAt,
        });
      }

      const { data: depRows } = await supabase
        .from('dependent_shipments')
        .select(
          'id, origin_address, destination_address, amount_cents, created_at, user_id, bags_count, full_name, scheduled_trip_id, status',
        )
        .in('scheduled_trip_id', tripIds)
        .eq('status', 'pending_review')
        .limit(50);

      for (const d of (depRows ?? []) as {
        id: string;
        origin_address: string;
        destination_address: string;
        amount_cents: number;
        created_at: string;
        user_id: string;
        bags_count: number;
        full_name: string;
        scheduled_trip_id: string;
      }[]) {
        const depAt = tripDeparture.get(d.scheduled_trip_id);
        if (!depAt) continue;
        const { data: prof } = await supabase
          .from('profiles')
          .select('full_name, avatar_url, rating')
          .eq('id', d.user_id)
          .maybeSingle();
        const p = prof as { full_name?: string; avatar_url?: string; rating?: number } | null;
        const fallbackExp = new Date(new Date(depAt).getTime() - 30 * 60 * 1000);
        const expiresAt = expiresAtFromAssignment(
          assignmentExpiresAt.get(`dependent_shipment:${d.id}`),
          fallbackExp,
        );
        all.push({
          id: `dependent_${d.id}`,
          kind: 'dependent_shipment',
          rawId: d.id,
          scheduledTripId: d.scheduled_trip_id,
          origin: d.origin_address,
          destination: d.destination_address,
          departureAt: depAt,
          timeLabel: formatTime(depAt),
          priceCents: d.amount_cents,
          userName: p?.full_name ?? 'Cliente',
          userAvatar: p?.avatar_url ?? null,
          userRating: p?.rating != null ? Number(p.rating) : null,
          minutesAgo: minutesAgoFn(d.created_at),
          passengerCount: 1,
          packageSizeLabel: '',
          dependentBagsCount: Math.max(0, Math.floor(Number(d.bags_count ?? 0))),
          expiresAt,
        });
      }
    }

    const deduped = dedupePendingRequests(all);
    deduped.sort((a, b) => a.expiresAt.getTime() - b.expiresAt.getTime());
    setItems(deduped);
    if (!silent) setLoading(false);
  }, []);

  useFocusEffect(useCallback(() => { void load(); }, [load]));

  useEffect(() => {
    let cancelled = false;
    let channel: ReturnType<typeof supabase.channel> | null = null;

    const teardown = () => {
      if (channel) {
        void supabase.removeChannel(channel);
        channel = null;
      }
    };

    const subscribe = async (uid: string) => {
      teardown();
      channel = supabase
        .channel(`pending-requests-${uid}`)
        .on(
          'postgres_changes',
          {
            event: '*',
            schema: 'public',
            table: 'worker_assignments',
            filter: `worker_id=eq.${uid}`,
          },
          () => {
            void load({ silent: true });
          },
        )
        .on(
          'postgres_changes',
          {
            event: '*',
            schema: 'public',
            table: 'scheduled_trips',
            filter: `driver_id=eq.${uid}`,
          },
          () => {
            void load({ silent: true });
          },
        )
        .on(
          'postgres_changes',
          {
            event: '*',
            schema: 'public',
            table: 'shipments',
            filter: `current_offer_driver_id=eq.${uid}`,
          },
          () => {
            void load({ silent: true });
          },
        )
        .on(
          'postgres_changes',
          {
            event: '*',
            schema: 'public',
            table: 'shipments',
            filter: `client_preferred_driver_id=eq.${uid}`,
          },
          () => {
            void load({ silent: true });
          },
        )
        .on(
          'postgres_changes',
          {
            event: '*',
            schema: 'public',
            table: 'dependent_shipments',
          },
          () => {
            void load({ silent: true });
          },
        )
        .subscribe();
    };

    void (async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (cancelled || !user?.id) return;
      await subscribe(user.id);
    })();

    const { data: { subscription: authSub } } = supabase.auth.onAuthStateChange((_event, session) => {
      void (async () => {
        teardown();
        if (!session?.user?.id) return;
        await subscribe(session.user.id);
        void load({ silent: true });
      })();
    });

    return () => {
      cancelled = true;
      teardown();
      authSub.unsubscribe();
    };
  }, [load]);

  const handleAction = async (item: RequestItem, accept: boolean) => {
    if (!userId) return;
    setActioning(item.id);
    const now = new Date().toISOString();
    try {
      if (item.kind === 'shipment_offer') {
        if (accept) {
          if (item.shipmentOfferPendingSystem) {
            const { data: sess } = await supabase.auth.getSession();
            if (!sess?.session) {
              showAlert('Encomenda', 'Sessão expirada. Faça login de novo e tente aceitar.');
              await load();
              return;
            }
            await supabase.auth.refreshSession();
            const { data: beginData, error: beginErr } = await supabase.rpc('shipment_begin_driver_offering', {
              p_shipment_id: item.rawId,
            });
            const begin = beginData as {
              ok?: boolean;
              error?: string;
              cancelled?: boolean;
              skipped?: boolean;
              reason?: string;
              queue_length?: number;
            } | null;
            if (beginErr) {
              showAlert('Encomenda', getUserErrorMessage(beginErr, 'Não foi possível liberar a solicitação. Tente de novo.'));
              await load();
              return;
            }
            if (begin && begin.ok === false && begin.error) {
              showAlert(
                'Encomenda',
                begin.error === 'forbidden'
                  ? 'Sem permissão para liberar este envio. Confirme que você é o motorista escolhido pelo cliente. Se sim, atualize o Supabase com as migrações mais recentes do repositório (função shipment_begin_driver_offering) ou fale com o suporte.'
                  : `Não foi possível liberar a solicitação (${begin.error}).`,
              );
              await load();
              return;
            }
            if (begin?.skipped === true && begin.reason === 'hub_preparer_first') {
              showAlert(
                'Encomenda',
                'Este envio está configurado só para preparador (sem motorista de rota). Contacte o suporte.',
              );
              await load();
              return;
            }
            if (begin?.cancelled) {
              showAlert(
                'Envio cancelado',
                'Não há viagem sua nesta rota com vaga para vincular o envio. O pedido foi cancelado.',
              );
              await load();
              return;
            }
          }
          const { data: accData, error: accErr } = await supabase.rpc('shipment_driver_accept_offer', {
            p_shipment_id: item.rawId,
          });
          const acc = accData as { ok?: boolean; error?: string; scheduled_trip_id?: string } | null;
          if (accErr || acc?.ok !== true) {
            showAlert(
              'Encomenda',
              acc?.error === 'offer_expired'
                ? 'Esta oferta expirou.'
                : acc?.error === 'no_matching_trip'
                  ? 'Não encontramos uma viagem sua nesta rota para vincular o envio.'
                  : acc?.error === 'not_your_offer'
                    ? 'Esta oferta ainda não está ativa para você. Atualize a lista em instantes.'
                    : 'Não foi possível aceitar. Tente novamente.',
            );
            await load();
            return;
          }
          setItems((prev) => prev.filter((i) => i.id !== item.id));
          const conv = await createOrGetShipmentConversation(item.rawId, userId);
          if (conv.error) showAlert('Chat', conv.error);
          await load();
          return;
        }
        if (item.shipmentOfferPendingSystem) {
          showAlert(
            'Encomenda',
            'Ainda não há oferta ativa para recusar. Quando o sistema liberar, você poderá aceitar ou recusar.',
          );
          await load();
          return;
        }
        const { data: passData, error: passErr } = await supabase.rpc('shipment_driver_pass_offer', {
          p_shipment_id: item.rawId,
        });
        if (passErr || (passData as { ok?: boolean } | null)?.ok !== true) {
          showAlert('Encomenda', 'Não foi possível recusar. Tente novamente.');
          await load();
          return;
        }
        await load();
        return;
      } else if (item.kind === 'shipment') {
        const { data: shipRows, error: shipErr } = await supabase
          .from('shipments')
          .update(
            accept
              ? ({
                  driver_id: userId,
                  driver_accepted_at: now,
                  status: 'confirmed',
                } as never)
              : ({ status: 'cancelled' } as never),
          )
          .eq('id', item.rawId)
          .select('id');
        if (shipErr || !shipRows?.length) {
          showAlert(
            'Encomenda',
            shipErr
              ? getUserErrorMessage(shipErr, 'Não foi possível atualizar o envio.')
              : 'Nenhuma linha foi atualizada. Verifique permissões ou se o pedido ainda está pendente.',
          );
          await load();
          return;
        }
      } else if (item.kind === 'dependent_shipment') {
        const { data: depRows, error: depErr } = await supabase
          .from('dependent_shipments')
          .update((accept ? { status: 'confirmed' } : { status: 'cancelled' }) as never)
          .eq('id', item.rawId)
          .select('id');
        if (depErr || !depRows?.length) {
          showAlert(
            'Dependente',
            depErr
              ? getUserErrorMessage(depErr, 'Não foi possível atualizar o pedido.')
              : 'Nenhuma linha foi atualizada. Verifique se o pedido ainda está pendente.',
          );
          await load();
          return;
        }
        const { data: waDep } = await supabase
          .from('worker_assignments')
          .select('id')
          .eq('worker_id', userId)
          .eq('entity_type', 'dependent_shipment')
          .eq('entity_id', item.rawId)
          .maybeSingle();
        if (waDep) {
          const { error: waDepErr } = await supabase
            .from('worker_assignments')
            .update(
              accept
                ? ({ status: 'accepted' } as never)
                : ({
                    status: 'rejected',
                    rejected_at: now,
                    rejection_reason: 'Recusado pelo motorista',
                  } as never),
            )
            .eq('id', (waDep as { id: string }).id);
          if (waDepErr) {
            showAlert(
              'Dependente',
              getUserErrorMessage(waDepErr, 'Pedido atualizado, mas falhou ao registrar na fila de motorista.'),
            );
            await load();
            return;
          }
        }
      } else {
        const { data: rpcData, error: rpcErr } = await supabase.rpc('motorista_respond_booking_request', {
          p_booking_id: item.rawId,
          p_accept: accept,
        });
        const rpc = rpcData as { ok?: boolean; error?: string; detail?: string; message?: string } | null;
        if (rpcErr) {
          showAlert('Reserva', getUserErrorMessage(rpcErr, 'Não foi possível atualizar a reserva.'));
          await load();
          return;
        }
        if (!rpc || rpc.ok !== true) {
          const code = rpc?.error ?? '';
          const msg =
            code === 'not_your_trip'
              ? 'Esta reserva não pertence à sua viagem.'
              : code === 'invalid_status'
                ? 'Esta reserva já foi processada ou não está mais pendente.'
                : code === 'not_found'
                  ? 'Reserva não encontrada.'
                  : code === 'unauthorized'
                    ? 'Faça login novamente.'
                    : code === 'server_error' && rpc?.message
                      ? String(rpc.message)
                      : 'Não foi possível atualizar a reserva.';
          showAlert('Reserva', msg);
          await load();
          return;
        }
      }

      if (accept) {
        const conv =
          item.kind === 'booking'
            ? await createOrGetBookingConversation(item.rawId, userId)
            : item.kind === 'shipment'
              ? await createOrGetShipmentConversation(item.rawId, userId)
              : item.kind === 'dependent_shipment'
                ? { conversationId: null as string | null, error: null as string | null }
                : { conversationId: null as string | null, error: null as string | null };
        if (conv.error) {
          showAlert('Chat', conv.error);
        }
      }
      await load();
    } finally {
      setActioning(null);
    }
  };

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <StatusBar style="dark" />

      <View style={styles.header}>
        <TouchableOpacity style={styles.iconBtn} onPress={() => navigation.goBack()} activeOpacity={0.7}>
          <MaterialIcons name="close" size={22} color="#111827" />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Solicitações pendentes</Text>
        <View style={{ width: 40 }} />
      </View>

      {loading ? (
        <View style={styles.center}><ActivityIndicator size="large" color="#111827" /></View>
      ) : items.length === 0 ? (
        <View style={styles.center}>
          <MaterialIcons name="check-circle-outline" size={48} color="#D1D5DB" />
          <Text style={styles.emptyText}>Nenhuma solicitação pendente.</Text>
        </View>
      ) : (
        <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
          {items.map((item) => {
            const isActioning = actioning === item.id;
            const countdown = formatCountdown(item.expiresAt);
            const isShipmentKind = item.kind === 'shipment' || item.kind === 'shipment_offer';
            const isDependentKind = item.kind === 'dependent_shipment';

            return (
              <View key={item.id} style={styles.card}>
                {/* Header: badge Viagem + countdown */}
                <View style={styles.badgeRow}>
                  <View
                    style={
                      isDependentKind
                        ? styles.badgeDependent
                        : isShipmentKind
                          ? styles.badgeShipment
                          : styles.badge
                    }
                  >
                    <MaterialIcons
                      name={
                        isDependentKind
                          ? 'child-care'
                          : isShipmentKind
                            ? 'inventory-2'
                            : 'directions-car'
                      }
                      size={13}
                      color={isDependentKind ? '#6D28D9' : isShipmentKind ? '#B45309' : '#1D4ED8'}
                    />
                    <Text
                      style={
                        isDependentKind
                          ? styles.badgeDependentText
                          : isShipmentKind
                            ? styles.badgeShipmentText
                            : styles.badgeText
                      }
                    >
                      {isDependentKind
                        ? 'Dependente'
                        : isShipmentKind
                          ? item.kind === 'shipment_offer'
                            ? item.shipmentOfferPendingSystem
                              ? 'Encomenda · aguardando'
                              : 'Encomenda · convite'
                            : 'Encomenda'
                          : 'Viagem'}
                    </Text>
                  </View>
                  {countdown ? (
                    <View style={[styles.countdownBadge, countdown.urgent && styles.countdownBadgeUrgent]}>
                      <MaterialIcons name="timer" size={13} color={countdown.urgent ? '#fff' : '#92400E'} />
                      <Text style={[styles.countdownText, countdown.urgent && styles.countdownTextUrgent]}>
                        {countdown.label}
                      </Text>
                    </View>
                  ) : (
                    <View style={styles.expiredBadge}>
                      <Text style={styles.expiredText}>Solicitação expirada</Text>
                    </View>
                  )}
                </View>

                {/* Rota */}
                <View style={styles.routeRow}>
                  <View style={styles.routeDot} />
                  <Text style={styles.routeOrigin} numberOfLines={1}>{shortAddr(item.origin)}</Text>
                </View>
                <View style={styles.routeConnectorRow}>
                  <View style={styles.routeConnector} />
                </View>
                <View style={styles.routeRow}>
                  <View style={[styles.routeDot, styles.routeDotDest]} />
                  <Text style={styles.routeDest} numberOfLines={1}>{shortAddr(item.destination)}</Text>
                </View>

                {/* Horário + passageiros + preço */}
                <View style={styles.metaRow}>
                  <View style={styles.metaItem}>
                    <MaterialIcons name="access-time" size={14} color="#6B7280" />
                    <Text style={styles.metaText}>{item.timeLabel}</Text>
                  </View>
                  <View style={styles.metaItem}>
                    <MaterialIcons
                      name={
                        isDependentKind
                          ? 'child-care'
                          : isShipmentKind
                            ? 'local-shipping'
                            : 'people'
                      }
                      size={14}
                      color="#6B7280"
                    />
                    <Text style={styles.metaText}>
                      {isDependentKind
                        ? `1 dependente${
                            item.dependentBagsCount > 0
                              ? ` · ${item.dependentBagsCount} ${item.dependentBagsCount === 1 ? 'mala' : 'malas'}`
                              : ''
                          }`
                        : isShipmentKind
                          ? `Pacote ${item.packageSizeLabel}`
                          : `${item.passengerCount} ${item.passengerCount === 1 ? 'passageiro' : 'passageiros'}`}
                    </Text>
                  </View>
                  <Text style={styles.price}>{formatCents(item.priceCents)}</Text>
                </View>

                <View style={styles.divider} />

                {/* Usuário */}
                <View style={styles.userRow}>
                  {item.userAvatar ? (
                    <Image
                      source={{ uri: storageUrl('avatars', item.userAvatar) ?? undefined }}
                      style={styles.avatar}
                    />
                  ) : (
                    <View style={styles.avatarPlaceholder}>
                      <MaterialIcons name="person" size={20} color="#9CA3AF" />
                    </View>
                  )}
                  <View style={styles.userInfo}>
                    <Text style={styles.userName}>{item.userName}</Text>
                    <View style={styles.ratingRow}>
                      <MaterialIcons name="star" size={13} color={GOLD} />
                      <Text style={styles.ratingText}>
                        {item.userRating != null ? item.userRating.toFixed(1) : '—'}
                      </Text>
                      <Text style={styles.timeAgo}> · há {item.minutesAgo}min</Text>
                    </View>
                  </View>
                </View>

                {/* Botões */}
                <View style={styles.btnRow}>
                  <TouchableOpacity
                    style={styles.btnRecusar}
                    onPress={() => handleAction(item, false)}
                    disabled={isActioning || !countdown}
                    activeOpacity={0.75}
                  >
                    <Text style={styles.btnRecusarText}>Recusar</Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={[styles.btnAceitar, (isActioning || !countdown) && { opacity: 0.5 }]}
                    onPress={() => handleAction(item, true)}
                    disabled={isActioning || !countdown}
                    activeOpacity={0.85}
                  >
                    {isActioning
                      ? <ActivityIndicator size="small" color="#fff" />
                      : <Text style={styles.btnAceitarText}>Aceitar</Text>
                    }
                  </TouchableOpacity>
                </View>
              </View>
            );
          })}
        </ScrollView>
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#FFFFFF' },
  center: { flex: 1, justifyContent: 'center', alignItems: 'center', gap: 12 },
  emptyText: { fontSize: 15, color: '#9CA3AF', marginTop: 8 },
  header: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: 16, paddingTop: 12, paddingBottom: 12,
  },
  iconBtn: {
    width: 40, height: 40, borderRadius: 20,
    backgroundColor: '#F3F4F6', alignItems: 'center', justifyContent: 'center',
  },
  headerTitle: { fontSize: 17, fontWeight: '700', color: '#111827' },
  scroll: { paddingHorizontal: 16, paddingBottom: 40, gap: 14 },

  // Card
  card: { borderWidth: 1, borderColor: '#E5E7EB', borderRadius: 16, padding: 16 },

  // Badge row
  badgeRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 },
  badge: {
    flexDirection: 'row', alignItems: 'center', gap: 5,
    backgroundColor: '#DBEAFE', borderRadius: 20,
    paddingHorizontal: 10, paddingVertical: 5,
  },
  badgeText: { fontSize: 13, fontWeight: '600', color: '#1D4ED8' },
  badgeShipment: {
    flexDirection: 'row', alignItems: 'center', gap: 5,
    backgroundColor: '#FEF3C7', borderRadius: 20,
    paddingHorizontal: 10, paddingVertical: 5,
  },
  badgeShipmentText: { fontSize: 13, fontWeight: '600', color: '#B45309' },
  badgeDependent: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    backgroundColor: '#EDE9FE',
    borderRadius: 20,
    paddingHorizontal: 10,
    paddingVertical: 5,
  },
  badgeDependentText: { fontSize: 13, fontWeight: '600', color: '#6D28D9' },
  countdownBadge: {
    flexDirection: 'row', alignItems: 'center', gap: 4,
    backgroundColor: '#FEF3C7', borderRadius: 20,
    paddingHorizontal: 10, paddingVertical: 5,
  },
  countdownBadgeUrgent: { backgroundColor: '#EF4444' },
  countdownText: { fontSize: 13, fontWeight: '700', color: '#92400E' },
  countdownTextUrgent: { color: '#FFFFFF' },
  expiredBadge: {
    backgroundColor: '#F3F4F6', borderRadius: 20,
    paddingHorizontal: 10, paddingVertical: 5,
  },
  expiredText: { fontSize: 13, fontWeight: '600', color: '#9CA3AF' },

  // Rota vertical
  routeRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  routeDot: {
    width: 10, height: 10, borderRadius: 5,
    backgroundColor: '#111827', flexShrink: 0,
  },
  routeDotDest: { borderRadius: 2 },
  routeConnectorRow: { paddingLeft: 4, paddingVertical: 3 },
  routeConnector: { width: 2, height: 14, backgroundColor: '#D1D5DB', marginLeft: 0 },
  routeOrigin: { fontSize: 15, fontWeight: '700', color: '#111827', flex: 1 },
  routeDest: { fontSize: 15, fontWeight: '600', color: '#374151', flex: 1 },

  // Meta
  metaRow: {
    flexDirection: 'row', alignItems: 'center', gap: 14,
    marginTop: 12, marginBottom: 14,
  },
  metaItem: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  metaText: { fontSize: 13, color: '#6B7280' },
  price: { marginLeft: 'auto' as any, fontSize: 15, fontWeight: '700', color: '#111827' },

  divider: { height: 1, backgroundColor: '#F3F4F6', marginBottom: 14 },

  // User
  userRow: { flexDirection: 'row', alignItems: 'center', gap: 12, marginBottom: 16 },
  avatar: { width: 44, height: 44, borderRadius: 22, backgroundColor: '#F3F4F6' },
  avatarPlaceholder: {
    width: 44, height: 44, borderRadius: 22, backgroundColor: '#F3F4F6',
    alignItems: 'center', justifyContent: 'center',
  },
  userInfo: { flex: 1 },
  userName: { fontSize: 15, fontWeight: '700', color: '#111827', marginBottom: 3 },
  ratingRow: { flexDirection: 'row', alignItems: 'center' },
  ratingText: { fontSize: 13, fontWeight: '600', color: '#374151' },
  timeAgo: { fontSize: 13, color: '#9CA3AF' },

  // Botões
  btnRow: { flexDirection: 'row', gap: 10 },
  btnRecusar: {
    flex: 1, backgroundColor: '#F3F4F6', borderRadius: 12,
    paddingVertical: 14, alignItems: 'center',
  },
  btnRecusarText: { color: '#EF4444', fontSize: 15, fontWeight: '600' },
  btnAceitar: {
    flex: 2, backgroundColor: '#111827', borderRadius: 12,
    paddingVertical: 14, alignItems: 'center',
  },
  btnAceitarText: { color: '#FFFFFF', fontSize: 15, fontWeight: '700' },
});
