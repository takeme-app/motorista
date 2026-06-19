import { createNativeStackNavigator } from '@react-navigation/native-stack';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import type { DependentShipmentStackParamList } from './types';
import { DependentShipmentFormScreen } from '../screens/dependentShipment/DependentShipmentFormScreen';
import { AddDependentScreen } from '../screens/profile/AddDependentScreen';
import { DependentSuccessScreen } from '../screens/profile/DependentSuccessScreen';
import { DefineDependentTripScreen } from '../screens/dependentShipment/DefineDependentTripScreen';
import { SelectDependentTripDriverScreen } from '../screens/dependentShipment/SelectDependentTripDriverScreen';
import { ConfirmDependentShipmentScreen } from '../screens/dependentShipment/ConfirmDependentShipmentScreen';
import { DependentShipmentSuccessScreen } from '../screens/dependentShipment/DependentShipmentSuccessScreen';
import { PixPaliativoScreen } from '../screens/payment/PixPaliativoScreen';

const Stack = createNativeStackNavigator<DependentShipmentStackParamList>();

/** Reutiliza AddDependentScreen do Perfil; no sucesso navega para DependentSuccess deste stack. */
function AddDependentInFlowScreen(
  props: NativeStackScreenProps<DependentShipmentStackParamList, 'AddDependent'>
) {
  return (
    <AddDependentScreen
      navigation={props.navigation as any}
      route={props.route as any}
    />
  );
}

export function DependentShipmentStack() {
  return (
    <Stack.Navigator
      initialRouteName="DependentShipmentForm"
      screenOptions={{
        headerShown: false,
        animation: 'slide_from_right',
      }}
    >
      <Stack.Screen name="DependentShipmentForm" component={DependentShipmentFormScreen} />
      <Stack.Screen name="AddDependent" component={AddDependentInFlowScreen} />
      <Stack.Screen name="DependentSuccess" component={DependentSuccessScreen} />
      <Stack.Screen name="DefineDependentTrip" component={DefineDependentTripScreen} />
      <Stack.Screen name="SelectDependentTripDriver" component={SelectDependentTripDriverScreen} />
      <Stack.Screen name="ConfirmDependentShipment" component={ConfirmDependentShipmentScreen} />
      <Stack.Screen name="PixPaliativo" component={PixPaliativoScreen} />
      <Stack.Screen name="DependentShipmentSuccess" component={DependentShipmentSuccessScreen} />
    </Stack.Navigator>
  );
}
