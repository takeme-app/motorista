import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { ColetasExcursoesScreen } from '../screens/excursoes/ColetasExcursoesScreen';
import { HistoricoExcursoesScreen } from '../screens/excursoes/HistoricoExcursoesScreen';
import { DetalhesExcursaoScreen } from '../screens/excursoes/DetalhesExcursaoScreen';
import { RealizarEmbarquesScreen } from '../screens/excursoes/RealizarEmbarquesScreen';
import { CadastrarPassageiroExcursaoScreen } from '../screens/excursoes/CadastrarPassageiroExcursaoScreen';
import { EmbarqueConcluidoScreen } from '../screens/excursoes/EmbarqueConcluidoScreen';

export type ColetasExcursoesStackParamList = {
  ColetasMain: undefined;
  HistoricoExcursoes: undefined;
  DetalhesExcursao: { excursionId: string };
  RealizarEmbarques: { excursionId: string; phase?: 'ida' | 'volta' };
  CadastrarPassageiroExcursao: { excursionId: string };
  EmbarqueConcluido: {
    excursionId: string;
    boarded: number;
    justified: number;
    totalExcursion: number;
    totalAmountCents?: number | null;
    phase?: 'ida' | 'volta';
  };
};

const Stack = createNativeStackNavigator<ColetasExcursoesStackParamList>();

export function ColetasExcursoesStack() {
  return (
    <Stack.Navigator
      initialRouteName="ColetasMain"
      screenOptions={{
        headerShown: false,
        animation: 'slide_from_right',
      }}
    >
      <Stack.Screen name="ColetasMain" component={ColetasExcursoesScreen} />
      <Stack.Screen name="HistoricoExcursoes" component={HistoricoExcursoesScreen} />
      <Stack.Screen name="DetalhesExcursao" component={DetalhesExcursaoScreen} />
      <Stack.Screen name="RealizarEmbarques" component={RealizarEmbarquesScreen} />
      <Stack.Screen
        name="CadastrarPassageiroExcursao"
        component={CadastrarPassageiroExcursaoScreen}
        options={{ animation: 'slide_from_bottom' }}
      />
      <Stack.Screen
        name="EmbarqueConcluido"
        component={EmbarqueConcluidoScreen}
        options={{ animation: 'fade', gestureEnabled: false }}
      />
    </Stack.Navigator>
  );
}
