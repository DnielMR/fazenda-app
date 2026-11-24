// Prototipo: prova tres coisas no iPhone e no PC
// 1) login Microsoft (conta pessoal)  2) ler/gravar arquivo na pasta do app no OneDrive
// 3) banco SQLite local no aparelho, com envio e recebimento via OneDrive.
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

  // ---------- Login Microsoft ----------
  let msalApp = null, conta = null;
  const redirectUri = new URL('./', location.href).href;
  $('redirect').textContent = redirectUri;

  async function iniciarLogin() {
    if (cfg.CLIENT_ID.indexOf('COLE_AQUI') === 0) {
      log('Falta colocar o ID do aplicativo em config.js (veja LEIA-ME.md, passo 2).', 'erro');
      return;
    }
    msalApp = new msal.PublicClientApplication({
      auth: { clientId: cfg.CLIENT_ID, authority: cfg.AUTHORITY, redirectUri },
      cache: { cacheLocation: 'localStorage' }
    });
    await msalApp.initialize();
    const r = await msalApp.handleRedirectPromise();
    conta = (r && r.account) || msalApp.getAllAccounts()[0] || null;
    atualizarConta();
  }
  function atualizarConta() {
    $('conta').textContent = conta ? conta.username : 'nao entrou';
    ['btnTextoGravar', 'btnTextoLer', 'btnBancoEnviar', 'btnBancoReceber'].forEach((id) => { $(id).disabled = !conta; });
    $('btnEntrar').hidden = !!conta; $('btnSair').hidden = !conta;
  }
  $('btnEntrar').onclick = () => {
    if (!msalApp) return log('Login indisponivel: configure o ID do aplicativo.', 'erro');
    msalApp.loginRedirect({ scopes: cfg.SCOPES });
  };
  $('btnSair').onclick = () => { if (msalApp) msalApp.logoutRedirect({ account: conta, postLogoutRedirectUri: redirectUri }); };

  async function token() {
    try {
      const r = await msalApp.acquireTokenSilent({ scopes: cfg.SCOPES, account: conta });
      return r.accessToken;
    } catch (e) {
      log('Sessao expirou; vou pedir o login de novo.');
      await msalApp.acquireTokenRedirect({ scopes: cfg.SCOPES });
      throw new Error('redirecionando para o login');
    }
  }

  // ---------- OneDrive (pasta do app) ----------
  const base = 'https://graph.microsoft.com/v1.0/me/drive/special/approot:/';
  async function graph(nome, opcoes, sufixo) {
    const t = await token();
    const r = await fetch(base + encodeURIComponent(nome) + (sufixo || ''), Object.assign({}, opcoes, {
      headers: Object.assign({ Authorization: 'Bearer ' + t }, (opcoes && opcoes.headers) || {})
    }));
    if (!r.ok) {
      let det = ''; try { det = (await r.json()).error.message; } catch (e) { /* sem corpo */ }
      throw new Error('OneDrive respondeu ' + r.status + (det ? ': ' + det : ''));
    }
    return r;
  }
  const enviar = (nome, corpo) => graph(nome, { method: 'PUT', headers: { 'Content-Type': 'application/octet-stream' }, body: corpo }, ':/content');
  const receber = (nome) => graph(nome, { method: 'GET' }, ':/content');

  $('btnTextoGravar').onclick = async () => {
    try {
      const doc = { gravadoEm: new Date().toISOString(), aparelho: navigator.userAgent.slice(0, 80) };
      await enviar(cfg.ARQUIVO_TEXTO, JSON.stringify(doc));
      log('Gravei ' + cfg.ARQUIVO_TEXTO + ' no OneDrive.', 'ok');
    } catch (e) { falha(e); }
  };
  $('btnTextoLer').onclick = async () => {
    try {
      const r = await receber(cfg.ARQUIVO_TEXTO);
      log('Li do OneDrive: ' + (await r.text()), 'ok');
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
      ['btnInserir', 'btnBancoEnviar', 'btnBancoReceber'].forEach((id) => { $(id).dataset.banco = '1'; });
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
      log('Enviei o banco (' + bytes.byteLength + ' bytes) para o OneDrive.', 'ok');
    } catch (e) { falha(e); }
  };
  $('btnBancoReceber').onclick = async () => {
    try {
      if (!confirm('Isto SUBSTITUI o banco deste aparelho pelo do OneDrive. Continuar?')) return;
      const r = await receber(cfg.ARQUIVO_BANCO);
      mostrarResumo(await chamar('importar', { bytes: await r.arrayBuffer() }));
      log('Banco do OneDrive carregado neste aparelho.', 'ok');
    } catch (e) { falha(e); }
  };

  // ---------- Offline ----------
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('./sw.js').then(() => log('Modo offline preparado.'), (e) => log('Offline indisponivel: ' + e.message));
  }

  mostrarAparelho();
  iniciarLogin().catch(falha);
  iniciarBanco();
})();
