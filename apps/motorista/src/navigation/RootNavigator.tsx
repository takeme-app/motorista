import { useRef } from 'react';
import { NavigationContainer, type NavigationContainerRef } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { AuthRecoveryHandler } from './AuthRecoveryHandler';
import { NotificationDeeplinkHandler } from './NotificationDeeplinkHandler';
import { RootNavigationProvider } from './RootNavigationContext';
import { SessionEnvironmentGuard } from './SessionEnvironmentGuard';
import { useOfflineQueueFlusher } from '../hooks/useOfflineQueueFlusher';
import { SplashScreen } from '../screens/SplashScreen';
import { WelcomeScreen } from '../screens/WelcomeScreen';
import { LoginScreen } from '../screens/LoginScreen';
import { SignUpTypeScreen } from '../screens/SignUpTypeScreen';
import { SignUpScreen } from '../screens/SignUpScreen';
import { VerifyEmailScreen } from '../screens/VerifyEmailScreen';
import { CompleteDriverRegistrationScreen } from '../screens/CompleteDriverRegistrationScreen';
import { CompletePreparadorExcursoesScreen } from '../screens/CompletePreparadorExcursoesScreen';
import { CompletePreparadorEncomendasScreen } from '../screens/CompletePreparadorEncomendasScreen';
import { FinalizeRegistrationScreen } from '../screens/FinalizeRegistrationScreen';
import { RegistrationSuccessScreen } from '../screens/RegistrationSuccessScreen';
import { MotoristaPendingApprovalScreen } from '../screens/MotoristaPendingApprovalScreen';
import { StripeConnectSetupScreen } from '../screens/StripeConnectSetupScreen';
import { ForgotPasswordScreen } from '../screens/ForgotPasswordScreen';
import { ForgotPasswordEmailSentScreen } from '../screens/ForgotPasswordEmailSentScreen';
import { ForgotPasswordVerifyCodeScreen } from '../screens/ForgotPasswordVerifyCodeScreen';
import { ResetPasswordScreen } from '../screens/ResetPasswordScreen';
import { ResetPasswordSuccessScreen } from '../screens/ResetPasswordSuccessScreen';
import { TermsOfUseScreen } from '../screens/TermsOfUseScreen';
import { PrivacyPolicyScreen } from '../screens/PrivacyPolicyScreen';
import { MainTabs } from './MainTabs';
import { MainExcursoesEntry } from '../screens/excursoes/MainExcursoesEntry';
import { MainTabsEncomendas } from './MainTabsEncomendas';
import { PendingRequestsScreen } from '../screens/PendingRequestsScreen';
import { TripHistoryScreen } from '../screens/TripHistoryScreen';
import { TripDetailScreen } from '../screens/TripDetailScreen';
import { ActiveTripScreen } from '../screens/ActiveTripScreen';
import { ChatScreen } from '../screens/ChatScreen';
import { PaymentHistoryScreen } from '../screens/PaymentHistoryScreen';
import type { RootStackParamList } from './types';

const Stack = createNativeStackNavigator<RootStackParamList>();

export type RootInitialRouteName =
  | 'Welcome'
  | 'Main'
  | 'MainExcursoes'
  | 'MainEncomendas'
  | 'MotoristaPendingApproval'
  | 'StripeConnectSetup'
  | 'SignUpType'
  | 'CompleteDriverRegistration'
  | 'CompletePreparadorExcursoes'
  | 'CompletePreparadorEncomendas';

type RootNavigatorProps = {
  initialRouteName: RootInitialRouteName;
  /**
   * Params iniciais para a rota inicial (necessário p/ rotas que exigem params,
   * ex.: `CompleteDriverRegistration` precisa de `driverType`).
   */
  initialRouteParams?: Record<string, unknown>;
};

