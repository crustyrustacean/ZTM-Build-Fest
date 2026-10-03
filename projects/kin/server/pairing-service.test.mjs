import assert from "node:assert/strict";
import test from "node:test";
import { PairingError, PairingService } from "./pairing-service.mjs";

const credential = suffix => ({ id: `credential-${suffix}`, publicKey: `key-${suffix}`, algorithm: -7 });
const setup = () => {
  let now = 1_000_000;
  const service = new PairingService({ now: () => now, secret: Buffer.alloc(32, 7) });
  const adult = service.bootstrap({ credential: credential("a"), deviceLabel: "A phone" });
  return { service, adult, advance: value => { now += value; } };
};

test("pairing requires claim and explicit approval, then becomes single use", () => {
  const { service, adult } = setup();
  const invitation = service.createPairing(adult.sessionToken);
  const claim = service.claimPairing({ code: invitation.code.toLowerCase().replace("-", " "), credential: credential("b"), deviceLabel: "B phone" });
  assert.equal(claim.state, "Claimed");
  const confirmed = service.approvePairing(adult.sessionToken, invitation.pairingId, claim.version);
  assert.equal(confirmed.state, "Confirmed");
  assert.equal(service.households.get(adult.householdId).members.size, 2);
  assert.equal(service.approvePairing(adult.sessionToken, invitation.pairingId, claim.version).state, "Confirmed");
  assert.throws(() => service.claimPairing({ code: invitation.code, credential: credential("c"), deviceLabel: "C" }), error => error.code === "invalid_code" || error.code === "pairing_used");
});

test("expiry and revocation are terminal and create no membership", () => {
  const { service, adult, advance } = setup();
  const expired = service.createPairing(adult.sessionToken);
  advance(10 * 60_000 + 1);
  assert.throws(() => service.claimPairing({ code: expired.code, credential: credential("b"), deviceLabel: "B" }), error => error.code === "pairing_expired");
  const fresh = service.createPairing(adult.sessionToken);
  service.revokePairing(adult.sessionToken, fresh.pairingId);
  assert.throws(() => service.claimPairing({ code: fresh.code, credential: credential("c"), deviceLabel: "C" }), error => error.code === "invalid_code" || error.code === "pairing_revoked");
  assert.equal(service.households.get(adult.householdId).members.size, 1);
});

test("duplicate claims, stale approval, full households, and revoked devices fail closed", () => {
  const { service, adult } = setup();
  const invitation = service.createPairing(adult.sessionToken);
  const claim = service.claimPairing({ code: invitation.code, credential: credential("b"), deviceLabel: "B" });
  assert.throws(() => service.claimPairing({ code: invitation.code, credential: credential("c"), deviceLabel: "C" }), error => error.code === "pairing_claimed");
  assert.throws(() => service.approvePairing(adult.sessionToken, invitation.pairingId, invitation.version), error => error.code === "stale_pairing");
  const confirmed = service.approvePairing(adult.sessionToken, invitation.pairingId, claim.version);
  const joined = service.pairingForClaim(claim.claimToken);
  assert.equal(joined.state, "Confirmed");
  assert.equal(service.listDevices(adult.sessionToken).length, 2);
  service.revokeDevice(adult.sessionToken, confirmed.pairingId === "never" ? "" : joined.deviceId);
  assert.throws(() => service.authorize(joined.sessionToken), error => error.code === "device_not_trusted");
  assert.throws(() => service.createPairing(adult.sessionToken), error => error.code === "household_full");
});

test("approval versus revocation resolves once without partial membership", () => {
  const { service, adult } = setup();
  const invitation = service.createPairing(adult.sessionToken);
  const claim = service.claimPairing({ code: invitation.code, credential: credential("b"), deviceLabel: "B" });
  service.revokePairing(adult.sessionToken, invitation.pairingId);
  assert.throws(() => service.approvePairing(adult.sessionToken, invitation.pairingId, claim.version), error => error instanceof PairingError && error.code === "pairing_revoked");
  assert.equal(service.households.get(adult.householdId).members.size, 1);
});

test("rate limits repeated invalid guesses without recording secrets", () => {
  const { service } = setup();
  for (let index = 0; index < 12; index += 1) assert.throws(() => service.claimPairing({ code: `BAD-${index}`, credential: credential(index), deviceLabel: "B", rateKey: "one" }), error => error.code === "invalid_code");
  assert.throws(() => service.claimPairing({ code: "LAST", credential: credential("last"), deviceLabel: "B", rateKey: "one" }), error => error.code === "rate_limited");
  assert.equal(JSON.stringify(service.events).includes("BAD"), false);
});
