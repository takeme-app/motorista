import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { SelectShipmentAddressScreen } from '../screens/shipment/SelectShipmentAddressScreen';
import { RecipientScreen } from '../screens/shipment/RecipientScreen';
import { SelectShipmentDriverScreen } from '../screens/shipment/SelectShipmentDriverScreen';
import { ConfirmShipmentScreen } from '../screens/shipment/ConfirmShipmentScreen';
import { ShipmentSuccessScreen } from '../screens/shipment/ShipmentSuccessScreen';
import { PixPaymentScreen } from '../screens/payment/PixPaymentScreen';
import { PixPaliativoScreen } from '../screens/payment/PixPaliativoScreen';
import type { ShipmentStackParamList } from './types';

const Stack = createNativeStackNavigator<ShipmentStackParamList>();

export function ShipmentStack() {
  return (
    <Stack.Navigator
      initialRouteName="SelectShipmentAddress"
      screenOptions={{
        headerShown: false,
        animation: 'slide_from_right',
      }}
    >
      <Stack.Screen name="SelectShipmentAddress" component={SelectShipmentAddressScreen} />
      <Stack.Screen name="SelectShipmentDriver" component={SelectShipmentDriverScreen} />
      <Stack.Screen name="Recipient" component={RecipientScreen} />
      <Stack.Screen name="ConfirmShipment" component={ConfirmShipmentScreen} />
      <Stack.Screen name="PixPaliativo" component={PixPaliativoScreen} />
      <Stack.Screen name="PixPayment" component={PixPaymentScreen} />
      <Stack.Screen name="ShipmentSuccess" component={ShipmentSuccessScreen} />
    </Stack.Navigator>
  );
}
