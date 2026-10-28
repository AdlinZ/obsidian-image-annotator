import { App, TFile } from "obsidian";
import { Item, validItems } from "./model";

export const SIDECAR = ".annotator.json";
export interface AnnotationDocument {
  version: 1;
  sourcePath: string;
  baseImage: string;
  outputHash: string;
  items: Item[];
}

export async function hash(bytes: ArrayBuffer): Promise<string> {
  return Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", bytes)), b => b.toString(16).padStart(2, "0")).join("");
}

export function imageData(bytes: ArrayBuffer, extension: string): string {
  const mime = ({ jpg: "image/jpeg", jpeg: "image/jpeg", webp: "image/webp", gif: "image/gif", bmp: "image/bmp" } as Record<string, string>)[extension.toLowerCase()] ?? "image/png";
  const array = new Uint8Array(bytes);
  let raw = "";
  for (let i = 0; i < array.length; i += 8192) raw += String.fromCharCode(...array.subarray(i, i + 8192));
  return `data:${mime};base64,${btoa(raw)}`;
}

export function parseDocument(text: string): AnnotationDocument {
  const data: unknown = JSON.parse(text);
  const d = data as Partial<AnnotationDocument> | null;
  if (!d || d.version !== 1 || typeof d.sourcePath !== "string" || typeof d.baseImage !== "string" ||
    !/^data:image\/(png|jpeg|webp|gif|bmp);base64,[A-Za-z0-9+/]+=*$/.test(d.baseImage) ||
    typeof d.outputHash !== "string" || !/^[a-f0-9]{64}$/.test(d.outputHash) || !validItems(d.items)) throw new Error("Invalid annotation document");
  return d as AnnotationDocument;
}

export async function readDocument(app: App, file: TFile, bytes: ArrayBuffer): Promise<AnnotationDocument | null> {
  const sidecar = app.vault.getAbstractFileByPath(file.path + SIDECAR);
  if (!sidecar) return null;
  if (!(sidecar instanceof TFile)) throw new Error("Annotation path is a folder");
  const document = parseDocument(await app.vault.read(sidecar));
  if (document.outputHash !== await hash(bytes)) throw new Error("Image changed outside Image Annotator Plus");
  return document;
}

// Keep the PNG and its editable document consistent, including failed writes.
export async function writeDocument(app: App, path: string, bytes: ArrayBuffer, document: AnnotationDocument, expectedHash: string | null): Promise<TFile> {
  const existing = app.vault.getAbstractFileByPath(path);
  const sidecar = app.vault.getAbstractFileByPath(path + SIDECAR);
  if (existing && !(existing instanceof TFile) || sidecar && !(sidecar instanceof TFile)) throw new Error("Output path is a folder");
  const previousImage = existing instanceof TFile ? await app.vault.readBinary(existing) : null;
  if (expectedHash === null ? existing || sidecar : !previousImage || await hash(previousImage) !== expectedHash) throw new Error("Output changed; reopen the image before saving");
  const previousDocument = sidecar instanceof TFile ? await app.vault.read(sidecar) : null;
  let result: TFile | null = null;
  try {
    if (sidecar instanceof TFile) await app.vault.modify(sidecar, JSON.stringify(document));
    else await app.vault.create(path + SIDECAR, JSON.stringify(document));
    result = existing instanceof TFile ? existing : await app.vault.createBinary(path, bytes);
    if (existing instanceof TFile) await app.vault.modifyBinary(existing, bytes);
    return result;
  } catch (error) {
    if (existing instanceof TFile && previousImage) await app.vault.modifyBinary(existing, previousImage);
    else {
      const created = app.vault.getAbstractFileByPath(path);
      if (created instanceof TFile && result === created) await app.fileManager.trashFile(created);
    }
    const currentSidecar = app.vault.getAbstractFileByPath(path + SIDECAR);
    if (currentSidecar instanceof TFile) {
      if (previousDocument !== null) await app.vault.modify(currentSidecar, previousDocument);
      else await app.fileManager.trashFile(currentSidecar);
    }
    throw error;
  }
}
