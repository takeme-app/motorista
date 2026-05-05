import { useCallback, useEffect, useRef } from 'react';
import { AppState, type AppStateStatus } from 'react-native';
import { CommonActions, type NavigationContainerRef } from '@react-navigation/native';
import type { RootStackParamList, RegistrationType } from './types';
import { supabase } from '../lib/supabase';
import { checkMotoristaCanAccessApp, subtypeToMainRoute } from '../lib/motoristaAccess';

type Props = {
  navigationRef: React.RefObject<NavigationContainerRef<RootStackParamList> | null>;
};

type TargetRoute =
  | { name: 'Welcome' }
  | { name: 'SignUpType' }
  | { name: 'MotoristaPendingApproval' }
  | { name: 'Main' }
  | { name: 'MainExcursoes' }
  | { name: 'MainEncomendas' }
  | { name: 'StripeConnectSetup'; params: { subtype?: string } }
  | { name: 'CompletePreparadorExcursoes' }
  | { name: 'CompletePreparadorEncomendas' }
  | { name: 'CompleteDriverRegistration'; params: { driverType: 'take_me' | 'parceiro' } };

const AUTH_BYPASS_ROUTES = new Set<string>([
  'Login',
  'ForgotPassword',
  'ForgotPasswordEmailSent',
  'ForgotPasswordVerifyCode',
  'ResetPassword',
  'ResetPasswordSuccess',
  'StripeConnectSetup',
  'MotoristaPendingApproval',
]);

const DRIVER_ENVIRONMENT_ROUTES = new Set<string>([
  'Main',
  'PendingRequests',
  'TripHistory',
  'TripDetail',
  'ActiveTrip',
  'DriverClientChat',
  'PaymentHistory',
]);

function registrationRoute(registrationType: RegistrationType | null): TargetRoute {
  if (registrationType === 'preparador_excursões') return { name: 'CompletePreparadorExcursoes' };
  if (registrationType === 'preparador_encomendas') return { name: 'CompletePreparadorEncomendas' };
  return {
    name: 'CompleteDriverRegistration',
    params: { driverType: registrationType === 'parceiro' ? 'parceiro' : 'take_me' },
  };
}

async function resolveTargetRoute(): Promise<TargetRoute | null> {
  const {
    data: { session },
  } = await supabase.auth.getSession();

  if (!session?.user?.id) return null;

  const gate = await checkMotoristaCanAccessApp(session.user.id);
  if (gate.kind === 'error') {
    await supabase.auth.signOut();
    return { name: 'Welcome' };
  }
  if (gate.kind === 'missing_profile') return { name: 'SignUpType' };
  if (gate.kind === 'needs_profile_completion') return registrationRoute(gate.registrationType);
  if (gate.kind === 'pending') return { name: 'MotoristaPendingApproval' };
  if (gate.kind === 'needs_stripe_connect') {
    return { name: 'StripeConnectSetup', params: { subtype: gate.subtype } };
  }
  return { name: subtypeToMainRoute(gate.subtype, gate.role) };
}

function rootRouteName(navigationRef: Props['navigationRef']): string | null {
  const state = navigationRef.current?.getRootState();
  const route = state?.routes[state.index ?? 0];
  return route?.name ?? navigationRef.current?.getCurrentRoute()?.name ?? null;
}

function resetToTarget(
  navigationRef: Props['navigationRef'],
  target: TargetRoute,
): void {
  navigationRef.current?.dispatch(
    CommonActions.reset({
      index: 0,
      routes: [{ name: target.name, params: 'params' in target ? target.params : undefined }],
    }),
  );
}

function rootAlreadyMatchesTarget(rootName: string, target: TargetRoute): boolean {
  if (target.name === 'Main') return DRIVER_ENVIRONMENT_ROUTES.has(rootName);
  return rootName === target.name;
}

export function SessionEnvironmentGuard({ navigationRef }: Props) {
  const checkingRef = useRef(false);

  const syncEnvironment = useCallback(async () => {
    if (checkingRef.current) return;
    const currentRoot = rootRouteName(navigationRef);
    if (!currentRoot || AUTH_BYPASS_ROUTES.has(currentRoot)) return;

    checkingRef.current = true;
    try {
      const target = await resolveTargetRoute();
      if (!target) return;
      const latestRoot = rootRouteName(navigationRef);
      if (!latestRoot || AUTH_BYPASS_ROUTES.has(latestRoot) || rootAlreadyMatchesTarget(latestRoot, target)) return;
      resetToTarget(navigationRef, target);
    } finally {
      checkingRef.current = false;
    }
  }, [navigationRef]);

  useEffect(() => {
    const timer = setTimeout(() => {
      void syncEnvironment();
    }, 0);
    return () => clearTimeout(timer);
  }, [syncEnvironment]);

  useEffect(() => {
    const onAppStateChange = (next: AppStateStatus) => {
      if (next === 'active') {
        void syncEnvironment();
      }
    };
    const sub = AppState.addEventListener('change', onAppStateChange);
    return () => sub.remove();
  }, [syncEnvironment]);

  useEffect(() => {
    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((event) => {
      if (event === 'SIGNED_IN' || event === 'TOKEN_REFRESHED') {
        void syncEnvironment();
      }
    });
    return () => subscription.unsubscribe();
  }, [syncEnvironment]);

  return null;
}
