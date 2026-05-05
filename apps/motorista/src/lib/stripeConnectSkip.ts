import AsyncStorage from '@react-native-async-storage/async-storage';

const STRIPE_CONNECT_SKIP_PREFIX = 'motorista:stripe-connect-skipped:';

function skipKey(userId: string): string {
  return `${STRIPE_CONNECT_SKIP_PREFIX}${userId}`;
}

export async function markStripeConnectSetupSkipped(userId: string): Promise<void> {
  await AsyncStorage.setItem(skipKey(userId), new Date().toISOString());
}

export async function hasSkippedStripeConnectSetup(userId: string): Promise<boolean> {
  const value = await AsyncStorage.getItem(skipKey(userId));
  return Boolean(value);
}

export async function clearStripeConnectSetupSkipped(userId: string): Promise<void> {
  await AsyncStorage.removeItem(skipKey(userId));
}
