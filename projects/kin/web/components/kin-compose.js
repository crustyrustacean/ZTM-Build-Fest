const MAX_ITEM_TEXT_BYTES = 4096;
const textEncoder = new TextEncoder();

class KinCompose extends HTMLElement {
  constructor() {
    super();
    this.isDisabled = false;
    this.initialized = false;
  }

  connectedCallback() {
    if (this.initialized) {
      return;
    }
    this.initialized = true;
    this.form = document.createElement("form");
    this.form.className = "compose-form";
    this.label = document.createElement("label");
    this.label.htmlFor = "item-text";
    this.label.textContent = "What should we remember?";
    this.input = document.createElement("input");
    this.input.id = "item-text";
    this.input.name = "item";
    this.input.type = "text";
    this.input.autocomplete = "off";
    this.input.maxLength = MAX_ITEM_TEXT_BYTES;
    this.input.required = true;
    this.input.setAttribute("aria-describedby", "compose-message");
    this.button = document.createElement("button");
    this.button.className = "add-button";
    this.button.type = "submit";
    this.button.textContent = "Add";
    this.message = document.createElement("p");
    this.message.id = "compose-message";
    this.message.className = "compose-message";
    this.message.setAttribute("aria-live", "polite");
    this.form.append(this.label, this.input, this.button, this.message);
    this.replaceChildren(this.form);
    this.form.addEventListener("submit", (event) => this.submit(event));
  }

  set disabled(value) {
    this.isDisabled = Boolean(value);
    this.input.disabled = this.isDisabled;
    this.button.disabled = this.isDisabled;
  }

  clear() {
    this.input.value = "";
    this.message.textContent = "";
  }

  submit(event) {
    event.preventDefault();
    if (this.isDisabled) {
      return;
    }
    const text = this.input.value;
    const textLength = textEncoder.encode(text).length;
    if (!text.trim()) {
      this.message.textContent = "Add a few words first.";
      this.input.focus();
      return;
    }
    if (textLength > MAX_ITEM_TEXT_BYTES) {
      this.message.textContent = "Keep the item under 4096 UTF-8 bytes.";
      this.input.focus();
      return;
    }
    this.message.textContent = "";
    this.dispatchEvent(
      new CustomEvent("kin:add-item", {
        detail: { text },
        bubbles: true,
        composed: true,
        cancelable: false,
      }),
    );
  }
}

customElements.define("kin-compose", KinCompose);
