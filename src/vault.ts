// Seals saves so they can't be edited by hand. The key mixes a secret baked into the game, a random
// salt made on your first visit and the browser you play in, so a save only opens where it was written.
// Saves are compressed, then encrypted with AES-GCM. Its auth tag catches any edit, so a doctored
// save fails to open instead of loading with extra bCoins.
//
// Anyone who reads this file can rebuild the key, as with any game that saves in the browser. The aim is
// to make cheating cost more effort than mowing.

const PEPPER = 'grass-cutter/v3/keep-off-the-grass'
const SALT_KEY = 'grass-cutter/salt'
const IV_BYTES = 12

/**
 * The parts of the browser that survive updates: the user agent with its version numbers stripped, and
 * the platform. Screen size, time zone and IP address all change too often to tie a three-hour save to.
 */
export function browserFingerprint() {
  return `${navigator.userAgent.replace(/[\d._]+/g, '')}|${navigator.platform}`
}

/** This browser's random salt, created the first time it's asked for. */
export function installSalt() {
  const existing = localStorage.getItem(SALT_KEY)
  if (existing) return existing
  const salt = toBase64(crypto.getRandomValues(new Uint8Array(16)))
  localStorage.setItem(SALT_KEY, salt)
  return salt
}

export async function deriveKey(salt: string, fingerprint: string) {
  const material = new TextEncoder().encode(`${PEPPER}|${salt}|${fingerprint}`)
  const hash = await crypto.subtle.digest('SHA-256', material)
  return crypto.subtle.importKey('raw', hash, 'AES-GCM', false, ['encrypt', 'decrypt'])
}

async function pipe(bytes: Uint8Array<ArrayBuffer>, stream: CompressionStream | DecompressionStream) {
  return new Uint8Array(await new Response(new Blob([bytes]).stream().pipeThrough(stream)).arrayBuffer())
}

/** Compresses and encrypts `bytes` into text that fits in localStorage. */
export async function seal(key: CryptoKey, bytes: Uint8Array<ArrayBuffer>) {
  const iv = crypto.getRandomValues(new Uint8Array(IV_BYTES))
  const packed = await pipe(bytes, new CompressionStream('deflate-raw'))
  const cipher = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, packed))
  const out = new Uint8Array(IV_BYTES + cipher.length)
  out.set(iv)
  out.set(cipher, IV_BYTES)
  return toBase64(out)
}

/** The bytes sealed into `text`, or null if it was edited, damaged or sealed with another key. */
export async function unseal(key: CryptoKey, text: string) {
  try {
    const raw = fromBase64(text)
    const plain = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: raw.subarray(0, IV_BYTES) }, key, raw.subarray(IV_BYTES))
    return await pipe(new Uint8Array(plain), new DecompressionStream('deflate-raw'))
  } catch {
    return null
  }
}

function toBase64(bytes: Uint8Array) {
  // In slices: spreading a big array into one call can overflow the stack.
  let binary = ''
  for (let i = 0; i < bytes.length; i += 8192) binary += String.fromCharCode(...bytes.subarray(i, i + 8192))
  return btoa(binary)
}

function fromBase64(text: string) {
  const binary = atob(text)
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)
  return bytes
}
