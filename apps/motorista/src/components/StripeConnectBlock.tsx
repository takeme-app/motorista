import { View, TouchableOpacity, StyleSheet, ActivityIndicator } from 'react-native';
import { Text } from './Text';
import { MaterialIcons } from '@expo/vector-icons';
import type { StripeConnectState } from '../lib/motoristaAccess';

/** Cores compartilhadas entre telas que mostram o estado do Stripe Connect. */
export const STRIPE_BLOCK_COLORS = {
  WARN_BG: '#FFFBEB',
  WARN_BORDER: '#F5D78A',
  WARN_TITLE: '#92400E',
  SUCCESS: '#16A34A',
  SUCCESS_BG: '#F0FDF4',
  SUCCESS_BORDER: '#BBF7D0',
  MUTED: '#6B7280',
  SUBTLE: '#9CA3AF',
  INK: '#111827',
} as const;

type StripeBlockCopy = {
  title: string;
  subtitle: string;
  ctaLabel: string;
  tone: 'warn' | 'neutral';
};

function stripeBlockCopy(
  state: StripeConnectState,
  pendingVerificationCount: number,
): StripeBlockCopy | null {
  switch (state) {
    case 'active':
      return null;
    case 'in_review':
      return {
        title: 'Ação pendente na Stripe',
        subtitle:
          pendingVerificationCount > 0
            ? 'Falta concluir algo para liberar cartão/Pix; até lá, as viagens ficam em dinheiro e a taxa acumula saldo.'
            : 'Aguardando aprovação da Stripe. Enquanto isso, viagens ficam em dinheiro e a taxa acumula saldo.',
        ctaLabel: 'Revisar cadastro',
        tone: 'warn',
      };
    case 'action_required':
      return {
        title: 'A Stripe pediu informações adicionais',
        subtitle: 'Complete o formulário para liberar cartão/Pix e permitir o abate automático do saldo devido.',
        ctaLabel: 'Completar cadastro',
        tone: 'warn',
      };
    case 'incomplete':
      return {
        title: 'Cadastro Stripe incompleto',
        subtitle: 'Finalize o cadastro para liberar cartão/Pix. Sem Connect aprovado, as viagens ficam em dinheiro.',
        ctaLabel: 'Retomar cadastro',
        tone: 'warn',
      };
    case 'none':
    default:
      return {
        title: 'Ativar recebimento automático',
        subtitle: 'Libere cartão/Pix e abata automaticamente as taxas acumuladas de corridas em dinheiro.',
        ctaLabel: 'Configurar Stripe',
        tone: 'neutral',
      };
  }
}

export type StripeConnectBlockProps = {
  state: StripeConnectState;
  pendingVerificationCount: number;
  loading: boolean;
  onPressSetup: () => void;
  showExpressLink: boolean;
  expressLoginLoading: boolean;
  onPressExpress: () => void;
};

