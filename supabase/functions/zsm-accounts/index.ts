import { createClient } from "@supabase/supabase-js";

const OWNER_ID = "e23ae168-d8a1-430d-ba17-59b3cb5949f5";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const reply = (body: unknown, status = 200) => new Response(JSON.stringify(body), {
  status, headers: { ...cors, "Content-Type": "application/json", "Cache-Control": "no-store" },
});
const validId = (value: unknown): value is string => typeof value === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return reply({ error: "METHOD_NOT_ALLOWED" }, 405);
  try {
    const authorization = req.headers.get("Authorization") || "";
    if (!/^Bearer \S+$/.test(authorization)) return reply({ error: "AUTH_REQUIRED" }, 401);
    const url = Deno.env.get("SUPABASE_URL")!;
    const options = { auth: { persistSession: false, autoRefreshToken: false } };
    const caller = createClient(url, Deno.env.get("SUPABASE_ANON_KEY")!, {
      ...options, global: { headers: { Authorization: authorization } },
    });
    const { data: identity, error: identityError } = await caller.auth.getUser(authorization.slice(7));
    if (identityError || !identity.user || identity.user.is_anonymous) return reply({ error: "AUTH_REQUIRED" }, 401);
    const { data: actor, error: profileError } = await caller.rpc("zsm_current_profile").single();
    if (profileError || !actor || actor.id !== identity.user.id || actor.status !== "active" || actor.role !== "admin") {
      return reply({ error: "ADMIN_REQUIRED" }, 403);
    }
    const isOwner = actor.id === OWNER_ID;
    const admin = createClient(url, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, options);
    const length = Number(req.headers.get("content-length") || 0);
    if (length > 16384) return reply({ error: "INVALID_INPUT" }, 400);
    const text = await req.text();
    if (text.length > 16384) return reply({ error: "INVALID_INPUT" }, 400);
    let body;
    try { body = JSON.parse(text); } catch { return reply({ error: "INVALID_INPUT" }, 400); }
    if (!body || Array.isArray(body) || typeof body !== "object") return reply({ error: "INVALID_INPUT" }, 400);

    if (body.action === "list") {
      const page = Math.max(1, Math.min(100000, Math.floor(Number(body.page) || 1)));
      const perPage = 30;
      const { data, error } = await admin.auth.admin.listUsers({ page, perPage });
      if (error) throw error;
      const ids = data.users.map(user => user.id);
      const { data: profiles, error: readError } = ids.length
        ? await admin.from("zsm_profiles").select("id,display_name,role,status").in("id", ids)
        : { data: [], error: null };
      if (readError) throw readError;
      const byId = new Map((profiles || []).map(profile => [profile.id, profile]));
      return reply({ users: data.users.map(user => ({
        id: user.id, email: user.email || "", created_at: user.created_at,
        last_sign_in_at: user.last_sign_in_at || null, email_confirmed: !!user.email_confirmed_at,
        ...(byId.get(user.id) || { display_name: "", role: "member", status: "blocked" }),
      })), page, hasMore: !!data.nextPage });
    }

    if (body.action === "create") {
      const email = typeof body.email === "string" ? body.email.trim().toLowerCase() : "";
      const password = typeof body.password === "string" ? body.password : "";
      const name = typeof body.display_name === "string" ? body.display_name.trim() : "";
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 254 || password.length < 10 || password.length > 128 || name.length > 80 || !["member", "admin"].includes(body.role)) {
        return reply({ error: "INVALID_INPUT" }, 400);
      }
      if (body.role === "admin" && !isOwner) return reply({ error: "OWNER_REQUIRED" }, 403);
      // Admin supplies a temporary password directly; no invitation email is sent.
      const { data, error } = await admin.auth.admin.createUser({ email, password, email_confirm: true, user_metadata: { display_name: name } });
      if (error) return reply({ error: "CREATE_FAILED", detail: error.code || "" }, 400);
      // Recheck the administrator under the same lock used by role changes.
      const { error: promoteError } = await caller.rpc("zsm_admin_update_account", {
        p_actor: actor.id, p_target: data.user.id, p_role: body.role, p_status: "active", p_display_name: name,
      });
      if (promoteError) {
        await admin.auth.admin.deleteUser(data.user.id);
        throw promoteError;
      }
      // Auth's service request creates the row without the caller's JWT.
      // Attribute its existing creation event to the administrator we verified.
      const { error: auditError } = await admin.from("zsm_account_audit")
        .update({ actor_id: actor.id, actor_name: actor.display_name || "" })
        .eq("target_id", data.user.id).eq("action", "created").is("actor_id", null);
      if (auditError) console.error("Account created; audit attribution failed", auditError.code);
      return reply({ success: true, id: data.user.id });
    }

    if (body.action === "update") {
      if (!validId(body.id) || !["admin", "member"].includes(body.role) || !["active", "blocked"].includes(body.status) || typeof body.display_name !== "string" || body.display_name.trim().length > 80) {
        return reply({ error: "INVALID_INPUT" }, 400);
      }
      const { data, error } = await caller.rpc("zsm_admin_update_account", {
        p_actor: actor.id, p_target: body.id, p_role: body.role,
        p_status: body.status, p_display_name: body.display_name.trim(),
      });
      if (error) {
        const safeError = ["OWNER_PROTECTED", "OWNER_REQUIRED", "ADMIN_PROTECTED", "SELF_PROTECTED", "LAST_ADMIN", "ACCOUNT_NOT_FOUND", "ADMIN_REQUIRED", "AUTH_REQUIRED", "INVALID_INPUT"].find(code => error.message.includes(code));
        return reply({ error: safeError || "UPDATE_FAILED" }, safeError === "AUTH_REQUIRED" ? 401 : ["ADMIN_REQUIRED", "OWNER_PROTECTED", "OWNER_REQUIRED", "ADMIN_PROTECTED"].includes(safeError || "") ? 403 : 400);
      }
      return reply({ success: true, profile: data });
    }
    return reply({ error: "INVALID_ACTION" }, 400);
  } catch (error) {
    console.error("zsm-accounts request failed", error instanceof Error ? error.message : "unknown");
    return reply({ error: "SERVER_ERROR" }, 500);
  }
});
