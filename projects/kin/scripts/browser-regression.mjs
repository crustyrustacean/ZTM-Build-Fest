// Node 22+ and a Chromium-family executable; no npm packages required.
// Uses a fresh temporary profile and loopback server, never an existing Kin DB.
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { dirname, extname, join, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { setTimeout as delay } from "node:timers/promises";

const executable = process.argv[2];
assert.ok(executable, "Usage: node scripts/browser-regression.mjs <browser executable>");
const webRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../web");
const profile = await mkdtemp(join(tmpdir(), "kin-regression-"));
const server = createServer(async (request, response) => {
  const path = resolve(webRoot, `.${new URL(request.url, "http://localhost").pathname.replace(/\/$/, "/index.html")}`);
  if (!path.startsWith(webRoot + sep)) {
    response.writeHead(403).end();
    return;
  }
  try {
    const bytes = await readFile(path);
    response.setHeader("Content-Type", ({ ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".wasm": "application/wasm" })[extname(path)] ?? "application/octet-stream");
    response.end(bytes);
  } catch {
    response.writeHead(404).end();
  }
});
await new Promise((done) => server.listen(0, "127.0.0.1", done));
const origin = `http://127.0.0.1:${server.address().port}`;
const browser = spawn(executable, ["--headless=new", "--disable-gpu", "--no-first-run", "--no-default-browser-check", "--remote-debugging-port=0", `--user-data-dir=${profile}`, "about:blank"], { windowsHide: true, stdio: "ignore" });
let launchError;
browser.on("error", (error) => { launchError = error; });
const clients = [];
const problems = [];
const requests = [];
let browserClient;

async function until(check) {
  for (let i = 0; i < 200; i++) {
    if (launchError) throw launchError;
    const result = await check();
    if (result) return result;
    await delay(50);
  }
  throw new Error("Timed out waiting for browser state");
}

async function connect(url) {
  const socket = new WebSocket(url);
  await new Promise((done, reject) => { socket.onopen = done; socket.onerror = reject; });
  let id = 0;
  const pending = new Map();
  socket.onmessage = ({ data }) => {
    const message = JSON.parse(data);
    if (message.id) {
      const task = pending.get(message.id);
      pending.delete(message.id);
      if (message.error) task.reject(new Error(JSON.stringify(message.error)));
      else task.resolve(message.result);
    } else if (message.method === "Runtime.exceptionThrown") {
      problems.push(message.params.exceptionDetails);
    } else if (message.method === "Log.entryAdded") {
      const entry = message.params.entry;
      if (entry.level === "error" && !entry.url?.endsWith("/favicon.ico")) problems.push(entry);
    } else if (message.method === "Network.requestWillBeSent") {
      requests.push(message.params.request.url);
    }
  };
  const client = {
    send(method, params = {}) {
      return new Promise((resolve, reject) => {
        const number = ++id;
        const timeout = setTimeout(() => reject(new Error(`CDP timeout: ${method}`)), 20000);
        pending.set(number, {
          resolve: (value) => { clearTimeout(timeout); resolve(value); },
          reject: (error) => { clearTimeout(timeout); reject(error); },
        });
        socket.send(JSON.stringify({ id: number, method, params }));
      });
    },
    async evaluate(expression) {
      const result = await this.send("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true });
      assert.equal(result.exceptionDetails, undefined, JSON.stringify(result.exceptionDetails));
      return result.result.value;
    },
    close: () => socket.close(),
  };
  clients.push(client);
  return client;
}

// Runs inside the browser against real DOM, storage, and Rust/WASM replay.
async function regressions() {
  const app = document.querySelector("kin-app");
  const compose = app.compose;
  const key = "kin.compose.draft";
  const passed = [];
  const check = (condition, message) => { if (!condition) throw new Error(message); };
  const edit = (text) => {
    compose.input.value = text;
    compose.input.dispatchEvent(new Event("input", { bubbles: true }));
  };
  const idle = async () => {
    for (let i = 0; app.busy && i < 200; i++) await new Promise((r) => setTimeout(r, 10));
    check(!app.busy && app.main.getAttribute("aria-busy") === "false", "busy must clear");
  };
  const count = async () => (await app.store.loadEvents()).length;
  const submit = async () => { compose.form.requestSubmit(); await idle(); };
  const draft = (expected) => {
    check(compose.input.value === expected, "visible draft mismatch");
    check(sessionStorage.getItem(key) === (expected || null), "stored draft mismatch");
  };
  check(app.status.textContent === "Ready.", "startup");
  edit("Normal success");
  await submit();
  check(await count() === 1, "normal add exactly once");
  draft("");
  check(document.activeElement === compose.input, "add focus");
  passed.push("startup, normal add, own draft clearing, sessionStorage removal, focus, busy");

  // Fail an actual IndexedDB transaction after a successful add request.
  // Quota injection separately verifies the actionable storage-full path.
  async function failOnce(mode) {
    const original = IDBObjectStore.prototype.add;
    IDBObjectStore.prototype.add = function (...args) {
      if (this.name !== "events") return original.apply(this, args);
      if (mode === "quota") throw new DOMException("Synthetic quota failure", "QuotaExceededError");
      if (mode === "async-quota") {
        // Trigger a real request error/transaction abort, substituting only
        // its error category so no real disk exhaustion is necessary.
        const request = original.call(this, { ...args[0], local_sequence: 1 });
        request.addEventListener("error", () => Object.defineProperty(request, "error", {
          value: new DOMException("Synthetic quota failure", "QuotaExceededError"),
        }));
        return request;
      }
      const request = original.apply(this, args);
      request.addEventListener("success", () => this.transaction.abort());
      return request;
    };
    try { await submit(); } finally { IDBObjectStore.prototype.add = original; }
    check(!app.retryButton.hidden && !app.alert.hidden, "failure exposes retry");
    check(document.activeElement === compose.input, "failure focus");
    if (mode.includes("quota")) check(app.alert.textContent.includes("storage is full"), "quota guidance");
  }

  for (const changed of [false, true]) {
    const before = await count();
    edit("Buy milk");
    await failOnce(changed ? "async-quota" : "quota");
    draft("Buy milk");
    check(await count() === before, "failed add must not persist");
    if (changed) edit("Buy bread");
    if (changed) {
      app.handlePeerMessage({ data: { type: "events-changed" } });
      await idle();
      check(!app.retryButton.hidden, "peer refresh must retain failed-command retry");
      draft("Buy bread");
    }
    app.retryButton.click();
    app.retryButton.click();
    app.retryButton.click();
    await idle();
    check(await count() === before + 1, "repeated retry persists exactly once");
    check(app.state.items.at(-1).text === "Buy milk", "retry exact original command");
    draft(changed ? "Buy bread" : "");
    check(app.retryAction === null && app.retryButton.hidden, "retry lifecycle");
    app.retryButton.click();
    await idle();
    check(await count() === before + 1, "stale retry button must do nothing");
    passed.push(`quota failure, ${changed ? "edited" : "unchanged"} draft, repeated retry exactly once`);
  }

  const beforeAbort = await count();
  edit("Aborted write");
  await failOnce("abort");
  check(await count() === beforeAbort, "abort after request success must roll back");
  draft("Aborted write");
  app.retryButton.click();
  await idle();
  check(await count() === beforeAbort + 1, "abort retry once");
  draft("");
  passed.push("transaction abort after request success, recovery");

  const append = app.store.append.bind(app.store);
  let release;
  const gate = new Promise((done) => { release = done; });
  app.store.append = async (...args) => { await gate; return append(...args); };
  edit("Pending original");
  const event = { detail: { text: "Pending original" } };
  const operation = app.handleAddItem(event);
  check(app.busy, "pending operation is busy");
  app.remove();
  check(app.channel === null, "disconnect closes peer channel");
  document.body.append(app);
  check(app.busy, "reconnect must not unlock pending operation");
  edit("Newer pending draft");
  event.detail.text = "Mutated event detail";
  release();
  await operation;
  await idle();
  app.store.append = append;
  check(app.state.items.at(-1).text === "Pending original", "submission snapshot");
  draft("Newer pending draft");
  passed.push("delayed add preserves newer draft and captures submitted value across reconnect");

  const unicode = '\uFEFFMilk 🥛 café 家 <script>window.kinInjected=true</script>';
  edit(unicode);
  await submit();
  check(app.state.items.at(-1).text === unicode, "Unicode replay");
  check([...app.querySelectorAll(".item-text")].some((el) => el.textContent === unicode), "literal DOM text");
  check(!window.kinInjected && !app.querySelector("script"), "inert script-like text");
  app.querySelector(".complete-button").click();
  await idle();
  check(app.state.items[0].status === "completed", "completion");
  check(document.activeElement === compose.input, "completion focus");
  draft("");
  passed.push("complete item, focus, Unicode, inert rendering");

  const originalSet = Storage.prototype.setItem;
  const originalRemove = Storage.prototype.removeItem;
  Storage.prototype.setItem = Storage.prototype.removeItem = () => { throw new DOMException("Blocked", "SecurityError"); };
  try { edit("Storage unavailable"); await submit(); check(compose.input.value === "", "blocked storage must not prevent add"); }
  finally { Storage.prototype.setItem = originalSet; Storage.prototype.removeItem = originalRemove; }
  edit("Restored after reload");
  window.kinExpectedState = JSON.stringify(app.state);
  passed.push("sessionStorage denial does not prevent persistence");
  return passed;
}

try {
  const port = await until(async () => {
    try { return (await readFile(join(profile, "DevToolsActivePort"), "utf8")).split("\n")[0]; }
    catch { return false; }
  });
  const endpoint = `http://127.0.0.1:${port}`;
  const version = await (await fetch(`${endpoint}/json/version`)).json();
  console.log(`Browser: ${version.Browser}; Node: ${process.version}; ${process.platform}/${process.arch}`);
  browserClient = await connect(version.webSocketDebuggerUrl);
  async function tab() {
    const target = await (await fetch(`${endpoint}/json/new?about:blank`, { method: "PUT" })).json();
    const client = await connect(target.webSocketDebuggerUrl);
    for (const domain of ["Runtime", "Page", "Log", "Network"]) await client.send(`${domain}.enable`);
    await client.send("Page.navigate", { url: origin });
    await ready(client);
    return client;
  }
  async function ready(client) {
    await until(() => client.evaluate('Boolean(document.querySelector("kin-app")?.store && !document.querySelector("kin-app").busy)'));
  }
  const first = await tab();
  console.log(await first.evaluate(`(${regressions.toString()})()`));
  const state = await first.evaluate("window.kinExpectedState");
  await first.send("Page.reload");
  await until(() => first.evaluate("window.kinExpectedState === undefined"));
  await ready(first);
  assert.equal(await first.evaluate('JSON.stringify(document.querySelector("kin-app").state)'), state);
  assert.equal(await first.evaluate('document.querySelector("input").value'), "Restored after reload");
  await first.evaluate('document.querySelector("input").focus()');
  await first.send("Input.dispatchKeyEvent", { type: "keyDown", key: "Enter", code: "Enter", text: "\r", windowsVirtualKeyCode: 13 });
  await first.send("Input.dispatchKeyEvent", { type: "keyUp", key: "Enter", code: "Enter", windowsVirtualKeyCode: 13 });
  await ready(first);
  assert.equal(await first.evaluate('document.querySelector("input").value'), "");
  console.log("PASS reload/replay, draft restoration, keyboard submission");

  const second = await tab();
  await second.evaluate(`window.peerReads=0; window.peerReplays=0; window.peerMessages=[];
    { const a=document.querySelector('kin-app'); const load=a.store.loadEvents.bind(a.store); const replay=a.engine.applyEvents;
      a.store.loadEvents=async()=>{window.peerReads++;return load();};
      a.engine.applyEvents=(events)=>{window.peerReplays++;return replay(events);};
      a.channel.addEventListener('message',e=>window.peerMessages.push(e.data)); }`);
  await first.evaluate(`{const a=document.querySelector('kin-app');a.compose.input.value='Peer addition';a.compose.saveDraft();a.compose.form.requestSubmit();}`);
  await until(() => second.evaluate(`document.querySelector('kin-app').state.items.some(i=>i.text==='Peer addition')`));
  assert.deepEqual(await second.evaluate("[window.peerReads,window.peerReplays,window.peerMessages]"), [1, 1, [{ type: "events-changed" }]]);
  assert.equal(await second.evaluate('JSON.stringify(document.querySelector("kin-app").state)'), await first.evaluate('JSON.stringify(document.querySelector("kin-app").state)'));
  console.log("PASS two tabs, content-free invalidation, canonical IndexedDB reload, Rust replay");

  await first.evaluate(`{const a=document.querySelector('kin-app');a.remove();document.body.append(a);}`);
  await ready(first);
  assert.equal(await first.evaluate('document.querySelectorAll(".compose-form").length'), 1);
  await first.send("Emulation.setDeviceMetricsOverride", { width: 320, height: 720, deviceScaleFactor: 1, mobile: false });
  await first.evaluate('document.querySelector("input").focus()');
  assert.equal(await first.evaluate("document.documentElement.scrollWidth <= innerWidth"), true);
  assert.equal(await first.evaluate('getComputedStyle(document.querySelector("input")).outlineWidth'), "3px");
  console.log("PASS idle disconnect/reconnect, 320px reflow, focus outline");

  await first.evaluate(`(async()=>{const a=document.querySelector('kin-app');
    const tx=a.store.database.transaction('events','readwrite');tx.objectStore('events').add({encoded_event:new Uint8Array([1])});
    await new Promise((r,j)=>{tx.oncomplete=r;tx.onabort=j;});
    await a.refreshFromEvents();
    if(a.alert.hidden || a.busy) throw Error('Malformed row must fail safely');
    const read=a.store.database.transaction('events','readonly').objectStore('events').getAll();
    await new Promise((r,j)=>{read.onsuccess=r;read.onerror=j;});
    if(read.result.at(-1).encoded_event.length!==1) throw Error('Malformed row was changed');
    const cleanup=a.store.database.transaction('events','readwrite');
    cleanup.objectStore('events').delete(read.result.at(-1).local_sequence);
    await new Promise((r,j)=>{cleanup.oncomplete=r;cleanup.onabort=j;});
    await a.refreshFromEvents();
    if(!a.retryButton.hidden || a.retryAction!==null) throw Error('Recovered refresh left stale retry');
  })()`);
  console.log("PASS malformed row preservation, failure busy state, refresh recovery clears retry");
  assert.deepEqual(problems, [], "Uncaught errors or CSP/console errors");
  assert.ok(requests.length > 0 && requests.every((url) => url.startsWith(origin + "/")), "All page requests stay same-origin");
  console.log("PASS CSP/console and same-origin requests (favicon 404 excluded)");
} finally {
  if (browserClient) await browserClient.send("Browser.close").catch(() => {});
  for (const client of clients) client.close();
  browser.kill();
  await new Promise((done) => server.close(done));
  // The path was created by mkdtemp above; never remove a user browser profile.
  await rm(profile, { recursive: true, force: true, maxRetries: 20, retryDelay: 100 });
}
