import { App, Modal, TFile } from "obsidian";
import { fromMarkdown } from "mdast-util-from-markdown";
import { toMarkdown } from "mdast-util-to-markdown";
import type { Image, RootContent } from "mdast";
import { tr } from "./ui";

export interface EmbedReference { start: number; end: number; raw: string; line: number; index: number }
export interface EmbedContext { note: TFile; preferredIndex?: number }

export async function references(app: App, note: TFile, source: TFile): Promise<EmbedReference[]> {
  const text = await app.vault.read(note);
  let index = 0;
  return (app.metadataCache.getFileCache(note)?.embeds ?? []).flatMap(embed => {
    const file = app.metadataCache.getFirstLinkpathDest(embed.link, note.path);
    if (file?.path !== source.path) return [];
    const occurrence = index++;
    const start = embed.position.start.offset, end = embed.position.end.offset;
    const raw = text.slice(start, end);
    if (raw !== embed.original) return [];
    return [{ start, end, raw, line: embed.position.start.line + 1, index: occurrence }];
  });
}

function imageNode(children: RootContent[]): Image | null {
  for (const node of children) {
    if (node.type === "image") return node;
    if ("children" in node) { const found = imageNode(node.children); if (found) return found; }
  }
  return null;
}

export function replaceReference(raw: string, link: string): string {
  if (raw.startsWith("![[") && raw.endsWith("]]")) {
    const pipe = raw.indexOf("|");
    return `![[${link}${pipe >= 0 ? raw.slice(pipe, -2) : ""}]]`;
  }
  const node = imageNode(fromMarkdown(raw).children);
  if (!node) throw new Error("Unsupported image reference");
  return toMarkdown({ ...node, url: link }).trimEnd();
}

export async function replaceEmbeds(app: App, note: TFile, target: TFile, refs: EmbedReference[]): Promise<void> {
  const link = app.metadataCache.fileToLinktext(target, note.path, true);
  await app.vault.process(note, text => {
    for (const ref of refs) if (text.slice(ref.start, ref.end) !== ref.raw) throw new Error("Note changed; image references were not replaced");
    for (const ref of [...refs].sort((a, b) => b.start - a.start)) text = text.slice(0, ref.start) + replaceReference(ref.raw, link) + text.slice(ref.end);
    return text;
  });
}

class EmbedModal extends Modal {
  private settled = false;
  constructor(app: App, private refs: EmbedReference[], private preferred: number | undefined, private resolve: (refs: EmbedReference[]) => void) { super(app); }
  onOpen(): void {
    this.setTitle(tr("替换图片引用", "Replace image embed"));
    const select = this.contentEl.createEl("select", { cls: "vf-ia-reference-select", attr: { "aria-label": tr("引用位置", "Embed location") } });
    select.createEl("option", { text: tr("选择引用位置", "Choose an occurrence"), value: "" });
    this.refs.forEach((ref, i) => select.createEl("option", { text: `${tr("第", "Line ")}${ref.line}${tr("行", "")} · ${ref.raw}`, value: String(i) }));
    if (this.refs.length === 1) select.value = "0";
    else if (this.preferred !== undefined && this.refs[this.preferred]) select.value = String(this.preferred);
    const actions = this.contentEl.createDiv({ cls: "vf-ia-dialog-actions" });
    actions.createEl("button", { text: tr("保留原引用", "Keep original") }).addEventListener("click", () => this.finish([]));
    const current = actions.createEl("button", { text: tr("仅替换此处", "Replace this occurrence"), cls: "mod-cta" });
    current.disabled = !select.value;
    select.addEventListener("change", () => { current.disabled = !select.value; });
    current.addEventListener("click", () => { if (select.value) this.finish([this.refs[Number(select.value)]]); });
    if (this.refs.length > 1) actions.createEl("button", { text: tr("替换本笔记全部引用", "Replace all in this note") }).addEventListener("click", () => this.finish(this.refs));
  }
  onClose(): void { if (!this.settled) { this.settled = true; this.resolve([]); } this.contentEl.empty(); }
  private finish(refs: EmbedReference[]): void { this.settled = true; this.resolve(refs); this.close(); }
}

export async function chooseEmbeds(app: App, context: EmbedContext | null, source: TFile): Promise<EmbedReference[]> {
  if (!context) return [];
  const refs = await references(app, context.note, source);
  if (!refs.length) return [];
  return new Promise(resolve => new EmbedModal(app, refs, context.preferredIndex, resolve).open());
}
