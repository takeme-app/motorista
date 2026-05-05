import type { ViewProps, StyleProp, ViewStyle } from 'react-native';

export type MapboxNavigationCoordinate = {
  latitude: number;
  longitude: number;
};

export type MapboxNavigationWaypoint = MapboxNavigationCoordinate & {
  /** Rótulo opcional exibido na UI (puramente cosmético). */
  name?: string;
  /** Quando `true`, o SDK trata como parada intermediária com chegada anunciada. */
  isSilent?: boolean;
};

export type MapboxNavigationProfile =
  | 'driving-traffic'
  | 'driving'
  | 'cycling'
  | 'walking';

export type MapboxNavigationCameraMode =
  | 'following'
  | 'overview'
  | 'idle';

export type RouteProgressEvent = {
  /** Distância restante até a próxima parada/destino, em metros. */
  distanceRemainingMeters: number;
  /** Duração restante (com tráfego) em segundos. */
  durationRemainingSeconds: number;
  /** Distância total percorrida nesta sessão de navegação, em metros. */
  distanceTraveledMeters: number;
  /** Fração 0-1 já percorrida da rota atual. */
  fractionTraveled: number;
  /** Texto principal da próxima manobra (ex.: "Vire à direita na Rua A"). */
  upcomingManeuverText?: string | null;
  /** Tipo de manobra (`turn`, `merge`, `arrive`, …) — útil para ícone próprio. */
  upcomingManeuverType?: string | null;
  /** Distância em metros até a próxima manobra. */
  upcomingManeuverDistanceMeters?: number | null;
};

export type RerouteEvent = {
  /** "off-route", "user-initiated", "alternative-route" — depende do SDK. */
  reason: string;
};

export type ArrivalEvent = {
  /** Índice da waypoint chegada (0 = primeira parada após origem). */
  waypointIndex: number;
  /** `true` quando é a chegada final (último waypoint). */
  isFinalDestination: boolean;
};

export type OffRouteEvent = {
  /** Distância (m) do GPS atual para a polyline mais próxima. */
  distanceMeters: number;
};

export type CancelEvent = {
  /** Motivo informado pelo SDK ou pelo botão de "fechar navegação". */
  reason: 'user-cancel' | 'session-end' | 'error';
  /** Mensagem opcional em falhas nativas. */
  message?: string;
};

export type ExpoMapboxNavigationProps = ViewProps & {
  style?: StyleProp<ViewStyle>;
  /** [origem, ...intermediárias?, destino] — mínimo 2 pontos. */
  waypoints: MapboxNavigationWaypoint[];
  /**
   * Polyline de referência já calculada pelo fluxo legado.
   * Quando enviada, o SDK usa pontos amostrados dela como waypoints silenciosos
   * para aproximar a rota nativa da mesma geometria visual.
   */
  routeCoordinates?: MapboxNavigationCoordinate[];
  /** Token público Mapbox usado pelo SDK nativo para mapa/rotas. */
  accessToken?: string;
  /** Padrão `driving-traffic` (com tráfego ao vivo). */
  profile?: MapboxNavigationProfile;
  /** Idioma da voz de manobras (BCP-47, ex.: `pt-BR`). */
  voiceLanguage?: string;
  /** Quando `true`, simula a viagem (modo dev). */
  simulateRoute?: boolean;
  /** Quando `true`, silencia a voz (mantém o banner). */
  mute?: boolean;
  /** Modo da câmera; default `following` (heading-up). */
  cameraMode?: MapboxNavigationCameraMode;
  /**
   * Padding lógico (dp/pt) ao centrar o usuário no modo `following`,
   * para manter o puck acima do UI nativo/React (ex.: sheet flutuante).
   */
  followingPaddingTop?: number;
  followingPaddingBottom?: number;
  followingPaddingLeft?: number;
  followingPaddingRight?: number;
  /** Zoom fixo opcional no modo `following`. Maior = mais perto do motorista. */
  followingZoom?: number;
  /**
   * Incremente este número para pedir ao SDK que volte ao modo `following`,
   * centralizando novamente na direção da rota.
   */
  recenterRequestKey?: number;

  /** Cor do traço da rota (hex `#RRGGBB` ou `#RRGGBBAA`). */
  routeLineColor?: string;
  /** Esconder o banner de manobras nativo (útil quando o app desenha o próprio). */
  hideManeuverBanner?: boolean;
  /** Esconder o painel inferior nativo (ETA / distância / cancel). */
  hideBottomPanel?: boolean;

  onRouteProgress?: (event: { nativeEvent: RouteProgressEvent }) => void;
  onReroute?: (event: { nativeEvent: RerouteEvent }) => void;
  onArrival?: (event: { nativeEvent: ArrivalEvent }) => void;
  onWaypointArrival?: (event: { nativeEvent: ArrivalEvent }) => void;
  onOffRoute?: (event: { nativeEvent: OffRouteEvent }) => void;
  onCancel?: (event: { nativeEvent: CancelEvent }) => void;
  onReady?: () => void;
};

export type ExpoMapboxNavigationModuleType = {
  /** Verifica se o SDK nativo está disponível neste device/build. */
  isAvailable(): boolean;
  /** Versão do Mapbox Navigation SDK em uso. */
  getSdkVersion(): string;
};
