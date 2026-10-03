import { createHash, randomBytes, verify } from "node:crypto";
import { PairingError } from "./pairing-service.mjs";

const b64 = value => Buffer.from(value, "base64url");
const b64url = value => Buffer.from(value).toString("base64url");
const sha256 = value => createHash("sha256").update(value).digest();

export class WebAuthn {
  constructor({ rpId, origin, now = () => Date.now() }) {
    this.rpId = rpId;
    this.origin = origin;
    this.now = now;
    this.challenges = new Map();
  }

  registrationOptions(flow) {
    const challenge = this.challenge("register", flow);
    return {
      challenge,
      rp: { id: this.rpId, name: "Kin" },
      user: { id: b64url(randomBytes(32)), name: `adult-${randomBytes(6).toString("hex")}`, displayName: "Kin adult" },
      pubKeyCredParams: [{ type: "public-key", alg: -7 }, { type: "public-key", alg: -257 }],
      timeout: 60_000,
      attestation: "none",
      authenticatorSelection: { residentKey: "preferred", userVerification: "required" },
    };
  }

  authenticationOptions(flow, credentialIds) {
    return {
      challenge: this.challenge("authenticate", flow),
      rpId: this.rpId,
      timeout: 60_000,
      userVerification: "required",
      allowCredentials: credentialIds.map(id => ({ type: "public-key", id })),
    };
  }

  challenge(kind, flow) {
    const value = b64url(randomBytes(32));
    this.challenges.set(value, { kind, flow, expiresAt: this.now() + 2 * 60_000 });
    return value;
  }

  consume(clientDataJSON, kind, flow) {
    let client;
    try { client = JSON.parse(b64(clientDataJSON)); } catch { throw authError(); }
    const record = this.challenges.get(client.challenge);
    this.challenges.delete(client.challenge);
    if (!record || record.kind !== kind || record.flow !== flow || record.expiresAt <= this.now() || client.origin !== this.origin || client.type !== (kind === "register" ? "webauthn.create" : "webauthn.get")) throw authError();
    return b64(clientDataJSON);
  }

  verifyRegistration(response, flow) {
    const clientData = this.consume(response?.response?.clientDataJSON, "register", flow);
    const attestation = decodeCbor(b64(response?.response?.attestationObject));
    const authData = attestation instanceof Map ? attestation.get("authData") : null;
    if (!Buffer.isBuffer(authData) || authData.length < 55) throw authError();
    verifyRpAndFlags(authData, this.rpId, true);
    let offset = 37;
    const aaguidEnd = offset + 16;
    const idLength = authData.readUInt16BE(aaguidEnd);
    const idStart = aaguidEnd + 2;
    const idEnd = idStart + idLength;
    if (idEnd > authData.length) throw authError();
    const credentialId = authData.subarray(idStart, idEnd);
    const decoded = decodeCbor(authData, idEnd, true);
    const cose = decoded.value;
    if (!(cose instanceof Map)) throw authError();
    const algorithm = cose.get(3);
    const publicKey = coseToPem(cose, algorithm);
    if (response.id !== b64url(credentialId)) throw authError();
    return { id: response.id, publicKey, algorithm, signCount: authData.readUInt32BE(33), transports: response.response.transports ?? [] };
  }

  verifyAuthentication(response, flow, credential) {
    const clientData = this.consume(response?.response?.clientDataJSON, "authenticate", flow);
    if (!credential || response.id !== credential.id) throw authError();
    const authData = b64(response.response.authenticatorData);
    verifyRpAndFlags(authData, this.rpId, false);
    const signed = Buffer.concat([authData, sha256(clientData)]);
    if (!verify(credential.algorithm === -7 ? "sha256" : "RSA-SHA256", signed, credential.publicKey, b64(response.response.signature))) throw authError();
    const count = authData.readUInt32BE(33);
    if (credential.signCount && count && count <= credential.signCount) throw new PairingError("credential_replayed", "The passkey response could not be verified.", 401);
    credential.signCount = count;
    return true;
  }
}

