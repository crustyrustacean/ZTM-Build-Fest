class KinItem extends HTMLElement {
  constructor() {
    super();
    this.record = null;
    this.isDisabled = false;
  }

  set item(value) {
    this.record = value;
    this.render();
  }

  set disabled(value) {
    this.isDisabled = Boolean(value);
    const control = this.querySelector("button");
    if (control) {
      control.disabled = this.isDisabled;
    }
  }

  render() {
    if (!this.record) {
      return;
    }
    const row = document.createElement("div");
    row.className = `item-row item-${this.record.status}`;
    const text = document.createElement("p");
    text.className = "item-text";
    text.textContent = this.record.text;
    const action = document.createElement("div");
    action.className = "item-action";

    if (this.record.status === "active") {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "complete-button";
      button.textContent = "Complete";
      button.disabled = this.isDisabled;
      button.addEventListener("click", () => {
        this.dispatchEvent(
          new CustomEvent("kin:complete-item", {
            detail: { itemId: this.record.itemId },
            bubbles: true,
            composed: true,
            cancelable: false,
          }),
        );
      });
      action.append(button);
    } else {
      const completed = document.createElement("span");
      completed.className = "completed-label";
      completed.textContent = "Completed";
      action.append(completed);
    }

    row.append(text, action);
    this.replaceChildren(row);
  }
}

customElements.define("kin-item", KinItem);
