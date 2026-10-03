import { projectionContext } from "../browser-time.js";
import "./kin-routines.js";
import { loadKinEngine } from "../wasm/kin-engine.js";
import { EventStore } from "../storage/event-store.js";
import "./kin-compose.js";
import "./kin-item.js";
import "./kin-today.js";
import "./kin-handoff-list.js";
import "./kin-talk-list.js";
import "./kin-pulse.js";
import "./kin-catch-up.js";

const START_ERROR =
  "Kin could not start its household engine or local storage. Your saved information was not intentionally deleted.";
const SAVE_ERROR =
  "Kin could not save that change locally. Your existing information was not intentionally deleted.";

class KinApp extends HTMLElement {
  constructor() {
    super();
    this.engine = null;
    this.store = null;
    this.state = { items: [], handoffs: [], talks: [], pulses: [], routines: [] };
    this.busy = false;
    this.starting = null;
    this.initialized = false;
    this.channel = null;
    this.refreshing = false;
    this.pendingRefresh = false;
    this.retryAction = null;
    this.retryIntent = null;
    this.suspendedRetry = null;
    this.retryRefresh = () => this.refreshFromEvents();
    this.onAddItem = (event) => this.handleAddItem(event);
    this.onCompleteItem = (event) => this.handleCompleteItem(event);
    this.onReopenItem = (event) => this.handleReopenItem(event);
    this.onArchiveItem = (event) => this.handleArchiveItem(event);
    this.onAddHandoff = (event) => this.handleAddHandoff(event);
    this.onAcknowledgeHandoff = (event) =>
      this.handleHandoffAction("acknowledge-handoff", event.detail.handoffId);
    this.onArchiveHandoff = (event) =>
      this.handleHandoffAction("archive-handoff", event.detail.handoffId);
    this.onAddTalk = (event) =>
      this.saveTalk({ type: "add-talk", text: event.detail.text });
    this.onResolveTalk = (event) =>
      this.saveTalk({ type: "resolve-talk", talkId: event.detail.talkId });
    this.onReopenTalk = (event) =>
      this.saveTalk({ type: "reopen-talk", talkId: event.detail.talkId });
    this.onArchiveTalk = (event) =>
      this.saveTalk({ type: "archive-talk", talkId: event.detail.talkId });
    this.onRoutineIntent = event => this.saveRoutine({ ...event.detail, type: event.type.slice(4) });
    this.pulseTimer = null;
    this.catchUpCursor = null;
    this.snapshotBoundary = null;
    this.onCaughtUp = () => this.handleCaughtUp();
    this.onSetPulse = (event) => {
      const timestamp = Date.now();
      const hours = event.detail.hours;
      if (![1, 4, 8].includes(hours)) return;
      this.savePulse({
        type: "set-pulse",
        value: event.detail.value,
        timestamp,
        expiresAt: timestamp + hours * 3_600_000,
      });
    };
    this.onWindowFocus = () => {
      // Let the interaction that activated the window finish before disabling controls.
      clearTimeout(this.focusTimer);
      this.focusTimer = setTimeout(this.onTimeWake, 150);
    };
    this.onClearPulse = () => this.savePulse({ type: "clear-pulse" });
    this.onTimeWake = (event) => {
      if (event?.type === "focus" && event.target !== window) return;
      if (document.visibilityState === "hidden") return;
      this.refreshFromEvents();
    };
    this.onPeerMessage = (event) => this.handlePeerMessage(event);
  }

  connectedCallback() {
    if (!this.initialized) {
      this.initializeElements();
      this.initialized = true;
    }
    this.addEventListener("kin:add-item", this.onAddItem);
    this.addEventListener("kin:complete-item", this.onCompleteItem);
    this.addEventListener("kin:reopen-item", this.onReopenItem);
    this.addEventListener("kin:archive-item", this.onArchiveItem);
    this.addEventListener("kin:add-handoff", this.onAddHandoff);
    this.addEventListener("kin:acknowledge-handoff", this.onAcknowledgeHandoff);
    this.addEventListener("kin:archive-handoff", this.onArchiveHandoff);
    this.addEventListener("kin:add-talk", this.onAddTalk);
    this.addEventListener("kin:resolve-talk", this.onResolveTalk);
    this.addEventListener("kin:reopen-talk", this.onReopenTalk);
    this.addEventListener("kin:archive-talk", this.onArchiveTalk);
    this.addEventListener("kin:set-pulse", this.onSetPulse);
    this.addEventListener("kin:clear-pulse", this.onClearPulse);
    this.addEventListener("kin:caught-up", this.onCaughtUp);
    for (const action of ["create-routine", "complete-routine-occurrence", "reopen-routine-occurrence", "archive-routine"]) {
      this.addEventListener(`kin:${action}`, this.onRoutineIntent);
    }
    document.addEventListener("visibilitychange", this.onTimeWake);
    window.addEventListener("focus", this.onWindowFocus);
    this.openPeerChannel();
    if (this.store) {
      // Reconnecting must not restart the engine or unlock an in-flight save.
      this.pendingRefresh = true;
      this.flushPeerRefresh();
    } else {
      this.initialize();
    }
  }

