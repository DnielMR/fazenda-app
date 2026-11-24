// Prototipo: prova tres coisas no iPhone e no PC
// 1) login Google  2) ler/gravar arquivo numa pasta do Google Drive
// 3) banco SQLite local no aparelho, com envio e recebimento via Drive.
(function () {
  const cfg = window.APP_CONFIG;
  const $ = (id) => document.getElementById(id);
  const logEl = $('log');
  let tAviso = null;
  function aviso(msg, tipo) {
    const a = $('aviso'); a.textContent = msg; a.className = tipo === 'erro' ? 'erro' : ''; a.hidden = false;
    clearTimeout(tAviso); tAviso = setTimeout(() => { a.hidden = true; }, tipo === 'erro' ? 9000 : 4000);
  }
  function log(msg, tipo) {
    const li = document.createElement('li');
    if (tipo) li.className = tipo;
    li.textContent = new Date().toLocaleTimeString('pt-BR') + '  ' + msg;
    logEl.prepend(li);
    if (tipo) aviso(msg, tipo); // resultado visivel na hora, sem precisar rolar ate o registro
  }
  // Mostra "Gravando..." no botao enquanto a acao roda e devolve o texto no fim.
  async function tarefa(btn, enquanto, fn) {
    const antes = btn.textContent, estavaOff = btn.disabled;
    btn.disabled = true; btn.textContent = enquanto;
    try { await fn(); } catch (e) { falha(e); }
    finally { btn.textContent = antes; btn.disabled = estavaOff; if (btn.id.indexOf('Banco') > 0 || btn.id.indexOf('Texto') > 0) atualizarConta($('conta').textContent); }
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
  // O acesso dura cerca de 1 hora. Fica guardado neste aparelho ate vencer, para o F5 nao deslogar.
  // Vale so para a pasta criada pelo app (escopo drive.file) e expira sozinho.
  const CHAVE = 'gestao_acesso_google';
  let acesso = null, validoAte = 0, rotuloConta = '', cliente = null, pedidoPendente = null;
  $('origem').textContent = location.origin;
  function guardarAcesso() {
    try { localStorage.setItem(CHAVE, JSON.stringify({ acesso, validoAte, rotuloConta })); } catch (e) { /* sem armazenamento: segue so em memoria */ }
  }
  function esquecerAcesso() { try { localStorage.removeItem(CHAVE); } catch (e) { /* nada */ } }
  function restaurarAcesso() {
    try {
      const d = JSON.parse(localStorage.getItem(CHAVE) || 'null');
      if (d && d.acesso && Date.now() < d.validoAte) { acesso = d.acesso; validoAte = d.validoAte; rotuloConta = d.rotuloConta || ''; return true; }
      esquecerAcesso();
    } catch (e) { /* ignora */ }
    return false;
  }

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
      rotuloConta = nome; guardarAcesso();
      atualizarConta(nome); log('Entrou: ' + nome, 'ok');
    } catch (e) { falha(e); }
  };
  $('btnSair').onclick = () => {
    if (acesso && typeof google !== 'undefined') google.accounts.oauth2.revoke(acesso, () => {});
    acesso = null; validoAte = 0; rotuloConta = ''; esquecerAcesso(); atualizarConta(); log('Saiu (acesso revogado).');
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

  $('btnTextoGravar').onclick = () => tarefa($('btnTextoGravar'), 'Gravando...', async () => {
    const doc = { gravadoEm: new Date().toISOString(), aparelho: navigator.userAgent.slice(0, 80) };
    await enviar(cfg.ARQUIVO_TEXTO, JSON.stringify(doc));
    $('resultado').textContent = 'Gravado no Drive as ' + new Date().toLocaleTimeString('pt-BR');
    log('Gravei ' + cfg.ARQUIVO_TEXTO + ' na pasta "' + cfg.PASTA + '" do Drive.', 'ok');
  });
  $('btnTextoLer').onclick = () => tarefa($('btnTextoLer'), 'Lendo...', async () => {
    const r = await receber(cfg.ARQUIVO_TEXTO);
    const txt = await r.text();
    $('resultado').textContent = 'Lido do Drive: ' + txt;
    log('Li ' + cfg.ARQUIVO_TEXTO + ' do Drive.', 'ok');
  });

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
    } catch (e) {
      $('sqlite').textContent = 'nao abriu';
      if (/Access Handle|NoModificationAllowed|locked/i.test(String(e && e.message))) {
        falha('O banco ja esta aberto em outra aba ou janela deste app. Feche as outras (inclusive o app da tela inicial) e recarregue.');
      } else falha(e);
    }
  }
  $('btnInserir').onclick = () => tarefa($('btnInserir'), 'Gravando...', async () => {
    mostrarResumo(await chamar('inserir', { texto: 'registro de ' + (navigator.platform || 'aparelho') }));
    log('Registro gravado no banco local.', 'ok');
  });
  $('btnBancoEnviar').onclick = () => tarefa($('btnBancoEnviar'), 'Enviando...', async () => {
    const bytes = await chamar('exportar');
    await enviar(cfg.ARQUIVO_BANCO, bytes);
    log('Enviei o banco (' + bytes.byteLength + ' bytes) para o Drive.', 'ok');
  });
  $('btnBancoReceber').onclick = () => tarefa($('btnBancoReceber'), 'Recebendo...', async () => {
    if (!confirm('Isto SUBSTITUI o banco deste aparelho pelo do Drive. Continuar?')) return;
    const r = await receber(cfg.ARQUIVO_BANCO);
    mostrarResumo(await chamar('importar', { bytes: await r.arrayBuffer() }));
    log('Banco do Drive carregado neste aparelho.', 'ok');
  });

  // ---------- Offline ----------
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('./sw.js').then(() => log('Modo offline preparado.'), (e) => log('Offline indisponivel: ' + e.message));
  }

  mostrarAparelho();
  if (restaurarAcesso()) log('Login anterior ainda vale (ate ' + new Date(validoAte).toLocaleTimeString('pt-BR') + ').', 'ok');
  atualizarConta(rotuloConta);
  if (!configurado()) log('Falta colocar o ID do cliente em config.js (veja LEIA-ME.md, passo 2).', 'erro');
  iniciarBanco();
})();
