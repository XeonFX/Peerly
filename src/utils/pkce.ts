import { bytesToBase64Url } from './base64url'

export type PkcePair = {
  verifier: string
  challenge: string
}

export async function createPkcePair(): Promise<PkcePair> {
  const verifier = bytesToBase64Url(crypto.getRandomValues(new Uint8Array(32)))
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier))
  const challenge = bytesToBase64Url(new Uint8Array(digest))
  return { verifier, challenge }
}