  initializeElements() {
    const header = document.createElement("header");
    header.className = "site-header";
    const brand = document.createElement("div");
    brand.className = "brand";
    const title = document.createElement("h1");
    title.textContent = "Kin";
    const tagline = document.createElement("p");
    tagline.textContent = "A little more in step.";
    brand.append(title, tagline);
    header.append(brand);

    const main = document.createElement("main");
    main.id = "main";
    main.tabIndex = -1;
    main.setAttribute("aria-busy", "true");
    this.main = main;
    this.catchUp = document.createElement("kin-catch-up");
    this.today = document.createElement("kin-today");
    this.compose = document.createElement("kin-compose");
    this.handoffs = document.createElement("kin-handoff-list");
    this.talks = document.createElement("kin-talk-list");
    this.pulse = document.createElement("kin-pulse");
    this.routines = document.createElement("kin-routines");
    main.append(
      this.catchUp,
      this.today,
      this.compose,
      this.handoffs,
      this.talks,
      this.pulse,
      this.routines,
    );

    const feedback = document.createElement("div");
    feedback.className = "app-feedback";
    this.status = document.createElement("p");
    this.status.className = "status-message";
    this.status.setAttribute("role", "status");
    this.status.setAttribute("aria-live", "polite");
    this.alert = document.createElement("p");
    this.alert.className = "error-message";
    this.alert.setAttribute("role", "alert");
    this.alert.hidden = true;
    this.retryButton = document.createElement("button");
    this.retryButton.type = "button";
    this.retryButton.className = "retry-button";
    this.retryButton.textContent = "Try again";
    this.retryButton.hidden = true;
    feedback.append(this.status, this.alert, this.retryButton);

    this.replaceChildren(header, main, feedback);
    this.retryButton.addEventListener("click", () => this.retryAction?.());
  }

  disconnectedCallback() {
    this.removeEventListener("kin:add-item", this.onAddItem);
    this.removeEventListener("kin:complete-item", this.onCompleteItem);
    this.removeEventListener("kin:reopen-item", this.onReopenItem);
    this.removeEventListener("kin:archive-item", this.onArchiveItem);
    this.removeEventListener("kin:add-handoff", this.onAddHandoff);
    this.removeEventListener(
      "kin:acknowledge-handoff",
      this.onAcknowledgeHandoff,
    );
    this.removeEventListener("kin:archive-handoff", this.onArchiveHandoff);
    this.removeEventListener("kin:add-talk", this.onAddTalk);
    this.removeEventListener("kin:resolve-talk", this.onResolveTalk);
    this.removeEventListener("kin:reopen-talk", this.onReopenTalk);
    this.removeEventListener("kin:archive-talk", this.onArchiveTalk);
    this.removeEventListener("kin:set-pulse", this.onSetPulse);
    this.removeEventListener("kin:clear-pulse", this.onClearPulse);
    this.removeEventListener("kin:caught-up", this.onCaughtUp);
    for (const action of ["create-routine", "complete-routine-occurrence", "reopen-routine-occurrence", "archive-routine"]) {
      this.removeEventListener(`kin:${action}`, this.onRoutineIntent);
    }
    document.removeEventListener("visibilitychange", this.onTimeWake);
    window.removeEventListener("focus", this.onWindowFocus);
    clearTimeout(this.pulseTimer);
    clearTimeout(this.focusTimer);
    this.closePeerChannel();
  }

  async initialize() {
    if (this.starting) {
      return this.starting;
    }
    this.starting = this.loadApplication();
    try {
      await this.starting;
    } finally {
      this.starting = null;
    }
  }

