const SALT = 'study-market-access-v1'
const ITERATIONS = 120000
const EXPECTED_HASH = '6a54fd223ed346350d2100cb8932fba11696ab709fe0168524be59457f5461b0'

function toHex(buffer) {
  return [...new Uint8Array(buffer)]
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('')
}

export async function verifyStockAccess(password) {
  const subtle = globalThis.crypto?.subtle
  if (!subtle) throw new Error('Web Crypto unavailable')
  const encoder = new TextEncoder()
  const key = await subtle.importKey(
    'raw',
    encoder.encode(String(password)),
    'PBKDF2',
    false,
    ['deriveBits'],
  )
  const result = await subtle.deriveBits({
    name: 'PBKDF2',
    hash: 'SHA-256',
    salt: encoder.encode(SALT),
    iterations: ITERATIONS,
  }, key, 256)
  return toHex(result) === EXPECTED_HASH
}
