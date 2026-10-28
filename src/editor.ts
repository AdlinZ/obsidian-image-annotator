import { App, Component, Modal, Notice, TFile, normalizePath } from "obsidian";
import { bounds, clamp, clone, defaults, drawItem, hitTest, Item, moveItem, Point, Preferences, Tool } from "./model";
import { hash, imageData, readDocument, SIDECAR, writeDocument } from "./storage";
import { chooseEmbeds, EmbedContext, EmbedReference, replaceEmbeds } from "./embeds";
import { confirmDiscard, iconButton, promptValue, tr } from "./ui";

export interface EditorHost {
  preferences: Preferences;
  remember(value: Preferences): void;
  savingPaths: Set<string>;
  refreshMarkdownImages(note: TFile, source: TFile, target: TFile, outputHash: string, refs: EmbedReference[]): void;
}

export class ImageAnnotatorModal extends Modal {
  private events = new Component();
  private canvas!: HTMLCanvasElement;
  private ctx!: CanvasRenderingContext2D;
  private stage!: HTMLElement;
  private wrap!: HTMLElement;
  private toolbar!: HTMLElement;
  private status!: HTMLElement;
  private zoomLabel!: HTMLElement;
  private colorInput!: HTMLInputElement;
  private widthInput!: HTMLInputElement;
  private sizeInput!: HTMLInputElement;
  private undoButton!: HTMLButtonElement;
  private redoButton!: HTMLButtonElement;
  private deleteButton!: HTMLButtonElement;
  private editButton!: HTMLButtonElement;
  private saveButton!: HTMLButtonElement;
  private copyButton!: HTMLButtonElement;
  private panButton!: HTMLButtonElement;
  private image!: HTMLImageElement;
  private baseImage = "";
  private sourcePath = "";
  private originalHash = "";
  private initialPath = "";
  private items: Item[] = [];
  private past: Item[][] = [];
  private future: Item[][] = [];
  private savedState = "[]";
  private selected = -1;
  private tool: Tool = "rect";
  private prefs: Preferences = { ...defaults };
  private zoom = 1;
  private fitted = true;
  private ready = false;
  private busy = false;
  private closed = false;
  private closing = false;
  private prompting = false;
  private spaceDown = false;
  private panMode = false;
  private draft: Item | null = null;
  private drag: { kind: "draw" | "move" | "resize" | "pan"; start: Point; before: Item[]; scrollX: number; scrollY: number; pointer: number } | null = null;

  constructor(app: App, private file: TFile, private embedContext: EmbedContext | null, private host: EditorHost) {
    super(app);
    this.prefs = { ...host.preferences };
    this.initialPath = file.path;
  }

  onOpen(): void {
    this.events.load();
    this.modalEl.addClass("vf-image-annotator-modal");
    this.setTitle(this.file.name);
    const shell = this.contentEl.createDiv({ cls: "vf-ia-shell" });
    this.toolbar = shell.createDiv({ cls: "vf-ia-toolbar", attr: { "aria-label": tr("标注工具", "Annotation tools") } });
    this.buildToolbar();
    this.stage = shell.createDiv({ cls: "vf-ia-stage", attr: { tabindex: "0", "aria-label": tr("图片画布", "Image canvas") } });
    const surface = this.stage.createDiv({ cls: "vf-ia-surface" });
    this.wrap = surface.createDiv({ cls: "vf-ia-canvas-wrap" });
    this.canvas = this.wrap.createEl("canvas");
    this.canvas.setAttribute("aria-label", tr("标注画布", "Annotation canvas"));
    this.ctx = this.canvas.getContext("2d")!;
    const footer = shell.createDiv({ cls: "vf-ia-footer" });
    this.status = footer.createDiv({ cls: "vf-ia-status", attr: { role: "status" } });
    this.status.setText(tr("正在加载图片…", "Loading image…"));
    this.events.registerDomEvent(this.stage, "pointerdown", this.pointerDown);
    this.events.registerDomEvent(this.stage, "pointermove", this.pointerMove);
    this.events.registerDomEvent(this.stage, "pointerup", () => this.endDrag(false));
    this.events.registerDomEvent(this.stage, "pointercancel", () => this.endDrag(true));
    this.events.registerDomEvent(this.canvas, "dblclick", () => { if (this.tool === "select") void this.editSelected(); });
    this.events.registerDomEvent(this.modalEl, "keydown", this.keyDown);
    this.events.registerDomEvent(this.modalEl.ownerDocument, "keyup", event => { if (event.code === "Space") this.setPan(false); });
    this.events.registerDomEvent(this.modalEl.ownerDocument.defaultView!, "blur", () => { this.setPan(false); this.endDrag(true); });
    this.events.registerDomEvent(this.stage, "wheel", event => {
      if (!(event.ctrlKey || event.metaKey) || !this.ready) return;
      event.preventDefault();
      this.setZoom(this.zoom * (event.deltaY < 0 ? 1.1 : 1 / 1.1), { x: event.clientX, y: event.clientY });
    }, { passive: false });
    const observer = new ResizeObserver(() => { if (this.ready && this.fitted) this.fit(); });
    observer.observe(this.stage);
    this.events.register(() => observer.disconnect());
    this.refresh();
    void this.load().catch(error => {
      if (this.closed) return;
      console.error("Image Annotator Plus: load failed", error);
      new Notice(tr("无法打开标注数据：图片或标注文件已变化或损坏。原文件保持不变。", "Could not open annotations: the image or annotation file changed or is invalid. Original files are unchanged."));
      this.closed = true;
      super.close();
    });
  }

