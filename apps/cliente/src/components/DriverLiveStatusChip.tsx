import { memo } from 'react';
import { View, StyleSheet, ActivityIndicator } from 'react-native';
import { Text } from './Text';

type Props = {
  /** True quando ainda não há nenhuma posição recebida do motorista. */
  loading: boolean;
  /** True quando há posição mas o último fix é antigo (motorista provavelmente sem rede). */
  isStale: boolean;
  /** Idade do último fix em ms — usado para formatar "há Xmin". */
  ageMs: number | null;
  /** Em modo `mapFocused` o mapa ocupa tela toda; o chip desce para liberar o header. */
  mapFocused: boolean;
  /** Inset superior do safe area — para posicionar abaixo do notch quando focado. */
  topInset: number;
};

function formatAgeBrief(ms: number | null): string {
  if (ms == null || !Number.isFinite(ms)) return '';
  const sec = Math.floor(ms / 1000);
  if (sec < 60) return `há ${sec}s`;
  const min = Math.floor(sec / 60);
  if (min < 60) return `há ${min} min`;
  const h = Math.floor(min / 60);
  const remMin = min % 60;
  return remMin > 0 ? `há ${h}h ${remMin}min` : `há ${h}h`;
}

/**
 * Sinalizador discreto sobre o mapa para o estado da posição live do motorista:
 *  - `loading=true` (sem fix ainda): "Aguardando motorista" com spinner.
 *  - `isStale=true` (fix antigo): "Última atualização há Xmin" — o pin permanece no
 *    último local conhecido, mas o usuário sabe que o motorista pode estar sem rede.
 *  - Caso normal: não renderiza nada.
 *
 * Não bloqueia interação com o mapa (`pointerEvents="none"`).
 */
export const DriverLiveStatusChip = memo(function DriverLiveStatusChip({
  loading,
  isStale,
  ageMs,
  mapFocused,
  topInset,
}: Props) {
  if (!loading && !isStale) return null;

  const top = mapFocused ? topInset + 56 : 16;

  return (
    <View pointerEvents="none" style={[styles.wrap, { top }]}>
      <View style={styles.chip}>
        {loading ? (
          <>
            <ActivityIndicator size="small" color="#fff" style={styles.spinner} />
            <Text style={styles.text}>Aguardando motorista…</Text>
          </>
        ) : (
          <Text style={styles.text}>Última atualização {formatAgeBrief(ageMs)}</Text>
        )}
      </View>
    </View>
  );
});

const styles = StyleSheet.create({
  wrap: {
    position: 'absolute',
    left: 0,
    right: 0,
    alignItems: 'center',
  },
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 6,
    paddingHorizontal: 12,
    borderRadius: 999,
    backgroundColor: 'rgba(17,24,39,0.85)',
  },
  spinner: { marginRight: 6 },
  text: {
    color: '#fff',
    fontSize: 12,
    fontWeight: '600',
  },
});
