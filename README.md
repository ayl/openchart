# OpenChart

A Lucidchart-inspired, local-first diagram editor in one self-contained `index.html`.
No build step, server, runtime dependencies, account, or network connection is required.

Open **index.html** in a modern browser, or serve this folder with any static web server.

## New: navigation, dark mode, and build sequences

- Two-finger trackpad scrolling pans; pinch or Ctrl/⌘ + wheel zooms around the pointer. Touchscreen pinch supports simultaneous pan/zoom without accidentally placing objects. Hold Ctrl/⌘ during a move or resize to bypass snapping.
- **Settings → Editor theme → System / Light / Dark** changes the editor chrome only. Paper, saved diagram colors, and exports remain unchanged.
- **Build stages** (beside Format and Layers) creates a cumulative reveal sequence. Add stages, select objects, and use **First appears in** or **Assign selected**. New shapes use the explicitly active stage while that panel is open; otherwise they start in Always. Connectors wait until both endpoints and their containers are visible.
- **From layers…** previews a one-time layer-to-stage conversion. Choose layer names/order and Append or Replace; layer stacking remains independent. Use the Layers panel or context-menu **Move selection to layer** control for drawing-layer reassignment.
- **Preview / export sequence…** offers fixed-frame previews, stage ranges, resolution/background/margin options, **PNG files (ZIP)**, **PDF files (ZIP)**, or **one multipage PDF**. All frames share the final diagram's bounds, ports, connector routes, and label positions, so existing content stays still as the diagram grows. Hidden layers are excluded.
- Sequence PDFs contain lossless raster images (including transparency), **not vector/selectable text**. Existing single-diagram SVG and browser vector-print export are unchanged. ZIPs include a manifest; an editable JSON copy is opt-in. The UI reports reduced output dimensions when memory limits apply.

Stage-enabled diagrams use JSON **version 4** and need this app version to reopen. Older version 2/3 diagrams still load without changing their appearance; diagrams with no stages continue using version 3. Stage membership, ordering, and names are undoable; preview, theme, and navigation are not document edits.

See [REPAIR_REPORT_PASS8.md](REPAIR_REPORT_PASS8.md) for feature implementation, [REPAIR_REPORT_PASS9.md](REPAIR_REPORT_PASS9.md) for pinch/connector fixes, and [REPAIR_REPORT_PASS10.md](REPAIR_REPORT_PASS10.md) for the directional quick-create and connector audit. Live browser/trackpad/IME qualification is still pending; do not interpret automated event tests as hardware acceptance.

Connector routing now scores bends and label clearance consistently, separates independent duplicate flows, and distributes crowded automatic attachments across suitable sides using the full large-arrowhead footprint. Explicit sides and manual bends remain yours; large arrowheads and the 2px box gap are unchanged. Shared trunks no longer hide unrelated downstream crossings, and hidden connectors no longer influence visible route costs. See [REPAIR_REPORT_PASS11.md](REPAIR_REPORT_PASS11.md) for the implementation, 387-test result, new fixtures, and remaining visual-review limits.

## Editor

- Document name, local save status, File/Templates/Export menus, and a persistent tool and formatting bar.
- Searchable, keyboard-operable shape library with flowchart, UML/data, basic shapes, text, and containers.
- Contextual Format and Layers panels; both side panels can be collapsed for more canvas space.
- Infinite canvas with a world-aligned grid, independent grid/snap/guide switches, zoom-to-fit, and mouse/touch navigation.
- Shape and connector multi-selection, marquee selection, copy/paste, duplication, grouping, alignment, equal-gap distribution, and stacking controls.
- Bulk fill, border, text, and connector formatting, mixed-value fields, shape dimensions, text overflow notices, and editable connector labels.

## Layers, containers, and connectors

**Layers** have names, ordering, visibility, locking, and an active drawing layer.
The object list lets you select or unlock individual objects. New shapes go onto the
active visible, unlocked layer. Moving a selection to another layer carries container
descendants. Removing a layer moves its objects to another visible, unlocked layer.

**Containers** have explicit parent/child membership, including nesting. A shape dropped
inside a container joins it; overlapping containers choose the smallest eligible parent.
Drag a container by its title or border. Drag in its empty interior to marquee-select
objects. Movement, keyboard nudging, alignment, duplication, and deletion consistently
include descendants. Locked children follow an editable parent; locking the parent locks
the whole subtree. Containers grow around their children without losing their opposite edge.

**Connectors** preserve the chosen source and target ports. Drag a blue port to another
shape, or use the connector tool and click two shapes. Newly drawn connectors appear at
the front of the top visible layer; if it is locked, a new Connections layer is created
above it. The active drawing layer stays unchanged. Selected endpoints can be dragged
to reconnect; Escape cancels without changing the document. Elbow routing avoids shape
bounding boxes, including narrow gaps. Straight and rounded routes, manual bends,
self-loops, source/end arrow styles, thickness, colors, and labels are available.
Labels move with the route and can be clicked or double-clicked directly.
All rendering and hit testing follow the same layer/object order.

