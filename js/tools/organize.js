/* Organize PDF — reorder, delete, duplicate, rotate pages; append extra PDFs */
(function () {
  'use strict';
  const A = App;

  A.registerTool({
    id: 'organize', icon: 'layout-grid', color: 'var(--red)',
    title: 'Organize PDF',
    desc: 'Sort, delete, duplicate or rotate pages — drag them into the order you like.',
    sub: 'Drag pages to reorder them. Delete, duplicate or rotate any page, or add pages from another PDF.',
    accept: '.pdf', multiple: false,
    mount() {
      A.toolLanding(this, files => openWorkspace(files[0]));
    }
  });

  async function openWorkspace(file) {
    A.processing('Reading file…');
    const sources = []; // {bytes, doc}
    const items = [];   // {src, page (0-based), rot, canvas}
    let uid = 0;
    try {
      await addSource(await A.readBytes(file));
    } catch (e) { return A.fail(e, 'organize'); }

    async function addSource(bytes) {
      const doc = await A.loadPdfjs(bytes);
      const srcIdx = sources.length;
      sources.push({ bytes, doc });
      for (let i = 0; i < doc.numPages; i++) {
        items.push({ id: 'p' + (uid++), src: srcIdx, page: i, rot: 0, canvas: null });
      }
      return doc.numPages;
    }
    async function renderMissing() {
      for (const it of items) {
        if (it.canvas) continue;
        try {
          const page = await sources[it.src].doc.getPage(it.page + 1);
          const { canvas } = await A.renderPageCanvas(page, 150, window.devicePixelRatio || 1);
          it.canvas = canvas;
          const holder = grid.querySelector('[data-id=' + it.id + '] .thumb__cv');
          if (holder && !holder.firstChild) holder.appendChild(canvas);
        } catch (e) {}
      }
    }

    const ws = A.workspace('Organize PDF', 'Organize PDF');
    const grid = A.el('<div class="thumbs"></div>');
    ws.main.appendChild(grid);

    function redraw() {
      grid.innerHTML = '';
      items.forEach((it, i) => {
        const t = A.el('<div class="thumb thumb--touch" data-id="' + it.id + '">' +
          '<div class="thumb__acts">' +
            '<button class="thumb__act" data-act="rot" title="Rotate right">' + A.icon('rotate') + '</button>' +
            '<button class="thumb__act" data-act="dup" title="Duplicate page">' + A.icon('copy') + '</button>' +
            '<button class="thumb__act" data-act="del" title="Delete page">' + A.icon('trash') + '</button>' +
          '</div>' +
          '<div class="thumb__cv"></div><div class="thumb__lbl">' + (i + 1) + '</div></div>');
        const cv = t.querySelector('.thumb__cv');
        if (it.canvas) {
          cv.appendChild(it.canvas);
          it.canvas.style.transform = it.rot ? 'rotate(' + it.rot + 'deg)' : '';
          it.canvas.style.maxWidth = (it.rot % 180 === 90) ? '140px' : '';
        }
        t.querySelector('[data-act=rot]').onclick = () => { it.rot = (it.rot + 90) % 360; redraw(); };
        t.querySelector('[data-act=dup]').onclick = () => {
          const copy = { id: 'p' + (uid++), src: it.src, page: it.page, rot: it.rot, canvas: cloneCanvas(it.canvas) };
          items.splice(i + 1, 0, copy); redraw();
        };
        t.querySelector('[data-act=del]').onclick = () => { items.splice(i, 1); redraw(); };
        grid.appendChild(t);
      });
      const add = A.el('<button class="addtile" style="min-height:180px">' + A.icon('plus') + 'Add PDF</button>');
      add.onclick = async () => {
        const more = await A.pickFiles('.pdf', false);
        if (!more.length) return;
        A.processing('Reading file…');
        try { await addSource(await A.readBytes(more[0])); }
        catch (e) { return A.fail(e, 'organize'); }
        A.processingDone();
        redraw(); renderMissing();
      };
      grid.appendChild(add);
      ws.setNote(items.length + ' page' + (items.length > 1 ? 's' : '') + ' in final PDF');
      ws.goBtn.disabled = items.length === 0;
    }
    redraw();
    A.processingDone();
    renderMissing();

    function cloneCanvas(cv) {
      if (!cv) return null;
      const c = document.createElement('canvas');
      c.width = cv.width; c.height = cv.height;
      c.getContext('2d').drawImage(cv, 0, 0);
      return c;
    }

    A.makeSortable(grid, '.thumb', () => {
      const order = [...grid.querySelectorAll('.thumb')].map(t => items.find(it => it.id === t.dataset.id));
      items.length = 0; items.push(...order.filter(Boolean));
      redraw();
    });

    ws.sideBody.innerHTML =
      '<p style="font-size:14.5px;color:var(--muted);line-height:1.6">' +
      '<b style="color:var(--ink)">Drag</b> pages to reorder them.<br>' +
      'Use the buttons on each page to <b style="color:var(--ink)">rotate</b>, <b style="color:var(--ink)">duplicate</b> or <b style="color:var(--ink)">delete</b> it.<br>' +
      'Press <b style="color:var(--ink)">Add PDF</b> to append pages from another file, then drag them anywhere.</p>';

    ws.goBtn.onclick = async () => {
      A.processing('Building your PDF…');
      try {
        const srcDocs = [];
        for (const s of sources) srcDocs.push(await A.PDFDocument.load(s.bytes, { ignoreEncryption: true }));
        const out = await A.PDFDocument.create();
        for (const it of items) {
          const [p] = await out.copyPages(srcDocs[it.src], [it.page]);
          if (it.rot) p.setRotation(A.degrees(((p.getRotation().angle + it.rot) % 360 + 360) % 360));
          out.addPage(p);
        }
        const bytesOut = await out.save();
        A.processingDone();
        A.doneScreen({
          heading: 'Your PDF is organized!',
          blob: new Blob([bytesOut], { type: 'application/pdf' }),
          filename: file.name.replace(/\.pdf$/i, '') + '_organized.pdf', label: 'organized PDF',
          meta: items.length + ' pages · ' + A.fmtSize(bytesOut.length), toolId: 'organize'
        });
      } catch (e) { A.fail(e, 'organize'); }
    };
  }
})();
