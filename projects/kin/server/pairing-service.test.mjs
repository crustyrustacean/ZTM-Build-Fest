import assert from "node:assert/strict";
import test from "node:test";
import {
  CLAIM_TTL_MS,
  PAIRING_CODE_ALPHABET,
  PAIRING_TTL_MS,
  PairingError,
  PairingService,
  RATE_WINDOW_MS,
} from "./pairing-service.mjs";
import { createKinServer } from "./server.mjs";
import { CHALLENGE_TTL_MS, WebAuthn } from "./webauthn.mjs";

const credential = (suffix) => ({
  id: `credential-${suffix}`,
  publicKey: `key-${suffix}`,
  algorithm: -7,
});
const setup = () => {
  let now = 1_000_000;
  const service = new PairingService({
    now: () => now,
    secret: Buffer.alloc(32, 7),
  });
  const adult = service.bootstrap({
    credential: credential("a"),
    deviceLabel: "A phone",
  });
  return {
    service,
    adult,
    advance: (value) => {
      now += value;
    },
  };
};

function testWebAuthn() {
  return {
    registrationCalls: 0,
    registrationOptions(flow) {
      this.registrationCalls += 1;
      return { challenge: flow };
    },
    authenticationOptions(flow, credentialIds) {
      return {
        challenge: flow,
        allowCredentials: credentialIds.map((id) => ({ id })),
      };
    },
    verifyRegistration(response, flow) {
      if (response?.flow !== flow)
        throw new PairingError(
          "registration_failed",
          "Invalid registration.",
          400,
        );
      return {
        id: response.id,
        publicKey: `key-${response.id}`,
        algorithm: -7,
        signCount: 0,
      };
    },
    verifyAuthentication(response, flow, registeredCredential) {
      if (
        !registeredCredential ||
        response?.id !== registeredCredential.id ||
        response?.flow !== flow
      )
        throw new PairingError(
          "passkey_verification_failed",
          "Invalid passkey.",
          401,
        );
      return true;
    },
  };
}

async function startTestServer({
  service = new PairingService(),
  now = () => Date.now(),
  origin = "http://localhost",
  maxFlows,
} = {}) {
  const webauthn = testWebAuthn();
  const application = createKinServer({
    service,
    webauthn,
    now,
    origin,
    maxFlows,
  });
  await new Promise((resolve, reject) => {
    application.server.once("error", reject);
    application.server.listen(0, "127.0.0.1", resolve);
  });
  return {
    ...application,
    webauthn,
    url: `http://127.0.0.1:${application.server.address().port}`,
    close: () =>
      new Promise((resolve, reject) =>
        application.server.close((error) =>
          error ? reject(error) : resolve(),
        ),
      ),
  };
}

function apiRequest(server, path, { method = "GET", body, cookie } = {}) {
  const headers = {};
  if (body) headers["Content-Type"] = "application/json";
  if (cookie) headers.Cookie = cookie;
  return fetch(`${server.url}${path}`, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
  });
}

function responseCookies(response) {
  return response.headers.getSetCookie().map((value) => value.split(";", 1)[0]);
}

function cookieValue(cookies, name) {
  return cookies
    .find((value) => value.startsWith(`${name}=`))
    ?.slice(name.length + 1);
}

