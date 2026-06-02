import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import type { NavigatorScreenParams } from '@react-navigation/native';
import { getFocusedRouteNameFromRoute } from '@react-navigation/native';
import { MaterialIcons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import type { ProfileStackParamList, ChatExcStackParamList } from './types';
import type { PagamentosExcStackParamList } from './PagamentosExcursoesStack';
import { ColetasExcursoesStack } from './ColetasExcursoesStack';
import { ChatExcursoesStack } from './ChatExcursoesStack';
import { PagamentosExcursoesStack } from './PagamentosExcursoesStack';
import { PerfilExcursoesStack } from './PerfilExcursoesStack';

type ExcursoesTabParamList = {
  HomeExc: undefined;
  ColetasExc: undefined;
  ChatExc: NavigatorScreenParams<ChatExcStackParamList>;
  PagamentosExc: NavigatorScreenParams<PagamentosExcStackParamList>;
  PerfilExc: NavigatorScreenParams<ProfileStackParamList>;
};

const Tab = createBottomTabNavigator<ExcursoesTabParamList>();

const TAB_ACTIVE = '#111827';
const TAB_INACTIVE = '#9CA3AF';
const TAB_BAR_CONTENT_HEIGHT = 56;
const MIN_BOTTOM_INSET = 8;

export function MainTabsExcursoes() {
  const insets = useSafeAreaInsets();
  const bottomPadding = Math.max(insets.bottom, MIN_BOTTOM_INSET);

  const tabBarVisibleStyle = {
    backgroundColor: '#FFFFFF' as const,
    borderTopWidth: 1,
    borderTopColor: '#E5E7EB',
    height: TAB_BAR_CONTENT_HEIGHT + bottomPadding,
    paddingBottom: bottomPadding,
    paddingTop: 6,
  };

  return (
    <Tab.Navigator
      screenOptions={{
        headerShown: false,
        tabBarShowLabel: true,
        tabBarActiveTintColor: TAB_ACTIVE,
        tabBarInactiveTintColor: TAB_INACTIVE,
        tabBarLabelStyle: { fontSize: 11, fontWeight: '600' },
        tabBarStyle: tabBarVisibleStyle,
        tabBarItemStyle: { paddingVertical: 4 },
      }}
    >
      <Tab.Screen
        name="HomeExc"
        component={ColetasExcursoesStack}
        options={({ route }) => {
          const focused = getFocusedRouteNameFromRoute(route) ?? 'ColetasMain';
          const hideTab =
            focused === 'RealizarEmbarques' ||
            focused === 'CadastrarPassageiroExcursao' ||
            focused === 'EmbarqueConcluido';
          return {
            title: 'Início',
            tabBarIcon: ({ color, focused: f }: { color: string; focused: boolean }) => (
              <MaterialIcons name="home" size={24} color={color} style={{ opacity: f ? 1 : 0.9 }} />
            ),
            tabBarStyle: hideTab ? { display: 'none' as const } : tabBarVisibleStyle,
          };
        }}
      />
      <Tab.Screen
        name="ColetasExc"
        component={ColetasExcursoesStack}
        options={({ route }) => {
          const focused = getFocusedRouteNameFromRoute(route) ?? 'ColetasMain';
          const hideTab =
            focused === 'RealizarEmbarques' ||
            focused === 'CadastrarPassageiroExcursao' ||
            focused === 'EmbarqueConcluido';
          return {
            title: 'Excursões',
            tabBarIcon: ({ color }: { color: string }) => (
              <MaterialIcons name="directions-bus" size={24} color={color} />
            ),
            tabBarStyle: hideTab ? { display: 'none' as const } : tabBarVisibleStyle,
          };
        }}
      />
      <Tab.Screen
        name="ChatExc"
        component={ChatExcursoesStack}
        options={({ route }) => {
          const focused = getFocusedRouteNameFromRoute(route) ?? 'ChatExcList';
          const hideTabOnChatThread = focused === 'ChatExcThread';
          return {
            title: 'Chat',
            tabBarIcon: ({ color }: { color: string }) => (
              <MaterialIcons name="message" size={24} color={color} />
            ),
            tabBarStyle: hideTabOnChatThread ? { display: 'none' as const } : tabBarVisibleStyle,
          };
        }}
      />
      <Tab.Screen
        name="PagamentosExc"
        component={PagamentosExcursoesStack}
        options={{
          title: 'Pagamentos',
          tabBarIcon: ({ color }) => <MaterialIcons name="payments" size={24} color={color} />,
        }}
      />
      <Tab.Screen
        name="PerfilExc"
        component={PerfilExcursoesStack}
        options={{
          title: 'Perfil',
          tabBarIcon: ({ color, focused }) => (
            <MaterialIcons name={focused ? 'person' : 'person-outline'} size={24} color={color} />
          ),
        }}
        listeners={({ navigation }) => ({
          tabPress: (e) => {
            e.preventDefault();
            navigation.navigate('PerfilExc', { screen: 'Settings' });
          },
        })}
      />
    </Tab.Navigator>
  );
}
