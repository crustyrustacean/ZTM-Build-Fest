import { createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";

export const PAIRING_TTL_MS = 10 * 60_000;
export const CLAIM_TTL_MS = 15 * 60_000;
export const MAX_CODE_ATTEMPTS = 8;
export const RATE_WINDOW_MS = 60_000;
export const RATE_LIMIT = 12;
const CODE_ALPHABET = "23456789ABCDEFGHJKMNPQRSTUVWXYZ";

export class PairingError extends Error {
  constructor(code, message, status = 400) {
    super(message);
    this.name = "PairingError";
    this.code = code;
    this.status = status;
  }
}

const id = () => randomBytes(16).toString("hex");
const token = () => randomBytes(32).toString("base64url");
const hash = value => createHash("sha256").update(value).digest("hex");

function codeValue() {
  const bytes = randomBytes(8);
  let value = "";
  for (let index = 0; index < 8; index += 1) value += CODE_ALPHABET[bytes[index] & 31];
  return `${value.slice(0, 4)}-${value.slice(4)}`;
}

export function normalizeCode(value) {
  return String(value ?? "").toUpperCase().replace(/[^A-Z0-9]/g, "");
}

export class PairingService {
  constructor({ now = () => Date.now(), secret = randomBytes(32) } = {}) {
    this.now = now;
    this.secret = secret;
    this.households = new Map();
    this.members = new Map();
    this.credentials = new Map();
    this.devices = new Map();
    this.pairings = new Map();
    this.codeIndex = new Map();
    this.sessions = new Map();
    this.claimTokens = new Map();
    this.rateBuckets = new Map();
    this.events = [];
  }

  verifier(code) {
    return createHmac("sha256", this.secret).update(normalizeCode(code)).digest("hex");
  }

  audit(type, details = {}) {
    this.events.push({ type, at: this.now(), ...details });
  }

  addCredential(memberId, credential) {
    if (!credential?.id || !credential.publicKey || !credential.algorithm) {
      throw new PairingError("invalid_credential", "A valid passkey is required.");
    }
    if (this.credentials.has(credential.id)) {
      throw new PairingError("credential_in_use", "That passkey is already registered.", 409);
    }
    this.credentials.set(credential.id, { ...credential, memberId, signCount: credential.signCount ?? 0 });
  }

  bootstrap({ credential, deviceLabel = "This device" }) {
    const householdId = id();
    const memberId = id();
    const deviceId = id();
    this.households.set(householdId, { id: householdId, members: new Set([memberId]), version: 1 });
    this.members.set(memberId, { id: memberId, householdId, active: true, credentials: new Set([credential.id]) });
    this.addCredential(memberId, credential);
    this.devices.set(deviceId, { id: deviceId, memberId, householdId, label: cleanLabel(deviceLabel), trustedAt: this.now(), revokedAt: null });
    this.audit("device_trusted", { householdId, memberId, deviceId });
    return { ...this.issueSession(memberId, deviceId), householdId, memberId, deviceId };
  }

  issueSession(memberId, deviceId) {
    const value = token();
    this.sessions.set(hash(value), { memberId, deviceId, expiresAt: this.now() + 12 * 60 * 60_000 });
    return { sessionToken: value };
  }

  authorize(sessionToken, { requireTrusted = true } = {}) {
    const session = this.sessions.get(hash(String(sessionToken ?? "")));
    if (!session || session.expiresAt <= this.now()) throw new PairingError("authentication_required", "Authenticate with your passkey to continue.", 401);
    const member = this.members.get(session.memberId);
    const device = this.devices.get(session.deviceId);
    if (!member?.active || (requireTrusted && (!device || device.revokedAt))) {
      throw new PairingError("device_not_trusted", "This device is no longer trusted. Use another trusted device or recovery.", 403);
    }
    return { session, member, device, household: this.households.get(member.householdId) };
  }

  createPairing(sessionToken) {
    const { member, household } = this.authorize(sessionToken);
    if (household.members.size >= 2) throw new PairingError("household_full", "This household already has two adult members.", 409);
    for (const pairing of this.pairings.values()) {
      if (pairing.householdId === household.id && ["Pending", "Claimed"].includes(this.state(pairing))) this.revokePairing(sessionToken, pairing.id);
    }
    let code;
    let verifier;
    do { code = codeValue(); verifier = this.verifier(code); } while (this.codeIndex.has(verifier));
    const pairing = { id: id(), householdId: household.id, inviterId: member.id, verifier, createdAt: this.now(), expiresAt: this.now() + PAIRING_TTL_MS, state: "Pending", version: 1, attempts: 0, claimant: null, confirmedMemberId: null };
    this.pairings.set(pairing.id, pairing);
    this.codeIndex.set(verifier, pairing.id);
    this.audit("pairing_created", { householdId: household.id, pairingId: pairing.id });
    return { pairingId: pairing.id, code, expiresAt: pairing.expiresAt, version: pairing.version };
  }

  state(pairing) {
    if (["Pending", "Claimed"].includes(pairing.state) && pairing.expiresAt <= this.now()) {
      pairing.state = "Expired"; pairing.version += 1;
      this.audit("pairing_expired", { householdId: pairing.householdId, pairingId: pairing.id });
    }
    return pairing.state;
  }

  rateLimit(key) {
    const now = this.now();
    const bucket = (this.rateBuckets.get(key) ?? []).filter(at => at > now - RATE_WINDOW_MS);
    bucket.push(now); this.rateBuckets.set(key, bucket);
    if (bucket.length > RATE_LIMIT) {
      this.audit("pairing_rate_limited");
      throw new PairingError("rate_limited", "Too many attempts. Wait a minute and try again.", 429);
    }
  }

  claimPairing({ code, credential, deviceLabel, rateKey = "unknown" }) {
    this.rateLimit(rateKey);
    const verifier = this.verifier(code);
    const pairing = this.pairings.get(this.codeIndex.get(verifier));
    if (!pairing) { this.audit("pairing_failed_attempt"); throw genericCodeError(); }
    const state = this.state(pairing);
    if (state !== "Pending") throw terminalPairingError(state);
    pairing.attempts += 1;
    if (pairing.attempts > MAX_CODE_ATTEMPTS) {
      pairing.state = "Revoked"; pairing.version += 1; this.audit("pairing_revoked", { pairingId: pairing.id, reason: "attempt_limit" }); throw genericCodeError();
    }
    const claimToken = token();
    pairing.claimant = { credential, deviceLabel: cleanLabel(deviceLabel), tokenHash: hash(claimToken), claimedAt: this.now() };
    pairing.state = "Claimed"; pairing.version += 1;
    this.claimTokens.set(hash(claimToken), pairing.id);
    this.audit("pairing_claimed", { householdId: pairing.householdId, pairingId: pairing.id });
    return { claimToken, pairingId: pairing.id, state: pairing.state, expiresAt: pairing.expiresAt, version: pairing.version };
  }

  approvePairing(sessionToken, pairingId, expectedVersion) {
    const { member, household } = this.authorize(sessionToken);
    const pairing = this.pairings.get(pairingId);
    if (!pairing || pairing.householdId !== household.id || pairing.inviterId !== member.id) throw new PairingError("not_found", "That pairing request is unavailable.", 404);
    const state = this.state(pairing);
    if (state === "Confirmed") return this.pairingView(pairing);
    if (state !== "Claimed") throw terminalPairingError(state);
    if (pairing.version !== expectedVersion) throw new PairingError("stale_pairing", "The pairing request changed. Review its latest status.", 409);
    if (household.members.size >= 2) throw new PairingError("household_full", "This household already has two adult members.", 409);
    const memberId = id(); const deviceId = id();
    this.addCredential(memberId, pairing.claimant.credential);
    this.members.set(memberId, { id: memberId, householdId: household.id, active: true, credentials: new Set([pairing.claimant.credential.id]) });
    this.devices.set(deviceId, { id: deviceId, memberId, householdId: household.id, label: pairing.claimant.deviceLabel, trustedAt: this.now(), revokedAt: null });
    household.members.add(memberId); household.version += 1;
    pairing.confirmedMemberId = memberId; pairing.confirmedDeviceId = deviceId; pairing.state = "Confirmed"; pairing.version += 1;
    this.codeIndex.delete(pairing.verifier);
    this.audit("pairing_confirmed", { householdId: household.id, pairingId, memberId, deviceId });
    this.audit("device_trusted", { householdId: household.id, memberId, deviceId });
    return this.pairingView(pairing);
  }

  revokePairing(sessionToken, pairingId) {
    const { household } = this.authorize(sessionToken);
    const pairing = this.pairings.get(pairingId);
    if (!pairing || pairing.householdId !== household.id) throw new PairingError("not_found", "That pairing request is unavailable.", 404);
    const state = this.state(pairing);
    if (state === "Revoked") return this.pairingView(pairing);
    if (!["Pending", "Claimed"].includes(state)) throw terminalPairingError(state);
    pairing.state = "Revoked"; pairing.version += 1; this.codeIndex.delete(pairing.verifier);
    this.audit("pairing_revoked", { householdId: household.id, pairingId });
    return this.pairingView(pairing);
  }

  pairingForAdult(sessionToken, pairingId) {
    const { household } = this.authorize(sessionToken);
    const pairing = this.pairings.get(pairingId);
    if (!pairing || pairing.householdId !== household.id) throw new PairingError("not_found", "That pairing request is unavailable.", 404);
    return this.pairingView(pairing);
  }

  pairingForClaim(claimToken) {
    const pairing = this.pairings.get(this.claimTokens.get(hash(String(claimToken ?? ""))));
    if (!pairing) throw new PairingError("claim_unavailable", "This pairing request is unavailable.", 404);
    const view = this.pairingView(pairing);
    return view;
  }

  claimCredential(claimToken) {
    const pairing = this.pairings.get(this.claimTokens.get(hash(String(claimToken ?? ""))));
    if (!pairing || this.state(pairing) !== "Confirmed") throw new PairingError("claim_not_confirmed", "Approval is still required.", 409);
    return this.credentials.get(pairing.claimant.credential.id);
  }

  activateClaim(claimToken) {
    const pairing = this.pairings.get(this.claimTokens.get(hash(String(claimToken ?? ""))));
    if (!pairing || this.state(pairing) !== "Confirmed") throw new PairingError("claim_not_confirmed", "Approval is still required.", 409);
    this.claimTokens.delete(pairing.claimant.tokenHash);
    return { ...this.issueSession(pairing.confirmedMemberId, pairing.confirmedDeviceId), householdId: pairing.householdId, memberId: pairing.confirmedMemberId, deviceId: pairing.confirmedDeviceId };
  }

  logout(sessionToken) {
    this.sessions.delete(hash(String(sessionToken ?? "")));
  }

  pairingView(pairing) {
    return { pairingId: pairing.id, state: this.state(pairing), expiresAt: pairing.expiresAt, version: pairing.version, deviceLabel: pairing.state === "Claimed" ? pairing.claimant.deviceLabel : undefined };
  }

  listDevices(sessionToken) {
    const { household } = this.authorize(sessionToken);
    return [...this.devices.values()].filter(device => device.householdId === household.id).map(({ id, memberId, label, trustedAt, revokedAt }) => ({ id, memberId, label, trustedAt, revokedAt }));
  }

  householdView(sessionToken) {
    const { member, household } = this.authorize(sessionToken);
    return {
      householdId: household.id,
      currentMemberId: member.id,
      members: [...household.members].map(memberId => ({ id: memberId, current: memberId === member.id, active: this.members.get(memberId)?.active === true })),
    };
  }

  leaveHousehold(sessionToken) {
    const { member, household } = this.authorize(sessionToken);
    const remaining = [...household.members].filter(memberId => memberId !== member.id && this.members.get(memberId)?.active);
    if (!remaining.length) throw new PairingError("last_adult", "The only active adult cannot leave. Household deletion and recovery are not available.", 409);
    return this.removeMembership(household, member.id, member.id);
  }

  removeOtherAdult(sessionToken, memberId) {
    const { member, household } = this.authorize(sessionToken);
    if (memberId === member.id) throw new PairingError("use_leave", "Use Leave household to remove your own membership.", 409);
    if (!household.members.has(memberId) || !this.members.get(memberId)?.active) throw new PairingError("not_found", "That household member is unavailable.", 404);
    return this.removeMembership(household, memberId, member.id);
  }

  removeMembership(household, memberId, actorId) {
    const target = this.members.get(memberId); target.active = false; household.version += 1;
    for (const device of this.devices.values()) if (device.memberId === memberId && !device.revokedAt) { device.revokedAt = this.now(); this.audit("device_revoked", { householdId: household.id, memberId, deviceId: device.id }); }
    for (const [sessionHash, session] of this.sessions) if (session.memberId === memberId) this.sessions.delete(sessionHash);
    this.audit("membership_removed", { householdId: household.id, memberId, actorId });
    return { memberId, removed: true };
  }

  revokeDevice(sessionToken, deviceId) {
    const { household, device: actingDevice } = this.authorize(sessionToken);
    const device = this.devices.get(deviceId);
    if (!device || device.householdId !== household.id) throw new PairingError("not_found", "That device is unavailable.", 404);
    if (device.id === actingDevice.id) throw new PairingError("current_device", "Use another trusted device to revoke this device.", 409);
    if (!device.revokedAt) { device.revokedAt = this.now(); this.audit("device_revoked", { householdId: household.id, memberId: device.memberId, deviceId }); }
    return { id: device.id, revokedAt: device.revokedAt };
  }
}

function cleanLabel(value) {
  const label = String(value ?? "").trim().replace(/\s+/g, " ");
  if (!label || label.length > 48) throw new PairingError("invalid_device_label", "Enter a device name of 1 to 48 characters.");
  return label;
}

function genericCodeError() { return new PairingError("invalid_code", "That code is invalid, expired, or unavailable.", 404); }
function terminalPairingError(state) {
  const values = { Expired: ["pairing_expired", "This pairing code expired. Ask for a new code.", 410], Revoked: ["pairing_revoked", "This pairing request was revoked.", 410], Confirmed: ["pairing_used", "This pairing code has already been used.", 409], Claimed: ["pairing_claimed", "This pairing code has already been claimed.", 409], Pending: ["pairing_not_claimed", "The other adult has not claimed this request yet.", 409] };
  return new PairingError(...(values[state] ?? ["invalid_state", "That pairing request is unavailable.", 409]));
}
