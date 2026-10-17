import Plugin from "../src/main";
import { Menu, createApp } from "./obsidian";

export async function checkImageMenus() {
  const check = (condition, message) => { if (!condition) throw new Error(message); };
  const app = createApp();
  const file = await app.vault.createBinary("menu.png", new ArrayBuffer(0));
  const originalMouse = Menu.prototype.showAtMouseEvent, originalPosition = Menu.prototype.showAtPosition;
  const plugin = new Plugin(app);
  await plugin.onload();
  const entries = menu => menu.items.map(item => item.title);
  const base = () => {
    const menu = new Menu();
    for (const title of ["Copy image", "Rename", "Reveal in Finder", "Copy Image plugin"]) menu.addItem(item => item.setTitle(title));
    return menu;
  };
  const baseline = entries(base());
  const roots = [];
  try {
    for (const view of ["markdown-source-view", "markdown-preview-view"]) {
      const root = document.createElement("div"); root.className = view;
      root.innerHTML = '<span class="image-embed" src="menu.png"><img></span>';
      document.body.append(root); roots.push(root);
      const image = root.querySelector("img");
      for (const native of [false, true]) {
        Menu.useNativeMenu = native;
        const event = new MouseEvent("contextmenu", { bubbles: true, cancelable: true, button: 2 });
        const menu = base();
        const handler = () => {
          app.workspace.trigger("file-menu", menu, file);
          menu.showAtPosition({ x: 10, y: 20 });
        };
        image.addEventListener("contextmenu", handler, { once: true });
        image.dispatchEvent(event);
        check(!event.defaultPrevented, "Plugin must not cancel contextmenu");
        // Obsidian's shared image menu may present on a later task.
        await new Promise(resolve => setTimeout(resolve, 0));
        check(menu.showAtMouseEvent(event) === menu, "Preserve return value");
        check(JSON.stringify(entries(menu).slice(0, -1)) === JSON.stringify(baseline), "Preserve all existing items");
        check(entries(menu).filter(title => title === "标注图片" || title === "Annotate image").length === 1, "Exactly one annotation item");
        check(menu.shown.native === native, "Respect menu backend");
        const unrelated = base(); unrelated.showAtPosition({ x: 10, y: 20 });
        check(unrelated.items.length === baseline.length, "No stale position-only image context");
        // Reading View can skip all workspace menu events entirely.
        const deferred = new MouseEvent("contextmenu", { bubbles: true, button: 2 });
        image.dispatchEvent(deferred);
        await new Promise(resolve => setTimeout(resolve, 0));
        const shared = base(); shared.showAtMouseEvent(deferred); shared.showAtMouseEvent(deferred);
        check(shared.items.length === baseline.length + 1, "Deferred shared menu appended once");
        const otherEvent = new MouseEvent("contextmenu", { bubbles: true });
        document.body.dispatchEvent(otherEvent);
        const other = base(); other.showAtMouseEvent(otherEvent);
        check(other.items.length === baseline.length, "Unrelated menu unchanged");
      }
    }
    plugin.unload();
    check(Menu.prototype.showAtMouseEvent === originalMouse && Menu.prototype.showAtPosition === originalPosition, "Restore menu methods");
    const reloaded = new Plugin(app); await reloaded.onload();
    const inner = Menu.prototype.showAtMouseEvent;
    const later = function(event) { return inner.call(this, event); };
    Menu.prototype.showAtMouseEvent = later;
    const image = roots[0].querySelector("img");
    const event = new MouseEvent("contextmenu", { bubbles: true, button: 2 }); image.dispatchEvent(event);
    reloaded.unload();
    check(Menu.prototype.showAtMouseEvent === later, "Do not clobber a later plugin wrapper");
    const menu = base(); menu.showAtMouseEvent(event);
    check(menu.items.length === baseline.length, "Retained wrapper inert after unload");
    return true;
  } finally {
    plugin.unload();
    Menu.prototype.showAtMouseEvent = originalMouse; Menu.prototype.showAtPosition = originalPosition;
    Menu.useNativeMenu = false;
    roots.forEach(root => root.remove());
  }
}
