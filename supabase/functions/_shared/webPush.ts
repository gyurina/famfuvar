/** RFC 8291 Web Push + VAPID (JWK kulcsimport) */

export function b64uDecode(s: string): Uint8Array {
  const base64 = s.replace(/-/g, '+').replace(/_/g, '/')
  const padded = base64 + '==='.slice((base64.length + 3) % 4)
  return Uint8Array.from(atob(padded), c => c.charCodeAt(0))
}

export function b64uEncode(buf: Uint8Array): string {
  return btoa(String.fromCharCode(...buf))
    .replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '')
}

function concat(...arrs: Uint8Array[]): Uint8Array {
  const out = new Uint8Array(arrs.reduce((n, a) => n + a.length, 0))
  let off = 0; for (const a of arrs) { out.set(a, off); off += a.length }
  return out
}

async function hmac(key: Uint8Array, data: Uint8Array): Promise<Uint8Array> {
  const k = await crypto.subtle.importKey('raw', key, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'])
  return new Uint8Array(await crypto.subtle.sign('HMAC', k, data))
}

export async function buildVapidHeader(
  endpoint: string,
  vapidPubB64u: string,
  vapidPrivB64u: string,
  subject: string,
): Promise<string> {
  const enc = new TextEncoder()
  const url = new URL(endpoint)
  const aud = `${url.protocol}//${url.host}`
  const exp = Math.floor(Date.now() / 1000) + 12 * 3600

  const toB64u = (s: string) => btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '')
  const hdr  = toB64u(JSON.stringify({ typ: 'JWT', alg: 'ES256' }))
  const pld  = toB64u(JSON.stringify({ aud, exp, sub: subject }))
  const data = `${hdr}.${pld}`

  const pubRaw = b64uDecode(vapidPubB64u)
  if (pubRaw[0] !== 0x04 || pubRaw.length !== 65) {
    throw new Error(`invalid VAPID public key length ${pubRaw.length}, first byte 0x${pubRaw[0].toString(16)}`)
  }
  const x = b64uEncode(pubRaw.slice(1, 33))
  const y = b64uEncode(pubRaw.slice(33, 65))

  const sigKey = await crypto.subtle.importKey(
    'jwk',
    { kty: 'EC', crv: 'P-256', d: vapidPrivB64u, x, y, key_ops: ['sign'] },
    { name: 'ECDSA', namedCurve: 'P-256' },
    false,
    ['sign'],
  )

  const sig    = new Uint8Array(await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, sigKey, enc.encode(data)))
  const sigB64 = toB64u(String.fromCharCode(...sig))
  return `vapid t=${data}.${sigB64},k=${vapidPubB64u}`
}

export async function encryptWebPush(
  payload: string,
  p256dhB64: string,
  authB64: string,
): Promise<Uint8Array> {
  const enc = new TextEncoder()
  const uaPub      = b64uDecode(p256dhB64)
  const authSecret = b64uDecode(authB64)

  if (uaPub.length !== 65) throw new Error(`p256dh length ${uaPub.length}, expected 65`)
  if (authSecret.length !== 16) throw new Error(`auth length ${authSecret.length}, expected 16`)

  const senderKP = await crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits'])
  const asPub    = new Uint8Array(await crypto.subtle.exportKey('raw', senderKP.publicKey))

  const uaKey      = await crypto.subtle.importKey('raw', uaPub, { name: 'ECDH', namedCurve: 'P-256' }, false, [])
  const ecdhSecret = new Uint8Array(await crypto.subtle.deriveBits({ name: 'ECDH', public: uaKey }, senderKP.privateKey, 256))

  const prkKey  = await hmac(authSecret, ecdhSecret)
  const keyInfo = concat(enc.encode('WebPush: info\x00'), uaPub, asPub)
  const ikm     = await hmac(prkKey, concat(keyInfo, new Uint8Array([1])))

  const salt  = crypto.getRandomValues(new Uint8Array(16))
  const prk   = await hmac(salt, ikm)
  const cek   = (await hmac(prk, concat(enc.encode('Content-Encoding: aes128gcm\x00'), new Uint8Array([1])))).slice(0, 16)
  const nonce = (await hmac(prk, concat(enc.encode('Content-Encoding: nonce\x00'),      new Uint8Array([1])))).slice(0, 12)

  const plaintext  = concat(enc.encode(payload), new Uint8Array([2]))
  const cekKey     = await crypto.subtle.importKey('raw', cek, 'AES-GCM', false, ['encrypt'])
  const ciphertext = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv: nonce }, cekKey, plaintext))

  const header = new Uint8Array(86)
  header.set(salt)
  new DataView(header.buffer).setUint32(16, 4096, false)
  header[20] = 65
  header.set(asPub, 21)

  return concat(header, ciphertext)
}
