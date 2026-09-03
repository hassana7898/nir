import { createClient } from "npm:@supabase/supabase-js@2";

const COLLECTION = "poultryData";
const SESSION_COOKIE = "nir_cloud_session";
const SESSION_TTL_MS = 12 * 60 * 60 * 1000;
const SYNC_TOKEN = Deno.env.get("NIR_CLOUD_SYNC_TOKEN") || "";

const secretKeysRaw = Deno.env.get("SUPABASE_SECRET_KEYS") || "";
let secretKey = "";
try { secretKey = JSON.parse(secretKeysRaw)?.default || ""; } catch {}
if (!secretKey) secretKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
const supabase = createClient(Deno.env.get("SUPABASE_URL") || "", secretKey);

function corsHeaders(req: Request): HeadersInit {
  const origin = req.headers.get("Origin");
  return {
    "Access-Control-Allow-Origin": origin || "*",
    "Access-Control-Allow-Credentials": "true",
    "Access-Control-Allow-Headers": "authorization, apikey, x-client-info, content-type, x-nir-sync-token, x-nir-session",
    "Access-Control-Allow-Methods": "GET, POST, PUT, OPTIONS",
    "Vary": "Origin",
    "Content-Type": "application/json",
  };
}

function response(req: Request, body: unknown, status = 200, extra: HeadersInit = {}) {
  return new Response(JSON.stringify(body), { status, headers: { ...corsHeaders(req), ...extra } });
}

function parseCookies(req: Request) {
  const header = req.headers.get("Cookie") || "";
  const out: Record<string, string> = {};
  for (const part of header.split(";")) {
    const i = part.indexOf("=");
    if (i < 0) continue;
    out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
  }
  return out;
}

function bytesToHex(bytes: Uint8Array) { return [...bytes].map(b => b.toString(16).padStart(2, "0")).join(""); }

async function sha256(text: string) {
  return bytesToHex(new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text))));
}

async function hmacHex(keyText: string, payload: string) {
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(keyText), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return bytesToHex(new Uint8Array(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(payload))));
}