  close(): void {
    if (this.closed) return;
    if (this.busy || this.prompting || this.closing) return;
    this.endDrag(true);
    if (this.dirty()) {
      this.closing = true;
      void confirmDiscard(this.app).then(discard => {
        this.closing = false;
        if (discard) { this.closed = true; super.close(); }
      });
    } else { this.closed = true; super.close(); }
  }

  onClose(): void { this.closed = true; this.events.unload(); this.contentEl.empty(); }

  private async load(): Promise<void> {
    const bytes = await this.app.vault.readBinary(this.file);
    this.originalHash = await hash(bytes);
    const document = await readDocument(this.app, this.file, bytes);
    if (this.closed) return;
    this.image = new Image();
    await new Promise<void>((resolve, reject) => {
      this.image.onload = () => resolve();
      this.image.onerror = () => reject(new Error("Image decode failed"));
      this.image.src = document?.baseImage ?? imageData(bytes, this.file.extension);
    });
    if (this.closed) return;
    if (!this.image.naturalWidth || !this.image.naturalHeight) throw new Error("Empty image");
    this.canvas.width = this.image.naturalWidth;
    this.canvas.height = this.image.naturalHeight;
    // Rasterize animated inputs once so every subsequent edit uses the same frame.
    this.ctx.drawImage(this.image, 0, 0);
    this.baseImage = document?.baseImage ?? this.canvas.toDataURL("image/png");
    if (!document) {
      await new Promise<void>((resolve, reject) => {
        this.image.onload = () => resolve();
        this.image.onerror = () => reject(new Error("Snapshot decode failed"));
        this.image.src = this.baseImage;
      });
    }
    if (this.closed) return;
    this.sourcePath = document?.sourcePath ?? this.file.path;
    this.items = document ? clone(document.items) : [];
    this.savedState = JSON.stringify(this.items);
    this.ready = true;
    this.fit();
    this.refresh();
    this.stage.focus();
  }

