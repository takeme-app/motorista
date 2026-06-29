import { CommonActions } from '@react-navigation/native';
import type {
  NavigationContainerRef,
  NavigationProp,
} from '@react-navigation/native';
import type { RootStackParamList } from '../navigation/types';

/**
 * Payload de deeplink vinculado a cada notificação (`public.notifications.data`).
 * Formato livre JSON; por convenção usamos `{ route, params }` apontando para
 * uma rota da árvore de navegação do cliente.
 *
 * Espelha apps/motorista/src/lib/notificationDeeplink.ts mas adaptado para a
 * topologia do cliente: Root → Main (tabs) → Profile / Activities / TripStack.
 */
export type NotificationDeeplink = {
  route: string;
  params?: Record<string, unknown> | null;
};

type NavRef = React.RefObject<NavigationContainerRef<RootStackParamList> | null>;

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
      /* ignore */
    }
  }

  return { route, params };
}

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

/**
 * Rotas do RootStackParamList (auth, fluxos isolados).
 */
const ROOT_ROUTES = new Set<string>([
  'Splash', 'Welcome', 'Login', 'SignUp', 'VerifyEmail',
  'AddPaymentPrompt', 'AddPaymentMethod', 'AddCard', 'CardRegisteredSuccess',
  'Main',
  'ForgotPassword', 'ForgotPasswordEmailSent', 'ForgotPasswordVerifyCode',
  'ResetPassword', 'ResetPasswordSuccess',
  'TermsOfUse', 'PrivacyPolicy',
]);

/**
 * Rotas dentro do TripStack (Root → TripStack → ...).
 */
const TRIP_STACK_ROUTES = new Set<string>([
  'WhenNeeded', 'PlanTrip', 'PlanRide', 'ChooseTime', 'SearchTrip',
  'ConfirmDetails', 'Checkout', 'PaymentConfirmed',
  'DriverOnTheWay', 'TripInProgress', 'RateTrip',
]);

/**
 * Rotas dentro do ShipmentStack.
 */
const SHIPMENT_STACK_ROUTES = new Set<string>([
  'SelectShipmentAddress', 'SelectShipmentDriver', 'Recipient',
  'ConfirmShipment', 'ShipmentSuccess',
]);

/**
 * Rotas dentro do ExcursionStack.
 */
const EXCURSION_STACK_ROUTES = new Set<string>([
  'ExcursionRequestForm', 'ExcursionSuccess',
]);

/**
 * Rotas dentro do DependentShipmentStack.
 */
const DEPENDENT_SHIPMENT_STACK_ROUTES = new Set<string>([
  'DependentShipmentForm', 'AddDependent', 'DependentSuccess',
  'DefineDependentTrip', 'SelectDependentTripDriver',
  'ConfirmDependentShipment', 'DependentShipmentSuccess',
]);

/**
 * Rotas dentro do ActivitiesStack (Main tab Activities).
 */
const ACTIVITIES_STACK_ROUTES = new Set<string>([
  'ActivitiesList', 'TravelHistory', 'TripDetail', 'ShipmentDetail',
  'ShipmentTip', 'ShipmentRating', 'Chat',
  'ExcursionDetail', 'ExcursionBudget', 'ExcursionPassengerList',
  'ExcursionPassengerForm', 'DependentShipmentDetail',
]);

/**
 * Rotas dentro do ProfileStack (Main tab Profile).
 */
const PROFILE_STACK_ROUTES = new Set<string>([
  'ProfileMain', 'PersonalInfo', 'Wallet', 'About',
  'Notifications', 'ConfigureNotifications',
  'Dependents', 'DependentDetail', 'AddDependent', 'DependentSuccess',
  'Conversations', 'Chat',
  'EditName', 'EditEmail', 'EditAvatar', 'EditPhone', 'EditCpf', 'EditLocation',
  'ChangePassword', 'DeleteAccountStep1', 'DeleteAccountStep2',
  'DeleteDependent', 'DeleteCard',
  'CancellationPolicy', 'ConsentTerm',
]);

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
    const safeParams = params ?? undefined;

    // 1) Root direto (auth, fluxos isolados).
    if (ROOT_ROUTES.has(route)) {
      nav.dispatch(CommonActions.navigate({ name: route, params: safeParams }));
      return true;
    }

    // 2) Sub-stacks Root.
    if (TRIP_STACK_ROUTES.has(route)) {
      nav.dispatch(CommonActions.navigate({
        name: 'TripStack',
        params: { screen: route, params: safeParams },
      }));
      return true;
    }
    if (SHIPMENT_STACK_ROUTES.has(route)) {
      nav.dispatch(CommonActions.navigate({
        name: 'ShipmentStack',
        params: { screen: route, params: safeParams },
      }));
      return true;
    }
    if (EXCURSION_STACK_ROUTES.has(route)) {
      nav.dispatch(CommonActions.navigate({
        name: 'ExcursionStack',
        params: { screen: route, params: safeParams },
      }));
      return true;
    }
    if (DEPENDENT_SHIPMENT_STACK_ROUTES.has(route)) {
      nav.dispatch(CommonActions.navigate({
        name: 'DependentShipmentStack',
        params: { screen: route, params: safeParams },
      }));
      return true;
    }

    // 3) Tabs dentro de Main.
    if (ACTIVITIES_STACK_ROUTES.has(route)) {
      nav.dispatch(CommonActions.navigate({
        name: 'Main',
        params: {
          screen: 'Activities',
          params: { screen: route, params: safeParams },
        },
      }));
      return true;
    }
    if (PROFILE_STACK_ROUTES.has(route)) {
      nav.dispatch(CommonActions.navigate({
        name: 'Main',
        params: {
          screen: 'Profile',
          params: { screen: route, params: safeParams },
        },
      }));
      return true;
    }

    // 4) Fallback — abre Main (Home tab).
    nav.dispatch(CommonActions.navigate({ name: 'Main' }));
    return false;
  } catch {
    return false;
  }
}
