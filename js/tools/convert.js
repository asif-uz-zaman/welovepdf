/* Converters: Word→PDF, PDF→Word, PDF→JPG, JPG→PDF */
(function () {
  'use strict';
  const A = App;

  /* lazy vendor loading */
  const loaded = {};
  function loadScript(src) {
    if (loaded[src]) return loaded[src];
    loaded[src] = new Promise((res, rej) => {
      const s = document.createElement('script');
      s.src = src;
      s.onload = res;
      s.onerror = () => rej(new Error('Could not load ' + src));
      document.head.appendChild(s);
    });
    return loaded[src];
  }

  const A4 = { w: 595.28, h: 841.89 };

  /* ================= Word → PDF ================= */
  A.registerTool({
    id: 'word-to-pdf', icon: 'file-type-doc', color: 'var(--blue)',
    title: 'Word to PDF',
    desc: 'Convert DOCX documents to PDF right in your browser.',
    sub: 'Turn a Word document (.docx) into a PDF. Basic layouts convert best — complex Word designs are simplified.',
    accept: '.docx', multiple: false, pickLabel: 'Select DOCX file',
    hint: 'Only .docx files are supported (not old .doc). The converted PDF keeps text, headings, lists, tables and images, but not exact Word page layout.',
    mount() {
      A.toolLanding(this, files => wordToPdf(files[0]));
    }
  });

  async function wordToPdf(file) {
    A.processing('Converting Word document…');
    let holder;
    try {
      await loadScript('vendor/mammoth.min.js');
      await loadScript('vendor/html2canvas.min.js');
      const buf = (await A.readBytes(file)).buffer;
      const result = await mammoth.convertToHtml({ arrayBuffer: buf });

      // A4 @ 96dpi: 794×1123, 1in margins → content 602×931
      const CW = 602, CH = 931, M = 96, PW = 794, PH = 1123;
      holder = document.createElement('div');
      holder.style.cssText = 'position:absolute;left:-10000px;top:0;width:' + CW + 'px;background:#fff;' +
        'font-family:Hanken,system-ui,sans-serif;font-size:14.5px;line-height:1.5;color:#111';
      holder.innerHTML =
        '<style>.w2p h1{font-size:26px;margin:16px 0 10px;line-height:1.2}.w2p h2{font-size:21px;margin:14px 0 8px;line-height:1.25}' +
        '.w2p h3{font-size:17px;margin:12px 0 7px}.w2p p{margin:0 0 9px}.w2p ul,.w2p ol{margin:0 0 9px;padding-left:26px}' +
        '.w2p li{margin-bottom:3px}.w2p table{border-collapse:collapse;margin:0 0 12px;width:100%}' +
        '.w2p td,.w2p th{border:1px solid #999;padding:4px 7px;font-size:13px;vertical-align:top}' +
        '.w2p img{max-width:100%;height:auto}.w2p strong{font-weight:700}</style>' +
        '<div class="w2p">' + result.value + '</div>';
      document.body.appendChild(holder);
      await new Promise(r => setTimeout(r, 60)); // allow images/layout to settle
      const imgs = [...holder.querySelectorAll('img')];
      await Promise.all(imgs.map(im => im.complete ? 1 : new Promise(r => { im.onload = r; im.onerror = r; })));

      const content = holder.querySelector('.w2p');
      const totalH = content.scrollHeight + 24; // buffer so final-line descenders aren't clipped

      // block-aligned page cut points so lines are not sliced in half
      const blocks = [];
      content.querySelectorAll('p,h1,h2,h3,h4,h5,h6,li,table,pre,blockquote,img,hr').forEach(b => {
        if (b.closest('table') && b.tagName !== 'TABLE') return; // treat tables as one block
        const top = b.getBoundingClientRect().top - content.getBoundingClientRect().top;
        blocks.push({ top, h: b.offsetHeight });
      });
      blocks.sort((a, b) => a.top - b.top);
      const cuts = [0];
      let pageStart = 0;
      for (const b of blocks) {
        if (b.top + b.h - pageStart > CH && b.top > pageStart) {
          pageStart = b.top;
          cuts.push(Math.floor(b.top));
        }
      }
      // hard-slice any oversized remainder
      const finalCuts = [];
      for (let i = 0; i < cuts.length; i++) {
        let from = cuts[i];
        const to = i + 1 < cuts.length ? cuts[i + 1] : totalH;
        finalCuts.push(from);
        while (to - from > CH) { from += CH; finalCuts.push(from); }
      }

      const SC = 2;
      content.style.height = totalH + 'px'; // pin height so the html2canvas clone can't clip the last line
      const big = await html2canvas(content, {
        scale: SC, backgroundColor: '#ffffff', logging: false,
        onclone: async cloneDoc => { try { await cloneDoc.fonts.ready; } catch (e) {} }
      });
      const pdoc = await A.PDFDocument.create();
      for (let i = 0; i < finalCuts.length; i++) {
        const from = finalCuts[i];
        const to = Math.min(totalH, i + 1 < finalCuts.length ? finalCuts[i + 1] : totalH);
        const sliceH = Math.max(1, to - from);
        const pageCv = document.createElement('canvas');
        pageCv.width = PW * SC; pageCv.height = PH * SC;
        const ctx = pageCv.getContext('2d');
        ctx.fillStyle = '#fff';
        ctx.fillRect(0, 0, pageCv.width, pageCv.height);
        ctx.drawImage(big, 0, from * SC, CW * SC, sliceH * SC, M * SC, M * SC, CW * SC, sliceH * SC);
        const blob = await new Promise(r => pageCv.toBlob(r, 'image/jpeg', 0.92));
        const jpg = await pdoc.embedJpg(new Uint8Array(await blob.arrayBuffer()));
        const page = pdoc.addPage([A4.w, A4.h]);
        page.drawImage(jpg, { x: 0, y: 0, width: A4.w, height: A4.h });
      }
      const out = await pdoc.save();
      holder.remove();
      A.processingDone();
      A.doneScreen({
        heading: 'Word document converted to PDF!',
        blob: new Blob([out], { type: 'application/pdf' }),
        filename: file.name.replace(/\.docx?$/i, '') + '.pdf', label: 'PDF',
        meta: finalCuts.length + ' page' + (finalCuts.length > 1 ? 's' : '') + ' · ' + A.fmtSize(out.length),
        toolId: 'word-to-pdf'
      });
    } catch (e) {
      holder && holder.remove();
      A.fail(e, 'word-to-pdf');
    }
  }

  /* ================= PDF → Word ================= */
  A.registerTool({
    id: 'pdf-to-word', icon: 'file-text', color: 'var(--blue)',
    title: 'PDF to Word',
    desc: 'Extract the text of a PDF into an editable Word document.',
    sub: 'Get an editable .docx with the PDF’s text. Paragraphs are kept; exact page layout, columns and images are not.',
    accept: '.pdf', multiple: false,
    hint: 'Works on PDFs with real text. Scanned PDFs (photos of paper) have no text layer and will come out empty.',
    mount() {
      A.toolLanding(this, files => pdfToWord(files[0]));
    }
  });

  async function pdfToWord(file) {
    A.processing('Extracting text…');
    try {
      await loadScript('vendor/docx.umd.js');
      const bytes = await A.readBytes(file);
      const doc = await A.loadPdfjs(bytes);
      const children = [];
      let totalChars = 0;

      for (let i = 1; i <= doc.numPages; i++) {
        const page = await doc.getPage(i);
        const tc = await page.getTextContent();
        // group into lines by y
        const items = tc.items.filter(it => it.str !== undefined);
        const lines = [];
        for (const it of items) {
          const y = it.transform[5], x = it.transform[4], h = Math.abs(it.transform[3]) || 10;
          let line = lines.find(l => Math.abs(l.y - y) < h * 0.5);
          if (!line) { line = { y, h, parts: [] }; lines.push(line); }
          line.parts.push({ x, str: it.str });
          line.h = Math.max(line.h, h);
        }
        lines.sort((a, b) => b.y - a.y);
        lines.forEach(l => l.parts.sort((a, b) => a.x - b.x));

        // merge lines into paragraphs by vertical gap
        const paras = [];
        let cur = null, prevY = null, prevH = 12;
        for (const l of lines) {
          const text = l.parts.map(p => p.str).join(' ').replace(/\s+/g, ' ').trim();
          if (!text) continue;
          totalChars += text.length;
          const gap = prevY === null ? 0 : prevY - l.y;
          if (cur === null || gap > Math.max(l.h, prevH) * 1.7) {
            cur = { text, size: l.h };
            paras.push(cur);
          } else {
            cur.text += ' ' + text;
          }
          prevY = l.y; prevH = l.h;
        }

        const bodySize = median(paras.map(p => p.size)) || 11;
        for (const p of paras) {
          const isHeading = p.size > bodySize * 1.45 && p.text.length < 120;
          children.push(new docx.Paragraph({
            heading: isHeading ? docx.HeadingLevel.HEADING_2 : undefined,
            spacing: { after: 160 },
            children: [new docx.TextRun({ text: p.text, size: Math.round(Math.max(9, Math.min(28, p.size)) * 2) })]
          }));
        }
        if (i < doc.numPages) children.push(new docx.Paragraph({ children: [new docx.PageBreak()] }));
      }
      doc.destroy();

      if (totalChars === 0) {
        A.processingDone();
        return A.fail(new Error('No text found in this PDF — it is probably a scanned document (images of pages), which has no extractable text.'), 'pdf-to-word');
      }
      const wdoc = new docx.Document({ sections: [{ children }] });
      const blob = await docx.Packer.toBlob(wdoc);
      A.processingDone();
      A.doneScreen({
        heading: 'PDF converted to Word!',
        blob, filename: file.name.replace(/\.pdf$/i, '') + '.docx', label: 'DOCX',
        meta: A.fmtSize(blob.size) + ' · text and paragraphs (layout simplified)',
        toolId: 'pdf-to-word'
      });
    } catch (e) { A.fail(e, 'pdf-to-word'); }
  }
  function median(arr) {
    if (!arr.length) return 0;
    const s = [...arr].sort((a, b) => a - b);
    return s[Math.floor(s.length / 2)];
  }

  /* ================= PDF → JPG ================= */
  A.registerTool({
    id: 'pdf-to-jpg', icon: 'file-type-jpg', color: 'var(--yellow)',
    title: 'PDF to JPG',
    desc: 'Convert each PDF page into a JPG image.',
    sub: 'Every page becomes a high-quality JPG image. Multiple pages are downloaded together as a ZIP.',
    accept: '.pdf', multiple: false,
    mount() {
      A.toolLanding(this, files => pdfToJpg(files[0]));
    }
  });

  async function pdfToJpg(file) {
    A.processing('Rendering pages…');
    try {
      const bytes = await A.readBytes(file);
      const doc = await A.loadPdfjs(bytes);
      const base = file.name.replace(/\.pdf$/i, '');
      const outs = [];
      for (let i = 1; i <= doc.numPages; i++) {
        A.processing('Rendering page ' + i + ' of ' + doc.numPages + '…');
        const page = await doc.getPage(i);
        const vp = page.getViewport({ scale: 2.5 }); // ≈180 dpi
        const cv = document.createElement('canvas');
        cv.width = Math.floor(vp.width); cv.height = Math.floor(vp.height);
        const ctx = cv.getContext('2d');
        ctx.fillStyle = '#fff';
        ctx.fillRect(0, 0, cv.width, cv.height);
        await page.render({ canvasContext: ctx, viewport: vp }).promise;
        const blob = await new Promise(r => cv.toBlob(r, 'image/jpeg', 0.92));
        outs.push({ name: base + '_page' + String(i).padStart(2, '0') + '.jpg', bytes: new Uint8Array(await blob.arrayBuffer()) });
      }
      doc.destroy();
      A.processingDone();
      if (outs.length === 1) {
        A.doneScreen({
          heading: 'PDF converted to JPG!',
          blob: new Blob([outs[0].bytes], { type: 'image/jpeg' }),
          filename: outs[0].name, label: 'JPG',
          meta: A.fmtSize(outs[0].bytes.length), toolId: 'pdf-to-jpg'
        });
      } else {
        const entries = {};
        outs.forEach(o => entries[o.name] = o.bytes);
        const z = await A.zip(entries);
        A.doneScreen({
          heading: 'PDF converted to JPG!',
          blob: new Blob([z], { type: 'application/zip' }),
          filename: base + '_images.zip', label: 'ZIP (' + outs.length + ' images)',
          meta: A.fmtSize(z.length), toolId: 'pdf-to-jpg'
        });
      }
    } catch (e) { A.fail(e, 'pdf-to-jpg'); }
  }

  /* ================= JPG → PDF ================= */
  A.registerTool({
    id: 'jpg-to-pdf', icon: 'photo', color: 'var(--yellow)',
    title: 'JPG to PDF',
    desc: 'Turn images into a single PDF — with page size and margin options.',
    sub: 'Combine JPG, PNG or WebP images into one PDF. Drag to reorder them.',
    accept: '.jpg,.jpeg,.png,.webp,image/jpeg,image/png,image/webp', multiple: true, pickLabel: 'Select images',
    mount() {
      A.toolLanding(this, files => jpgToPdf(files));
    }
  });

  async function jpgToPdf(files) {
    A.processing('Reading images…');
    const items = [];
    try { for (const f of files) items.push(await imgItem(f)); }
    catch (e) { return A.fail(e, 'jpg-to-pdf'); }
    A.processingDone();

    const ws = A.workspace('JPG to PDF', 'Convert to PDF');
    const grid = A.el('<div class="fcards"></div>');
    ws.main.appendChild(grid);
    let pageSize = 'fit', margin = 'none';

    function redraw() {
      grid.innerHTML = '';
      items.forEach((it, i) => {
        const c = A.el('<div class="fcard" data-i="' + i + '">' +
          '<div class="thumb__acts"><button class="thumb__act" data-act="del" title="Remove">' + A.icon('trash') + '</button></div>' +
          '<div class="fcard__cv"></div>' +
          '<div class="fcard__name">' + A.esc(it.file.name) + '</div>' +
          '<div class="fcard__meta">' + it.w + '×' + it.h + '</div></div>');
        const im = new Image();
        im.src = it.dataUrl;
        im.style.cssText = 'max-height:170px;max-width:100%;width:auto;box-shadow:0 0 0 1px var(--line-soft)';
        c.querySelector('.fcard__cv').appendChild(im);
        c.querySelector('[data-act=del]').onclick = () => { items.splice(i, 1); redraw(); };
        grid.appendChild(c);
      });
      const add = A.el('<button class="addtile">' + A.icon('plus') + 'Add more images</button>');
      add.onclick = async () => {
        const more = await A.pickFiles('.jpg,.jpeg,.png,.webp', true);
        if (!more.length) return;
        A.processing('Reading images…');
        try { for (const f of more) items.push(await imgItem(f)); }
        catch (e) { return A.fail(e, 'jpg-to-pdf'); }
        A.processingDone(); redraw();
      };
      grid.appendChild(add);
      ws.setNote(items.length + ' image' + (items.length > 1 ? 's' : '') + ' → 1 PDF');
      ws.goBtn.disabled = !items.length;
    }
    redraw();
    A.makeSortable(grid, '.fcard', () => {
      const order = [...grid.querySelectorAll('.fcard')].map(c => items[+c.dataset.i]);
      items.length = 0; items.push(...order); redraw();
    });

    ws.sideBody.innerHTML =
      '<div class="opt"><span class="opt__lbl">Page size</span><div class="seg" id="segSize">' +
        '<button class="seg__btn seg__btn--on" data-v="fit">Fit image</button>' +
        '<button class="seg__btn" data-v="a4">A4 portrait</button>' +
        '<button class="seg__btn" data-v="a4l">A4 landscape</button>' +
      '</div></div>' +
      '<div class="opt"><span class="opt__lbl">Margin</span><div class="seg" id="segMargin">' +
        '<button class="seg__btn seg__btn--on" data-v="none">None</button>' +
        '<button class="seg__btn" data-v="small">Small</button>' +
        '<button class="seg__btn" data-v="big">Big</button>' +
      '</div></div>';
    for (const [segId, set] of [['#segSize', v => pageSize = v], ['#segMargin', v => margin = v]]) {
      const seg = ws.sideBody.querySelector(segId);
      seg.querySelectorAll('.seg__btn').forEach(b => b.onclick = () => {
        seg.querySelectorAll('.seg__btn').forEach(x => x.classList.remove('seg__btn--on'));
        b.classList.add('seg__btn--on');
        set(b.dataset.v);
      });
    }

    ws.goBtn.onclick = async () => {
      A.processing('Building PDF…');
      try {
        const pdoc = await A.PDFDocument.create();
        const mpt = margin === 'none' ? 0 : margin === 'small' ? 28 : 64;
        for (const it of items) {
          const img = it.kind === 'jpg' ? await pdoc.embedJpg(it.bytes) : await pdoc.embedPng(it.bytes);
          let pw, ph;
          if (pageSize === 'fit') { pw = img.width + mpt * 2; ph = img.height + mpt * 2; }
          else if (pageSize === 'a4') { pw = A4.w; ph = A4.h; }
          else { pw = A4.h; ph = A4.w; }
          const page = pdoc.addPage([pw, ph]);
          const availW = pw - mpt * 2, availH = ph - mpt * 2;
          const k = Math.min(availW / img.width, availH / img.height);
          const w = img.width * k, h = img.height * k;
          page.drawImage(img, { x: (pw - w) / 2, y: (ph - h) / 2, width: w, height: h });
        }
        const out = await pdoc.save();
        A.processingDone();
        A.doneScreen({
          heading: 'Images converted to PDF!',
          blob: new Blob([out], { type: 'application/pdf' }),
          filename: 'images.pdf', label: 'PDF',
          meta: items.length + ' page' + (items.length > 1 ? 's' : '') + ' · ' + A.fmtSize(out.length),
          toolId: 'jpg-to-pdf'
        });
      } catch (e) { A.fail(e, 'jpg-to-pdf'); }
    };
  }

  async function imgItem(file) {
    let bytes = await A.readBytes(file);
    let kind = /\.jpe?g$/i.test(file.name) || file.type === 'image/jpeg' ? 'jpg'
             : /\.png$/i.test(file.name) || file.type === 'image/png' ? 'png' : 'other';
    let dataUrl = await new Promise((res, rej) => {
      const r = new FileReader();
      r.onload = () => res(r.result); r.onerror = rej;
      r.readAsDataURL(file);
    });
    const dim = await new Promise((res, rej) => {
      const im = new Image();
      im.onload = () => res({ w: im.naturalWidth, h: im.naturalHeight, im });
      im.onerror = () => rej(new Error('Could not read image ' + file.name));
      im.src = dataUrl;
    });
    if (kind === 'other') { // webp etc → transcode to PNG so pdf-lib can embed it
      const cv = document.createElement('canvas');
      cv.width = dim.w; cv.height = dim.h;
      cv.getContext('2d').drawImage(dim.im, 0, 0);
      dataUrl = cv.toDataURL('image/png');
      bytes = Uint8Array.from(atob(dataUrl.split(',')[1]), c => c.charCodeAt(0));
      kind = 'png';
    }
    return { file, bytes, kind, dataUrl, w: dim.w, h: dim.h };
  }
})();
