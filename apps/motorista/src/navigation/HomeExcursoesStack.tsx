import { createNativeStackNavigator } from '@react-navigation/native-stack';
import type { ColetasExcursoesStackParamList } from './ColetasExcursoesStack';
import { HomeExcursoesScreen } from '../screens/excursoes/HomeExcursoesScreen';
import { HistoricoExcursoesScreen } from '../screens/excursoes/HistoricoExcursoesScreen';
import { DetalhesExcursaoScreen } from '../screens/excursoes/DetalhesExcursaoScreen';
import { RealizarEmbarquesScreen } from '../screens/excursoes/RealizarEmbarquesScreen';
import { CadastrarPassageiroExcursaoScreen } from '../screens/excursoes/CadastrarPassageiroExcursaoScreen';
import { JustificarAusenciaExcursaoScreen } from '../screens/excursoes/JustificarAusenciaExcursaoScreen';
import { EmbarqueConcluidoScreen } from '../screens/excursoes/EmbarqueConcluidoScreen';

/**
 * Stack da aba INÍCIO (preparador): mostra a lista redesenhada (mockup) e
 * reaproveita as mesmas telas de detalhe/embarque. Reutiliza o
 * ColetasExcursoesStackParamList (mesmas rotas). A aba Excursões continua
 * usando o ColetasExcursoesStack com a lista original (abas internas).
 */
const Stack = createNativeStackNavigator<ColetasExcursoesStackParamList>();

export function HomeExcursoesStack() {
  return (
    <Stack.Navigator
      initialRouteName="ColetasMain"
      screenOptions={{
        headerShown: false,
        animation: 'slide_from_right',
      }}
    >
      <Stack.Screen name="ColetasMain" component={HomeExcursoesScreen} />
      <Stack.Screen name="HistoricoExcursoes" component={HistoricoExcursoesScreen} />
      <Stack.Screen name="DetalhesExcursao" component={DetalhesExcursaoScreen} />
      <Stack.Screen name="RealizarEmbarques" component={RealizarEmbarquesScreen} />
      <Stack.Screen
        name="CadastrarPassageiroExcursao"
        component={CadastrarPassageiroExcursaoScreen}
        options={{ animation: 'slide_from_bottom' }}
      />
      <Stack.Screen
        name="JustificarAusenciaExcursao"
        component={JustificarAusenciaExcursaoScreen}
      />
      <Stack.Screen
        name="EmbarqueConcluido"
        component={EmbarqueConcluidoScreen}
        options={{ animation: 'fade', gestureEnabled: false }}
      />
    </Stack.Navigator>
  );
}
