/**
 * Tela do Pix REAL (provedor escolhido no gestor — ex.: Asaas). Modelo OPOSTO ao
 * da PixPaliativoScreen (que fica intocada): aqui a cobrança é criada PELO
 * SERVIDOR (`create-pix-charge` recalcula o preço, insere o booking `pending`
 * segurando a vaga e devolve QR + copia-e-cola + expires_at) e esta tela apenas
 * OBSERVA o resultado — realtime em `pix_charges` + polling de 5s SEMPRE ativo.
 * Nada é "efetivado" no cliente. Params 100% serializáveis ⇒ a cobrança pode ser
 * retomada após cold start (usePendingPixChargeResume).
 *
 * Máquina de estados: creating → awaiting → paid | expired (com "Gerar novo
 * código"); creating pode cair em create_error (retry). paid_orphan e
 * amount_mismatch do servidor viram estado informativo (irregular), sem crash.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  View,
  StyleSheet,
  TouchableOpacity,
  Image,
  Clipboard,
  ActivityIndicator,
  AppState,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';
import { MaterialIcons } from '@expo/vector-icons';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { Text } from '../../components/Text';
import type {
  ShipmentStackParamList,
  DependentShipmentStackParamList,
  TripStackParamList,
  PaymentConfirmedBookingParam,
  TripLiveDriverDisplay,
  TripPixSuccessNavParam,
} from '../../navigation/types';
import { supabase } from '../../lib/supabase';
import { formatShipmentCode } from '@take-me/shared';
import { createPixCharge, getPixChargeStatus, type PixChargeCreated } from '../../lib/pixCharge';
import { setPendingPixCharge, clearPendingPixCharge } from '../../lib/pixChargeStorage';
import { invalidatePixProviderModeCache } from '../../lib/pixProviderConfig';
import { useAppAlert } from '../../contexts/AppAlertContext';

// A tela é registrada nas DUAS stacks (viagem e encomenda) e precisa navegar
// para destinos de ambas. O param list combinado expressa isso sem cast.
type PixPaymentParamList = TripStackParamList &
  Pick<ShipmentStackParamList, 'ShipmentSuccess'> &
  Pick<DependentShipmentStackParamList, 'DependentShipmentSuccess'>;
type Props = NativeStackScreenProps<PixPaymentParamList, 'PixPayment'>;

// Visual alinhado à PixPaliativoScreen (mesma paleta/ritmo de tela).
const COLORS = {
  black: '#0d0d0d',
  grey: '#6B7280',
  greyLight: '#9CA3AF',
  border: '#E5E7EB',
  bg: '#F3F4F6',
  green: '#22A565',
  greenDisabled: '#A7D9C0',
};

const POLL_INTERVAL_MS = 5_000;

type ScreenState = 'creating' | 'create_error' | 'awaiting' | 'paid' | 'expired' | 'irregular';

function formatMMSS(total: number): string {
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

function formatBRL(cents: number): string {
  return (cents / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}

/** Alguns provedores devolvem o PNG já com prefixo data:; normaliza para data URI. */
function toQrDataUri(base64: string | null): string | null {
  if (!base64) return null;
  return base64.startsWith('data:') ? base64 : `data:image/png;base64,${base64}`;
}

