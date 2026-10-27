import { focusManager, QueryClient } from '@tanstack/react-query';
import { AppState, Platform } from 'react-native';

import { isAppError } from './functions';

const NO_RETRY = new Set(['unauthorized', 'not_found', 'bad_request', 'conflict']);

/** The app's single cache. Also used outside React (planner glue) via this import. */
export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 30_000,
      gcTime: 10 * 60_000,
      retry: (failureCount, error) => failureCount < 2 && !(isAppError(error) && NO_RETRY.has(error.code)),
    },
    mutations: {
      retry: false,
    },
  },
});

// TanStack Query's window-focus refetching, driven by AppState on native (TanStack RN guide).
if (Platform.OS !== 'web') {
  focusManager.setEventListener((setFocused) => {
    const subscription = AppState.addEventListener('change', (state) => setFocused(state === 'active'));
    return () => subscription.remove();
  });
}
