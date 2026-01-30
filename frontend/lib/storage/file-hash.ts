'use client';

/**
 * Compute a stable content identifier for deduplication.
 * - Files ≤ 50MB: full SHA-256 (strong dedup).
 * - Files > 50MB: "quick" hash = SHA-256(size || first 5MB || last 5MB) to avoid
 *   long computation and large memory; tradeoff: theoretical collision risk.
 */
const FULL_HASH_SIZE_LIMIT = 50 * 1024 * 1024; // 50MB
const QUICK_HASH_HEAD_TAIL = 5 * 1024 * 1024; // 5MB

function bufferToHex(buffer: ArrayBuffer): string {
  return Array.from(new Uint8Array(buffer))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

export async function computeFileHash(file: File): Promise<string> {
  if (file.size <= FULL_HASH_SIZE_LIMIT) {
    const buffer = await file.arrayBuffer();
    const hash = await crypto.subtle.digest('SHA-256', buffer);
    return bufferToHex(hash);
  }
  // Quick hash for large files
  const head = await file.slice(0, QUICK_HASH_HEAD_TAIL).arrayBuffer();
  const tailStart = Math.max(0, file.size - QUICK_HASH_HEAD_TAIL);
  const tail = await file.slice(tailStart, file.size).arrayBuffer();
  const sizeBytes = new ArrayBuffer(8);
  new DataView(sizeBytes).setBigUint64(0, BigInt(file.size), true);
  const combined = new Uint8Array(8 + head.byteLength + tail.byteLength);
  combined.set(new Uint8Array(sizeBytes), 0);
  combined.set(new Uint8Array(head), 8);
  combined.set(new Uint8Array(tail), 8 + head.byteLength);
  const hash = await crypto.subtle.digest('SHA-256', combined);
  return bufferToHex(hash);
}