test("HTTP logout and passkey login restore the same member and household", async () => {
  const { service, adult } = setup();
  const server = await startTestServer({ service });
  try {
    assert.equal(
      (await apiRequest(server, "/api/login/options", { method: "POST" }))
        .status,
      403,
    );
    const unknownOptionsResponse = await apiRequest(
      server,
      "/api/login/options",
      {
        method: "POST",
        cookie: `kin_device=${adult.deviceToken}`,
      },
    );
    const unknownOptions = await unknownOptionsResponse.json();
    assert.equal(
      (
        await apiRequest(server, "/api/login/finish", {
          method: "POST",
          cookie: `kin_device=${adult.deviceToken}`,
          body: {
            flow: unknownOptions.flow,
            credential: { id: "unknown-credential", flow: unknownOptions.flow },
          },
        })
      ).status,
      401,
    );

    const logout = await apiRequest(server, "/api/logout", {
      method: "POST",
      cookie: `kin_session=${adult.sessionToken}; kin_device=${adult.deviceToken}`,
    });
    assert.equal(logout.status, 200);
    assert.ok(
      responseCookies(logout).some((value) => value === "kin_session="),
    );
    assert.equal(
      responseCookies(logout).some((value) => value.startsWith("kin_device=")),
      false,
    );

    const optionsResponse = await apiRequest(server, "/api/login/options", {
      method: "POST",
      cookie: `kin_device=${adult.deviceToken}`,
    });
    assert.equal(optionsResponse.status, 200);
    const options = await optionsResponse.json();
    assert.deepEqual(options.publicKey.allowCredentials, [
      { id: "credential-a" },
    ]);

    const loginResponse = await apiRequest(server, "/api/login/finish", {
      method: "POST",
      cookie: `kin_device=${adult.deviceToken}`,
      body: {
        flow: options.flow,
        credential: { id: "credential-a", flow: options.flow },
      },
    });
    assert.equal(loginResponse.status, 200);
    const identity = await loginResponse.json();
    assert.equal(identity.memberId, adult.memberId);
    assert.equal(identity.deviceId, adult.deviceId);
    assert.equal(identity.householdId, adult.householdId);
    assert.equal("sessionToken" in identity, false);
    assert.equal("deviceToken" in identity, false);

    const newCookies = responseCookies(loginResponse);
    assert.notEqual(cookieValue(newCookies, "kin_device"), adult.deviceToken);
    const statusResponse = await apiRequest(server, "/api/status", {
      cookie: newCookies.join("; "),
    });
    const status = await statusResponse.json();
    assert.equal(status.identity.memberId, adult.memberId);
    assert.equal(status.identity.householdId, adult.householdId);
  } finally {
    await server.close();
  }
});

test("reloaded terminal claims clear their cookie and allow a new code", async () => {
  for (const terminalState of ["Expired", "Revoked"]) {
    let now = 4_000_000;
    const service = new PairingService({
      now: () => now,
      secret: Buffer.alloc(32, 13),
    });
    const adult = service.bootstrap({
      credential: credential("a"),
      deviceLabel: "A",
    });
    const invitation = service.createPairing(adult.sessionToken);
    const claim = service.claimPairing({
      code: invitation.code,
      credential: credential("b"),
      deviceLabel: "B",
    });
    if (terminalState === "Expired") now += CLAIM_TTL_MS;
    else service.revokePairing(adult.sessionToken, invitation.pairingId);

    const server = await startTestServer({ service, now: () => now });
    try {
      const reload = await apiRequest(server, "/api/status", {
        cookie: `kin_claim=${claim.claimToken}`,
      });
      const status = await reload.json();
      assert.equal(status.claim.state, terminalState);
      assert.ok(
        responseCookies(reload).some((value) => value === "kin_claim="),
      );

      const next = service.createPairing(adult.sessionToken);
      const retry = await apiRequest(server, "/api/passkeys/register/options", {
        method: "POST",
        cookie: `kin_claim=${claim.claimToken}`,
        body: { purpose: "claim", code: next.code, deviceLabel: "B again" },
      });
      assert.equal(retry.status, 200);
      assert.ok(responseCookies(retry).some((value) => value === "kin_claim="));
    } finally {
      await server.close();
    }
  }
});

