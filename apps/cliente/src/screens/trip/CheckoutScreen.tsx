import { useMemo, useState, useEffect, useCallback, useRef } from 'react';
import {
  View,
  TouchableOpacity,
  StyleSheet,
  ScrollView,
  Platform,
  Image,
  Alert,
  Clipboard,
  Linking,
} from 'react-native';
import { Text } from '../../components/Text';
import { MaterialIcons } from '@expo/vector-icons';
import { StatusBar } from 'expo-status-bar';
import { SafeAreaView } from 'react-native-safe-area-context';
import {
  MapboxMap,
  MapboxMarker,
  MapboxPolyline,
  isValidTripCoordinate,
  sanitizeMapRegion,
} from '../../components/mapbox';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import type {
  TripStackParamList,
  TripDriverParam,
  PaymentConfirmedBookingParam,
  TripLiveDriverDisplay,
  TripPassengerParam,
} from '../../navigation/types';
import { getRoutePolyline, type RoutePoint } from '../../lib/route';
import { supabase } from '../../lib/supabase';
import { useCurrentLocation } from '../../contexts/CurrentLocationContext';
import { useAppAlert } from '../../contexts/AppAlertContext';
import { getUserErrorMessage } from '../../utils/errorMessage';
import { describeInvokeFailure } from '../../utils/edgeFunctionResponse';
import { formatVehicleDescription, formatDriverRatingLabel, formatTripFareBrl } from '../../lib/tripDriverDisplay';
import {
  fetchResolvedPriceCentsForScheduledTrip,
  type TripPriceBasis,
} from '../../lib/clientScheduledTrips';
import {
  MAPBOX_DESTINATION_MARKER_COLOR,
  MAPBOX_ORIGIN_MARKER_COLOR,
  computeOrderPricing,
  PricingDenominatorOverflowError,
  normalizeApplyPromotion,
  formatPricingBreakdown,
  type PricingResult,
} from '@take-me/shared';
import { snapshotFromPricingResult } from '../../lib/orderPricingSnapshot';
import { PaymentMethodSection, type PaymentMethodType, type CardPaymentConfirmParams } from '../../components/PaymentMethodSection';
import { calendarDayKeySaoPaulo, getDuplicateDestinationSameDayMessage } from '../../lib/sameDestinationSameDayGuard';
import { ensureAccessTokenForStripeFunctions } from '../../lib/ensureStripeCustomerForPayment';
import { waitForShipmentStripePaymentIntentId } from '../../lib/waitForShipmentStripePaymentIntentId';
import { displayCpf } from '../../utils/formatCpf';
import { bookingTotalPassengers, maxBagsForTrip } from '../../lib/tripCapacityLimits';
import { fetchDriverStripeChargesEnabled } from '../../lib/driverStripeConnect';

const supabasePublicUrl = process.env.EXPO_PUBLIC_SUPABASE_URL ?? '';

/** Titular (perfil) + extras; `passenger_count` = tamanho total. */
async function buildBookingPassengersPayload(
  userId: string,
  extras: TripPassengerParam[],
): Promise<{ passenger_data: { name: string; cpf: string; bags: string }[]; passenger_count: number }> {
  const { data: prof } = await supabase
    .from('profiles')
    .select('full_name, cpf')
    .eq('id', userId)
    .maybeSingle();
  const primaryName = String(prof?.full_name ?? '').trim() || 'Passageiro principal';
  const primaryCpf = String(prof?.cpf ?? '').trim();
  const passenger_data = [
    { name: primaryName, cpf: primaryCpf, bags: '' },
    ...extras.map((p) => ({
      name: p.name ?? '',
      cpf: p.cpf ?? '',
      bags: p.bags ?? '',
    })),
  ];
  return { passenger_data, passenger_count: passenger_data.length };
}

function resolveAvatarUri(avatarUrl: string | null | undefined): string | null {
  if (!avatarUrl?.trim()) return null;
  return avatarUrl.startsWith('http') ? avatarUrl : `${supabasePublicUrl}/storage/v1/object/public/avatars/${avatarUrl}`;
}

function getInitials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return '?';
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

type Props = NativeStackScreenProps<TripStackParamList, 'Checkout'>;

const DEFAULT_DRIVER: TripDriverParam = {
  id: '0',
  driver_id: '',
  name: 'Carlos Silva',
  rating: 4.8,
  badge: 'Take Me',
  departure: '14:00',
  arrival: '16:30',
  seats: 3,
  bags: 3,
  vehicle_model: null,
  vehicle_year: null,
  vehicle_plate: null,
  avatar_url: null,
};

const COLORS = {
  background: '#FFFFFF',
  black: '#0d0d0d',
  neutral300: '#f1f1f1',
  neutral400: '#e2e2e2',
  neutral700: '#767676',
  orange: '#EA580C',
};

const DEFAULT_REGION = {
  latitude: -7.3289,
  longitude: -35.3328,
  latitudeDelta: 0.02,
  longitudeDelta: 0.02,
};

