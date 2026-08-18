/* ============ We❤PDF core ============ */
window.App = (function () {
  'use strict';

  pdfjsLib.GlobalWorkerOptions.workerSrc = 'vendor/pdf.worker.min.js';
  const { PDFDocument, degrees } = PDFLib;

  /* ---------- icons ---------- */
  const ICON_NAMES = ['arrow-merge','scissors','rotate-clockwise-2','layout-grid','pencil','forms',
    'file-type-doc','file-type-pdf','file-type-jpg','photo','eraser','files','download','upload','x',
    'plus','trash','copy','grip-vertical','check','letter-t','square','circle','scribble','highlight',
    'rotate','rotate-2','file-text','refresh','arrows-diagonal'];
  const icons = {};
  async function loadIcons() {
    await Promise.all(ICON_NAMES.map(async n => {
      try { icons[n] = await (await fetch('icons/' + n + '.svg')).text(); }
      catch (e) { icons[n] = ''; }
    }));
  }
  function icon(name, color) {
    const svg = icons[name] || '';
    return '<span class="icn"' + (color ? ' style="color:' + color + '"' : '') + '>' + svg + '</span>';
  }

  /* ---------- tool registry ---------- */
  // populated by js/tools/*.js via App.registerTool()
  const TOOLS = [];
  function registerTool(t) { TOOLS.push(t); }
  function getTool(id) { return TOOLS.find(t => t.id === id); }

  /* ---------- tiny DOM helpers ---------- */
  function el(html) {
    const t = document.createElement('template');
    t.innerHTML = html.trim();
    return t.content.firstElementChild;
  }
  function esc(s) { return String(s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])); }

  /* ---------- files ---------- */
  function readBytes(file) {
    return new Promise((res, rej) => {
      const r = new FileReader();
      r.onload = () => res(new Uint8Array(r.result));
      r.onerror = rej;
      r.readAsArrayBuffer(file);
    });
  }
  function fmtSize(n) {
    if (n < 1024) return n + ' B';
    if (n < 1048576) return (n / 1024).toFixed(1) + ' KB';
    return (n / 1048576).toFixed(1) + ' MB';
  }
  function pickFiles(accept, multiple) {
    return new Promise(res => {
      document.querySelectorAll('.hidden-file-input').forEach(n => n.remove());
      const inp = document.createElement('input');
      inp.type = 'file';
      inp.accept = accept;
      inp.multiple = !!multiple;
      inp.className = 'hidden-file-input';
      inp.style.display = 'none';
      inp.onchange = () => { res([...inp.files]); inp.remove(); };
      document.body.appendChild(inp);
      inp.click();
    });
  }
  function downloadBlob(data, name, mime) {
    const blob = data instanceof Blob ? data : new Blob([data], { type: mime || 'application/octet-stream' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = name;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 30000);
    return blob;
  }
  function zip(entries) { // entries: {name: Uint8Array}
    return new Promise((res, rej) => {
      const staged = {};
      for (const k in entries) staged[k] = [entries[k], { level: 0 }];
      fflate.zip(staged, (err, out) => err ? rej(err) : res(out));
    });
  }

  /* ---------- pdf.js helpers ---------- */
  async function loadPdfjs(bytes) {
    // pdf.js transfers the buffer to the worker → always hand it a copy
    return pdfjsLib.getDocument({ data: bytes.slice() }).promise;
  }
  async function renderPageCanvas(page, targetW, dpr) {
    dpr = dpr || 1;
    const vp1 = page.getViewport({ scale: 1 });
    const scale = targetW / vp1.width;
    const vp = page.getViewport({ scale: scale * dpr });
    const cv = document.createElement('canvas');
    cv.width = Math.floor(vp.width);
    cv.height = Math.floor(vp.height);
    await page.render({ canvasContext: cv.getContext('2d'), viewport: vp }).promise;
    return { canvas: cv, cssW: vp.width / dpr, cssH: vp.height / dpr, scale: scale };
  }

  /* ---------- overlays ---------- */
  const procOverlay = () => document.getElementById('procOverlay');
  function processing(msg) {
    document.getElementById('procMsg').textContent = msg || 'Processing…';
    procOverlay().hidden = false;
  }
  function processingDone() { procOverlay().hidden = true; }

  /* ---------- page scaffolds ---------- */
  const view = () => document.getElementById('view');

  function toolLanding(tool, onFiles) {
    const v = view();
    v.innerHTML = '';
    const land = el(
      '<section class="tland">' +
        '<h1>' + esc(tool.title) + '</h1>' +
        '<p class="tland__sub">' + esc(tool.sub) + '</p>' +
        '<button class="pickbtn">' + icon('upload') + esc(tool.pickLabel || 'Select PDF file') + '</button>' +
        '<p class="tland__or">or drop ' + (tool.multiple ? 'files' : 'a file') + ' anywhere on the page</p>' +
        (tool.hint ? '<p class="tland__hint">' + tool.hint + '</p>' : '') +
      '</section>');
    land.querySelector('.pickbtn').onclick = async () => {
      const files = await pickFiles(tool.accept, tool.multiple);
      if (files.length) onFiles(files);
    };
    v.appendChild(land);
    setDropHandler(files => {
      const ok = filterByAccept(files, tool.accept);
      if (ok.length) onFiles(tool.multiple ? ok : [ok[0]]);
    });
  }

  function filterByAccept(files, accept) {
    const exts = accept.split(',').map(s => s.trim().toLowerCase());
    return files.filter(f => {
      const n = f.name.toLowerCase();
      return exts.some(e => e.startsWith('.') ? n.endsWith(e) : (f.type && f.type === e));
    });
  }

  // workspace: main area + right sidebar; returns {main, sideBody, goBtn, setNote}
  function workspace(title, goLabel) {
    const v = view();
    v.innerHTML = '';
    const w = el(
      '<section class="wksp">' +
        '<div class="wksp__main"></div>' +
        '<aside class="wksp__side">' +
          '<h2 class="side__title">' + esc(title) + '</h2>' +
          '<div class="side__body"></div>' +
          '<div class="side__foot">' +
            '<button class="gobtn">' + esc(goLabel) + ' ' + icon('download') + '</button>' +
            '<p class="side__note"></p>' +
          '</div>' +
        '</aside>' +
      '</section>');
    v.appendChild(w);
    return {
      root: w,
      main: w.querySelector('.wksp__main'),
      sideBody: w.querySelector('.side__body'),
      goBtn: w.querySelector('.gobtn'),
      setNote: t => { w.querySelector('.side__note').textContent = t; }
    };
  }

  function doneScreen(opts) { // {heading, blob, filename, meta, toolId}
    const v = view();
    v.innerHTML = '';
    const d = el(
      '<section class="done">' +
        '<h1>' + esc(opts.heading) + '</h1>' +
        '<button class="done__dl">' + icon('download') + 'Download ' + esc(opts.label || 'file') + '</button>' +
        '<p class="done__meta">' + esc(opts.filename) + (opts.meta ? ' · ' + esc(opts.meta) : '') + '</p>' +
        '<a class="done__again" href="#' + esc(opts.toolId) + '">' + icon('refresh') + 'Start over</a>' +
      '</section>');
    const dl = () => downloadBlob(opts.blob, opts.filename);
    d.querySelector('.done__dl').onclick = dl;
    d.querySelector('.done__again').onclick = () => { setTimeout(route, 0); };
    v.appendChild(d);
    dl(); // auto-download like iLovePDF
  }

  /* ---------- global drag & drop ---------- */
  let dropHandler = null;
  function setDropHandler(fn) { dropHandler = fn; }
  function initDnd() {
    const veil = document.getElementById('dropVeil');
    let depth = 0;
    window.addEventListener('dragenter', e => {
      if (!dropHandler || ![...e.dataTransfer.types].includes('Files')) return;
      e.preventDefault(); depth++; veil.hidden = false;
    });
    window.addEventListener('dragover', e => { if (dropHandler) e.preventDefault(); });
    window.addEventListener('dragleave', e => {
      if (!dropHandler) return;
      depth = Math.max(0, depth - 1);
      if (depth === 0) veil.hidden = true;
    });
    window.addEventListener('drop', e => {
      if (!dropHandler) return;
      e.preventDefault(); depth = 0; veil.hidden = true;
      const files = [...e.dataTransfer.files];
      if (files.length) dropHandler(files);
    });
  }

  /* ---------- pointer-based drag reorder (works on touch) ---------- */
  function makeSortable(container, itemSel, onReorder, handleSel) {
    let item = null, ghost = null, startX = 0, startY = 0, active = false, pid = null;
    container.addEventListener('pointerdown', e => {
      const h = handleSel ? e.target.closest(handleSel) : null;
      const it = e.target.closest(itemSel);
      if (!it || !container.contains(it)) return;
      if (handleSel && !h) return;
      if (!handleSel && e.target.closest('button,input,textarea,select,[contenteditable]')) return;
      item = it; startX = e.clientX; startY = e.clientY; pid = e.pointerId; active = false;
    });
    container.addEventListener('pointermove', e => {
      if (!item || e.pointerId !== pid) return;
      const dx = e.clientX - startX, dy = e.clientY - startY;
      if (!active) {
        if (Math.hypot(dx, dy) < 8) return;
        active = true;
        container.setPointerCapture && container.setPointerCapture(pid);
        const r = item.getBoundingClientRect();
        ghost = item.cloneNode(true);
        ghost.classList.add('ghost');
        ghost.style.width = r.width + 'px';
        ghost.style.left = r.left + 'px';
        ghost.style.top = r.top + 'px';
        document.body.appendChild(ghost);
        item.classList.add('thumb--drag');
        document.body.style.userSelect = 'none';
      }
      e.preventDefault();
      ghost.style.transform = 'translate(' + dx + 'px,' + dy + 'px) rotate(2deg)';
      // find insertion point
      const sibs = [...container.querySelectorAll(itemSel)].filter(s => s !== item);
      let target = null, before = false;
      for (const s of sibs) {
        const r = s.getBoundingClientRect();
        if (e.clientX >= r.left && e.clientX <= r.right && e.clientY >= r.top && e.clientY <= r.bottom) {
          target = s;
          before = (e.clientX - r.left) < r.width / 2;
          break;
        }
      }
      if (target) {
        if (before) container.insertBefore(item, target);
        else container.insertBefore(item, target.nextSibling);
      }
    });
    function end(e) {
      if (!item) return;
      if (active) {
        ghost && ghost.remove(); ghost = null;
        item.classList.remove('thumb--drag');
        document.body.style.userSelect = '';
        onReorder && onReorder();
      }
      item = null; active = false;
    }
    container.addEventListener('pointerup', end);
    container.addEventListener('pointercancel', end);
  }

  /* ---------- header: megamenu + burger ---------- */
  function buildMenus() {
    const mm = document.getElementById('megamenu');
    mm.innerHTML = '<div class="megamenu__grid">' + TOOLS.map(t =>
      '<a class="megamenu__item" href="#' + t.id + '">' + icon(t.icon, t.color) + esc(t.title) + '</a>'
    ).join('') + '</div>';
    const btn = document.getElementById('navAllBtn');
    const toggle = show => {
      mm.hidden = show === undefined ? !mm.hidden : !show;
      btn.setAttribute('aria-expanded', String(!mm.hidden));
    };
    btn.onclick = e => { e.stopPropagation(); toggle(); };
    document.addEventListener('click', e => { if (!mm.hidden && !mm.contains(e.target)) toggle(false); });
    mm.addEventListener('click', e => { if (e.target.closest('a')) toggle(false); });

    const burger = document.getElementById('burgerBtn');
    const nav = document.querySelector('.nav');
    burger.onclick = () => nav.classList.toggle('nav--open');
    nav.addEventListener('click', e => { if (e.target.closest('a,button')) nav.classList.remove('nav--open'); });
  }

  /* ---------- home ---------- */
  function renderHome() {
    const v = view();
    v.innerHTML = '';
    v.appendChild(el(
      '<section class="hero">' +
        '<h1>Every tool you need to work with PDFs in one place</h1>' +
        '<p>Merge, split, rotate, organize, edit, fill and convert PDFs with a few clicks. ' +
        'Everything runs in your browser — files never leave your device.</p>' +
      '</section>'));
    const grid = el('<div class="toolgrid"></div>');
    for (const t of TOOLS) {
      grid.appendChild(el(
        '<a class="toolcard" href="#' + t.id + '">' +
          icon(t.icon, t.color) +
          '<h3>' + esc(t.title) + '</h3>' +
          '<p>' + esc(t.desc) + '</p>' +
        '</a>'));
    }
    v.appendChild(grid);
    setDropHandler(null);
  }

  /* ---------- router ---------- */
  let cleanup = null;
  function route() {
    if (cleanup) { try { cleanup(); } catch (e) {} cleanup = null; }
    setDropHandler(null);
    processingDone();
    window.scrollTo(0, 0);
    const id = location.hash.replace('#', '');
    const tool = getTool(id);
    if (!tool) { renderHome(); document.title = 'We ❤ PDF | Every tool you need, in one place'; return; }
    document.title = tool.title + ' — We ❤ PDF';
    cleanup = tool.mount() || null;
  }

  async function start() {
    await loadIcons();
    buildMenus();
    initDnd();
    window.addEventListener('hashchange', route);
    // same-hash links (e.g. re-opening the tool you just finished) still re-route
    document.addEventListener('click', e => {
      const a = e.target.closest('a[href^="#"]');
      if (a && a.getAttribute('href') === (location.hash || '#')) { e.preventDefault(); route(); }
    });
    route();
    if ('serviceWorker' in navigator && location.protocol === 'https:') {
      navigator.serviceWorker.register('sw.js').catch(() => {});
    }
  }

  /* ---------- error surface ---------- */
  function fail(err, toolId) {
    processingDone();
    console.error(err);
    const v = view();
    v.innerHTML = '';
    v.appendChild(el(
      '<section class="done"><h1>Something went wrong</h1>' +
      '<p class="done__meta">' + esc(err && err.message || err) + '</p>' +
      '<a class="done__again" href="#' + esc(toolId || '') + '">' + icon('refresh') + 'Try again</a></section>'));
  }

  return {
    start, registerTool, getTool, icon, el, esc,
    readBytes, fmtSize, pickFiles, downloadBlob, zip,
    loadPdfjs, renderPageCanvas,
    processing, processingDone,
    toolLanding, workspace, doneScreen, fail,
    setDropHandler, makeSortable, filterByAccept,
    PDFDocument, degrees, route
  };
})();
