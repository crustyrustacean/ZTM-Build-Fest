class KinToday extends HTMLElement {
  constructor() {
    super();
    this.records = [];
    this.isDisabled = false;
  }

  connectedCallback() {
    this.render();
  }

  set items(value) {
    this.records = Array.isArray(value) ? value : [];
    this.render();
  }

  set disabled(value) {
    this.isDisabled = Boolean(value);
    for (const item of this.querySelectorAll("kin-item")) {
      item.disabled = this.isDisabled;
    }
  }

  render() {
    const section = document.createElement("section");
    section.className = "today-section";
    const heading = document.createElement("h2");
    heading.textContent = "Today";
    section.append(heading);

    if (this.records.length === 0) {
      const empty = document.createElement("p");
      empty.className = "empty-state";
      empty.textContent = "Nothing here yet.";
      section.append(empty);
      this.replaceChildren(section);
      return;
    }

    const active = this.records.filter((record) => record.status === "active");
    const completed = this.records.filter(
      (record) => record.status === "completed",
    );
    if (active.length > 0) {
      section.append(this.createList(active));
    }
    if (completed.length > 0) {
      const completedHeading = document.createElement("h3");
      completedHeading.className = "completed-heading";
      completedHeading.textContent = "Completed";
      section.append(completedHeading, this.createList(completed));
    }
    this.replaceChildren(section);
  }

  createList(records) {
    const list = document.createElement("ul");
    list.className = "item-list";
    for (const record of records) {
      const listItem = document.createElement("li");
      const item = document.createElement("kin-item");
      item.item = record;
      item.disabled = this.isDisabled;
      listItem.append(item);
      list.append(listItem);
    }
    return list;
  }
}

customElements.define("kin-today", KinToday);
