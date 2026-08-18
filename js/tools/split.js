/* Split PDF — range mode + extract mode */
(function () {
  'use strict';
  const A = App;

  A.registerTool({
    id: 'split', icon: 'scissors', color: 'var(--red)',
    title: 'Split PDF',
    desc: 'Separate one page or a whole set for easy conversion into independent PDF files.',
    sub: 'Split by page ranges or extract the exact pages you need.',
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
    } catch (e) { return A.fail(e, 'split'); }

    const ws = A.workspace('Split PDF', 'Split PDF');
    const grid = A.el('<div class="thumbs"></div>');
    ws.main.appendChild(grid);

    // state
    let mode = 'range';                 // 'range' | 'extract'
    const ranges = [{ from: 1, to: n }];
    const selected = new Set();         // extract mode selection (1-based)
    let mergeOut = false;

    // thumbnails
    const thumbEls = [];
    for (let i = 1; i <= n; i++) {
      const t = A.el('<div class="thumb" data-p="' + i + '"><div class="thumb__cv"></div>' +
        '<div class="thumb__lbl">' + i + '</div></div>');
      t.onclick = () => {
        if (mode !== 'extract') return;
        if (selected.has(i)) selected.delete(i); else selected.add(i);
        t.classList.toggle('thumb--sel', selected.has(i));
        syncNote();
      };
      grid.appendChild(t);
      thumbEls.push(t);
    }
    A.processingDone();
    // render thumbs lazily (sequential, keeps UI responsive)
    (async () => {
      for (let i = 1; i <= n; i++) {
        try {
          const page = await doc.getPage(i);
          const { canvas } = await A.renderPageCanvas(page, 150, window.devicePixelRatio || 1);
          thumbEls[i - 1].querySelector('.thumb__cv').appendChild(canvas);
        } catch (e) { /* keep going */ }
      }
    })();

    // sidebar
    function drawSide() {
      ws.sideBody.innerHTML =
        '<div class="opt"><span class="opt__lbl">Split mode</span>' +
          '<div class="seg">' +
            '<button class="seg__btn' + (mode === 'range' ? ' seg__btn--on' : '') + '" data-m="range">By ranges</button>' +
            '<button class="seg__btn' + (mode === 'extract' ? ' seg__btn--on' : '') + '" data-m="extract">Extract pages</button>' +
          '</div></div>' +
        '<div id="modeBody"></div>' +
        '<label class="chk"><input type="checkbox" id="mergeOut"' + (mergeOut ? ' checked' : '') + '> Merge everything into one PDF</label>';
      ws.sideBody.querySelectorAll('.seg__btn').forEach(b => b.onclick = () => { mode = b.dataset.m; drawSide(); syncSelClass(); });
      ws.sideBody.querySelector('#mergeOut').onchange = e => { mergeOut = e.target.checked; };
      const body = ws.sideBody.querySelector('#modeBody');

      if (mode === 'range') {
        body.innerHTML = '<div class="opt"><span class="opt__lbl">Page ranges</span><div id="rangeRows"></div>' +
          '<button class="minibtn" id="addRange">' + A.icon('plus') + 'Add range</button></div>';
        const rows = body.querySelector('#rangeRows');
        function drawRows() {
          rows.innerHTML = '';
          ranges.forEach((r, i) => {
            const row = A.el('<div class="rangerow">' +
              '<span class="rangerow__x">Range ' + (i + 1) + '</span>' +
              '<input class="fld" type="number" min="1" max="' + n + '" value="' + r.from + '" data-k="from">' +
              '<span class="rangerow__x">to</span>' +
              '<input class="fld" type="number" min="1" max="' + n + '" value="' + r.to + '" data-k="to">' +
              (ranges.length > 1 ? '<button class="iconbtn" data-act="del" title="Remove range">' + A.icon('x') + '</button>' : '') +
            '</div>');
            row.querySelectorAll('input').forEach(inp => inp.onchange = () => {
              r[inp.dataset.k] = Math.min(n, Math.max(1, parseInt(inp.value) || 1));
              inp.value = r[inp.dataset.k];
              syncNote();
            });
            const del = row.querySelector('[data-act=del]');
            if (del) del.onclick = () => { ranges.splice(i, 1); drawRows(); syncNote(); };
            rows.appendChild(row);
          });
        }
        drawRows();
        body.querySelector('#addRange').onclick = () => {
          const last = ranges[ranges.length - 1];
          ranges.push({ from: Math.min(n, last.to + 1), to: n });
          drawRows(); syncNote();
        };
      } else {
        body.innerHTML =
          '<div class="opt"><span class="opt__lbl">Pages to extract</span>' +
          '<p style="font-size:13.5px;color:var(--muted);margin-bottom:10px">Click pages to select them, or type page numbers below (e.g. <b>1,3-5,8</b>).</p>' +
          '<input class="fld" id="pageSpec" placeholder="e.g. 1,3-5,8" value="' + selSpec() + '">' +
          '<div class="btnrow" style="margin-top:10px">' +
            '<button class="minibtn" id="selAll">Select all</button>' +
            '<button class="minibtn" id="selNone">Clear</button>' +
          '</div></div>';
        body.querySelector('#pageSpec').onchange = e => {
          selected.clear();
          parseSpec(e.target.value, n).forEach(p => selected.add(p));
          syncSelClass(); syncNote();
        };
        body.querySelector('#selAll').onclick = () => { for (let i = 1; i <= n; i++) selected.add(i); syncSelClass(); syncNote(); drawSide(); };
        body.querySelector('#selNone').onclick = () => { selected.clear(); syncSelClass(); syncNote(); drawSide(); };
      }
      syncNote();
    }
    function selSpec() {
      const s = [...selected].sort((a, b) => a - b);
      const parts = [];
      for (let i = 0; i < s.length;) {
        let j = i;
        while (j + 1 < s.length && s[j + 1] === s[j] + 1) j++;
        parts.push(j > i ? s[i] + '-' + s[j] : String(s[i]));
        i = j + 1;
      }
      return parts.join(',');
    }
    function syncSelClass() {
      thumbEls.forEach((t, idx) => t.classList.toggle('thumb--sel', mode === 'extract' && selected.has(idx + 1)));
    }
    function syncNote() {
      if (mode === 'range') {
        const bad = ranges.some(r => r.from > r.to);
        ws.setNote(bad ? '⚠ A range has "from" greater than "to"' :
          ranges.length + ' range' + (ranges.length > 1 ? 's' : '') + ' → ' + (mergeOut ? '1 PDF' : ranges.length + ' PDF' + (ranges.length > 1 ? 's' : '')));
        ws.goBtn.disabled = bad;
      } else {
        ws.setNote(selected.size ? selected.size + ' page' + (selected.size > 1 ? 's' : '') + ' selected' : 'No pages selected');
        ws.goBtn.disabled = selected.size === 0;
      }
    }
    drawSide();

    ws.goBtn.onclick = async () => {
      A.processing('Splitting PDF…');
      try {
        const src = await A.PDFDocument.load(bytes, { ignoreEncryption: true });
        const jobs = []; // [{name, indices}]
        const base = file.name.replace(/\.pdf$/i, '');
        if (mode === 'range') {
          ranges.forEach((r, i) => {
            const idx = [];
            for (let p = r.from; p <= r.to; p++) idx.push(p - 1);
            jobs.push({ name: base + '_range' + (i + 1) + '_' + r.from + '-' + r.to + '.pdf', indices: idx });
          });
        } else {
          const s = [...selected].sort((a, b) => a - b);
          if (mergeOut) jobs.push({ name: base + '_extracted.pdf', indices: s.map(p => p - 1) });
          else s.forEach(p => jobs.push({ name: base + '_page' + p + '.pdf', indices: [p - 1] }));
        }
        if (mode === 'range' && mergeOut) {
          const all = jobs.flatMap(j => j.indices);
          jobs.length = 0;
          jobs.push({ name: base + '_split_merged.pdf', indices: all });
        }
        const outputs = [];
        for (const j of jobs) {
          const out = await A.PDFDocument.create();
          const pages = await out.copyPages(src, j.indices);
          pages.forEach(p => out.addPage(p));
          outputs.push({ name: j.name, bytes: await out.save() });
        }
        A.processingDone();
        if (outputs.length === 1) {
          A.doneScreen({
            heading: 'Your PDF has been split!',
            blob: new Blob([outputs[0].bytes], { type: 'application/pdf' }),
            filename: outputs[0].name, label: 'PDF',
            meta: A.fmtSize(outputs[0].bytes.length), toolId: 'split'
          });
        } else {
          const entries = {};
          outputs.forEach(o => entries[o.name] = o.bytes);
          const z = await A.zip(entries);
          A.doneScreen({
            heading: 'Your PDF has been split!',
            blob: new Blob([z], { type: 'application/zip' }),
            filename: base + '_split.zip', label: 'ZIP (' + outputs.length + ' files)',
            meta: A.fmtSize(z.length), toolId: 'split'
          });
        }
      } catch (e) { A.fail(e, 'split'); }
    };

    return () => { try { doc.destroy(); } catch (e) {} };
  }

  function parseSpec(spec, n) {
    const out = new Set();
    for (const part of String(spec).split(',')) {
      const m = part.trim().match(/^(\d+)(?:\s*-\s*(\d+))?$/);
      if (!m) continue;
      const a = +m[1], b = m[2] ? +m[2] : a;
      for (let p = Math.min(a, b); p <= Math.max(a, b); p++) if (p >= 1 && p <= n) out.add(p);
    }
    return [...out];
  }
})();
