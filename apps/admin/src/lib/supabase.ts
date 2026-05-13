import Constants from 'expo-constants';
import { createSupabaseClient } from '@take-me/shared';

// Lê de extra (app.config.js carrega .env em Node) — funciona local e na Vercel.
// Usar `||` para fallback: no web o `extra` pode vir com string vazia (manifest/cache);
// `??` não cairia para process.env e o Metro deixaria isSupabaseConfigured falso.
const extra = Constants.expoConfig?.extra as { supabaseUrl?: string; supabaseAnonKey?: string } | undefined;
const supabaseUrl = (
  (extra?.supabaseUrl && String(extra.supabaseUrl).trim()) ||
  (typeof process !== 'undefined' && process.env.EXPO_PUBLIC_SUPABASE_URL
    ? String(process.env.EXPO_PUBLIC_SUPABASE_URL).trim()
    : '') ||
  ''
);
const supabaseAnonKey = (
  (extra?.supabaseAnonKey && String(extra.supabaseAnonKey).trim()) ||
  (typeof process !== 'undefined' && process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY
    ? String(process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY).trim()
    : '') ||
  ''
);

const configured =
  Boolean(supabaseUrl && supabaseAnonKey && supabaseUrl.startsWith('https://'));

// Só cria o client com URL/key reais; senão usa placeholders para não quebrar (Supabase exige URL)
const url = configured ? supabaseUrl : 'https://placeholder.supabase.co';
const key = configured ? supabaseAnonKey : 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.placeholder';

export const supabase = createSupabaseClient(url, key, {
  auth: {
    autoRefreshToken: true,
    persistSession: true,
    detectSessionInUrl: true,
  },
});

export const isSupabaseConfigured = configured;
