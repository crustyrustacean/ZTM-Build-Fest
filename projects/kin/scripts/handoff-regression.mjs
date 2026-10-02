import assert from "node:assert/strict";

// Serialized into the isolated browser; all fixtures are synthetic.
export async function handoffRegressions() {
  const app = document.querySelector("kin-app");
  const capture = app.handoffs;
  const check = (value, message) => { if (!value) throw new Error(message); };
  const idle = async () => {
    for (let i = 0; app.busy && i < 300; i++) await new Promise(resolve => setTimeout(resolve, 10));
    check(!app.busy, "Handoff operation must settle");
  };
  const count = async () => (await app.store.loadEvents()).length;
  const edit = text => { capture.input.value = text; capture.saveDraft(); };
  const submit = async () => { capture.querySelector("form").requestSubmit(); await idle(); };
  const text = '<script>alert("handoff")</script> 🥛';
  const before = await count();
  edit(text);
  await submit();
  const record = app.state.handoffs.at(-1);
  check(record.text === text && record.status === "unacknowledged", "new handoff projection");
  check(!app.state.items.some(item => item.itemId === record.handoffId), "independent random Handoff ID");
  check(capture.querySelector(".item-text").textContent === text && !capture.querySelector("script"), "inert handoff text");
  check(capture.input.value === "" && !sessionStorage.getItem("kin.handoff.draft"), "own draft clears");
  check(document.activeElement === capture.input, "handoff add focus");
  capture.querySelector(".complete-button").click();
  await idle();
  check(app.state.handoffs[0].status === "acknowledged", "acknowledgement");
  check(capture.querySelector(".completed-label").textContent === "Acknowledged", "neutral receipt label");
  capture.querySelector(".archive-button").click();
  await idle();
  check(app.state.handoffs[0].status === "archived" && !capture.querySelector("li"), "hidden tombstone");
  check((await count()) === before + 3, "archival retains events");
  for (const handoffId of [record.handoffId, "ff".repeat(16)]) {
    for (const type of ["acknowledge-handoff", "archive-handoff"]) {
      let code;
      try { await app.store.append({ type, handoffId }, app.engine); } catch (error) { code = error.code; }
      check(code === 4 && (await count()) === before + 3, "invalid reference must not append");
    }
  }
  const originalAdd = IDBObjectStore.prototype.add;
  edit("Original handoff");
  IDBObjectStore.prototype.add = function (...args) {
    if (this.name === "events") throw new DOMException("Synthetic quota", "QuotaExceededError");
    return originalAdd.apply(this, args);
  };
  try { await submit(); } finally { IDBObjectStore.prototype.add = originalAdd; }
  check(!app.retryButton.hidden && capture.input.value === "Original handoff", "failed add retains draft/retry");
  edit("Newer handoff draft");
  app.retryButton.click(); app.retryButton.click();
  await idle();
  check((await count()) === before + 4 && app.state.handoffs.at(-1).text === "Original handoff", "retry original exactly once");
  check(capture.input.value === "Newer handoff draft", "older retry preserves newer text");
  const events = (await app.store.loadEvents()).map(row => row.encoded_event);
  check(JSON.stringify(app.engine.applyEvents(events)) === JSON.stringify(app.state), "mixed deterministic replay");
  check(app.store.database.version === 1, "no IndexedDB migration");
  return "PASS Handoff add/acknowledge/archive, tombstones, invalid references, inert Unicode, retry draft ownership and mixed replay";
}

export async function handoffPeerRegressions(first, second, until) {
  await first.evaluate(`document.querySelector('kin-app').handleAddHandoff({detail:{text:'Peer Handoff'}})`);
  await until(() => second.evaluate(`document.querySelector('kin-app').state.handoffs.some(row=>row.text==='Peer Handoff')`));
  assert.equal(await second.evaluate('JSON.stringify(document.querySelector("kin-app").state)'),
    await first.evaluate('JSON.stringify(document.querySelector("kin-app").state)'));
  assert.ok((await second.evaluate('window.peerMessages')).every(message => JSON.stringify(message) === '{"type":"events-changed"}'));
  await second.evaluate(`(async()=>{
    const app=document.querySelector('kin-app');
    const record=app.state.handoffs.find(row=>row.text==='Peer Handoff');
    const original=IDBObjectStore.prototype.add;
    IDBObjectStore.prototype.add=function(...args){
      if(this.name==='events') throw new DOMException('Synthetic quota','QuotaExceededError');
      return original.apply(this,args);
    };
    try { await app.handleHandoffAction('acknowledge-handoff',record.handoffId); }
    finally { IDBObjectStore.prototype.add=original; }
  })()`);
  assert.equal(await second.evaluate('document.querySelector("kin-app").retryButton.hidden'), false);
  await first.evaluate(`(()=>{
    const app=document.querySelector('kin-app');
    return app.handleHandoffAction('archive-handoff',app.state.handoffs.find(row=>row.text==='Peer Handoff').handoffId);
  })()`);
  await until(() => second.evaluate(`document.querySelector('kin-app').state.handoffs.find(row=>row.text==='Peer Handoff')?.status==='archived' && document.querySelector('kin-app').retryButton.hidden`));
  console.log("PASS Handoff cross-tab canonical convergence, content-free invalidation, stale acknowledgement retry cleared");
}
