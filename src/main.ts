import { Menu, MenuPositionDef, Notice, Plugin, TFile, normalizePath } from "obsidian";
import type { View } from "obsidian";
import { ImageAnnotatorModal } from "./editor";
import { EmbedContext, EmbedReference } from "./embeds";
import { defaults, preferences, Preferences } from "./model";
import { SIDECAR } from "./storage";
import { tr } from "./ui";

const IMAGE_EXTENSIONS = new Set(["png", "jpg", "jpeg", "webp", "gif", "bmp"]);
function isImageFile(file: TFile): boolean { return IMAGE_EXTENSIONS.has(file.extension.toLowerCase()); }
function isMarkdownFileView(view: View): view is View & { file: TFile | null } {
  return view.getViewType() === "markdown" && "file" in view && view.file instanceof TFile;
}

export default class ImageAnnotatorPlugin extends Plugin {
  preferences: Preferences = { ...defaults };
  savingPaths = new Set<string>();
  private preferenceWrite: Promise<void> = Promise.resolve();
  private readonly imageMenuContexts = new WeakMap<MouseEvent, { file: TFile; image: HTMLImageElement }>();
  private readonly augmentedMenus = new WeakSet<Menu>();
  private activeImageContext: { file: TFile; image: HTMLImageElement } | null = null;
  private menuIntegrationActive = true;

  async onload(): Promise<void> {
    const data: unknown = await this.loadData();
    this.preferences = preferences((data as { preferences?: unknown } | null)?.preferences);
    this.registerEvent(this.app.workspace.on("file-menu", (menu, file) => {
      if (!(file instanceof TFile) || !isImageFile(file)) return;
      const image = this.activeImageContext?.file === file ? this.activeImageContext.image : undefined;
      this.addAnnotateItem(menu, file, image);
    }));
    this.registerDomEvent(document, "contextmenu", event => {
      this.activeImageContext = null;
      const image = this.resolveImageElement(event.target);
      if (!image || !image.closest(".markdown-preview-view, .markdown-source-view")) return;
      const file = this.resolveImageFile(image);
      if (!file) return;
      const context = { file, image };
      this.imageMenuContexts.set(event, context);
      this.activeImageContext = context;
      // Position-only menus can be matched during this event, never by a timer.
      queueMicrotask(() => { if (this.activeImageContext === context) this.activeImageContext = null; });
    }, true);
    this.registerImageMenuIntegration();
    this.registerEvent(this.app.vault.on("rename", (file, oldPath) => {
      if (!(file instanceof TFile) || !isImageFile(file)) return;
      const sidecar = this.app.vault.getAbstractFileByPath(oldPath + SIDECAR);
      if (!(sidecar instanceof TFile)) return;
      const destination = file.path + SIDECAR;
      if (this.app.vault.getAbstractFileByPath(destination)) { new Notice(tr("标注数据未移动：目标位置已有同名文件。", "Annotation data was not moved: destination already exists.")); return; }
      void this.app.vault.rename(sidecar, destination).catch(error => {
        console.error("Image Annotator Plus: could not move annotation data", error);
        new Notice(tr("图片已移动，但标注数据移动失败。", "Image moved, but annotation data could not be moved."));
      });
    }));
    this.addCommand({
      id: "annotate-active-image", name: tr("标注当前图片", "Annotate active image"),
      checkCallback: checking => {
        const file = this.app.workspace.getActiveFile();
        if (!file || !isImageFile(file)) return false;
        if (!checking) this.openAnnotator(file);
        return true;
      }
    });
  }

  remember(value: Preferences): void {
    this.preferences = preferences(value);
    const snapshot = { ...this.preferences };
    this.preferenceWrite = this.preferenceWrite.then(() => this.saveData({ preferences: snapshot })).catch(error => {
      console.error("Image Annotator Plus: could not save preferences", error);
      new Notice(tr("常用样式保存失败", "Could not save style preferences"));
    });
  }

  private openAnnotator(file: TFile, image?: HTMLImageElement): ImageAnnotatorModal {
    const note = this.app.workspace.getActiveFile();
    const context: EmbedContext | null = note?.extension === "md" ? { note } : null;
    if (context && image) {
      const container = image.closest(".markdown-preview-view, .markdown-source-view");
      const images = container ? Array.from(container.querySelectorAll<HTMLImageElement>("img")).filter(candidate => this.resolveImageFile(candidate)?.path === file.path) : [];
      const embeds = (this.app.metadataCache.getFileCache(context.note)?.embeds ?? []).filter(embed => this.app.metadataCache.getFirstLinkpathDest(embed.link, context.note.path)?.path === file.path);
      const index = images.indexOf(image);
      if (index >= 0 && embeds.length === images.length) context.preferredIndex = index;
    }
    const modal = new ImageAnnotatorModal(this.app, file, context, this);
    modal.open();
    return modal;
  }

