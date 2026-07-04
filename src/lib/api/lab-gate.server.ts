// Server-side gate for /api/lab/* routes.
//
// Access rules (checked in order):
//   1. Valid Supabase bearer token belonging to a user with the 'tester' or
//      'admin' role → allow.
//   2. Otherwise → 403.
//
// The frontend /lab/* pages already hide themselves in production. This
// server gate ensures the lab APIs (which proxy paid third-party keys like
// SIMLI_API_KEY and ELEVENLABS_API_KEY) can't be hit directly by an
// anonymous caller on the published site.

import { createClient } from "@supabase/supabase-js";

function forbidden(reason: string): Response {
  return new Response(JSON.stringify({ error: reason }), {
    status: 403,
    headers: { "Content-Type": "application/json" },
  });
}

export async function requireLabAccess(request: Request): Promise<Response | null> {
  const authHeader = request.headers.get("authorization") || "";
  const token = authHeader.toLowerCase().startsWith("bearer ")
    ? authHeader.slice(7).trim()
    : "";
  if (!token) return forbidden("lab_access_required");

  const url = process.env.SUPABASE_URL;
  const anon = process.env.SUPABASE_PUBLISHABLE_KEY;
  if (!url || !anon) {
    console.error("[lab-gate] missing Supabase config");
    return forbidden("lab_access_unavailable");
  }

  const supa = createClient(url, anon, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { headers: { Authorization: `Bearer ${token}` } },
  });

  const { data: userData, error: userErr } = await supa.auth.getUser(token);
  if (userErr || !userData?.user) return forbidden("lab_access_required");

  const userId = userData.user.id;
  const [tester, admin] = await Promise.all([
    supa.rpc("has_role", { _user_id: userId, _role: "tester" }),
    supa.rpc("has_role", { _user_id: userId, _role: "admin" }),
  ]);
  const allowed = tester.data === true || admin.data === true;
  if (!allowed) return forbidden("lab_access_denied");

  return null;
}
