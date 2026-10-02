import { loadKinEngine } from "../wasm/kin-engine.js";
import { EventStore } from "../storage/event-store.js";
import "./kin-compose.js";
import "./kin-item.js";
import "./kin-today.js";

const START_ERROR =
  "Kin could not start its household engine or local storage. Your saved information was not intentionally deleted.";
const SAVE_ERROR =
  "Kin could not save that change locally. Your existing information was not intentionally deleted.";

class KinApp extends HTMLElement {
  constructor() {
    super();
    this.engine = null;
    this.store = null;
    this.state = { items: [] };
    this.busy = false;
    this.starting = null;
    this.initialized = false;
    this.onAddItem = (event) => this.handleAddItem(event);
    this.onCompleteItem = (event) => this.handleCompleteItem(event);
  }

  connectedCallback() {
    if (!this.initialized) {
      this.initializeElements();
      this.initialized = true;
    }
    this.addEventListener("kin:add-item", this.onAddItem);
    this.addEventListener("kin:complete-item", this.onCompleteItem);
    this.initialize();
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
    this.today = document.createElement("kin-today");
    this.compose = document.createElement("kin-compose");
    main.append(this.today, this.compose);

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
    this.retryButton.addEventListener("click", () => this.initialize());
  }

  disconnectedCallback() {
    this.removeEventListener("kin:add-item", this.onAddItem);
    this.removeEventListener("kin:complete-item", this.onCompleteItem);
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
    this.setBusy(true);
    this.clearAlert();
    this.setStatus("Starting Kin…");
    try {
      this.store?.close();
      this.engine = await loadKinEngine();
      this.store = await EventStore.open();
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
      this.showAlert(error.userMessage ?? START_ERROR, true);
      this.setStatus("");
    } finally {
      this.setBusy(false);
    }
  }

  async handleAddItem(event) {
    if (this.busy || !this.store || !this.engine) {
      return;
    }
    this.setBusy(true);
    this.clearAlert();
    this.setStatus("Saving…");
    try {
      this.state = await this.store.append(
        { type: "add", text: event.detail.text },
        this.engine,
      );
      this.renderState();
      this.compose.clear();
      this.setStatus("Added.");
    } catch (error) {
      this.showAlert(error.userMessage ?? SAVE_ERROR);
      this.setStatus("");
    } finally {
      this.setBusy(false);
    }
  }

  async handleCompleteItem(event) {
    if (this.busy || !this.store || !this.engine) {
      return;
    }
    this.setBusy(true);
    this.clearAlert();
    this.setStatus("Saving…");
    try {
      this.state = await this.store.append(
        { type: "complete", itemId: event.detail.itemId },
        this.engine,
      );
      this.renderState();
      this.setStatus("Marked complete.");
    } catch (error) {
      this.showAlert(error.userMessage ?? SAVE_ERROR);
      this.setStatus("");
    } finally {
      this.setBusy(false);
    }
  }

  renderState() {
    this.today.items = this.state.items;
  }

  setBusy(isBusy) {
    this.busy = isBusy;
    this.compose.disabled = isBusy || !this.store;
    this.today.disabled = isBusy || !this.store;
  }

  setStatus(message) {
    this.status.textContent = message;
  }

  clearAlert() {
    this.alert.textContent = "";
    this.alert.hidden = true;
    this.retryButton.hidden = true;
  }

  showAlert(message, canRetry = false) {
    this.alert.textContent = message;
    this.alert.hidden = false;
    this.retryButton.hidden = !canRetry;
  }
}

customElements.define("kin-app", KinApp);
