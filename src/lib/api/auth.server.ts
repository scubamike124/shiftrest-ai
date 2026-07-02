// Shared server-side helper: verify a Supabase bearer token on public
// API routes. Returns the authenticated user id, or a 401 Response the
// caller should return immediately.
//
// This exists so /api/ai, /api/tts, /api/tts-elevenlabs, and /api/brief
// stop accepting anonymous requests (which previously skipped the AI
// budget gate).

import { createClient, type SupabaseClient } from "@supabase/supabase-js";

let cached: SupabaseClient | null = null;

function admin(): SupabaseClient | null {
  if (cached) return cached;
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return null;
  cached = createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  return cached;
}

function unauthorized(msg = "Unauthorized"): Response {
  return new Response(JSON.stringify({ error: msg }), {
    status: 401,
    headers: { "Content-Type": "application/json" },
  });
}

/**
 * Resolve the authenticated user from a request. Returns either:
 *   { userId: string }  → caller may proceed
 *   { response: Response } → caller must return this immediately (401)
 */
export async function requireUser(
  request: Request,
): Promise<{ userId: string } | { response: Response }> {
  const authHeader = request.headers.get("authorization");
  if (!authHeader) return { response: unauthorized("Missing authorization") };
  const token = authHeader.replace(/^Bearer\s+/i, "").trim();
  if (!token) return { response: unauthorized("Missing bearer token") };

  const supa = admin();
  if (!supa) {
    return {
      response: new Response(
        JSON.stringify({ error: "Auth backend not configured" }),
        { status: 500, headers: { "Content-Type": "application/json" } },
      ),
    };
  }
  try {
    const { data, error } = await supa.auth.getUser(token);
    const uid = data?.user?.id;
    if (error || !uid) return { response: unauthorized("Invalid session") };
    return { userId: uid };
  } catch {
    return { response: unauthorized("Session verification failed") };
  }
}