  private buildToolbar(): void {
    const tools: Array<[Tool, string, string]> = [
      ["select", "mouse-pointer-2", tr("选择", "Select")], ["rect", "square", tr("矩形", "Rectangle")],
      ["line", "minus", tr("直线", "Line")],
      ["arrow", "arrow-up-right", tr("箭头", "Arrow")], ["pen", "pencil", tr("画笔", "Pen")],
      ["text", "type", tr("文字", "Text")], ["number", "list-ordered", tr("编号", "Number")],
      ["redact", "square-dashed-bottom-code", tr("实心遮挡", "Solid redaction")], ["highlight", "highlighter", tr("高亮", "Highlight")]
    ];
    const group = this.toolbar.createDiv({ cls: "vf-ia-tool-group" });
    for (const [tool, icon, title] of tools) {
      const button = iconButton(group, icon, title, () => {
        if (!this.ready || this.busy) return;
        this.endDrag(true); this.panMode = false; this.setPan(false); this.tool = tool; this.selected = -1; this.refresh(); this.stage.focus();
      });
      button.dataset.tool = tool;
    }
    const settings = this.toolbar.createDiv({ cls: "vf-ia-settings-group" });
    for (const color of ["#e11d48", "#facc15", "#16a34a", "#2563eb", "#111111", "#ffffff"]) {
      const swatch = settings.createEl("button", { cls: "vf-ia-swatch", attr: { type: "button", title: color, "aria-label": color } });
      swatch.style.setProperty("--swatch", color);
      swatch.dataset.color = color;
      swatch.addEventListener("click", () => this.changeStyle({ color }));
    }
    this.colorInput = settings.createEl("input", { type: "color", attr: { title: tr("自定义颜色", "Custom color"), "aria-label": tr("自定义颜色", "Custom color") } });
    this.colorInput.addEventListener("change", () => this.changeStyle({ color: this.colorInput.value }));
    const numeric = (title: string, min: number, max: number, key: "width" | "size"): HTMLInputElement => {
      const label = settings.createEl("label", { cls: "vf-ia-field" });
      label.createSpan({ text: title });
      const input = label.createEl("input", { type: "number", attr: { min: String(min), max: String(max), step: "1", "aria-label": title } });
      input.addEventListener("change", () => this.changeStyle({ [key]: clamp(Number(input.value) || this.prefs[key], min, max) }));
      return input;
    };
    this.widthInput = numeric(tr("线宽", "Width"), 1, 30, "width");
    this.sizeInput = numeric(tr("字号", "Size"), 10, 160, "size");
    const actions = this.toolbar.createDiv({ cls: "vf-ia-actions" });
    this.editButton = iconButton(actions, "file-pen-line", tr("编辑内容", "Edit content"), () => void this.editSelected());
    this.deleteButton = iconButton(actions, "trash-2", tr("删除标注", "Delete annotation"), () => this.removeSelected());
    this.undoButton = iconButton(actions, "undo-2", tr("撤销", "Undo"), () => this.undo());
    this.redoButton = iconButton(actions, "redo-2", tr("重做", "Redo"), () => this.redo());
    const zoomControls = this.toolbar.createDiv({ cls: "vf-ia-zoom-controls" });
    iconButton(zoomControls, "zoom-out", tr("缩小", "Zoom out"), () => this.setZoom(this.zoom / 1.25));
    this.zoomLabel = zoomControls.createSpan({ cls: "vf-ia-zoom-label" });
    iconButton(zoomControls, "zoom-in", tr("放大", "Zoom in"), () => this.setZoom(this.zoom * 1.25));
    iconButton(zoomControls, "scan", tr("适应窗口", "Fit to window"), () => this.fit());
    iconButton(zoomControls, "scan-search", tr("原始大小", "Actual size"), () => this.setZoom(1));
    this.panButton = iconButton(zoomControls, "hand", tr("拖动画布", "Pan canvas"), () => {
      if (!this.ready || this.busy || this.drag) return;
      this.panMode = !this.panMode; this.setPan(false); this.stage.focus();
    });
    const output = this.toolbar.createDiv({ cls: "vf-ia-output" });
    this.copyButton = iconButton(output, "copy", tr("复制图片", "Copy image"), () => this.copy());
    this.saveButton = iconButton(output, "save", tr("保存 PNG", "Save PNG"), () => void this.save());
    this.saveButton.addClass("mod-cta");
  }

  private changeStyle(value: Partial<Preferences>): void {
    if (!this.ready || this.busy || this.drag) return;
    this.prefs = { ...this.prefs, ...value };
    const item = this.items[this.selected];
    if (item) {
      const before = clone(this.items);
      this.items[this.selected] = { ...item, ...value };
      this.commit(before);
    }
    this.host.remember({ ...this.prefs });
    this.refresh();
  }

