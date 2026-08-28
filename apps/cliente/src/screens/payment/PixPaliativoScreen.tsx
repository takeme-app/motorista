/**
 * Tela paliativa de Pix (Stripe Pix desabilitado). QR + copia-e-cola FIXOS (chave
 * Take Me); o valor é só exibido. Regra: ao abrir, dispara PIX_EFFECTIVATE_SECONDS para
 * EFETIVAR o pedido (sem cobrança real); ao fim o botão "Realizei o Pagamento" habilita e
 * navega para a tela de sucesso do fluxo. A lógica específica vem do registro (palliativePixStore).
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { View, StyleSheet, TouchableOpacity, Image, Clipboard, ActivityIndicator } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';
import { MaterialIcons } from '@expo/vector-icons';
import { useNavigation, useRoute } from '@react-navigation/native';
import { Text } from '../../components/Text';
import {
  PIX_COPIA_E_COLA,
  PIX_DISPLAY_TIMER_SECONDS,
  PIX_EFFECTIVATE_SECONDS,
} from '../../config/pixPaliativo';
import { getPalliativePix, clearPalliativePix } from '../../lib/palliativePixStore';
import { fetchPalliativePixConfig } from '../../lib/palliativePixConfig';

const COLORS = {
  black: '#0d0d0d',
  grey: '#6B7280',
  greyLight: '#9CA3AF',
  border: '#E5E7EB',
  bg: '#F3F4F6',
  green: '#22A565',
  greenDisabled: '#A7D9C0',
};

function formatMMSS(total: number): string {
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

function formatBRL(cents: number): string {
  return (cents / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}

export function PixPaliativoScreen() {
  const navigation = useNavigation<{ goBack: () => void }>();
  const route = useRoute();
  const requestId = (route.params as { requestId?: string } | undefined)?.requestId ?? '';
  const req = getPalliativePix(requestId);

  const [pixCode, setPixCode] = useState(PIX_COPIA_E_COLA);
  const [qrImageUrl, setQrImageUrl] = useState<string | null>(null);
  const [secondsLeft, setSecondsLeft] = useState(PIX_DISPLAY_TIMER_SECONDS);
  const [canConfirm, setCanConfirm] = useState(false);
  const [effectivating, setEffectivating] = useState(false);
  const [effectivateError, setEffectivateError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const effectivatedRef = useRef(false);
  const navigatedRef = useRef(false);

  const runEffectivate = useCallback(async () => {
    if (effectivatedRef.current || !req) return;
    effectivatedRef.current = true;
    setEffectivating(true);
    setEffectivateError(null);
    try {
      await req.effectivate();
      setCanConfirm(true);
    } catch (e) {
      // Libera para nova tentativa (o botão vira "Tentar novamente").
      effectivatedRef.current = false;
      // Sem este log a causa real ficava invisível: o catch engolia o erro e só
      // sobrava a mensagem genérica, impossível de diagnosticar em produção.
      const msg = e instanceof Error ? e.message : String(e);
      console.warn('[PixPaliativo] falha ao efetivar o pedido:', msg);
      // Reserva duplicada nunca vai passar em nova tentativa (índice parcial
      // bookings_one_active_per_user_trip): "Tentar novamente" viraria loop.
      // Mostra a causa real para o usuário saber o que fazer.
      setEffectivateError(
        /bookings_one_active_per_user_trip/i.test(msg)
          ? 'Você já tem uma reserva nesta viagem. Para mudar a quantidade de lugares, cancele a reserva atual e faça uma nova.'
          : 'Não foi possível concluir agora. Toque em "Tentar novamente".',
      );
    } finally {
      setEffectivating(false);
    }
  }, [req]);

  // Config do Pix (copia-e-cola + QR) vinda do platform_settings (editável pelo admin).
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const cfg = await fetchPalliativePixConfig();
      if (cancelled) return;
      setPixCode(cfg.copiaECola);
      setQrImageUrl(cfg.qrImageUrl);
    })();
    return () => { cancelled = true; };
  }, []);

  // Relógio visual de 5 min + gatilho de PIX_EFFECTIVATE_SECONDS para efetivar.
  useEffect(() => {
    if (!req) return;
    const tickId = setInterval(() => {
      setSecondsLeft((s) => (s > 0 ? s - 1 : 0));
    }, 1000);
    const effId = setTimeout(() => {
      void runEffectivate();
    }, PIX_EFFECTIVATE_SECONDS * 1000);
    return () => {
      clearInterval(tickId);
      clearTimeout(effId);
    };
  }, [req, runEffectivate]);

  const copyCode = useCallback(() => {
    try {
      Clipboard.setString(pixCode);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      /* ignore */
    }
  }, [pixCode]);

  const onConfirm = useCallback(() => {
    if (!canConfirm || !req || navigatedRef.current) return;
    navigatedRef.current = true;
    clearPalliativePix(requestId);
    // Defere para após o frame atual (consistência de navegação/sem travar UI).
    requestAnimationFrame(() => req.navigateSuccess());
  }, [canConfirm, req, requestId]);

  /**
   * A efetivação roda uma única vez (setTimeout). Se falhava, o botão continuava
   * desabilitado e nada reagendava a tentativa — o cliente ficava preso no erro,
   * sem caminho para prosseguir. Aqui o mesmo botão vira "Tentar novamente".
   */
  const canRetry = !canConfirm && !!effectivateError && !effectivating;

  const onPressPrimary = useCallback(() => {
    if (effectivating) return;
    if (canConfirm) {
      onConfirm();
      return;
    }
    if (canRetry) void runEffectivate();
  }, [effectivating, canConfirm, canRetry, onConfirm, runEffectivate]);

  if (!req) {
    return (
      <SafeAreaView style={styles.container} edges={['top']}>
        <StatusBar style="dark" />
        <View style={styles.centered}>
          <Text style={styles.errorText}>Sessão de pagamento expirada. Volte e tente novamente.</Text>
          <TouchableOpacity style={styles.secondaryBtn} onPress={() => navigation.goBack()} activeOpacity={0.8}>
            <Text style={styles.secondaryBtnText}>Voltar</Text>
          </TouchableOpacity>
        </View>
      </SafeAreaView>
    );
  }

  const expired = secondsLeft <= 0;

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
        <Text style={styles.amount}>{formatBRL(req.amountCents)}</Text>
        <Text style={styles.instructions}>
          Use o aplicativo do seu banco para escanear o código QR ou copie o código PIX abaixo para
          concluir o pagamento.
        </Text>

        <View style={styles.qrWrap}>
          <Image
            source={qrImageUrl ? { uri: qrImageUrl } : require('../../../assets/pix-qr.png')}
            style={styles.qr}
            resizeMode="contain"
          />
        </View>

        <Text style={[styles.timer, expired && styles.timerExpired]}>
          {expired ? 'Código expirado' : `Você tem ${formatMMSS(secondsLeft)} para pagar`}
        </Text>

        <View style={styles.codeBox}>
          <Text style={styles.codeText} numberOfLines={1}>{pixCode}</Text>
        </View>
        <TouchableOpacity style={styles.copyBtn} onPress={copyCode} activeOpacity={0.8}>
          <MaterialIcons name="content-copy" size={18} color="#FFFFFF" />
          <Text style={styles.copyBtnText}>{copied ? 'Código copiado!' : 'Copiar código PIX'}</Text>
        </TouchableOpacity>

        {effectivateError ? <Text style={styles.errorInline}>{effectivateError}</Text> : null}

        <TouchableOpacity
          style={[styles.confirmBtn, !canConfirm && !canRetry && styles.confirmBtnDisabled]}
          onPress={onPressPrimary}
          disabled={!canConfirm && !canRetry}
          activeOpacity={0.85}
        >
          {effectivating ? (
            <ActivityIndicator size="small" color="#FFFFFF" />
          ) : (
            <Text style={styles.confirmBtnText}>
              {canRetry ? 'Tentar novamente' : 'Realizei o Pagamento'}
            </Text>
          )}
        </TouchableOpacity>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#FFFFFF' },
  centered: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24, gap: 16 },
  errorText: { fontSize: 15, color: COLORS.grey, textAlign: 'center' },
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
  timer: { fontSize: 14, color: COLORS.grey, marginBottom: 16 },
  timerExpired: { color: '#B91C1C' },
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
  errorInline: { fontSize: 13, color: '#B91C1C', textAlign: 'center', marginBottom: 12 },
  confirmBtn: {
    width: '100%', backgroundColor: COLORS.green, borderRadius: 12, paddingVertical: 16, alignItems: 'center',
  },
  confirmBtnDisabled: { backgroundColor: COLORS.greenDisabled },
  confirmBtnText: { fontSize: 16, fontWeight: '800', color: '#FFFFFF' },
  secondaryBtn: { borderWidth: 1, borderColor: COLORS.black, borderRadius: 999, paddingHorizontal: 24, paddingVertical: 12 },
  secondaryBtnText: { fontSize: 14, fontWeight: '600', color: COLORS.black },
});
