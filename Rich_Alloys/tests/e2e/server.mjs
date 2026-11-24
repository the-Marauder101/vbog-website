// Local stand-in for Supabase: PostgREST for data, a tiny auth and storage, and the built app on the same origin.
import http from "node:http"; import crypto from "node:crypto"; import fs from "node:fs"; import path from "node:path";
const SECRET = "local-test-secret-local-test-secret-123456";
const USERS = { "owner@t": "00000000-0000-0000-0000-0000000000a1", "tinu@t": "00000000-0000-0000-0000-0000000000a2",
  "niti@t": "00000000-0000-0000-0000-0000000000a3", "gate@t": "00000000-0000-0000-0000-0000000000a4", "sanjay@t": "00000000-0000-0000-0000-0000000000a5" };
const b64 = (o) => Buffer.from(typeof o === "string" ? o : JSON.stringify(o)).toString("base64url");
const jwt = (sub, email) => { const h = b64({ alg: "HS256", typ: "JWT" }), p = b64({ sub, email, role: "authenticated", aud: "authenticated", exp: Math.floor(Date.now()/1000) + 36000, amr: [{ method: "password", timestamp: Math.floor(Date.now()/1000) }] });
  return `${h}.${p}.${crypto.createHmac("sha256", SECRET).update(`${h}.${p}`).digest("base64url")}`; };
const files = new Map();
const DIST = process.argv[2];
const body = (req) => new Promise((r) => { const c = []; req.on("data", (d) => c.push(d)); req.on("end", () => r(Buffer.concat(c))); });
http.createServer(async (req, res) => {
  const u = new URL(req.url, "http://x");
  if (u.pathname.startsWith("/auth/v1/token")) {
    const b = JSON.parse((await body(req)).toString()); const id = USERS[b.email];
    if (!id || b.password !== "pw") { res.writeHead(400, { "content-type": "application/json" }); return res.end(JSON.stringify({ error: "invalid_grant", error_description: "Invalid login credentials" })); }
    const user = { id, email: b.email, aud: "authenticated", role: "authenticated" };
    res.writeHead(200, { "content-type": "application/json" });
    return res.end(JSON.stringify({ access_token: jwt(id, b.email), token_type: "bearer", expires_in: 36000, expires_at: Math.floor(Date.now()/1000) + 36000, refresh_token: "r", user }));
  }
  if (u.pathname.startsWith("/auth/v1/logout")) { res.writeHead(204); return res.end(); }
  if (u.pathname.startsWith("/storage/v1/object/sign/")) { const k = u.pathname.replace("/storage/v1/object/sign/", "");
    res.writeHead(200, { "content-type": "application/json" }); return res.end(JSON.stringify({ signedURL: `/object/get/${k}` })); }
  if (u.pathname.startsWith("/storage/v1/object/get/")) { const f = files.get(u.pathname.replace("/storage/v1/object/get/", ""));
    res.writeHead(f ? 200 : 404, { "content-type": f?.type ?? "text/plain" }); return res.end(f?.data ?? "missing"); }
  if (req.method === "GET" && u.pathname.startsWith("/storage/v1/object/")) {   // download (authenticated or plain path)
    const f = files.get(u.pathname.replace("/storage/v1/object/", "").replace(/^authenticated\//, ""));
    res.writeHead(f ? 200 : 404, { "content-type": f?.type ?? "application/json" }); return res.end(f?.data ?? JSON.stringify({ error: "not_found", message: "Object not found" })); }
  if (u.pathname.startsWith("/storage/v1/object/")) { const k = u.pathname.replace("/storage/v1/object/", "");
    files.set(k, { data: await body(req), type: req.headers["content-type"] }); res.writeHead(200, { "content-type": "application/json" }); return res.end(JSON.stringify({ Key: k })); }
  if (u.pathname.startsWith("/rest/v1/")) {
    const b = await body(req);
    const headers = { ...req.headers }; delete headers.host;
    const up = http.request({ host: "127.0.0.1", port: 3000, path: req.url.replace("/rest/v1", ""), method: req.method, headers }, (r) => { res.writeHead(r.statusCode, r.headers); r.pipe(res); });
    up.end(b); return;
  }
  let p = path.join(DIST, u.pathname === "/" ? "index.html" : u.pathname);
  if (!fs.existsSync(p)) p = path.join(DIST, "index.html");
  if (p.endsWith("config.js")) { res.writeHead(200, { "content-type": "text/javascript" }); return res.end(`window.RA_CONFIG={supabaseUrl:location.origin,supabaseAnonKey:"anon"}`); }
  const ext = path.extname(p); res.writeHead(200, { "content-type": { ".html": "text/html", ".js": "text/javascript", ".css": "text/css" }[ext] ?? "application/octet-stream" });
  fs.createReadStream(p).pipe(res);
}).listen(54321, () => console.log("up"));
