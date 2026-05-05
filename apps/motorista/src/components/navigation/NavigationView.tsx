import * as React from 'react';
import { StyleSheet, View } from 'react-native';
import {
  ExpoMapboxNavigationView,
  type ExpoMapboxNavigationProps,
  type MapboxNavigationWaypoint,
  type RouteProgressEvent,
  type ArrivalEvent,
  type RerouteEvent,
  type CancelEvent,
} from '@take-me/expo-mapbox-navigation';
import { useNativeNavigationEnabled } from '../../lib/navigationFeatureFlag';
import {
  type GoogleMapsMapRef,
  type LatLng,
  type MapRegion,
} from '../googleMaps';

export type NavigationViewWaypoint = MapboxNavigationWaypoint;

export type NavigationViewProps = {
  /** Pontos da rota: [origem (motorista), ...intermediárias?, destino]. */
  waypoints: NavigationViewWaypoint[];
  /** Polyline da rota já calculada pelo fluxo legado, usada como guia silencioso no SDK. */
  routeCoordinates?: ExpoMapboxNavigationProps['routeCoordinates'];
  /** Token público Mapbox usado pela view nativa. */
  accessToken?: string;
  /** Idioma da voz (default `pt-BR`). */
  voiceLanguage?: string;
  /** Quando `true`, silencia a voz mas mantém banner. */
  mute?: boolean;
  /** Habilita simulação para dev (`__DEV__`). */
  simulateRoute?: boolean;
  /** Só entra no SDK nativo quando a tela solicitou navegação turn-by-turn. */
  nativeNavigationActive?: boolean;
  style?: ExpoMapboxNavigationProps['style'];
  /** Filhos React renderizados sobre o mapa nativo (sheets, badges). */
  children?: React.ReactNode;
  /** Disparado a cada tick do SDK — útil para alimentar `setEtaSeconds`. */
  onProgress?: (progress: RouteProgressEvent) => void;
  /** Chegada à waypoint (intermediária). */
  onWaypointArrival?: (waypointIndex: number) => void;
  /** Chegada ao destino final — geralmente abre o sheet de finalização. */
  onArrival?: () => void;
  /** Sessão cancelada (botão fechar / erro). */
  onCancel?: () => void;
  /** SDK detectou off-route + recalculou a rota internamente. */
  onReroute?: () => void;
  /** SDK detectou off-route antes de consolidar o reroute. */
  onOffRoute?: () => void;
  /** View nativa inicializada e pronta para navegação. */
  onReady?: () => void;
  /** Navegação nativa solicitada, mas flag/módulo/waypoints não permitem usar o SDK. */
  onNativeUnavailable?: () => void;

  // -------- Caminho legado (apenas quando a flag está OFF) --------
  /** Rendere o `<GoogleMapsMap>` quando o nativo está desabilitado.
   *  Recebe a `ref` como parâmetro para o consumidor wirar a câmera caseira. */
  legacyRender: (ctx: {
    mapRef: React.Ref<GoogleMapsMapRef>;
    initialRegion: MapRegion;
  }) => React.ReactNode;
  /** Região inicial para o `<GoogleMapsMap>` legado. Ignorada quando o nativo está ativo. */
  legacyInitialRegion: MapRegion;
  /** Padding (pt ≈ dp) modo `following` no SDK nativo — ex.: espaço livre sobre o modal flutuante. */
  followingPaddingTop?: number;
  followingPaddingBottom?: number;
  followingPaddingLeft?: number;
  followingPaddingRight?: number;
  followingZoom?: number;
  recenterRequestKey?: number;
};

/**
 * Wrapper de navegação que decide em runtime entre:
 *  - Caminho NATIVO: `<ExpoMapboxNavigationView>` (Mapbox Navigation SDK v3),
 *    quando `EXPO_PUBLIC_USE_NATIVE_NAVIGATION=1` e o módulo nativo está disponível.
 *  - Caminho LEGADO: `<GoogleMapsMap>` (Mapbox Maps SDK + câmera caseira),
 *    em qualquer outra situação.
 *
 * Permite migração reversível: a feature flag pode voltar para `0` via OTA
 * (EAS Update) sem rebuild se o nativo regredir.
 */
