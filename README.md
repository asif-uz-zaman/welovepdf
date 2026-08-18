# We❤PDF

A private PDF toolkit — an iLovePDF-style web app that runs **entirely in the browser**.
No server, no uploads, no accounts, no file size limits. Files never leave the device.

## Tools

| Tool | What it does |
|---|---|
| **Merge PDF** | Combine several PDFs, drag the file cards to set the order |
| **Split PDF** | Split by page ranges, or extract selected pages (single PDF or ZIP) |
| **Rotate PDF** | Rotate all pages at once or one page at a time |
| **Organize PDF** | Drag to reorder, delete, duplicate or rotate pages; append pages from another PDF |
| **Edit PDF** | Add text, images, boxes, circles, highlights and freehand drawing — plus **White-out** to remove existing content |
| **Fill PDF Form** | Detects interactive form fields (text, checkbox, radio, dropdown, list) and fills them; type-anywhere fallback for flat forms |
| **Word to PDF** | Convert `.docx` to PDF |
| **PDF to Word** | Extract text into an editable `.docx` |
| **PDF to JPG** | Every page becomes a JPG (ZIP when multi-page) |
| **JPG to PDF** | Combine JPG/PNG/WebP into one PDF, with page size and margin options |

## How it works

Everything is client-side JavaScript:

- **[pdf.js](https://mozilla.github.io/pdf.js/)** — renders pages to canvas
- **[pdf-lib](https://pdf-lib.js.org/)** — writes PDFs (merge, split, rotate, forms, embedding)
- **[mammoth](https://github.com/mwilliamson/mammoth.js)** + **html2canvas** — DOCX → HTML → paginated PDF
- **[docx](https://docx.js.org/)** — builds the `.docx` for PDF → Word
- **[fflate](https://github.com/101arrowz/fflate)** — ZIP for multi-file output

All libraries are vendored in `vendor/` so the app has no network dependencies and
works offline after the first load (service worker).

### About "removing content"

A PDF is a set of drawing instructions, not editable objects, so true deletion of
existing text is not a simple operation. **White-out** covers the region with an opaque
white block, which is what you want for filling in and cleaning up documents — the result
is visually identical to deletion.

Note that white-out is a visual cover, not a redaction: the original text can still be
present in the file's text layer. Do not rely on it to hide sensitive data in a document
you are sending to someone who might inspect the file.

## Running locally

Any static file server works:

```bash
cd welovepdf
python3 -m http.server 8613
# open http://localhost:8613
```

## Layout

```
index.html          app shell, header, footer
css/style.css       all styling
js/app.js           router, tool registry, shared helpers
js/tools/*.js       one file per tool
vendor/             pinned third-party libraries
icons/              Tabler icon SVGs
fonts/              Hanken Grotesk woff2
sw.js               offline cache
```

Adding a tool = one file in `js/tools/` calling `App.registerTool({...})`; it appears on
the home grid and in the menu automatically.
