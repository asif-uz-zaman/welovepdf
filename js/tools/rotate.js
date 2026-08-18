/* Rotate PDF */
(function () {
  'use strict';
  const A = App;

  A.registerTool({
    id: 'rotate', icon: 'rotate-clockwise-2', color: 'var(--purple)',
    title: 'Rotate PDF',
    desc: 'Rotate your PDF pages the way you need them — all at once or one by one.',
    sub: 'Rotate all pages together, or click the arrows on a page to rotate just that one.',
    accept: '.pdf', multiple: false,
    mount() {
      A.toolLanding(this, files => openWorkspace(files[0]));
    }
  });

  async function openWorkspace(file) {
    A.processing('Reading file…');
    let bytes, doc, n;
    try {
      bytes = await A.readBytes(file);
      doc = await A.loadPdfjs(bytes);
      n = doc.numPages;
    } catch (e) { return A.fail(e, 'rotate'); }

    const ws = A.workspace('Rotate PDF', 'Rotate PDF');
    const grid = A.el('<div class="thumbs"></div>');
    ws.main.appendChild(grid);

    const rot = new Array(n).fill(0); // extra rotation per page (deg clockwise)
    const thumbEls = [];

    for (let i = 0; i < n; i++) {
      const t = A.el('<div class="thumb thumb--touch" data-p="' + i + '">' +
        '<div class="thumb__acts">' +
          '<button class="thumb__act" data-act="ccw" title="Rotate left">' + A.icon('rotate-2') + '</button>' +
          '<button class="thumb__act" data-act="cw" title="Rotate right">' + A.icon('rotate') + '</button>' +
        '</div>' +
        '<div class="thumb__cv"></div><div class="thumb__lbl">' + (i + 1) + '</div></div>');
      t.querySelector('[data-act=cw]').onclick = () => turn(i, 90);
      t.querySelector('[data-act=ccw]').onclick = () => turn(i, -90);
      grid.appendChild(t);
      thumbEls.push(t);
    }
    A.processingDone();
    (async () => {
      for (let i = 0; i < n; i++) {
        try {
          const page = await doc.getPage(i + 1);
          const { canvas } = await A.renderPageCanvas(page, 150, window.devicePixelRatio || 1);
          thumbEls[i].querySelector('.thumb__cv').appendChild(canvas);
        } catch (e) {}
      }
    })();

    function turn(i, d) {
      rot[i] = ((rot[i] + d) % 360 + 360) % 360;
      const cv = thumbEls[i].querySelector('canvas');
      if (cv) {
        cv.style.transform = 'rotate(' + rot[i] + 'deg)';
        cv.style.maxWidth = (rot[i] % 180 === 90) ? '140px' : '';
      }
      syncNote();
    }
    function syncNote() {
      const c = rot.filter(r => r !== 0).length;
      ws.setNote(c ? c + ' page' + (c > 1 ? 's' : '') + ' will be rotated' : 'No rotation applied yet');
    }

    ws.sideBody.innerHTML =
      '<div class="opt"><span class="opt__lbl">Rotate all pages</span>' +
        '<div class="btnrow">' +
          '<button class="minibtn" id="allCcw">' + A.icon('rotate-2') + 'All left</button>' +
          '<button class="minibtn" id="allCw">' + A.icon('rotate') + 'All right</button>' +
          '<button class="minibtn" id="reset">' + A.icon('refresh') + 'Reset</button>' +
        '</div></div>' +
      '<p style="font-size:13.5px;color:var(--muted);line-height:1.55">Use the arrows on each page to rotate a single page. Rotation is applied when you press the red button.</p>';
    ws.sideBody.querySelector('#allCw').onclick = () => { for (let i = 0; i < n; i++) turn(i, 90); };
    ws.sideBody.querySelector('#allCcw').onclick = () => { for (let i = 0; i < n; i++) turn(i, -90); };
    ws.sideBody.querySelector('#reset').onclick = () => {
      for (let i = 0; i < n; i++) { rot[i] = 0; const cv = thumbEls[i].querySelector('canvas'); if (cv) { cv.style.transform = ''; cv.style.maxWidth = ''; } }
      syncNote();
    };
    syncNote();

    ws.goBtn.onclick = async () => {
      A.processing('Rotating pages…');
      try {
        const pdoc = await A.PDFDocument.load(bytes, { ignoreEncryption: true });
        pdoc.getPages().forEach((p, i) => {
          if (rot[i]) p.setRotation(A.degrees(((p.getRotation().angle + rot[i]) % 360 + 360) % 360));
        });
        const out = await pdoc.save();
        A.processingDone();
        A.doneScreen({
          heading: 'Your PDF has been rotated!',
          blob: new Blob([out], { type: 'application/pdf' }),
          filename: file.name.replace(/\.pdf$/i, '') + '_rotated.pdf', label: 'rotated PDF',
          meta: A.fmtSize(out.length), toolId: 'rotate'
        });
      } catch (e) { A.fail(e, 'rotate'); }
    };
  }
})();