With **L / Connector**, click the source first, then the destination. To add a return
arrow, click the destination first and the original source second; the existing arrow
is left unchanged. You can also click or drag blue shape ports. **V / Select** is the
mode for dragging an existing connector's endpoint to reconnect it. Escape or the
create-and-connect picker's Cancel button clears a pending connection.

## Appearance and themes

Diagrams carry a versioned appearance model. Colors are assigned by semantic role
(process, decision, data, container, annotation) through coordinated themes — Pastel,
Ocean, Sunset, Forest, Berry, Ink, Neutral, Mono print, High contrast. Applying a theme is
an explicit, undoable command; version 2 documents open with their existing appearance
untouched. `Copy style`, `Paste style`, and `Set as default` transfer only compatible
appearance properties, and new shapes resolve the document defaults at creation. The
document font family and text sizes are export-safe choices shared by canvas, measurement,
and every export format. Automatic text color contrasts against the effective background,
including the containing container behind transparent shapes. Shape text lives in a usable
region per shape type (diamond corners, cylinder caps, document waves, container headings,
icon captions), with an `Auto-fit text` setting and a `Fit shape to text` command.
Connector labels persist their position as a fraction of the route plus a perpendicular
offset: dragging a label moves the label itself, and it stays attached at the same spot
through rerouting, while its box stays readable to other routes.

### Faster chart building

Icons and shapes share one placement workflow: pick in the library, click to place (a
dashed ghost previews the spot; Escape cancels), or drag in. Directional quick-create
controls on the selected shape add the next shape at an aligned distance and connect it
in one undoable step. All four buttons create an **outgoing** connection: Up connects
to the new box above, Left to the new box on the left, and likewise for Down/Right.
Use the connector inspector's **Reverse** action to change flow direction; it preserves
manual bends and manually placed labels. **Reset bends** keeps attachment sides;
**Use automatic sides** keeps bends; **Reset route** resets both, without resetting labels.
Releasing a connector on empty canvas opens a compact shape picker
that creates and connects both objects atomically (Escape cancels). `Replace shape`
keeps identity, label, connections, styles, and container membership. The library tracks
recent shapes and star favorites, and a "More shapes" group restores the remaining
supported node shapes.

### Inspector and layers

The properties panel keeps focus while you type (rebuilds defer to blur), the layer lists
nest children under their containers with "source → target" connector labels, and list
expansion is remembered per layer. `Fit container to contents` wraps descendants with
even padding; Alt+click cycles through overlapping shapes; at narrow widths the inspector
opens as a drawer overlaying the canvas.

### Export preview and quality checks

Export opens a preview dialog: whole diagram or selection only (descendants and internal
connections included), transparent or solid background, configurable margin, PNG scale,
and PDF page size (fit-to-content or A4/Letter in either orientation). The preview is the
exact SVG the download produces. The document inspector lists quality checks — text
overflow, overlapping labels or arrowheads, unintended shape overlaps, cramped arrowheads —
which select the offending object when clicked and never alter the diagram.
`node visual-check.mjs` captures the fixture matrix at 50/100/200% zoom and
pixel-compares it against approved baselines under `shots/repair-pass2/matrix/`.

## Shortcuts