export function CheckoutScreen({ navigation, route }: Props) {
  const { currentPlace } = useCurrentLocation();
  const { showAlert } = useAppAlert();

  const driver = route.params?.driver ?? DEFAULT_DRIVER;
  const origin = route.params?.origin;
  const destination = route.params?.destination;
  const passengersParam = route.params?.passengers ?? [];
  const totalBookingPassengers = bookingTotalPassengers(passengersParam.length);
  const maxBagsForBooking = maxBagsForTrip(totalBookingPassengers, driver.bags);
  const bagsCount =
    route.params?.bags_count !== undefined
      ? route.params.bags_count
      : Math.min(1, maxBagsForBooking);
  const scheduledTripId = route.params?.scheduled_trip_id;
  const immediateTrip = route.params?.immediateTrip === true;

  const [routeCoords, setRouteCoords] = useState<RoutePoint[] | null>(null);
  const [selectedPaymentMethod, setSelectedPaymentMethod] = useState<PaymentMethodType | null>('credito');
  const [paymentSubmitting, setPaymentSubmitting] = useState(false);
  /** Stripe Connect com `charges_enabled` — só então cartão/Pix ficam disponíveis. */
  const [connectChargesEnabled, setConnectChargesEnabled] = useState<boolean | null>(null);
  const [connectStatusLoading, setConnectStatusLoading] = useState(() => Boolean(driver.driver_id?.trim()));
  const connectFetchGen = useRef(0);
  /** Preço alinhado a `scheduled_trips` + `worker_routes` (evita fallback fictício 6400). */
  const [resolvedFareCents, setResolvedFareCents] = useState<number | null>(() =>
    route.params?.scheduled_trip_id ? null : route.params?.driver?.amount_cents ?? null
  );
  /** `null` = ainda não definido (viagem agendada antes do fetch). */
  const [resolvedPricingBasis, setResolvedPricingBasis] = useState<TripPriceBasis | null>(() =>
    route.params?.scheduled_trip_id ? null : 'flat_trip'
  );
  const [fareLoading, setFareLoading] = useState(() => Boolean(route.params?.scheduled_trip_id));
  /**
   * Preview do breakdown gross-up (PDF):
   *   Base + Adicionais + Ganho/Desconto promo + Taxa admin = Total
   * O `totalCents` é exatamente o que vai no PaymentIntent.
   */
  const [pricingPreview, setPricingPreview] = useState<PricingResult | null>(null);
  const [pricingError, setPricingError] = useState<string | null>(null);
  const [appliedPromotionId, setAppliedPromotionId] = useState<string | null>(null);
  const [appliedPromoWorkerRouteId, setAppliedPromoWorkerRouteId] = useState<string | null>(null);
  const [workerRouteId, setWorkerRouteId] = useState<string | null>(null);
  const [pricingRouteId, setPricingRouteId] = useState<string | null>(null);
  /** Com viagem agendada, só confia no valor da API (evita `driver.amount_cents` da lista = 1 pax com taxa). */
  const routePriceCents =
    resolvedFareCents ?? (!scheduledTripId ? driver.amount_cents ?? null : null);
  const passengerCountForPricing = Math.max(1, totalBookingPassengers);
  const orderBaseCents = (() => {
    if (scheduledTripId && fareLoading) return null;
    if (routePriceCents == null || routePriceCents < 1) return null;
    if (resolvedPricingBasis === 'flat_trip') return routePriceCents;
    if (resolvedPricingBasis === 'per_person') {
      return Math.floor(routePriceCents * passengerCountForPricing);
    }
    if (scheduledTripId) {
      return Math.floor(routePriceCents * passengerCountForPricing);
    }
    return routePriceCents;
  })();
  const needsFullPricingPreview =
    Boolean(scheduledTripId) &&
    resolvedPricingBasis === 'per_person' &&
    passengerCountForPricing > 1;
  const displayChargeCents =
    pricingPreview?.totalCents ??
    (needsFullPricingPreview && !pricingPreview && !pricingError ? null : orderBaseCents);
  const fareFormatted =
    displayChargeCents != null
      ? formatTripFareBrl(displayChargeCents)
      : scheduledTripId
        ? 'Carregando preço…'
        : '—';
  const [tripDateLabel, setTripDateLabel] = useState<string | null>(null);
  const [driverAvatarFailed, setDriverAvatarFailed] = useState(false);
  /** Titular da reserva (lista completa na UI = você + extras). */
  const [primaryPassenger, setPrimaryPassenger] = useState<{ name: string; cpf: string } | null>(null);

  const allowedPaymentMethods = useMemo((): PaymentMethodType[] => {
    if (connectStatusLoading) return ['dinheiro'];
    if (connectChargesEnabled === true) return ['credito', 'debito', 'pix', 'dinheiro'];
    return ['dinheiro'];
  }, [connectChargesEnabled, connectStatusLoading]);

  useEffect(() => {
    const wid = driver.driver_id?.trim();
    if (!wid) {
      setConnectChargesEnabled(false);
      setConnectStatusLoading(false);
      return;
    }
    const gen = ++connectFetchGen.current;
    setConnectStatusLoading(true);
    void fetchDriverStripeChargesEnabled(wid).then((ok) => {
      if (connectFetchGen.current !== gen) return;
      setConnectChargesEnabled(ok);
      setConnectStatusLoading(false);
    });
  }, [driver.driver_id]);

  useEffect(() => {
    if (selectedPaymentMethod == null) return;
    if (!allowedPaymentMethods.includes(selectedPaymentMethod)) {
      setSelectedPaymentMethod(allowedPaymentMethods[0] ?? 'dinheiro');
    }
  }, [allowedPaymentMethods, selectedPaymentMethod]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user || cancelled) return;
      const { data } = await supabase.from('profiles').select('full_name, cpf').eq('id', user.id).maybeSingle();
      if (cancelled) return;
      setPrimaryPassenger({
        name: String(data?.full_name ?? '').trim() || 'Passageiro principal',
        cpf: String(data?.cpf ?? '').trim(),
      });
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    setDriverAvatarFailed(false);
  }, [driver.avatar_url, driver.name]);

  useEffect(() => {
    if (!scheduledTripId) {
      setFareLoading(false);
      setResolvedFareCents(driver.amount_cents ?? null);
      setResolvedPricingBasis('flat_trip');
      return;
    }
    let cancelled = false;
    setFareLoading(true);
    fetchResolvedPriceCentsForScheduledTrip(scheduledTripId).then(({ cents, basis, error }) => {
      if (cancelled) return;
      setFareLoading(false);
      if (error) {
        setResolvedFareCents(driver.amount_cents ?? null);
        setResolvedPricingBasis('flat_trip');
        return;
      }
      setResolvedFareCents(cents ?? driver.amount_cents ?? null);
      setResolvedPricingBasis(basis ?? (cents != null ? 'per_person' : 'flat_trip'));
    });
    return () => {
      cancelled = true;
    };
  }, [scheduledTripId, driver.amount_cents]);

  useEffect(() => {
    if (!scheduledTripId) {
      setWorkerRouteId(null);
      setPricingRouteId(null);
      return;
    }
    let cancelled = false;
    (async () => {
      const { data } = await supabase
        .from('scheduled_trips')
        .select('route_id, worker_routes:route_id(pricing_route_id)')
        .eq('id', scheduledTripId)
        .maybeSingle();
      if (!cancelled) {
        const rid = (data?.route_id as string | null | undefined) ?? null;
        const wr = (data as { worker_routes?: { pricing_route_id?: string | null } | null } | null)
          ?.worker_routes;
        const prid = wr?.pricing_route_id ?? null;
        setWorkerRouteId(rid);
        setPricingRouteId(prid);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [scheduledTripId]);

  useEffect(() => {
    if (orderBaseCents == null || orderBaseCents < 1) {
      setPricingPreview(null);
      setPricingError(null);
      setAppliedPromotionId(null);
      setAppliedPromoWorkerRouteId(null);
      return;
    }
    let cancelled = false;
    void (async () => {
      const { data: { user } } = await supabase.auth.getUser();

      let adminPct = 15;
      try {
        const { data: setting } = await supabase
          .from('platform_settings')
          .select('value')
          .eq('key', 'default_admin_pct')
          .maybeSingle();
        const raw = setting?.value as { percentage?: number; value?: number } | null;
        const n = Number(raw?.percentage ?? raw?.value);
        if (Number.isFinite(n) && n >= 0) adminPct = n;
      } catch {
        /* usa fallback 15 */
      }

      let gainPct = 0;
      let discountPct = 0;
      let promotionId: string | null = null;
      let promoWorkerRouteId: string | null = null;
      if (user) {
        try {
          const payload: Record<string, unknown> = {
            p_order_type: 'bookings',
            p_user_id: user.id,
            p_amount_cents: orderBaseCents,
          };
          if (workerRouteId) payload.p_worker_route_id = workerRouteId;
          if (pricingRouteId) payload.p_pricing_route_id = pricingRouteId;
          const { data: promoRows } = await supabase.rpc('apply_active_promotion', payload);
          const row = Array.isArray(promoRows) ? promoRows[0] : promoRows;
          const applied = normalizeApplyPromotion(row as any);
          gainPct = applied.gainPct;
          discountPct = applied.discountPct;
          promotionId = applied.promotionId;
          promoWorkerRouteId = applied.promoWorkerRouteId;
        } catch {
          /* promo indisponível */
        }
      }

      try {
        const preview = computeOrderPricing({
          baseCents: orderBaseCents,
          surchargesCents: 0,
          adminPct,
          gainPct,
          discountPct,
        });
        if (!cancelled) {
          setPricingPreview(preview);
          setPricingError(null);
          setAppliedPromotionId(promotionId);
          setAppliedPromoWorkerRouteId(promoWorkerRouteId);
        }
      } catch (err) {
        if (!cancelled) {
          if (err instanceof PricingDenominatorOverflowError) {
            setPricingError('Configuração de taxas inválida para esta rota. Tente outra opção.');
          } else {
            setPricingError('Não foi possível calcular o preço agora.');
          }
          setPricingPreview(null);
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [orderBaseCents, workerRouteId, pricingRouteId]);

  useEffect(() => {
    if (!scheduledTripId) {
      setTripDateLabel(immediateTrip ? 'Hoje' : null);
      return;
    }
    let cancelled = false;
    supabase
      .from('scheduled_trips')
      .select('departure_at')
      .eq('id', scheduledTripId)
      .single()
      .then(({ data, error }) => {
        if (error || cancelled || !data?.departure_at) {
          if (!cancelled) setTripDateLabel(immediateTrip ? 'Hoje' : null);
          return;
        }
        const d = new Date(data.departure_at);
        setTripDateLabel(d.toLocaleDateString('pt-BR', { day: 'numeric', month: 'long', year: 'numeric' }));
      });
    return () => { cancelled = true; };
  }, [scheduledTripId, immediateTrip]);

  useEffect(() => {
    if (!origin || !destination) {
      setRouteCoords(null);
      return;
    }
    let cancelled = false;
    getRoutePolyline(origin, destination).then((coords) => {
      if (!cancelled) setRouteCoords(coords?.length ? coords : null);
    });
    return () => { cancelled = true; };
  }, [origin?.latitude, origin?.longitude, destination?.latitude, destination?.longitude]);

  const handleConfirmPayment = useCallback(
    async (params: CardPaymentConfirmParams) => {
      if (!origin || !destination) return;
      if (!scheduledTripId) {
        showAlert(
          'Não foi possível concluir',
          'Identificação da viagem em falta. Volte e escolha novamente uma opção de motorista.'
        );
        return;
      }
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) {
        showAlert('Sessão', 'Faça login para concluir o pagamento.');
        return;
      }
      let depIsoForGuard = route.params?.scheduledTripDepartureAt ?? null;
      if (!depIsoForGuard && scheduledTripId) {
        const { data: stRow } = await supabase
          .from('scheduled_trips')
          .select('departure_at')
          .eq('id', scheduledTripId)
          .maybeSingle();
        depIsoForGuard = (stRow?.departure_at as string | undefined) ?? null;
      }
      if (depIsoForGuard) {
        // Defesa: motorista tem janela de 30min antes da partida para aceitar
        // (alinha com PendingRequestsScreen). Reservar abaixo disso vira oferta expirada na hora.
        const minutesUntilDeparture = (new Date(depIsoForGuard).getTime() - Date.now()) / 60000;
        if (minutesUntilDeparture < 30) {
          showAlert(
            'Viagem muito próxima',
            'Esta viagem sai em menos de 30 minutos. Para dar tempo do motorista aceitar, escolha uma viagem com pelo menos 30 minutos de antecedência.',
          );
          return;
        }
        const dupMsg = await getDuplicateDestinationSameDayMessage({
          userId: user.id,
          destLat: destination.latitude,
          destLng: destination.longitude,
          dayKey: calendarDayKeySaoPaulo(depIsoForGuard),
          currentScheduledTripId: scheduledTripId ?? null,
        });
        if (dupMsg) {
          showAlert('Limite', dupMsg);
          return;
        }
      }
      setPaymentSubmitting(true);
      try {
        if (!allowedPaymentMethods.includes(params.method)) {
          showAlert(
            'Método de pagamento',
            'Este método não está disponível para esta viagem. Escolha outra opção ou volte mais tarde.',
          );
          return;
        }

        const { cents: dbCents, basis: dbBasis, error: priceErr } =
          await fetchResolvedPriceCentsForScheduledTrip(scheduledTripId);
        if (priceErr) {
          showAlert('Preço', priceErr);
          return;
        }
        const resolvedUnitCents = dbCents ?? driver.amount_cents ?? null;
        if (resolvedUnitCents == null || resolvedUnitCents < 0) {
          showAlert(
            'Preço',
            'Não foi possível determinar o valor desta viagem. Verifique se a rota tem preço (worker_routes) ou se a viagem está cadastrada corretamente.'
          );
          return;
        }
        const { passenger_data, passenger_count } = await buildBookingPassengersPayload(user.id, passengersParam);
        const payBasis: TripPriceBasis = dbBasis ?? (dbCents != null ? 'per_person' : 'flat_trip');
        const finalOrderBaseCents =
          payBasis === 'per_person'
            ? Math.floor(resolvedUnitCents * passenger_count)
            : Math.floor(resolvedUnitCents);
        if (finalOrderBaseCents < 1) {
          showAlert('Preço', 'Não foi possível determinar o valor desta viagem.');
          return;
        }

        if (scheduledTripId) {
          const { data: tripCap } = await supabase
            .from('scheduled_trips')
            .select('seats_available')
            .eq('id', scheduledTripId)
            .maybeSingle();
          const avail = Math.floor(Number((tripCap as { seats_available?: number } | null)?.seats_available ?? 0));
          if (Number.isFinite(avail) && passenger_count > avail) {
            showAlert(
              'Passageiros',
              avail <= 0
                ? 'Não há lugares disponíveis nesta viagem.'
                : `Esta viagem tem apenas ${avail} lugar(es) disponível(is). Volte e ajuste os passageiros ou escolha outro horário.`,
            );
            return;
          }
        }

        // Snapshot alinhado à base total do pedido (por pessoa × passageiros quando aplicável).
        const previewToUse: PricingResult = computeOrderPricing({
          baseCents: finalOrderBaseCents,
          surchargesCents: 0,
          adminPct: pricingPreview?.adminPctApplied ?? 15,
          gainPct: pricingPreview?.gainPctApplied ?? 0,
          discountPct: pricingPreview?.discountPctApplied ?? 0,
        });
        const pricingInsert = snapshotFromPricingResult(previewToUse, {
          promotionId: appliedPromotionId,
          promoWorkerRouteId: appliedPromoWorkerRouteId,
        });

        let bookingId = '';
        /** Cartão: o edge recalcula e devolve o amount_cents cobrado no PaymentIntent. */
        let chargedAmountCents = previewToUse.totalCents;

        if (params.method === 'credito' || params.method === 'debito') {
          const hasStripePm = Boolean(params.paymentMethodId?.trim());
          const hasSavedPm = Boolean(params.savedPaymentMethodId?.trim());
          if (!hasStripePm && !hasSavedPm) {
            showAlert('Pagamento', 'Selecione um cartão salvo ou informe os dados de um cartão.');
            return;
          }
          const { data: { session: sessionBefore } } = await supabase.auth.getSession();
          if (!sessionBefore?.access_token) {
            showAlert('Sessão', 'Faça login novamente para concluir o pagamento.');
            return;
          }
          const { data: refreshData, error: refreshErr } = await supabase.auth.refreshSession();
          const accessToken = refreshData.session?.access_token ?? sessionBefore.access_token;
          if (!accessToken) {
            showAlert(
              'Sessão',
              getUserErrorMessage(refreshErr, 'Sessão expirada. Faça login novamente.'),
            );
            return;
          }
          const cpf = params.holderCpfDigits?.replace(/\D/g, '') ?? '';
          const { data: ensureData, error: ensureErr } = await supabase.functions.invoke('ensure-stripe-customer', {
            headers: { Authorization: `Bearer ${accessToken}` },
            body: cpf.length === 11 ? { cpf } : undefined,
          });
          if (ensureErr) {
            const raw = await describeInvokeFailure(ensureData, ensureErr);
            showAlert('Pagamento', getUserErrorMessage({ message: raw }, raw));
            return;
          }
          const { data: chargeData, error: chargeFnError } = await supabase.functions.invoke('charge-booking', {
            headers: { Authorization: `Bearer ${accessToken}` },
            body: {
              ...(hasSavedPm
                ? { payment_method_id: params.savedPaymentMethodId!.trim() }
                : { stripe_payment_method_id: params.paymentMethodId!.trim() }),
              payment_method_kind: 'card',
              card_intent: params.method === 'credito' ? 'credit' : 'debit',
              draft_booking: {
                scheduled_trip_id: scheduledTripId,
                origin_address: origin.address,
                origin_lat: origin.latitude,
                origin_lng: origin.longitude,
                destination_address: destination.address,
                destination_lat: destination.latitude,
                destination_lng: destination.longitude,
                passenger_count,
                bags_count: bagsCount,
                passenger_data,
                promotion_id: appliedPromotionId || undefined,
              },
            },
          });
          if (chargeFnError) {
            const raw = await describeInvokeFailure(chargeData, chargeFnError);
            const chargeErrMsg = getUserErrorMessage({ message: raw }, raw);
            showAlert(
              'Pagamento',
              chargeErrMsg || 'Não foi possível confirmar o pagamento. Nenhuma reserva foi criada.',
            );
            return;
          }
          const chargeBody =
            chargeData && typeof chargeData === 'object' ? (chargeData as Record<string, unknown>) : null;
          bookingId = chargeBody?.booking_id != null ? String(chargeBody.booking_id) : '';
          if (!bookingId) {
            showAlert(
              'Pagamento',
              'Pagamento retornou sem identificador da reserva. Contate o suporte com o horário da tentativa.',
            );
            return;
          }
          const ac = chargeBody?.amount_cents;
          if (typeof ac === 'number' && Number.isFinite(ac) && ac >= 0) {
            chargedAmountCents = Math.floor(ac);
          }
        } else if (params.method === 'pix') {
          const { data: row, error } = await supabase
            .from('bookings')
            .insert({
              user_id: user.id,
              scheduled_trip_id: scheduledTripId,
              origin_address: origin.address,
              origin_lat: origin.latitude,
              origin_lng: origin.longitude,
              destination_address: destination.address,
              destination_lat: destination.latitude,
              destination_lng: destination.longitude,
              passenger_count,
              bags_count: bagsCount,
              passenger_data,
              ...pricingInsert,
              status: 'pending',
              payment_method: 'pix',
              amount_cents: previewToUse.totalCents,
              platform_fee_extra_debit_cents: 0,
            })
            .select('id')
            .single();
          if (error) {
            showAlert(
              'Erro ao reservar',
              getUserErrorMessage(error, 'Não foi possível registrar sua viagem. Tente novamente.')
            );
            return;
          }
          bookingId = row && typeof row === 'object' && 'id' in row ? String((row as { id: string }).id) : '';
          if (!bookingId) {
            showAlert('Erro', 'Não foi possível obter o identificador da reserva.');
            return;
          }

          // Pix: cobra via Stripe (mesma engine de envios). Reserva pré-criada como pending;
          // o webhook stripe-webhook promove para `paid` após o pagamento real do usuário no banco.
          const stripeCtx = await ensureAccessTokenForStripeFunctions();
          const cancelBooking = async () => {
            await supabase
              .from('bookings')
              .update({ status: 'cancelled', updated_at: new Date().toISOString() } as never)
              .eq('id', bookingId);
          };
          if (!stripeCtx.ok) {
            await cancelBooking();
            showAlert('Pagamento', stripeCtx.message);
            return;
          }
          const { data: chargeData, error: chargeFnError } = await supabase.functions.invoke(
            'charge-booking',
            {
              headers: { Authorization: `Bearer ${stripeCtx.accessToken}` },
              body: { booking_id: bookingId, payment_method_kind: 'pix' },
            },
          );
          if (chargeFnError) {
            const raw = await describeInvokeFailure(chargeData, chargeFnError);
            const chargeErrMsg = getUserErrorMessage({ message: raw }, raw);
            await cancelBooking();
            showAlert(
              'Pagamento',
              chargeErrMsg || 'Não foi possível iniciar o Pix; a reserva foi cancelada.',
            );
            return;
          }
          const pixBody = chargeData as {
            ok?: boolean;
            pix_requires_payment?: boolean;
            image_url_png?: string | null;
            hosted_voucher_url?: string | null;
            pix_copy_paste?: string | null;
          } | null;
          if (pixBody?.pix_requires_payment) {
            const paste = typeof pixBody.pix_copy_paste === 'string' ? pixBody.pix_copy_paste.trim() : '';
            if (paste) {
              try {
                await Clipboard.setString(paste);
              } catch {
                /* ignore */
              }
            }
            const hosted = typeof pixBody.hosted_voucher_url === 'string' ? pixBody.hosted_voucher_url.trim() : '';
            await new Promise<void>((resolve) => {
              const msg = paste
                ? 'Copiamos o código Pix para a área de transferência. Abra o comprovante no navegador se preferir; depois pague no app do banco. Quando concluir, toque em Continuar.'
                : 'Abra o comprovante Pix no navegador, pague no app do banco e toque em Continuar.';
              const buttons: { text: string; onPress?: () => void }[] = [];
              if (hosted) {
                buttons.push({
                  text: 'Abrir comprovante',
                  onPress: () => {
                    void Linking.openURL(hosted);
                  },
                });
              }
              buttons.push({ text: 'Continuar', onPress: () => resolve() });
              Alert.alert('Pix', msg, buttons, { cancelable: false });
            });
            const paid = await waitForShipmentStripePaymentIntentId('bookings', bookingId);
            if (!paid) {
              await cancelBooking();
              showAlert(
                'Pix',
                'Não detectamos o pagamento a tempo. A reserva foi cancelada; você pode tentar novamente.',
              );
              return;
            }
            chargedAmountCents = previewToUse.totalCents;
          } else if (pixBody?.ok !== true) {
            await cancelBooking();
            showAlert('Pagamento', 'Resposta inesperada do servidor ao iniciar Pix.');
            return;
          }
        } else if (params.method === 'dinheiro') {
          const { data: row, error } = await supabase
            .from('bookings')
            .insert({
              user_id: user.id,
              scheduled_trip_id: scheduledTripId,
              origin_address: origin.address,
              origin_lat: origin.latitude,
              origin_lng: origin.longitude,
              destination_address: destination.address,
              destination_lat: destination.latitude,
              destination_lng: destination.longitude,
              passenger_count,
              bags_count: bagsCount,
              passenger_data,
              ...pricingInsert,
              status: 'pending',
              payment_method: 'cash',
              amount_cents: previewToUse.totalCents,
              platform_fee_extra_debit_cents: 0,
            })
            .select('id')
            .single();
          if (error) {
            showAlert(
              'Erro ao reservar',
              getUserErrorMessage(error, 'Não foi possível registrar sua viagem. Tente novamente.')
            );
            return;
          }
          bookingId = row && typeof row === 'object' && 'id' in row ? String((row as { id: string }).id) : '';
          if (!bookingId) {
            showAlert('Erro', 'Não foi possível obter o identificador da reserva.');
            return;
          }
          chargedAmountCents = previewToUse.totalCents;
        } else {
          showAlert('Pagamento', 'Método de pagamento não suportado.');
          return;
        }

        const summary: PaymentConfirmedBookingParam = {
          booking_id: bookingId,
          origin_address: origin.address,
          destination_address: destination.address,
          departure: driver.departure,
          arrival: driver.arrival,
          amount_cents: chargedAmountCents,
          driver_name: driver.name,
        };
        const tripLive: TripLiveDriverDisplay = {
          driverName: driver.name,
          rating: driver.rating,
          vehicleLabel: formatVehicleDescription(driver.vehicle_model, driver.vehicle_year, driver.vehicle_plate),
          amountCents: chargedAmountCents,
          bookingId: bookingId || undefined,
          scheduledTripId: scheduledTripId,
          origin: origin
            ? { latitude: origin.latitude, longitude: origin.longitude, address: origin.address }
            : undefined,
          destination: destination
            ? { latitude: destination.latitude, longitude: destination.longitude, address: destination.address }
            : undefined,
        };
        navigation.replace('PaymentConfirmed', {
          booking: summary,
          immediateTrip: route.params?.immediateTrip,
          tripLive,
          paymentMethod: params.method,
        });
      } finally {
        setPaymentSubmitting(false);
      }
    },
    [
      bagsCount,
      destination,
      driver.driver_id,
      driver.amount_cents,
      driver.arrival,
      driver.departure,
      driver.name,
      driver.rating,
      driver.vehicle_model,
      driver.vehicle_year,
      driver.vehicle_plate,
      navigation,
      origin,
      passengersParam,
      route.params?.immediateTrip,
      route.params?.scheduledTripDepartureAt,
      scheduledTripId,
      showAlert,
      pricingPreview,
      appliedPromotionId,
      appliedPromoWorkerRouteId,
      allowedPaymentMethods,
    ]
  );

  const mapRegion = useMemo(() => {
    const oOk = origin && isValidTripCoordinate(origin.latitude, origin.longitude);
    const dOk = destination && isValidTripCoordinate(destination.latitude, destination.longitude);
    if (oOk && dOk) {
      const latMin = Math.min(origin!.latitude, destination!.latitude);
      const latMax = Math.max(origin!.latitude, destination!.latitude);
      const lngMin = Math.min(origin!.longitude, destination!.longitude);
      const lngMax = Math.max(origin!.longitude, destination!.longitude);
      const padding = 0.004;
      return sanitizeMapRegion({
        latitude: (latMin + latMax) / 2,
        longitude: (lngMin + lngMax) / 2,
        latitudeDelta: Math.max(0.02, latMax - latMin + padding * 2),
        longitudeDelta: Math.max(0.02, lngMax - lngMin + padding * 2),
      });
    }
    if (oOk) {
      return sanitizeMapRegion({
        latitude: origin!.latitude,
        longitude: origin!.longitude,
        latitudeDelta: 0.02,
        longitudeDelta: 0.02,
      });
    }
    if (currentPlace && isValidTripCoordinate(currentPlace.latitude, currentPlace.longitude)) {
      return sanitizeMapRegion({
        latitude: currentPlace.latitude,
        longitude: currentPlace.longitude,
        latitudeDelta: 0.02,
        longitudeDelta: 0.02,
      });
    }
    return sanitizeMapRegion({
      ...DEFAULT_REGION,
      latitudeDelta: 0.02,
      longitudeDelta: 0.02,
    });
  }, [origin, destination, currentPlace]);

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <StatusBar style="dark" />
      <View style={styles.mapWrap}>
        <MapboxMap style={styles.map} initialRegion={mapRegion} scrollEnabled={false}>
          {origin && isValidTripCoordinate(origin.latitude, origin.longitude) && (
            <MapboxMarker
              id="origin"
              coordinate={{ latitude: origin.latitude, longitude: origin.longitude }}
              anchor={{ x: 0.5, y: 1 }}
              title="Partida"
              description={origin.address}
              pinColor={MAPBOX_ORIGIN_MARKER_COLOR}
            />
          )}
          {destination && isValidTripCoordinate(destination.latitude, destination.longitude) && (
            <MapboxMarker
              id="destination"
              coordinate={{ latitude: destination.latitude, longitude: destination.longitude }}
              anchor={{ x: 0.5, y: 1 }}
              title="Destino"
              description={destination.address}
              pinColor={MAPBOX_DESTINATION_MARKER_COLOR}
            />
          )}
          {origin &&
            destination &&
            isValidTripCoordinate(origin.latitude, origin.longitude) &&
            isValidTripCoordinate(destination.latitude, destination.longitude) &&
            routeCoords != null &&
            routeCoords.length >= 2 && (
            <MapboxPolyline coordinates={routeCoords} strokeWidth={4} />
          )}
        </MapboxMap>
      </View>
      <TouchableOpacity style={styles.backButton} onPress={() => navigation.goBack()}>
        <Text style={styles.backArrow}>←</Text>
      </TouchableOpacity>

      <ScrollView
        style={styles.scroll}
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
      >
        <Text style={styles.screenTitle}>Checkout</Text>

        <View style={styles.card}>
          <Text style={styles.cardTitle}>Motorista</Text>
          <View style={styles.driverRow}>
            {resolveAvatarUri(driver.avatar_url) && !driverAvatarFailed ? (
              <Image
                source={{ uri: resolveAvatarUri(driver.avatar_url)! }}
                style={styles.driverAvatarImage}
                onError={() => setDriverAvatarFailed(true)}
              />
            ) : (
              <View style={[styles.driverAvatarImage, styles.driverAvatarFallback]}>
                <Text style={styles.driverAvatarInitials}>{getInitials(driver.name)}</Text>
              </View>
            )}
            <View style={styles.driverInfo}>
              <Text style={styles.driverName}>{driver.name}</Text>
              <Text style={styles.driverRating}>★ {formatDriverRatingLabel(driver.rating)}</Text>
            </View>
            <Text style={styles.fare}>{fareFormatted}</Text>
          </View>
          <Text style={styles.meta}>
            {tripDateLabel ? `${tripDateLabel} · ` : ''}Saída {driver.departure} · Chegada {driver.arrival}
          </Text>
          <Text style={styles.dynamicPriceNote}>
            O valor final pode variar conforme o horário de solicitação e da partida.
          </Text>
          <View style={styles.metaRow}>
            <MaterialIcons name="directions-car" size={18} color={COLORS.neutral700} />
            <Text style={styles.metaText}>
              {formatVehicleDescription(driver.vehicle_model, driver.vehicle_year, driver.vehicle_plate)}
            </Text>
          </View>
          <View style={styles.metaRow}>
            <MaterialIcons name="work-outline" size={18} color={COLORS.neutral700} />
            <Text style={styles.metaText}>{bagsCount} malas</Text>
          </View>
        </View>

        <View style={styles.card}>
          <Text style={styles.cardTitle}>Passageiros</Text>
          <View style={styles.passengerRow}>
            <MaterialIcons name="person-outline" size={20} color={COLORS.neutral700} />
            <Text style={styles.passengerText}>
              {!primaryPassenger ? (
                'Carregando seus dados…'
              ) : (
                <Text>
                  {primaryPassenger.name}
                  {primaryPassenger.cpf ? ` · CPF: ${displayCpf(primaryPassenger.cpf)}` : ''}
                  <Text style={styles.passengerPrimaryHint}> (você)</Text>
                </Text>
              )}
            </Text>
          </View>
          {passengersParam.map((p, i) => (
            <View key={`extra-${i}`} style={styles.passengerRow}>
              <MaterialIcons name="person-outline" size={20} color={COLORS.neutral700} />
              <Text style={styles.passengerText}>
                {p.name?.trim() || `Passageiro extra ${i + 1}`}
                {p.cpf?.trim() ? ` · CPF: ${displayCpf(p.cpf)}` : ''}
              </Text>
            </View>
          ))}
          <Text style={styles.bagsNote}>{bagsCount} malas adicionadas</Text>
        </View>

        {pricingPreview ? (
          <View style={styles.card}>
            <Text style={styles.cardTitle}>Detalhes do preço</Text>
            {formatPricingBreakdown(pricingPreview).map((line, idx) => {
              const fmt = formatTripFareBrl(Math.abs(line.valueCents));
              const displayValue = line.valueCents < 0 ? `- ${fmt}` : fmt;
              return (
                <View
                  key={`${line.label}-${idx}`}
                  style={line.isTotal ? styles.breakdownTotalRow : styles.breakdownRow}
                >
                  <Text style={line.isTotal ? styles.breakdownTotalLabel : styles.breakdownLabel}>
                    {line.label}
                  </Text>
                  <Text style={line.isTotal ? styles.breakdownTotalValue : styles.breakdownValue}>
                    {displayValue}
                  </Text>
                </View>
              );
            })}
          </View>
        ) : pricingError ? (
          <View style={styles.card}>
            <Text style={styles.cardTitle}>Preço</Text>
            <Text style={styles.meta}>{pricingError}</Text>
          </View>
        ) : null}

        {pricingPreview ? (
          <View style={styles.card}>
            <Text style={styles.cardTitle}>Detalhes do preço</Text>
            {formatPricingBreakdown(pricingPreview).map((line, idx) => {
              const fmt = formatTripFareBrl(Math.abs(line.valueCents));
              const displayValue = line.valueCents < 0 ? `- ${fmt}` : fmt;
              return (
                <View
                  key={`${line.label}-${idx}`}
                  style={line.isTotal ? styles.breakdownTotalRow : styles.breakdownRow}
                >
                  <Text style={line.isTotal ? styles.breakdownTotalLabel : styles.breakdownLabel}>
                    {line.label}
                  </Text>
                  <Text style={line.isTotal ? styles.breakdownTotalValue : styles.breakdownValue}>
                    {displayValue}
                  </Text>
                </View>
              );
            })}
          </View>
        ) : pricingError ? (
          <View style={styles.card}>
            <Text style={styles.cardTitle}>Preço</Text>
            <Text style={styles.meta}>{pricingError}</Text>
          </View>
        ) : null}

        <View style={styles.card}>
          <PaymentMethodSection
            amountCents={displayChargeCents ?? 0}
            selectedMethod={selectedPaymentMethod}
            onSelectMethod={setSelectedPaymentMethod}
            confirmLabel="Confirmar pagamento"
            cancellationPolicyVariant="trip"
            loading={paymentSubmitting || fareLoading}
            onConfirmPayment={handleConfirmPayment}
            allowedMethods={allowedPaymentMethods}
          />
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: COLORS.background },
  mapWrap: { height: 180, width: '100%' },
  map: { width: '100%', height: '100%' },
  backButton: {
    position: 'absolute',
    top: Platform.OS === 'ios' ? 56 : 48,
    left: 24,
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: '#FFFFFF',
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.1,
    shadowRadius: 2,
    elevation: 2,
  },
  backArrow: { fontSize: 22, color: COLORS.black, fontWeight: '600' },
  scroll: { flex: 1 },
  scrollContent: { padding: 24, paddingBottom: 32 },
  screenTitle: { fontSize: 22, fontWeight: '700', color: COLORS.black, marginBottom: 16 },
  card: {
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: COLORS.neutral300,
    borderRadius: 12,
    padding: 16,
    marginBottom: 16,
  },
  cardTitle: { fontSize: 16, fontWeight: '700', color: COLORS.black, marginBottom: 12 },
  driverRow: { flexDirection: 'row', alignItems: 'center', marginBottom: 8 },
  driverAvatar: { width: 48, height: 48, borderRadius: 24, backgroundColor: COLORS.neutral300, marginRight: 12 },
  driverAvatarImage: { width: 48, height: 48, borderRadius: 24, marginRight: 12 },
  driverAvatarFallback: {
    backgroundColor: COLORS.neutral300,
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  },
  driverAvatarInitials: { fontSize: 16, fontWeight: '700', color: COLORS.black },
  driverInfo: { flex: 1 },
  driverName: { fontSize: 16, fontWeight: '600', color: COLORS.black },
  driverRating: { fontSize: 14, color: COLORS.neutral700 },
  fare: { fontSize: 18, fontWeight: '700', color: COLORS.orange },
  meta: { fontSize: 13, color: COLORS.neutral700, marginBottom: 4 },
  metaRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 4 },
  metaText: { fontSize: 13, color: COLORS.neutral700 },
  dynamicPriceNote: { fontSize: 12, color: COLORS.neutral700, fontStyle: 'italic', marginTop: 6 },
  passengerRow: { flexDirection: 'row', alignItems: 'center', gap: 12, marginBottom: 8 },
  passengerText: { flex: 1, fontSize: 14, color: COLORS.black },
  passengerPrimaryHint: { fontSize: 14, color: COLORS.neutral700 },
  bagsNote: { fontSize: 13, color: COLORS.neutral700, marginTop: 4 },
  breakdownRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 4,
  },
  breakdownTotalRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingTop: 10,
    marginTop: 6,
    borderTopWidth: 1,
    borderTopColor: COLORS.neutral300,
  },
  breakdownLabel: { fontSize: 14, color: COLORS.neutral700 },
  breakdownValue: { fontSize: 14, color: COLORS.black, fontWeight: '500' },
  breakdownTotalLabel: { fontSize: 15, color: COLORS.black, fontWeight: '700' },
  breakdownTotalValue: { fontSize: 16, color: COLORS.black, fontWeight: '700' },
});
