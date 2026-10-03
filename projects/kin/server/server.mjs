import { createReadStream, existsSync, statSync } from "node:fs";
import { extname, join, normalize } from "node:path";
import { createServer } from "node:http";
import { randomBytes } from "node:crypto";
import { PairingError, PairingService } from "./pairing-service.mjs";
import { WebAuthn } from "./webauthn.mjs";

const port = Number(process.env.KIN_PORT ?? 8000);
const host = process.env.KIN_HOST ?? "127.0.0.1";
const origin = process.env.KIN_ORIGIN ?? `http://localhost:${port}`;
const rpId = new URL(origin).hostname;
const webRoot = normalize(join(import.meta.dirname, "..", "web"));
const service = new PairingService();
const webauthn = new WebAuthn({ rpId, origin });
const flows = new Map();

createServer(async (request, response) => {
  try {
    setHeaders(response);
    const url = new URL(request.url, origin);
    if (url.pathname.startsWith("/api/")) {
      if (request.headers.origin && request.headers.origin !== origin) throw new PairingError("origin_rejected", "The request origin was rejected.", 403);
      await api(request, response, url);
      return;
    }
    serve(response, url.pathname);
  } catch (error) {
    const safe = error instanceof PairingError ? error : new PairingError("server_error", "Kin could not complete that request.", 500);
    if (!(error instanceof PairingError)) console.error(error);
    json(response, safe.status, { error: safe.code, message: safe.message });
  }
}).listen(port, host, () => console.log(`Kin is available at ${origin}`));

async function api(request, response, url) {
  const body = ["POST", "PUT", "DELETE"].includes(request.method) ? await readJson(request) : {};
  const session = cookies(request).kin_session;
  const claimToken = cookies(request).kin_claim;

  if (request.method === "GET" && url.pathname === "/api/status") {
    let identity = null;
    try { const auth = service.authorize(session); identity = { householdId: auth.household.id, memberId: auth.member.id, deviceId: auth.device.id }; } catch {}
    json(response, 200, { identity, claim: claimToken ? service.pairingForClaim(claimToken) : null }); return;
  }
  if (request.method === "POST" && url.pathname === "/api/passkeys/register/options") {
    if (!['bootstrap', 'claim'].includes(body.purpose)) throw badRequest();
    const flow = randomBytes(18).toString("base64url");
    flows.set(flow, { purpose: body.purpose, code: body.code, deviceLabel: body.deviceLabel, expiresAt: Date.now() + 120_000 });
    json(response, 200, { flow, publicKey: webauthn.registrationOptions(flow) }); return;
  }
  if (request.method === "POST" && url.pathname === "/api/passkeys/register/finish") {
    const flow = consumeFlow(body.flow); const credential = webauthn.verifyRegistration(body.credential, body.flow);
    if (flow.purpose === "bootstrap") {
      const result = service.bootstrap({ credential, deviceLabel: flow.deviceLabel });
      cookie(response, "kin_session", result.sessionToken); json(response, 201, omitToken(result)); return;
    }
    const result = service.claimPairing({ code: flow.code, credential, deviceLabel: flow.deviceLabel, rateKey: request.socket.remoteAddress ?? "unknown" });
    cookie(response, "kin_claim", result.claimToken); json(response, 200, omitToken(result)); return;
  }
  if (request.method === "POST" && url.pathname === "/api/pairings") { json(response, 201, service.createPairing(session)); return; }
  const pairingMatch = url.pathname.match(/^\/api\/pairings\/([a-f0-9]{32})$/);
  if (request.method === "GET" && pairingMatch) { json(response, 200, service.pairingForAdult(session, pairingMatch[1])); return; }
  if (request.method === "DELETE" && pairingMatch) { json(response, 200, service.revokePairing(session, pairingMatch[1])); return; }
  const approveOptions = url.pathname.match(/^\/api\/pairings\/([a-f0-9]{32})\/approve\/options$/);
  if (request.method === "POST" && approveOptions) {
    const auth = service.authorize(session); const ids = [...auth.member.credentials];
    const flow = randomBytes(18).toString("base64url"); flows.set(flow, { purpose: "approve", pairingId: approveOptions[1], expectedVersion: body.expectedVersion, memberId: auth.member.id, expiresAt: Date.now() + 120_000 });
    json(response, 200, { flow, publicKey: webauthn.authenticationOptions(flow, ids) }); return;
  }
  const approveFinish = url.pathname.match(/^\/api\/pairings\/([a-f0-9]{32})\/approve\/finish$/);
  if (request.method === "POST" && approveFinish) {
    const auth = service.authorize(session); const flow = consumeFlow(body.flow);
    if (flow.purpose !== "approve" || flow.pairingId !== approveFinish[1] || flow.memberId !== auth.member.id) throw badRequest();
    webauthn.verifyAuthentication(body.credential, body.flow, service.credentials.get(body.credential?.id));
    json(response, 200, service.approvePairing(session, flow.pairingId, flow.expectedVersion)); return;
  }
  if (request.method === "GET" && url.pathname === "/api/claim") {
    const result = service.pairingForClaim(claimToken);
    json(response, 200, result); return;
  }
  if (request.method === "POST" && url.pathname === "/api/claim/activate/options") {
    const credential = service.claimCredential(claimToken); const flow = randomBytes(18).toString("base64url");
    flows.set(flow, { purpose: "activate", claimToken, expiresAt: Date.now() + 120_000 });
    json(response, 200, { flow, publicKey: webauthn.authenticationOptions(flow, [credential.id]) }); return;
  }
  if (request.method === "POST" && url.pathname === "/api/claim/activate/finish") {
    const flow = consumeFlow(body.flow);
    if (flow.purpose !== "activate" || flow.claimToken !== claimToken) throw badRequest();
    webauthn.verifyAuthentication(body.credential, body.flow, service.claimCredential(claimToken));
    const result = service.activateClaim(claimToken); cookie(response, "kin_session", result.sessionToken); clearCookie(response, "kin_claim");
    json(response, 200, omitToken(result)); return;
  }
  if (request.method === "POST" && url.pathname === "/api/logout") {
    service.logout(session); clearCookie(response, "kin_session"); json(response, 200, { loggedOut: true }); return;
  }
  if (request.method === "GET" && url.pathname === "/api/devices") { json(response, 200, { devices: service.listDevices(session) }); return; }
  const deviceMatch = url.pathname.match(/^\/api\/devices\/([a-f0-9]{32})$/);
  if (request.method === "DELETE" && deviceMatch) { json(response, 200, service.revokeDevice(session, deviceMatch[1])); return; }
  if (request.method === "GET" && url.pathname === "/api/household") { json(response, 200, service.householdView(session)); return; }
  if (request.method === "DELETE" && url.pathname === "/api/household/membership") {
    const result = body.memberId ? service.removeOtherAdult(session, body.memberId) : service.leaveHousehold(session);
    if (!body.memberId) clearCookie(response, "kin_session"); json(response, 200, result); return;
  }
  throw new PairingError("not_found", "That endpoint is unavailable.", 404);
}

