import { useState, useCallback, useMemo } from 'react';
import {
  View,
  TouchableOpacity,
  StyleSheet,
  ScrollView,
  ActivityIndicator,
  Alert,
  Clipboard,
  Linking,
} from 'react-native';
import { Text } from '../../components/Text';
import { MaterialIcons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import type { ShipmentStackParamList } from '../../navigation/types';
import { PaymentMethodSection, type PaymentMethodType, type CardPaymentConfirmParams } from '../../components/PaymentMethodSection';
import { supabase } from '../../lib/supabase';
import { tryOpenSupportTicket } from '../../lib/supportTickets';
import { resolveShipmentBaseId } from '../../lib/resolveShipmentBase';
import { useAppAlert } from '../../contexts/AppAlertContext';
import { getUserErrorMessage } from '../../utils/errorMessage';
import { describeInvokeFailure } from '../../utils/edgeFunctionResponse';
import {
  shipmentPricingSnapshotFromParams,
  shipmentOrderInsertFromQuoteParams,
} from '../../lib/orderPricingSnapshot';
import { formatPricingBreakdown, computeOrderPricing, PricingDenominatorOverflowError, formatShipmentCode } from '@take-me/shared';
import { guessCityFromPtAddress } from '../../lib/shipmentOriginCity';
import { ensureAccessTokenForStripeFunctions } from '../../lib/ensureStripeCustomerForPayment';
import { EDGE_CHARGE_SHIPMENT_SLUG } from '../../lib/supabaseEdgeFunctionNames';
import { waitForShipmentStripePaymentIntentId } from '../../lib/waitForShipmentStripePaymentIntentId';

const MAX_ENCOMENDA_PHOTOS = 8;

type Props = NativeStackScreenProps<ShipmentStackParamList, 'ConfirmShipment'>;

const COLORS = {
  background: '#FFFFFF',
  black: '#0d0d0d',
  neutral300: '#f1f1f1',
  neutral400: '#e2e2e2',
  neutral700: '#767676',
};

const PACKAGE_SIZE_SUBTITLES: Record<string, string> = {
  pequeno: 'Cabe em uma mochila',
  medio: 'Cabe em uma mala de mão',
  grande: 'Precisa de avaliação do nosso time',
};

function orderIdFromUuid(uuid: string): string {
  return formatShipmentCode(uuid);
}

export function ConfirmShipmentScreen({ navigation, route }: Props) {
  const insets = useSafeAreaInsets();
  const { showAlert } = useAppAlert();
  const {
    origin,
    destination,
    whenOption,
    whenLabel,
    packageSize,
    packageSizeLabel,
    recipient,
    amountCents,
    pricingSubtotalCents,
    platformFeeCents,
    priceRouteBaseCents,
    pricingRouteId,
    adminPctApplied,
    clientPreferredDriverId,
    resolvedBaseId: resolvedBaseIdParam,
    scheduledTripId,
  } = route.params;
  const [selectedPaymentMethod, setSelectedPaymentMethod] = useState<PaymentMethodType | null>(null);
  const [submitting, setSubmitting] = useState(false);

  /** Há base na região: coleta pode ser na base (motorista vê no mapa / paradas) após aceitar. */
  const hubColetaNaBase = Boolean(resolvedBaseIdParam);

  const showFeeBreakdown = true;
  const pricingSnapshot = shipmentPricingSnapshotFromParams({
    amountCents,
    subtotalCents: pricingSubtotalCents,
    feeCents: platformFeeCents,
    priceRouteBaseCents,
  });

  // Reconstrói o breakdown gross-up (PDF) usando os parâmetros da cotação.
  // Neste momento não aplicamos promoção — o desconto/ganho promocional
  // é persistido pelo edge `charge-shipments` após o checkout.
  const pricingPreview = useMemo(() => {
    try {
      return computeOrderPricing({
        baseCents: priceRouteBaseCents,
        surchargesCents: Math.max(0, amountCents - priceRouteBaseCents - platformFeeCents),
        adminPct: adminPctApplied,
        gainPct: 0,
        discountPct: 0,
      });
    } catch (err) {
      if (err instanceof PricingDenominatorOverflowError) return null;
      return null;
    }
  }, [priceRouteBaseCents, platformFeeCents, amountCents, adminPctApplied]);

  const pricingInsertRow = useMemo(
    () =>
      shipmentOrderInsertFromQuoteParams({
        pricingRouteId,
        priceRouteBaseCents,
        pricingSubtotalCents,
        platformFeeCents,
        amountCents,
        adminPctApplied,
        surchargesCents: pricingPreview?.surchargesCents ?? 0,
        workerEarningCents: pricingPreview?.workerEarningCents,
        adminEarningCents: pricingPreview?.adminEarningCents,
      }),
    [
      pricingRouteId,
      priceRouteBaseCents,
      pricingSubtotalCents,
      platformFeeCents,
      amountCents,
      adminPctApplied,
      pricingPreview,
    ]
  );
  const amountFormatted = `R$ ${(pricingSnapshot.amount_cents / 100).toFixed(2).replace('.', ',')}`;
  const formatBRL = (cents: number) => `R$ ${(cents / 100).toFixed(2).replace('.', ',')}`;
  const cancellationVariant =
    selectedPaymentMethod === 'credito'
      ? 'shipment_credit'
      : selectedPaymentMethod === 'debito'
        ? 'shipment_debit'
        : 'shipment_debit';

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
    []
  );

  const handleConfirmPayment = useCallback(
    async (params: CardPaymentConfirmParams) => {
      setSubmitting(true);
      try {
        const {
          data: { user },
          error: authError,
        } = await supabase.auth.getUser();
        if (authError || !user) {
          showAlert('Erro', 'Faça login para continuar.');
          return;
        }
        const rawPhotoUris = [
          ...(recipient.photoUris ?? []),
          ...(recipient.photoUri ? [recipient.photoUri] : []),
        ].slice(0, MAX_ENCOMENDA_PHOTOS);
        const uploadedPaths: string[] = [];
        for (const uri of rawPhotoUris) {
          const p = await uploadPhotoAndGetPath(user.id, uri);
          if (p) uploadedPaths.push(p);
        }
        const photoUrl = uploadedPaths[0] ?? null;
        const photoPathsJson = uploadedPaths;
        const paymentMethodDb =
          params.method === 'credito'
            ? 'credito'
            : params.method === 'debito'
              ? 'debito'
              : params.method === 'pix'
                ? 'pix'
                : 'dinheiro';
        const status =
          packageSize === 'grande' ? 'pending_review' : params.method === 'dinheiro' ? 'confirmed' : 'confirmed';
        const baseIdForInsert =
          resolvedBaseIdParam !== undefined
            ? resolvedBaseIdParam
            : await resolveShipmentBaseId({
                origin: { latitude: origin.latitude, longitude: origin.longitude },
                originAddress: origin.address,
              });
        const originCityResolved =
          (origin.city?.trim() || guessCityFromPtAddress(origin.address)).trim() || null;
        const { data: row, error } = await supabase
          .from('shipments')
          .insert({
            user_id: user.id,
            origin_address: origin.address,
            origin_lat: origin.latitude,
            origin_lng: origin.longitude,
            origin_city: originCityResolved,
            ...(clientPreferredDriverId ? { client_preferred_driver_id: clientPreferredDriverId } : {}),
            ...(scheduledTripId ? { scheduled_trip_id: scheduledTripId } : {}),
            destination_address: destination.address,
            destination_lat: destination.latitude,
            destination_lng: destination.longitude,
            when_option: whenOption,
            scheduled_at: whenOption === 'later' ? null : null,
            package_size: packageSize,
            recipient_name: recipient.name,
            recipient_email: (recipient.email?.trim() || user.email || '').trim() || 'nao-informado@take-me.local',
            recipient_phone: recipient.phone,
            instructions: recipient.instructions ?? null,
            photo_url: photoUrl,
            photo_paths: photoPathsJson,
            payment_method: paymentMethodDb,
            ...pricingInsertRow,
            status,
            ...(baseIdForInsert ? { base_id: baseIdForInsert } : {}),
          })
          .select('id')
          .single();
        if (error) {
          const raw = `${(error as { message?: string }).message ?? ''} ${(error as { details?: string }).details ?? ''}`;
          if (
            (error as { code?: string }).code === 'PGRST204' ||
            /column .*does not exist|Could not find the .*column/i.test(raw)
          ) {
            showAlert(
              'Atualização do servidor',
              'O banco de dados ainda não tem as colunas de envio (motorista preferido / cidade). Aplique as migrações Supabase mais recentes do repositório e tente de novo.',
            );
            return;
          }
          showAlert('Erro', getUserErrorMessage(error, 'Não foi possível registrar o envio. Tente novamente.'));
          return;
        }
        const shipmentId = row?.id;
        const orderId = shipmentId ? orderIdFromUuid(shipmentId) : '----';
        const isLargePackage = packageSize === 'grande';
        if (isLargePackage && shipmentId) void tryOpenSupportTicket('encomendas', { shipment_id: shipmentId });
        const paymentProcessed =
          params.method === 'credito' || params.method === 'debito' || params.method === 'pix';

        let stripePaidOnline = false;
        const hasStripePm = Boolean(params.paymentMethodId?.trim());
        const hasSavedPm = Boolean(params.savedPaymentMethodId?.trim());
        if (shipmentId && (params.method === 'credito' || params.method === 'debito') && (hasStripePm || hasSavedPm)) {
          const stripeCtx = await ensureAccessTokenForStripeFunctions({
            holderCpfDigits: params.holderCpfDigits,
          });
          if (!stripeCtx.ok) {
            await supabase
              .from('shipments')
              .update({ status: 'cancelled', updated_at: new Date().toISOString() } as never)
              .eq('id', shipmentId);
            showAlert('Pagamento', stripeCtx.message);
            return;
          }
          const { data: chargeData, error: chargeFnError } = await supabase.functions.invoke(EDGE_CHARGE_SHIPMENT_SLUG, {
            headers: { Authorization: `Bearer ${stripeCtx.accessToken}` },
            body: {
              shipment_id: shipmentId,
              card_intent: params.method === 'credito' ? 'credit' : 'debit',
              ...(hasSavedPm
                ? { payment_method_id: params.savedPaymentMethodId!.trim() }
                : { stripe_payment_method_id: params.paymentMethodId!.trim() }),
            },
          });
          if (chargeFnError) {
            const raw = await describeInvokeFailure(chargeData, chargeFnError);
            const chargeErrMsg = getUserErrorMessage({ message: raw }, raw);
            await supabase
              .from('shipments')
              .update({ status: 'cancelled', updated_at: new Date().toISOString() } as never)
              .eq('id', shipmentId);
            showAlert(
              'Pagamento',
              chargeErrMsg || 'Não foi possível confirmar o pagamento; o pedido foi cancelado.',
            );
            return;
          }
          const charged = chargeData as { ok?: boolean } | null;
          stripePaidOnline = charged?.ok === true;
        } else if (shipmentId && params.method === 'pix') {
          const stripeCtx = await ensureAccessTokenForStripeFunctions();
          if (!stripeCtx.ok) {
            await supabase
              .from('shipments')
              .update({ status: 'cancelled', updated_at: new Date().toISOString() } as never)
              .eq('id', shipmentId);
            showAlert('Pagamento', stripeCtx.message);
            return;
          }
          const { data: chargeData, error: chargeFnError } = await supabase.functions.invoke(EDGE_CHARGE_SHIPMENT_SLUG, {
            headers: { Authorization: `Bearer ${stripeCtx.accessToken}` },
            body: { shipment_id: shipmentId },
          });
          if (chargeFnError) {
            const raw = await describeInvokeFailure(chargeData, chargeFnError);
            const chargeErrMsg = getUserErrorMessage({ message: raw }, raw);
            await supabase
              .from('shipments')
              .update({ status: 'cancelled', updated_at: new Date().toISOString() } as never)
              .eq('id', shipmentId);
            showAlert(
              'Pagamento',
              chargeErrMsg || 'Não foi possível iniciar o Pix; o pedido foi cancelado.',
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
            const paid = await waitForShipmentStripePaymentIntentId('shipments', shipmentId);
            if (!paid) {
              await supabase
                .from('shipments')
                .update({ status: 'cancelled', updated_at: new Date().toISOString() } as never)
                .eq('id', shipmentId);
              showAlert(
                'Pix',
                'Não detectamos o pagamento a tempo. O pedido foi cancelado; você pode criar um novo envio.',
              );
              return;
            }
            stripePaidOnline = true;
          } else if (pixBody?.ok === true) {
            stripePaidOnline = true;
          } else {
            await supabase
              .from('shipments')
              .update({ status: 'cancelled', updated_at: new Date().toISOString() } as never)
              .eq('id', shipmentId);
            showAlert('Pagamento', 'Resposta inesperada do servidor ao iniciar Pix.');
            return;
          }
        }

        const canStartDriverOfferQueue =
          Boolean(shipmentId) &&
          Boolean(clientPreferredDriverId) &&
          (status === 'confirmed' || (packageSize === 'grande' && status === 'pending_review'));

        if (canStartDriverOfferQueue && shipmentId) {
          const { data: beginData, error: beginErr } = await supabase.rpc('shipment_begin_driver_offering', {
            p_shipment_id: shipmentId,
          });
          if (beginErr) {
            showAlert(
              'Aviso',
              getUserErrorMessage(beginErr, 'Não foi possível iniciar a fila de motoristas. Contacte o suporte.'),
            );
          } else {
            const begin = beginData as {
              cancelled?: boolean;
              ok?: boolean;
              error?: string;
              skipped?: boolean;
              reason?: string;
            } | null;
            if (begin && begin.ok === false && begin.error) {
              showAlert(
                'Envio',
                begin.error === 'missing_preferred_driver'
                  ? 'Não foi possível abrir a fila: falta motorista preferido. Volte e escolha um motorista.'
                  : begin.error === 'forbidden'
                    ? 'Sessão inválida ao iniciar a fila. Faça login de novo.'
                    : begin.error === 'payment_required'
                      ? 'Pagamento ainda não confirmado no sistema. Aguarde alguns segundos após o Pix ou cartão e tente de novo na lista de envios.'
                      : `Não foi possível iniciar a fila (${begin.error}). Contacte o suporte.`,
              );
            } else if (begin?.cancelled) {
              if (stripePaidOnline) {
                await supabase.functions.invoke('refund-shipment-no-driver', {
                  body: { shipment_id: shipmentId },
                });
              }
              showAlert(
                'Envio cancelado',
                'Não há motoristas disponíveis nesta rota no momento. Se houve cobrança no cartão, o estorno será processado em instantes.',
              );
              navigation.reset({ index: 0, routes: [{ name: 'SelectShipmentAddress' }] });
              return;
            }
          }
        }

        navigation.replace('ShipmentSuccess', {
          orderId,
          shipmentId: shipmentId ?? undefined,
          isLargePackage,
          paymentProcessed,
        });
      } catch (e) {
        showAlert('Erro', 'Ocorreu um erro. Tente novamente.');
      } finally {
        setSubmitting(false);
      }
    },
    [
      origin,
      destination,
      whenOption,
      packageSize,
      clientPreferredDriverId,
      resolvedBaseIdParam,
      scheduledTripId,
      recipient,
      amountCents,
      pricingInsertRow,
      navigation,
      showAlert,
      uploadPhotoAndGetPath,
    ]
  );

  return (
    <View style={[styles.container, { paddingTop: insets.top, paddingBottom: Math.max(insets.bottom, 16) }]}>
      <StatusBar style="dark" />
      <View style={styles.header}>
        <TouchableOpacity onPress={() => navigation.goBack()} style={styles.backButton} hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}>
          <MaterialIcons name="arrow-back" size={24} color={COLORS.black} />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Confirme os detalhes do envio</Text>
      </View>

      <ScrollView
        style={styles.scroll}
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
      >
        <View style={styles.summaryCard}>
          {hubColetaNaBase ? (
            <View style={styles.hubNotice}>
              <MaterialIcons name="warehouse" size={20} color={COLORS.neutral700} />
              <Text style={styles.hubNoticeText}>
                Coleta na sua região com base: um preparador levará o pacote até a base. O trecho após a base não é
                acompanhado pelo app.
              </Text>
            </View>
          ) : null}
          <View style={styles.summaryRow}>
            <Text style={styles.summaryLabel}>Envio para {recipient.name}</Text>
            {!showFeeBreakdown && <Text style={styles.summaryPrice}>{amountFormatted}</Text>}
          </View>
          {showFeeBreakdown && pricingPreview ? (
            <>
              {formatPricingBreakdown(pricingPreview).map((line, idx) => {
                const abs = Math.abs(line.valueCents);
                const val = line.valueCents < 0 ? `- ${formatBRL(abs)}` : formatBRL(abs);
                return line.isTotal ? (
                  <View key={`${line.label}-${idx}`} style={styles.summaryRow}>
                    <Text style={styles.summaryLabel}>{line.label}</Text>
                    <Text style={styles.summaryPrice}>{val}</Text>
                  </View>
                ) : (
                  <View key={`${line.label}-${idx}`} style={styles.summaryFeeRow}>
                    <Text style={styles.summaryMeta}>{line.label}</Text>
                    <Text style={styles.summaryMeta}>{val}</Text>
                  </View>
                );
              })}
            </>
          ) : showFeeBreakdown ? (
            <>
              <View style={styles.summaryFeeRow}>
                <Text style={styles.summaryMeta}>Subtotal</Text>
                <Text style={styles.summaryMeta}>{formatBRL(pricingSubtotalCents)}</Text>
              </View>
              <View style={styles.summaryFeeRow}>
                <Text style={styles.summaryMeta}>Taxa administrativa</Text>
                <Text style={styles.summaryMeta}>{formatBRL(platformFeeCents)}</Text>
              </View>
              <View style={styles.summaryRow}>
                <Text style={styles.summaryLabel}>Total</Text>
                <Text style={styles.summaryPrice}>{amountFormatted}</Text>
              </View>
            </>
          ) : null}
          {!showFeeBreakdown && (
            <Text style={styles.summaryMetaNote}>Valor total já inclui taxa quando aplicável.</Text>
          )}
          <Text style={styles.summaryDynamicPriceNote}>
            O valor final pode variar conforme o horário de solicitação e da partida.
          </Text>
          {showFeeBreakdown && <View style={styles.summarySpacer} />}
          <View style={styles.summaryLine}>
            <MaterialIcons name="inventory-2" size={20} color={COLORS.neutral700} />
            <Text style={styles.summaryText}>
              {packageSizeLabel} • {PACKAGE_SIZE_SUBTITLES[packageSize] ?? packageSize}
            </Text>
          </View>
          <View style={styles.summaryLine}>
            <Text style={styles.summaryText} numberOfLines={1}>{origin.address}</Text>
          </View>
          <View style={styles.summaryLine}>
            <Text style={styles.summaryText} numberOfLines={1}>{destination.address}</Text>
          </View>
          <Text style={styles.summaryMeta}>Data de envio: {whenOption === 'later' ? whenLabel : 'Agora'}</Text>
          <Text style={styles.summaryMeta}>
            Destinatário: {recipient.name} • {recipient.phone}
          </Text>
          {recipient.instructions ? (
            <Text style={styles.summaryMeta}>Observações: {recipient.instructions}</Text>
          ) : null}
        </View>

        <PaymentMethodSection
          amountCents={pricingSnapshot.amount_cents}
          selectedMethod={selectedPaymentMethod}
          onSelectMethod={setSelectedPaymentMethod}
          onConfirmPayment={handleConfirmPayment}
          confirmLabel="Confirmar envio"
          cancellationPolicyVariant={cancellationVariant}
          loading={submitting}
        />
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: COLORS.background },
  header: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 24, marginBottom: 16 },
  backButton: { marginRight: 12 },
  headerTitle: { fontSize: 18, fontWeight: '600', color: COLORS.black, flex: 1 },
  scroll: { flex: 1 },
  scrollContent: { paddingHorizontal: 24, paddingBottom: 32 },
  summaryCard: {
    backgroundColor: COLORS.neutral300,
    borderRadius: 12,
    padding: 16,
    marginBottom: 24,
  },
  hubNotice: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 10,
    marginBottom: 14,
    paddingBottom: 14,
    borderBottomWidth: 1,
    borderBottomColor: COLORS.neutral400,
  },
  hubNoticeText: { flex: 1, fontSize: 13, color: COLORS.neutral700, lineHeight: 18 },
  summaryRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 },
  summaryFeeRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 },
  summaryLabel: { fontSize: 16, fontWeight: '600', color: COLORS.black },
  summaryPrice: { fontSize: 18, fontWeight: '700', color: COLORS.black },
  summaryMetaNote: { fontSize: 12, color: COLORS.neutral700, marginBottom: 4 },
  summaryDynamicPriceNote: { fontSize: 12, color: COLORS.neutral700, marginBottom: 8, fontStyle: 'italic' },
  summarySpacer: { height: 8 },
  summaryLine: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 6 },
  summaryText: { fontSize: 14, color: COLORS.black, flex: 1 },
  summaryMeta: { fontSize: 13, color: COLORS.neutral700, marginTop: 4 },
  primaryButton: {
    backgroundColor: COLORS.black,
    paddingVertical: 16,
    borderRadius: 12,
    alignItems: 'center',
    marginTop: 8,
  },
  primaryButtonDisabled: { opacity: 0.6 },
  primaryButtonText: { fontSize: 16, fontWeight: '600', color: '#FFFFFF' },
});