  async loadApplication() {
    const retrying = !this.retryButton.hidden;
    this.setBusy(true);
    this.clearAlert();
    this.setStatus("Starting Kin…");
    try {
      this.store?.close();
      this.engine = await loadKinEngine();
      this.store = await EventStore.open();
      this.openPeerChannel();
      const snapshot = await this.store.getCatchUpState();
      this.applyCatchUpSnapshot(snapshot);
      this.renderState();
      this.setStatus("Ready.");
      this.retryButton.hidden = true;
    } catch (error) {
      this.store?.close();
      this.store = null;
      this.showAlert(error.userMessage ?? START_ERROR, () => this.initialize());
      this.setStatus("");
    } finally {
      this.setBusy(false);
      if (retrying && this.store) {
        this.compose.focusInput();
      }
      this.flushPeerRefresh();
    }
  }

  async handleAddItem(event) {
    if (this.busy || !this.store || !this.engine) {
      return;
    }
    const submittedDraft = Object.freeze({
      text: event.detail.text,
      classification: event.detail.classification,
    });
    this.setBusy(true);
    this.clearAlert();
    this.setStatus("Saving…");
    let restoreComposeFocus = false;
    try {
      await this.appendCommand({ type: "add", ...submittedDraft });
      this.renderState();
      this.compose.clearIfMatches(submittedDraft);
      this.setStatus("Added.");
      this.broadcastEventChange();
      restoreComposeFocus = true;
    } catch (error) {
      this.showAlert(error.userMessage ?? SAVE_ERROR, () =>
        this.handleAddItem({ detail: submittedDraft }),
      );
      this.setStatus("");
      restoreComposeFocus = true;
    } finally {
      this.setBusy(false);
      if (restoreComposeFocus) {
        this.compose.focusInput();
      }
      this.flushPeerRefresh();
    }
  }

  async handleAddHandoff(event) {
    return this.saveHandoff({ type: "add-handoff", text: event.detail.text });
  }

  async handleHandoffAction(type, handoffId) {
    return this.saveHandoff({ type, handoffId });
  }

  async saveHandoff(command) {
    if (this.busy || !this.store || !this.engine) return;
    const submitted = Object.freeze({ ...command });
    this.setBusy(true);
    this.clearAlert();
    this.setStatus("Saving…");
    try {
      await this.appendCommand(submitted);
      this.renderState();
      if (submitted.type === "add-handoff")
        this.handoffs.clearIfMatches(submitted);
      this.setStatus(
        submitted.type === "add-handoff"
          ? "Handoff added."
          : submitted.type === "acknowledge-handoff"
            ? "Acknowledged."
            : "Handoff archived.",
      );
      this.broadcastEventChange();
    } catch (error) {
      if (error.code === 4 && submitted.handoffId) this.pendingRefresh = true;
      this.showAlert(
        error.userMessage ?? SAVE_ERROR,
        () => this.saveHandoff(submitted),
        submitted.handoffId ? submitted : null,
      );
      this.setStatus("");
    } finally {
      this.setBusy(false);
      this.handoffs.focusInput();
      this.flushPeerRefresh();
    }
  }

  async saveTalk(command) {
    if (this.busy || !this.store || !this.engine) return;
    const submitted = Object.freeze({ ...command });
    this.setBusy(true);
    this.clearAlert();
    this.setStatus("Saving…");
    try {
      await this.appendCommand(submitted);
      this.renderState();
      if (submitted.type === "add-talk") this.talks.clearIfMatches(submitted);
      this.setStatus(
        submitted.type === "add-talk"
          ? "Talk added."
          : submitted.type === "resolve-talk"
            ? "Resolved."
            : submitted.type === "reopen-talk"
              ? "Reopened."
              : "Talk archived.",
      );
      this.broadcastEventChange();
    } catch (error) {
      if (error.code === 4 && submitted.talkId) this.pendingRefresh = true;
      this.showAlert(
        error.userMessage ?? SAVE_ERROR,
        () => this.saveTalk(submitted),
        submitted.talkId ? submitted : null,
      );
      this.setStatus("");
    } finally {
      this.setBusy(false);
      this.talks.focusInput();
      this.flushPeerRefresh();
    }
  }

