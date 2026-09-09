import { useState, useCallback, useEffect, useMemo, useRef } from 'react';
import {
  View,
  TouchableOpacity,
  StyleSheet,
  ScrollView,
} from 'react-native';
import { Text } from '../../components/Text';
import { MaterialIcons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useBottomSafeInset } from '@take-me/shared';
import { StatusBar } from 'expo-status-bar';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import type { DependentShipmentStackParamList } from '../../navigation/types';
import { PaymentMethodSection, type PaymentMethodType, type CardPaymentConfirmParams } from '../../components/PaymentMethodSection';
import { supabase } from '../../lib/supabase';
import { registerPalliativePix } from '../../lib/palliativePixStore';
import { useAppAlert } from '../../contexts/AppAlertContext';
import { getUserErrorMessage } from '../../utils/errorMessage';
import {
  computeOrderPricing,
  formatPricingBreakdown,
  normalizeApplyPromotion,
  PricingDenominatorOverflowError,
  formatDependentShipmentCode,
  type PricingResult,
} from '@take-me/shared';
import { snapshotFromPricingResult } from '../../lib/orderPricingSnapshot';
import { dependentShipmentTotalPassengers, maxBagsForTrip } from '../../lib/tripCapacityLimits';
import { fetchDriverStripeChargesEnabled } from '../../lib/driverStripeConnect';
import { fetchPlatformFeePctForService } from '../../lib/platformFees';
import { ensureAccessTokenForStripeFunctions } from '../../lib/ensureStripeCustomerForPayment';
import { EDGE_CHARGE_SHIPMENT_SLUG } from '../../lib/supabaseEdgeFunctionNames';
import { fetchPixProviderMode, type PixProviderMode } from '../../lib/pixProviderConfig';
import { validateCpf, onlyDigits } from '../../utils/formatCpf';
import { profileHasValidCpf } from '../../lib/profileCpf';

type Props = NativeStackScreenProps<DependentShipmentStackParamList, 'ConfirmDependentShipment'>;

const COLORS = {
  background: '#FFFFFF',
  black: '#0d0d0d',
  neutral300: '#f1f1f1',
  neutral700: '#767676',
};

function orderIdFromUuid(uuid: string): string {
  return formatDependentShipmentCode(uuid);
}

function formatPhoneDisplay(digits: string): string {
  if (digits.length <= 2) return digits ? `(${digits}` : '';
  if (digits.length <= 7) return `(${digits.slice(0, 2)}) ${digits.slice(2)}`;
  return `(${digits.slice(0, 2)}) ${digits.slice(2, 7)}-${digits.slice(7, 11)}`;
}

const applyTimeSurcharge = (baseCents: number, pct: number): number =>
  Math.round(baseCents * (1 + (Number.isFinite(pct) ? pct : 0) / 100));

/**
 * Adicionais da VIAGEM (fim de semana / noturno / feriado + adicionais de rota) — o envio de
 * dependente viaja numa corrida agendada, então segue a MESMA regra da viagem comum (não a de
 * encomenda). Espelha resolveBookingPricingExtras do CheckoutScreen.
 */
async function resolveDependentPricingExtras(
  scheduledTripId: string | null | undefined,
): Promise<{ timeSurchargePct: number; surchargesCents: number }> {
  let timeSurchargePct = 0;
  let surchargesCents = 0;
  try {
    if (scheduledTripId) {
      const { data } = await supabase.rpc('resolve_trip_time_surcharge_pct', {
        p_scheduled_trip_id: scheduledTripId,
      });
      const pct = Number(data);
      if (Number.isFinite(pct) && pct > 0) timeSurchargePct = pct;
    }
  } catch {
    /* sem adicional de horário */
  }
  try {
    // Envio de dependente não tem pricing_route próprio; adicionais de rota não se aplicam (null).
    const { data } = await supabase.rpc('resolve_booking_surcharges_cents', {
      p_pricing_route_id: null,
    });
    const cents = Number(data);
    if (Number.isFinite(cents) && cents > 0) surchargesCents = Math.floor(cents);
  } catch {
    /* sem adicionais */
  }
  return { timeSurchargePct, surchargesCents };
}

