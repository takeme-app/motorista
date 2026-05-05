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
import { StatusBar } from 'expo-status-bar';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import type { DependentShipmentStackParamList } from '../../navigation/types';
import { PaymentMethodSection, type PaymentMethodType } from '../../components/PaymentMethodSection';
import { supabase } from '../../lib/supabase';
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

export function ConfirmDependentShipmentScreen({ navigation, route }: Props) {
  const insets = useSafeAreaInsets();
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
  } = route.params;
  const driver = route.params.driver;
  const [selectedPaymentMethod, setSelectedPaymentMethod] = useState<PaymentMethodType | null>('dinheiro');
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
        /* fallback 15% */
      }

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

      try {
        const preview = computeOrderPricing({
          baseCents: amountCents,
          surchargesCents: 0,
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
  }, [amountCents]);

  const allowedPaymentMethods = useMemo((): PaymentMethodType[] => {
    if (connectStatusLoading) return ['dinheiro'];
    if (connectChargesEnabled === true) return ['credito', 'debito', 'pix', 'dinheiro'];
    return ['dinheiro'];
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
      setSelectedPaymentMethod(allowedPaymentMethods[0] ?? 'dinheiro');
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
    async (params: { method: PaymentMethodType; paymentMethodId?: string }) => {
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
        if (bagsCount > totalPax) {
          showAlert('Malas', 'O número de malas não pode ser maior que o de passageiros (1 mala por pessoa).');
          setSubmitting(false);
          return;
        }
        const allowedBags = maxBagsForTrip(totalPax, driver?.bags);
        if (bagsCount > allowedBags) {
          showAlert(
            'Malas',
            driver?.bags != null && Number(driver.bags) > 0
              ? `No máximo ${allowedBags} mala(s): 1 por passageiro e limite desta viagem (${driver.bags} mala(s)).`
              : `No máximo ${allowedBags} mala(s) (1 por passageiro).`,
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
        let photoUrl: string | null = null;
        if (photoUri) {
          photoUrl = await uploadPhotoAndGetPath(user.id, photoUri);
        }
        const pricingFields = pricingInsertRow ?? {
          amount_cents: amountCents,
          pricing_subtotal_cents: amountCents,
          platform_fee_cents: 0,
          pricing_surcharges_cents: 0,
          promo_discount_cents: 0,
          promo_gain_cents: 0,
          price_route_base_cents: amountCents,
          worker_earning_cents: amountCents,
          admin_earning_cents: 0,
          admin_pct_applied: 0,
        };
        const { data: row, error } = await supabase
          .from('dependent_shipments')
          .insert({
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
          })
          .select('id')
          .single();
        if (error) {
          showAlert('Erro', getUserErrorMessage(error, 'Não foi possível registrar o envio. Tente novamente.'));
          setSubmitting(false);
          return;
        }
        const shipmentId = row?.id;
        const orderId = shipmentId ? orderIdFromUuid(shipmentId) : '----';

        if (shipmentId && (params.method === 'credito' || params.method === 'debito') && params.paymentMethodId) {
          const { data: chargeData, error: chargeFnError } = await supabase.functions.invoke('charge-shipment', {
            body: {
              dependent_shipment_id: shipmentId,
              stripe_payment_method_id: params.paymentMethodId,
              card_intent: params.method === 'credito' ? 'credit' : 'debit',
            },
          });
          const chargeErrMsg =
            chargeFnError?.message ??
            (chargeData && typeof chargeData === 'object' && 'error' in chargeData
              ? String((chargeData as { error?: string }).error ?? '')
              : '');
          if (chargeErrMsg) {
            await supabase
              .from('dependent_shipments')
              .update({ status: 'cancelled', updated_at: new Date().toISOString() } as never)
              .eq('id', shipmentId);
            showAlert(
              'Pagamento',
              chargeErrMsg || 'Não foi possível confirmar o pagamento; o pedido foi cancelado.',
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
      uploadPhotoAndGetPath,
      driver,
      allowedPaymentMethods,
    ]
  );

  return (
    <View style={[styles.container, { paddingTop: insets.top, paddingBottom: Math.max(insets.bottom, 16) }]}>
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
            {driver ? ` · máx. ${maxBagsAllowed} (regra da viagem)` : ` · máx. ${maxBagsAllowed} (1 por pessoa)`}
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
          connectCashOnlyContext="dependent_shipment"
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