export function PixPaymentScreen({ navigation, route }: Props) {
  const params = route.params;
  const isResume = 'resume' in params && params.resume === true;
  const draftParams = isResume ? null : params;
  const isShipment = !isResume && params.service === 'shipment';
  const isDependentShipment = !isResume && params.service === 'dependent_shipment';
  const isExcursion = !isResume && params.service === 'excursion';
  const shipmentSuccessParams = !isResume && params.service === 'shipment' ? params.shipmentSuccess : null;
  // Encomenda não tem successNav (a tela de sucesso é outra); o objeto vazio
  // mantém o resto do componente sem ramificações espalhadas.
  const successNav: TripPixSuccessNavParam = (isResume
    ? params.stored.successNav
    : params.successNav) ?? ({} as TripPixSuccessNavParam);

  const { showAlert } = useAppAlert();

  const [state, setState] = useState<ScreenState>(isResume ? 'awaiting' : 'creating');
  const [charge, setCharge] = useState<PixChargeCreated | null>(() =>
    isResume
      ? {
          pixChargeId: params.stored.pixChargeId,
          entityType: params.stored.service,
          entityId: params.stored.entityId,
          amountCents: params.stored.amountCents,
          qrPayload: params.stored.qrPayload,
          qrImageBase64: params.stored.qrImageBase64,
          expiresAt: params.stored.expiresAt,
        }
      : null,
  );
  const [createError, setCreateError] = useState<string | null>(null);
  const [irregularMessage, setIrregularMessage] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [manualChecking, setManualChecking] = useState(false);
  const [manualCheckNote, setManualCheckNote] = useState<string | null>(null);
  const [qrImageFailed, setQrImageFailed] = useState(false);
  const [nowMs, setNowMs] = useState(() => Date.now());

  const paidRef = useRef(false);
  const creatingRef = useRef(false);
  const checkInFlightRef = useRef(false);

  const amountCents = charge?.amountCents ?? (draftParams ? draftParams.estimatedAmountCents : 0);
  const expiresAtMs = charge ? new Date(charge.expiresAt).getTime() : 0;
  // Countdown REAL: derivado de expires_at recalculado por Date.now() (não um
  // contador local) — sobrevive a background/foreground sem desviar.
  const secondsLeft = charge
    ? Math.max(0, Math.ceil(((Number.isFinite(expiresAtMs) ? expiresAtMs : 0) - nowMs) / 1000))
    : 0;

  /** Pago: limpa a pendência e navega para o sucesso com id/valor DO SERVIDOR. */
  const handlePaid = useCallback(
    (entityIdFromServer?: string | null) => {
      if (paidRef.current) return;
      paidRef.current = true;
      setState('paid');
      void clearPendingPixCharge();
      const current = charge;
      const bookingId =
        (entityIdFromServer && entityIdFromServer.trim()) || current?.entityId || '';
      const paidAmountCents = current?.amountCents ?? amountCents;
      const booking: PaymentConfirmedBookingParam = {
        booking_id: bookingId,
        origin_address: successNav.originAddress,
        destination_address: successNav.destinationAddress,
        departure: successNav.departure,
        arrival: successNav.arrival,
        amount_cents: paidAmountCents,
        driver_name: successNav.driverName,
      };
      const tripLive: TripLiveDriverDisplay = {
        driverName: successNav.driverName,
        rating: successNav.driverRating,
        vehicleLabel: successNav.vehicleLabel,
        amountCents: paidAmountCents,
        bookingId: bookingId || undefined,
        scheduledTripId: successNav.scheduledTripId,
        origin: successNav.origin,
        destination: successNav.destination,
      };
      if (isShipment) {
        // Encomenda tem tela de sucesso própria; o id do servidor é o da
        // encomenda criada junto com a cobrança.
        navigation.replace('ShipmentSuccess', {
          orderId: bookingId ? formatShipmentCode(bookingId) : '----',
          shipmentId: bookingId || undefined,
          isLargePackage: shipmentSuccessParams?.isLargePackage ?? false,
          paymentProcessed: true,
        });
        return;
      }
      if (isExcursion) {
        // A excursão não tem tela de sucesso própria: o orçamento (que já
        // existia) volta aprovado. goBack devolve para ele, que recarrega ao
        // ganhar foco.
        navigation.goBack();
        return;
      }
      if (isDependentShipment) {
        // Envio de dependente também tem tela de sucesso própria.
        navigation.replace('DependentShipmentSuccess', {
          orderId: bookingId ? formatShipmentCode(bookingId) : '----',
          shipmentId: bookingId || undefined,
        });
        return;
      }
      navigation.replace('PaymentConfirmed', {
        booking,
        immediateTrip: successNav.immediateTrip,
        tripLive,
        paymentMethod: 'pix',
      });
    },
    [
      charge,
      amountCents,
      navigation,
      successNav,
      isShipment,
      shipmentSuccessParams,
      isDependentShipment,
      isExcursion,
    ],
  );

  /** Consulta o status (polling/realtime/manual) e aplica a transição adequada. */
  const checkStatus = useCallback(
    async (source: 'auto' | 'manual') => {
      const current = charge;
      if (!current || paidRef.current || checkInFlightRef.current) return;
      checkInFlightRef.current = true;
      if (source === 'manual') {
        setManualChecking(true);
        setManualCheckNote(null);
      }
      try {
        const res = await getPixChargeStatus(current.pixChargeId);
        if (!res.ok) {
          if (source === 'manual') {
            setManualCheckNote('Não foi possível verificar agora. Tente novamente em instantes.');
          }
          return;
        }
        if (res.status === 'paid') {
          handlePaid(res.entityId);
          return;
        }
        if (res.status === 'expired' || res.status === 'cancelled' || res.status === 'create_failed') {
          void clearPendingPixCharge();
          setState('expired');
          return;
        }
        if (res.status === 'paid_orphan') {
          void clearPendingPixCharge();
          setIrregularMessage(
            'Recebemos um pagamento após a expiração do código, então a reserva não foi confirmada. Nossa equipe fará a devolução do valor.',
          );
          setState('irregular');
          return;
        }
        if (res.status === 'amount_mismatch') {
          void clearPendingPixCharge();
          setIrregularMessage(
            'O valor pago não confere com o valor da cobrança. Nossa equipe vai analisar e tratar a devolução, se for o caso.',
          );
          setState('irregular');
          return;
        }
        // pending: segue aguardando; o servidor pode ter corrigido o expires_at.
        if (res.expiresAt && res.expiresAt !== current.expiresAt) {
          const fixed = res.expiresAt;
          setCharge((c) => (c && c.pixChargeId === current.pixChargeId ? { ...c, expiresAt: fixed } : c));
        }
        if (source === 'manual') {
          setManualCheckNote(
            'Ainda não identificamos o pagamento. Se você acabou de pagar, aguarde alguns segundos — a confirmação é automática.',
          );
        }
      } finally {
        checkInFlightRef.current = false;
        if (source === 'manual') setManualChecking(false);
      }
    },
    [charge, handlePaid],
  );

  /** Cria (ou recria, no "Gerar novo código") a cobrança no servidor. */
  const runCreate = useCallback(async () => {
    if (!draftParams || creatingRef.current || paidRef.current) return;
    creatingRef.current = true;
    setState('creating');
    setCreateError(null);
    setManualCheckNote(null);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) {
        setCreateError('Sessão expirada. Faça login novamente para concluir o pagamento.');
        setState('create_error');
        return;
      }
      const res = await createPixCharge(
        draftParams.service === 'shipment'
          ? {
              service: 'shipment',
              cpf: draftParams.cpf,
              shipmentDraft: draftParams.shipmentDraft,
            }
          : draftParams.service === 'dependent_shipment'
            ? {
                service: 'dependent_shipment',
                cpf: draftParams.cpf,
                dependentDraft: draftParams.dependentDraft,
              }
            : draftParams.service === 'excursion'
              ? {
                  service: 'excursion',
                  cpf: draftParams.cpf,
                  excursionRequestId: draftParams.excursionRequestId,
                }
              : {
                  service: 'booking',
                  cpf: draftParams.cpf,
                  draft: draftParams.draft,
                },
      );
      if (!res.ok) {
        if (res.code === 'palliative_mode') {
          // Flag mudou para paliativo entre a leitura e a criação: invalida o
          // cache e devolve ao checkout — confirmar de novo cai no fluxo antigo.
          invalidatePixProviderModeCache();
          showAlert(
            'Pix',
            'O pagamento Pix está no fluxo padrão neste momento. Toque em "Confirmar pagamento" novamente.',
          );
          navigation.goBack();
          return;
        }
        if (res.code === 'cpf_required') {
          showAlert(
            'CPF necessário',
            'Precisamos de um CPF válido para gerar a cobrança Pix. Informe o CPF e confirme novamente.',
          );
          navigation.goBack();
          return;
        }
        setCreateError(res.message || 'Não foi possível gerar o código Pix. Tente novamente.');
        setState('create_error');
        return;
      }
      setCharge(res.charge);
      setQrImageFailed(false);
      setNowMs(Date.now());
      setState('awaiting');
      // Retomada ("você tem um Pix pendente") é só de viagem por enquanto. Na
      // encomenda e no envio de dependente, fechar o app no meio deixa o QR
      // expirar em 15 min — o cron cancela o pedido e nada fica pago sem pedido.
      if (draftParams.service === 'booking') {
      await setPendingPixCharge({
        userId: user.id,
        service: 'booking',
        pixChargeId: res.charge.pixChargeId,
        entityId: res.charge.entityId,
        amountCents: res.charge.amountCents,
        qrPayload: res.charge.qrPayload,
        qrImageBase64: res.charge.qrImageBase64,
        expiresAt: res.charge.expiresAt,
        createdAt: new Date().toISOString(),
        successNav,
      });
      }
    } finally {
      creatingRef.current = false;
    }
  }, [draftParams, navigation, showAlert, successNav]);

  // Montagem: cria a cobrança (fluxo normal) ou revalida a retomada (o status
  // pode ter mudado enquanto o app esteve fechado).
  useEffect(() => {
    if (isResume) {
      void checkStatus('auto');
    } else {
      void runCreate();
    }
    // Somente na montagem — retries são explícitos (botões).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Relógio de 1s + AppState: ao voltar ao foreground, recalcula o countdown
  // por Date.now() e verifica o status imediatamente.
  useEffect(() => {
    if (state !== 'awaiting') return;
    const tickId = setInterval(() => setNowMs(Date.now()), 1000);
    const sub = AppState.addEventListener('change', (s) => {
      if (s === 'active') {
        setNowMs(Date.now());
        void checkStatus('auto');
      }
    });
    return () => {
      clearInterval(tickId);
      sub.remove();
    };
  }, [state, checkStatus]);

  // Polling de 5s SEMPRE ativo enquanto aguarda (fallback do realtime; o
  // get-pix-charge-status também se auto-corrige consultando o provedor).
  useEffect(() => {
    if (state !== 'awaiting') return;
    const id = setInterval(() => {
      void checkStatus('auto');
    }, POLL_INTERVAL_MS);
    return () => clearInterval(id);
  }, [state, checkStatus]);

  // Realtime na linha da cobrança (padrão do TripDetailScreen): qualquer UPDATE
  // dispara uma consulta de status — não confiamos no payload do evento.
  useEffect(() => {
    if (state !== 'awaiting' || !charge?.pixChargeId) return;
    const channel = supabase
      .channel(`pix-charge-${charge.pixChargeId}`)
      .on(
        'postgres_changes' as never,
        {
          event: 'UPDATE',
          schema: 'public',
          table: 'pix_charges',
          filter: `id=eq.${charge.pixChargeId}`,
        } as never,
        () => {
          void checkStatus('auto');
        },
      )
      .subscribe();
    return () => {
      void supabase.removeChannel(channel);
    };
  }, [state, charge?.pixChargeId, checkStatus]);

  // Countdown zerou: uma última verificação (pago no último segundo) antes de
  // marcar como expirado localmente — o cron do servidor expira de verdade.
  const locallyExpired = state === 'awaiting' && charge != null && secondsLeft <= 0;
  useEffect(() => {
    if (!locallyExpired) return;
    let cancelled = false;
    void (async () => {
      await checkStatus('auto');
      if (!cancelled && !paidRef.current) {
        setState((s) => (s === 'awaiting' ? 'expired' : s));
        void clearPendingPixCharge();
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [locallyExpired, checkStatus]);

  const copyCode = useCallback(() => {
    if (!charge) return;
    try {
      Clipboard.setString(charge.qrPayload);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      /* ignore */
    }
  }, [charge]);

  const qrUri = !qrImageFailed ? toQrDataUri(charge?.qrImageBase64 ?? null) : null;

  // ——— Estados terminais/transientes fora do layout principal ———

  if (state === 'creating') {
    return (
      <SafeAreaView style={styles.container} edges={['top']}>
        <StatusBar style="dark" />
        <View style={styles.navbar}>
          <TouchableOpacity style={styles.navBtn} onPress={() => navigation.goBack()} activeOpacity={0.7}>
            <MaterialIcons name="close" size={24} color={COLORS.black} />
          </TouchableOpacity>
        </View>
        <View style={styles.centered}>
          <ActivityIndicator size="large" color={COLORS.black} />
          <Text style={styles.centeredText}>Gerando o código Pix…</Text>
          <Text style={styles.centeredHint}>Sua vaga fica reservada enquanto o pagamento é aguardado.</Text>
        </View>
      </SafeAreaView>
    );
  }

  if (state === 'create_error') {
    return (
      <SafeAreaView style={styles.container} edges={['top']}>
        <StatusBar style="dark" />
        <View style={styles.navbar}>
          <TouchableOpacity style={styles.navBtn} onPress={() => navigation.goBack()} activeOpacity={0.7}>
            <MaterialIcons name="close" size={24} color={COLORS.black} />
          </TouchableOpacity>
        </View>
        <View style={styles.centered}>
          <MaterialIcons name="error-outline" size={40} color="#B91C1C" />
          <Text style={styles.errorText}>{createError ?? 'Não foi possível gerar o código Pix.'}</Text>
          <TouchableOpacity style={styles.confirmBtn} onPress={() => void runCreate()} activeOpacity={0.85}>
            <Text style={styles.confirmBtnText}>Tentar novamente</Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.secondaryBtn} onPress={() => navigation.goBack()} activeOpacity={0.8}>
            <Text style={styles.secondaryBtnText}>Voltar</Text>
          </TouchableOpacity>
        </View>
      </SafeAreaView>
    );
  }

  if (state === 'expired') {
    return (
      <SafeAreaView style={styles.container} edges={['top']}>
        <StatusBar style="dark" />
        <View style={styles.navbar}>
          <TouchableOpacity style={styles.navBtn} onPress={() => navigation.goBack()} activeOpacity={0.7}>
            <MaterialIcons name="close" size={24} color={COLORS.black} />
          </TouchableOpacity>
        </View>
        <View style={styles.centered}>
          <MaterialIcons name="schedule" size={40} color="#B91C1C" />
          <Text style={styles.expiredTitle}>Código Pix expirado</Text>
          <Text style={styles.centeredHint}>
            {draftParams
              ? 'O tempo para pagar acabou e a reserva anterior foi liberada. Gere um novo código para tentar de novo.'
              : 'O tempo para pagar acabou e a reserva foi liberada. Refaça a solicitação da viagem para gerar um novo código.'}
          </Text>
          {draftParams ? (
            <TouchableOpacity style={styles.confirmBtn} onPress={() => void runCreate()} activeOpacity={0.85}>
              <Text style={styles.confirmBtnText}>Gerar novo código</Text>
            </TouchableOpacity>
          ) : null}
          <TouchableOpacity style={styles.secondaryBtn} onPress={() => navigation.goBack()} activeOpacity={0.8}>
            <Text style={styles.secondaryBtnText}>Voltar</Text>
          </TouchableOpacity>
        </View>
      </SafeAreaView>
    );
  }

  if (state === 'irregular') {
    return (
      <SafeAreaView style={styles.container} edges={['top']}>
        <StatusBar style="dark" />
        <View style={styles.navbar}>
          <TouchableOpacity style={styles.navBtn} onPress={() => navigation.goBack()} activeOpacity={0.7}>
            <MaterialIcons name="close" size={24} color={COLORS.black} />
          </TouchableOpacity>
        </View>
        <View style={styles.centered}>
          <MaterialIcons name="info-outline" size={40} color={COLORS.grey} />
          <Text style={styles.errorText}>
            {irregularMessage ?? 'Este pagamento precisa de análise da nossa equipe.'}
          </Text>
          <TouchableOpacity style={styles.secondaryBtn} onPress={() => navigation.goBack()} activeOpacity={0.8}>
            <Text style={styles.secondaryBtnText}>Voltar</Text>
          </TouchableOpacity>
        </View>
      </SafeAreaView>
    );
  }

  if (state === 'paid' || !charge) {
    // paid: navigation.replace já foi disparado — evita flash de conteúdo.
    return (
      <SafeAreaView style={styles.container} edges={['top']}>
        <StatusBar style="dark" />
        <View style={styles.centered}>
          <ActivityIndicator size="large" color={COLORS.green} />
        </View>
      </SafeAreaView>
    );
  }

  // ——— awaiting ———
  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <StatusBar style="dark" />
      <View style={styles.navbar}>
        <TouchableOpacity style={styles.navBtn} onPress={() => navigation.goBack()} activeOpacity={0.7}>
          <MaterialIcons name="close" size={24} color={COLORS.black} />
        </TouchableOpacity>
      </View>

      <View style={styles.content}>
        <Text style={styles.pixLabel}>Pix</Text>
        <Text style={styles.amount}>{formatBRL(amountCents)}</Text>
        <Text style={styles.instructions}>
          Use o aplicativo do seu banco para escanear o código QR ou copie o código PIX abaixo. A
          confirmação é automática assim que o pagamento for identificado.
        </Text>

        {qrUri ? (
          <View style={styles.qrWrap}>
            <Image
              source={{ uri: qrUri }}
              style={styles.qr}
              resizeMode="contain"
              onError={() => setQrImageFailed(true)}
            />
          </View>
        ) : (
          <View style={[styles.qrWrap, styles.qrFallback]}>
            <MaterialIcons name="qr-code-2" size={56} color={COLORS.greyLight} />
            <Text style={styles.qrFallbackText}>
              QR indisponível — use o código copia-e-cola abaixo.
            </Text>
          </View>
        )}

        <Text style={styles.timer}>Você tem {formatMMSS(secondsLeft)} para pagar</Text>

        <View style={styles.codeBox}>
          <Text style={styles.codeText} numberOfLines={1}>{charge.qrPayload}</Text>
        </View>
        <TouchableOpacity style={styles.copyBtn} onPress={copyCode} activeOpacity={0.8}>
          <MaterialIcons name="content-copy" size={18} color="#FFFFFF" />
          <Text style={styles.copyBtnText}>{copied ? 'Código copiado!' : 'Copiar código PIX'}</Text>
        </TouchableOpacity>

        {manualCheckNote ? <Text style={styles.checkNote}>{manualCheckNote}</Text> : null}

        <TouchableOpacity
          style={[styles.confirmBtn, manualChecking && styles.confirmBtnDisabled]}
          onPress={() => void checkStatus('manual')}
          disabled={manualChecking}
          activeOpacity={0.85}
        >
          {manualChecking ? (
            <ActivityIndicator size="small" color="#FFFFFF" />
          ) : (
            <Text style={styles.confirmBtnText}>Já paguei — verificar</Text>
          )}
        </TouchableOpacity>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#FFFFFF' },
  centered: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24, gap: 16 },
  centeredText: { fontSize: 16, fontWeight: '600', color: COLORS.black, textAlign: 'center' },
  centeredHint: { fontSize: 14, color: COLORS.grey, textAlign: 'center', lineHeight: 20 },
  errorText: { fontSize: 15, color: COLORS.grey, textAlign: 'center', lineHeight: 22 },
  expiredTitle: { fontSize: 18, fontWeight: '700', color: COLORS.black, textAlign: 'center' },
  navbar: { height: 48, justifyContent: 'center', paddingHorizontal: 14 },
  navBtn: { width: 40, height: 40, borderRadius: 20, alignItems: 'center', justifyContent: 'center' },
  content: { flex: 1, alignItems: 'center', paddingHorizontal: 28, paddingTop: 8 },
  pixLabel: { fontSize: 18, fontWeight: '700', color: COLORS.black, marginBottom: 8 },
  amount: { fontSize: 28, fontWeight: '800', color: COLORS.black, marginBottom: 12 },
  instructions: { fontSize: 14, color: COLORS.grey, textAlign: 'center', lineHeight: 20, marginBottom: 20 },
  qrWrap: {
    width: 220, height: 220, alignItems: 'center', justifyContent: 'center',
    borderWidth: 1, borderColor: COLORS.border, borderRadius: 12, padding: 8, marginBottom: 16,
  },
  qr: { width: '100%', height: '100%' },
  qrFallback: { gap: 8 },
  qrFallbackText: { fontSize: 12, color: COLORS.greyLight, textAlign: 'center', paddingHorizontal: 8 },
  timer: { fontSize: 14, color: COLORS.grey, marginBottom: 16 },
  codeBox: {
    width: '100%', backgroundColor: COLORS.bg, borderRadius: 10, paddingHorizontal: 16, paddingVertical: 14,
    marginBottom: 12,
  },
  codeText: { fontSize: 14, color: COLORS.black },
  copyBtn: {
    width: '100%', flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8,
    backgroundColor: '#4B5563', borderRadius: 10, paddingVertical: 14, marginBottom: 24,
  },
  copyBtnText: { fontSize: 15, fontWeight: '600', color: '#FFFFFF' },
  checkNote: { fontSize: 13, color: COLORS.grey, textAlign: 'center', marginBottom: 12 },
  confirmBtn: {
    width: '100%', backgroundColor: COLORS.green, borderRadius: 12, paddingVertical: 16, alignItems: 'center',
  },
  confirmBtnDisabled: { backgroundColor: COLORS.greenDisabled },
  confirmBtnText: { fontSize: 16, fontWeight: '800', color: '#FFFFFF' },
  secondaryBtn: { borderWidth: 1, borderColor: COLORS.black, borderRadius: 999, paddingHorizontal: 24, paddingVertical: 12 },
  secondaryBtnText: { fontSize: 14, fontWeight: '600', color: COLORS.black },
});
