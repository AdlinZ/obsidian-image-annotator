# Changelog

## 1.2.0

- Rename the plugin to **Image Annotator Plus** and switch to the
  `image-annotator-plus` plugin id, so the plugin can be listed in the Obsidian
  Community directory.
- Include every change from 1.1.0: the straight line tool, Shift-to-snap
  drawing, the image context-menu fix, and post-save preview refreshes.
- Install into `<vault>/.obsidian/plugins/image-annotator-plus/`. Do not install
  it alongside the original Image Annotator: both plugins read and write the
  same `.annotator.json` companion files.

## 1.1.0

- Add a straight line tool, and snap lines and arrows to 45-degree increments
  while Shift is held.
- Keep Obsidian's own image context-menu entries and append **Annotate image**
  to them instead of replacing the menu, so Copy image, Rename, and Reveal in
  Finder stay available when native menus are enabled.
- Refresh the image previews of open notes after a successful save.
- Drop the Image Converter-specific menu patch and its polling timer.

## 1.0.2

- Edit individual annotations: selection, movement, resizing, deletion, styles,
  multiline text, and numbered-marker values.
- Add sequential numbered markers, solid redactions, and translucent highlights.
- Save a base-image snapshot and editable objects in a companion JSON file;
  restore objects when reopening a PNG and follow Obsidian image renames.
- Copy flattened images without annotation data to the clipboard.
- Remember common styles and provide six color swatches.
- Pan with Space-drag or the middle mouse button; zoom around the pointer.
- Replace one selected embed or all matches, preserving wiki dimensions and
  standard Markdown alt text and titles.
- Protect unsaved work, block repeat/conflicting saves, and restore previous
  files after failed writes.
- Include the Image Converter context-menu integration fix from September 4.

Editable companion files include the unredacted base image. Share the PNG alone
when distributing redacted results. Existing flattened annotations cannot be
recovered as editable objects.