test("HTTP claim preflight precedes WebAuthn and short-lived flows stay bounded", async () => {
  let now = 2_000_000;
  const service = new PairingService({
    now: () => now,
    secret: Buffer.alloc(32, 9),
  });
  const adult = service.bootstrap({
    credential: credential("a"),
    deviceLabel: "A",
  });
  const expired = service.createPairing(adult.sessionToken);
  now += PAIRING_TTL_MS;
  const server = await startTestServer({
    service,
    now: () => now,
    maxFlows: 2,
  });
  const optionsPath = "/api/passkeys/register/options";
  const requestOptions = (code) =>
    apiRequest(server, optionsPath, {
      method: "POST",
      body: { purpose: "claim", code, deviceLabel: "B" },
    });
  try {
    assert.equal((await requestOptions("NOT-A-CODE")).status, 404);
    assert.equal((await requestOptions(expired.code)).status, 410);

    const revoked = service.createPairing(adult.sessionToken);
    service.revokePairing(adult.sessionToken, revoked.pairingId);
    assert.equal((await requestOptions(revoked.code)).status, 404);
    assert.equal(server.webauthn.registrationCalls, 0);

    const valid = service.createPairing(adult.sessionToken);
    const validResponse = await requestOptions(valid.code);
    assert.equal(validResponse.status, 200);
    const validFlow = await validResponse.json();
    assert.deepEqual(validFlow.publicKey.user, undefined);
    assert.equal(service.pairings.get(valid.pairingId).state, "Pending");
    assert.equal(service.pairings.get(valid.pairingId).attempts, 0);

    const secondResponse = await apiRequest(server, optionsPath, {
      method: "POST",
      body: { purpose: "bootstrap", deviceLabel: "Another device" },
    });
    const secondFlow = await secondResponse.json();
    assert.equal(secondResponse.status, 200);
    assert.equal(server.flows.size, 2);
    assert.equal(
      (
        await apiRequest(server, optionsPath, {
          method: "POST",
          body: { purpose: "bootstrap", deviceLabel: "Overflow" },
        })
      ).status,
      503,
    );
    assert.equal(server.flows.has(validFlow.flow), true);
    assert.equal(server.flows.has(secondFlow.flow), true);

    now += 120_001;
    const freshResponse = await apiRequest(server, optionsPath, {
      method: "POST",
      body: { purpose: "bootstrap", deviceLabel: "Fresh flow" },
    });
    const freshFlow = await freshResponse.json();
    assert.equal(server.flows.size, 1);
    now += 120_001;
    const staleFinish = await apiRequest(
      server,
      "/api/passkeys/register/finish",
      {
        method: "POST",
        body: {
          flow: freshFlow.flow,
          credential: { id: "late", flow: freshFlow.flow },
        },
      },
    );
    assert.equal(staleFinish.status, 410);
    assert.equal(server.flows.size, 0);
  } finally {
    await server.close();
  }
});

test("auth cookies are Secure only for a configured HTTPS origin", async () => {
  for (const origin of ["http://localhost", "https://kin.test"]) {
    const server = await startTestServer({ origin });
    try {
      const optionsResponse = await apiRequest(
        server,
        "/api/passkeys/register/options",
        {
          method: "POST",
          body: { purpose: "bootstrap", deviceLabel: "Test device" },
        },
      );
      const options = await optionsResponse.json();
      const finish = await apiRequest(server, "/api/passkeys/register/finish", {
        method: "POST",
        body: {
          flow: options.flow,
          credential: {
            id: `credential-${origin.startsWith("https") ? "secure" : "local"}`,
            flow: options.flow,
          },
        },
      });
      assert.equal(finish.status, 201);
      const cookies = finish.headers.getSetCookie();
      const secure = origin.startsWith("https:");
      for (const name of ["kin_session=", "kin_device="]) {
        const header = cookies.find((value) => value.startsWith(name));
        assert.ok(header);
        assert.equal(header.includes("; Secure"), secure);
      }
      const body = await finish.json();
      assert.equal("sessionToken" in body, false);
      assert.equal("deviceToken" in body, false);
    } finally {
      await server.close();
    }
  }
});

