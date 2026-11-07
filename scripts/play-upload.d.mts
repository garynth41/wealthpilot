// Types for scripts/play-upload.mjs (used by its unit test, src/lib/storeRelease.test.ts).
export interface ServiceAccount { client_email: string; private_key: string; token_uri?: string }
export const PACKAGE: string
export const TRACKS: string[]
export function signJwt(serviceAccount: ServiceAccount, nowSeconds?: number): string
export function uploadBundle(o: {
  serviceAccount: ServiceAccount; bundle: Uint8Array; track: string; status?: 'draft' | 'completed'; notes?: string; packageName?: string
  fetchImpl?: (url: string, init?: RequestInit) => Promise<Response>; log?: (m: string) => void
}): Promise<{ versionCode: number; track: string; status: string }>
