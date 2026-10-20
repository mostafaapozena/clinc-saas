import { QueryClient, QueryCache, MutationCache, useQuery, useQueryClient } from '@tanstack/react-query';
import { setLanguage } from '../i18n';
import { ApiError, api, setCsrfToken } from '../lib/api';
import type { Language, SessionData } from '../lib/types';

export const SESSION_KEY = ['session'] as const;

async function fetchSession(): Promise<SessionData | null> {
  try {
    const session = await api<SessionData | { user: null }>('/auth/session');
    if (!session.user) {
      setCsrfToken(null);
      return null;
    }
    setCsrfToken(session.csrfToken);
    return session;
  } catch (error) {
    if (error instanceof ApiError && error.status === 401) {
      setCsrfToken(null);
      return null;
    }
    throw error;
  }
}

export function createQueryClient() {
  // Any 401 means the session ended (logout elsewhere, expiry): drop to signed-out state.
  const onError = (error: unknown) => {
    if (error instanceof ApiError && error.status === 401) {
      setCsrfToken(null);
      client.setQueryData(SESSION_KEY, null);
    }
  };
  const client: QueryClient = new QueryClient({
    queryCache: new QueryCache({ onError }),
    mutationCache: new MutationCache({ onError }),
    defaultOptions: {
      queries: {
        retry: (count, error) => !(error instanceof ApiError && error.status > 0 && error.status < 500) && count < 2,
        refetchOnWindowFocus: true,
      },
    },
  });
  return client;
}

export function useSession() {
  return useQuery({ queryKey: SESSION_KEY, queryFn: fetchSession, staleTime: 30_000 });
}

export function useAuthActions() {
  const queryClient = useQueryClient();

  /** Every new session starts from an empty cache so no previous user's data can appear. */
  const startSession = async (session: SessionData) => {
    setCsrfToken(session.csrfToken);
    queryClient.clear();
    queryClient.setQueryData(SESSION_KEY, session);
    await setLanguage(session.user.preferredLanguage);
  };

  return {
    login: async (email: string, password: string) => {
      const session = await api<SessionData>('/auth/login', { method: 'POST', body: { email, password } });
      await startSession(session);
      return session;
    },
    register: async (input: { email: string; password: string; displayName: string; preferredLanguage: Language }) => {
      const session = await api<SessionData>('/auth/register', { method: 'POST', body: input });
      await startSession(session);
      return session;
    },
    logout: async () => {
      try {
        await api('/auth/logout', { method: 'POST' });
      } finally {
        setCsrfToken(null);
        queryClient.clear();
        queryClient.setQueryData(SESSION_KEY, null);
      }
    },
    refreshSession: () => queryClient.invalidateQueries({ queryKey: SESSION_KEY }),
  };
}