export function ConfirmDependentShipmentScreen({ navigation, route }: Props) {
  const insets = useSafeAreaInsets();
  const bottomInset = useBottomSafeInset();
  const { showAlert } = useAppAlert();
  const {
    origin,
    destination,
    whenOption,
    whenLabel,
    fullName,
    contactPhone,
    bagsCount,
    extraPassengers,
    instructions,
    dependentId,
    amountCents,
    photoUri,
    photoUris,
  } = route.params;
  const driver = route.params.driver;
  // Modo do Pix: 'palliative' mantém o QR estático de sempre; provedor real
  // manda para a PixPaymentScreen (cobrança única com confirmação automática).
  const [pixProviderMode, setPixProviderMode] = useState<PixProviderMode>('palliative');
  useEffect(() => {
    void fetchPixProviderMode().then(setPixProviderMode);
  }, []);
  // O servidor PREFERE o CPF do perfil e só grava um novo quando não há um
  // válido — então pedir o CPF de quem já tem é pedir dado repetido. `null`
  // (leitura pendente ou falha) conta como "não tem": perguntar à toa incomoda,
  // esconder de quem não tem trava a pessoa num 422 sem saída.
  const [profileCpfOk, setProfileCpfOk] = useState<boolean | null>(null);
  useEffect(() => {
    void profileHasValidCpf().then(setProfileCpfOk);
  }, []);
  const [selectedPaymentMethod, setSelectedPaymentMethod] = useState<PaymentMethodType | null>('pix');
  const [submitting, setSubmitting] = useState(false);
  /** Stripe Connect (`charges_enabled`): só então cartão/Pix ficam disponíveis. */
  const [connectChargesEnabled, setConnectChargesEnabled] = useState<boolean | null>(null);
  const [connectStatusLoading, setConnectStatusLoading] = useState(() => Boolean(driver?.driver_id?.trim()));
  const connectFetchGen = useRef(0);
  const [pricingPreview, setPricingPreview] = useState<PricingResult | null>(null);
  const [appliedPromotionId, setAppliedPromotionId] = useState<string | null>(null);
  const [appliedPromoWorkerRouteId, setAppliedPromoWorkerRouteId] = useState<string | null>(null);

  useEffect(() => {
    if (!amountCents || amountCents < 1) {
      setPricingPreview(null);
      return;
    }
    let cancelled = false;
    void (async () => {
      const adminPct = await fetchPlatformFeePctForService('dependent_shipment');

      const { data: { user } } = await supabase.auth.getUser();
      let gainPct = 0;
      let discountPct = 0;
      let promotionId: string | null = null;
      let promoWorkerRouteId: string | null = null;
      if (user) {
        try {
          const { data: promoRows } = await supabase.rpc('apply_active_promotion', {
            p_order_type: 'dependent_shipments',
            p_user_id: user.id,
            p_amount_cents: amountCents,
          });
          const applied = normalizeApplyPromotion(
            Array.isArray(promoRows) ? (promoRows[0] as any) : (promoRows as any),
          );
          gainPct = applied.gainPct;
          discountPct = applied.discountPct;
          promotionId = applied.promotionId;
          promoWorkerRouteId = applied.promoWorkerRouteId;
        } catch {
          /* promo indisponível */
        }
      }

      // Mesma regra da viagem: adicionais de horário (fds/noturno/feriado) + rota.
      const { timeSurchargePct, surchargesCents } = await resolveDependentPricingExtras(driver?.id);

      try {
        const preview = computeOrderPricing({
          baseCents: applyTimeSurcharge(amountCents, timeSurchargePct),
          surchargesCents,
          adminPct,
          gainPct,
          discountPct,
        });
        if (!cancelled) {
          setPricingPreview(preview);
          setAppliedPromotionId(promotionId);
          setAppliedPromoWorkerRouteId(promoWorkerRouteId);
        }
      } catch (err) {
        if (!cancelled) setPricingPreview(null);
        if (err instanceof PricingDenominatorOverflowError) {
          /* noop: config inválida; UI manterá fallback */
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [amountCents, driver?.id]);

  const allowedPaymentMethods = useMemo((): PaymentMethodType[] => {
    // Dinheiro OCULTO por decisão de produto (02/09/2026): o cliente não paga
    // mais em mãos. A máquina de dívida do motorista continua no banco
    // (driver_platform_fee_ledger e gatilhos), intacta — isto aqui só some com
    // a opção na tela, então voltar atrás é adicionar 'dinheiro' de novo.
    //
    // Pix não depende do Stripe Connect do motorista, então segue como a opção
    // sempre disponível — inclusive quando o motorista não tem Connect ativo,
    // caso em que antes o dinheiro era a única saída.
    if (connectStatusLoading) return ['pix'];
    if (connectChargesEnabled === true) return ['credito', 'debito', 'pix'];
    return ['pix'];
  }, [connectChargesEnabled, connectStatusLoading]);

  useEffect(() => {
    const wid = driver?.driver_id?.trim();
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
  }, [driver?.driver_id]);

  useEffect(() => {
    if (selectedPaymentMethod == null) return;
    if (!allowedPaymentMethods.includes(selectedPaymentMethod)) {
      setSelectedPaymentMethod(allowedPaymentMethods[0] ?? 'pix');
    }
  }, [allowedPaymentMethods, selectedPaymentMethod]);

  const displayTotalCents = pricingPreview?.totalCents ?? amountCents;

  const uploadPhotoAndGetPath = useCallback(
    async (userId: string, localUri: string): Promise<string | null> => {
      try {
        const res = await fetch(localUri);
        const blob = await res.blob();
        const ext = localUri.split('.').pop()?.toLowerCase() === 'png' ? 'png' : 'jpg';
        const path = `${userId}/${Date.now()}-${Math.random().toString(36).slice(2, 10)}.${ext}`;
        const { error } = await supabase.storage
          .from('shipment-photos')
          .upload(path, blob, { contentType: ext === 'png' ? 'image/png' : 'image/jpeg' });
        if (error) return null;
        return path;
      } catch {
        return null;
      }
    },
    [],
  );

  const amountFormatted = `R$ ${(displayTotalCents / 100).toFixed(2).replace('.', ',')}`;
  const formatBRL = (cents: number) => `R$ ${(cents / 100).toFixed(2).replace('.', ',')}`;
  const contactDisplay = formatPhoneDisplay(contactPhone);
  const companions = extraPassengers ?? 0;
  const totalPassengersInGroup = dependentShipmentTotalPassengers(companions);
  const maxBagsAllowed = maxBagsForTrip(totalPassengersInGroup, driver?.bags);

  const pricingInsertRow = useMemo(() => {
    if (!pricingPreview) return null;
    return snapshotFromPricingResult(pricingPreview, {
      promotionId: appliedPromotionId,
      promoWorkerRouteId: appliedPromoWorkerRouteId,
    });
  }, [pricingPreview, appliedPromotionId, appliedPromoWorkerRouteId]);

  const handleConfirmPayment = useCallback(
    async (params: CardPaymentConfirmParams) => {
      setSubmitting(true);
      try {
        if (!allowedPaymentMethods.includes(params.method)) {
          showAlert(
            'Método de pagamento',
            'Este método não está disponível para este envio. Escolha outra opção ou volte mais tarde.',
          );
          return;
        }
        const {
          data: { user },
          error: authError,
        } = await supabase.auth.getUser();
        if (authError || !user) {
          showAlert('Erro', 'Faça login para continuar.');
          setSubmitting(false);
          return;
        }
        const totalPax = dependentShipmentTotalPassengers(extraPassengers ?? 0);
        const allowedBags = maxBagsForTrip(totalPax, driver?.bags);
        if (bagsCount > allowedBags) {
          showAlert(
            'Malas',
            driver?.bags != null && Number(driver.bags) > 0
              ? `Capacidade disponível no bagageiro desta viagem: ${allowedBags} mala${allowedBags === 1 ? '' : 's'}.`
              : `Capacidade do bagageiro indisponível — limite estimado em ${allowedBags} mala${allowedBags === 1 ? '' : 's'}.`,
          );
          setSubmitting(false);
          return;
        }
        if (driver != null && totalPax > driver.seats) {
          showAlert(
            'Passageiros',
            `Esta viagem comporta no máximo ${driver.seats} lugar(es); este envio precisa de ${totalPax} (dependente${companions > 0 ? ` + ${companions} acompanhante(s)` : ''}).`,
          );
          setSubmitting(false);
          return;
        }
        const scheduledTripId = driver?.id;
        if (scheduledTripId) {
          const { data: capRow } = await supabase
            .from('scheduled_trips')
            .select('seats_available, bags_available')
            .eq('id', scheduledTripId)
            .maybeSingle();
          const availSeats = Math.floor(Number((capRow as { seats_available?: number })?.seats_available ?? 0));
          const availBags = Math.floor(Number((capRow as { bags_available?: number })?.bags_available ?? 0));
          if (Number.isFinite(availSeats) && totalPax > availSeats) {
            showAlert(
              'Passageiros',
              availSeats <= 0
                ? 'Não há lugares suficientes nesta viagem.'
                : `Esta viagem tem apenas ${availSeats} lugar(es) disponível(is). Ajuste passageiros ou escolha outro motorista.`,
            );
            setSubmitting(false);
            return;
          }
          if (Number.isFinite(availBags) && availBags > 0 && bagsCount > availBags) {
            showAlert(
              'Malas',
              `Só há espaço para ${availBags} mala(s) nesta viagem. Reduza as malas ou escolha outra opção.`,
            );
            setSubmitting(false);
            return;
          }
        }
        const paymentMethodDb =
          params.method === 'credito'
            ? 'credito'
            : params.method === 'debito'
              ? 'debito'
              : params.method === 'pix'
                ? 'pix'
                : 'dinheiro';
        const status = 'pending_review';
        // Upload de todas as fotos (carrossel). photo_url = primeira; photo_paths = todas.
        const rawPhotoUris = [
          ...(photoUris ?? []),
          ...(photoUri ? [photoUri] : []),
        ];
        const uploadedPaths: string[] = [];
        for (const uri of rawPhotoUris) {
          const p = await uploadPhotoAndGetPath(user.id, uri);
          if (p) uploadedPaths.push(p);
        }
        const photoUrl: string | null = uploadedPaths[0] ?? null;
        let pricingFields = pricingInsertRow;
        if (!pricingFields) {
          const fallbackAdminPct = await fetchPlatformFeePctForService('dependent_shipment');
          // Mesma regra da viagem (fds/noturno/feriado + rota) também no fallback.
          const { timeSurchargePct: fbTimePct, surchargesCents: fbSurchargesCents } =
            await resolveDependentPricingExtras(scheduledTripId);
          try {
            pricingFields = snapshotFromPricingResult(
              computeOrderPricing({
                baseCents: applyTimeSurcharge(amountCents, fbTimePct),
                surchargesCents: fbSurchargesCents,
                adminPct: fallbackAdminPct,
                gainPct: 0,
                discountPct: 0,
              }),
            );
          } catch {
            pricingFields = {
              amount_cents: amountCents,
              pricing_subtotal_cents: amountCents,
              platform_fee_cents: 0,
              pricing_surcharges_cents: 0,
              promo_discount_cents: 0,
              promo_gain_cents: 0,
              price_route_base_cents: amountCents,
              worker_earning_cents: amountCents,
              admin_earning_cents: 0,
              admin_pct_applied: fallbackAdminPct,
            };
          }
        }
        const dependentInsertPayload = {
          user_id: user.id,
          dependent_id: dependentId ?? null,
          full_name: fullName,
          contact_phone: contactPhone,
          bags_count: bagsCount,
          instructions: instructions ?? null,
          origin_address: origin.address,
          origin_lat: origin.latitude,
          origin_lng: origin.longitude,
          destination_address: destination.address,
          destination_lat: destination.latitude,
          destination_lng: destination.longitude,
          when_option: whenOption,
          scheduled_at: whenOption === 'later' ? null : null,
          payment_method: paymentMethodDb,
          ...pricingFields,
          ...(scheduledTripId ? { scheduled_trip_id: scheduledTripId } : {}),
          status,
          photo_url: photoUrl,
          photo_paths: uploadedPaths,
        };

        // Pix REAL: não insere o envio aqui. O create-pix-charge insere no
        // servidor já ancorado na cobrança, para o motorista da viagem não ser
        // notificado antes do pagamento. Espelha a encomenda.
        // Modo do Pix RELIDO aqui (cache 30s), NUNCA o estado da tela: o
        // useCallback congela o valor do closure e a leitura da montagem é
        // assíncrona, então o estado pode estar em 'palliative' enquanto a tela
        // já mostra o campo de CPF do modo real. Confirmar nessa janela mandava o
        // pedido para o fluxo paliativo, que o cria SEM cobrar — o bug de
        // 02/09/2026. A viagem já lia assim; agora os quatro fluxos leem igual.
        const pixModeNow = params.method === 'pix' ? await fetchPixProviderMode() : null;
        if (pixModeNow) setPixProviderMode(pixModeNow);

        if (pixModeNow != null && pixModeNow !== 'palliative') {
          const collectedCpf = onlyDigits(params.holderCpfDigits ?? '');
          const collectedCpfOk = validateCpf(collectedCpf);
          if (!collectedCpfOk && profileCpfOk !== true) {
            // Não navega sem CPF: o servidor devolveria 422 e o usuário voltaria
            // para cá. O campo inline já está visível (pixCpfRequired).
            showAlert(
              'CPF necessário',
              'O pagamento por Pix exige CPF. Informe seu CPF no campo da opção Pix e confirme novamente.',
            );
            setSubmitting(false);
            return;
          }
          navigation.navigate('PixPayment', {
            service: 'dependent_shipment',
            ...(collectedCpfOk ? { cpf: collectedCpf } : {}),
            dependentDraft: dependentInsertPayload as unknown as Record<string, unknown>,
            estimatedAmountCents: Number(
              (pricingFields as { amount_cents?: number }).amount_cents ?? amountCents,
            ),
            dependentSuccess: true,
          });
          return;
        }

        // Pix paliativo: cria o envio do dependente só aos 40s (na tela de Pix).
        if (params.method === 'pix') {
          let pixDepId = '';
          const reqId = registerPalliativePix({
            amountCents,
            effectivate: async () => {
              const { data: pixRow, error: pixErr } = await supabase
                .from('dependent_shipments')
                .insert(dependentInsertPayload)
                .select('id')
                .single();
              if (pixErr) throw pixErr;
              pixDepId = String((pixRow as { id: string }).id);
            },
            navigateSuccess: () => {
              navigation.replace('DependentShipmentSuccess', {
                orderId: pixDepId ? orderIdFromUuid(pixDepId) : '----',
                shipmentId: pixDepId || undefined,
              });
            },
          });
          navigation.navigate('PixPaliativo', { requestId: reqId });
          return;
        }

        const { data: row, error } = await supabase
          .from('dependent_shipments')
          .insert(dependentInsertPayload)
          .select('id')
          .single();
        if (error) {
          showAlert('Erro', getUserErrorMessage(error, 'Não foi possível registrar o envio. Tente novamente.'));
          setSubmitting(false);
          return;
        }
        const shipmentId = row?.id;
        const orderId = shipmentId ? orderIdFromUuid(shipmentId) : '----';

        const hasStripePm = Boolean(params.paymentMethodId?.trim());
        const hasSavedPm = Boolean(params.savedPaymentMethodId?.trim());
        if (shipmentId && (params.method === 'credito' || params.method === 'debito') && (hasStripePm || hasSavedPm)) {
          // O slug correto é `charge-shipments` (EDGE_CHARGE_SHIPMENT_SLUG) e a função exige o
          // Bearer do usuário — antes chamávamos 'charge-shipment' (inexistente) sem Authorization,
          // então o cartão neste fluxo falhava sempre.
          const stripeCtx = await ensureAccessTokenForStripeFunctions({
            holderCpfDigits: params.holderCpfDigits,
          });
          if (!stripeCtx.ok) {
            await supabase
              .from('dependent_shipments')
              .update({ status: 'cancelled', updated_at: new Date().toISOString() } as never)
              .eq('id', shipmentId);
            showAlert('Pagamento', stripeCtx.message);
            setSubmitting(false);
            return;
          }
          const { data: chargeData, error: chargeFnError } = await supabase.functions.invoke(EDGE_CHARGE_SHIPMENT_SLUG, {
            headers: { Authorization: `Bearer ${stripeCtx.accessToken}` },
            body: {
              dependent_shipment_id: shipmentId,
              card_intent: params.method === 'credito' ? 'credit' : 'debit',
              ...(hasSavedPm
                ? { payment_method_id: params.savedPaymentMethodId!.trim() }
                : { stripe_payment_method_id: params.paymentMethodId!.trim() }),
            },
          });
          const chargeErrMsg =
            chargeFnError?.message ??
            (chargeData && typeof chargeData === 'object' && 'error' in chargeData
              ? String((chargeData as { error?: string }).error ?? '')
              : '');
          if (chargeErrMsg) {
            // Guard: um timeout de rede pode chegar aqui DEPOIS de a edge ter
            // confirmado o PaymentIntent no servidor. Só cancela se nenhum
            // pagamento foi registrado (stripe_payment_intent_id nulo) — senão
            // cancelaríamos um pedido JÁ COBRADO sem disparar estorno.
            const { data: cancelledRows } = await supabase
              .from('dependent_shipments')
              .update({ status: 'cancelled', updated_at: new Date().toISOString() } as never)
              .eq('id', shipmentId)
              .is('stripe_payment_intent_id', null)
              .select('id');
            const wasCancelled = Array.isArray(cancelledRows) && cancelledRows.length > 0;
            showAlert(
              'Pagamento',
              wasCancelled
                ? chargeErrMsg || 'Não foi possível confirmar o pagamento; o pedido foi cancelado.'
                : 'Não foi possível confirmar o resultado do pagamento, mas ele pode ter sido aprovado. Verifique em Atividades ou fale com o suporte antes de tentar de novo.',
            );
            setSubmitting(false);
            return;
          }
        }

        navigation.replace('DependentShipmentSuccess', {
          orderId,
          shipmentId: shipmentId ?? undefined,
        });
      } catch (e) {
        showAlert('Erro', 'Ocorreu um erro. Tente novamente.');
      } finally {
        setSubmitting(false);
      }
    },
    [
      profileCpfOk,
      dependentId,
      fullName,
      contactPhone,
      bagsCount,
      instructions,
      origin,
      destination,
      whenOption,
      amountCents,
      navigation,
      extraPassengers,
      showAlert,
      pricingInsertRow,
      photoUri,
      photoUris,
      uploadPhotoAndGetPath,
      driver,
      allowedPaymentMethods,
    ]
  );

  return (
    <View style={[styles.container, { paddingTop: insets.top, paddingBottom: bottomInset }]}>
      <StatusBar style="dark" />
      <View style={styles.header}>
        <TouchableOpacity onPress={() => navigation.goBack()} style={styles.backButton} hitSlop={12}>
          <MaterialIcons name="arrow-back" size={24} color={COLORS.black} />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Confirme o envio do dependente</Text>
      </View>

      <ScrollView
        style={styles.scroll}
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
      >
        <View style={styles.summaryCard}>
          <Text style={styles.summaryLabel}>Destinatário (dependente)</Text>
          <Text style={styles.summaryText}>{fullName} • {contactDisplay}</Text>
          <Text style={styles.summaryMeta}>
            Embarcados na corrida: {totalPassengersInGroup}{' '}
            {companions === 0
              ? '(apenas o dependente; quem solicita não viaja)'
              : `(dependente + ${companions} ${companions === 1 ? 'acompanhante' : 'acompanhantes'})`}
          </Text>
          <Text style={styles.summaryMeta}>
            Bagagens: {bagsCount} {bagsCount === 1 ? 'mala' : 'malas'}
            {driver ? ` · máx. ${maxBagsAllowed} (bagageiro da viagem)` : ` · máx. ${maxBagsAllowed} (estimativa)`}
          </Text>
          {instructions ? <Text style={styles.summaryMeta}>Instruções: {instructions}</Text> : null}
          <View style={styles.divider} />
          <Text style={styles.summaryMeta}>De: {origin.address}</Text>
          <Text style={styles.summaryMeta}>Para: {destination.address}</Text>
          <Text style={styles.summaryMeta}>Quando: {whenOption === 'later' && whenLabel ? whenLabel : 'Agora'}</Text>
          <View style={styles.divider} />
          {pricingPreview ? (
            formatPricingBreakdown(pricingPreview).map((line, idx) => {
              const abs = Math.abs(line.valueCents);
              const val = line.valueCents < 0 ? `- ${formatBRL(abs)}` : formatBRL(abs);
              return line.isTotal ? (
                <View key={`${line.label}-${idx}`} style={styles.totalRow}>
                  <Text style={styles.summaryLabel}>{line.label}</Text>
                  <Text style={styles.summaryPrice}>{val}</Text>
                </View>
              ) : (
                <View key={`${line.label}-${idx}`} style={styles.breakdownRow}>
                  <Text style={styles.summaryMeta}>{line.label}</Text>
                  <Text style={styles.summaryMeta}>{val}</Text>
                </View>
              );
            })
          ) : (
            <View style={styles.totalRow}>
              <Text style={styles.summaryLabel}>Total</Text>
              <Text style={styles.summaryPrice}>{amountFormatted}</Text>
            </View>
          )}
        </View>

        <PaymentMethodSection
          amountCents={displayTotalCents}
          selectedMethod={selectedPaymentMethod}
          onSelectMethod={setSelectedPaymentMethod}
          onConfirmPayment={handleConfirmPayment}
          confirmLabel="Confirmar envio"
          cancellationPolicyVariant="shipment_debit"
          loading={submitting || connectStatusLoading}
          allowedMethods={allowedPaymentMethods}
          cashInstructionVariant="dependent_shipment"
          connectCashOnlyContext="dependent_shipment"
          pixCpfRequired={pixProviderMode !== 'palliative' && profileCpfOk !== true}
        />
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: COLORS.background },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 12,
  },
  backButton: { width: 48, height: 48, borderRadius: 24, backgroundColor: COLORS.neutral300, alignItems: 'center', justifyContent: 'center', marginRight: 12 },
  headerTitle: { flex: 1, fontSize: 16, fontWeight: '700', color: COLORS.black },
  scroll: { flex: 1 },
  scrollContent: { paddingHorizontal: 24, paddingBottom: 32 },
  summaryCard: {
    backgroundColor: COLORS.neutral300,
    borderRadius: 12,
    padding: 16,
    marginBottom: 24,
  },
  summaryLabel: { fontSize: 14, fontWeight: '600', color: COLORS.black, marginBottom: 4 },
  summaryText: { fontSize: 15, color: COLORS.black, marginBottom: 4 },
  summaryMeta: { fontSize: 14, color: COLORS.neutral700, marginBottom: 4 },
  summaryPrice: { fontSize: 16, fontWeight: '700', color: COLORS.black },
  divider: { height: 1, backgroundColor: '#ddd', marginVertical: 12 },
  totalRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginTop: 4 },
  breakdownRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 },
});
