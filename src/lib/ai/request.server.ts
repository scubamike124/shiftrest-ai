/** Limit actual bytes read, including requests with no Content-Length header. */
export async function readAIRequestBody(request: Request, limit: number): Promise<
  { body: ArrayBuffer } | { response: Response }
> {
  const reader = request.body?.getReader();
  if (!reader) return invalid();
  let size = 0;
  const parts: Uint8Array[] = [];
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > limit) {
        await reader.cancel();
        return { response: Response.json({ error: "AI request is too large. Please shorten it." }, { status: 413 }) };
      }
      parts.push(value);
    }
    const bytes = new Uint8Array(size);
    let offset = 0;
    for (const part of parts) { bytes.set(part, offset); offset += part.byteLength; }
    return { body: bytes.buffer };
  } catch {
    return invalid();
  } finally {
    reader.releaseLock();
  }
}

export async function readAIJson(request: Request): Promise<
  { body: unknown } | { response: Response }
> {
  const input = await readAIRequestBody(request, 64 * 1024);
  if ('response' in input) return input;
  try {
    const body: unknown = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(input.body));
    if (!body || typeof body !== 'object' || Array.isArray(body)) return invalid();
    return { body };
  } catch {
    return invalid();
  }
}
function invalid() {
  return { response: Response.json({ error: "A valid request body is required." }, { status: 400 }) };
}
