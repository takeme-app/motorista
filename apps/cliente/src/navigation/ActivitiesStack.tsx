import { createNativeStackNavigator } from '@react-navigation/native-stack';
import type { ActivitiesStackParamList } from './ActivitiesStackTypes';
import { ActivitiesScreen } from '../screens/ActivitiesScreen';
import { TravelHistoryScreen } from '../screens/TravelHistoryScreen';
import { TripDetailScreen } from '../screens/trip/TripDetailScreen';
import { ShipmentDetailScreen } from '../screens/shipment/ShipmentDetailScreen';
import { ShipmentTipScreen } from '../screens/shipment/ShipmentTipScreen';
import { ShipmentRatingScreen } from '../screens/shipment/ShipmentRatingScreen';
import { ChatScreen } from '../screens/ChatScreen';
import { ExcursionDetailScreen } from '../screens/excursion/ExcursionDetailScreen';
import { ExcursionBudgetScreen } from '../screens/excursion/ExcursionBudgetScreen';
import { ExcursionPassengerListScreen } from '../screens/excursion/ExcursionPassengerListScreen';
import { ExcursionPassengerFormScreen } from '../screens/excursion/ExcursionPassengerFormScreen';
import { DependentShipmentDetailScreen } from '../screens/dependentShipment/DependentShipmentDetailScreen';
import { DriverOnTheWayScreen } from '../screens/trip/DriverOnTheWayScreen';
import { TripInProgressScreen } from '../screens/trip/TripInProgressScreen';
import { RateTripScreen } from '../screens/trip/RateTripScreen';
import { PixPaliativoScreen } from '../screens/payment/PixPaliativoScreen';

const Stack = createNativeStackNavigator<ActivitiesStackParamList>();

export function ActivitiesStack() {
  return (
    <Stack.Navigator
      screenOptions={{
        headerShown: false,
        animation: 'slide_from_right',
      }}
    >
      <Stack.Screen name="ActivitiesList" component={ActivitiesScreen} />
      <Stack.Screen name="TravelHistory" component={TravelHistoryScreen} />
      <Stack.Screen name="TripDetail" component={TripDetailScreen} />
      <Stack.Screen name="DriverOnTheWay" component={DriverOnTheWayScreen} />
      <Stack.Screen name="TripInProgress" component={TripInProgressScreen} />
      <Stack.Screen name="RateTrip" component={RateTripScreen} />
      <Stack.Screen name="ShipmentDetail" component={ShipmentDetailScreen} />
      <Stack.Screen name="ShipmentTip" component={ShipmentTipScreen} />
      <Stack.Screen name="ShipmentRating" component={ShipmentRatingScreen} />
      <Stack.Screen name="Chat" component={ChatScreen} />
      <Stack.Screen name="ExcursionDetail" component={ExcursionDetailScreen} />
      <Stack.Screen name="ExcursionBudget" component={ExcursionBudgetScreen} />
      <Stack.Screen name="PixPaliativo" component={PixPaliativoScreen} />
      <Stack.Screen name="ExcursionPassengerList" component={ExcursionPassengerListScreen} />
      <Stack.Screen name="ExcursionPassengerForm" component={ExcursionPassengerFormScreen} />
      <Stack.Screen name="DependentShipmentDetail" component={DependentShipmentDetailScreen} />
    </Stack.Navigator>
  );
}