test("HTTP member removal requires fresh action-bound passkey proof", async () => {
  let now = 3_000_000;
  const service = new PairingService({
    now: () => now,
    secret: Buffer.alloc(32, 11),
  });
  const adult = service.bootstrap({
    credential: credential("a"),
    deviceLabel: "A",
  });
  const invitation = service.createPairing(adult.sessionToken);
  const claim = service.claimPairing({
    code: invitation.code,
    credential: credential("b"),
    deviceLabel: "B",
  });
  const approved = service.approvePairing(
    adult.sessionToken,
    invitation.pairingId,
    claim.version,
  );
  const joined = service.activateClaim(claim.claimToken);
  const server = await startTestServer({ service, now: () => now });
  const sessionCookie = `kin_session=${adult.sessionToken}`;
  const optionsPath = "/api/household/membership/remove/options";
  const finishRemoval = (flow, id) =>
    apiRequest(server, "/api/household/membership/remove/finish", {
      method: "POST",
      cookie: sessionCookie,
      body: { flow, credential: { id, flow } },
    });
  try {
    const sessionOnly = await apiRequest(server, "/api/household/membership", {
      method: "DELETE",
      cookie: sessionCookie,
      body: { memberId: joined.memberId },
    });
    assert.equal(sessionOnly.status, 401);

    const wrongMemberOptions = await apiRequest(server, optionsPath, {
      method: "POST",
      cookie: sessionCookie,
      body: { memberId: joined.memberId },
    });
    const wrongMemberFlow = await wrongMemberOptions.json();
    assert.deepEqual(wrongMemberFlow.publicKey.allowCredentials, [
      { id: "credential-a" },
    ]);
    assert.equal(
      (await finishRemoval(wrongMemberFlow.flow, "credential-b")).status,
      401,
    );

    const staleOptions = await apiRequest(server, optionsPath, {
      method: "POST",
      cookie: sessionCookie,
      body: { memberId: joined.memberId },
    });
    const staleFlow = await staleOptions.json();
    now += 120_001;
    assert.equal(
      (await finishRemoval(staleFlow.flow, "credential-a")).status,
      410,
    );

    const validOptions = await apiRequest(server, optionsPath, {
      method: "POST",
      cookie: sessionCookie,
      body: { memberId: joined.memberId },
    });
    const validFlow = await validOptions.json();
    assert.equal(
      server.flows.get(validFlow.flow).targetMemberId,
      joined.memberId,
    );
    assert.equal(
      (await finishRemoval(validFlow.flow, "credential-a")).status,
      200,
    );
    assert.equal(
      (await finishRemoval(validFlow.flow, "credential-a")).status,
      410,
    );
    assert.equal(service.members.get(joined.memberId).active, false);
    assert.ok(service.devices.get(joined.deviceId).revokedAt);
    assert.throws(
      () => service.authorize(joined.sessionToken),
      (error) => error.code === "authentication_required",
    );
    assert.equal(approved.state, "Confirmed");
  } finally {
    await server.close();
  }
});

test("expired WebAuthn challenges are pruned without evicting active ones", () => {
  let now = 10_000;
  const webauthn = new WebAuthn({
    rpId: "localhost",
    origin: "http://localhost",
    now: () => now,
    maxChallenges: 2,
  });
  const first = webauthn.challenge("authenticate", "one");
  now += CHALLENGE_TTL_MS / 2;
  const second = webauthn.challenge("authenticate", "two");
  assert.throws(
    () => webauthn.challenge("authenticate", "three"),
    (error) => error.code === "challenge_capacity",
  );
  assert.equal(webauthn.challenges.has(first), true);
  assert.equal(webauthn.challenges.has(second), true);
  now += CHALLENGE_TTL_MS / 2;
  const third = webauthn.challenge("authenticate", "three");
  assert.equal(webauthn.challenges.has(first), false);
  assert.equal(webauthn.challenges.has(second), true);
  assert.equal(webauthn.challenges.has(third), true);
});