export function RootNavigator({ initialRouteName, initialRouteParams }: RootNavigatorProps) {
  const navigationRef = useRef<NavigationContainerRef<RootStackParamList>>(null);
  // Faz flush automático da fila offline (complete_trip_stop, start_journey)
  // sempre que a rede volta. Idempotente; flushQueue() é serializada.
  useOfflineQueueFlusher();

  return (
    <NavigationContainer ref={navigationRef}>
      <AuthRecoveryHandler navigationRef={navigationRef} />
      <SessionEnvironmentGuard navigationRef={navigationRef} />
      <NotificationDeeplinkHandler navigationRef={navigationRef} />
      <RootNavigationProvider navigationRef={navigationRef}>
        <Stack.Navigator
          initialRouteName={initialRouteName}
          screenOptions={{
            headerShown: false,
            animation: 'slide_from_right',
          }}
        >
          <Stack.Screen name="Splash" component={SplashScreen} options={{ animation: 'fade' }} />
          <Stack.Screen name="Welcome" component={WelcomeScreen} options={{ animation: 'fade' }} />
          <Stack.Screen name="SignUpType" component={SignUpTypeScreen} />
          <Stack.Screen name="Login" component={LoginScreen} />
          <Stack.Screen name="SignUp" component={SignUpScreen} />
          <Stack.Screen name="VerifyEmail" component={VerifyEmailScreen} />
          <Stack.Screen
            name="CompleteDriverRegistration"
            component={CompleteDriverRegistrationScreen}
            initialParams={
              initialRouteName === 'CompleteDriverRegistration'
                ? (initialRouteParams as { driverType: 'take_me' | 'parceiro' } | undefined)
                : undefined
            }
          />
          <Stack.Screen name="CompletePreparadorExcursoes" component={CompletePreparadorExcursoesScreen} />
          <Stack.Screen name="CompletePreparadorEncomendas" component={CompletePreparadorEncomendasScreen} />
          <Stack.Screen name="FinalizeRegistration" component={FinalizeRegistrationScreen} />
          <Stack.Screen name="RegistrationSuccess" component={RegistrationSuccessScreen} />
          <Stack.Screen
            name="MotoristaPendingApproval"
            component={MotoristaPendingApprovalScreen}
            options={{ animation: 'fade' }}
          />
          <Stack.Screen name="StripeConnectSetup" component={StripeConnectSetupScreen} options={{ animation: 'slide_from_right' }} />
          <Stack.Screen name="Main" component={MainTabs} options={{ animation: 'fade' }} />
          <Stack.Screen name="MainExcursoes" component={MainExcursoesEntry} options={{ animation: 'fade' }} />
          <Stack.Screen name="MainEncomendas" component={MainTabsEncomendas} options={{ animation: 'fade' }} />
          <Stack.Screen name="PendingRequests" component={PendingRequestsScreen} options={{ animation: 'slide_from_bottom' }} />
          <Stack.Screen name="TripHistory" component={TripHistoryScreen} options={{ animation: 'slide_from_right' }} />
          <Stack.Screen name="TripDetail" component={TripDetailScreen} options={{ animation: 'slide_from_right' }} />
          <Stack.Screen name="ActiveTrip" component={ActiveTripScreen} options={{ animation: 'fade', gestureEnabled: false }} />
          <Stack.Screen name="DriverClientChat" component={ChatScreen} options={{ animation: 'slide_from_right' }} />
          <Stack.Screen name="PaymentHistory" component={PaymentHistoryScreen} options={{ animation: 'slide_from_bottom' }} />
          <Stack.Screen name="ForgotPassword" component={ForgotPasswordScreen} />
          <Stack.Screen name="ForgotPasswordEmailSent" component={ForgotPasswordEmailSentScreen} />
          <Stack.Screen name="ForgotPasswordVerifyCode" component={ForgotPasswordVerifyCodeScreen} />
          <Stack.Screen name="ResetPassword" component={ResetPasswordScreen} />
          <Stack.Screen name="ResetPasswordSuccess" component={ResetPasswordSuccessScreen} />
          <Stack.Screen name="TermsOfUse" component={TermsOfUseScreen} />
          <Stack.Screen name="PrivacyPolicy" component={PrivacyPolicyScreen} />
        </Stack.Navigator>
      </RootNavigationProvider>
    </NavigationContainer>
  );
}
