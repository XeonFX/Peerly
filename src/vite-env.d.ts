/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_NOSTR_RELAYS: string
  readonly VITE_SIGNALING: 'ws-relay' | 'nostr' | 'supabase'
  readonly VITE_RELAY_PORT: string
  readonly VITE_SUPABASE_URL: string
  readonly VITE_SUPABASE_ANON_KEY: string
  readonly VITE_TURN_URLS: string
  readonly VITE_TURN_USERNAME: string
  readonly VITE_TURN_CREDENTIAL: string
  readonly VITE_GOOGLE_CLIENT_ID: string
  readonly VITE_MICROSOFT_CLIENT_ID: string
  readonly VITE_MICROSOFT_TENANT_ID: string
  readonly VITE_GITHUB_CLIENT_ID: string
  readonly VITE_GITHUB_TOKEN_PROXY: string
  readonly VITE_APPLE_CLIENT_ID: string
  readonly VITE_APPLE_REDIRECT_URI: string
  readonly VITE_OIDC_CLIENT_ID: string
  readonly VITE_OIDC_ISSUER: string
  readonly VITE_OIDC_LABEL: string
  readonly VITE_E2E_AUTH_BYPASS: string
}