test("pairing codes use only unbiased alphabet characters and remain unique", () => {
  const { service, adult } = setup();
  const codes = new Set();
  for (let index = 0; index < 512; index += 1) {
    const code = service.createPairing(adult.sessionToken).code;
    const normalized = code.replace("-", "");
    assert.equal(code.length, 9);
    assert.equal(normalized.length, 8);
    for (const character of normalized)
      assert.ok(PAIRING_CODE_ALPHABET.includes(character));
    codes.add(normalized);
  }
  assert.ok(codes.size > 480);
});

test("pairing requires claim and explicit approval, then becomes single use", () => {
  const { service, adult } = setup();
  const invitation = service.createPairing(adult.sessionToken);
  assert.equal(invitation.state, "Pending");
  const claim = service.claimPairing({
    code: invitation.code.toLowerCase().replace("-", " "),
    credential: credential("b"),
    deviceLabel: "B phone",
  });
  assert.equal(claim.state, "Claimed");
  const confirmed = service.approvePairing(
    adult.sessionToken,
    invitation.pairingId,
    claim.version,
  );
  assert.equal(confirmed.state, "Confirmed");
  assert.equal(service.households.get(adult.householdId).members.size, 2);
  assert.equal(
    service.approvePairing(
      adult.sessionToken,
      invitation.pairingId,
      claim.version,
    ).state,
    "Confirmed",
  );
  assert.throws(
    () =>
      service.claimPairing({
        code: invitation.code,
        credential: credential("c"),
        deviceLabel: "C",
      }),
    (error) => error.code === "invalid_code" || error.code === "pairing_used",
  );
});

test("expiry and revocation are terminal and create no membership", () => {
  const { service, adult, advance } = setup();
  const expired = service.createPairing(adult.sessionToken);
  advance(10 * 60_000 + 1);
  assert.throws(
    () =>
      service.claimPairing({
        code: expired.code,
        credential: credential("b"),
        deviceLabel: "B",
      }),
    (error) => error.code === "pairing_expired",
  );
  const fresh = service.createPairing(adult.sessionToken);
  service.revokePairing(adult.sessionToken, fresh.pairingId);
  assert.throws(
    () =>
      service.claimPairing({
        code: fresh.code,
        credential: credential("c"),
        deviceLabel: "C",
      }),
    (error) =>
      error.code === "invalid_code" || error.code === "pairing_revoked",
  );
  assert.equal(service.households.get(adult.householdId).members.size, 1);
});

test("pairing preflight validates codes without claiming or exposing household data", () => {
  const { service, adult, advance } = setup();
  const invitation = service.createPairing(adult.sessionToken);
  assert.deepEqual(
    service.validatePairingCode(invitation.code, { rateKey: "preflight" }),
    { valid: true },
  );
  assert.equal(service.pairings.get(invitation.pairingId).state, "Pending");
  assert.equal(service.pairings.get(invitation.pairingId).attempts, 0);
  assert.equal(service.pairings.get(invitation.pairingId).claimant, null);
  assert.throws(
    () => service.validatePairingCode("NOT-A-CODE", { rateKey: "preflight" }),
    (error) => error.code === "invalid_code",
  );
  advance(PAIRING_TTL_MS);
  assert.throws(
    () =>
      service.validatePairingCode(invitation.code, { rateKey: "preflight" }),
    (error) => error.code === "pairing_expired",
  );
  const next = service.createPairing(adult.sessionToken);
  service.revokePairing(adult.sessionToken, next.pairingId);
  assert.throws(
    () => service.validatePairingCode(next.code, { rateKey: "preflight" }),
    (error) => error.code === "invalid_code",
  );
});

