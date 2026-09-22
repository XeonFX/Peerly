import type { OidcDeviceAttestation } from './oidcDeviceBinding.js'
export type CertificateAttestation = { certificate: string }
export type IdentityAttestation = OidcDeviceAttestation | CertificateAttestation
export function isCertificateAttestation(raw: unknown): raw is CertificateAttestation {
  if (!raw || typeof raw !== 'object') return false
  const value = raw as Partial<CertificateAttestation>
  return typeof value.certificate === 'string' && value.certificate.length > 0 && value.certificate.length <= 2048
}
/** Canonical legacy fields stay unchanged, allowing local historical reads. */
export function identityAttestationFields(value: IdentityAttestation): string[] {
  return isCertificateAttestation(value) ? ['peerly-certificate-v1', value.certificate] : [value.providerId, value.idToken]
}