  async savePulse(command) {
    if (this.busy || !this.store || !this.engine) return;
    const submitted = Object.freeze({ ...command });
    this.setBusy(true);
    this.clearAlert();
    this.setStatus("Saving…");
    try {
      await this.appendCommand(submitted);
      this.renderState();
      this.pulse.saved();
      this.setStatus(
        submitted.type === "set-pulse" ? "Pulse set." : "Pulse cleared.",
      );
      this.broadcastEventChange();
    } catch (error) {
      this.showAlert(error.userMessage ?? SAVE_ERROR, () =>
        this.savePulse(submitted),
      );
      this.setStatus("");
    } finally {
      this.setBusy(false);
      this.pulse.focusInput();
      this.flushPeerRefresh();
    }
  }

  async saveRoutine(command) {
    if (this.busy || !this.store || !this.engine) return;
    const submitted = Object.freeze({ ...command });
    const focus = this.routines.captureFocus();
    let committed = false;
    this.setBusy(true);
    this.clearAlert();
    this.setStatus("Saving…");
    try {
      await this.appendCommand(submitted);
      committed = true;
      this.broadcastEventChange();
      this.renderState();
      if (submitted.type === "create-routine") this.routines.clearIfMatches(submitted);
      this.setStatus(submitted.type === "create-routine" ? "Routine added." : submitted.type === "archive-routine" ? "Routine archived." : submitted.type === "complete-routine-occurrence" ? "Occurrence completed." : "Occurrence reopened.");
    } catch (error) {
      if (error.code === 4 && submitted.routineId) this.pendingRefresh = true;
      this.showAlert(committed ? "Your routine was saved. Try again to refresh the view." : error.userMessage ?? SAVE_ERROR,
        committed ? this.retryRefresh : () => this.saveRoutine(submitted), committed || !submitted.routineId ? null : submitted);
      this.setStatus("");
    } finally {
      this.setBusy(false);
      if (submitted.type === "create-routine" || submitted.type === "archive-routine") this.routines.focusInput();
      else this.routines.restoreFocus(focus);
      this.flushPeerRefresh();
    }
  }

  schedulePulseRefresh() {
    clearTimeout(this.pulseTimer);
    if (!this.isConnected || (!this.state.pulses.length && !this.state.routines?.some(r => r.status === "active"))) return;
    // Timers only request canonical replay. Rust alone decides expiry.
    const now = Date.now();
    const active = this.state.pulses.filter(
      (pulse) => pulse.status === "active",
    );
    const midnight = new Date(now);
    midnight.setHours(24, 0, 0, 0);
    const delay = Math.max(
      1,
      Math.min(60_000, midnight.getTime() - now, ...active.map((pulse) => pulse.expiresAt - now)),
    );
    this.pulseTimer = setTimeout(this.onTimeWake, delay);
  }

  async handleCompleteItem(event) {
    return this.handleItemAction("complete", event.detail.itemId);
  }

  async handleReopenItem(event) {
    return this.handleItemAction("reopen", event.detail.itemId);
  }

  async handleArchiveItem(event) {
    return this.handleItemAction("archive", event.detail.itemId);
  }

  async handleItemAction(type, itemId) {
    if (this.busy || !this.store || !this.engine) {
      return;
    }
    const submittedItemId = itemId;
    this.setBusy(true);
    this.clearAlert();
    this.setStatus("Saving…");
    let restoreComposeFocus = false;
    try {
      await this.appendCommand({ type, itemId: submittedItemId });
      this.renderState();
      this.setStatus(
        type === "complete"
          ? "Marked complete."
          : type === "reopen"
            ? "Reopened."
            : "Archived.",
      );
      this.broadcastEventChange();
      restoreComposeFocus = true;
    } catch (error) {
      if (error.code === 4) {
        this.pendingRefresh = true;
      }
      this.showAlert(
        error.userMessage ?? SAVE_ERROR,
        () => this.handleItemAction(type, submittedItemId),
        { type, itemId: submittedItemId },
      );
      this.setStatus("");
      restoreComposeFocus = true;
    } finally {
      this.setBusy(false);
      if (restoreComposeFocus) {
        this.compose.focusInput();
      }
      this.flushPeerRefresh();
    }
  }

  openPeerChannel() {
    if (
      !this.isConnected ||
      this.channel ||
      !("BroadcastChannel" in globalThis)
    ) {
      return;
    }
    try {
      this.channel = new BroadcastChannel("kin-household-events-v1");
      this.channel.addEventListener("message", this.onPeerMessage);
    } catch {
      this.channel = null;
    }
  }