function consumeFlow(value) {
  const flow = flows.get(String(value ?? "")); flows.delete(String(value ?? ""));
  if (!flow || flow.expiresAt <= Date.now()) throw new PairingError("challenge_expired", "That passkey request expired. Try again.", 410);
  return flow;
}

function omitToken(value) { const { sessionToken, claimToken, ...safe } = value; return safe; }
function badRequest() { return new PairingError("invalid_request", "Kin could not understand that request."); }
function cookie(response, name, value) { response.appendHeader("Set-Cookie", `${name}=${value}; HttpOnly; SameSite=Strict; Path=/; Max-Age=43200`); }
function clearCookie(response, name) { response.appendHeader("Set-Cookie", `${name}=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0`); }
function cookies(request) { return Object.fromEntries(String(request.headers.cookie ?? "").split(";").map(part => part.trim().split("=")).filter(pair => pair.length === 2)); }

async function readJson(request) {
  let size = 0; const chunks = [];
  for await (const chunk of request) { size += chunk.length; if (size > 256_000) throw new PairingError("request_too_large", "That request is too large.", 413); chunks.push(chunk); }
  try { return chunks.length ? JSON.parse(Buffer.concat(chunks)) : {}; } catch { throw badRequest(); }
}

function json(response, status, value) { if (response.headersSent) return; response.writeHead(status, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" }); response.end(JSON.stringify(value)); }
function setHeaders(response) { response.setHeader("X-Content-Type-Options", "nosniff"); response.setHeader("Referrer-Policy", "no-referrer"); response.setHeader("Permissions-Policy", "camera=(), microphone=(), geolocation=()"); }
function serve(response, pathname) {
  const requested = pathname === "/" || pathname === "/pair" ? "index.html" : decodeURIComponent(pathname.slice(1));
  const path = normalize(join(webRoot, requested));
  if (!path.startsWith(webRoot) || !existsSync(path) || !statSync(path).isFile()) { response.writeHead(404); response.end("Not found"); return; }
  const types = { ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".css": "text/css; charset=utf-8", ".wasm": "application/wasm" };
  response.writeHead(200, { "Content-Type": types[extname(path)] ?? "application/octet-stream", "Cache-Control": "no-cache" }); createReadStream(path).pipe(response);
}
