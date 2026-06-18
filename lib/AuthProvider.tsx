import React, { createContext, useContext, useEffect, useState } from 'react';
import * as Linking from 'expo-linking';
import type { Session } from '@supabase/supabase-js';
import { supabase } from './supabase';

interface AuthContextValue {
  session: Session | null;
  loading: boolean;
  sendMagicLink: (email: string) => Promise<void>;
  verifyTokenHash: (tokenHash: string) => Promise<void>;
  signOut: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | undefined>(undefined);

function createSessionFromUrl(url: string) {
  const { queryParams } = Linking.parse(url);
  const access_token = queryParams?.access_token as string | undefined;
  const refresh_token = queryParams?.refresh_token as string | undefined;
  if (!access_token || !refresh_token) return;
  return supabase.auth.setSession({ access_token, refresh_token });
}

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session);
      setLoading(false);
    });

    const { data: authListener } = supabase.auth.onAuthStateChange((_event, newSession) => {
      setSession(newSession);
    });

    const linkSub = Linking.addEventListener('url', ({ url }) => {
      createSessionFromUrl(url);
    });

    Linking.getInitialURL().then(url => {
      if (url) createSessionFromUrl(url);
    });

    return () => {
      authListener.subscription.unsubscribe();
      linkSub.remove();
    };
  }, []);

  const sendMagicLink = async (email: string) => {
    const redirectTo = Linking.createURL('login-callback');
    const { error } = await supabase.auth.signInWithOtp({ email, options: { emailRedirectTo: redirectTo } });
    if (error) throw error;
  };

  // Verifies using the `token` query param from the emailed link directly —
  // no redirect/deep-link hand-off required, so it works regardless of
  // Expo Go's dynamic exp:// host or mail-app link mangling.
  const verifyTokenHash = async (tokenHash: string) => {
    const { error } = await supabase.auth.verifyOtp({ token_hash: tokenHash, type: 'magiclink' });
    if (error) throw error;
  };

  const signOut = async () => {
    await supabase.auth.signOut();
  };

  return (
    <AuthContext.Provider value={{ session, loading, sendMagicLink, verifyTokenHash, signOut }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
}