export function StripeConnectBlock({
  state,
  pendingVerificationCount,
  loading,
  onPressSetup,
  showExpressLink,
  expressLoginLoading,
  onPressExpress,
}: StripeConnectBlockProps) {
  if (state === 'active') {
    return (
      <View style={styles.statusActive}>
        <MaterialIcons name="check-circle" size={18} color={STRIPE_BLOCK_COLORS.SUCCESS} />
        <Text style={styles.statusActiveText}>Recebimento automático ativo</Text>
      </View>
    );
  }

  const copy = stripeBlockCopy(state, pendingVerificationCount);
  if (!copy) return null;

  const isWarn = copy.tone === 'warn';

  return (
    <View style={[styles.stripeBlock, isWarn ? styles.stripeBlockWarn : styles.stripeBlockNeutral]}>
      <View style={styles.stripeBlockHeader}>
        {isWarn ? (
          <MaterialIcons
            name="info-outline"
            size={18}
            color={STRIPE_BLOCK_COLORS.WARN_TITLE}
            style={{ marginRight: 8 }}
          />
        ) : null}
        <Text style={[styles.stripeBlockTitle, isWarn && { color: STRIPE_BLOCK_COLORS.WARN_TITLE }]}>
          {copy.title}
        </Text>
      </View>
      <Text style={styles.stripeBlockSubtitle}>{copy.subtitle}</Text>

      <TouchableOpacity
        style={[styles.stripeCta, isWarn ? styles.stripeCtaWarn : styles.stripeCtaNeutral]}
        onPress={onPressSetup}
        disabled={loading}
        activeOpacity={0.85}
      >
        {loading ? (
          <ActivityIndicator size="small" color="#FFFFFF" />
        ) : (
          <>
            <Text style={styles.stripeCtaText}>{copy.ctaLabel}</Text>
            <MaterialIcons name="arrow-forward" size={16} color="#FFFFFF" />
          </>
        )}
      </TouchableOpacity>

      {showExpressLink ? (
        <TouchableOpacity
          style={styles.expressLink}
          onPress={onPressExpress}
          disabled={expressLoginLoading || loading}
          activeOpacity={0.7}
        >
          <Text style={styles.expressLinkText}>
            {expressLoginLoading ? 'Abrindo painel Stripe…' : 'Abrir painel Stripe'}
          </Text>
        </TouchableOpacity>
      ) : null}
    </View>
  );
}

/** Estilo uppercase/tracking usado pelas duas telas de pagamento para títulos de seção. */
export const paymentsSectionTitleStyle = {
  fontSize: 13,
  fontWeight: '700' as const,
  color: STRIPE_BLOCK_COLORS.SUBTLE,
  textTransform: 'uppercase' as const,
  letterSpacing: 0.6,
  marginBottom: 12,
};

const styles = StyleSheet.create({
  stripeBlock: {
    borderRadius: 14,
    padding: 16,
    borderWidth: 1,
    marginBottom: 12,
  },
  stripeBlockWarn: {
    backgroundColor: STRIPE_BLOCK_COLORS.WARN_BG,
    borderColor: STRIPE_BLOCK_COLORS.WARN_BORDER,
  },
  stripeBlockNeutral: { backgroundColor: '#F9FAFB', borderColor: '#E5E7EB' },
  stripeBlockHeader: { flexDirection: 'row', alignItems: 'center', marginBottom: 4 },
  stripeBlockTitle: {
    fontSize: 15,
    fontWeight: '700',
    color: STRIPE_BLOCK_COLORS.INK,
    flexShrink: 1,
  },
  stripeBlockSubtitle: {
    fontSize: 13,
    color: STRIPE_BLOCK_COLORS.MUTED,
    lineHeight: 18,
    marginBottom: 12,
  },
  stripeCta: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    paddingVertical: 12,
    borderRadius: 10,
  },
  stripeCtaWarn: { backgroundColor: '#B45309' },
  stripeCtaNeutral: { backgroundColor: STRIPE_BLOCK_COLORS.INK },
  stripeCtaText: { color: '#FFFFFF', fontSize: 14, fontWeight: '600' },
  expressLink: { alignItems: 'center', paddingVertical: 10, marginTop: 4 },
  expressLinkText: {
    fontSize: 13,
    color: STRIPE_BLOCK_COLORS.WARN_TITLE,
    textDecorationLine: 'underline',
    fontWeight: '500',
  },
  statusActive: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: STRIPE_BLOCK_COLORS.SUCCESS_BG,
    borderWidth: 1,
    borderColor: STRIPE_BLOCK_COLORS.SUCCESS_BORDER,
    borderRadius: 10,
    paddingHorizontal: 14,
    paddingVertical: 10,
    marginBottom: 12,
  },
  statusActiveText: { fontSize: 14, fontWeight: '600', color: STRIPE_BLOCK_COLORS.SUCCESS },
});
