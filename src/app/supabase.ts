import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { SUPABASE_KEY, SUPABASE_URL } from './config'

let client: SupabaseClient | null = null
export const hasSupabase = () => !!(SUPABASE_URL && SUPABASE_KEY)
export function sb(): SupabaseClient {
  if (!client) {
    if (!hasSupabase()) throw new Error('Supabase is not configured — set VITE_SUPABASE_URL and VITE_SUPABASE_KEY')
    client = createClient(SUPABASE_URL, SUPABASE_KEY, { auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true, experimental: { recoveryCodes: true } } })
  }
  return client
}
/** Which optional auth features the project has switched on (public endpoint, no secrets). null when it cannot be read. */
export async function authFeatures(): Promise<{ passkeys: boolean } | null> {
  try { const r = await fetch(`${SUPABASE_URL}/auth/v1/settings`, { headers: { apikey: SUPABASE_KEY } }); if (!r.ok) return null; const j = await r.json(); return { passkeys: !!j.passkeys_enabled } } catch { return null }
}