export const NavigationView = React.forwardRef<GoogleMapsMapRef, NavigationViewProps>(
  function NavigationView(
    {
      waypoints,
      routeCoordinates,
      accessToken,
      voiceLanguage = 'pt-BR',
      mute = false,
      simulateRoute,
      nativeNavigationActive = false,
      style,
      children,
      onProgress,
      onWaypointArrival,
      onArrival,
      onCancel,
      onReroute,
      onOffRoute,
      onReady,
      onNativeUnavailable,
      legacyRender,
      legacyInitialRegion,
      followingPaddingTop,
      followingPaddingBottom,
      followingPaddingLeft,
      followingPaddingRight,
      followingZoom,
      recenterRequestKey,
    },
    ref,
  ) {
    const nativeAvailable = useNativeNavigationEnabled();
    const canUseNative = nativeAvailable && waypoints.length >= 2;
    const useNative = nativeNavigationActive && canUseNative;

    React.useEffect(() => {
      if (nativeNavigationActive && !canUseNative) onNativeUnavailable?.();
    }, [canUseNative, nativeNavigationActive, onNativeUnavailable]);

    if (!useNative) {
      return (
        <View style={[styles.root, style]}>
          {legacyRender({ mapRef: ref, initialRegion: legacyInitialRegion })}
        </View>
      );
    }

    return (
      <ExpoMapboxNavigationView
        style={[styles.root, style]}
        waypoints={waypoints}
        routeCoordinates={routeCoordinates}
        accessToken={accessToken}
        voiceLanguage={voiceLanguage}
        mute={mute}
        simulateRoute={simulateRoute}
        cameraMode="following"
        {...(followingPaddingTop != null ? { followingPaddingTop } : {})}
        {...(followingPaddingBottom != null ? { followingPaddingBottom } : {})}
        {...(followingPaddingLeft != null ? { followingPaddingLeft } : {})}
        {...(followingPaddingRight != null ? { followingPaddingRight } : {})}
        {...(followingZoom != null ? { followingZoom } : {})}
        {...(recenterRequestKey != null ? { recenterRequestKey } : {})}
        onRouteProgress={(e: { nativeEvent: RouteProgressEvent }) => onProgress?.(e.nativeEvent)}
        onWaypointArrival={(e: { nativeEvent: ArrivalEvent }) =>
          onWaypointArrival?.(e.nativeEvent.waypointIndex)
        }
        onArrival={(e: { nativeEvent: ArrivalEvent }) => {
          if (e.nativeEvent.isFinalDestination) onArrival?.();
          else onWaypointArrival?.(e.nativeEvent.waypointIndex);
        }}
        onReroute={(_e: { nativeEvent: RerouteEvent }) => onReroute?.()}
        onOffRoute={() => onOffRoute?.()}
        onCancel={(e: { nativeEvent: CancelEvent }) => {
          // `session-end` pode acontecer quando o SDK cancela uma requisição de rota antiga
          // durante rebuild/recenter. Não é falha de navegação e não deve derrubar para legado.
          if (e.nativeEvent.reason !== 'session-end') onCancel?.();
        }}
        onReady={() => onReady?.()}
      >
        {children}
      </ExpoMapboxNavigationView>
    );
  },
);

/** Helpers de conversão entre `LatLng` (legado) e `MapboxNavigationWaypoint` (nativo). */
export function latLngToWaypoint(
  point: LatLng,
  name?: string,
  isSilent?: boolean,
): NavigationViewWaypoint {
  return {
    latitude: point.latitude,
    longitude: point.longitude,
    ...(name ? { name } : {}),
    ...(isSilent ? { isSilent: true } : {}),
  };
}

const styles = StyleSheet.create({
  root: { flex: 1 },
});