test("duplicate claims, stale approval, full households, and revoked devices fail closed", () => {
  const { service, adult } = setup();
  const invitation = service.createPairing(adult.sessionToken);
  const claim = service.claimPairing({
    code: invitation.code,
    credential: credential("b"),
    deviceLabel: "B",
  });
  assert.throws(
    () =>
      service.claimPairing({
        code: invitation.code,
        credential: credential("c"),
        deviceLabel: "C",
      }),
    (error) => error.code === "pairing_claimed",
  );
  assert.throws(
    () =>
      service.approvePairing(
        adult.sessionToken,
        invitation.pairingId,
        invitation.version,
      ),
    (error) => error.code === "stale_pairing",
  );
  const confirmed = service.approvePairing(
    adult.sessionToken,
    invitation.pairingId,
    claim.version,
  );
  const joined = service.pairingForClaim(claim.claimToken);
  assert.equal(joined.state, "Confirmed");
  const activated = service.activateClaim(claim.claimToken);
  assert.equal(service.listDevices(adult.sessionToken).length, 2);
  service.revokeDevice(
    adult.sessionToken,
    confirmed.pairingId === "never" ? "" : activated.deviceId,
  );
  assert.throws(
    () => service.authorize(activated.sessionToken),
    (error) => error.code === "device_not_trusted",
  );
  assert.throws(
    () => service.createPairing(adult.sessionToken),
    (error) => error.code === "household_full",
  );
});

test("approval does not create a joining session until passkey activation", () => {
  const { service, adult } = setup();
  const invitation = service.createPairing(adult.sessionToken);
  const claim = service.claimPairing({
    code: invitation.code,
    credential: credential("b"),
    deviceLabel: "B",
  });
  service.approvePairing(
    adult.sessionToken,
    invitation.pairingId,
    claim.version,
  );
  assert.equal(
    service.pairingForClaim(claim.claimToken).sessionToken,
    undefined,
  );
  assert.equal(service.claimCredential(claim.claimToken).id, "credential-b");
  const activated = service.activateClaim(claim.claimToken);
  assert.equal(
    service.authorize(activated.sessionToken).member.id,
    activated.memberId,
  );
  assert.throws(
    () => service.activateClaim(claim.claimToken),
    (error) => error.code === "claim_not_confirmed",
  );
});

test("approval versus revocation resolves once without partial membership", () => {
  const { service, adult } = setup();
  const invitation = service.createPairing(adult.sessionToken);
  const claim = service.claimPairing({
    code: invitation.code,
    credential: credential("b"),
    deviceLabel: "B",
  });
  service.revokePairing(adult.sessionToken, invitation.pairingId);
  assert.throws(
    () =>
      service.approvePairing(
        adult.sessionToken,
        invitation.pairingId,
        claim.version,
      ),
    (error) =>
      error instanceof PairingError && error.code === "pairing_revoked",
  );
  assert.equal(service.households.get(adult.householdId).members.size, 1);
});

test("rate limits repeated invalid guesses without recording secrets", () => {
  const { service } = setup();
  for (let index = 0; index < 12; index += 1)
    assert.throws(
      () =>
        service.claimPairing({
          code: `BAD-${index}`,
          credential: credential(index),
          deviceLabel: "B",
          rateKey: "one",
        }),
      (error) => error.code === "invalid_code",
    );
  assert.throws(
    () =>
      service.claimPairing({
        code: "LAST",
        credential: credential("last"),
        deviceLabel: "B",
        rateKey: "one",
      }),
    (error) => error.code === "rate_limited",
  );
  assert.equal(JSON.stringify(service.events).includes("BAD"), false);
});

