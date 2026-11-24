// Prototipo: prova tres coisas no iPhone e no PC
// 1) login Google  2) ler/gravar arquivo numa pasta do Google Drive
// 3) banco SQLite local no aparelho, com envio e recebimento via Drive.
(function () {
  const cfg = window.APP_CONFIG;
  const $ = (id) => document.getElementById(id);
  const logEl = $('log');
  function log(msg, tipo) {
    const li = document.createElement('li');
    if (tipo) li.className = tipo;
    li.textContent = new Date().toLocaleTimeString('pt-BR') + '  ' + msg;
    logEl.prepend(li);
  }
  const falha = (e) => log('ERRO: ' + (e && e.message || e), 'erro');

  // ---------- Aparelho ----------
  async function mostrarAparelho() {
    const standalone = window.navigator.standalone === true || matchMedia('(display-mode: standalone)').matches;
    $('instalado').textContent = standalone ? 'sim (aberto como app)' : 'nao (aberto no navegador)';
    $('https').textContent = window.isSecureContext ? 'sim' : 'NAO (o app nao funciona sem HTTPS)';
    try {
      const persistente = navigator.storage && navigator.storage.persisted ? await navigator.storage.persisted() : null;
      $('persistente').textContent = persistente === null ? 'indisponivel' : (persistente ? 'sim' : 'nao');
      if (navigator.storage && navigator.storage.estimate) {
        const e = await navigator.storage.estimate();
        $('espaco').textContent = Math.round((e.usage || 0) / 1024) + ' KB usados de ' + Math.round((e.quota || 0) / 1048576) + ' MB';
      }
    } catch (e) { /* so informativo */ }
  }
  $('btnPersistir').onclick = async () => {
    try {
      const r = navigator.storage && navigator.storage.persist ? await navigator.storage.persist() : false;
      log('Pedido de armazenamento persistente: ' + (r ? 'aceito' : 'recusado pelo aparelho'), r ? 'ok' : '');
      mostrarAparelho();
    } catch (e) { falha(e); }
  };

  // ---------- Login Google ----------
  // O acesso dura cerca de 1 hora e fica so na memoria da tela (nao e gravado).
  let acesso = null, validoAte = 0, cliente = null, pedidoPendente = null;
  $('origem').textContent = location.origin;

  function configurado() { return cfg.CLIENT_ID.indexOf('COLE_AQUI') !== 0; }

  function conectado() { return !!acesso && Date.now() < validoAte; }
  function atualizarConta(rotulo) {
    $('conta').textContent = conectado() ? (rotulo || 'conectado') : 'nao entrou';
    ['btnTextoGravar', 'btnTextoLer', 'btnBancoEnviar', 'btnBancoReceber'].forEach((id) => { $(id).disabled = !conectado(); });
    $('btnEntrar').hidden = conectado(); $('btnSair').hidden = !conectado();
  }

  function criarCliente() {
    if (cliente) return cliente;
    if (typeof google === 'undefined' || !google.accounts) throw new Error('Nao consegui carregar o login do Google (sem internet?).');
    cliente = google.accounts.oauth2.initTokenClient({
      client_id: cfg.CLIENT_ID,
      scope: cfg.SCOPES,
      callback: (r) => {
        const p = pedidoPendente; pedidoPendente = null;
        if (r.error) { if (p) p.rej(new Error('Login recusado: ' + (r.error_description || r.error))); return; }
        acesso = r.access_token; validoAte = Date.now() + (Number(r.expires_in) - 60) * 1000;
        if (p) p.res();
      },
      error_callback: (e) => {
        const p = pedidoPendente; pedidoPendente = null;
        if (p) p.rej(new Error('Login nao concluido (' + (e && e.type || 'erro') + ')'));
      }
    });
    return cliente;
  }
  function pedirAcesso(prompt) {
    return new Promise((res, rej) => {
      try { const c = criarCliente(); pedidoPendente = { res, rej }; c.requestAccessToken({ prompt: prompt }); }
      catch (e) { rej(e); }
    });
  }
  async function token() {
    // Pedir login fora de um toque seria bloqueado pelo navegador (popup); por isso so avisamos.
    if (!conectado()) { atualizarConta(); throw new Error('O acesso expirou (dura cerca de 1 hora). Toque em "Entrar com o Google" de novo.'); }
    return acesso;
  }

  $('btnEntrar').onclick = async () => {
    if (!configurado()) return log('Falta colocar o ID do cliente em config.js (veja LEIA-ME.md, passo 2).', 'erro');
    try {
      await pedirAcesso('select_account');
      let nome = 'conectado';
      try {
        const r = await fetch('https://www.googleapis.com/drive/v3/about?fields=user(emailAddress)', { headers: { Authorization: 'Bearer ' + acesso } });
        if (r.ok) nome = (await r.json()).user.emailAddress;
      } catch (e) { /* so o rotulo */ }
      atualizarConta(nome); log('Entrou: ' + nome, 'ok');
    } catch (e) { falha(e); }
  };
  $('btnSair').onclick = () => {
    if (acesso && typeof google !== 'undefined') google.accounts.oauth2.revoke(acesso, () => {});
    acesso = null; validoAte = 0; atualizarConta(); log('Saiu (acesso revogado).');
  };

  // ---------- Google Drive (pasta do app) ----------
  const API = 'https://www.googleapis.com/drive/v3/files';
  const UP = 'https://www.googleapis.com/upload/drive/v3/files';
  let pastaId = null;

  async function drive(url, opcoes) {
    const t = await token();
    const r = await fetch(url, Object.assign({}, opcoes, {
      headers: Object.assign({ Authorization: 'Bearer ' + t }, (opcoes && opcoes.headers) || {})
    }));
    if (!r.ok) {
      let det = ''; try { det = (await r.json()).error.message; } catch (e) { /* sem corpo */ }
      throw new Error('Drive respondeu ' + r.status + (det ? ': ' + det : ''));
    }
    return r;
  }
  async function achar(nome, paiId) {
    const q = "name='" + nome.replace(/'/g, "\\'") + "' and trashed=false" + (paiId ? " and '" + paiId + "' in parents" : " and mimeType='application/vnd.google-apps.folder'");
    const r = await drive(API + '?fields=files(id,name,modifiedTime,size)&q=' + encodeURIComponent(q));
    return (await r.json()).files[0] || null;
  }
  async function pasta() {
    if (pastaId) return pastaId;
    let f = await achar(cfg.PASTA, null);
    if (!f) {
      const r = await drive(API + '?fields=id', { method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: cfg.PASTA, mimeType: 'application/vnd.google-apps.folder' }) });
      f = await r.json();
    }
    return (pastaId = f.id);
  }
  async function enviar(nome, corpo) {
    const pai = await pasta();
    const ex = await achar(nome, pai);
    if (ex) return drive(UP + '/' + ex.id + '?uploadType=media', { method: 'PATCH', headers: { 'Content-Type': 'application/octet-stream' }, body: corpo });
    const lim = 'fazenda' + Date.now();
    const meta = JSON.stringify({ name: nome, parents: [pai] });
    const partes = new Blob([
      '--' + lim + '\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n' + meta + '\r\n',
      '--' + lim + '\r\nContent-Type: application/octet-stream\r\n\r\n', corpo, '\r\n--' + lim + '--'
    ]);
    return drive(UP + '?uploadType=multipart', { method: 'POST', headers: { 'Content-Type': 'multipart/related; boundary=' + lim }, body: partes });
  }
  async function receber(nome) {
    const pai = await pasta();
    const ex = await achar(nome, pai);
    if (!ex) throw new Error('Arquivo ' + nome + ' ainda nao existe no Drive.');
    return drive(API + '/' + ex.id + '?alt=media');
  }

  $('btnTextoGravar').onclick = async () => {
    try {
      const doc = { gravadoEm: new Date().toISOString(), aparelho: navigator.userAgent.slice(0, 80) };
      await enviar(cfg.ARQUIVO_TEXTO, JSON.stringify(doc));
      log('Gravei ' + cfg.ARQUIVO_TEXTO + ' na pasta "' + cfg.PASTA + '" do Drive.', 'ok');
    } catch (e) { falha(e); }
  };
  $('btnTextoLer').onclick = async () => {
    try {
      const r = await receber(cfg.ARQUIVO_TEXTO);
      log('Li do Drive: ' + (await r.text()), 'ok');
    } catch (e) { falha(e); }
  };

  // ---------- Banco SQLite no aparelho ----------
  let worker = null, seq = 0; const pend = {};
  function chamar(acao, dados) {
    return new Promise((res, rej) => {
      const id = ++seq; pend[id] = { res, rej };
      worker.postMessage({ id, acao, dados });
    });
  }
  function mostrarResumo(r) {
    $('linhas').textContent = r.linhas;
    $('ultimas').textContent = r.ultimas.map((l) => '#' + l[0] + ' ' + l[1] + ' (' + l[2].slice(11, 19) + ')').join('\n') || '(vazio)';
  }
  async function iniciarBanco() {
    try {
      worker = new Worker('./db.worker.js', { type: 'module' });
      worker.onmessage = (e) => {
        const m = e.data, p = pend[m.id]; delete pend[m.id];
        if (p) (m.ok ? p.res(m.dado) : p.rej(new Error(m.erro)));
      };
      worker.onerror = (e) => falha(e.message || 'erro no worker do banco');
      const info = await chamar('iniciar');
      $('sqlite').textContent = 'SQLite ' + info.versao + ' (guardado no aparelho)';
      mostrarResumo(await chamar('resumo'));
      $('btnInserir').disabled = false;
      log('Banco local aberto.', 'ok');
    } catch (e) { $('sqlite').textContent = 'nao abriu'; falha(e); }
  }
  $('btnInserir').onclick = async () => {
    try { mostrarResumo(await chamar('inserir', { texto: 'registro de ' + (navigator.platform || 'aparelho') })); log('Registro gravado no banco local.', 'ok'); }
    catch (e) { falha(e); }
  };
  $('btnBancoEnviar').onclick = async () => {
    try {
      const bytes = await chamar('exportar');
      await enviar(cfg.ARQUIVO_BANCO, bytes);
      log('Enviei o banco (' + bytes.byteLength + ' bytes) para o Drive.', 'ok');
    } catch (e) { falha(e); }
  };
  $('btnBancoReceber').onclick = async () => {
    try {
      if (!confirm('Isto SUBSTITUI o banco deste aparelho pelo do Drive. Continuar?')) return;
      const r = await receber(cfg.ARQUIVO_BANCO);
      mostrarResumo(await chamar('importar', { bytes: await r.arrayBuffer() }));
      log('Banco do Drive carregado neste aparelho.', 'ok');
    } catch (e) { falha(e); }
  };

  // ---------- Offline ----------
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('./sw.js').then(() => log('Modo offline preparado.'), (e) => log('Offline indisponivel: ' + e.message));
  }

  mostrarAparelho();
  atualizarConta();
  if (!configurado()) log('Falta colocar o ID do cliente em config.js (veja LEIA-ME.md, passo 2).', 'erro');
  iniciarBanco();
})();
