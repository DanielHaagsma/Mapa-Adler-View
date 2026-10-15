// supabase.js
import "react-native-url-polyfill/auto";
import { createClient } from "@supabase/supabase-js";

const rawSupabaseUrl =
  process.env.EXPO_PUBLIC_SUPABASE_URL ||
  "https://eelsejrzbpeqppgbqdvn.supabase.co";
const rawSupabaseAnonKey =
  process.env.EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY ||
  process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY ||
  "sb_publishable_c5whQGSfGPONEOdCZbSMGg_N9wC5x-G";

const SUPABASE_URL = rawSupabaseUrl
  .replace(/\/+$/, "")
  .replace(/\/rest\/v1\/?$/, "");

const SUPABASE_ANON_KEY = rawSupabaseAnonKey.trim();

if (
  SUPABASE_URL.includes("SEU_PROJETO") ||
  SUPABASE_ANON_KEY.includes("SUA_ANON_KEY") ||
  !SUPABASE_ANON_KEY ||
  !SUPABASE_URL.startsWith("https://")
) {
  console.warn(
    "Supabase ainda não está configurado. Defina EXPO_PUBLIC_SUPABASE_URL e EXPO_PUBLIC_SUPABASE_ANON_KEY no arquivo .env",
  );
}

export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
  auth: {
    persistSession: false,
    autoRefreshToken: false,
    detectSessionInUrl: false,
  },
});
