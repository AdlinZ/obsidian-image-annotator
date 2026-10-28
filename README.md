# Image Annotator Plus

English | [简体中文](README.zh-CN.md)

Image Annotator Plus adds a focused annotation workspace to Obsidian. Open an
image from its context menu, add visual notes, and save a flattened PNG beside
the source file.

<!-- Add a privacy-safe screenshot of the annotation workspace here before
     publishing. Use an image that contains no personal or vault content. -->

## Credits

Image Annotator Plus is based on
[Image Annotator](https://github.com/AdlinZ/obsidian-image-annotator) by
[AdlinZ](https://github.com/AdlinZ), which is released under the MIT license.
AdlinZ is the original author and a contributor to this project, and the
original copyright notice is preserved in [LICENSE](LICENSE).

This fork adds the straight line tool, Shift-to-snap drawing, a context-menu
integration that keeps Obsidian's own image menu entries, and live preview
refreshes after a save.

**Note:** do not install this plugin alongside the original Image Annotator.
Both plugins read and write the same `<image>.png.annotator.json` companion
files, and installing both will make them overwrite each other's data.

## Features

- Draw rectangles, straight lines, arrows, freehand marks, multiline text, numbered markers,
  solid redactions, and translucent highlights.
- Hold Shift while drawing a line or arrow to snap it to 45-degree increments.
- Add **Annotate image** to Obsidian's own image context menu, keeping existing
  entries such as Copy image, Rename, and Reveal in Finder.
- Select, move, resize, recolor, and delete individual annotations. Double-click
  text or a numbered marker with the select tool to edit its content.
- Remember the last color, line width, and text size; pick from six color swatches.
- Zoom, fit to window, view at actual size, and pan with Space-drag or the middle
  mouse button, or use the hand button on touchscreens. Ctrl/Cmd+wheel zooms around the pointer.
- Undo and redo annotation changes.
- Save a PNG and editable annotation data beside the source image, then reopen
  the PNG to continue editing individual annotations.
- Refresh the image previews of open notes right after a successful save.
- Copy a flattened PNG to the clipboard where image clipboard access is available.
- Replace one chosen image embed or all matching embeds in the current note.
- Confirm before discarding unsaved changes; prevent duplicate and conflicting saves.

The first save leaves the original image untouched and creates
`<original-name>-annotated.png`. Opening an existing `-annotated.png`
derivative and saving it updates that derivative. Files created by earlier
versions with the `-标注.png` suffix remain supported and are updated in place.

Each editable PNG has a companion `<image>.png.annotator.json` file containing
an immutable base-image snapshot and annotation objects. Keep both files to
continue editing. Renaming or moving a PNG in Obsidian while the plugin is enabled
also moves its companion file. When moving files outside Obsidian, move both files
and keep their names paired. Changing the original source image does not affect
the saved snapshot. An externally changed PNG or invalid companion file is rejected
instead of silently restoring stale annotations.

Old flattened PNGs remain usable as backgrounds; annotations already baked into
their pixels cannot be recovered as individual objects.

## Usage

1. Right-click a supported image in the file explorer or an image embed.
2. Select **Annotate image**.
3. Add annotations and select the save button.
4. Keep the original embed, replace the selected occurrence, or replace all matches.

Ctrl/Cmd+Z undoes, Ctrl/Cmd+Shift+Z or Ctrl/Cmd+Y redoes, Ctrl/Cmd+S saves,
and Delete removes a selected annotation. Escape prompts before discarding changes.

Supported source formats are PNG, JPEG, WebP, GIF, and BMP. Exports are PNG
files. Animated images are flattened to the frame displayed when opened.

## Privacy

Image Annotator Plus works entirely inside your vault. It does not use the
network, collect telemetry, or access files outside the vault.

The companion JSON contains the original, unredacted base image. Share only the
flattened PNG or the copied image when sharing redacted content. Clipboard output
contains neither editable objects nor the base-image snapshot.

## Languages

The interface follows Obsidian's language automatically. Chinese is shown for
Chinese locales; all other locales use English.

## Installation

### From Obsidian

Search for **Image Annotator Plus** in
**Settings → Community plugins → Browse**, then select **Install** and
**Enable**. Obsidian downloads the release assets from this repository.

### Manual installation

Download `main.js`, `manifest.json`, and `styles.css` from the latest release
and place them in:

```text
<vault>/.obsidian/plugins/image-annotator-plus/
```

Reload Obsidian and enable **Image Annotator Plus** under Community plugins.

## Development

```bash
npm install
npm run build
npm run lint
npx playwright install chromium
npm test
```

Build output is written to `dist/`. Browser regression tests cover drawing,
editing, clipboard pixels, persistence, write failures, reference replacement,
context menus, and desktop/mobile layouts. QA screenshots are written to `work/qa/`.

## License

[MIT](LICENSE) — Copyright (c) 2026 AdlinZ, Copyright (c) 2026 Robert (true0899).
