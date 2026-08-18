/* Edit PDF — add text, images, shapes, freehand; white-out to remove content.
   Elements are stored in viewport units (PDF points in display orientation, origin top-left).
   On save each page's overlay is rasterized to a transparent PNG and drawn over the page,
   mapped through pdf.js viewport→PDF conversion so rotated pages come out right. */
(function () {
  'use strict';
  const A = App;
  const ES = 2.5; // export supersampling (px per viewport unit ≈ 180 dpi)

  A.registerTool({
    id: 'edit', icon: 'pencil', color: 'var(--purple)',
    title: 'Edit PDF',
    desc: 'Add text, images, shapes or drawings — and white-out anything you want to remove.',
    sub: 'Add text, images, shapes and freehand drawings. Use White-out to cover content you want gone.',
    accept: '.pdf', multiple: false,
    mount() {
      A.toolLanding(this, files => openEditor(files[0], 'edit'));
    }
  });

  async function openEditor(file, toolId) {
    A.processing('Opening PDF…');
    let bytes, doc;
    try {
      bytes = await A.readBytes(file);
      doc = await A.loadPdfjs(bytes);
    } catch (e) { return A.fail(e, toolId); }

    const v = document.getElementById('view');
    v.innerHTML = '';
    const root = A.el(
      '<section class="ed">' +
        '<div class="ed__bar" role="toolbar" aria-label="Editor tools">' +
          tbtn('select', 'arrows-diagonal', 'Select') +
          tbtn('text', 'letter-t', 'Text') +
          tbtn('image', 'photo', 'Image') +
          tbtn('draw', 'scribble', 'Draw') +
          tbtn('rect', 'square', 'Box') +
          tbtn('ellipse', 'circle', 'Circle') +
          tbtn('highlight', 'highlight', 'Highlight') +
          tbtn('whiteout', 'eraser', 'White-out') +
          '<span class="ed__sep"></span>' +
          '<span class="ed__props"><label for="edColor">Color</label><input type="color" id="edColor" value="#161616">' +
          '<label for="edSize">Size</label><input type="number" id="edSize" min="6" max="120" value="16"></span>' +
          '<button class="ed__tool" id="edUndo" title="Undo last stroke">' + A.icon('rotate-2') + '<span class="ed__toollbl">Undo stroke</span></button>' +
          '<span class="ed__spacer"></span>' +
          '<span class="ed__zoom">' +
            '<button class="ed__tool" id="zoomOut" aria-label="Zoom out">−</button><span id="zoomLbl">100%</span>' +
            '<button class="ed__tool" id="zoomIn" aria-label="Zoom in">+</button>' +
          '</span>' +
          '<button class="ed__save" id="edSave">' + A.icon('download') + 'Save PDF</button>' +
        '</div>' +
        '<div class="ed__pages" id="edPages"></div>' +
      '</section>');
    v.appendChild(root);

    function tbtn(id, icn, label) {
      return '<button class="ed__tool" data-tool="' + id + '" title="' + label + '">' + A.icon(icn) + '<span class="ed__toollbl">' + label + '</span></button>';
    }

    const pagesBox = root.querySelector('#edPages');
    const colorInp = root.querySelector('#edColor');
    const sizeInp = root.querySelector('#edSize');
    const state = {
      tool: 'select', zoom: 1, selected: null, pendingImage: null,
      strokeUndo: [] // [{page, el}]
    };
    const pages = []; // {num,pdfjsPage,vpW,vpH,fitScale,wrap,cv,drawCv,ovl,elements:[]}

    /* ---------- build pages ---------- */
    const avail = Math.min(860, Math.max(320, pagesBox.clientWidth ? pagesBox.clientWidth - 28 : 820));
    for (let i = 1; i <= doc.numPages; i++) {
      const page = await doc.getPage(i);
      const vp1 = page.getViewport({ scale: 1 });
      const p = {
        num: i, pdfjsPage: page, vpW: vp1.width, vpH: vp1.height,
        fitScale: avail / vp1.width, elements: []
      };
      const wrap = A.el('<div class="edpage"><canvas class="edpage__cv"></canvas>' +
        '<canvas class="edpage__draw"></canvas><div class="edpage__ovl"></div></div>');
      p.wrap = wrap;
      p.cv = wrap.querySelector('.edpage__cv');
      p.drawCv = wrap.querySelector('.edpage__draw');
      p.ovl = wrap.querySelector('.edpage__ovl');
      pagesBox.appendChild(wrap);
      pages.push(p);
      bindPagePointerEvents(p);
    }
    await rerenderAll();
    A.processingDone();

    function s(p) { return p.fitScale * state.zoom; }

    async function rerenderAll() {
      for (const p of pages) {
        const sc = s(p), dpr = Math.min(2, window.devicePixelRatio || 1);
        const cssW = p.vpW * sc, cssH = p.vpH * sc;
        p.wrap.style.width = cssW + 'px';
        p.wrap.style.height = cssH + 'px';
        const vp = p.pdfjsPage.getViewport({ scale: sc * dpr });
        p.cv.width = Math.floor(vp.width); p.cv.height = Math.floor(vp.height);
        p.cv.style.width = cssW + 'px'; p.cv.style.height = cssH + 'px';
        await p.pdfjsPage.render({ canvasContext: p.cv.getContext('2d'), viewport: vp }).promise;
        p.drawCv.width = Math.floor(cssW * dpr); p.drawCv.height = Math.floor(cssH * dpr);
        p.drawCv.style.width = cssW + 'px'; p.drawCv.style.height = cssH + 'px';
        redrawStrokes(p);
        for (const elm of p.elements) positionEl(p, elm);
      }
    }

    /* ---------- element DOM ---------- */
    function addElement(p, elm) {
      p.elements.push(elm);
      if (elm.type === 'path') { redrawStrokes(p); return; }
      const node = buildNode(p, elm);
      elm.node = node;
      p.ovl.appendChild(node);
      positionEl(p, elm);
    }
    function buildNode(p, elm) {
      let node;
      if (elm.type === 'text') {
        node = A.el('<div class="edel edel--text" tabindex="0"></div>');
        node.textContent = elm.text;
        node.addEventListener('dblclick', () => editText(p, elm));
      } else if (elm.type === 'image') {
        node = A.el('<div class="edel edel--img"><img alt=""></div>');
        node.querySelector('img').src = elm.dataUrl;
      } else {
        node = A.el('<div class="edel edel--shape"></div>');
      }
      node.addEventListener('pointerdown', e => onElPointerDown(e, p, elm));
      return node;
    }
    function positionEl(p, elm) {
      if (elm.type === 'path' || !elm.node) return;
      const sc = s(p), st = elm.node.style;
      st.left = elm.x * sc + 'px';
      st.top = elm.y * sc + 'px';
      if (elm.type === 'text') {
        st.width = elm.w ? elm.w * sc + 'px' : 'auto';
        st.fontSize = elm.size * sc + 'px';
        st.color = elm.color;
      } else {
        st.width = elm.w * sc + 'px';
        st.height = elm.h * sc + 'px';
        if (elm.type === 'whiteout') { st.background = '#fff'; st.border = '1px dashed rgba(0,0,0,.25)'; }
        else if (elm.type === 'highlight') st.background = 'rgba(255,224,80,.45)';
        else if (elm.type === 'rect') { st.border = Math.max(1.5, elm.stroke * sc) + 'px solid ' + elm.color; st.background = 'transparent'; }
        else if (elm.type === 'ellipse') { st.border = Math.max(1.5, elm.stroke * sc) + 'px solid ' + elm.color; st.borderRadius = '50%'; st.background = 'transparent'; }
      }
    }
    function redrawStrokes(p) {
      const dpr = Math.min(2, window.devicePixelRatio || 1);
      const ctx = p.drawCv.getContext('2d');
      ctx.clearRect(0, 0, p.drawCv.width, p.drawCv.height);
      const sc = s(p) * dpr;
      for (const elm of p.elements) {
        if (elm.type !== 'path') continue;
        drawPath(ctx, elm, sc);
      }
    }
    function drawPath(ctx, elm, sc) {
      if (elm.points.length < 2) return;
      ctx.strokeStyle = elm.color;
      ctx.lineWidth = elm.width * sc;
      ctx.lineCap = 'round'; ctx.lineJoin = 'round';
      ctx.beginPath();
      ctx.moveTo(elm.points[0][0] * sc, elm.points[0][1] * sc);
      for (let i = 1; i < elm.points.length; i++) ctx.lineTo(elm.points[i][0] * sc, elm.points[i][1] * sc);
      ctx.stroke();
    }

    /* ---------- selection / move / resize ---------- */
    function select(p, elm) {
      deselect();
      state.selected = { p, elm };
      elm.node.classList.add('edel--sel');
      const x = A.el('<button class="edel__x" aria-label="Delete">✕</button>');
      x.onclick = e => { e.stopPropagation(); removeEl(p, elm); };
      x.addEventListener('pointerdown', e => e.stopPropagation());
      elm.node.appendChild(x);
      if (elm.type !== 'text' || true) {
        const rs = A.el('<span class="edel__rs" aria-hidden="true"></span>');
        rs.addEventListener('pointerdown', e => startResize(e, p, elm));
        elm.node.appendChild(rs);
      }
      if (elm.type === 'text') { colorInp.value = elm.color; sizeInp.value = elm.size; }
      else if (elm.type === 'rect' || elm.type === 'ellipse' || elm.type === 'path') colorInp.value = elm.color;
    }
    function deselect() {
      if (!state.selected) return;
      const { elm } = state.selected;
      if (elm.node) {
        elm.node.classList.remove('edel--sel');
        elm.node.querySelectorAll('.edel__x,.edel__rs').forEach(n => n.remove());
        if (elm.type === 'text' && elm.node.isContentEditable) commitText(state.selected.p, elm);
      }
      state.selected = null;
    }
    function removeEl(p, elm) {
      const i = p.elements.indexOf(elm);
      if (i >= 0) p.elements.splice(i, 1);
      elm.node && elm.node.remove();
      if (state.selected && state.selected.elm === elm) state.selected = null;
    }
    function onElPointerDown(e, p, elm) {
      if (state.tool !== 'select' && state.tool !== 'text') return;
      if (elm.node.isContentEditable) return;
      e.stopPropagation();
      if (!state.selected || state.selected.elm !== elm) select(p, elm);
      // drag-move
      const sc = s(p), sx = e.clientX, sy = e.clientY, ox = elm.x, oy = elm.y;
      let moved = false;
      const move = ev => {
        const dx = (ev.clientX - sx) / sc, dy = (ev.clientY - sy) / sc;
        if (!moved && Math.hypot(ev.clientX - sx, ev.clientY - sy) > 3) moved = true;
        if (moved) { elm.x = ox + dx; elm.y = oy + dy; positionEl(p, elm); }
      };
      const up = () => {
        window.removeEventListener('pointermove', move);
        window.removeEventListener('pointerup', up);
      };
      window.addEventListener('pointermove', move);
      window.addEventListener('pointerup', up);
    }
    function startResize(e, p, elm) {
      e.stopPropagation(); e.preventDefault();
      const sc = s(p), sx = e.clientX, sy = e.clientY;
      const ow = elm.w || (elm.node.offsetWidth / sc), oh = elm.h || (elm.node.offsetHeight / sc);
      const ratio = elm.type === 'image' ? ow / oh : null;
      const move = ev => {
        let nw = Math.max(12, ow + (ev.clientX - sx) / sc);
        let nh = Math.max(12, oh + (ev.clientY - sy) / sc);
        if (ratio) nh = nw / ratio;
        elm.w = nw;
        if (elm.type !== 'text') elm.h = nh;
        positionEl(p, elm);
      };
      const up = () => {
        window.removeEventListener('pointermove', move);
        window.removeEventListener('pointerup', up);
      };
      window.addEventListener('pointermove', move);
      window.addEventListener('pointerup', up);
    }

    /* ---------- text editing ---------- */
    function editText(p, elm) {
      elm.node.contentEditable = 'true';
      elm.node.focus();
      const range = document.createRange();
      range.selectNodeContents(elm.node);
      const sel = window.getSelection();
      sel.removeAllRanges(); sel.addRange(range);
      const onBlur = () => { commitText(p, elm); elm.node.removeEventListener('blur', onBlur); };
      elm.node.addEventListener('blur', onBlur);
    }
    function commitText(p, elm) {
      elm.node.contentEditable = 'false';
      elm.text = elm.node.innerText.replace(/ /g, ' ');
      if (!elm.text.trim()) removeEl(p, elm);
    }

    /* ---------- page pointer events (create tools) ---------- */
    function bindPagePointerEvents(p) {
      const ovl = p.ovl;
      ovl.addEventListener('pointerdown', e => {
        const sc = s(p), r = ovl.getBoundingClientRect();
        const x = (e.clientX - r.left) / sc, y = (e.clientY - r.top) / sc;
        if (state.tool === 'select') { deselect(); return; }
        e.preventDefault();

        if (state.tool === 'text') {
          deselect();
          const elm = { type: 'text', x, y: y - 10, w: 0, text: 'Type here', size: +sizeInp.value || 16, color: colorInp.value };
          addElement(p, elm);
          select(p, elm);
          setTool('select');
          setTimeout(() => editText(p, elm), 0);
          return;
        }
        if (state.tool === 'image' && state.pendingImage) {
          const im = state.pendingImage;
          const w = Math.min(220, p.vpW * 0.5);
          const h = w * im.h / im.w;
          const elm = { type: 'image', x: x - w / 2, y: y - h / 2, w, h, dataUrl: im.dataUrl };
          addElement(p, elm);
          select(p, elm);
          setTool('select');
          state.pendingImage = null;
          return;
        }
        if (state.tool === 'draw') {
          deselect();
          const elm = { type: 'path', points: [[x, y]], color: colorInp.value, width: Math.max(1, (+sizeInp.value || 16) / 8) };
          p.elements.push(elm);
          state.strokeUndo.push({ p, elm });
          ovl.setPointerCapture(e.pointerId);
          const move = ev => {
            const nx = (ev.clientX - r.left) / sc, ny = (ev.clientY - r.top) / sc;
            elm.points.push([nx, ny]);
            redrawStrokes(p);
          };
          const up = () => {
            ovl.removeEventListener('pointermove', move);
            ovl.removeEventListener('pointerup', up);
            ovl.removeEventListener('pointercancel', up);
            if (elm.points.length < 2) { p.elements.splice(p.elements.indexOf(elm), 1); state.strokeUndo.pop(); }
          };
          ovl.addEventListener('pointermove', move);
          ovl.addEventListener('pointerup', up);
          ovl.addEventListener('pointercancel', up);
          return;
        }
        // rubber-band shapes: whiteout / highlight / rect / ellipse
        if (['whiteout', 'highlight', 'rect', 'ellipse'].includes(state.tool)) {
          deselect();
          const elm = { type: state.tool, x, y, w: 0, h: 0, color: colorInp.value, stroke: 2 };
          addElement(p, elm);
          ovl.setPointerCapture(e.pointerId);
          const move = ev => {
            const nx = (ev.clientX - r.left) / sc, ny = (ev.clientY - r.top) / sc;
            elm.x = Math.min(x, nx); elm.y = Math.min(y, ny);
            elm.w = Math.abs(nx - x); elm.h = Math.abs(ny - y);
            positionEl(p, elm);
          };
          const up = () => {
            ovl.removeEventListener('pointermove', move);
            ovl.removeEventListener('pointerup', up);
            ovl.removeEventListener('pointercancel', up);
            if (elm.w < 4 || elm.h < 4) removeEl(p, elm);
            else { select(p, elm); setTool('select'); }
          };
          ovl.addEventListener('pointermove', move);
          ovl.addEventListener('pointerup', up);
          ovl.addEventListener('pointercancel', up);
        }
      });
    }

    /* ---------- toolbar ---------- */
    function setTool(t) {
      state.tool = t;
      root.querySelectorAll('[data-tool]').forEach(b =>
        b.classList.toggle('ed__tool--on', b.dataset.tool === t));
      const crosshair = t !== 'select';
      pages.forEach(p => {
        p.wrap.classList.toggle('edpage--crosshair', crosshair);
        p.ovl.style.touchAction = crosshair ? 'none' : '';
      });
    }
    root.querySelectorAll('[data-tool]').forEach(b => {
      b.onclick = async () => {
        const t = b.dataset.tool;
        if (t === 'image') {
          const files = await A.pickFiles('image/jpeg,image/png,image/webp,.jpg,.jpeg,.png,.webp', false);
          if (!files.length) return;
          const dataUrl = await fileToDataUrl(files[0]);
          const dim = await imgDims(dataUrl);
          state.pendingImage = { dataUrl, w: dim.w, h: dim.h };
          setTool('image');
          return;
        }
        setTool(t);
      };
    });
    setTool('select');

    colorInp.oninput = () => {
      if (!state.selected) return;
      const { p, elm } = state.selected;
      if (['text', 'rect', 'ellipse'].includes(elm.type)) { elm.color = colorInp.value; positionEl(p, elm); }
    };
    sizeInp.onchange = () => {
      if (!state.selected) return;
      const { p, elm } = state.selected;
      if (elm.type === 'text') { elm.size = +sizeInp.value || 16; positionEl(p, elm); }
    };
    root.querySelector('#edUndo').onclick = () => {
      const last = state.strokeUndo.pop();
      if (!last) return;
      const i = last.p.elements.indexOf(last.elm);
      if (i >= 0) last.p.elements.splice(i, 1);
      redrawStrokes(last.p);
    };

    let zoomTimer = null;
    function setZoom(z) {
      state.zoom = Math.min(3, Math.max(0.5, z));
      root.querySelector('#zoomLbl').textContent = Math.round(state.zoom * 100) + '%';
      clearTimeout(zoomTimer);
      zoomTimer = setTimeout(rerenderAll, 200);
    }
    root.querySelector('#zoomIn').onclick = () => setZoom(state.zoom + 0.15);
    root.querySelector('#zoomOut').onclick = () => setZoom(state.zoom - 0.15);

    const keyHandler = e => {
      if ((e.key === 'Delete' || e.key === 'Backspace') && state.selected && !state.selected.elm.node?.isContentEditable
          && !e.target.closest('input,textarea,[contenteditable=true]')) {
        e.preventDefault();
        removeEl(state.selected.p, state.selected.elm);
      }
      if (e.key === 'Escape') deselect();
    };
    window.addEventListener('keydown', keyHandler);

    /* ---------- save ---------- */
    root.querySelector('#edSave').onclick = async () => {
      deselect();
      A.processing('Saving your PDF…');
      try {
        const pdoc = await A.PDFDocument.load(bytes, { ignoreEncryption: true });
        const pdfPages = pdoc.getPages();
        for (const p of pages) {
          if (!p.elements.length) continue;
          const png = await exportOverlayPng(p);
          const img = await pdoc.embedPng(png);
          const vp = p.pdfjsPage.getViewport({ scale: 1 });
          const [ax, ay] = vp.convertToPdfPoint(0, 0);          // display top-left
          const [bx, by] = vp.convertToPdfPoint(p.vpW, 0);      // display top-right
          const [cx, cy] = vp.convertToPdfPoint(0, p.vpH);      // display bottom-left
          const theta = Math.atan2(by - ay, bx - ax) * 180 / Math.PI;
          pdfPages[p.num - 1].drawImage(img, {
            x: cx, y: cy, width: p.vpW, height: p.vpH,
            rotate: PDFLib.degrees(theta)
          });
        }
        const out = await pdoc.save();
        A.processingDone();
        A.doneScreen({
          heading: 'Your PDF has been edited!',
          blob: new Blob([out], { type: 'application/pdf' }),
          filename: file.name.replace(/\.pdf$/i, '') + '_edited.pdf', label: 'edited PDF',
          meta: A.fmtSize(out.length), toolId: 'edit'
        });
        window.removeEventListener('keydown', keyHandler);
      } catch (e) { A.fail(e, 'edit'); }
    };

    async function exportOverlayPng(p) {
      const cv = document.createElement('canvas');
      cv.width = Math.round(p.vpW * ES);
      cv.height = Math.round(p.vpH * ES);
      const ctx = cv.getContext('2d');
      for (const elm of p.elements) {
        if (elm.type === 'path') { drawPath(ctx, elm, ES); continue; }
        const x = elm.x * ES, y = elm.y * ES;
        if (elm.type === 'whiteout') {
          ctx.fillStyle = '#fff';
          ctx.fillRect(x - 1, y - 1, elm.w * ES + 2, elm.h * ES + 2);
        } else if (elm.type === 'highlight') {
          ctx.fillStyle = 'rgba(255,224,80,0.45)';
          ctx.fillRect(x, y, elm.w * ES, elm.h * ES);
        } else if (elm.type === 'rect') {
          ctx.strokeStyle = elm.color; ctx.lineWidth = Math.max(1.5, elm.stroke) * ES;
          ctx.strokeRect(x, y, elm.w * ES, elm.h * ES);
        } else if (elm.type === 'ellipse') {
          ctx.strokeStyle = elm.color; ctx.lineWidth = Math.max(1.5, elm.stroke) * ES;
          ctx.beginPath();
          ctx.ellipse(x + elm.w * ES / 2, y + elm.h * ES / 2, elm.w * ES / 2, elm.h * ES / 2, 0, 0, Math.PI * 2);
          ctx.stroke();
        } else if (elm.type === 'image') {
          const im = await loadImg(elm.dataUrl);
          ctx.drawImage(im, x, y, elm.w * ES, elm.h * ES);
        } else if (elm.type === 'text') {
          ctx.fillStyle = elm.color;
          ctx.textBaseline = 'top';
          ctx.font = '400 ' + elm.size * ES + 'px Hanken, system-ui, sans-serif';
          const lines = wrapText(ctx, elm);
          const lh = elm.size * 1.25 * ES;
          lines.forEach((ln, i) => ctx.fillText(ln, x + 4 * ES, y + 2 * ES + i * lh));
        }
      }
      const blob = await new Promise(res => cv.toBlob(res, 'image/png'));
      return new Uint8Array(await blob.arrayBuffer());
    }
    function wrapText(ctx, elm) {
      const hard = String(elm.text).split('\n');
      if (!elm.w) return hard;
      const maxW = (elm.w - 8) * ES;
      const out = [];
      for (const line of hard) {
        let cur = '';
        for (const word of line.split(' ')) {
          const trial = cur ? cur + ' ' + word : word;
          if (ctx.measureText(trial).width > maxW && cur) { out.push(cur); cur = word; }
          else cur = trial;
        }
        out.push(cur);
      }
      return out;
    }

    return () => {
      window.removeEventListener('keydown', keyHandler);
      try { doc.destroy(); } catch (e) {}
    };
  }

  function fileToDataUrl(file) {
    return new Promise((res, rej) => {
      const r = new FileReader();
      r.onload = () => res(r.result);
      r.onerror = rej;
      r.readAsDataURL(file);
    });
  }
  function imgDims(dataUrl) {
    return new Promise((res, rej) => {
      const im = new Image();
      im.onload = () => res({ w: im.naturalWidth, h: im.naturalHeight });
      im.onerror = rej;
      im.src = dataUrl;
    });
  }
  function loadImg(dataUrl) {
    return new Promise((res, rej) => {
      const im = new Image();
      im.onload = () => res(im);
      im.onerror = rej;
      im.src = dataUrl;
    });
  }

  // expose for forms.js "type anywhere" reuse
  window.__openEditor = openEditor;
})();