  private fit(): void {
    if (!this.ready) return;
    this.setZoom(Math.min(1, (this.stage.clientWidth - 32) / this.canvas.width, (this.stage.clientHeight - 32) / this.canvas.height));
    this.fitted = true;
  }

  private setZoom(value: number, anchor?: Point): void {
    if (!this.ready || this.drag) return;
    const rect = this.canvas.getBoundingClientRect();
    const stageRect = this.stage.getBoundingClientRect();
    const center = anchor ?? { x: stageRect.left + this.stage.clientWidth / 2, y: stageRect.top + this.stage.clientHeight / 2 };
    const pixel = { x: (center.x - rect.left) / this.zoom, y: (center.y - rect.top) / this.zoom };
    this.zoom = clamp(value, 0.01, 8);
    this.fitted = false;
    this.wrap.style.setProperty("--canvas-width", `${this.canvas.width * this.zoom}px`);
    this.wrap.style.setProperty("--canvas-height", `${this.canvas.height * this.zoom}px`);
    this.zoomLabel.setText(`${Math.round(this.zoom * 100)}%`);
    const after = this.canvas.getBoundingClientRect();
    this.stage.scrollLeft += after.left + pixel.x * this.zoom - center.x;
    this.stage.scrollTop += after.top + pixel.y * this.zoom - center.y;
    this.draw();
  }

  private point(event: PointerEvent): Point {
    const rect = this.canvas.getBoundingClientRect();
    return { x: clamp((event.clientX - rect.left) / this.zoom, 0, this.canvas.width), y: clamp((event.clientY - rect.top) / this.zoom, 0, this.canvas.height) };
  }

  /** Snap a Shift-drawn line or arrow to the nearest 45-degree increment. */
  private constrainLinePoint(start: Point, end: Point): Point {
    const dx = end.x - start.x, dy = end.y - start.y;
    const length = Math.hypot(dx, dy);
    if (!length) return end;
    const increment = Math.PI / 4;
    const angle = Math.round(Math.atan2(dy, dx) / increment) * increment;
    return { x: start.x + length * Math.cos(angle), y: start.y + length * Math.sin(angle) };
  }

  private pointerDown = (event: PointerEvent): void => {
    if (!this.ready || this.busy || this.prompting || this.drag || event.button !== 0 && event.button !== 1) return;
    if (event.target !== this.canvas && !this.spaceDown && !this.panMode && event.button !== 1) return;
    event.preventDefault();
    this.stage.focus();
    const p = this.point(event), before = clone(this.items);
    const begin = (kind: "draw" | "move" | "resize" | "pan"): void => {
      this.drag = { kind, start: kind === "pan" ? { x: event.clientX, y: event.clientY } : p, before, scrollX: this.stage.scrollLeft, scrollY: this.stage.scrollTop, pointer: event.pointerId };
      this.stage.setPointerCapture(event.pointerId);
    };
    if (this.spaceDown || this.panMode || event.button === 1) { begin("pan"); return; }
    if (this.tool === "select") {
      const selected = this.items[this.selected];
      if (selected) {
        const b = bounds(selected, this.ctx);
        if (Math.hypot(p.x - b.x - b.w, p.y - b.y - b.h) < 12 / this.zoom) { begin("resize"); return; }
      }
      this.selected = -1;
      for (let i = this.items.length - 1; i >= 0; i--) if (hitTest(this.items[i], p, this.ctx, 7 / this.zoom)) { this.selected = i; break; }
      if (this.selected >= 0) begin("move");
      this.refresh();
      return;
    }
    if (this.tool === "text") { void this.addText(p); return; }
    const item: Item = { type: this.tool, ...this.prefs, points: [p, { ...p }] };
    if (this.tool === "number") {
      item.points = [p];
      item.number = Math.min(9999, Math.max(0, ...this.items.filter(i => i.type === "number").map(i => i.number ?? 0)) + 1);
      this.items.push(item); this.commit(before); this.refresh(); return;
    }
    if (this.tool === "pen") item.points = [p];
    this.draft = item;
    begin("draw");
    this.draw();
  };