async function timingSafeEqual(a: string, b: string) {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

async function getPasswordRecord() {
  const { data, error } = await supabase.from("app_storage").select("document_id,data").eq("collection_name", COLLECTION).in("document_id", ["poultryAppPasswordHash", "poultryAppPasswordSalt"]);
  if (error) throw error;
  const values: Record<string, string> = {};
  for (const row of data || []) values[row.document_id] = row.data?.value || "";
  return { hash: values.poultryAppPasswordHash || "", salt: values.poultryAppPasswordSalt || "" };
}

async function verifySessionToken(token: string) {
  const { hash, salt } = await getPasswordRecord();
  if (!hash || !salt || !token) return false;
  const parts = token.split(".");
  if (parts.length !== 3) return false;
  const issuedAt = Number(parts[0]);
  if (!Number.isFinite(issuedAt) || Date.now() - issuedAt < 0 || Date.now() - issuedAt > SESSION_TTL_MS) return false;
  const version = await hmacHex(hash, `password-version:${hash}`);
  if (!(await timingSafeEqual(parts[1], version))) return false;
  const expected = await hmacHex(hash, `${issuedAt}.${version}`);
  return timingSafeEqual(parts[2], expected);
}

async function verifyCloudSession(req: Request) {
  const headerToken = req.headers.get("X-NIR-Session") || "";
  if (headerToken && await verifySessionToken(headerToken)) return true;
  const cookieToken = parseCookies(req)[SESSION_COOKIE] || "";
  return verifySessionToken(cookieToken);
}

async function login(req: Request) {
  const body = await req.json().catch(() => ({}));
  const password = body?.password;
  if (typeof password !== "string") return response(req, { ok: false, error: "Password is required" }, 400);
  const record = await getPasswordRecord();
  if (!record.hash || !record.salt) return response(req, { ok: false, error: "Password is not configured" }, 409);
  const candidate = await sha256(password + record.salt);
  if (!(await timingSafeEqual(candidate, record.hash))) return response(req, { ok: false, error: "رمز عبور نادرست است." }, 401);
  const issuedAt = Date.now();
  const version = await hmacHex(record.hash, `password-version:${record.hash}`);
  const signature = await hmacHex(record.hash, `${issuedAt}.${version}`);
  const token = `${issuedAt}.${version}.${signature}`;
  return response(req, { ok: true, session: token }, 200, { "Set-Cookie": `${SESSION_COOKIE}=${encodeURIComponent(token)}; Path=/; HttpOnly; SameSite=None; Secure; Max-Age=${Math.floor(SESSION_TTL_MS / 1000)}` });
}

async function setupPassword(req: Request) {
  const body = await req.json().catch(() => ({}));
  const password = body?.password;
  if (typeof password !== "string" || password.length < 4) return response(req, { ok: false, error: "Password must be at least 4 characters" }, 400);
  const existing = await getPasswordRecord();
  if (existing.hash && existing.salt) return response(req, { ok: false, error: "Password is already configured" }, 409);
  const salt = bytesToHex(crypto.getRandomValues(new Uint8Array(16)));
  const hash = await sha256(password + salt);
  const now = new Date().toISOString();
  const rows = [
    { collection_name: COLLECTION, document_id: "poultryAppPasswordSalt", data: { value: salt }, updated_at: now },
    { collection_name: COLLECTION, document_id: "poultryAppPasswordHash", data: { value: hash }, updated_at: now },
  ];
  const { error } = await supabase.from("app_storage").upsert(rows, { onConflict: "collection_name,document_id" });
  if (error) return response(req, { ok: false, error: error.message }, 500);
  return response(req, { ok: true });
}

async function storage(req: Request, parts: string[]) {
  if (parts[0] !== COLLECTION) return response(req, { error: "Collection not found" }, 404);
  const syncRequest = Boolean(SYNC_TOKEN) && (req.headers.get("X-NIR-Sync-Token") || "") === SYNC_TOKEN;
  const cloudSession = syncRequest ? false : await verifyCloudSession(req);
  if (!syncRequest && !cloudSession) return response(req, { error: "احراز هویت لازم است." }, 401);

  if (req.method === "GET" && parts.length === 1) {
    const { data, error } = await supabase.from("app_storage").select("document_id,data,updated_at").eq("collection_name", COLLECTION).order("updated_at", { ascending: true });
    if (error) return response(req, { error: error.message }, 502);
    return response(req, { documents: (data || []).map(row => ({ id: row.document_id, data: row.data, updatedAt: row.updated_at })) });
  }
  if (req.method === "GET" && parts.length === 2) {
    const { data, error } = await supabase.from("app_storage").select("document_id,data,updated_at").eq("collection_name", COLLECTION).eq("document_id", parts[1]).maybeSingle();
    if (error) return response(req, { error: error.message }, 502);
    if (!data) return response(req, { exists: false, data: null, id: parts[1] });
    return response(req, { exists: true, id: data.document_id, data: data.data, updatedAt: data.updated_at });
  }
  if (req.method === "PUT" && parts.length === 2) {
    const body = await req.json().catch(() => undefined);
    if (body === undefined) return response(req, { error: "JSON body is required" }, 400);
    const { data, error } = await supabase.from("app_storage").upsert({ collection_name: COLLECTION, document_id: parts[1], data: body, updated_at: new Date().toISOString() }, { onConflict: "collection_name,document_id" }).select("document_id,data,updated_at").single();
    if (error) return response(req, { error: error.message }, 502);
    return response(req, { ok: true, id: data.document_id, data: data.data, updatedAt: data.updated_at });
  }
  return response(req, { error: "Method not allowed" }, 405);
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders(req) });
  try {
    const url = new URL(req.url);
    const marker = "/nir-api";
    const markerIndex = url.pathname.indexOf(marker);
    const relativePath = markerIndex >= 0 ? url.pathname.slice(markerIndex + marker.length) : url.pathname;
    const parts = relativePath.split("/").filter(Boolean);
    if (parts[0] === "api" && parts[1] === "health") return response(req, { status: "ok", database: "supabase" });
    if (parts[0] === "api" && parts[1] === "auth") {
      const action = parts[2];
      if (req.method === "GET" && action === "status") return response(req, { passwordSet: Boolean((await getPasswordRecord()).hash) });
      if (req.method === "GET" && action === "session") return response(req, { authenticated: await verifyCloudSession(req) });
      if (req.method === "POST" && action === "login") return await login(req);
      if (req.method === "POST" && action === "setup") return await setupPassword(req);
      if (req.method === "POST" && action === "logout") return response(req, { ok: true }, 200, { "Set-Cookie": `${SESSION_COOKIE}=; Path=/; HttpOnly; SameSite=None; Secure; Max-Age=0` });
      if (req.method === "POST" && action === "clear-password") {
        if (!(await verifyCloudSession(req))) return response(req, { error: "احراز هویت لازم است." }, 401);
        const { error } = await supabase.from("app_storage").update({ data: { value: "" }, updated_at: new Date().toISOString() }).eq("collection_name", COLLECTION).in("document_id", ["poultryAppPasswordHash", "poultryAppPasswordSalt"]);
        if (error) return response(req, { error: error.message }, 500);
        return response(req, { ok: true }, 200, { "Set-Cookie": `${SESSION_COOKIE}=; Path=/; HttpOnly; SameSite=None; Secure; Max-Age=0` });
      }
    }
    if (parts[0] === "api" && parts[1] === "storage") return await storage(req, parts.slice(2));
    return response(req, { error: "Not found" }, 404);
  } catch (error) {
    console.error("NIR cloud API error", error);
    return response(req, { error: error?.message || "Internal server error" }, 500);
  }
});
