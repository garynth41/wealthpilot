import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { SUPABASE_KEY, SUPABASE_URL } from './config'

let client: SupabaseClient | null = null
export const hasSupabase = () => !!(SUPABASE_URL && SUPABASE_KEY)
export function sb(): SupabaseClient {
  if (!client) {
    if (!hasSupabase()) throw new Error('Supabase is not configured — set VITE_SUPABASE_URL and VITE_SUPABASE_KEY')
    client = createClient(SUPABASE_URL, SUPABASE_KEY, { auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true } })
  }
  return client
}
