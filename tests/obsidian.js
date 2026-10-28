import { createElement, icons } from "lucide";

export function installDom() {
  HTMLElement.prototype.createEl = function(tag, options = {}) {
    const el = this.ownerDocument.createElement(tag);
    if (options.cls) el.className = options.cls;
    if (options.text) el.textContent = options.text;
    for (const [name, value] of Object.entries(options.attr ?? {})) el.setAttribute(name, value);
    for (const name of ["type", "value"]) if (options[name] !== undefined) el[name] = options[name];
    this.append(el); return el;
  };
  HTMLElement.prototype.createDiv = function(options) { return this.createEl("div", options); };
  HTMLElement.prototype.createSpan = function(options) { return this.createEl("span", options); };
  HTMLElement.prototype.addClass = function(...names) { this.classList.add(...names); };
  HTMLElement.prototype.toggleClass = function(name, enabled) { this.classList.toggle(name, enabled); };
  HTMLElement.prototype.setText = function(text) { this.textContent = text; };
  HTMLElement.prototype.empty = function() { this.replaceChildren(); };
}
export const getLanguage = () => window.language ?? "zh";
export const normalizePath = path => path.replace(/\\/g, "/").replace(/\/{2,}/g, "/");
export function setIcon(el, name) {
  const key = name.split("-").map(word => word[0].toUpperCase() + word.slice(1)).join("");
  if (!icons[key]) throw new Error(`Unknown icon: ${name}`);
  el.append(createElement(icons[key]));
}
export class Component {
  cleanup = [];
  load() {}
  register(callback) { this.cleanup.push(callback); }
  registerDomEvent(el, name, callback, options) { el.addEventListener(name, callback, options); this.register(() => el.removeEventListener(name, callback, options)); }
  unload() { this.cleanup.splice(0).forEach(callback => callback()); }
}
export class Modal {
  constructor(app) {
    this.app = app;
    this.containerEl = document.createElement("div"); this.containerEl.className = "modal-container";
    this.modalEl = this.containerEl.createDiv({ cls: "modal" });
    this.titleEl = this.modalEl.createDiv({ cls: "modal-title" });
    this.contentEl = this.modalEl.createDiv({ cls: "modal-content" });
    this.containerEl.addEventListener("pointerdown", event => { if (event.target === this.containerEl) this.close(); });
    this.escape = event => { if (event.key === "Escape" && document.querySelector(".modal-container:last-child") === this.containerEl) { event.stopImmediatePropagation(); this.close(); } };
  }
  setTitle(value) { this.titleEl.textContent = value; }
  open() { document.body.append(this.containerEl); document.addEventListener("keydown", this.escape); this.onOpen?.(); }
  close() { this.onClose?.(); this.containerEl.remove(); document.removeEventListener("keydown", this.escape); }
}
export class Notice { constructor(message) { window.notices.push(message); } }
export class TFile {
  constructor(path) { this.path = path; }
  get name() { return this.path.split("/").pop(); }
  get extension() { return this.name.split(".").pop(); }
  get basename() { return this.name.slice(0, -this.extension.length - 1); }
  get parent() { return { path: this.path.includes("/") ? this.path.slice(0, this.path.lastIndexOf("/")) : "/" }; }
}
export class App {}
export class Plugin extends Component {
  constructor(app) { super(); this.app = app; }
  async loadData() { return window.pluginData; }
  async saveData(value) { window.pluginData = value; }
  registerEvent(event) { this.register(event); }
  registerInterval(id) { this.register(() => clearInterval(id)); }
  addCommand(command) { this.command = command; }
}
export class Menu {
  items = [];
  addItem(callback) { const item = { setTitle(title) { item.title = title; return item; }, setIcon() { return item; }, onClick(fn) { item.action = fn; return item; } }; callback(item); this.items.push(item); return this; }
  showAtMouseEvent(event) { return this.showAtPosition({ x: event.clientX, y: event.clientY }, event.target?.ownerDocument); }
  showAtPosition(position, doc) { this.shown = { position, doc, native: Menu.useNativeMenu }; return this; }
}

export function createApp() {
  const entries = new Map(); const listeners = new Map();
  const app = new App();
  const emit = (event, ...args) => (listeners.get(event) ?? []).forEach(fn => fn(...args));
  const on = (event, callback) => { const list = listeners.get(event) ?? []; list.push(callback); listeners.set(event, list); return () => { list.splice(list.indexOf(callback), 1); }; };
  app.vault = {
    fail: null, writes: 0,
    getAbstractFileByPath: path => entries.get(path)?.file ?? null,
    getFiles: () => [...entries.values()].map(entry => entry.file),
    async create(path, value) { return this.createBinary(path, new TextEncoder().encode(value).buffer); },
    async createBinary(path, bytes) {
      if (entries.has(path)) throw new Error("Path exists");
      if (this.fail === "createBinary" && path.endsWith(".png")) { this.fail = null; throw new Error("Injected image write failure"); }
      const file = new TFile(path); entries.set(path, { file, bytes: bytes.slice(0) }); this.writes++; return file;
    },
    async read(file) { return new TextDecoder().decode(await this.readBinary(file)); },
    async readBinary(file) { if (!entries.has(file.path)) throw new Error("File missing"); return entries.get(file.path).bytes.slice(0); },
    getResourcePath(file) { return `app://local/${encodeURIComponent(file.path)}`; },
    async modify(file, value) { return this.modifyBinary(file, new TextEncoder().encode(value).buffer); },
    async modifyBinary(file, bytes) {
      if (this.fail === "modifyBinary" && file.path.endsWith(".png")) { this.fail = null; throw new Error("Injected update failure"); }
      entries.get(file.path).bytes = bytes.slice(0); this.writes++;
    },
    async process(file, callback) { await this.modify(file, callback(await this.read(file))); },
    async trash(file) { entries.delete(file.path); },
    async rename(file, destination) { if (entries.has(destination)) throw new Error("Path exists"); const old = file.path, entry = entries.get(old); entries.delete(old); file.path = destination; entries.set(destination, entry); emit("rename", file, old); },
    on
  };
  app.fileManager = { trashFile: file => app.vault.trash(file) };
app.workspace = { trigger: emit, getActiveFile: () => app.activeFile ?? null, getLeavesOfType: () => [], on };
  app.metadataCache = {
    fileToLinktext: file => file.path,
    getFirstLinkpathDest(link) {
      let clean = link; try { clean = decodeURIComponent(link); } catch {}
      return entries.get(clean)?.file ?? [...entries.values()].find(entry => entry.file.name === clean)?.file ?? null;
    },
    getFileCache(note) {
      const raw = new TextDecoder().decode(entries.get(note.path)?.bytes ?? new Uint8Array());
      return { embeds: [...raw.matchAll(/!\[\[([^\]|]+)(?:\|[^\]]*)?\]\]|!\[[^\]]*\]\(([^\s)]+)\)/g)].map(match => ({
        link: match[1] ?? match[2], original: match[0], position: { start: { offset: match.index, line: raw.slice(0, match.index).split("\n").length - 1 }, end: { offset: match.index + match[0].length } }
      })) };
    }
  };
  return app;
}