test("expired rate buckets are pruned while active buckets remain bounded", () => {
  let now = 5_000_000;
  const service = new PairingService({
    now: () => now,
    secret: Buffer.alloc(32, 17),
    maxRateBuckets: 2,
  });
  const attempt = (rateKey) =>
    assert.throws(
      () => service.validatePairingCode("BAD", { rateKey }),
      (error) => error.code === "invalid_code",
    );
  attempt("first");
  now += RATE_WINDOW_MS / 2;
  attempt("second");
  assert.throws(
    () => service.validatePairingCode("BAD", { rateKey: "overflow" }),
    (error) => error.code === "rate_limited",
  );
  assert.equal(service.rateBuckets.size, 2);
  now += RATE_WINDOW_MS / 2;
  attempt("third");
  assert.equal(service.rateBuckets.has("first"), false);
  assert.equal(service.rateBuckets.has("second"), true);
  assert.equal(service.rateBuckets.has("third"), true);
  assert.equal(service.rateBuckets.size, 2);
});

test("new invitations revoke older live sessions and approval uses server time", () => {
  const { service, adult, advance } = setup();
  const first = service.createPairing(adult.sessionToken);
  const second = service.createPairing(adult.sessionToken);
  assert.equal(
    service.pairingForAdult(adult.sessionToken, first.pairingId).state,
    "Revoked",
  );
  const claim = service.claimPairing({
    code: second.code,
    credential: credential("b"),
    deviceLabel: "B",
  });
  advance(CLAIM_TTL_MS + 1);
  assert.throws(
    () =>
      service.approvePairing(
        adult.sessionToken,
        second.pairingId,
        claim.version,
      ),
    (error) => error.code === "pairing_expired",
  );
  assert.equal(service.households.get(adult.householdId).members.size, 1);
});

test("a late claim receives its own full approval window", () => {
  const { service, adult, advance } = setup();
  const invitation = service.createPairing(adult.sessionToken);
  advance(PAIRING_TTL_MS - 500);
  const claim = service.claimPairing({
    code: invitation.code,
    credential: credential("b"),
    deviceLabel: "B",
  });
  assert.equal(
    claim.expiresAt,
    1_000_000 + PAIRING_TTL_MS - 500 + CLAIM_TTL_MS,
  );
  advance(CLAIM_TTL_MS - 1);
  assert.equal(
    service.approvePairing(
      adult.sessionToken,
      invitation.pairingId,
      claim.version,
    ).state,
    "Confirmed",
  );
});

test("approval after the claim approval window expires is rejected", () => {
  const { service, adult, advance } = setup();
  const invitation = service.createPairing(adult.sessionToken);
  const claim = service.claimPairing({
    code: invitation.code,
    credential: credential("b"),
    deviceLabel: "B",
  });
  advance(CLAIM_TTL_MS);
  assert.throws(
    () =>
      service.approvePairing(
        adult.sessionToken,
        invitation.pairingId,
        claim.version,
      ),
    (error) => error.code === "pairing_expired",
  );
  assert.equal(service.households.get(adult.householdId).members.size, 1);
});

test("expired and revoked claim tokens return terminal state once, then clear", () => {
  const { service, adult, advance } = setup();
  const expired = service.createPairing(adult.sessionToken);
  const expiredClaim = service.claimPairing({
    code: expired.code,
    credential: credential("b"),
    deviceLabel: "B",
  });
  advance(CLAIM_TTL_MS);
  assert.equal(
    service.pairingForClaim(expiredClaim.claimToken).state,
    "Expired",
  );
  assert.throws(
    () => service.pairingForClaim(expiredClaim.claimToken),
    (error) => error.code === "claim_unavailable",
  );

  const revoked = service.createPairing(adult.sessionToken);
  const revokedClaim = service.claimPairing({
    code: revoked.code,
    credential: credential("c"),
    deviceLabel: "C",
  });
  service.revokePairing(adult.sessionToken, revoked.pairingId);
  assert.equal(
    service.pairingForClaim(revokedClaim.claimToken).state,
    "Revoked",
  );
  assert.throws(
    () => service.pairingForClaim(revokedClaim.claimToken),
    (error) => error.code === "claim_unavailable",
  );
});

