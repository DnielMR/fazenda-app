// Prototipo: prova tres coisas no iPhone e no PC
// 1) login Google  2) ler/gravar arquivo numa pasta do Google Drive
// 3) banco SQLite local no aparelho, com envio e recebimento via Drive.
(function () {
  const VERSAO_APP = '0.0.7'; // mudar junto com index.html, config.js e sw.js
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
      const r = await chamar('ler', { tabela: nome, limite: 100, ordem: $('ordem').value });
      const g = $('grade'); g.innerHTML = '';
      const info = document.createElement('p'); info.className = 'sub'; info.style.margin = '0 0 6px';
      info.textContent = nome + ': ' + r.total + ' linhas' + (r.total > r.linhas.length ? ' (mostrando as ' + r.linhas.length + (r.linhas.length && $('ordem').value === 'desc' ? ' mais recentes)' : ' primeiras)') : '');
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
  $('ordem').onchange = () => mostrarLinhas($('tabelas').value);
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
  // CORRIGIR em vez de so recusar: cada problema ganha um campo (ou lista) para o valor certo; a planilha original nao muda.
  // As correcoes ficam em leitura.correcoes (chave "tabela|linha|coluna") e vao junto na proxima tentativa; o worker as grava na auditoria.
  function blocoCorrecoes(lista, aoAplicar) {
    const itens = lista.filter((x) => x.ts && x.col);
    if (!itens.length) return;
    const box = el('div', undefined, 'margin:10px 0;border-top:1px solid var(--borda);padding-top:8px');
    box.appendChild(el('p', 'Corrigir aqui (a planilha original nao muda; cada correcao fica na auditoria):', 'margin:0 0 6px;font-weight:600'));
    const campos = [];
    itens.slice(0, 30).forEach((x) => {
      const card = el('div', undefined, 'border:1px solid var(--borda);border-radius:10px;padding:8px;margin:0 0 6px;font-size:13px');
      card.appendChild(el('div', (NOME_TABELA[x.ts] || x.ts) + ', linha ' + x.linha + ' do Excel, ' + x.colNome + ': ' + x.msg, 'margin:0 0 4px;word-break:break-word'));
      let ent;
      if (x.opcoes && x.opcoes.length) {
        ent = document.createElement('select'); ent.appendChild(new Option('escolha o valor certo...', ''));
        x.opcoes.forEach((o) => ent.appendChild(new Option(o, o)));
      } else { ent = document.createElement('input'); ent.type = 'text'; ent.placeholder = 'valor certo'; ent.value = x.valor === null || x.valor === undefined ? '' : String(x.valor); }
      ent.style.cssText = 'max-width:100%;margin-right:8px';
      card.appendChild(ent);
      let dif = null;
      if (x.kind === 'parecido') {
        const lab = el('label', undefined, 'display:block;margin-top:6px');
        dif = document.createElement('input'); dif.type = 'checkbox'; dif.style.marginRight = '6px';
        lab.appendChild(dif); lab.appendChild(document.createTextNode('Sao produtos DIFERENTES: importar tambem este, com o nome como esta'));
        card.appendChild(lab);
      }
      campos.push({ x, ent, dif });
      box.appendChild(card);
    });
    if (itens.length > 30) box.appendChild(el('p', '... e mais ' + (itens.length - 30) + ' problema(s); corrija estes e tente de novo.', 'color:var(--mut);font-size:13px'));
    const b = el('button', 'Aplicar correcoes e tentar de novo');
    b.onclick = () => tarefa(b, 'Conferindo...', async () => {
      leitura.correcoes = leitura.correcoes || {};
      let n = 0;
      campos.forEach(({ x, ent, dif }) => {
        const k = x.ts + '|' + x.linha + '|' + x.col, v = String(ent.value).trim(), antes = x.valor === null || x.valor === undefined ? '' : String(x.valor).trim();
        if (dif && dif.checked) { leitura.correcoes[k] = { diferente: true }; n++; }
        else if (v !== '' && v !== antes) { leitura.correcoes[k] = { valor: v }; n++; }
      });
      if (!n) { log('Nenhuma correcao digitada.', 'erro'); return; }
      await aoAplicar();
    });
    box.appendChild(b);
    $('relatorio').appendChild(box);
  }
  const avisosTxt = (av) => (av && av.length ? ['AVISO: ' + av.length + ' numero(s) digitado(s) com virgula foram convertidos:'].concat(av.map((x) => x.tabela + ' (linha ' + x.linha + ' do Excel), ' + x.msg)) : []);
  // Simulacao do descarte (I2): mostra o que sairia (direto + dependentes + produtos com movimento) ANTES de gravar
  function mostrarSimulacao(r, aplicar) {
    const dep = (x) => /aponta para um registro/.test(x.msg);
    const diretos = r.descartes.filter((x) => !dep(x));
    const nDep = Object.values(r.cascata || {}).reduce((s, n) => s + n, 0);
    const txt = ['SIMULACAO: nada foi gravado ainda. Se voce confirmar, sai o seguinte:',
      diretos.length + ' registro(s) com problema (nao entram):']
      .concat(diretos.slice(0, 15).map((x) => x.tabela + (x.linha ? ' (linha ' + x.linha + ' do Excel)' : '') + ': ' + x.msg));
    if (diretos.length > 15) txt.push('... e mais ' + (diretos.length - 15));
    txt.push(nDep + ' linha(s) dependente(s) tambem saem' + (nDep ? ': ' + Object.entries(r.cascata).map(([k, n]) => (NOME_TABELA[k] || k) + ' ' + n).join(', ') : '.'));
    if (r.produtosComMov.length) {
      txt.push('ATENCAO: ' + r.produtosComMov.length + ' produto(s) com movimento de estoque seriam descartados, com o historico deles:');
      r.produtosComMov.forEach((p) => txt.push((p.nome || p.id) + ': ' + p.movimentos + ' movimento(s) de estoque'));
    }
    avisosTxt(r.avisos).forEach((x) => txt.push(x));
    mostrarRelatorio(txt, r.produtosComMov.length ? 'erro' : undefined);
    const b = el('button', r.produtosComMov.length ? 'Confirmar: descartar tambem os produtos com movimento' : 'Confirmar e continuar');
    b.onclick = () => tarefa(b, 'Gravando...', async () => {
      const aviso = r.produtosComMov.length
        ? 'Os produtos com movimento de estoque serao APAGADOS junto com o historico deles (' + r.produtosComMov.map((p) => p.nome || p.id).join(', ') + '). Tem certeza?'
        : 'Os registros acima serao DESCARTADOS e o banco do aparelho sera alterado. Continuar?';
      if (!confirm(aviso)) return;
      await aplicar(r.produtosComMov.length > 0);
    });
    const c = el('button', 'Cancelar (nao altera nada)'); c.className = 'sec'; c.onclick = () => chamar('cancelarComparacao').then(() => mostrarRelatorio(['Cancelado. Nada foi alterado.']));
    $('relatorio').appendChild(b); $('relatorio').appendChild(c);
  }
  async function importarXlsm(parcial, opc) {
    opc = opc || {};
    const esquema = await (await fetch('./esquema.json', { cache: 'no-store' })).json();
    const sql = await (await fetch('./esquema.sql', { cache: 'no-store' })).text();
    const r = await chamar('xlsm', { dados: leitura.dados, esquema, sql, parcial, arquivo: leitura.nome, usuario: rotuloConta || 'app web', simular: !!opc.simular, confirmaProdutos: !!opc.confirmaProdutos, correcoes: leitura.correcoes || {} });
    if (r.simulacao) { mostrarSimulacao(r, (conf) => importarXlsm(true, { confirmaProdutos: conf })); return; }
    if (!r.sucesso) {
      mostrarRelatorio(['NADA foi importado; o banco anterior foi mantido. Problemas encontrados:']
        .concat(r.erros.map((x) => x.tabela + (x.linha ? ' (linha ' + x.linha + ' do Excel)' : '') + ': ' + x.msg)), 'erro');
      blocoCorrecoes(r.erros, () => importarXlsm(false));
      if (r.erros.every((x) => x.tipo === 'dado')) {
        const b = document.createElement('button'); b.className = 'sec';
        b.textContent = 'Importar so o que for valido (mostra antes o que seria descartado)';
        b.onclick = () => tarefa(b, 'Simulando...', () => importarXlsm(true, { simular: true }));
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
    avisosTxt(r.avisos).forEach((x) => txt.push(x));
    mostrarRelatorio(txt);
    log('Planilha "' + leitura.nome + '" importada' + (r.descartes && r.descartes.length ? ' (' + r.descartes.length + ' descartados).' : '.'), 'ok');
  }
  // Copia de seguranca automatica (baixa um .db com a data) antes de atualizar ou substituir
  async function baixarBackup() {
    const bytes = await chamar('exportar');
    const d = new Date(), p = (n) => String(n).padStart(2, '0');
    const nome = 'fazenda_backup_' + d.getFullYear() + p(d.getMonth() + 1) + p(d.getDate()) + '_' + p(d.getHours()) + p(d.getMinutes()) + p(d.getSeconds()) + '.db';
    const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([bytes], { type: 'application/octet-stream' })); a.download = nome;
    document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 5000);
    log('Copia de seguranca baixada: ' + nome, 'ok');
    return nome;
  }
  const NOME_TABELA = { areas: 'Area', produtos: 'Produto', sementes: 'Semente', safras: 'Safra', safra_cultivos: 'Parte da safra', grupos: 'Grupo', principios_ativos: 'Principio ativo', medidas: 'Medida', cultivares: 'Cultivar', codigos: 'Codigo', aplicacoes: 'Ficha', mov_estoque: 'Movimento de estoque' };
  const el = (tag, txt, css) => { const e = document.createElement(tag); if (txt !== undefined) e.textContent = txt; if (css) e.style.cssText = css; return e; };

  // Atualizar: compara a planilha com o banco e pergunta, para cada duplicidade, qual manter
  async function atualizarComPlanilha() {
    const esquema = await (await fetch('./esquema.json', { cache: 'no-store' })).json();
    const sql = await (await fetch('./esquema.sql', { cache: 'no-store' })).text();
    const r = await chamar('comparar', { dados: leitura.dados, esquema, sql, correcoes: leitura.correcoes || {} });
    const R = $('relatorio'); R.innerHTML = '';
    if (!r.sucesso) {
      mostrarRelatorio(['Nada foi alterado. Esta planilha nao serve para atualizar:'].concat(r.erros.map((x) => x.tabela + ': ' + x.msg)), 'erro');
      return;
    }
    const lin = r.resumo.filter((t) => t.novos + t.conflitos + t.bloqueados + t.invalidas > 0);
    const totNovos = r.resumo.reduce((s, t) => s + t.novos, 0), totIguais = r.resumo.reduce((s, t) => s + t.iguais, 0);
    R.appendChild(el('p', 'Comparacao de "' + leitura.nome + '" com o banco do aparelho: ' + totNovos + ' registro(s) novo(s), ' + totIguais + ' igual(is) (ignorados), ' + r.conflitos.length + ' em duplicidade para voce decidir.', 'margin:0 0 6px;font-weight:600'));
    const ul = el('ul', undefined, 'margin:0 0 8px;padding-left:18px;font-size:13px');
    lin.forEach((t) => ul.appendChild(el('li', (NOME_TABELA[t.tabela] || t.tabela) + ': ' + t.novos + ' novo(s)'
      + (t.conflitos ? ', ' + t.conflitos + ' duplicado(s)' : '') + (t.bloqueados ? ', ' + t.bloqueados + ' bloqueado(s)' : '') + (t.invalidas ? ', ' + t.invalidas + ' invalido(s)' : ''))));
    if (lin.length) R.appendChild(ul);
    if (r.bloqueados.length) R.appendChild(el('p', 'Nao serao importados, e o que depende deles tambem nao (valor que deve ser unico ja existe, ex.: numero de ficha repetido): ' + r.bloqueados.slice(0, 5).join('; ') + (r.bloqueados.length > 5 ? '...' : ''), 'color:var(--err);font-size:13px;margin:0 0 8px'));
    if (r.invalidas.length) {
      R.appendChild(el('p', r.invalidas.length + ' linha(s) da planilha tem dado invalido e serao ignoradas (a menos que voce corrija abaixo):', 'color:var(--err);font-size:13px;margin:0 0 2px'));
      blocoCorrecoes(r.invalidas, () => atualizarComPlanilha());
    }
    avisosTxt(r.avisos).forEach((x) => R.appendChild(el('p', x, 'font-size:13px;margin:0 0 2px;color:var(--mut)')));
    const escolhas = {};
    let atualizaOk = () => {};
    const pad4 = (n) => String(n).padStart(4, '0');
    r.conflitos.forEach((c, n) => {
      const ficha = c.tipo === 'ficha';
      const card = el('div', undefined, 'border:1px solid ' + (ficha ? 'var(--err)' : 'var(--borda)') + ';border-radius:10px;padding:10px;margin:0 0 8px;font-size:13px');
      card.appendChild(el('div', (n + 1) + '. ' + (NOME_TABELA[c.tabela] || c.tabela) + ': ' + c.rotulo, 'font-weight:600'));
      card.appendChild(el('div', ficha ? 'Numero repetido: o app ja tem uma ficha ' + c.rotuloApp + ' e ela e OUTRA ficha. Decida o que fazer com a ficha da planilha.'
        : (c.tipo === 'nome' ? 'Mesmo nome, mas cadastros com IDs diferentes (' + c.rotuloApp + ' no app).' : 'Mesmo ID, com valores diferentes.'), 'color:var(--mut);margin:2px 0 6px'));
      if (ficha) { card.appendChild(el('div', 'No app: ' + c.app.texto, 'margin:2px 0')); card.appendChild(el('div', 'Na planilha: ' + c.nova.texto, 'margin:2px 0 6px')); }
      const grupo = 'dec' + n; escolhas[c.id] = c.sugestao;
      const opcoes = ficha
        ? [['descartar', 'Descartar', 'a ficha da planilha nao entra, nem o que depende dela (itens, execucoes e movimentos de estoque). Fica registrado na auditoria.'],
          ['renumerar', 'Renumerar', 'a ficha da planilha entra como n. ' + pad4(c.novoNumero) + '. Fica registrado na propria ficha (observacoes) e na auditoria.']]
        : [['app', 'Manter o do app', c.app.texto], ['planilha', 'Usar o da planilha', c.nova.texto]].concat(c.podeNovo ? [['novo', 'Importar como produto DIFERENTE', 'entra como mais um cadastro, com o nome da planilha (' + c.rotulo + '), ao lado de ' + c.rotuloApp + ' do app']] : []);
      opcoes.forEach(([val, rot, txt]) => {
        const lab = el('label', undefined, 'display:block;margin:4px 0;line-height:1.35');
        const rd = document.createElement('input'); rd.type = 'radio'; rd.name = grupo; rd.value = val; rd.checked = c.sugestao === val; rd.style.marginRight = '6px';
        rd.onchange = () => { escolhas[c.id] = val; atualizaOk(); };
        lab.appendChild(rd); lab.appendChild(el('b', rot + (!ficha && c.maisRecente && c.sugestao === val ? ' (mais recente)' : '') + ': ')); lab.appendChild(document.createTextNode(txt));
        card.appendChild(lab);
      });
      if (c.campos.length) card.appendChild(el('div', 'Campos diferentes: ' + c.campos.map((x) => x.col + ' (app: ' + (x.app === null ? 'vazio' : x.app) + ' / planilha: ' + (x.nova === null ? 'vazio' : x.nova) + ')').join('; ') + (c.totalCampos > c.campos.length ? '...' : ''), 'color:var(--mut);margin-top:4px;word-break:break-word'));
      R.appendChild(card);
    });
    const fim = (c) => chamar('cancelarComparacao').then(() => { if (c) mostrarRelatorio(['Atualizacao cancelada. Nada foi alterado.']); });
    async function aplicar(parcial, opc) {
      opc = opc || {};
      const m = await chamar('mesclar', { decisoes: escolhas, parcial, arquivo: leitura.nome, usuario: rotuloConta || 'app web', simular: !!opc.simular, confirmaProdutos: !!opc.confirmaProdutos });
      if (m.simulacao) { mostrarSimulacao(m, (conf) => aplicar(true, { confirmaProdutos: conf })); return; }
      if (!m.sucesso) {
        mostrarRelatorio(['NADA foi alterado; o banco anterior foi mantido. Problemas encontrados:'].concat(m.erros.map((x) => x.tabela + ': ' + x.msg)), 'erro');
        if (m.erros.every((x) => x.tipo === 'dado')) {
          const b = el('button', 'Atualizar so com o que for valido (mostra antes o que seria descartado)'); b.className = 'sec';
          b.onclick = () => tarefa(b, 'Simulando...', () => aplicar(true, { simular: true }));
          $('relatorio').appendChild(b);
        }
        log('Atualizacao recusada: ' + m.erros.length + ' problema(s).', 'erro'); return;
      }
      mostrarTabelas(m.tabelas);
      const txt = ['Atualizacao concluida com "' + leitura.nome + '".'];
      m.contagem.filter((c) => c.inseridos + c.atualizados + c.mantidos + c.bloqueados > 0).forEach((c) => txt.push((NOME_TABELA[c.tabela] || c.tabela) + ': ' + c.inseridos + ' inserido(s), ' + c.atualizados + ' atualizado(s) pela planilha, ' + c.mantidos + ' mantido(s) do app'));
      if (m.fichas && m.fichas.length) {
        txt.push('Fichas com numero repetido (decisao registrada na auditoria):');
        m.fichas.forEach((f) => txt.push('ficha ' + pad4(f.de) + (f.acao === 'renumerar' ? ' renumerada para ' + pad4(f.para) + ' (nota na observacao da ficha)' : ' descartada, com o que dependia dela')));
      }
      if (m.saldos.length) { txt.push('ESTOQUE recalculado (saldo inicial + movimentos confirmados):'); m.saldos.forEach((s) => txt.push(s)); }
      if (m.descartes.length) { txt.push('DESCARTADOS (' + m.descartes.length + '):'); m.descartes.forEach((x) => txt.push(x.tabela + ': ' + x.msg)); }
      mostrarRelatorio(txt);
      log('Banco atualizado com a planilha "' + leitura.nome + '".', 'ok');
    }
    const rotuloOk = 'Aplicar atualizacao (' + totNovos + ' novo(s), ' + r.conflitos.length + ' decisao(oes))';
    const ok = el('button', rotuloOk);
    atualizaOk = () => {
      const falta = r.conflitos.filter((c) => c.tipo === 'ficha' && !escolhas[c.id]).length;
      ok.disabled = falta > 0; ok.textContent = falta > 0 ? 'Decida ' + falta + ' ficha(s) de numero repetido para continuar' : rotuloOk;
    };
    atualizaOk();
    ok.onclick = () => tarefa(ok, 'Atualizando...', () => aplicar(false));
    const cancela = el('button', 'Cancelar (nao altera nada)'); cancela.className = 'sec'; cancela.onclick = () => fim(true);
    R.appendChild(ok); R.appendChild(cancela);
  }

  $('arquivoXlsm').onchange = async (e) => {
    const f = e.target.files[0]; e.target.value = '';
    if (!f) return;
    await tarefa($('btnImportarXlsm'), 'Lendo...', async () => {
      mostrarRelatorio(['Lendo a planilha...']);
      leitura = { nome: f.name, dados: await window.LerXlsm(f) };
      const tabs = await chamar('tabelas');
      const linhas = tabs.reduce((s, t) => s + t.linhas, 0);
      if (!linhas) { await importarXlsm(false); return; } // banco vazio: nada a decidir
      const R = $('relatorio'); R.innerHTML = '';
      R.appendChild(el('p', 'O banco deste aparelho ja tem ' + linhas + ' linhas. O que fazer com "' + f.name + '"? (uma copia de seguranca do banco atual sera baixada antes)', 'margin:0 0 6px;font-weight:600'));
      const atual = el('button', 'Atualizar: juntar com o que ja existe (voce decide as duplicidades)');
      atual.onclick = () => tarefa(atual, 'Comparando...', async () => { await baixarBackup(); await atualizarComPlanilha(); });
      const subst = el('button', 'Substituir: apagar o banco atual e usar so a planilha'); subst.className = 'sec';
      subst.onclick = () => tarefa(subst, 'Importando...', async () => { if (!confirm('SUBSTITUIR apaga os dados atuais do aparelho (a copia de seguranca sera baixada). Continuar?')) return; await baixarBackup(); await importarXlsm(false); });
      const canc = el('button', 'Cancelar'); canc.className = 'sec'; canc.onclick = () => mostrarRelatorio(['Importacao cancelada. Nada foi alterado.']);
      R.appendChild(atual); R.appendChild(subst); R.appendChild(canc);
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