  private pointerMove = (event: PointerEvent): void => {
    const drag = this.drag;
    if (!drag || drag.pointer !== event.pointerId) return;
    const p = this.point(event);
    if (drag.kind === "pan") {
      this.stage.scrollLeft = drag.scrollX - event.clientX + drag.start.x;
      this.stage.scrollTop = drag.scrollY - event.clientY + drag.start.y;
    } else if (drag.kind === "draw" && this.draft) {
      if (this.draft.type === "pen") {
        const previous = this.draft.points[this.draft.points.length - 1];
        if (Math.hypot(p.x - previous.x, p.y - previous.y) > 0.7 / this.zoom && this.draft.points.length < 100000) this.draft.points.push(p);
      } else if (["line", "arrow"].includes(this.draft.type) && event.shiftKey) {
        this.draft.points[1] = this.constrainLinePoint(this.draft.points[0], p);
      } else this.draft.points[1] = p;
    } else if (drag.kind === "move") {
      this.items[this.selected] = moveItem(drag.before[this.selected], p.x - drag.start.x, p.y - drag.start.y);
    } else if (drag.kind === "resize") {
      const item = drag.before[this.selected], b = bounds(item, this.ctx);
      const sx = Math.max(0.1, (p.x - b.x) / Math.max(1, b.w)), sy = Math.max(0.1, (p.y - b.y) / Math.max(1, b.h));
      if (item.type === "text" || item.type === "number") {
        const size = clamp(item.size * Math.max(sx, sy), 10, 160), ratio = size / item.size;
        this.items[this.selected] = { ...item, size, points: item.points.map(point => ({ x: b.x + (point.x - b.x) * ratio, y: b.y + (point.y - b.y) * ratio })) };
      } else this.items[this.selected] = { ...item, points: item.points.map(point => ({ x: b.x + (point.x - b.x) * sx, y: b.y + (point.y - b.y) * sy })) };
    }
    this.draw();
  };

  private endDrag(cancel: boolean): void {
    const drag = this.drag;
    if (!drag) return;
    this.drag = null;
    if (this.stage.hasPointerCapture(drag.pointer)) this.stage.releasePointerCapture(drag.pointer);
    if (cancel) this.items = drag.before;
    else if (this.draft) {
      const first = this.draft.points[0], last = this.draft.points[this.draft.points.length - 1];
      const valid = this.draft.type === "pen" ? this.draft.points.length > 1 : ["line", "arrow"].includes(this.draft.type) ? Math.hypot(last.x - first.x, last.y - first.y) > 2 : Math.abs(last.x - first.x) > 2 && Math.abs(last.y - first.y) > 2;
      if (valid) this.items.push(this.draft);
    }
    this.draft = null;
    if (!cancel && drag.kind !== "pan") this.commit(drag.before);
    this.refresh();
  }

  private async addText(p: Point): Promise<void> {
    this.prompting = true;
    const value = await promptValue(this.app);
    this.prompting = false;
    if (this.closed || value === null) return;
    const before = clone(this.items);
    this.items.push({ type: "text", ...this.prefs, points: [p], text: value });
    this.commit(before); this.refresh();
  }

  private async editSelected(): Promise<void> {
    const item = this.items[this.selected];
    if (!item || this.busy || this.drag || this.prompting || !["text", "number"].includes(item.type)) return;
    this.prompting = true;
    const value = await promptValue(this.app, item.type === "text" ? item.text : String(item.number), item.type === "number");
    this.prompting = false;
    if (this.closed || value === null) return;
    const before = clone(this.items);
    if (item.type === "text") item.text = value;
    else item.number = Number(value);
    this.commit(before); this.refresh();
  }

  private removeSelected(): void {
    if (this.selected < 0 || this.busy || this.drag) return;
    const before = clone(this.items);
    this.items.splice(this.selected, 1); this.selected = -1; this.commit(before); this.refresh();
  }
  private commit(before: Item[]): void {
    if (JSON.stringify(before) === JSON.stringify(this.items)) return;
    this.past.push(before); if (this.past.length > 100) this.past.shift(); this.future = [];
  }
  private undo(): void {
    if (!this.past.length || this.busy || this.drag) return;
    this.future.push(clone(this.items)); this.items = this.past.pop()!; this.selected = -1; this.refresh();
  }
  private redo(): void {
    if (!this.future.length || this.busy || this.drag) return;
    this.past.push(clone(this.items)); this.items = this.future.pop()!; this.selected = -1; this.refresh();
  }
  private dirty(): boolean { return JSON.stringify(this.items) !== this.savedState; }
  private setPan(value: boolean): void {
    this.spaceDown = value; this.stage.toggleClass("is-panning", value || this.panMode);
    this.panButton.setAttribute("aria-pressed", String(this.panMode)); this.panButton.toggleClass("is-active", this.panMode);
  }