test("logout invalidates only the session and preserves device trust", () => {
  const { service, adult } = setup();
  service.logout(adult.sessionToken);
  assert.throws(
    () => service.authorize(adult.sessionToken),
    (error) => error.code === "authentication_required",
  );
  assert.equal(service.devices.get(adult.deviceId).revokedAt, null);
  const restored = service.reauthenticate(adult.deviceToken, "credential-a");
  assert.notEqual(restored.sessionToken, adult.sessionToken);
  assert.equal(restored.memberId, adult.memberId);
  assert.equal(restored.deviceId, adult.deviceId);
  assert.equal(restored.householdId, adult.householdId);
  assert.equal(
    service.authorize(restored.sessionToken).member.id,
    adult.memberId,
  );
  assert.notEqual(restored.deviceToken, adult.deviceToken);
  assert.throws(
    () => service.reauthenticate(adult.deviceToken, "credential-a"),
    (error) => error.code === "device_not_trusted",
  );
});

test("reauthentication rejects unknown credentials, revoked devices, and removed members", () => {
  const { service, adult } = setup();
  assert.throws(
    () => service.reauthenticate(adult.deviceToken, "unknown-credential"),
    (error) => error.code === "invalid_passkey",
  );
  const invitation = service.createPairing(adult.sessionToken);
  const claim = service.claimPairing({
    code: invitation.code,
    credential: credential("b"),
    deviceLabel: "B",
  });
  const approved = service.approvePairing(
    adult.sessionToken,
    invitation.pairingId,
    claim.version,
  );
  const joined = service.activateClaim(claim.claimToken);
  service.revokeDevice(adult.sessionToken, joined.deviceId);
  assert.throws(
    () => service.reauthenticate(joined.deviceToken, "credential-b"),
    (error) => error.code === "device_not_trusted",
  );
  service.removeOtherAdult(adult.sessionToken, joined.memberId, adult.memberId);
  assert.throws(
    () => service.reauthenticate(joined.deviceToken, "credential-b"),
    (error) => error.code === "membership_removed",
  );
  assert.equal(service.households.get(adult.householdId).members.size, 2);
  assert.equal(approved.state, "Confirmed");
});

test("membership removal revokes every target device and active session", () => {
  const { service, adult } = setup();
  const invitation = service.createPairing(adult.sessionToken);
  const claim = service.claimPairing({
    code: invitation.code,
    credential: credential("b"),
    deviceLabel: "B",
  });
  service.approvePairing(
    adult.sessionToken,
    invitation.pairingId,
    claim.version,
  );
  const joined = service.activateClaim(claim.claimToken);
  assert.throws(
    () => service.removeOtherAdult(adult.sessionToken, joined.memberId),
    (error) => error.code === "fresh_auth_required",
  );
  assert.equal(service.devices.get(joined.deviceId).revokedAt, null);
  service.removeOtherAdult(adult.sessionToken, joined.memberId, adult.memberId);
  assert.throws(
    () => service.authorize(joined.sessionToken),
    (error) => error.code === "authentication_required",
  );
  assert.ok(service.devices.get(joined.deviceId).revokedAt);
  assert.equal(service.events.at(-1).type, "membership_removed");
});

test("the last adult cannot leave, while a joined adult can leave without removing the household", () => {
  const { service, adult } = setup();
  assert.throws(
    () => service.leaveHousehold(adult.sessionToken),
    (error) => error.code === "last_adult",
  );
  const invitation = service.createPairing(adult.sessionToken);
  const claim = service.claimPairing({
    code: invitation.code,
    credential: credential("b"),
    deviceLabel: "B",
  });
  service.approvePairing(
    adult.sessionToken,
    invitation.pairingId,
    claim.version,
  );
  const joined = service.activateClaim(claim.claimToken);
  assert.equal(service.leaveHousehold(joined.sessionToken).removed, true);
  assert.equal(service.authorize(adult.sessionToken).member.id, adult.memberId);
});
