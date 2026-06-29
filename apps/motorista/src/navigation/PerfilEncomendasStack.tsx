import { createNativeStackNavigator } from '@react-navigation/native-stack';
import type { ProfileStackParamList } from './types';
import { PerfilEncomendasScreen } from '../screens/encomendas/PerfilEncomendasScreen';
import { ProfileOverviewScreen } from '../screens/ProfileOverviewScreen';
import { PersonalInfoScreen } from '../screens/PersonalInfoScreen';
import { WorkerVehiclesScreen } from '../screens/WorkerVehiclesScreen';
import { VehicleDetailScreen } from '../screens/VehicleDetailScreen';
import { VehicleFormScreen } from '../screens/VehicleFormScreen';
import { AboutScreen } from '../screens/AboutScreen';
import { CancellationPolicyScreen } from '../screens/CancellationPolicyScreen';
import { ConsentTermScreen } from '../screens/ConsentTermScreen';
import { DataRequestScreen } from '../screens/DataRequestScreen';
import { NotificationsScreen } from '../screens/NotificationsScreen';

const Stack = createNativeStackNavigator<ProfileStackParamList>();

export function PerfilEncomendasStack() {
  return (
    <Stack.Navigator
      initialRouteName="Settings"
      screenOptions={{
        headerShown: false,
        animation: 'slide_from_right',
      }}
    >
      <Stack.Screen name="Settings" component={PerfilEncomendasScreen} />
      <Stack.Screen name="ProfileOverview" component={ProfileOverviewScreen} />
      <Stack.Screen name="PersonalInfo" component={PersonalInfoScreen} />
      <Stack.Screen name="WorkerVehicles" component={WorkerVehiclesScreen} />
      <Stack.Screen name="VehicleDetail" component={VehicleDetailScreen} />
      <Stack.Screen name="VehicleForm" component={VehicleFormScreen} />
      <Stack.Screen name="About" component={AboutScreen} />
      <Stack.Screen name="CancellationPolicy" component={CancellationPolicyScreen} />
      <Stack.Screen name="ConsentTerm" component={ConsentTermScreen} />
      <Stack.Screen name="DataRequest" component={DataRequestScreen} />
      <Stack.Screen name="Notifications" component={NotificationsScreen} />
    </Stack.Navigator>
  );
}