  private keyDown = (event: KeyboardEvent): void => {
    const target = event.target as HTMLElement;
    if (target.closest("input, textarea, select, [contenteditable=true]")) return;
    if (event.code === "Space") { event.preventDefault(); this.setPan(true); return; }
    if (this.busy || this.prompting) return;
    const mod = event.ctrlKey || event.metaKey, key = event.key.toLowerCase();
    if (mod && key === "z") { event.preventDefault(); event.stopPropagation(); if (event.shiftKey) this.redo(); else this.undo(); }
    else if (mod && key === "y") { event.preventDefault(); this.redo(); }
    else if (mod && key === "s") { event.preventDefault(); void this.save(); }
    else if (key === "delete" || key === "backspace") { event.preventDefault(); this.removeSelected(); }
  };

  private draw(): void {
    if (!this.ready) return;
    this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
    this.ctx.drawImage(this.image, 0, 0);
    for (const item of this.items) drawItem(this.ctx, item);
    if (this.draft) drawItem(this.ctx, this.draft);
    const selected = this.items[this.selected];
    if (selected) {
      const b = bounds(selected, this.ctx), handle = 8 / this.zoom;
      this.ctx.save(); this.ctx.strokeStyle = "#0891b2"; this.ctx.lineWidth = 1.5 / this.zoom;
      this.ctx.setLineDash([5 / this.zoom, 3 / this.zoom]); this.ctx.strokeRect(b.x, b.y, b.w, b.h);
      this.ctx.setLineDash([]); this.ctx.fillStyle = "#ffffff";
      this.ctx.fillRect(b.x + b.w - handle / 2, b.y + b.h - handle / 2, handle, handle);
      this.ctx.strokeRect(b.x + b.w - handle / 2, b.y + b.h - handle / 2, handle, handle); this.ctx.restore();
    }
  }

  private refresh(): void {
    const item = this.items[this.selected], style = item ?? this.prefs;
    this.toolbar.querySelectorAll<HTMLButtonElement>("button[data-tool]").forEach(button => {
      button.toggleClass("is-active", button.dataset.tool === this.tool);
      button.setAttribute("aria-pressed", String(button.dataset.tool === this.tool));
    });
    this.toolbar.querySelectorAll<HTMLButtonElement>("button[data-color]").forEach(button => button.setAttribute("aria-pressed", String(button.dataset.color === style.color)));
    this.colorInput.value = style.color; this.widthInput.value = String(style.width); this.sizeInput.value = String(Math.round(style.size));
    this.toolbar.querySelectorAll<HTMLButtonElement | HTMLInputElement>("button, input").forEach(control => { control.disabled = !this.ready || this.busy; });
    this.undoButton.disabled ||= !this.past.length; this.redoButton.disabled ||= !this.future.length;
    this.deleteButton.disabled ||= !item; this.editButton.disabled ||= !item || !["text", "number"].includes(item.type);
    this.copyButton.disabled ||= !navigator.clipboard?.write || typeof ClipboardItem === "undefined";
    this.canvas?.toggleClass("vf-ia-crosshair", this.tool !== "select");
    if (this.ready) this.status.setText(`${this.canvas.width} × ${this.canvas.height} · ${this.items.length} ${tr("个标注", "annotations")}${this.dirty() ? tr(" · 未保存", " · Unsaved") : ""}${this.busy ? tr(" · 正在处理…", " · Working…") : ""}`);
    this.draw();
  }

