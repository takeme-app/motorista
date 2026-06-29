import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { WhenNeededScreen } from '../screens/trip/WhenNeededScreen';
import { PlanTripScreen } from '../screens/trip/PlanTripScreen';
import { PlanRideScreen } from '../screens/trip/PlanRideScreen';
import { ChooseTimeScreen } from '../screens/trip/ChooseTimeScreen';
import { SearchTripScreen } from '../screens/trip/SearchTripScreen';
import { ConfirmDetailsScreen } from '../screens/trip/ConfirmDetailsScreen';
import { CheckoutScreen } from '../screens/trip/CheckoutScreen';
import { PaymentConfirmedScreen } from '../screens/trip/PaymentConfirmedScreen';
import { DriverOnTheWayScreen } from '../screens/trip/DriverOnTheWayScreen';
import { TripInProgressScreen } from '../screens/trip/TripInProgressScreen';
import { RateTripScreen } from '../screens/trip/RateTripScreen';
import { PixPaliativoScreen } from '../screens/payment/PixPaliativoScreen';
import type { TripStackParamList } from './types';

const Stack = createNativeStackNavigator<TripStackParamList>();

export function TripStack() {
  return (
    <Stack.Navigator
      initialRouteName="PlanTrip"
      screenOptions={{
        headerShown: false,
        animation: 'slide_from_right',
      }}
    >
      <Stack.Screen name="WhenNeeded" component={WhenNeededScreen} />
      <Stack.Screen name="PlanTrip" component={PlanTripScreen} />
      <Stack.Screen name="PlanRide" component={PlanRideScreen} />
      <Stack.Screen name="ChooseTime" component={ChooseTimeScreen} />
      <Stack.Screen name="SearchTrip" component={SearchTripScreen} />
      <Stack.Screen name="ConfirmDetails" component={ConfirmDetailsScreen} />
      <Stack.Screen name="Checkout" component={CheckoutScreen} />
      <Stack.Screen name="PixPaliativo" component={PixPaliativoScreen} />
      <Stack.Screen name="PaymentConfirmed" component={PaymentConfirmedScreen} />
      <Stack.Screen name="DriverOnTheWay" component={DriverOnTheWayScreen} />
      <Stack.Screen name="TripInProgress" component={TripInProgressScreen} />
      <Stack.Screen name="RateTrip" component={RateTripScreen} />
    </Stack.Navigator>
  );
}