  refreshMarkdownImages(note: TFile, source: TFile, target: TFile, outputHash: string, refs: EmbedReference[]): void {
    const resource = this.app.vault.getResourcePath(target);
    const separator = resource.includes("?") ? "&" : "?";
    const refreshedSource = `${resource}${separator}annotator=${outputHash}`;
    const indexes = new Set(refs.map(ref => ref.index));
    for (const leaf of this.app.workspace.getLeavesOfType("markdown")) {
      if (!isMarkdownFileView(leaf.view) || leaf.view.file?.path !== note.path) continue;
      const images = Array.from(leaf.view.containerEl.querySelectorAll<HTMLImageElement>("img"))
        .filter(image => this.resolveImageFile(image)?.path === source.path);
      for (const [index, image] of images.entries()) {
        if (refs.length && !indexes.has(index)) continue;
        this.refreshImageElement(image, source, target, refreshedSource);
      }
    }
  }

  private refreshImageElement(image: HTMLImageElement, source: TFile, target: TFile, resource: string): void {
    const wrapper = image.closest(".image-wrapper, .image-embed, .internal-embed");
    for (const element of [image, wrapper]) {
      if (!element) continue;
      for (const attribute of ["data-path", "data-src"]) {
        if (element.getAttribute(attribute) === source.path) element.setAttribute(attribute, target.path);
      }
    }
    image.src = resource;
  }

  private addAnnotateItem(menu: Menu, file: TFile, image?: HTMLImageElement): void {
    if (!this.menuIntegrationActive || this.augmentedMenus.has(menu)) return;
    menu.addItem(item => item.setTitle(tr("标注图片", "Annotate image")).setIcon("square-dashed").onClick(() => this.openAnnotator(file, image)));
    this.augmentedMenus.add(menu);
  }

  private registerImageMenuIntegration(): void {
    // Obsidian has no public image-menu event in Reading View. Wrap only the
    // public presentation methods, preserving the existing menu and its items.
    const contexts = this.imageMenuContexts;
    const addItem = (menu: Menu, file: TFile, image: HTMLImageElement) => {
      try { this.addAnnotateItem(menu, file, image); }
      catch (error) { console.error("Image Annotator Plus: could not extend image menu", error); }
    };
    const activeContext = () => this.activeImageContext;
    // Preserve the dynamic Menu receiver when forwarding below.
    // eslint-disable-next-line @typescript-eslint/unbound-method -- Forwarded with the original Menu receiver.
    const originalMouse = Menu.prototype.showAtMouseEvent;
    // eslint-disable-next-line @typescript-eslint/unbound-method -- Forwarded with the original Menu receiver.
    const originalPosition = Menu.prototype.showAtPosition;
    const showAtMouseEvent: typeof originalMouse = function(this: Menu, event: MouseEvent) {
      const context = contexts.get(event);
      if (context) addItem(this, context.file, context.image);
      return originalMouse.call(this, event) as typeof this;
    };
    const showAtPosition: typeof originalPosition = function(this: Menu, position: MenuPositionDef, doc?: Document) {
      const context = activeContext();
      if (context) addItem(this, context.file, context.image);
      return originalPosition.call(this, position, doc) as typeof this;
    };
    Menu.prototype.showAtMouseEvent = showAtMouseEvent;
    Menu.prototype.showAtPosition = showAtPosition;
    this.register(() => {
      this.menuIntegrationActive = false;
      this.activeImageContext = null;
      // Leave later wrappers intact; any retained wrapper becomes a no-op.
      if (Menu.prototype.showAtMouseEvent === showAtMouseEvent) Menu.prototype.showAtMouseEvent = originalMouse;
      if (Menu.prototype.showAtPosition === showAtPosition) Menu.prototype.showAtPosition = originalPosition;
    });
  }

  private isImageElement(value: unknown): value is HTMLImageElement { return Boolean(value && typeof value === "object" && (value as Element).tagName === "IMG"); }
  private resolveImageElement(target: EventTarget | null): HTMLImageElement | null {
    if (!target || typeof target !== "object") return null;
    if (this.isImageElement(target)) return target;
    const wrapper = (target as Element).closest?.(".image-wrapper, .image-embed");
    const image = wrapper?.querySelector(".image-resize-container img, img");
    return this.isImageElement(image) ? image : null;
  }

  private resolveImageFile(image: HTMLImageElement): TFile | null {
    const wrapper = image.closest(".image-wrapper, .image-embed, .internal-embed");
    const path = image.getAttribute("data-path") ?? image.getAttribute("data-src") ?? wrapper?.getAttribute("data-path") ?? wrapper?.getAttribute("data-src") ?? wrapper?.getAttribute("src");
    const notePath = this.app.workspace.getActiveFile()?.path ?? "";
    if (path) {
      const linked = this.app.metadataCache.getFirstLinkpathDest(path, notePath);
      if (linked && isImageFile(linked)) return linked;
      const direct = this.app.vault.getAbstractFileByPath(normalizePath(path));
      if (direct instanceof TFile && isImageFile(direct)) return direct;
    }
    let src = (image.currentSrc || image.src).split("?")[0].split("#")[0];
    try { src = decodeURIComponent(src); } catch { /* Keep literal source when URI decoding fails. */ }
    const linked = this.app.metadataCache.getFirstLinkpathDest(src.split("/").pop() ?? "", notePath);
    return linked && isImageFile(linked) ? linked : null;
  }
}
