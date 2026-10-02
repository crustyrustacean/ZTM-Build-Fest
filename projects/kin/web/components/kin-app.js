import { loadKinEngine } from "../wasm/kin-engine.js";
import { EventStore } from "../storage/event-store.js";
import "./kin-compose.js";
import "./kin-item.js";
import "./kin-today.js";
import "./kin-handoff-list.js";
import "./kin-talk-list.js";

const START_ERROR =
  "Kin could not start its household engine or local storage. Your saved information was not intentionally deleted.";
const SAVE_ERROR =
  "Kin could not save that change locally. Your existing information was not intentionally deleted.";

class KinApp extends HTMLElement {
  constructor() {
    super();
    this.engine = null;
    this.store = null;
    this.state = { items: [], handoffs: [], talks: [] };
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
    this.onAddHandoff = event => this.handleAddHandoff(event);
    this.onAcknowledgeHandoff = event => this.handleHandoffAction("acknowledge-handoff", event.detail.handoffId);
    this.onArchiveHandoff = event => this.handleHandoffAction("archive-handoff", event.detail.handoffId);
    this.onAddTalk = event => this.saveTalk({ type: "add-talk", text: event.detail.text });
    this.onResolveTalk = event => this.saveTalk({ type: "resolve-talk", talkId: event.detail.talkId });
    this.onReopenTalk = event => this.saveTalk({ type: "reopen-talk", talkId: event.detail.talkId });
    this.onArchiveTalk = event => this.saveTalk({ type: "archive-talk", talkId: event.detail.talkId });
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
    this.today = document.createElement("kin-today");
    this.compose = document.createElement("kin-compose");
    this.handoffs = document.createElement("kin-handoff-list");
    this.talks = document.createElement("kin-talk-list");
    main.append(this.today, this.compose, this.handoffs, this.talks);

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
    this.removeEventListener("kin:acknowledge-handoff", this.onAcknowledgeHandoff);
    this.removeEventListener("kin:archive-handoff", this.onArchiveHandoff);
    this.removeEventListener("kin:add-talk", this.onAddTalk);
    this.removeEventListener("kin:resolve-talk", this.onResolveTalk);
    this.removeEventListener("kin:reopen-talk", this.onReopenTalk);
    this.removeEventListener("kin:archive-talk", this.onArchiveTalk);
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
      const events = await this.store.loadEvents();
      this.state = this.engine.applyEvents(
        events.map((event) => event.encoded_event),
      );
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
      this.state = await this.store.append(
        { type: "add", ...submittedDraft },
        this.engine,
      );
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
      this.state = await this.store.append(submitted, this.engine);
      this.renderState();
      if (submitted.type === "add-handoff") this.handoffs.clearIfMatches(submitted);
      this.setStatus(submitted.type === "add-handoff" ? "Handoff added." :
        submitted.type === "acknowledge-handoff" ? "Acknowledged." : "Handoff archived.");
      this.broadcastEventChange();
    } catch (error) {
      if (error.code === 4 && submitted.handoffId) this.pendingRefresh = true;
      this.showAlert(error.userMessage ?? SAVE_ERROR, () => this.saveHandoff(submitted),
        submitted.handoffId ? submitted : null);
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
      this.state = await this.store.append(submitted, this.engine);
      this.renderState();
      if (submitted.type === "add-talk") this.talks.clearIfMatches(submitted);
      this.setStatus(submitted.type === "add-talk" ? "Talk added." :
        submitted.type === "resolve-talk" ? "Resolved." :
        submitted.type === "reopen-talk" ? "Reopened." : "Talk archived.");
      this.broadcastEventChange();
    } catch (error) {
      if (error.code === 4 && submitted.talkId) this.pendingRefresh = true;
      this.showAlert(error.userMessage ?? SAVE_ERROR, () => this.saveTalk(submitted),
        submitted.talkId ? submitted : null);
      this.setStatus("");
    } finally {
      this.setBusy(false);
      this.talks.focusInput();
      this.flushPeerRefresh();
    }
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
      this.state = await this.store.append(
        { type, itemId: submittedItemId },
        this.engine,
      );
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

  handlePeerMessage(event) {
    if (event.data?.type !== "events-changed") {
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
    const restoreHandoffFocus = this.handoffs.lists.contains(document.activeElement);
    const restoreTalkFocus = this.talks.lists.contains(document.activeElement);
    this.clearAlert();
    this.setStatus("Updating from another tab…");
    try {
      const events = await this.store.loadEvents();
      this.state = this.engine.applyEvents(
        events.map((storedEvent) => storedEvent.encoded_event),
      );
      this.renderState();
      this.setStatus("Updated from another tab.");
      if (previousRetry) {
        const handoff = previousRetryIntent?.handoffId
          ? this.state.handoffs.find(record => record.handoffId === previousRetryIntent.handoffId) : null;
        const talk = previousRetryIntent?.talkId
          ? this.state.talks.find(record => record.talkId === previousRetryIntent.talkId) : null;
        const item = previousRetryIntent?.talkId ? talk : previousRetryIntent?.handoffId ? handoff : previousRetryIntent
          ? this.state.items.find(
              (stateItem) => stateItem.itemId === previousRetryIntent.itemId,
            )
          : null;
        if (previousRetryIntent && (!item || item.status === "archived")) {
          this.setStatus(previousRetryIntent.talkId ? "That topic changed. Review its current state." : previousRetryIntent.handoffId ? "That handoff changed. Review its current state." : "That item changed. Review its current state below.");
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
      if (restoreHandoffFocus) this.handoffs.focusInput();
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
    this.today.items = this.state.items;
    this.handoffs.handoffs = this.state.handoffs;
    this.talks.talks = this.state.talks;
  }

  setBusy(isBusy) {
    this.busy = isBusy;
    this.main.setAttribute("aria-busy", String(isBusy));
    this.compose.disabled = isBusy || !this.store;
    this.today.disabled = isBusy || !this.store;
    this.handoffs.disabled = isBusy || !this.store;
    this.talks.disabled = isBusy || !this.store;
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
