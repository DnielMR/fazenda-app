// Prototipo: prova tres coisas no iPhone e no PC
// 1) login Google  2) ler/gravar arquivo numa pasta do Google Drive
// 3) banco SQLite local no aparelho, com envio e recebimento via Drive.
(function () {
  const VERSAO_APP = '0.0.4'; // mudar junto com index.html, config.js e sw.js
  const cfg = window.APP_CONFIG;
  const $ = (id) => document.getElementById(id);

  // Mostra a versao de cada arquivo; se alguma nao subiu, aparece o aviso.
  async function mostrarVersao() {
    const tela = document.documentElement.dataset.versao || '?';
    const conf = cfg.VERSAO || '?';
    let cache = '?';
    try { const ks = await caches.keys(); cache = ks.length ? ks.sort().slice(-1)[0] : 'sem cache'; } catch (e) { /* sem cache */ }
    const todas = [tela, conf, VERSAO_APP, cache];
    const iguais = todas.every((v) => v === VERSAO_APP);
    $('versao').textContent = 'Versao ' + VERSAO_APP + ' (tela ' + tela + ' | config ' + conf + ' | logica ' + VERSAO_APP + ' | offline ' + cache + ')'
      + (iguais ? '' : ' - ATENCAO: arquivos de versoes diferentes; suba todos e use Ctrl+F5');
    $('versao').style.color = iguais ? '' : 'var(--err)';
    document.title = 'Gestao Agricola ' + VERSAO_APP;
  }
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
  // Consulta somente leitura: lista as tabelas com a contagem e mostra as primeiras linhas.
  let tabelaAtual = '';
  function mostrarTabelas(lista) {
    $('linhas').textContent = lista.length + ' tabelas, ' + lista.reduce((s, t) => s + t.linhas, 0) + ' linhas';
    const sel = $('tabelas'), anterior = tabelaAtual;
    sel.innerHTML = '';
    lista.forEach((t) => {
      const o = document.createElement('option'); o.value = t.nome; o.textContent = t.nome + ' (' + t.linhas + ')'; sel.appendChild(o);
    });
    const preferida = lista.find((t) => t.nome === anterior) || lista.find((t) => t.linhas > 0) || lista[0];
    if (preferida) { sel.value = preferida.nome; mostrarLinhas(preferida.nome); } else { $('grade').textContent = '(banco sem tabelas)'; }
  }
  async function mostrarLinhas(nome) {
    tabelaAtual = nome;
    try {
      const r = await chamar('ler', { tabela: nome, limite: 100 });
      const g = $('grade'); g.innerHTML = '';
      const info = document.createElement('p'); info.className = 'sub'; info.style.margin = '0 0 6px';
      info.textContent = nome + ': ' + r.total + ' linhas' + (r.total > r.linhas.length ? ' (mostrando as ' + r.linhas.length + ' primeiras)' : '');
      g.appendChild(info);
      if (!r.linhas.length) { const v = document.createElement('p'); v.className = 'sub'; v.textContent = '(vazia)'; g.appendChild(v); return; }
      const tb = document.createElement('table');
      const cab = tb.createTHead().insertRow();
      r.colunas.forEach((c) => { const th = document.createElement('th'); th.textContent = c; cab.appendChild(th); });
      const corpo = tb.createTBody();
      r.linhas.forEach((l) => { const tr = corpo.insertRow(); l.forEach((v) => { tr.insertCell().textContent = v === null ? '' : String(v); }); });
      g.appendChild(tb);
    } catch (e) { falha(e); }
  }
  $('tabelas').onchange = (e) => mostrarLinhas(e.target.value);
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
      mostrarTabelas(await chamar('tabelas'));
      log('Banco local aberto.', 'ok');
    } catch (e) {
      $('sqlite').textContent = 'nao abriu';
      if (/Access Handle|NoModificationAllowed|locked/i.test(String(e && e.message))) {
        falha('O banco ja esta aberto em outra aba ou janela deste app. Feche as outras (inclusive o app da tela inicial) e recarregue.');
      } else falha(e);
    }
  }
  // Abrir um .db do computador (ex.: gerado do Excel por ferramentas/xlsm_para_sqlite.py)
  $('btnAbrirDb').onclick = () => $('arquivoDb').click();
  $('arquivoDb').onchange = async (e) => {
    const f = e.target.files[0]; e.target.value = '';
    if (!f) return;
    if (!confirm('Abrir "' + f.name + '" SUBSTITUI o banco deste aparelho. Continuar?')) return;
    await tarefa($('btnAbrirDb'), 'Abrindo...', async () => {
      mostrarTabelas(await chamar('importar', { bytes: await f.arrayBuffer() }));
      log('Banco "' + f.name + '" aberto neste aparelho.', 'ok');
    });
  };
  // Importar planilha Excel (.xlsm): le as tabelas no navegador e grava tudo ou nada.
  function mostrarRelatorio(linhas, tipo) {
    const r = $('relatorio'); r.innerHTML = '';
    const ul = document.createElement('ul'); ul.style.cssText = 'margin:0;padding-left:18px;font-size:13px;color:' + (tipo === 'erro' ? 'var(--err)' : 'var(--txt)');
    linhas.forEach((t) => { const li = document.createElement('li'); li.textContent = t; ul.appendChild(li); });
    r.appendChild(ul);
  }
  $('btnImportarXlsm').onclick = () => $('arquivoXlsm').click();
  let leitura = null; // ultima planilha lida (para "importar o que for valido" sem ler de novo)
  async function importarXlsm(parcial) {
    const esquema = await (await fetch('./esquema.json', { cache: 'no-store' })).json();
    const sql = await (await fetch('./esquema.sql', { cache: 'no-store' })).text();
    const r = await chamar('xlsm', { dados: leitura.dados, esquema, sql, parcial });
    if (!r.sucesso) {
      mostrarRelatorio(['NADA foi importado; o banco anterior foi mantido. Problemas encontrados:']
        .concat(r.erros.map((x) => x.tabela + (x.linha ? ' (linha ' + x.linha + ' do Excel)' : '') + ': ' + x.msg)), 'erro');
      if (r.erros.every((x) => x.tipo === 'dado')) {
        const b = document.createElement('button'); b.className = 'sec';
        b.textContent = 'Importar so o que for valido (descarta os registros acima)';
        b.onclick = () => tarefa(b, 'Importando...', async () => {
          if (!confirm('Os registros com problema serao DESCARTADOS (ficam listados no relatorio) e o banco do aparelho sera substituido. Continuar?')) return;
          await importarXlsm(true);
        });
        $('relatorio').appendChild(b);
      }
      log('Importacao recusada: ' + r.erros.length + ' problema(s). Veja o relatorio.', 'erro');
      return;
    }
    mostrarTabelas(r.tabelas);
    const com = r.tabelas.filter((t) => t.linhas > 0);
    const txt = ['Importado de "' + leitura.nome + '": ' + com.reduce((s, t) => s + t.linhas, 0) + ' linhas em ' + com.length + ' tabelas.']
      .concat(com.map((t) => t.nome + ': ' + t.linhas));
    if (r.descartes && r.descartes.length) {
      txt.push('DESCARTADOS (' + r.descartes.length + '), nao entraram no banco:');
      r.descartes.forEach((x) => txt.push(x.tabela + (x.linha ? ' (linha ' + x.linha + ' do Excel)' : '') + ': ' + x.msg));
    }
    mostrarRelatorio(txt);
    log('Planilha "' + leitura.nome + '" importada' + (r.descartes && r.descartes.length ? ' (' + r.descartes.length + ' descartados).' : '.'), 'ok');
  }
  $('arquivoXlsm').onchange = async (e) => {
    const f = e.target.files[0]; e.target.value = '';
    if (!f) return;
    if (!confirm('Importar "' + f.name + '" SUBSTITUI o banco deste aparelho. Continuar?')) return;
    await tarefa($('btnImportarXlsm'), 'Importando...', async () => {
      mostrarRelatorio(['Lendo a planilha...']);
      leitura = { nome: f.name, dados: await window.LerXlsm(f) };
      await importarXlsm(false);
    });
  };
  // Banco novo: so as tabelas do esquema (esquema.sql, gerado de esquema/colunas.csv)
  $('btnNovoVazio').onclick = () => tarefa($('btnNovoVazio'), 'Criando...', async () => {
    if (!confirm('Criar um banco VAZIO (so o esquema) SUBSTITUI o banco deste aparelho. Continuar?')) return;
    const sql = await (await fetch('./esquema.sql', { cache: 'no-store' })).text();
    mostrarTabelas(await chamar('vazio', { sql }));
    log('Banco vazio criado com o esquema.', 'ok');
  });
  $('btnBancoEnviar').onclick = () => tarefa($('btnBancoEnviar'), 'Enviando...', async () => {
    const bytes = await chamar('exportar');
    await enviar(cfg.ARQUIVO_BANCO, bytes);
    log('Enviei o banco (' + bytes.byteLength + ' bytes) para o Drive.', 'ok');
  });
  $('btnBancoReceber').onclick = () => tarefa($('btnBancoReceber'), 'Recebendo...', async () => {
    if (!confirm('Isto SUBSTITUI o banco deste aparelho pelo do Drive. Continuar?')) return;
    const r = await receber(cfg.ARQUIVO_BANCO);
    mostrarTabelas(await chamar('importar', { bytes: await r.arrayBuffer() }));
    log('Banco do Drive carregado neste aparelho.', 'ok');
  });

  // ---------- Offline ----------
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('./sw.js').then(() => { log('Modo offline preparado.'); setTimeout(mostrarVersao, 1500); }, (e) => log('Offline indisponivel: ' + e.message));
  }

  mostrarVersao();
  mostrarAparelho();
  if (restaurarAcesso()) log('Login anterior ainda vale (ate ' + new Date(validoAte).toLocaleTimeString('pt-BR') + ').', 'ok');
  atualizarConta(rotuloConta);
  if (!configurado()) log('Falta colocar o ID do cliente em config.js (veja LEIA-ME.md, passo 2).', 'erro');
  iniciarBanco();
})();
