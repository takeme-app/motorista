import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import type { NavigatorScreenParams } from '@react-navigation/native';
import { MaterialIcons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { HomeScreen } from '../screens/HomeScreen';
import { ServicesScreen } from '../screens/ServicesScreen';
import { ActivitiesStack } from './ActivitiesStack';
import { ProfileStack } from './ProfileStack';
import type { ProfileStackParamList } from './ProfileStackTypes';
import type { ActivitiesStackParamList } from './ActivitiesStackTypes';
import { getMainTabBarStyleFromInsets } from './mainTabBarStyle';

export type MainTabParamList = {
  Home: undefined;
  Services: undefined;
  Activities: NavigatorScreenParams<ActivitiesStackParamList>;
  Profile: NavigatorScreenParams<ProfileStackParamList>;
};

const Tab = createBottomTabNavigator<MainTabParamList>();

const TAB_ACTIVE = '#0d0d0d';
const TAB_INACTIVE = '#767676';

export function MainTabs() {
  const insets = useSafeAreaInsets();

  return (
    <Tab.Navigator
      screenOptions={{
        headerShown: false,
        tabBarShowLabel: true,
        tabBarActiveTintColor: TAB_ACTIVE,
        tabBarInactiveTintColor: TAB_INACTIVE,
        tabBarLabelStyle: {
          fontSize: 12,
          fontWeight: '500',
        },
        tabBarStyle: getMainTabBarStyleFromInsets(insets),
        tabBarItemStyle: {
          paddingVertical: 8,
        },
      }}
    >
      <Tab.Screen
        name="Home"
        component={HomeScreen}
        options={{
          title: 'Início',
          tabBarIcon: ({ color, focused }) => (
            <MaterialIcons
              name={focused ? 'home' : 'home'}
              size={24}
              color={color}
            />
          ),
        }}
      />
      <Tab.Screen
        name="Services"
        component={ServicesScreen}
        options={{
          title: 'Serviços',
          tabBarIcon: ({ color }) => (
            <MaterialIcons name="apps" size={24} color={color} />
          ),
        }}
      />
      <Tab.Screen
        name="Activities"
        component={ActivitiesStack}
        options={{
          title: 'Atividades',
          tabBarIcon: ({ color }) => (
            <MaterialIcons name="receipt" size={24} color={color} />
          ),
        }}
        listeners={({ navigation }) => ({
          // Tocar na aba sempre volta para a lista de atividades (evita reabrir
          // uma tela aninhada — ex.: o chat "Time de Encomendas" — que ficou no topo da pilha).
          tabPress: (e) => {
            e.preventDefault();
            navigation.navigate('Activities', { screen: 'ActivitiesList' });
          },
        })}
      />
      <Tab.Screen
        name="Profile"
        component={ProfileStack}
        options={{
          title: 'Perfil',
          tabBarIcon: ({ color }) => (
            <MaterialIcons name="person-outline" size={24} color={color} />
          ),
        }}
        listeners={({ navigation }) => ({
          tabPress: (e) => {
            e.preventDefault();
            navigation.navigate('Profile', { screen: 'ProfileMain' });
          },
        })}
      />
    </Tab.Navigator>
  );
}
