/* Merge PDF */
(function () {
  'use strict';
  const A = App;

  A.registerTool({
    id: 'merge', icon: 'arrow-merge', color: 'var(--red)',
    title: 'Merge PDF',
    desc: 'Combine PDFs in the order you want with the easiest PDF merger.',
    sub: 'Combine PDFs in the order you want. Drag files to reorder them.',
    accept: '.pdf', multiple: true, pickLabel: 'Select PDF files',
    mount() {
      A.toolLanding(this, files => openWorkspace(files));
    }
  });

  async function openWorkspace(files) {
    A.processing('Reading files…');
    const items = [];
    try {
      for (const f of files) items.push(await loadItem(f));
    } catch (e) { return A.fail(e, 'merge'); }
    A.processingDone();

    const ws = A.workspace('Merge PDF', 'Merge PDF');
    const grid = A.el('<div class="fcards"></div>');
    ws.main.appendChild(grid);
    ws.sideBody.innerHTML =
      '<p style="font-size:14.5px;color:var(--muted);line-height:1.55">Drag the file cards to set the order they will be merged in. ' +
      'The final PDF follows the order shown, left to right, top to bottom.</p>';

    function redraw() {
      grid.innerHTML = '';
      items.forEach((it, i) => {
        const c = A.el(
          '<div class="fcard" data-i="' + i + '">' +
            '<div class="thumb__acts"><button class="thumb__act" data-act="del" title="Remove file">' + A.icon('trash') + '</button></div>' +
            '<div class="fcard__cv"></div>' +
            '<div class="fcard__name">' + A.esc(it.file.name) + '</div>' +
            '<div class="fcard__meta">' + it.pageCount + ' page' + (it.pageCount > 1 ? 's' : '') + ' · ' + A.fmtSize(it.file.size) + '</div>' +
          '</div>');
        c.querySelector('.fcard__cv').appendChild(it.thumb);
        c.querySelector('[data-act=del]').onclick = () => { items.splice(i, 1); redraw(); };
        grid.appendChild(c);
      });
      const add = A.el('<button class="addtile">' + A.icon('plus') + 'Add more files</button>');
      add.onclick = async () => {
        const more = await A.pickFiles('.pdf', true);
        if (!more.length) return;
        A.processing('Reading files…');
        try { for (const f of more) items.push(await loadItem(f)); }
        catch (e) { return A.fail(e, 'merge'); }
        A.processingDone();
        redraw();
      };
      grid.appendChild(add);
      ws.setNote(items.length + ' file' + (items.length > 1 ? 's' : '') + ' · ' +
        items.reduce((s, it) => s + it.pageCount, 0) + ' pages total');
      ws.goBtn.disabled = items.length < 2;
    }
    redraw();

    A.makeSortable(grid, '.fcard', () => {
      const order = [...grid.querySelectorAll('.fcard')].map(c => items[+c.dataset.i]);
      items.length = 0; items.push(...order);
      redraw();
    });

    A.setDropHandler(async files => {
      const ok = A.filterByAccept(files, '.pdf');
      if (!ok.length) return;
      A.processing('Reading files…');
      try { for (const f of ok) items.push(await loadItem(f)); }
      catch (e) { return A.fail(e, 'merge'); }
      A.processingDone();
      redraw();
    });

    ws.goBtn.onclick = async () => {
      A.processing('Merging PDFs…');
      try {
        const out = await A.PDFDocument.create();
        for (const it of items) {
          const src = await A.PDFDocument.load(it.bytes, { ignoreEncryption: true });
          const pages = await out.copyPages(src, src.getPageIndices());
          pages.forEach(p => out.addPage(p));
        }
        const bytes = await out.save();
        A.processingDone();
        A.doneScreen({
          heading: 'PDFs have been merged!',
          blob: new Blob([bytes], { type: 'application/pdf' }),
          filename: 'merged.pdf', label: 'merged PDF',
          meta: A.fmtSize(bytes.length), toolId: 'merge'
        });
      } catch (e) { A.fail(e, 'merge'); }
    };
  }

  async function loadItem(file) {
    const bytes = await A.readBytes(file);
    const doc = await A.loadPdfjs(bytes);
    const page = await doc.getPage(1);
    const { canvas } = await A.renderPageCanvas(page, 160, window.devicePixelRatio || 1);
    const pageCount = doc.numPages;
    doc.destroy();
    return { file, bytes, pageCount, thumb: canvas };
  }
})();
