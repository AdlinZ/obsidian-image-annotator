import assert from "node:assert/strict";
import { readFile, mkdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import { createServer } from "node:http";
import { resolve } from "node:path";
import { build } from "esbuild";
import { chromium } from "playwright";
import { fromMarkdown } from "mdast-util-from-markdown";

const qa = resolve("work/qa");
await mkdir(qa, { recursive: true });
await build({ entryPoints: ["tests/browser.js"], bundle: true, platform: "browser", format: "iife", outfile: `${qa}/browser.js`, alias: { obsidian: resolve("tests/obsidian.js") }, logLevel: "silent" });
const server = createServer(async (req, res) => {
  const paths = { "/": "tests/fixture.html", "/browser.js": `${qa}/browser.js`, "/styles.css": "styles.css" };
  if (!paths[req.url]) { res.writeHead(404).end(); return; }
  res.setHeader("Content-Type", req.url.endsWith(".js") ? "text/javascript" : req.url.endsWith(".css") ? "text/css" : "text/html");
  res.end(await readFile(paths[req.url]));
});
await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
const candidates = [process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE, chromium.executablePath(), "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe", "C:/Program Files/Google/Chrome/Application/chrome.exe"].filter(Boolean);
const browser = await chromium.launch({ executablePath: candidates.find(path => existsSync(path)), headless: true });
const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, permissions: ["clipboard-read", "clipboard-write"] });
const page = await context.newPage();
const errors = [];
page.on("pageerror", error => errors.push(error.message));
let count = 0;
async function test(name, run) { await run(); count++; console.log(`PASS ${name}`); }
const waitReady = () => page.waitForFunction(() => window.editor?.ready);
async function open(path = "sample.png", refs = false) { await page.evaluate(({ path, refs }) => window.openEditor(path, refs), { path, refs }); await waitReady(); }
async function draw(tool, start, end) {
  await page.locator(`[data-tool="${tool}"]`).click();
  const box = await page.locator("canvas").boundingBox();
  await page.mouse.move(box.x + start[0] * box.width / 1200, box.y + start[1] * box.height / 720);
  if (!end) { await page.mouse.down(); await page.mouse.up(); return; }
  await page.mouse.down();
  await page.mouse.move(box.x + end[0] * box.width / 1200, box.y + end[1] * box.height / 720, { steps: 8 });
  await page.mouse.up();
}
const items = () => page.evaluate(() => window.editor.items);
try {
  await page.goto(`http://127.0.0.1:${server.address().port}`);
  await page.waitForFunction(() => window.source);
  await test("Image menus preserve core/Copy Image entries and clean up on unload", async () => {
    assert.equal(await page.evaluate(() => window.checkImageMenus()), true);
  });
  await open("sample.png", true);
  await test("All nine tools render and canvas contains source pixels", async () => {
    assert.equal(await page.locator("button[data-tool]").count(), 9);
    assert.equal(await page.evaluate(() => window.editor.ctx.getImageData(1, 1, 1, 1).data[3]), 255);
    assert.equal(await page.locator(".vf-ia-toolbar svg").count(), 20);
  });
  await test("Rectangle, arrow, pen, redaction and highlight gestures", async () => {
    await draw("rect", [40, 100], [360, 155]);
    await draw("arrow", [600, 230], [760, 170]);
    await draw("pen", [70, 590], [450, 650]);
    await page.locator('[data-color="#111111"]').click();
    await draw("redact", [145, 175], [340, 215]);
    await page.locator('[data-color="#facc15"]').click();
    await draw("highlight", [725, 115], [1045, 195]);
    assert.deepEqual((await items()).map(item => item.type), ["rect", "arrow", "pen", "redact", "highlight"]);
    const pixels = await page.evaluate(() => [Array.from(editor.ctx.getImageData(200, 190, 1, 1).data), Array.from(editor.ctx.getImageData(740, 125, 1, 1).data)]);
    assert.deepEqual(pixels[0], [17, 17, 17, 255]);
    assert.equal(pixels[1][3], 255); assert.notDeepEqual(pixels[1].slice(0, 3), [250, 204, 21]);
  });
  await test("Sequential numbered markers and editable multi-line text", async () => {
    await page.locator('[data-color="#e11d48"]').click();
    await draw("number", [390, 130]); await draw("number", [1080, 160]);
    await draw("text", [580, 300]);
    await page.locator("textarea").fill("检查导出结果\n确认编号与说明一致");
    await page.getByRole("button", { name: "确定", exact: true }).click();
    assert.deepEqual((await items()).filter(item => item.type === "number").map(item => item.number), [1, 2]);
    assert.match((await items()).at(-1).text, /\n/);
  });
  await test("Selection moves a rectangle without adding annotations", async () => {
    await page.locator('[data-tool="select"]').click();
    const box = await page.locator("canvas").boundingBox();
    const pos = (x, y) => [box.x + x * box.width / 1200, box.y + y * box.height / 720];
    await page.mouse.move(...pos(80, 100)); await page.mouse.down(); await page.mouse.move(...pos(100, 115), { steps: 5 }); await page.mouse.up();
    const list = await items(); assert.equal(list.length, 8); assert.ok(Math.abs(list[0].points[0].x - 60) < 2); assert.ok(Math.abs(list[0].points[0].y - 115) < 2);
  });
  await test("Selected styles, undo and redo preserve object state", async () => {
    await page.locator('[data-color="#2563eb"]').click();
    assert.equal((await items())[0].color, "#2563eb");
    await page.getByRole("button", { name: "撤销", exact: true }).click();
    assert.equal((await items())[0].color, "#e11d48");
    await page.getByRole("button", { name: "重做", exact: true }).click();
    assert.equal((await items())[0].color, "#2563eb");
  });
  await test("Selection resize handle and single-object deletion", async () => {
    await page.evaluate(() => { editor.selected = 0; editor.refresh(); });
    const box = await page.locator("canvas").boundingBox();
    const b = await page.evaluate(() => api.model.bounds(editor.items[0], editor.ctx));
    await page.mouse.move(box.x + (b.x + b.w) * box.width / 1200, box.y + (b.y + b.h) * box.height / 720);
    await page.mouse.down(); await page.mouse.move(box.x + (b.x + b.w + 50) * box.width / 1200, box.y + (b.y + b.h + 20) * box.height / 720); await page.mouse.up();
    assert.ok((await items())[0].points[1].x > 410);
    await page.getByRole("button", { name: "删除标注", exact: true }).click(); assert.equal((await items()).length, 7);
    await page.getByRole("button", { name: "撤销", exact: true }).click(); assert.equal((await items()).length, 8);
  });
  await test("Number and existing text content can be changed", async () => {
    await page.evaluate(() => { editor.selected = 5; editor.refresh(); });
    await page.getByRole("button", { name: "编辑内容", exact: true }).click();
    await page.locator("input.vf-ia-text-input").fill("7"); await page.getByRole("button", { name: "确定", exact: true }).click();
    assert.equal((await items())[5].number, 7);
    await page.evaluate(() => { editor.selected = 7; editor.refresh(); });
    await page.getByRole("button", { name: "编辑内容", exact: true }).click();
    await page.locator("textarea").fill("确认导出结果\n逐项检查"); await page.getByRole("button", { name: "确定", exact: true }).click();
    assert.equal((await items())[7].text, "确认导出结果\n逐项检查");
  });
  await test("Export and clipboard contain flattened pixels without selection UI", async () => {
    await page.getByRole("button", { name: "复制图片", exact: true }).click();
    await page.waitForFunction(() => notices.includes("图片已复制"));
    const result = await page.evaluate(async () => {
      const data = await navigator.clipboard.read(), blob = await data[0].getType("image/png"), bitmap = await createImageBitmap(blob);
      const canvas = document.createElement("canvas"); canvas.width = bitmap.width; canvas.height = bitmap.height;
      canvas.getContext("2d").drawImage(bitmap, 0, 0);
      const copied = canvas.getContext("2d").getImageData(0, 0, bitmap.width, bitmap.height).data.buffer;
      canvas.getContext("2d").clearRect(0, 0, bitmap.width, bitmap.height);
      canvas.getContext("2d").drawImage(await createImageBitmap(await editor.png()), 0, 0);
      const exported = canvas.getContext("2d").getImageData(0, 0, bitmap.width, bitmap.height).data.buffer;
      return { width: bitmap.width, height: bitmap.height, pixel: Array.from(canvas.getContext("2d").getImageData(200, 190, 1, 1).data), hash: await api.storage.hash(copied), exportHash: await api.storage.hash(exported) };
    });
    assert.equal(result.width, 1200); assert.equal(result.height, 720); assert.deepEqual(result.pixel, [17,17,17,255]); assert.equal(result.hash, result.exportHash);
  });
  await page.screenshot({ path: `${qa}/desktop.png` });
  const savedItems = await items();
  await test("Duplicate save guarded; only the chosen occurrence is replaced", async () => {
    await page.evaluate(() => { void editor.save(); void editor.save(); });
    await page.getByRole("button", { name: "仅替换此处", exact: true }).click();
    await page.waitForFunction(() => editor.closed);
    const result = await page.evaluate(async () => ({ note: await app.vault.read(note), outputs: app.vault.getFiles().map(file => file.path), document: JSON.parse(await app.vault.read(app.vault.getAbstractFileByPath("sample-annotated.png.annotator.json"))) }));
    assert.equal(result.note, "First\n![[sample.png|640]]\nSecond\n![[sample-annotated.png]]\n");
    assert.equal(result.outputs.filter(path => path.endsWith("-annotated.png")).length, 1);
    assert.deepEqual(result.document.items, savedItems);
    assert.match(result.document.baseImage, /^data:image\/png/);
  });
  await test("Reopening restores all editable objects and saved preferences", async () => {
    await open("sample-annotated.png"); assert.deepEqual(await items(), savedItems);
    assert.equal(await page.evaluate(() => editor.dirty()), false);
    assert.equal(await page.evaluate(() => editor.prefs.color), "#2563eb");
  });
  await test("Unsaved close confirmation preserves work when cancelled", async () => {
    await page.evaluate(() => { editor.selected = 5; editor.refresh(); });
    await page.getByRole("button", { name: "删除标注", exact: true }).click();
    await page.evaluate(() => editor.close());
    await page.getByRole("button", { name: "继续编辑", exact: true }).click();
    assert.equal(await page.evaluate(() => editor.closed), false); assert.equal((await items()).length, 7);
    await page.getByRole("button", { name: "撤销", exact: true }).click();
    await page.evaluate(() => editor.close());
    assert.equal(await page.locator(".modal-container").count(), 0);
  });
  await test("Obsidian rename moves sidecar; original changes do not alter snapshot", async () => {
    await page.evaluate(async () => {
      await app.vault.rename(app.vault.getAbstractFileByPath("sample-annotated.png"), "renamed.png");
      await app.vault.modifyBinary(source, new Uint8Array([1, 2, 3]).buffer);
    });
    await open("renamed.png"); assert.deepEqual(await items(), savedItems);
    await page.evaluate(() => editor.close());
  });
  await test("Save failure rolls back both files; stale edits cannot overwrite", async () => {
    const result = await page.evaluate(async () => {
      const file = app.vault.getAbstractFileByPath("renamed.png"), json = app.vault.getAbstractFileByPath(file.path + api.storage.SIDECAR);
      const before = await app.vault.readBinary(file), sidecar = await app.vault.read(json), document = JSON.parse(sidecar);
      app.vault.fail = "modifyBinary";
      let failed = false; try { await api.storage.writeDocument(app, file.path, new Uint8Array([8,9]).buffer, { ...document, items: [] }, await api.storage.hash(before)); } catch { failed = true; }
      const restored = await api.storage.hash(before) === await api.storage.hash(await app.vault.readBinary(file)) && sidecar === await app.vault.read(json);
      let stale = false; try { await api.storage.writeDocument(app, file.path, before, document, "0".repeat(64)); } catch { stale = true; }
      app.vault.fail = "createBinary";
      try { await api.storage.writeDocument(app, "failure.png", before, document, null); } catch {}
      return { failed, restored, stale, orphan: !!app.vault.getAbstractFileByPath("failure.png.annotator.json") };
    });
    assert.deepEqual(result, { failed: true, restored: true, stale: true, orphan: false });
  });
  await test("Corrupt documents and externally modified PNGs are rejected", async () => {
    const result = await page.evaluate(async () => {
      let invalid = false, mismatch = false;
      try { api.storage.parseDocument('{"version":1,"items":[]}'); } catch { invalid = true; }
      const file = app.vault.getAbstractFileByPath("renamed.png");
      try { await api.storage.readDocument(app, file, new Uint8Array([7]).buffer); } catch { mismatch = true; }
      return { invalid, mismatch };
    }); assert.deepEqual(result, { invalid: true, mismatch: true });
  });
  await test("Markdown parser preserves alt text, title, spaces and wiki dimensions", async () => {
    const result = await page.evaluate(() => [api.embeds.replaceReference('![a [nested] label](<old file.png> "A title")', 'new file(2).png'), api.embeds.replaceReference('![[old.png|640x400]]', 'new.png')]);
    const parsed = fromMarkdown(result[0]).children[0].children[0];
    assert.equal(parsed.alt, "a [nested] label"); assert.equal(parsed.url, "new file(2).png"); assert.equal(parsed.title, "A title");
    assert.equal(result[1], '![[new.png|640x400]]');
  });
  await test("All-occurrence replacement and stale-note guard", async () => {
    const result = await page.evaluate(async () => {
      const a = await app.vault.create("all.md", "![[renamed.png|100]]\n![[renamed.png]]");
      const target = app.vault.getAbstractFileByPath("renamed.png"), refs = await api.embeds.references(app, a, target);
      await api.embeds.replaceEmbeds(app, a, { path: "new.png" }, refs);
      const replaced = await app.vault.read(a);
      await app.vault.modify(a, "Other edits\n" + replaced);
      let blocked = false; try { await api.embeds.replaceEmbeds(app, a, target, refs); } catch { blocked = true; }
      return { replaced, blocked };
    }); assert.equal(result.replaced, "![[new.png|100]]\n![[new.png]]"); assert.equal(result.blocked, true);
  });
  await open("renamed.png");
  await test("Zoom and space-drag pan move the scrollable canvas", async () => {
    await page.getByRole("button", { name: "放大", exact: true }).click();
    await page.getByRole("button", { name: "放大", exact: true }).click();
    const stage = await page.locator(".vf-ia-stage").boundingBox();
    const before = await page.locator(".vf-ia-stage").evaluate(el => el.scrollLeft);
    await page.locator(".vf-ia-stage").focus(); await page.keyboard.down("Space");
    await page.mouse.move(stage.x + stage.width / 2, stage.y + stage.height / 2); await page.mouse.down();
    await page.mouse.move(stage.x + stage.width / 2 - 90, stage.y + stage.height / 2 - 50); await page.mouse.up(); await page.keyboard.up("Space");
    assert.ok(await page.locator(".vf-ia-stage").evaluate(el => el.scrollLeft) > before);
  });
  await test("Hand tool pans without a keyboard and does not draw", async () => {
    const before = await items();
    await page.getByRole("button", { name: "拖动画布", exact: true }).click();
    const stage = await page.locator(".vf-ia-stage").boundingBox();
    const start = await page.locator(".vf-ia-stage").evaluate(el => el.scrollLeft);
    await page.mouse.move(stage.x + stage.width / 2, stage.y + stage.height / 2); await page.mouse.down();
    await page.mouse.move(stage.x + stage.width / 2 + 60, stage.y + stage.height / 2); await page.mouse.up();
    assert.ok(await page.locator(".vf-ia-stage").evaluate(el => el.scrollLeft) < start);
    assert.deepEqual(await items(), before);
    await page.getByRole("button", { name: "拖动画布", exact: true }).click();
  });
  await test("Desktop and mobile controls fit without page overflow", async () => {
    for (const viewport of [{ width: 390, height: 844 }, { width: 320, height: 568 }, { width: 844, height: 390 }]) {
      await page.setViewportSize(viewport); await page.getByRole("button", { name: "适应窗口", exact: true }).click();
      await page.waitForTimeout(100);
      const overflow = await page.evaluate(() => {
        const root = document.querySelector(".vf-image-annotator-modal").getBoundingClientRect();
        return [...document.querySelectorAll(".vf-ia-toolbar button, .vf-ia-toolbar input")].filter(el => { const b = el.getBoundingClientRect(); return b.right > root.right + 1 || b.left < root.left - 1; }).length;
      }); assert.equal(overflow, 0, JSON.stringify(viewport));
      if (viewport.width === 390) await page.screenshot({ path: `${qa}/mobile.png` });
    }
  });
  await test("Line tool draws plain lines and Shift snaps to 45-degree directions", async () => {
    await page.setViewportSize({ width: 1440, height: 1000 });
    await page.locator('[data-tool="line"]').click();
    const box = await page.locator("canvas").boundingBox();
    const pos = (x, y) => [box.x + x * box.width / 1200, box.y + y * box.height / 720];
    await page.mouse.move(...pos(100, 100));
    await page.mouse.down(); await page.mouse.move(...pos(250, 180), { steps: 5 }); await page.mouse.up();
    await page.mouse.move(...pos(300, 400));
    await page.keyboard.down("Shift");
    await page.mouse.down(); await page.mouse.move(...pos(420, 520), { steps: 5 }); await page.mouse.up();
    await page.keyboard.up("Shift");
    const lines = (await items()).filter(item => item.type === "line").slice(-2);
    assert.equal(lines.length, 2);
    assert.equal(lines[0].points.length, 2);
    const dx = lines[1].points[1].x - lines[1].points[0].x;
    const dy = lines[1].points[1].y - lines[1].points[0].y;
    assert.ok(Math.abs(Math.abs(dx) - Math.abs(dy)) < 1, "Shift line should snap to 45 degrees");
  });
  await test("Shift constrains arrows to all 45-degree directions", async () => {
    await page.setViewportSize({ width: 1440, height: 1000 });
    await page.locator('[data-tool="arrow"]').click();
    const box = await page.locator("canvas").boundingBox();
    const pos = (x, y) => [box.x + x * box.width / 1200, box.y + y * box.height / 720];
    await page.mouse.move(...pos(300, 300));
    await page.keyboard.down("Shift");
    await page.mouse.down(); await page.mouse.move(...pos(500, 360), { steps: 5 }); await page.mouse.up();
    await page.keyboard.up("Shift");
    await page.mouse.move(...pos(700, 300));
    await page.keyboard.down("Shift");
    await page.mouse.down(); await page.mouse.move(...pos(730, 500), { steps: 5 }); await page.mouse.up();
    await page.keyboard.up("Shift");
    await page.mouse.move(...pos(400, 300));
    await page.keyboard.down("Shift");
    await page.mouse.down(); await page.mouse.move(...pos(520, 420), { steps: 5 }); await page.mouse.up();
    await page.keyboard.up("Shift");
    await page.mouse.move(...pos(650, 500));
    await page.keyboard.down("Shift");
    await page.mouse.down(); await page.mouse.move(...pos(770, 380), { steps: 5 }); await page.mouse.up();
    await page.keyboard.up("Shift");
    await page.mouse.move(...pos(800, 500));
    await page.keyboard.down("Shift");
    await page.mouse.down(); await page.mouse.move(...pos(680, 380), { steps: 5 }); await page.mouse.up();
    await page.keyboard.up("Shift");
    const arrows = (await items()).filter(item => item.type === "arrow").slice(-5);
    assert.equal(arrows.length, 5);
    assert.ok(Math.abs(arrows[0].points[1].y - arrows[0].points[0].y) < 1, "first arrow should be horizontal");
    assert.ok(Math.abs(arrows[1].points[1].x - arrows[1].points[0].x) < 1, "second arrow should be vertical");
    const diagonal = arrows[2].points[1].x - arrows[2].points[0].x;
    const diagonalY = arrows[2].points[1].y - arrows[2].points[0].y;
    assert.ok(Math.abs(Math.abs(diagonal) - Math.abs(diagonalY)) < 1, "third arrow should be diagonal at 45 degrees");
    const negativeDiagonal = arrows[3].points[1].x - arrows[3].points[0].x;
    const negativeDiagonalY = arrows[3].points[1].y - arrows[3].points[0].y;
    assert.ok(negativeDiagonal > 0 && negativeDiagonalY < 0 && Math.abs(negativeDiagonal + negativeDiagonalY) < 1, "fourth arrow should be -45 degrees");
    const reverseNegativeDiagonal = arrows[4].points[1].x - arrows[4].points[0].x;
    const reverseNegativeDiagonalY = arrows[4].points[1].y - arrows[4].points[0].y;
    assert.ok(reverseNegativeDiagonal < 0 && reverseNegativeDiagonalY < 0 && Math.abs(reverseNegativeDiagonal - reverseNegativeDiagonalY) < 1, "fifth arrow should be -135 degrees");
  });
  assert.deepEqual(errors, []);
  console.log(`PASS ${count} checks; screenshots: work/qa/desktop.png and work/qa/mobile.png`);
} finally { await browser.close(); await new Promise(resolve => server.close(resolve)); }
