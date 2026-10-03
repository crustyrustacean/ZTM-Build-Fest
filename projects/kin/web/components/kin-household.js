const api = async (path, options = {}) => {
  const response = await fetch(path, { ...options, headers: { "Content-Type": "application/json", ...(options.headers ?? {}) } });
  const value = await response.json().catch(() => ({ message: "Kin could not read the server response." }));
  if (!response.ok) { const error = new Error(value.message); error.code = value.error; throw error; }
  return value;
};

const decode = value => Uint8Array.from(atob(value.replace(/-/g, "+").replace(/_/g, "/")), character => character.charCodeAt(0));
const encode = value => btoa(String.fromCharCode(...new Uint8Array(value))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
const registrationOptions = options => ({ ...options, challenge: decode(options.challenge), user: { ...options.user, id: decode(options.user.id) }, excludeCredentials: (options.excludeCredentials ?? []).map(item => ({ ...item, id: decode(item.id) })) });
const authenticationOptions = options => ({ ...options, challenge: decode(options.challenge), allowCredentials: options.allowCredentials.map(item => ({ ...item, id: decode(item.id) })) });
const credentialJson = credential => ({ id: credential.id, type: credential.type, response: { clientDataJSON: encode(credential.response.clientDataJSON), attestationObject: credential.response.attestationObject ? encode(credential.response.attestationObject) : undefined, authenticatorData: credential.response.authenticatorData ? encode(credential.response.authenticatorData) : undefined, signature: credential.response.signature ? encode(credential.response.signature) : undefined, userHandle: credential.response.userHandle ? encode(credential.response.userHandle) : null, transports: credential.response.getTransports?.() ?? [] } });

class KinHousehold extends HTMLElement {
  constructor() {
    super();
    this.identity = null; this.pairing = null; this.claim = null; this.timer = null; this.poll = null; this.busy = false;
  }

  connectedCallback() { this.className = "household-panel"; this.load(); }
  disconnectedCallback() { clearInterval(this.timer); clearTimeout(this.poll); }

  async load() {
    try {
      const status = await api("/api/status"); this.identity = status.identity; this.claim = status.claim;
      if (this.claim && this.claim.state !== "Confirmed") this.schedulePoll();
      this.render();
    } catch (error) { this.renderError(error); }
  }

  render() {
    clearInterval(this.timer); this.replaceChildren();
    const heading = document.createElement("h2"); heading.textContent = location.pathname === "/pair" ? "Join a household" : "Household";
    this.append(heading);
    if (!window.PublicKeyCredential) return this.message("Passkeys are unavailable in this browser. Use a current browser with a configured screen lock.", true);
    if (location.pathname === "/pair" && !this.identity) return this.renderJoin();
    if (!this.identity) return this.renderSetup();
    this.renderMember();
  }

  renderSetup() {
    this.text("Set up this adult and device with a passkey before pairing another adult.");
    this.button("Set up household", () => this.register("bootstrap", {}));
  }

  renderJoin() {
    if (this.claim) {
      const messages = { Claimed: "Your identity is ready. The existing adult must approve this device before you can join.", Expired: "This pairing request expired. Ask the other adult for a new code.", Revoked: "The other adult revoked this pairing request.", Confirmed: "Approval succeeded. Use your passkey once more to activate this device." };
      this.message(messages[this.claim.state] ?? "Checking the pairing request…", this.claim.state !== "Claimed");
      if (this.claim.state === "Confirmed") this.button("Activate with passkey", () => this.activateClaim());
      return;
    }
    this.text("A code proves you received an invitation. You must create a passkey, and an existing adult must still approve you. No household details are shown before approval.");
    const form = document.createElement("form");
    const codeLabel = document.createElement("label"); codeLabel.textContent = "Pairing code";
    const code = document.createElement("input"); code.name = "code"; code.required = true; code.autocomplete = "one-time-code"; code.inputMode = "text"; code.maxLength = 9; code.placeholder = "F7KM-Q2DX"; code.value = new URLSearchParams(location.search).get("code")?.slice(0, 9) ?? ""; code.setAttribute("aria-describedby", "pair-help");
    const help = document.createElement("p"); help.id = "pair-help"; help.className = "hint"; help.textContent = "Codes ignore case and punctuation.";
    const deviceLabel = document.createElement("label"); deviceLabel.textContent = "Name this device";
    const device = document.createElement("input"); device.name = "deviceLabel"; device.required = true; device.maxLength = 48; device.value = "This device";
    const submit = document.createElement("button"); submit.type = "submit"; submit.textContent = "Create passkey and request approval";
    codeLabel.append(code); deviceLabel.append(device); form.append(codeLabel, help, deviceLabel, submit);
    form.addEventListener("submit", event => { event.preventDefault(); this.register("claim", { code: code.value, deviceLabel: device.value }); });
    this.append(form); requestAnimationFrame(() => code.focus());
  }

  renderMember() {
    this.text("This device belongs to an authenticated household adult.");
    if (!this.pairing) {
      this.button("Pair another adult", () => this.createPairing());
      this.button("Trusted devices", () => this.showDevices(), "secondary");
      this.button("Household access", () => this.showHousehold(), "secondary");
      this.button("Log out", () => this.logout(), "secondary");
      return;
    }
    const state = document.createElement("p"); state.className = "pairing-state"; state.setAttribute("role", "status"); state.textContent = this.pairing.state === "Pending" ? "Waiting for the other adult to claim this code." : this.pairing.state === "Claimed" ? `${this.pairing.deviceLabel || "The other device"} is awaiting your approval.` : `Pairing ${this.pairing.state.toLowerCase()}.`; this.append(state);
    if (["Pending", "Claimed"].includes(this.pairing.state)) {
      if (this.pairing.code) { const code = document.createElement("output"); code.className = "pairing-code"; code.textContent = this.pairing.code; code.setAttribute("aria-label", `Pairing code ${[...this.pairing.code].join(" ")}`); this.append(code); }
      this.countdown = document.createElement("p"); this.countdown.className = "pairing-countdown"; this.append(this.countdown); this.updateCountdown(); this.timer = setInterval(() => this.updateCountdown(), 1000);
      const actions = document.createElement("div"); actions.className = "pairing-actions";
      if (this.pairing.code) { actions.append(this.makeButton("Copy code", () => this.copyCode()), this.makeButton("Share invitation", () => this.share(), "secondary")); }
      if (this.pairing.state === "Claimed") actions.append(this.makeButton("Approve with passkey", () => this.approve()));
      actions.append(this.makeButton("Revoke", () => this.revoke(), "danger")); this.append(actions);
      this.pollPairing();
    }
  }

  async register(purpose, values) {
    await this.run(async () => {
      const started = await api("/api/passkeys/register/options", { method: "POST", body: JSON.stringify({ purpose, deviceLabel: values.deviceLabel ?? "This device", code: values.code }) });
      const credential = await navigator.credentials.create({ publicKey: registrationOptions(started.publicKey) });
      await api("/api/passkeys/register/finish", { method: "POST", body: JSON.stringify({ flow: started.flow, credential: credentialJson(credential) }) });
      history.replaceState(null, "", purpose === "claim" ? "/pair" : "/"); await this.load();
    });
  }

  async createPairing() { await this.run(async () => { this.pairing = await api("/api/pairings", { method: "POST", body: "{}" }); this.render(); }); }
  async approve() { await this.run(async () => { const started = await api(`/api/pairings/${this.pairing.pairingId}/approve/options`, { method: "POST", body: JSON.stringify({ expectedVersion: this.pairing.version }) }); const credential = await navigator.credentials.get({ publicKey: authenticationOptions(started.publicKey) }); this.pairing = await api(`/api/pairings/${this.pairing.pairingId}/approve/finish`, { method: "POST", body: JSON.stringify({ flow: started.flow, credential: credentialJson(credential) }) }); this.render(); }); }
  async activateClaim() { await this.run(async () => { const started = await api("/api/claim/activate/options", { method: "POST", body: "{}" }); const credential = await navigator.credentials.get({ publicKey: authenticationOptions(started.publicKey) }); await api("/api/claim/activate/finish", { method: "POST", body: JSON.stringify({ flow: started.flow, credential: credentialJson(credential) }) }); location.href = "/"; }); }
  async revoke() { await this.run(async () => { this.pairing = await api(`/api/pairings/${this.pairing.pairingId}`, { method: "DELETE", body: "{}" }); this.render(); }); }
  async copyCode() { try { await navigator.clipboard.writeText(this.pairing.code); this.message("Pairing code copied."); } catch { this.message("Copy is unavailable. Select and copy the code manually.", true); } }
  async share() { const url = `${location.origin}/pair?code=${encodeURIComponent(this.pairing.code)}`; if (navigator.share) { try { await navigator.share({ title: "Join my Kin household", text: "Open this invitation to request household access. Approval is still required.", url }); return; } catch (error) { if (error.name === "AbortError") return; } } try { await navigator.clipboard.writeText(url); this.message("Invitation link copied."); } catch { this.message(`Share this address: ${url}`, true); } }

  async showDevices() { await this.run(async () => { const { devices } = await api("/api/devices"); this.replaceChildren(); const heading = document.createElement("h2"); heading.textContent = "Trusted devices"; this.append(heading); const list = document.createElement("ul"); list.className = "device-list"; for (const device of devices) { const item = document.createElement("li"); const text = document.createElement("span"); text.textContent = `${device.label} — ${device.revokedAt ? "Revoked" : "Trusted"}`; item.append(text); if (!device.revokedAt && device.id !== this.identity.deviceId) item.append(this.makeButton("Revoke device", async () => { await api(`/api/devices/${device.id}`, { method: "DELETE", body: "{}" }); await this.showDevices(); }, "danger")); list.append(item); } this.append(list, this.makeButton("Back", () => this.render(), "secondary")); }); }
  async showHousehold() { await this.run(async () => { const household = await api("/api/household"); this.replaceChildren(); const heading = document.createElement("h2"); heading.textContent = "Household access"; this.append(heading); this.text("Membership and device trust are separate. Removing an adult revokes that adult’s devices and sessions, but cannot erase information already copied."); const list = document.createElement("ul"); for (const member of household.members.filter(value => value.active)) { const item = document.createElement("li"); item.textContent = member.current ? "You — active adult" : "Other adult — active"; if (!member.current) item.append(this.makeButton("Remove other adult", () => this.removeMember(member.id), "danger")); list.append(item); } this.append(list, this.makeButton("Leave household", () => this.leave(), "danger"), this.makeButton("Back", () => this.render(), "secondary")); }); }
  async removeMember(memberId) { if (!confirm("Remove the other adult and revoke all of their trusted devices? Previously copied information cannot be erased.")) return; await this.run(() => api("/api/household/membership", { method: "DELETE", body: JSON.stringify({ memberId }) })); await this.showHousehold(); }
  async leave() { if (!confirm("Leave this household and revoke this adult’s devices? This cannot be undone or recovered in this release.")) return; await this.run(async () => { await api("/api/household/membership", { method: "DELETE", body: "{}" }); location.href = "/"; }); }
  async logout() { await this.run(async () => { await api("/api/logout", { method: "POST", body: "{}" }); location.href = "/"; }); }
  pollPairing() { if (!["Pending", "Claimed"].includes(this.pairing?.state)) return; clearTimeout(this.poll); this.poll = setTimeout(async () => { try { const latest = await api(`/api/pairings/${this.pairing.pairingId}`); const changed = latest.version !== this.pairing.version; this.pairing = { ...this.pairing, ...latest }; if (changed) this.render(); else this.pollPairing(); } catch (error) { this.renderError(error); } }, 2000); }
  schedulePoll() { clearTimeout(this.poll); this.poll = setTimeout(async () => { try { this.claim = await api("/api/claim"); this.render(); if (this.claim.state !== "Confirmed") this.schedulePoll(); } catch (error) { this.renderError(error); } }, 2000); }
  updateCountdown() { const seconds = Math.max(0, Math.ceil((this.pairing.expiresAt - Date.now()) / 1000)); this.countdown.textContent = seconds ? `Expires in ${String(Math.floor(seconds / 60)).padStart(2, "0")}:${String(seconds % 60).padStart(2, "0")}` : "Expired — request a new code."; if (!seconds) { clearInterval(this.timer); this.pollPairing(); } }

  async run(action) { if (this.busy) return; this.busy = true; this.setAttribute("aria-busy", "true"); try { await action(); } catch (error) { if (["NotAllowedError", "AbortError"].includes(error?.name)) error = new Error("The passkey was unavailable or the request was cancelled. No authorization change was made."); this.renderError(error); } finally { this.busy = false; this.setAttribute("aria-busy", "false"); } }
  renderError(error) { this.message(error?.message || "Kin could not complete that request.", true); }
  text(value) { const paragraph = document.createElement("p"); paragraph.textContent = value; this.append(paragraph); return paragraph; }
  message(value, alert = false) { let region = this.querySelector(".household-message"); if (!region) { region = document.createElement("p"); region.className = "household-message"; this.append(region); } region.setAttribute("role", alert ? "alert" : "status"); region.textContent = value; return region; }
  makeButton(label, action, className = "") { const button = document.createElement("button"); button.type = "button"; button.textContent = label; button.className = className; button.addEventListener("click", action); return button; }
  button(label, action, className) { const button = this.makeButton(label, action, className); this.append(button); return button; }
}

customElements.define("kin-household", KinHousehold);
