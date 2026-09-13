/** POST to a Web Push endpoint with retry on 429. */

export async function sendWithRetry(
  endpoint: string,
  body: Uint8Array,
  headers: Record<string, string>,
  attempts = 3,
): Promise<Response> {
  let last: Response | undefined
  for (let i = 0; i < attempts; i++) {
    last = await fetch(endpoint, { method: 'POST', headers, body })
    if (last.ok || last.status === 410 || last.status === 404) return last
    if (last.status === 429 && i < attempts - 1) {
      await new Promise(r => setTimeout(r, 1000 * (i + 1)))
      continue
    }
    return last
  }
  return last!
}