  async appendCommand(command) {
    const result = await this.store.append(command, this.engine);
    this.state = result.state;
    this.snapshotBoundary = result.snapshotBoundary;
  }

  applyCatchUpSnapshot(snapshot) {
    const { asOf, civilDate } = projectionContext();
    const state = this.engine.applyEvents(
      snapshot.events.map((event) => event.encoded_event),
      asOf,
      snapshot.cursor.eventId,
      civilDate,
    );
    const throughEventId = state.summary.throughEventId;
    if (throughEventId !== (snapshot.through?.eventId ?? null)) {
      throw new Error(
        "Kin could not match its local catch-up snapshot boundary.",
      );
    }
    this.state = state;
    this.catchUpCursor = snapshot.cursor;
    this.snapshotBoundary = snapshot.through
      ? {
          eventId: snapshot.through.eventId,
          localSequence: snapshot.through.localSequence,
          snapshotThroughEventId: snapshot.through.eventId,
          snapshotThroughLocalSequence: snapshot.through.localSequence,
        }
      : null;
  }

  async handleCaughtUp() {
    if (this.busy || !this.store || !this.snapshotBoundary) return;
    const boundary = this.snapshotBoundary;
    const restoreCatchUpFocus = document.activeElement === this.catchUp.button;
    this.setBusy(true);
    this.clearAlert();
    this.setStatus("Saving catch-up state…");
    let committed = false;
    try {
      await this.store.markCaughtUpThrough(boundary);
      committed = true;
      // Peers must learn about the commit even if this tab cannot reload it.
      this.broadcastViewStateChange();
      const snapshot = await this.store.getCatchUpState();
      this.applyCatchUpSnapshot(snapshot);
      this.renderState();
      this.setStatus(
        this.state.summary.totalCount === 0
          ? "Caught up."
          : "Catch-up summary updated.",
      );
    } catch (error) {
      this.showAlert(
        committed
          ? "Your catch-up position was saved, but Kin could not refresh the summary. Try again to reload it."
          : error.userMessage ??
            "Kin could not update this browser's catch-up position. Your saved household information was not deleted.",
        committed ? this.retryRefresh : () => this.handleCaughtUp(),
      );
      this.setStatus("");
    } finally {
      this.setBusy(false);
      if (restoreCatchUpFocus) {
        (this.catchUp.button.hidden
          ? this.catchUp.heading
          : this.catchUp.button
        ).focus();
      }
      this.flushPeerRefresh();
    }
  }

  closePeerChannel() {
    this.channel?.removeEventListener("message", this.onPeerMessage);
    this.channel?.close();
    this.channel = null;
  }

  broadcastEventChange() {
    try {
      this.channel?.postMessage({ type: "events-changed" });
    } catch {
      // Cross-tab refresh is best-effort; IndexedDB remains authoritative.
    }
  }

  broadcastViewStateChange() {
    try {
      this.channel?.postMessage({ type: "view-state-changed" });
    } catch {
      // Cursor convergence is recovered from local IndexedDB on reload or focus.
    }
  }

  handlePeerMessage(event) {
    if (!["events-changed", "view-state-changed"].includes(event.data?.type)) {
      return;
    }
    if (this.busy || this.refreshing) {
      this.pendingRefresh = true;
      return;
    }
    this.refreshFromEvents();
  }

