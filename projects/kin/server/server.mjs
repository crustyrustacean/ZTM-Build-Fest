import { createReadStream, existsSync, statSync } from "node:fs";
import { extname, join, normalize, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { createServer } from "node:http";
import { randomBytes } from "node:crypto";
import { PairingError, PairingService } from "./pairing-service.mjs";
import { EncryptedSyncService } from "./sync-service.mjs";
import { WebAuthn } from "./webauthn.mjs";

const webRoot = normalize(join(import.meta.dirname, "..", "web"));
const FLOW_TTL_MS = 2 * 60_000;
const MAX_ACTIVE_FLOWS = 512;

export function createKinServer(options = {}) {
  const port = options.port ?? Number(process.env.KIN_PORT ?? 8000);
  const host = options.host ?? process.env.KIN_HOST ?? "127.0.0.1";
  const origin =
    options.origin ?? process.env.KIN_ORIGIN ?? `http://localhost:${port}`;
  assertSecureOrigin(host, origin);
  const service = options.service ?? new PairingService();
  const syncService =
    options.syncService ??
    new EncryptedSyncService(service, { now: options.now });
  const webauthn =
    options.webauthn ??
    new WebAuthn({ rpId: new URL(origin).hostname, origin, now: options.now });
  const context = {
    service,
    syncService,
    webauthn,
    flows: new Map(),
    now: options.now ?? (() => Date.now()),
    maxFlows: options.maxFlows ?? MAX_ACTIVE_FLOWS,
    secureCookies: new URL(origin).protocol === "https:",
    origin,
  };
  const server = createServer(async (request, response) => {
    try {
      setHeaders(response);
      const url = new URL(request.url, origin);
      if (url.pathname.startsWith("/api/")) {
        if (request.headers.origin && request.headers.origin !== origin)
          throw new PairingError(
            "origin_rejected",
            "The request origin was rejected.",
            403,
          );
        await api(request, response, url, context);
        return;
      }
      serve(response, url.pathname);
    } catch (error) {
      if (
        error instanceof PairingError &&
        [
          "authentication_required",
          "device_not_trusted",
          "membership_removed",
        ].includes(error.code)
      ) {
        clearCookie(response, "kin_session", context.secureCookies);
        if (error.code !== "authentication_required")
          clearCookie(response, "kin_device", context.secureCookies);
      }
      const safe =
        error instanceof PairingError
          ? error
          : new PairingError(
              "server_error",
              "Kin could not complete that request.",
              500,
            );
      json(response, safe.status, { error: safe.code, message: safe.message });
    }
  });
  return {
    server,
    service,
    syncService,
    webauthn,
    flows: context.flows,
    origin,
  };
}

if (
  process.argv[1] &&
  pathToFileURL(resolve(process.argv[1])).href === import.meta.url
) {
  const port = Number(process.env.KIN_PORT ?? 8000);
  const host = process.env.KIN_HOST ?? "127.0.0.1";
  const origin = process.env.KIN_ORIGIN ?? `http://localhost:${port}`;
  const { server } = createKinServer({ port, host, origin });
  server.listen(port, host, () => console.log(`Kin is available at ${origin}`));
}

function assertSecureOrigin(host, origin) {
  const external = new URL(origin);
  const loopback = (value) =>
    value === "localhost" ||
    value.endsWith(".localhost") ||
    value === "::1" ||
    value === "[::1]" ||
    /^127(?:\.\d{1,3}){3}$/.test(value);
  if (!loopback(host))
    throw new Error(
      "Kin's built-in server must bind to loopback; use a trusted TLS proxy for external access.",
    );
  if (!loopback(external.hostname) && external.protocol !== "https:") {
    throw new Error(
      "Kin requires an HTTPS origin outside loopback development.",
    );
  }
}

async function api(request, response, url, context) {
  const { service, syncService, webauthn, secureCookies } = context;
  const body = ["POST", "PUT", "DELETE"].includes(request.method)
    ? await readJson(request)
    : {};
  const session = cookies(request).kin_session;
  const claimToken = cookies(request).kin_claim;
  const deviceToken = cookies(request).kin_device;

  if (request.method === "GET" && url.pathname === "/api/status") {
    let identity = null;
    let claim = null;
    try {
      const auth = service.authorize(session);
      identity = {
        householdId: auth.household.id,
        memberId: auth.member.id,
        deviceId: auth.device.id,
      };
    } catch {
      if (session) clearCookie(response, "kin_session", secureCookies);
      if (deviceToken) {
        try {
          service.trustedDevice(deviceToken);
        } catch {
          clearCookie(response, "kin_device", secureCookies);
        }
      }
    }

    try {
      claim = claimToken ? service.pairingForClaim(claimToken) : null;
      if (["Expired", "Revoked"].includes(claim?.state))
        clearCookie(response, "kin_claim", secureCookies);
    } catch {
      clearCookie(response, "kin_claim", secureCookies);
    }
    json(response, 200, { identity, claim });
    return;
  }
  if (
    request.method === "POST" &&
    url.pathname === "/api/passkeys/register/options"
  ) {
    if (!["bootstrap", "claim"].includes(body.purpose)) throw badRequest();
    let flowPurpose = body.purpose;
    if (body.purpose === "claim") {
      const pairing = service.validatePairingCode(body.code, {
        rateKey: request.socket.remoteAddress ?? "unknown",
      });
      if (pairing.purpose === "device") flowPurpose = "device-claim";
      if (claimToken) {
        service.clearClaim(claimToken);
        clearCookie(response, "kin_claim", secureCookies);
      }
    }
    const flow = createFlow(
      {
        purpose: flowPurpose,
        code: body.code,
        deviceLabel: body.deviceLabel,
      },
      context,
    );
    json(response, 200, {
      flow,
      publicKey: webauthn.registrationOptions(flow),
    });
    return;
  }
  if (
    request.method === "POST" &&
    url.pathname === "/api/passkeys/register/finish"
  ) {
    const flow = consumeFlow(body.flow, context);
    const credential = webauthn.verifyRegistration(body.credential, body.flow);
    if (flow.purpose === "bootstrap") {
      const result = service.bootstrap({
        credential,
        deviceLabel: flow.deviceLabel,
        syncPublicKeys: body.syncPublicKeys,
      });
      cookie(response, "kin_session", result.sessionToken, secureCookies);
      cookie(
        response,
        "kin_device",
        result.deviceToken,
        secureCookies,
        31_536_000,
      );
      json(response, 201, omitToken(result));
      return;
    }
    const result = service.claimPairing({
      code: flow.code,
      credential,
      deviceLabel: flow.deviceLabel,
      syncPublicKeys: body.syncPublicKeys,
      rateKey: request.socket.remoteAddress ?? "unknown",
    });
    cookie(response, "kin_claim", result.claimToken, secureCookies);
    json(response, 200, omitToken(result));
    return;
  }
  if (request.method === "POST" && url.pathname === "/api/login/options") {
    const { member, device } = service.trustedDevice(deviceToken);
    const flow = createFlow(
      { purpose: "login", memberId: member.id, deviceId: device.id },
      context,
    );
    json(response, 200, {
      flow,
      publicKey: webauthn.authenticationOptions(flow, [...member.credentials]),
    });
    return;
  }
  if (request.method === "POST" && url.pathname === "/api/login/finish") {
    const flow = consumeFlow(body.flow, context);
    if (flow.purpose !== "login") throw badRequest();
    const { member, device } = service.trustedDevice(deviceToken);
    if (flow.memberId !== member.id || flow.deviceId !== device.id)
      throw badRequest();
    const credential = service.credentials.get(body.credential?.id);
    webauthn.verifyAuthentication(body.credential, body.flow, credential);
    const result = service.reauthenticate(deviceToken, body.credential.id);
    cookie(response, "kin_session", result.sessionToken, secureCookies);
    cookie(
      response,
      "kin_device",
      result.deviceToken,
      secureCookies,
      31_536_000,
    );
    json(response, 200, omitToken(result));
    return;
  }
  if (request.method === "POST" && url.pathname === "/api/pairings") {
    json(response, 201, service.createPairing(session));
    return;
  }
  if (request.method === "POST" && url.pathname === "/api/devices/pairings") {
    json(response, 201, service.createDevicePairing(session));
    return;
  }
  const pairingMatch = url.pathname.match(/^\/api\/pairings\/([a-f0-9]{32})$/);
  if (request.method === "GET" && pairingMatch) {
    json(response, 200, service.pairingForAdult(session, pairingMatch[1]));
    return;
  }
  if (request.method === "DELETE" && pairingMatch) {
    json(response, 200, service.revokePairing(session, pairingMatch[1]));
    return;
  }
  const approveOptions = url.pathname.match(
    /^\/api\/pairings\/([a-f0-9]{32})\/approve\/options$/,
  );
  if (request.method === "POST" && approveOptions) {
    const auth = service.authorize(session);
    const ids = [...auth.member.credentials];
    const flow = createFlow(
      {
        purpose: "approve",
        pairingId: approveOptions[1],
        expectedVersion: body.expectedVersion,
        memberId: auth.member.id,
      },
      context,
    );
    json(response, 200, {
      flow,
      publicKey: webauthn.authenticationOptions(flow, ids),
    });
    return;
  }
  const approveFinish = url.pathname.match(
    /^\/api\/pairings\/([a-f0-9]{32})\/approve\/finish$/,
  );
  if (request.method === "POST" && approveFinish) {
    const auth = service.authorize(session);
    const flow = consumeFlow(body.flow, context);
    if (
      flow.purpose !== "approve" ||
      flow.pairingId !== approveFinish[1] ||
      flow.memberId !== auth.member.id
    )
      throw badRequest();
    const credential = service.credentialForAuthenticatedMember(
      session,
      body.credential?.id,
    );
    webauthn.verifyAuthentication(body.credential, body.flow, credential);
    const approved = service.approvePairing(
      session,
      flow.pairingId,
      flow.expectedVersion,
      body.deviceCertificate,
    );
    const pairing = service.pairings.get(flow.pairingId);
    const device = service.devices.get(pairing?.confirmedDeviceId);
    if (device?.syncPublicKeys && device.syncHistoryFromEpoch == null)
      syncService.onDeviceAdded(auth.household.id, device.id, {
        historyFromEpoch: pairing.purpose === "device" ? 1 : undefined,
      });
    json(response, 200, approved);
    return;
  }
  if (request.method === "GET" && url.pathname === "/api/claim") {
    const result = service.pairingForClaim(claimToken);
    if (["Expired", "Revoked"].includes(result.state))
      clearCookie(response, "kin_claim", secureCookies);
    json(response, 200, result);
    return;
  }
  if (
    request.method === "POST" &&
    url.pathname === "/api/claim/activate/options"
  ) {
    const credential = service.claimCredential(claimToken);
    const flow = createFlow(
      {
        purpose: "activate",
        claimToken,
      },
      context,
    );
    json(response, 200, {
      flow,
      publicKey: webauthn.authenticationOptions(flow, [credential.id]),
    });
    return;
  }
  if (
    request.method === "POST" &&
    url.pathname === "/api/claim/activate/finish"
  ) {
    const flow = consumeFlow(body.flow, context);
    if (flow.purpose !== "activate" || flow.claimToken !== claimToken)
      throw badRequest();
    webauthn.verifyAuthentication(
      body.credential,
      body.flow,
      service.claimCredential(claimToken),
    );
    const result = service.activateClaim(claimToken);
    cookie(response, "kin_session", result.sessionToken, secureCookies);
    cookie(
      response,
      "kin_device",
      result.deviceToken,
      secureCookies,
      31_536_000,
    );
    clearCookie(response, "kin_claim", secureCookies);
    json(response, 200, omitToken(result));
    return;
  }
  if (request.method === "POST" && url.pathname === "/api/logout") {
    service.logout(session);
    clearCookie(response, "kin_session", secureCookies);
    json(response, 200, { loggedOut: true });
    return;
  }
  if (request.method === "GET" && url.pathname === "/api/devices") {
    json(response, 200, { devices: service.listDevices(session) });
    return;
  }
  const deviceMatch = url.pathname.match(/^\/api\/devices\/([a-f0-9]{32})$/);
  if (request.method === "DELETE" && deviceMatch) {
    const target = service.devices.get(deviceMatch[1]);
    const alreadyRevoked = Boolean(target?.revokedAt);
    json(response, 200, service.revokeDevice(session, deviceMatch[1]));
    if (target && !alreadyRevoked)
      syncService.onAccessChange(target.householdId, [target.id]);
    return;
  }
  if (request.method === "POST" && url.pathname === "/api/sync/device-keys") {
    const auth = service.authorize(session);
    const keyedDevices = [...service.devices.values()].filter(
      (device) =>
        device.householdId === auth.household.id &&
        !device.revokedAt &&
        device.syncPublicKeys,
    ).length;
    const result = service.registerSyncPublicKeys(session, body.publicKeys);
    if (result.registered && keyedDevices > 0)
      syncService.onDeviceAdded(auth.household.id, auth.device.id, {
        historyFromEpoch: 1,
      });
    json(response, 200, result);
    return;
  }
  if (request.method === "GET" && url.pathname === "/api/sync/status") {
    json(response, 200, syncService.status(session));
    return;
  }
  if (request.method === "POST" && url.pathname === "/api/sync/enable") {
    json(response, 200, syncService.enable(session));
    return;
  }
  if (request.method === "GET" && url.pathname === "/api/sync/devices") {
    json(response, 200, { devices: syncService.deviceDirectory(session) });
    return;
  }
  if (request.method === "POST" && url.pathname === "/api/sync/events") {
    json(response, 200, syncService.push(session, body.events));
    return;
  }
  if (request.method === "GET" && url.pathname === "/api/sync/events") {
    json(
      response,
      200,
      syncService.pull(
        session,
        url.searchParams.get("cursor") ?? "",
        url.searchParams.get("limit") ?? "20",
      ),
    );
    return;
  }
  if (request.method === "POST" && url.pathname === "/api/sync/bindings") {
    json(response, 200, syncService.pushBindings(session, body.bindings));
    return;
  }
  if (request.method === "GET" && url.pathname === "/api/sync/bindings") {
    json(
      response,
      200,
      syncService.pullBindings(session, url.searchParams.get("cursor") ?? ""),
    );
    return;
  }
  if (
    request.method === "POST" &&
    url.pathname === "/api/sync/provisioning/grants"
  ) {
    json(response, 201, syncService.createProvisioningGrant(session, body));
    return;
  }
  const provisioningUpload = url.pathname.match(
    /^\/api\/sync\/provisioning\/grants\/([a-f0-9]{32})$/,
  );
  if (request.method === "POST" && provisioningUpload) {
    json(
      response,
      200,
      syncService.submitProvisioning(
        session,
        provisioningUpload[1],
        body.package,
      ),
    );
    return;
  }
  if (request.method === "GET" && url.pathname === "/api/sync/provisioning") {
    json(response, 200, { grants: syncService.pendingProvisioning(session) });
    return;
  }
  const provisioningAck = url.pathname.match(
    /^\/api\/sync\/provisioning\/([a-f0-9]{32})\/ack$/,
  );
  if (request.method === "POST" && provisioningAck) {
    json(
      response,
      200,
      syncService.acknowledgeProvisioning(session, provisioningAck[1]),
    );
    return;
  }
  if (request.method === "POST" && url.pathname === "/api/sync/epochs") {
    json(response, 200, syncService.rotateEpoch(session, body));
    return;
  }
  if (request.method === "GET" && url.pathname === "/api/household") {
    json(response, 200, service.householdView(session));
    return;
  }
  if (
    request.method === "POST" &&
    url.pathname === "/api/household/membership/remove/options"
  ) {
    const removal = service.removalContext(session, body.memberId);
    const flow = createFlow(
      {
        purpose: "remove-adult",
        targetMemberId: body.memberId,
        memberId: removal.memberId,
        deviceId: removal.deviceId,
      },
      context,
    );
    json(response, 200, {
      flow,
      publicKey: webauthn.authenticationOptions(flow, removal.credentialIds),
    });
    return;
  }
  if (
    request.method === "POST" &&
    url.pathname === "/api/household/membership/remove/finish"
  ) {
    const flow = consumeFlow(body.flow, context);
    if (flow.purpose !== "remove-adult") throw badRequest();
    const auth = service.authorize(session);
    if (flow.memberId !== auth.member.id || flow.deviceId !== auth.device.id)
      throw badRequest();
    const credential = service.credentials.get(body.credential?.id);
    if (!credential || credential.memberId !== auth.member.id)
      throw new PairingError(
        "passkey_member_mismatch",
        "Use this member's passkey to continue.",
        401,
      );
    webauthn.verifyAuthentication(body.credential, body.flow, credential);
    const excludedDevices = [...service.devices.values()]
      .filter((device) => device.memberId === flow.targetMemberId)
      .map((device) => device.id);
    const result = service.removeOtherAdult(
      session,
      flow.targetMemberId,
      auth.member.id,
    );
    syncService.onAccessChange(auth.household.id, excludedDevices);
    json(response, 200, result);
    return;
  }
  if (
    request.method === "DELETE" &&
    url.pathname === "/api/household/membership"
  ) {
    if (body.memberId)
      throw new PairingError(
        "fresh_auth_required",
        "Authenticate with your passkey again before removing another adult.",
        401,
      );
    const auth = service.authorize(session);
    const excludedDevices = [...service.devices.values()]
      .filter((device) => device.memberId === auth.member.id)
      .map((device) => device.id);
    const result = service.leaveHousehold(session);
    syncService.onAccessChange(auth.household.id, excludedDevices);
    clearCookie(response, "kin_session", secureCookies);
    json(response, 200, result);
    return;
  }
  throw new PairingError("not_found", "That endpoint is unavailable.", 404);
}

function createFlow(value, context) {
  pruneFlows(context);
  if (context.flows.size >= context.maxFlows)
    throw new PairingError(
      "flow_capacity",
      "Too many active passkey requests. Wait and try again.",
      503,
    );
  const flow = randomBytes(18).toString("base64url");
  context.flows.set(flow, {
    ...value,
    expiresAt: context.now() + FLOW_TTL_MS,
  });
  return flow;
}

function pruneFlows({ flows, now }) {
  const timestamp = now();
  for (const [key, flow] of flows)
    if (flow.expiresAt <= timestamp) flows.delete(key);
}

function consumeFlow(value, context) {
  pruneFlows(context);
  const flowKey = String(value ?? "");
  const flow = context.flows.get(flowKey);
  context.flows.delete(flowKey);
  if (!flow || flow.expiresAt <= context.now())
    throw new PairingError(
      "challenge_expired",
      "That passkey request expired. Try again.",
      410,
    );
  return flow;
}

function omitToken(value) {
  const { sessionToken, claimToken, deviceToken, ...safe } = value;
  return safe;
}
function badRequest() {
  return new PairingError(
    "invalid_request",
    "Kin could not understand that request.",
  );
}
function cookie(response, name, value, secure, maxAge = 43_200) {
  response.appendHeader(
    "Set-Cookie",
    `${name}=${value}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${maxAge}${secure ? "; Secure" : ""}`,
  );
}
function clearCookie(response, name, secure) {
  response.appendHeader(
    "Set-Cookie",
    `${name}=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0${secure ? "; Secure" : ""}`,
  );
}
function cookies(request) {
  return Object.fromEntries(
    String(request.headers.cookie ?? "")
      .split(";")
      .map((part) => part.trim().split("="))
      .filter((pair) => pair.length === 2),
  );
}

async function readJson(request) {
  let size = 0;
  const chunks = [];
  for await (const chunk of request) {
    size += chunk.length;
    if (size > 256_000)
      throw new PairingError(
        "request_too_large",
        "That request is too large.",
        413,
      );
    chunks.push(chunk);
  }
  try {
    return chunks.length ? JSON.parse(Buffer.concat(chunks)) : {};
  } catch {
    throw badRequest();
  }
}

function json(response, status, value) {
  if (response.headersSent) return;
  response.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
  });
  response.end(JSON.stringify(value));
}
function setHeaders(response) {
  response.setHeader("X-Content-Type-Options", "nosniff");
  response.setHeader("Referrer-Policy", "no-referrer");
  response.setHeader(
    "Permissions-Policy",
    "camera=(), microphone=(), geolocation=()",
  );
}
function serve(response, pathname) {
  const requested =
    pathname === "/" || pathname === "/pair"
      ? "index.html"
      : decodeURIComponent(pathname.slice(1));
  const path = normalize(join(webRoot, requested));
  if (
    !path.startsWith(webRoot) ||
    !existsSync(path) ||
    !statSync(path).isFile()
  ) {
    response.writeHead(404);
    response.end("Not found");
    return;
  }
  const types = {
    ".html": "text/html; charset=utf-8",
    ".js": "text/javascript; charset=utf-8",
    ".css": "text/css; charset=utf-8",
    ".wasm": "application/wasm",
  };
  response.writeHead(200, {
    "Content-Type": types[extname(path)] ?? "application/octet-stream",
    "Cache-Control": "no-cache",
  });
  createReadStream(path).pipe(response);
}
