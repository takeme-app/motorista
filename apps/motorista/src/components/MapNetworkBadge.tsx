import { View, StyleSheet, type StyleProp, type ViewStyle } from 'react-native';
import { MaterialIcons } from '@expo/vector-icons';
import { Text } from './Text';

export type MapNetworkBadgeState = 'online' | 'offline-cached' | 'offline-no-cache';

type Props = {
  /**
   * Estado tri-valorado. Para retrocompat, aceita também `online: boolean` —
   * `true`/`false` mapeiam para `'online'` / `'offline-cached'`.
   */
  online?: boolean;
  state?: MapNetworkBadgeState;
  /** Mostrar o badge mesmo online (verde "online"). Default: false. */
  showWhenOnline?: boolean;
  style?: StyleProp<ViewStyle>;
};

/**
 * Badge sutil para o overlay do mapa indicar o estado de rede.
 *
 * - `online`: oculto por padrão; verde se `showWhenOnline`.
 * - `offline-cached`: cinza/escuro — basemap segue (pack baixado) e a polyline
 *    cacheada é exibida.
 * - `offline-no-cache`: âmbar — sem internet e sem rota salva; rota/ETA
 *    indisponíveis. Mapa pode estar parcialmente em branco.
 */
export function MapNetworkBadge(props: Props) {
  const state: MapNetworkBadgeState =
    props.state ?? (props.online === false ? 'offline-cached' : 'online');
  const { showWhenOnline = false, style } = props;

  if (state === 'online' && !showWhenOnline) return null;

  const content = renderContent(state);

  return (
    <View
      style={[styles.pill, stylesByState[state], style]}
      pointerEvents="none"
    >
      <MaterialIcons name={content.icon} size={14} color={content.iconColor} />
      <Text style={[styles.text, { color: content.textColor }]}>{content.label}</Text>
    </View>
  );
}

function renderContent(state: MapNetworkBadgeState): {
  label: string;
  icon: 'wifi' | 'wifi-off' | 'cloud-off';
  iconColor: string;
  textColor: string;
} {
  switch (state) {
    case 'online':
      return { label: 'Online', icon: 'wifi', iconColor: '#15803d', textColor: '#15803d' };
    case 'offline-cached':
      return {
        label: 'Sem internet — usando rota salva',
        icon: 'wifi-off',
        iconColor: '#fff',
        textColor: '#fff',
      };
    case 'offline-no-cache':
      return {
        label: 'Sem internet e sem rota salva',
        icon: 'cloud-off',
        iconColor: '#92400e',
        textColor: '#92400e',
      };
  }
}

const styles = StyleSheet.create({
  pill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 16,
    shadowColor: '#000',
    shadowOpacity: 0.18,
    shadowRadius: 4,
    shadowOffset: { width: 0, height: 2 },
    elevation: 4,
  },
  text: { fontSize: 12, fontWeight: '600' },
});

const stylesByState: Record<MapNetworkBadgeState, ViewStyle> = {
  online: { backgroundColor: '#DCFCE7' },
  'offline-cached': { backgroundColor: 'rgba(17,24,39,0.92)' },
  'offline-no-cache': { backgroundColor: '#FEF3C7' },
};