| Action                                   | Shortcut                              |
| ---------------------------------------- | ------------------------------------- |
| Select / hand / connector / text         | V / H / L / T                         |
| Pan                                      | Scroll, middle-drag, or Space + drag  |
| Zoom                                     | Ctrl/Command + wheel, pinch, or + / − |
| Fit diagram                              | F                                     |
| Edit shape text or connector label       | Double-click, F2, or Enter            |
| Add/remove from selection                | Shift + click                         |
| Select all objects, including connectors | Ctrl/Command + A                      |
| Copy / cut / paste                       | Ctrl/Command + C / X / V              |
| Duplicate                                | Ctrl/Command + D or Alt + drag        |
| Group / ungroup                          | Ctrl/Command + G / Shift + G          |
| Bring forward / send backward            | Ctrl/Command + ] / [                  |
| Bring to front / send to back            | Ctrl/Command + Shift + ] / [          |
| Nudge / larger nudge                     | Arrow keys / Shift + arrow keys       |
| Undo / redo                              | Ctrl/Command + Z / Shift + Z          |
| Download editable JSON                   | Ctrl/Command + S                      |
| Cancel gesture or text edit              | Escape                                |
| Help                                     | ?                                     |

Text editing: Enter saves, Shift + Enter inserts a newline, Escape cancels.

## Saving and export

Autosave uses browser localStorage and displays failures instead of silently ignoring them.
It is device/browser-local, not cloud storage. Download JSON to retain portable copies.

Version 2 JSON saves layers, stacking, parent relationships, groups, styles, and connector
anchors. Legacy OpenChart JSON is migrated when opened. Import validates the entire document
before replacing the current one; Undo restores the previous document.
Blank documents stay blank on reload. If an unreadable saved document is encountered, its
raw contents are retained under `openchart.doc.v1.recovery` before any replacement autosave.

SVG and PNG use the same shape/connector drawing functions as the canvas, including label
backgrounds and UML dividers. Export bounds include connector bends, labels, rotated text,
and stroke/arrow margins. Hidden layers are excluded. JSON retains all layers.

PNG is normally exported at 2× resolution; very large diagrams are scaled down to a maximum
dimension of 8192 pixels. SVG preserves vector geometry.

## Validation

Run the dependency-free regression suite with Node.js 22 or newer:

```sh
node --test tests/editor.test.cjs
node --test tests/fixtures.test.cjs
```

The tests execute the actual embedded application script with a small DOM adapter
(`tests/harness.cjs`, shared by both suites). They cover document migration/validation,
rendering/export serialization, undo/redo, gesture cancellation, connector creation and
routing, layers and stacking, nested containers, grouping/duplication, keyboard actions,
alignment/match/distribute, tidy selection, the appearance model (themes, style defaults,
copy/paste style, typography, contrast-aware text color), per-shape text regions and
connector labels, the creation workflow (quick-create, shape picker, replace shape,
recents, fit-to-contents, selection-through), the stable inspector, the export preview
(scope, margins, PNG scale, PDF page sizes), the quality-check diagnostics, and the
derived route-result contract, plus persistence.

`tests/fixtures.test.cjs` loads reproduction documents from `tests/fixtures/` (saved in
the application's own format by `tests/make-fixtures.cjs`) and checks route invariants —
finite coordinates, continuity, orthogonality, zero-length segments, backtracking, shape
interiors, port separation — plus target behaviors for ordered attachment ports,
reciprocal connectors, diamond attachments, and arrowhead clearance. Current findings
and remaining gaps are summarized in `tests/FIXTURE_REPORT.md`.

These are logic and simulated-DOM checks, not real-browser visual tests.
`node visual-check.mjs` is fully isolated: it spawns its own disposable headless Chrome
(`CHROME_PATH` overrides the binary) and serves the app from disk on ephemeral ports, so
it never touches your browser profile or an external server. It asserts each fixture's
identity after load, captures the fixture matrix at 50/100/200% zoom plus selected and
export-preview states, and compares every screenshot's decoded pixels against approved
baselines (tolerance documented in the script; a missing baseline is reported as pending,
never as a pass; `--approve` promotes candidates explicitly after review and never
promotes the tampered negative-control capture, which must fail the comparison). Diff
images and metrics are written next to the candidates. Pass-2 artifacts live under
`shots/repair-pass2/`; the pass-1 `shots/matrix/` tree is retained as history.
The run also verifies localStorage isolation with a sentinel document in a second origin
and exits nonzero on any drift. `--selftest` proves the harness detects injected changes.
Manual browser QA remains for native touch behavior, file downloads, and cross-browser
appearance. The repair-pass browser checks live in `browser-repair-check.mjs` (same
isolation model; also exercises real pointer input and inspects the exported SVG, PNG
rasterization — an opaque blank PNG cannot pass — and the PDF print document, which is
reported as constructed, not as verified output); evidence is under `shots/repair/` and
the write-ups are `REPAIR_REPORT.md` (pass 1) and `REPAIR_REPORT_PASS2.md` (pass 2).

Rendering performance is measured by `node perf-check.mjs` (isolated browser, JSON output
plus `shots/repair-pass2/perf.json`) on two committed fixtures: a representative
100-node / 148-edge grid (90 row-chain + 58 column-chain edges) and a denser
130-node / 182-edge variant with a deliberately overlapping 30-node cluster benchmarked
separately. Pan, zoom, and selection-only repaints issue zero route solves; on the
representative fixture live drag frames cost ~3 ms at the 95th percentile and
release-to-settled lands around 33 ms at the median. The full-quality multi-pass solve
that the correctness contract runs when a gesture commits right after a geometry-changing
frame remains the dominant cost (~230 ms representative, ~420 ms dense; dense live-drag
p95 ≈ 440 ms) — see the honest caveats in `REPAIR_REPORT_PASS2.md` (P01).

## Scope and remaining limitations

OpenChart is a single-user diagram editor, not full Lucidchart feature parity. It does not
implement cloud collaboration, comments, multiple pages, external clipboard interchange,
Visio/draw.io import, data linking, PDF/VSDX export, or free-floating connector endpoints.

Automatic routing uses rectangular obstacles; deliberately overlapping shapes, manual
bends, and straight routes can still cross shapes. Rounded routes are rounded orthogonal
paths, not arbitrary Bézier editing. Very large documents beyond the qualified 100-node
fixture scale have not been measured. The SVG canvas is not yet a complete screen-reader diagram navigation surface;
the semantic toolbar, inspector, and layer object list provide keyboard access to controls.

The editing patterns are informed by Lucid's
[editor guide](https://help.lucid.co/hc/en-us/articles/11970952773652-Welcome-to-Lucidchart)
and [shape arrangement guide](https://help.lucid.co/hc/en-us/articles/16390096079764-Add-and-customize-shapes-in-Lucidchart).
OpenChart uses its own branding and is not affiliated with Lucid Software.

## License

MIT, as stated by the original project.
