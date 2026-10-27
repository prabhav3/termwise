// Small, failure-tolerant wrapper around AsyncStorage for device-local preferences.
// Reads resolve to null and writes are dropped when storage is unavailable; callers always
// have a sensible default, so a storage failure must never break the app.
import AsyncStorage from '@react-native-async-storage/async-storage';

const PREFIX = 'termwise.';

export const storageKeys = {
  themeMode: `${PREFIX}themeMode`,
  lastReplanDate: (userId: string) => `${PREFIX}lastReplanDate.${userId}`,
} as const;

export async function readString(key: string): Promise<string | null> {
  try {
    return await AsyncStorage.getItem(key);
  } catch {
    return null;
  }
}

export async function writeString(key: string, value: string): Promise<void> {
  try {
    await AsyncStorage.setItem(key, value);
  } catch {
    // Preference not persisted; the in-memory value still applies for this session.
  }
}

export async function removeKey(key: string): Promise<void> {
  try {
    await AsyncStorage.removeItem(key);
  } catch {
    // Nothing to clean up if storage is unavailable.
  }
}