  async refreshFromEvents() {
    if (!this.store || !this.engine || this.busy || this.refreshing) {
      this.pendingRefresh = true;
      return;
    }
    this.refreshing = true;
    const focusedControl = this.contains(document.activeElement)
      ? document.activeElement
      : null;
    this.setBusy(true);
    // A failed refresh must not replace the command awaiting recovery.
    const previousFailure = this.suspendedRetry ?? {
      action: this.retryAction !== this.retryRefresh ? this.retryAction : null,
      intent: this.retryIntent,
      message: this.alert.textContent,
    };
    const previousRetry = previousFailure.action;
    const previousRetryIntent = previousFailure.intent;
    const previousAlert = previousFailure.message;
    const restoreComposeFocus = this.today.contains(document.activeElement);
    const restoreHandoffFocus = this.handoffs.lists.contains(
      document.activeElement,
    );
    const routineFocus = this.routines.captureFocus();
    const restoreTalkFocus = this.talks.lists.contains(document.activeElement);
    this.clearAlert();
    this.setStatus("Updating from another tab…");
    try {
      const snapshot = await this.store.getCatchUpState();
      this.applyCatchUpSnapshot(snapshot);
      this.renderState();
      this.setStatus("");
      if (previousRetry) {
        const handoff = previousRetryIntent?.handoffId
          ? this.state.handoffs.find(
              (record) => record.handoffId === previousRetryIntent.handoffId,
            )
          : null;
        const talk = previousRetryIntent?.talkId
          ? this.state.talks.find(
              (record) => record.talkId === previousRetryIntent.talkId,
            )
          : null;
        const routine = previousRetryIntent?.routineId ? this.state.routines.find(record => record.routineId === previousRetryIntent.routineId) : null;
        const item = previousRetryIntent?.routineId ? routine : previousRetryIntent?.talkId
          ? talk
          : previousRetryIntent?.handoffId
            ? handoff
            : previousRetryIntent
              ? this.state.items.find(
                  (stateItem) =>
                    stateItem.itemId === previousRetryIntent.itemId,
                )
              : null;
        if (previousRetryIntent && (!item || item.status === "archived" || (previousRetryIntent.occurrenceKey !== undefined && item.occurrenceKey !== previousRetryIntent.occurrenceKey))) {
          this.setStatus(
            previousRetryIntent.routineId ? "That period changed. Review the current routine." : previousRetryIntent.talkId
              ? "That topic changed. Review its current state."
              : previousRetryIntent.handoffId
                ? "That handoff changed. Review its current state."
                : "That item changed. Review its current state below.",
          );
        } else {
          this.showAlert(previousAlert, previousRetry, previousRetryIntent);
        }
      }
    } catch (error) {
      this.showAlert(
        error.userMessage ??
          "Kin could not refresh from local household storage. Your saved information was not deleted.",
        this.retryRefresh,
      );
      this.suspendedRetry = previousRetry ? previousFailure : null;
      this.setStatus("");
    } finally {
      this.refreshing = false;
      this.setBusy(false);
      if (focusedControl?.isConnected && !focusedControl.closest("[hidden]"))
        focusedControl.focus();
      else if (focusedControl && this.pulse.contains(focusedControl))
        this.pulse.focusInput();
      if (restoreHandoffFocus) this.handoffs.focusInput();
      this.routines.restoreFocus(routineFocus);
      if (restoreTalkFocus) this.talks.focusInput();
      if (restoreComposeFocus) {
        this.compose.focusInput();
      }
      this.flushPeerRefresh();
    }
  }

  flushPeerRefresh() {
    if (!this.pendingRefresh || this.busy || this.refreshing) {
      return;
    }
    this.pendingRefresh = false;
    queueMicrotask(() => this.refreshFromEvents());
  }

  renderState() {
    this.catchUp.summary = this.state.summary;
    this.catchUp.lastLookedAt = this.catchUpCursor?.lastLookedAt;
    this.today.items = this.state.items;
    this.handoffs.handoffs = this.state.handoffs;
    this.talks.talks = this.state.talks;
    this.pulse.pulse = this.state.pulses.find(
      (pulse) => pulse.actorId === this.store?.actorId,
    );
    this.routines.routines = this.state.routines ?? [];
    this.schedulePulseRefresh();
  }

  setBusy(isBusy) {
    this.busy = isBusy;
    this.main.setAttribute("aria-busy", String(isBusy));
    this.compose.disabled = isBusy || !this.store;
    this.today.disabled = isBusy || !this.store;
    this.handoffs.disabled = isBusy || !this.store;
    this.talks.disabled = isBusy || !this.store;
    this.pulse.disabled = isBusy || !this.store;
    this.catchUp.disabled = isBusy || !this.store;
    this.routines.disabled = isBusy || !this.store;
    this.retryButton.disabled = isBusy;
  }

  setStatus(message) {
    this.status.textContent = message;
  }

  clearAlert() {
    this.alert.textContent = "";
    this.alert.hidden = true;
    this.retryButton.hidden = true;
    this.retryAction = null;
    this.retryIntent = null;
    this.suspendedRetry = null;
  }

  showAlert(message, retryAction = null, retryIntent = null) {
    this.alert.textContent = message;
    this.alert.hidden = false;
    this.retryAction = retryAction;
    this.retryIntent = retryIntent;
    this.retryButton.hidden = typeof retryAction !== "function";
  }
}

customElements.define("kin-app", KinApp);
