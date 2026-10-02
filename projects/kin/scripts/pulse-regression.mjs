import assert from "node:assert/strict";

// Runs only against the regression runner's isolated synthetic database.
export async function pulseRegressions() {
  const app = document.querySelector("kin-app"), pulse = app.pulse;
  const check = (value, message) => { if (!value) throw new Error(message); };
  const idle = async () => {
    for (let i=0; app.busy && i<300; i++) await new Promise(resolve=>setTimeout(resolve,10));
    check(!app.busy,"Pulse must settle");
  };
  const count = async () => (await app.store.loadEvents()).length;
  const initial = await count();
  const others = JSON.stringify([app.state.items,app.state.handoffs,app.state.talks]);
  check(pulse.durationSelect.value==="4", "default duration");
  check([...pulse.valueSelect.options].map(o=>o.text).join("|")==="Good|Okay|Drained|Rough day|Need quiet", "fixed named values");
  check(pulse.querySelector("h2").textContent==="Pulse", "Pulse heading");
  pulse.valueSelect.value="drained";
  pulse.form.requestSubmit(); await idle();
  let current = app.state.pulses[0];
  check(current.value==="drained" && current.status==="active", "SET active");
  check(current.expiresAt-current.setAt===4*3600000, "one timestamp snapshot");
  check(pulse.current.textContent==="Drained" && pulse.until.textContent.startsWith("Until "), "current presentation");
  check(document.activeElement===pulse.changeButton, "set focus");
  pulse.changeButton.click(); pulse.valueSelect.value="need-quiet";
  pulse.durationSelect.value="1"; pulse.form.requestSubmit(); await idle();
  check(app.state.pulses.length===1 && app.state.pulses[0].value==="need-quiet", "replacement");
  check(JSON.stringify([app.state.items,app.state.handoffs,app.state.talks])===others, "Pulse cannot change other features");
  await app.refreshFromEvents();
  check(app.state.pulses[0].value==="need-quiet", "canonical reload");
  pulse.clearButton.click(); await idle();
  await app.savePulse({type:"clear-pulse"});
  check(app.state.pulses.length===0 && pulse.current.textContent==="No current pulse.", "repeated clear");
  check((await count())===initial+4,"only intent events");

  const originalAdd=IDBObjectStore.prototype.add;
  const timestamp=Date.now();
  const command={type:"set-pulse",value:"rough-day",timestamp,expiresAt:timestamp+3600000};
  IDBObjectStore.prototype.add=function(...args){
    if(this.name==="events")throw new DOMException("Synthetic quota","QuotaExceededError");
    return originalAdd.apply(this,args);
  };
  try { await app.savePulse(command); } finally { IDBObjectStore.prototype.add=originalAdd; }
  check(!app.retryButton.hidden && app.state.pulses.length===0,"SET failure retains prior state and retry");
  pulse.valueSelect.value="good";
  const retry=app.retryAction, load=app.store.loadEvents.bind(app.store);
  app.store.loadEvents=async()=>{throw new Error("Synthetic refresh");};
  try { await app.refreshFromEvents(); await app.refreshFromEvents(); }
  finally {app.store.loadEvents=load;}
  await app.retryAction();
  check(app.retryAction===retry && (await count())===initial+4,"refresh recovers original retry without append");
  app.retryButton.click(); app.retryButton.click(); await idle();
  current=app.state.pulses[0];
  check(current.value==="rough-day" && current.expiresAt===command.expiresAt && current.setAt===timestamp,"original SET retry");
  check((await count())===initial+5,"rapid retry appends once");
  await app.savePulse({type:"clear-pulse"});

  // Advisory timer calls Rust; no expiry event is appended.
  const now=Date.now();
  await app.savePulse({type:"set-pulse",value:"okay",timestamp:now,expiresAt:now+180});
  const beforeExpiry=await count();
  for(let i=0;app.state.pulses[0].status!=="expired" && i<100;i++) await new Promise(resolve=>setTimeout(resolve,20));
  await idle();
  check(app.state.pulses[0].status==="expired" && pulse.current.textContent==="No current pulse.","timer reprojects expiry");
  check((await count())===beforeExpiry,"expiry appends nothing");
  await app.savePulse({type:"clear-pulse"});
  check(app.store.database.version===1,"schema unchanged");
  return "PASS Pulse fixed values, actor projection, set/replace/clear, timer expiry, original retry and repeated refresh recovery";
}

export async function pulsePeerRegressions(first, second, until) {
  await first.evaluate(`(async()=>{const a=document.querySelector('kin-app');const timestamp=Date.now();await a.savePulse({type:'set-pulse',value:'drained',timestamp,expiresAt:timestamp+3600000});})()`);
  await until(()=>second.evaluate(`document.querySelector('kin-app').state.pulses[0]?.value==='drained'`));
  await second.send("Page.reload");
  await until(()=>second.evaluate(`!!document.querySelector('kin-app')?.store && !document.querySelector('kin-app').busy`));
  assert.equal(await second.evaluate(`document.querySelector('kin-app').pulse.current.textContent`),"Drained");
  await first.evaluate(`document.querySelector('kin-app').savePulse({type:'clear-pulse'})`);
  await until(()=>second.evaluate(`document.querySelector('kin-app').state.pulses.length===0`));
  assert.equal(await second.evaluate(`document.querySelector('kin-app').pulse.current.textContent`),"No current pulse.");
  console.log("PASS Pulse cross-tab SET/CLEAR and reload reconstruction");
}