  private png(): Promise<Blob> {
    const canvas = this.canvas.cloneNode(false) as HTMLCanvasElement;
    canvas.width = this.canvas.width; canvas.height = this.canvas.height;
    const ctx = canvas.getContext("2d")!;
    ctx.drawImage(this.image, 0, 0); this.items.forEach(item => drawItem(ctx, item));
    return new Promise((resolve, reject) => canvas.toBlob(blob => blob ? resolve(blob) : reject(new Error("PNG encoding failed")), "image/png"));
  }

  private copy(): void {
    if (!this.ready || this.busy || this.drag || this.prompting) return;
    if (!navigator.clipboard?.write || typeof ClipboardItem === "undefined") { new Notice(tr("当前环境不支持复制图片", "Image clipboard is unavailable")); return; }
    this.busy = true; this.refresh();
    try {
      const writing = navigator.clipboard.write([new ClipboardItem({ "image/png": this.png() })]);
      void writing.then(() => new Notice(tr("图片已复制", "Image copied"))).catch(error => {
        console.error("Image Annotator Plus: clipboard failed", error); new Notice(tr("复制失败，请检查剪贴板权限", "Copy failed; check clipboard permissions"));
      }).finally(() => { this.busy = false; this.refresh(); });
    } catch (error) { console.error(error); this.busy = false; this.refresh(); new Notice(tr("复制图片失败", "Could not copy image")); }
  }

  private outputPath(): string {
    if (this.file.extension.toLowerCase() === "png" && (this.app.vault.getAbstractFileByPath(this.file.path + SIDECAR) || /(?:-annotated|-标注)(?:-\d+)?$/u.test(this.file.basename))) return this.file.path;
    const dir = this.file.parent?.path && this.file.parent.path !== "/" ? `${this.file.parent.path}/` : "";
    const base = `${dir}${this.file.basename}-annotated`;
    let index = 1, path = `${base}.png`;
    while (this.app.vault.getAbstractFileByPath(path) || this.app.vault.getAbstractFileByPath(path + SIDECAR) || this.host.savingPaths.has(path)) path = `${base}-${++index}.png`;
    return normalizePath(path);
  }

  private async save(): Promise<void> {
    if (!this.ready || this.busy || this.drag || this.prompting) return;
    this.busy = true; this.refresh();
    let lockedPath = "";
    try {
      if (this.file.path !== this.initialPath) throw new Error("Image moved while editing; reopen it before saving");
      const targetPath = this.outputPath();
      const source = this.file;
      if (this.host.savingPaths.has(targetPath)) throw new Error("Another editor is saving this image");
      this.host.savingPaths.add(targetPath); lockedPath = targetPath;
      const refs = targetPath !== this.file.path ? await chooseEmbeds(this.app, this.embedContext, this.file) : [];
      const bytes = await (await this.png()).arrayBuffer();
      const outputHash = await hash(bytes);
      const target = await writeDocument(this.app, targetPath, bytes, { version: 1, baseImage: this.baseImage, sourcePath: this.sourcePath, outputHash, items: clone(this.items) }, targetPath === this.file.path ? this.originalHash : null);
      this.savedState = JSON.stringify(this.items);
      this.file = target; this.initialPath = target.path; this.originalHash = outputHash;
      let referencesReplaced = target.path === source.path;
      if (refs.length && this.embedContext) {
        try {
          await replaceEmbeds(this.app, this.embedContext.note, target, refs);
          referencesReplaced = true;
        } catch (error) { console.error("Image Annotator Plus: reference replacement failed", error); new Notice(tr("图片已保存，但引用未替换：笔记已变化或引用格式不支持。", "Image saved, but embeds were not replaced: the note changed or its syntax is unsupported.")); }
      }
      if (this.embedContext && referencesReplaced) this.host.refreshMarkdownImages(this.embedContext.note, source, target, outputHash, refs);
      new Notice(`${tr("已保存", "Saved")}: ${target.path}`);
      this.closed = true; super.close();
    } catch (error) {
      console.error("Image Annotator Plus: save failed", error);
      new Notice(tr("保存失败。请检查文件是否被移动、修改或占用，然后重试。", "Save failed. Check whether files were moved, modified, or locked, then retry."));
    } finally { if (lockedPath) this.host.savingPaths.delete(lockedPath); this.busy = false; if (!this.closed) this.refresh(); }
  }
}
