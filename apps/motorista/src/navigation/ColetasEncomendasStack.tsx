import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { ColetasEncomendasScreen } from '../screens/encomendas/ColetasEncomendasScreen';
import { HistoricoEncomendasScreen } from '../screens/encomendas/HistoricoEncomendasScreen';
import { DetalhesEncomendaScreen } from '../screens/encomendas/DetalhesEncomendaScreen';
import { ActiveShipmentScreen } from '../screens/encomendas/ActiveShipmentScreen';
import { NotificationsScreen } from '../screens/NotificationsScreen';

export type ColetasEncomendasStackParamList = {
  ColetasMain: undefined;
  HistoricoEncomendas: undefined;
  DetalhesEncomenda: { shipmentId: string };
  ActiveShipment: { shipmentId: string };
  Notifications: undefined;
};

const Stack = createNativeStackNavigator<ColetasEncomendasStackParamList>();

export function ColetasEncomendasStack() {
  return (
    <Stack.Navigator
      initialRouteName="ColetasMain"
      screenOptions={{
        headerShown: false,
        animation: 'slide_from_right',
      }}
    >
      <Stack.Screen name="ColetasMain" component={ColetasEncomendasScreen} />
      <Stack.Screen name="HistoricoEncomendas" component={HistoricoEncomendasScreen} />
      <Stack.Screen name="DetalhesEncomenda" component={DetalhesEncomendaScreen} />
      <Stack.Screen name="ActiveShipment" component={ActiveShipmentScreen} />
      <Stack.Screen name="Notifications" component={NotificationsScreen} />
    </Stack.Navigator>
  );
}
