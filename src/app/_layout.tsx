import { Stack } from 'expo-router';

// Placeholder root layout; replaced by the app foundation (providers, auth guard, tabs).
export default function RootLayout() {
  return <Stack screenOptions={{ headerShown: false }} />;
}