function verifyRpAndFlags(authData, rpId, registration) {
  if (authData.length < 37 || !authData.subarray(0, 32).equals(sha256(rpId))) throw authError();
  const flags = authData[32];
  if (!(flags & 0x01) || !(flags & 0x04) || (registration && !(flags & 0x40))) throw authError();
}

function coseToPem(cose, algorithm) {
  if (algorithm === -7 && cose.get(1) === 2 && cose.get(-1) === 1) {
    const x = cose.get(-2); const y = cose.get(-3);
    if (!Buffer.isBuffer(x) || !Buffer.isBuffer(y) || x.length !== 32 || y.length !== 32) throw authError();
    const spkiPrefix = Buffer.from("3059301306072a8648ce3d020106082a8648ce3d030107034200", "hex");
    return `-----BEGIN PUBLIC KEY-----\n${Buffer.concat([spkiPrefix, Buffer.from([4]), x, y]).toString("base64").match(/.{1,64}/g).join("\n")}\n-----END PUBLIC KEY-----\n`;
  }
  if (algorithm === -257 && cose.get(1) === 3) {
    const n = cose.get(-1); const e = cose.get(-2);
    if (!Buffer.isBuffer(n) || !Buffer.isBuffer(e)) throw authError();
    const rsa = derSequence(derInteger(n), derInteger(e));
    const algorithmId = Buffer.from("300d06092a864886f70d0101010500", "hex");
    const spki = derSequence(algorithmId, Buffer.concat([Buffer.from([0x03]), derLength(rsa.length + 1), Buffer.from([0]), rsa]));
    return `-----BEGIN PUBLIC KEY-----\n${spki.toString("base64").match(/.{1,64}/g).join("\n")}\n-----END PUBLIC KEY-----\n`;
  }
  throw new PairingError("unsupported_passkey", "That passkey type is not supported.", 400);
}

function derInteger(value) { const bytes = value[0] & 0x80 ? Buffer.concat([Buffer.from([0]), value]) : value; return Buffer.concat([Buffer.from([0x02]), derLength(bytes.length), bytes]); }
function derSequence(...values) { const body = Buffer.concat(values); return Buffer.concat([Buffer.from([0x30]), derLength(body.length), body]); }
function derLength(length) { if (length < 128) return Buffer.from([length]); const hex = length.toString(16).padStart(Math.ceil(length.toString(16).length / 2) * 2, "0"); const bytes = Buffer.from(hex, "hex"); return Buffer.concat([Buffer.from([0x80 | bytes.length]), bytes]); }

function decodeCbor(buffer, start = 0, withOffset = false) {
  let offset = start;
  const read = () => {
    const initial = buffer[offset++]; if (initial === undefined) throw authError();
    const major = initial >> 5; const info = initial & 31;
    let length;
    if (info < 24) length = info;
    else if (info === 24) length = buffer[offset++];
    else if (info === 25) { length = buffer.readUInt16BE(offset); offset += 2; }
    else if (info === 26) { length = buffer.readUInt32BE(offset); offset += 4; }
    else throw authError();
    if (major === 0) return length;
    if (major === 1) return -1 - length;
    if (major === 2) { const value = buffer.subarray(offset, offset + length); offset += length; return value; }
    if (major === 3) { const value = buffer.toString("utf8", offset, offset + length); offset += length; return value; }
    if (major === 4) return Array.from({ length }, read);
    if (major === 5) { const map = new Map(); for (let i = 0; i < length; i += 1) map.set(read(), read()); return map; }
    if (major === 7 && (info === 20 || info === 21)) return info === 21;
    throw authError();
  };
  const value = read();
  return withOffset ? { value, offset } : value;
}

function authError() { return new PairingError("passkey_verification_failed", "The passkey response could not be verified. Try again.", 401); }
