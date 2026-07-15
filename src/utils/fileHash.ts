/**
 * File ids are the SHA-256 of the file's bytes, hex-encoded — not random. This
 * is what lets `handleFileReceived` verify a file rather than trust it.
 *
 * With random ids, any peer answering a pull request could serve different
 * bytes under a legitimate file's id (poisoning) or claim to "update" an
 * existing file by reusing its id (overwrite). Content-addressing makes both a
 * SHA-256 preimage attack: infeasible. It also means identical uploads from
 * different sends collapse to the same id for free.
 */
export async function hashFileBytes(buffer: ArrayBuffer): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', buffer)
  return Array.from(new Uint8Array(digest))
    .map(byte => byte.toString(16).padStart(2, '0'))
    .join('')
}

/**
 * The security check itself: does this data actually hash to the id a peer
 * claims it does? Call this on every file received over the wire, before the
 * bytes are stored or shown to the user.
 */
export async function fileContentMatchesId(data: ArrayBuffer, claimedId: string): Promise<boolean> {
  return (await hashFileBytes(data)) === claimedId
}
