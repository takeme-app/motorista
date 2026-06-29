import { CommonActions } from '@react-navigation/native';
import type {
  NavigationContainerRef,
  NavigationProp,
} from '@react-navigation/native';
import type { RootStackParamList } from '../navigation/types';

/**
 * Payload de deeplink vinculado a cada notificação (`public.notifications.data`).
 * Formato livre JSON; por convenção usamos `{ route, params }` apontando para
 * uma rota do RootStackParamList. Rotas dentro de tabs (ex.: Profile→Notifications)
 * são resolvidas via `getParent()`/`navigate` em cascata.
 */
export type NotificationDeeplink = {
  route: string;
  params?: Record<string, unknown> | null;
};

type NavRef = React.RefObject<NavigationContainerRef<RootStackParamList> | null>;

/**
 * Aceita o payload em `data` de FCM (vem como dicionário string/string) ou
 * direto do `notifications.data` (JSONB) e tenta normalizar para
 * `{ route, params }`. Retorna `null` se não houver destino válido.
 */
export function parseNotificationDeeplink(
  raw: unknown,
): NotificationDeeplink | null {
  if (!raw || typeof raw !== 'object') return null;

  const obj = raw as Record<string, unknown>;

  const route = typeof obj.route === 'string' ? obj.route.trim() : '';
  if (!route) return null;

  let params: Record<string, unknown> | null = null;
  if (obj.params && typeof obj.params === 'object') {
    params = obj.params as Record<string, unknown>;
  } else if (typeof obj.params === 'string') {
    try {
      const parsed = JSON.parse(obj.params);
      if (parsed && typeof parsed === 'object') {
        params = parsed as Record<string, unknown>;
      }
    } catch {
      /* ignore: params não era JSON válido */
    }
  }

  return { route, params };
}

/**
 * Navega para o destino descrito pelo deeplink.
 * - Se a rota pertence ao Root (tipada em RootStackParamList), usa `navigate`.
 * - Se for uma rota "virtual" dentro da tab Profile (ex.: 'Notifications'),
 *   aninha via { screen, params }.
 * - Erros silenciam para não quebrar o fluxo do app ao abrir via push.
 */
/**
 * Dispatcher mínimo que tanto um `NavigationContainerRef` quanto um
 * `navigation` (prop de tela) expõem: `dispatch(action)`.
 */
type Dispatcher = {
  dispatch: (action: Parameters<NonNullable<NavigationContainerRef<RootStackParamList>['dispatch']>>[0]) => void;
};

function resolveDispatcher(
  target: NavRef | NavigationProp<RootStackParamList> | Dispatcher | null | undefined,
): Dispatcher | null {
  if (!target) return null;
  if ('current' in target) return target.current ?? null;
  if ('dispatch' in target) return target as Dispatcher;
  return null;
}

export function applyNotificationDeeplink(
  navigationTarget:
    | NavRef
    | NavigationProp<RootStackParamList>
    | Dispatcher
    | null
    | undefined,
  link: NotificationDeeplink,
): boolean {
  const nav = resolveDispatcher(navigationTarget);
  if (!nav || !link.route) return false;

  try {
    const { route, params } = link;

    // Rotas do Root Stack — passam direto.
    const rootRoutes: Array<keyof RootStackParamList> = [
      'Main',
      'MainExcursoes',
      'MainEncomendas',
      'MotoristaPendingApproval',
      'PendingRequests',
      'TripHistory',
      'TripDetail',
      'ActiveTrip',
      'DriverClientChat',
      'PaymentHistory',
      'StripeConnectSetup',
      'Welcome',
      'Splash',
      'Login',
    ];

    if ((rootRoutes as string[]).includes(route)) {
      nav.dispatch(
        CommonActions.navigate({
          name: route,
          params: params ?? undefined,
        }),
      );
      return true;
    }

    // Telas dos tabs de excursão (preparador). Vivem em MainExcursoes → ColetasExc
    // (stack "Excursões"); ex.: DetalhesExcursao. Sem este branch caíam no fallback
    // do Profile (rota inexistente) e a push não navegava.
    const excursionTabRoutes = [
      'DetalhesExcursao',
      'RealizarEmbarques',
      'HistoricoExcursoes',
      'ColetasMain',
    ];
    if (excursionTabRoutes.includes(route)) {
      nav.dispatch(
        CommonActions.navigate({
          name: 'MainExcursoes',
          params: {
            screen: 'ColetasExc',
            params: {
              screen: route,
              params: params ?? undefined,
            },
          },
        }),
      );
      return true;
    }

    // Telas dentro do Profile stack (ex.: Notifications, Conversations, WorkerRoutes).
    nav.dispatch(
      CommonActions.navigate({
        name: 'Main',
        params: {
          screen: 'Profile',
          params: {
            screen: route,
            params: params ?? undefined,
          },
        },
      }),
    );
    return true;
  } catch {
    return false;
  }
}
