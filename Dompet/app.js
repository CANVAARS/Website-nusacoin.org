(() => {
  'use strict';
  const C = NusaCore, C_SEED = NusaSeed, $ = id => document.getElementById(id);
  const DEFAULT_CFG = { explorer: 'https://explorer.nusacoin.org', api: 'https://api.nusacoin.org', utxoTemplate: '', fee: '0.0001', autoLockMin: 15 };
  // Daftar tools bawaan (bisa diubah). Tambahkan halaman tools Anda di sini atau lewat tombol "Simpan" di tab Jelajah.
  const DEFAULT_TOOLS = [
    { name: 'Explorer Nusacoin', url: 'https://explorer.nusacoin.org' }
  ];
  const views = ['vSetup', 'vBackup', 'vUnlock', 'vHome', 'vSend', 'vSettings', 'vBrowse', 'vApprove'];
  const NAV_VIEWS = ['vHome', 'vSend', 'vSettings', 'vBrowse'];
  const ALLOWED = ['nux_connect', 'nux_disconnect', 'nux_getAddress', 'nux_getBalance', 'nux_signMessage', 'nux_sendTransaction', 'nux_sendData', 'nux_signTransaction'];

  // penyimpanan lokal (pengganti chrome.storage.local); WIF hanya di memori
  const store = {
    get: k => { try { return JSON.parse(localStorage.getItem('nw_' + k)); } catch (_) { return null; } },
    set: (k, v) => localStorage.setItem('nw_' + k, JSON.stringify(v)),
    remove: (...ks) => ks.forEach(k => localStorage.removeItem('nw_' + k))
  };

  let cfg = { ...DEFAULT_CFG }, acc = null, wallet = null, builtTx = null, lockTimer = null, hiddenAt = 0, currentView = null;
  let frame = null, frameUrl = '', installEvt = null;

  const show = v => {
    currentView = v; views.forEach(x => $(x).hidden = x !== v);
    const nav = !!wallet && NAV_VIEWS.includes(v);
    $('btnLock').hidden = !nav; $('nav').hidden = !nav;
    document.querySelectorAll('#nav button').forEach(b => b.classList.toggle('on', b.dataset.go === v || (v === 'vSend' && b.dataset.go === 'vHome')));
    window.scrollTo(0, 0);
  };
  const note = (t, ok) => { const m = $('msg'); m.hidden = !t; m.textContent = t || ''; m.className = 'msg' + (ok ? ' ok' : ''); };
  const el = (tag, props = {}, ...kids) => { const e = document.createElement(tag); Object.assign(e, props); kids.forEach(k => e.append(k)); return e; };
  const kv = (k, v) => el('div', { className: 'kv' }, el('span', { textContent: k }), el('b', { textContent: v }));
  const trimNum = n => (Math.round(n * 1e8) / 1e8).toString();
  const busy = (btn, on, txt) => { btn.disabled = on; if (txt) btn.textContent = on ? 'Memproses…' : txt; };
  const err = (code, message) => ({ error: { code, message } });

  const ask = (text, withInput, type) => new Promise(res => {
    const m = $('modal'), i = $('mInput'); $('mText').textContent = text; i.type = type || 'password'; i.hidden = !withInput; i.value = ''; m.hidden = false; if (withInput) i.focus();
    const done = v => { m.hidden = true; i.value = ''; res(v); };
    $('mYes').onclick = () => done(withInput ? i.value : true); $('mNo').onclick = () => done(withInput ? null : false);
  });

  // ---------- kunci otomatis ----------
  const lockMs = () => Math.max(1, Number(cfg.autoLockMin) || 15) * 60000;
  function touch() { clearTimeout(lockTimer); if (wallet) lockTimer = setTimeout(lockNow, lockMs()); }
  function lockNow() {
    clearTimeout(lockTimer); wallet = null; builtTx = null; closeFrame();
    if (cur) { const c = cur; cur = null; c.resolve(err(4100, 'Wallet terkunci')); }
    while (queue.length) queue.shift().resolve(err(4100, 'Wallet terkunci'));
    if (acc) { note(''); show('vUnlock'); }
  }
  ['pointerdown', 'keydown'].forEach(ev => document.addEventListener(ev, () => { if (wallet) touch(); }, { passive: true }));
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) hiddenAt = Date.now();
    else if (wallet && hiddenAt && Date.now() - hiddenAt > lockMs()) lockNow();
  });

  function init() {
    cfg = { ...DEFAULT_CFG, ...(store.get('cfg') || {}) };
    acc = store.get('account');
    if (!acc) return show('vSetup');
    show('vUnlock');
  }

  // ---------- setup ----------
  let importMode = false, seedMode = false;
  const setMode = m => {
    importMode = m === 'wif'; seedMode = m === 'seed';
    $('tabCreate').classList.toggle('on', m === 'create'); $('tabImport').classList.toggle('on', m === 'wif'); $('tabSeed').classList.toggle('on', m === 'seed');
    $('importBox').hidden = m !== 'wif'; $('seedBox').hidden = m !== 'seed'; $('seedHint').hidden = m !== 'seed';
  };
  $('tabCreate').onclick = () => setMode('create'); $('tabImport').onclick = () => setMode('wif'); $('tabSeed').onclick = () => setMode('seed');
  $('inSeed').oninput = () => { $('seedCount').textContent = C_SEED.normalizeMnemonic($('inSeed').value).split(' ').filter(Boolean).length + ' kata'; };
  $('btnSetup').onclick = async () => {
    note(''); const b = $('btnSetup');
    try {
      const p1 = $('inPass').value, p2 = $('inPass2').value, type = $('inType').value;
      if (p1.length < 8) throw new Error('Password minimal 8 karakter.');
      if (p1 !== p2) throw new Error('Konfirmasi password tidak sama.');
      if (seedMode) { const c = C_SEED.checkMnemonic($('inSeed').value); if (!c.ok) throw new Error(c.error); }
      busy(b, true);
      const wif = seedMode ? await C_SEED.wifFromMnemonic($('inSeed').value, type) : importMode ? $('inWif').value.trim() : C.wifEncode(C.randomPrivKey());
      const w = C.walletFromWif(wif, type);
      const vault = await C.encryptSecret(p1, wif);
      store.set('vault', vault); store.set('account', { address: w.address, pubkey: w.pubkey, type }); store.set('perms', {});
      acc = { address: w.address, pubkey: w.pubkey, type }; wallet = w; touch();
      $('inPass').value = $('inPass2').value = $('inWif').value = $('inSeed').value = ''; $('seedCount').textContent = '0 kata';
      if (importMode || seedMode) return goHome();
      $('bkWif').value = wif; $('bkOk').checked = false; $('btnBackupDone').disabled = true; show('vBackup');
    } catch (e) { note(e.message); } finally { busy(b, false, 'Lanjut'); }
  };
  $('bkOk').onchange = () => $('btnBackupDone').disabled = !$('bkOk').checked;
  $('btnBackupDone').onclick = () => { $('bkWif').value = ''; goHome(); };

  // ---------- buka / kunci ----------
  async function doUnlock() {
    note(''); const b = $('btnUnlock');
    try {
      busy(b, true);
      const wif = await C.decryptSecret($('unPass').value, store.get('vault'));
      wallet = C.walletFromWif(wif, acc.type); touch(); $('unPass').value = '';
      goHome();
    } catch (e) { note(e.message); } finally { busy(b, false, 'Buka'); }
  }
  $('btnUnlock').onclick = doUnlock; $('unPass').onkeydown = e => { if (e.key === 'Enter') doUnlock(); };
  $('btnForgot').onclick = async () => {
    if (!(await ask('Wallet di perangkat ini akan diganti dengan wallet dari seed phrase / WIF yang Anda masukkan. Pastikan Anda punya cadangannya. Lanjutkan?'))) return;
    note(''); setMode('seed'); show('vSetup');
  };
  $('btnLock').onclick = lockNow;
  document.querySelectorAll('#nav button').forEach(b => b.onclick = () => {
    note(''); const v = b.dataset.go;
    if (v === 'vHome') goHome(); else if (v === 'vSettings') openSettings(); else openBrowse();
  });

  // ---------- beranda ----------
  async function goHome() {
    note(''); show('vHome'); $('hAddr').textContent = acc.address; $('hBalance').textContent = '…';
    try { $('hBalance').textContent = trimNum(await C.fetchBalance(cfg.explorer, acc.address)) + ' NUX'; } catch (e) { $('hBalance').textContent = 'Offline'; note('Gagal memuat saldo: ' + e.message); }
    const box = $('hHistory'); box.textContent = '';
    try {
      const h = await C.fetchHistory(cfg.explorer, acc.address, 10);
      if (!h.length) box.append(el('small', { textContent: 'Belum ada transaksi.' }));
      h.forEach(t => box.append(el('div', {}, el('a', { href: C.trimUrl(cfg.explorer) + '/tx/' + encodeURIComponent(t.txid), target: '_blank', rel: 'noopener noreferrer', textContent: t.txid.slice(0, 10) + '…' + t.txid.slice(-8) }), el('span', { textContent: t.amount !== null && !isNaN(t.amount) ? trimNum(t.amount) + ' NUX' : '' }))));
    } catch (e) { box.textContent = ''; box.append(el('small', { textContent: 'Riwayat tidak tersedia.' })); }
  }
  $('btnRefresh').onclick = goHome;
  $('btnCopy').onclick = async () => { try { await navigator.clipboard.writeText(acc.address); note('Alamat disalin.', true); setTimeout(() => note(''), 1500); } catch (e) { note('Tidak bisa menyalin. Salin manual dari kotak alamat.'); } };
  $('btnToSend').onclick = () => { note(''); $('sTo').value = ''; $('sAmt').value = ''; $('sFee').value = cfg.fee; $('sReview').hidden = true; builtTx = null; $('btnSendGo').textContent = 'Tinjau'; show('vSend'); };
  $('btnToBrowse').onclick = openBrowse;

  // ---------- kirim ----------
  $('btnSendBack').onclick = goHome;
  $('btnSendGo').onclick = async () => {
    note(''); const b = $('btnSendGo');
    try {
      busy(b, true);
      if (!builtTx) {
        builtTx = await C.prepareSend(cfg, wallet, $('sTo').value.trim(), $('sAmt').value, $('sFee').value);
        const r = $('sReview'); r.textContent = ''; r.hidden = false;
        r.append(kv('Ke', $('sTo').value.trim()), kv('Jumlah', trimNum(Number($('sAmt').value)) + ' NUX'), kv('Fee', trimNum(builtTx.fee) + ' NUX'), kv('Input', String(builtTx.inputs)), el('small', { textContent: 'Transaksi tidak bisa dibatalkan setelah dikirim.' }));
        b.textContent = 'Kirim sekarang'; b.disabled = false; return;
      }
      const txid = await C.broadcast(cfg, builtTx.raw, builtTx.txid);
      builtTx = null; const t = 'Terkirim. TXID: ' + txid; await goHome(); note(t, true);
    } catch (e) { note(e.message); builtTx = null; $('sReview').hidden = true; b.textContent = 'Tinjau'; b.disabled = false; }
  };
  ['sTo', 'sAmt', 'sFee'].forEach(i => $(i).oninput = () => { builtTx = null; $('sReview').hidden = true; $('btnSendGo').textContent = 'Tinjau'; });

  // ---------- pengaturan ----------
  function openSettings() {
    note(''); $('cExplorer').value = cfg.explorer; $('cApi').value = cfg.api; $('cUtxo').value = cfg.utxoTemplate; $('cFee').value = cfg.fee; $('cLock').value = cfg.autoLockMin; $('cWif').hidden = true; $('cWif').value = '';
    const perms = store.get('perms') || {}, box = $('cSites'); box.textContent = '';
    const keys = Object.keys(perms); if (!keys.length) box.append(el('small', { textContent: 'Belum ada situs terhubung.' }));
    keys.forEach(o => box.append(el('div', {}, el('span', { textContent: o }), el('button', { className: 'danger', style: 'width:auto;margin:0', textContent: 'Cabut', onclick: () => { const p = store.get('perms') || {}; delete p[o]; store.set('perms', p); openSettings(); } }))));
    $('btnInstall').hidden = !installEvt;
    show('vSettings');
  }
  $('btnSetBack').onclick = goHome;
  $('btnSaveCfg').onclick = () => {
    const u = x => { const v = x.trim(); if (v && !/^https:\/\//i.test(v)) throw new Error('URL harus diawali https://'); return v; };
    try {
      cfg = { explorer: u($('cExplorer').value) || DEFAULT_CFG.explorer, api: u($('cApi').value) || DEFAULT_CFG.api, utxoTemplate: u($('cUtxo').value), fee: $('cFee').value || DEFAULT_CFG.fee, autoLockMin: Number($('cLock').value) || 15 };
      store.set('cfg', cfg); touch(); note('Tersimpan.', true);
    } catch (e) { note(e.message); }
  };
  $('btnExport').onclick = async () => {
    const pw = await ask('Masukkan password untuk menampilkan private key:', true); if (pw === null) return;
    try { $('cWif').value = await C.decryptSecret(pw, store.get('vault')); $('cWif').hidden = false; setTimeout(() => { $('cWif').value = ''; $('cWif').hidden = true; }, 30000); } catch (e) { note(e.message); }
  };
  $('btnReset').onclick = async () => {
    if (!(await ask('Hapus wallet dari perangkat ini? Tanpa cadangan seed phrase/WIF, dana tidak bisa dipulihkan.'))) return;
    store.remove('vault', 'account', 'perms'); clearTimeout(lockTimer); closeFrame(); acc = wallet = null; note(''); setMode('create'); show('vSetup');
  };
  window.addEventListener('beforeinstallprompt', e => { e.preventDefault(); installEvt = e; });
  window.addEventListener('appinstalled', () => { installEvt = null; });
  $('btnInstall').onclick = async () => { if (!installEvt) return; installEvt.prompt(); await installEvt.userChoice; installEvt = null; $('btnInstall').hidden = true; };

  // ---------- Jelajah: pencarian & tools ----------
  const getTools = () => { const t = store.get('tools'); return Array.isArray(t) ? t : DEFAULT_TOOLS.slice(); };
  const domainLike = v => /^[a-z0-9-]+(\.[a-z0-9-]+)+(\/\S*)?$/i.test(v);
  const webSearchUrl = q => 'https://duckduckgo.com/?q=' + encodeURIComponent(q);
  const openTab = u => window.open(u, '_blank', 'noopener,noreferrer');

  function openBrowse() { note(''); renderTools(); show('vBrowse'); }
  function renderTools() {
    const q = $('bQ').value.trim().toLowerCase(), box = $('bList'); box.textContent = '';
    const isUrl = /^https:\/\//i.test(q) || domainLike(q);
    const tools = getTools(), shown = tools.map((t, i) => ({ t, i })).filter(x => !q || isUrl || (x.t.name + ' ' + x.t.url).toLowerCase().includes(q));
    shown.forEach(({ t, i }) => box.append(el('div', { className: 'tool' },
      el('span', { onclick: () => openUrl(t.url) }, el('b', { textContent: t.name }), el('small', { textContent: t.url })),
      el('button', { className: 'danger', style: 'width:auto;margin:0', textContent: 'Hapus', onclick: async e => { e.stopPropagation(); if (await ask('Hapus “' + t.name + '” dari daftar tools?')) { const a = getTools(); a.splice(i, 1); store.set('tools', a); renderTools(); } } }))));
    if (!shown.length && !q) box.append(el('small', { textContent: 'Belum ada tools. Buka sebuah alamat lalu tekan “Simpan”.' }));
    if (q && !isUrl) box.append(el('div', { className: 'tool' }, el('span', { onclick: () => openTab(webSearchUrl($('bQ').value.trim())) }, el('b', { textContent: 'Cari di web: ' + $('bQ').value.trim() }), el('small', { textContent: 'Dibuka di tab baru (DuckDuckGo)' }))));
  }
  $('bQ').oninput = renderTools;
  function goSearch() {
    const v = $('bQ').value.trim(); if (!v) return;
    if (/^https:\/\//i.test(v)) return openUrl(v);
    if (/^http:\/\//i.test(v)) return note('Hanya alamat https:// yang bisa dibuka di dalam aplikasi.');
    if (domainLike(v)) return openUrl('https://' + v);
    const m = getTools().filter(t => (t.name + ' ' + t.url).toLowerCase().includes(v.toLowerCase()));
    if (m.length === 1) return openUrl(m[0].url);
    if (!m.length) openTab(webSearchUrl(v));
  }
  $('bGo').onclick = goSearch; $('bQ').onkeydown = e => { if (e.key === 'Enter') goSearch(); };

  function openUrl(u) {
    note('');
    let url; try { url = new URL(u); } catch (_) { return note('Alamat tidak valid.'); }
    if (url.protocol !== 'https:') return note('Hanya alamat https:// yang bisa dibuka di dalam aplikasi.');
    closeFrame(); frameUrl = url.href;
    frame = document.createElement('iframe');
    frame.setAttribute('sandbox', 'allow-scripts allow-same-origin allow-forms allow-popups allow-popups-to-escape-sandbox allow-downloads allow-modals');
    frame.setAttribute('allow', 'camera; clipboard-write');
    frame.title = 'Tools';
    frame.addEventListener('load', () => injectSameOrigin(frame));
    frame.src = frameUrl; $('frameBox').append(frame);
    $('bCur').textContent = url.host + url.pathname; $('bTools').hidden = true; $('frameWrap').hidden = false;
  }
  function closeFrame() {
    if (frame) { try { frame.src = 'about:blank'; } catch (_) {} frame.remove(); frame = null; }
    frameUrl = ''; $('frameWrap').hidden = true; $('bTools').hidden = false;
  }
  // Halaman tools di origin yang sama dengan wallet: jembatan dipasang otomatis (best-effort).
  function injectSameOrigin(f) {
    try {
      const w = f.contentWindow, d = f.contentDocument;
      if (!w || !d || w.nux) return;
      const s = d.createElement('script'); s.src = new URL('nux-bridge.js', location.href).href; (d.head || d.documentElement).appendChild(s);
    } catch (_) { /* beda origin: halaman harus memuat nux-bridge.js sendiri */ }
  }
  $('bClose').onclick = closeFrame;
  $('bExt').onclick = () => { if (frameUrl) openTab(frameUrl); };
  $('bSave').onclick = async () => {
    if (!frameUrl) return;
    const u = new URL(frameUrl), name = await ask('Nama tools:', true, 'text'); if (!name || !name.trim()) return;
    const a = getTools().filter(t => t.url !== frameUrl); a.push({ name: name.trim(), url: frameUrl }); store.set('tools', a); note('Disimpan ke daftar tools.', true); setTimeout(() => note(''), 1500);
  };

  // ---------- jembatan DApp: halaman di dalam iframe -> wallet ----------
  window.addEventListener('message', async e => {
    const d = e.data;
    if (!d || d.target !== 'nusa-content' || !frame || e.source !== frame.contentWindow) return;
    const origin = e.origin, reply = o => { try { e.source.postMessage(Object.assign({ target: 'nusa-page', id: d.id }, o), origin); } catch (_) {} };
    if (!origin || origin === 'null') return reply(err(4100, 'Origin tidak valid'));
    if (!ALLOWED.includes(d.method)) return reply(err(4200, 'Method tidak didukung: ' + d.method));
    try {
      const res = await handleDapp(d.method, d.params || {}, origin);
      res && res.error ? reply({ error: res.error }) : reply({ result: res ? res.result : null });
    } catch (x) { reply(err(-32603, x.message)); }
  });

  async function handleDapp(method, params, origin) {
    if (!acc) return err(4100, 'Wallet belum dibuat.');
    if (!wallet) return err(4100, 'Wallet terkunci. Buka kunci wallet lebih dulu.');
    touch();
    const perms = store.get('perms') || {}, allowed = !!perms[origin];
    if (method === 'nux_disconnect') { delete perms[origin]; store.set('perms', perms); return { result: true }; }
    if (method === 'nux_connect' && allowed) return { result: { address: acc.address, publicKey: acc.pubkey } };
    if (method === 'nux_getAddress') return allowed ? { result: acc.address } : err(4100, 'Situs belum terhubung. Panggil connect() dulu.');
    if (method === 'nux_getBalance') {
      if (!allowed) return err(4100, 'Situs belum terhubung.');
      try { return { result: await C.fetchBalance(cfg.explorer, acc.address) }; } catch (e) { return err(-32603, e.message); }
    }
    if (method !== 'nux_connect' && !allowed) return err(4100, 'Situs belum terhubung.');
    if (method === 'nux_signMessage' && typeof params.message !== 'string') return err(-32602, 'message harus string');
    if (method === 'nux_sendTransaction') {
      try { C.addressToScriptHex(params.to); } catch (e) { return err(-32602, e.message); }
      if (!(Number(params.amount) > 0)) return err(-32602, 'amount harus > 0 (dalam NUX)');
    }
    if (method === 'nux_signTransaction') {
      if (!Array.isArray(params.inputs) || !Array.isArray(params.outputs)) return err(-32602, 'inputs dan outputs harus berupa array');
      if (params.inputs.length > 800 || params.outputs.length > 800) return err(-32602, 'Transaksi terlalu besar');
    }
    if (method === 'nux_sendData') { try { params.hex = dataToHex(params.data, params.encoding); } catch (e) { return err(-32602, e.message); } }
    return requestApproval(method, params, origin);
  }
  function dataToHex(data, encoding) {
    let bytes;
    if (encoding === 'hex') { if (!/^([0-9a-fA-F]{2})+$/.test(data)) throw new Error('Data hex tidak valid.'); bytes = C.hexToBytes(data); }
    else if (!encoding || encoding === 'utf8') bytes = new TextEncoder().encode(data);
    else throw new Error("encoding harus 'utf8' atau 'hex'");
    if (!bytes.length || bytes.length > C.MAX_OPRETURN) throw new Error(`Data harus 1-${C.MAX_OPRETURN} byte (sekarang ${bytes.length}).`);
    return C.bytesToHex(bytes);
  }

  // ---------- persetujuan (di dalam aplikasi) ----------
  const queue = []; let cur = null;
  const requestApproval = (method, params, origin) => new Promise(resolve => { queue.push({ method, params, origin, resolve }); pump(); });
  function pump() { if (cur || !queue.length) return; cur = queue.shift(); renderApprove(); }
  function finishApproval(response) {
    const c = cur; cur = null; builtTx = null; c.resolve(response);
    if (queue.length) pump(); else if (wallet) show('vBrowse');
  }
  async function renderApprove() {
    note(''); const r = cur, body = $('aBody'); body.textContent = ''; $('aOrigin').textContent = r.origin; $('btnApprove').disabled = false; builtTx = null;
    show('vApprove'); $('nav').hidden = true; $('btnLock').hidden = true;
    const hold = () => { $('btnApprove').disabled = true; };
    if (r.method === 'nux_connect') {
      $('aTitle').textContent = 'Hubungkan situs'; body.append(el('p', { textContent: 'Situs ini meminta melihat alamat dan public key Anda. Ia tidak bisa mengirim dana tanpa persetujuan Anda.' }), kv('Alamat', acc.address));
    } else if (r.method === 'nux_signMessage') {
      $('aTitle').textContent = 'Tanda tangani pesan'; body.append(el('small', { textContent: 'Pesan:' }), el('pre', { textContent: r.params.message }), el('p', { className: 'hint', textContent: 'Tanda tangan tidak memindahkan dana, tapi bisa dipakai situs untuk membuktikan Anda pemilik alamat.' }));
    } else if (r.method === 'nux_sendTransaction') {
      $('aTitle').textContent = 'Kirim NUX'; body.append(el('small', { textContent: 'Menyiapkan transaksi…' })); hold();
      try {
        builtTx = await C.prepareSend(cfg, wallet, r.params.to, r.params.amount, cfg.fee);
        body.textContent = ''; body.append(kv('Ke', r.params.to), kv('Jumlah', trimNum(Number(r.params.amount)) + ' NUX'), kv('Fee', trimNum(builtTx.fee) + ' NUX'), el('p', { className: 'hint', textContent: 'Periksa alamat tujuan dengan teliti. Transaksi tidak bisa dibatalkan.' }));
        $('btnApprove').disabled = false;
      } catch (e) { body.textContent = ''; note(e.message); }
    } else if (r.method === 'nux_signTransaction') {
      $('aTitle').textContent = 'Tanda tangani transaksi'; body.append(el('small', { textContent: 'Memverifikasi transaksi…' })); hold();
      try {
        builtTx = await C.prepareSign(cfg, wallet, r.params.inputs, r.params.outputs);
        const outs = builtTx.outputs, pay = outs.filter(o => !o.script.startsWith('6a'));
        const others = pay.filter(o => C.scriptToAddress(o.script) !== acc.address), sumOthers = others.reduce((a, o) => a + o.value, 0);
        const short = a => a.length > 26 ? a.slice(0, 12) + '…' + a.slice(-8) : a;
        body.textContent = '';
        body.append(kv('Input', builtTx.inputs + ' UTXO (' + trimNum(builtTx.totalIn / 1e8) + ' NUX)'), kv('Keluar ke pihak lain', trimNum(sumOthers / 1e8) + ' NUX'), kv('Fee', trimNum(builtTx.fee) + ' NUX'));
        others.slice(0, 8).forEach(o => body.append(kv(short(C.scriptToAddress(o.script)), trimNum(o.value / 1e8) + ' NUX')));
        if (others.length > 8) body.append(el('small', { textContent: '…dan ' + (others.length - 8) + ' output lain ke pihak lain.' }));
        if (!others.length) body.append(el('p', { className: 'hint', textContent: 'Tidak ada NUX yang keluar ke pihak lain (hanya ke wallet sendiri dan/atau data on-chain).' }));
        const opd = outs.map(o => C.opReturnData(o.script)).find(Boolean);
        if (opd) { let t = ''; try { t = new TextDecoder('utf-8', { fatal: true }).decode(opd); } catch (_) {} body.append(el('small', { textContent: 'Data on-chain (' + opd.length + ' byte):' }), el('pre', { textContent: t || C.bytesToHex(opd) })); }
        body.append(el('p', { className: 'hint', textContent: 'Situs akan menyiarkan transaksi ini setelah Anda setujui. Periksa tujuan dan jumlah dengan teliti; transaksi tidak bisa dibatalkan.' }));
        $('btnApprove').disabled = false;
      } catch (e) { body.textContent = ''; note(e.message); }
    } else if (r.method === 'nux_sendData') {
      $('aTitle').textContent = 'Tulis data ke blockchain'; body.append(el('small', { textContent: 'Menyiapkan transaksi…' })); hold();
      try {
        const bytes = C.hexToBytes(r.params.hex);
        builtTx = await C.prepareData(cfg, wallet, bytes, cfg.fee);
        let preview = ''; try { preview = new TextDecoder('utf-8', { fatal: true }).decode(bytes); } catch (_) {}
        body.textContent = ''; body.append(kv('Ukuran', bytes.length + ' byte'), kv('Fee', trimNum(builtTx.fee) + ' NUX'), el('small', { textContent: 'Data (hex):' }), el('pre', { textContent: r.params.hex }));
        if (preview) body.append(el('small', { textContent: 'Teks:' }), el('pre', { textContent: preview }));
        body.append(el('p', { className: 'hint', textContent: 'Data ini akan tercatat permanen dan publik di blockchain. Tidak ada NUX yang dikirim ke pihak lain selain fee.' }));
        $('btnApprove').disabled = false;
      } catch (e) { body.textContent = ''; note(e.message); }
    }
  }
  $('btnReject').onclick = () => { if (cur) finishApproval(err(4001, 'Ditolak pengguna')); };
  $('btnApprove').onclick = async () => {
    const r = cur, b = $('btnApprove'); if (!r) return; note('');
    try {
      busy(b, true); let result = null;
      if (r.method === 'nux_signMessage') result = C.signMessage(wallet.wif, r.params.message);
      else if (r.method === 'nux_signTransaction') result = { raw: builtTx.raw, txid: builtTx.txid, fee: builtTx.fee };
      else if (r.method === 'nux_sendTransaction' || r.method === 'nux_sendData') result = { txid: await C.broadcast(cfg, builtTx.raw, builtTx.txid) };
      if (r.method === 'nux_connect') { const p = store.get('perms') || {}; p[r.origin] = Date.now(); store.set('perms', p); finishApproval({ result: { address: acc.address, publicKey: acc.pubkey } }); }
      else finishApproval({ result });
    } catch (e) { note(e.message); busy(b, false, 'Setujui'); }
  };

  if ('serviceWorker' in navigator && location.protocol === 'https:') {
    window.addEventListener('load', () => navigator.serviceWorker.register('./sw.js').catch(e => console.warn('SW gagal:', e)));
  }
  init();
})();
