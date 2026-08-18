/* Fill PDF forms — detects AcroForm fields, overlays live inputs, writes real field values.
   Falls back to the editor's type-anywhere mode when a PDF has no form fields. */
(function () {
  'use strict';
  const A = App;

  A.registerTool({
    id: 'forms', icon: 'forms', color: 'var(--purple)',
    title: 'Fill PDF Form',
    desc: 'Fill interactive form fields — text boxes, checkboxes, radio buttons and lists.',
    sub: 'Interactive form fields are detected automatically. If a form has no fields, you can type anywhere instead.',
    accept: '.pdf', multiple: false,
    mount() {
      A.toolLanding(this, files => openForm(files[0]));
    }
  });

  async function openForm(file) {
    A.processing('Detecting form fields…');
    let bytes, pdoc, fields;
    try {
      bytes = await A.readBytes(file);
      pdoc = await A.PDFDocument.load(bytes, { ignoreEncryption: true });
      fields = pdoc.getForm().getFields();
    } catch (e) { return A.fail(e, 'forms'); }

    if (!fields.length) {
      A.processingDone();
      const v = document.getElementById('view');
      v.innerHTML = '';
      v.appendChild(A.el(
        '<section class="done"><h1>No form fields in this PDF</h1>' +
        '<p class="done__meta" style="max-width:460px">This file has no interactive fields. You can still fill it by typing anywhere on the pages with the editor.</p>' +
        '<button class="done__dl" id="typeAnywhere">' + A.icon('letter-t') + 'Type on this PDF</button>' +
        '<a class="done__again" href="#forms">' + A.icon('refresh') + 'Choose another file</a></section>'));
      v.querySelector('#typeAnywhere').onclick = () => window.__openEditor(file, 'forms');
      return;
    }

    // map widget dict -> page index
    const pageOfDict = new Map();
    pdoc.getPages().forEach((pg, pi) => {
      const annots = pg.node.Annots && pg.node.Annots();
      if (!annots) return;
      for (let i = 0; i < annots.size(); i++) {
        try { pageOfDict.set(annots.lookup(i), pi); } catch (e) {}
      }
    });

    let doc;
    try { doc = await A.loadPdfjs(bytes); } catch (e) { return A.fail(e, 'forms'); }

    const v = document.getElementById('view');
    v.innerHTML = '';
    const root = A.el(
      '<section class="ed">' +
        '<div class="ed__bar">' +
          '<span style="font-weight:700;color:var(--ink);font-size:15.5px;padding:0 6px">' + A.icon('forms') + ' Fill PDF form</span>' +
          '<span class="ed__sep"></span>' +
          '<span style="font-size:13.5px;color:var(--muted)" id="fCount"></span>' +
          '<span class="ed__spacer"></span>' +
          '<label class="chk" style="padding:0 10px 0 0"><input type="checkbox" id="flatten" checked> Flatten (lock fields)</label>' +
          '<button class="ed__save" id="fSave">' + A.icon('download') + 'Fill PDF</button>' +
        '</div>' +
        '<div class="ed__pages" id="fPages"></div>' +
      '</section>');
    v.appendChild(root);
    const pagesBox = root.querySelector('#fPages');

    // build page canvases + input overlays
    const values = new Map();   // fieldName -> value (string | bool | array)
    const avail = Math.min(860, Math.max(320, pagesBox.clientWidth ? pagesBox.clientWidth - 28 : 820));
    const pageInfos = [];
    for (let i = 1; i <= doc.numPages; i++) {
      const page = await doc.getPage(i);
      const vp1 = page.getViewport({ scale: 1 });
      const sc = avail / vp1.width;
      const dpr = Math.min(2, window.devicePixelRatio || 1);
      const wrap = A.el('<div class="edpage"><canvas class="edpage__cv"></canvas><div class="edpage__ovl" style="z-index:4"></div></div>');
      const cv = wrap.querySelector('canvas');
      const cssW = vp1.width * sc, cssH = vp1.height * sc;
      wrap.style.width = cssW + 'px'; wrap.style.height = cssH + 'px';
      const vp = page.getViewport({ scale: sc * dpr });
      cv.width = Math.floor(vp.width); cv.height = Math.floor(vp.height);
      cv.style.width = cssW + 'px'; cv.style.height = cssH + 'px';
      // Attach before rendering: a canvas still owned by the <template> inert document
      // cannot resolve fonts, so page text would silently fail to paint.
      pagesBox.appendChild(wrap);
      await page.render({ canvasContext: cv.getContext('2d'), viewport: vp }).promise;
      pageInfos.push({ ovl: wrap.querySelector('.edpage__ovl'), vp1, sc });
    }

    // place widgets
    let placed = 0, skipped = 0;
    for (const field of fields) {
      const name = field.getName();
      const widgets = field.acroField.getWidgets();
      widgets.forEach((w, wi) => {
        const pi = pageOfDict.get(w.dict);
        if (pi === undefined) { skipped++; return; }
        const info = pageInfos[pi];
        const r = w.getRectangle();
        const [u1, v1] = info.vp1.convertToViewportPoint(r.x, r.y);
        const [u2, v2] = info.vp1.convertToViewportPoint(r.x + r.width, r.y + r.height);
        const css = {
          left: Math.min(u1, u2) * info.sc, top: Math.min(v1, v2) * info.sc,
          w: Math.abs(u2 - u1) * info.sc, h: Math.abs(v2 - v1) * info.sc
        };
        const node = buildInput(field, wi, css, values);
        if (node) {
          node.style.left = css.left + 'px';
          node.style.top = css.top + 'px';
          node.style.width = css.w + 'px';
          node.style.height = css.h + 'px';
          info.ovl.appendChild(node);
          placed++;
        } else skipped++;
      });
    }
    root.querySelector('#fCount').textContent =
      fields.length + ' field' + (fields.length > 1 ? 's' : '') + ' detected' + (skipped ? ' (' + skipped + ' unsupported)' : '');
    A.processingDone();

    root.querySelector('#fSave').onclick = async () => {
      A.processing('Filling your form…');
      try {
        const outDoc = await A.PDFDocument.load(bytes, { ignoreEncryption: true });
        const form = outDoc.getForm();
        const warnings = [];
        for (const field of fields) {
          const name = field.getName();
          if (!values.has(name)) continue;
          const val = values.get(name);
          try {
            const f = form.getField(name);
            if (f instanceof PDFLib.PDFTextField) f.setText(String(val));
            else if (f instanceof PDFLib.PDFCheckBox) { val ? f.check() : f.uncheck(); }
            else if (f instanceof PDFLib.PDFRadioGroup) { if (val) f.select(String(val)); }
            else if (f instanceof PDFLib.PDFDropdown) { if (val) f.select(String(val)); }
            else if (f instanceof PDFLib.PDFOptionList) { if (Array.isArray(val)) f.select(val); }
          } catch (err) {
            // WinAnsi can't encode some characters — retry with a stripped value
            try {
              const f = form.getField(name);
              if (f instanceof PDFLib.PDFTextField) {
                f.setText(String(val).replace(/[^\x20-\xFE\n\r\t]/g, '?'));
                warnings.push(name);
              }
            } catch (err2) { warnings.push(name); }
          }
        }
        try { form.updateFieldAppearances(); } catch (e) {}
        if (root.querySelector('#flatten').checked) {
          try { form.flatten(); } catch (e) { /* some forms refuse to flatten — keep interactive */ }
        }
        const out = await outDoc.save();
        A.processingDone();
        A.doneScreen({
          heading: 'Your form has been filled!',
          blob: new Blob([out], { type: 'application/pdf' }),
          filename: file.name.replace(/\.pdf$/i, '') + '_filled.pdf', label: 'filled PDF',
          meta: A.fmtSize(out.length) + (warnings.length ? ' · some special characters were replaced' : ''),
          toolId: 'forms'
        });
      } catch (e) { A.fail(e, 'forms'); }
    };

    return () => { try { doc.destroy(); } catch (e) {} };
  }

  function buildInput(field, widgetIndex, css, values) {
    const name = field.getName();
    const F = PDFLib;
    if (field instanceof F.PDFTextField) {
      let multi = false;
      try { multi = field.isMultiline(); } catch (e) {}
      const node = document.createElement(multi ? 'textarea' : 'input');
      node.className = 'ffld';
      node.style.fontSize = Math.max(11, Math.min(16, css.h * (multi ? 0.22 : 0.55))) + 'px';
      try { node.value = field.getText() || ''; if (node.value) values.set(name, node.value); } catch (e) {}
      node.placeholder = '…';
      node.oninput = () => values.set(name, node.value);
      return node;
    }
    if (field instanceof F.PDFCheckBox) {
      const node = document.createElement('div');
      node.className = 'ffld ffld--chk';
      node.setAttribute('role', 'checkbox');
      node.tabIndex = 0;
      let on = false;
      try { on = field.isChecked(); } catch (e) {}
      const sync = () => {
        node.textContent = on ? '✓' : '';
        node.style.fontSize = Math.max(10, css.h * 0.75) + 'px';
        node.setAttribute('aria-checked', String(on));
        values.set(name, on);
      };
      sync();
      const toggle = () => { on = !on; sync(); };
      node.onclick = toggle;
      node.onkeydown = e => { if (e.key === ' ' || e.key === 'Enter') { e.preventDefault(); toggle(); } };
      return node;
    }
    if (field instanceof F.PDFRadioGroup) {
      let opts = [];
      try { opts = field.getOptions(); } catch (e) {}
      const myOpt = opts[widgetIndex] !== undefined ? opts[widgetIndex] : opts[0];
      if (myOpt === undefined) return null;
      const node = document.createElement('div');
      node.className = 'ffld ffld--chk';
      node.setAttribute('role', 'radio');
      node.tabIndex = 0;
      node.dataset.radio = name;
      node.dataset.opt = myOpt;
      let selected = null;
      try { selected = field.getSelected(); } catch (e) {}
      const syncAll = () => {
        document.querySelectorAll('[data-radio="' + CSS.escape(name) + '"]').forEach(n => {
          const on = values.get(name) === n.dataset.opt;
          n.textContent = on ? '●' : '';
          n.style.fontSize = Math.max(8, css.h * 0.55) + 'px';
          n.setAttribute('aria-checked', String(on));
        });
      };
      if (selected === myOpt) values.set(name, myOpt);
      node.onclick = () => { values.set(name, myOpt); syncAll(); };
      node.onkeydown = e => { if (e.key === ' ' || e.key === 'Enter') { e.preventDefault(); node.click(); } };
      setTimeout(syncAll, 0);
      return node;
    }
    if (field instanceof F.PDFDropdown || field instanceof F.PDFOptionList) {
      const node = document.createElement('select');
      node.className = 'ffld';
      const isList = field instanceof F.PDFOptionList;
      if (isList) node.multiple = true;
      let opts = [];
      try { opts = field.getOptions(); } catch (e) {}
      if (!isList) node.appendChild(new Option('— select —', ''));
      for (const o of opts) node.appendChild(new Option(o, o));
      try {
        const sel = field.getSelected();
        if (sel && sel.length) {
          [...node.options].forEach(op => { if (sel.includes(op.value)) op.selected = true; });
          values.set(name, isList ? sel : sel[0]);
        }
      } catch (e) {}
      node.onchange = () => {
        values.set(name, isList ? [...node.selectedOptions].map(o => o.value) : node.value);
      };
      return node;
    }
    return null; // signatures & exotic types
  }
})();
