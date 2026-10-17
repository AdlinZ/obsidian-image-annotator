import { checkImageMenus } from "./menus";
import { installDom, createApp } from "./obsidian";
import { ImageAnnotatorModal } from "../src/editor";
import Plugin from "../src/main";
import * as storage from "../src/storage";
import * as model from "../src/model";
import * as embeds from "../src/embeds";

installDom();
window.notices = [];
window.api = { storage, model, embeds };
window.checkImageMenus = checkImageMenus;
window.initialize = async () => {
  window.app = createApp();
  window.plugin = new Plugin(window.app);
  await window.plugin.onload();
  const image = document.createElement("canvas"); image.width = 1200; image.height = 720;
  const ctx = image.getContext("2d"); ctx.fillStyle = "#ffffff"; ctx.fillRect(0, 0, 1200, 720);
  ctx.fillStyle = "#e5e7eb"; ctx.fillRect(0, 0, 1200, 70); ctx.fillStyle = "#171717"; ctx.font = "bold 25px sans-serif"; ctx.fillText("Image Annotator 1.0.2", 32, 44);
  ctx.font = "22px sans-serif"; ctx.fillText("Case 2026-0907", 50, 138); ctx.fillText("Account: 1234 5678", 50, 205);
  ctx.fillStyle = "#d1fae5"; ctx.fillRect(730, 116, 310, 74); ctx.fillStyle = "#166534"; ctx.fillText("Export evidence", 770, 161);
  ctx.fillStyle = "#f1f5f9"; for (let i = 0; i < 5; i++) ctx.fillRect(50, 270 + i * 68, 1080, 44);
  const bytes = await new Promise(resolve => image.toBlob(async blob => resolve(await blob.arrayBuffer())));
  window.source = await window.app.vault.createBinary("sample.png", bytes);
  window.note = await window.app.vault.create("note.md", "First\n![[sample.png|640]]\nSecond\n![[sample.png]]\n");
  window.app.activeFile = window.note;
};
window.openEditor = (path = "sample.png", context = false) => {
  window.editor = new ImageAnnotatorModal(window.app, window.app.vault.getAbstractFileByPath(path), context ? { note: window.note, preferredIndex: 1 } : null, window.plugin);
  window.editor.open();
};
window.initialize();
