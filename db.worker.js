// Banco SQLite no aparelho (worker). Guarda em OPFS com o modo "sahpool"
// (nao exige cabecalhos especiais do servidor; funciona no Safari 16.4+).
import sqlite3InitModule from './lib/sqlite3.mjs';

const NOME = '/fazenda.db';
let sqlite3 = null, pool = null, db = null;

function abrir() {
  db = new pool.OpfsSAHPoolDb(NOME);
  db.exec('PRAGMA foreign_keys=ON');
}

async function iniciar() {
  if (db) return { versao: sqlite3.version.libVersion, jaAberto: true };
  sqlite3 = await sqlite3InitModule({ print: () => {}, printErr: () => {} });
  pool = await sqlite3.installOpfsSAHPoolVfs({
    name: 'fazenda-sah', directory: '/fazenda-sah', initialCapacity: 6
  });
  abrir();
  return { versao: sqlite3.version.libVersion };
}

function listaTabelas() {
  const nomes = db.selectValues("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name");
  return nomes.map((n) => ({ nome: n, linhas: db.selectValue('SELECT count(*) FROM "' + n + '"') }));
}

function exportar() { return sqlite3.capi.sqlite3_js_db_export(db); }

// Troca o banco por outro arquivo. Se o novo nao servir, volta ao anterior.
async function substituir(bytes, validar) {
  const antes = exportar();
  db.close(); db = null;
  try {
    await pool.importDb(NOME, new Uint8Array(bytes));
    abrir();
    validar();
  } catch (e) {
    if (db) { db.close(); db = null; }
    await pool.importDb(NOME, antes);
    abrir();
    throw e;
  }
}
function exigirEsquema() {
  const t = db.selectValues("SELECT name FROM sqlite_master WHERE type='table' AND name IN ('areas','produtos','aplicacoes')");
  if (t.length < 3) throw new Error('Este arquivo nao parece um banco da fazenda (faltam as tabelas areas, produtos ou aplicacoes). O banco anterior foi mantido.');
}

// ---------- Conferencia de cada valor ANTES do INSERT (I3, I5, I11; A50) ----------
// As tabelas sao STRICT (o SQLite recusa texto em coluna numerica), mas a mensagem dele nao diz a coluna
// nem o valor. Aqui cada linha e conferida e a mensagem diz: coluna, valor e o que esta errado.
// Cada problema leva {ts, col, colNome, valor, kind, opcoes} para a tela oferecer a CORRECAO (campo para digitar o valor certo).
// correcoes: { "tabela|linhaExcel|coluna": { valor } ou { diferente: true } } (nome parecido importado como outro cadastro).
const ERRO_EXCEL = /^#(N\/D|N\/A|VALOR!|VALUE!|REF!|DIV\/0!|NOME\?|NAME\?|NUM!|NULL!|NULO!)/i;
const ISO = /^\d{4}-\d{2}-\d{2}/;
function contextoPlanilha(dados, esquema, siglasExtra, correcoes) {
  const med = new Set(siglasExtra || []), nomes = new Map(), avisos = [], nomesExatos = new Map(), nomesVistos = new Map();
  const tm = esquema.tabelas.find((t) => t.sql === 'medidas'), dm = tm && dados[tm.tabela];
  if (dm) { const i = tm.colunas.findIndex((c) => c.sql === 'sigla'); for (const l of dm.linhas) if (l.v[i] !== null && l.v[i] !== '') med.add(String(l.v[i])); }
  const tp = esquema.tabelas.find((t) => t.sql === 'produtos'), dp = tp && dados[tp.tabela];
  if (dp) { const i = tp.colunas.findIndex((c) => c.sql === 'id_produto'), n = tp.colunas.findIndex((c) => c.sql === 'nome'); for (const l of dp.linhas) nomes.set(l.v[i], l.v[n]); }
  return { med, nomes, avisos, nomesExatos, nomesVistos, corr: correcoes || {}, corrigidos: [] };
}
// Mensagem do SQLite em portugues simples (diz a coluna; o valor e a linha o chamador ja informa)
function msgSql(e) {
  const m = String(e.message || e).replace(/^.*?SQLITE_/, 'SQLITE_');
  let x;
  if ((x = /NOT NULL constraint failed: (\S+)/.exec(m))) return 'campo obrigatorio vazio (' + x[1] + ')';
  if ((x = /UNIQUE constraint failed: (\S+)/.exec(m))) return 'valor repetido: ja existe outro registro igual em ' + x[1] + ' (maiuscula/minuscula e espacos nas pontas nao diferenciam)';
  if ((x = /CHECK constraint failed: (.+)$/.exec(m))) return 'valor fora do permitido: ' + x[1];
  if ((x = /cannot store (\w+) value in (\w+) column (\S+)/.exec(m))) return 'tipo errado: ' + x[1] + ' em coluna ' + x[2] + ' (' + x[3] + ')';
  return m;
}
// problema vindo do SQLite (NOT NULL, UNIQUE, CHECK): descobre a coluna pela mensagem
function problemaSql(t, l, e, ctx) {
  const m = String(e.message || e); let col = null, x;
  if ((x = /failed: \w+\.(\w+)/.exec(m))) col = x[1]; else if ((x = /CHECK constraint failed: \(?(\w+)/.exec(m))) col = x[1];
  const i = col ? t.colunas.findIndex((c) => c.sql === col) : -1, c = i >= 0 ? t.colunas[i] : null;
  return { msg: msgSql(e), col: c && c.sql, colNome: c && c.coluna, valor: c ? l.v[i] : null, kind: 'sql', opcoes: c && (c.unidade ? [...ctx.med].sort() : c.dominio) };
}
const detalhe = (t, p) => ({ ts: t.sql, col: p.col || null, colNome: p.colNome || null, valor: p.valor === undefined ? null : p.valor, kind: p.kind || null, opcoes: p.opcoes || null });
// devolve { v: valores prontos para gravar, msg: motivo da recusa ou null (+ detalhes do problema) }
function preparar(t, l, ctx) {
  const v = l.v.map((x) => (x === '' ? null : x));
  for (let i = 0; i < t.colunas.length; i++) {
    const c = t.colunas[i];
    const cr = ctx.corr[t.sql + '|' + l.r + '|' + c.sql];
    if (cr && cr.valor !== undefined) { // correcao digitada pelo usuario na tela
      ctx.corrigidos.push({ tabela: t.sql, linha: l.r, id: v[0], col: c.sql, antes: v[i], depois: cr.valor === '' ? null : cr.valor });
      v[i] = cr.valor === '' ? null : cr.valor;
    }
    let x = v[i];
    if (x === null) continue;
    const onde = 'coluna "' + c.coluna + '": valor "' + x + '" ';
    const nao = (kind, texto, opcoes) => ({ msg: onde + texto, col: c.sql, colNome: c.coluna, valor: x, kind, opcoes });
    if (typeof x === 'string') {
      if (ERRO_EXCEL.test(x)) return nao('erro_excel', 'e um erro de formula do Excel (corrija a celula na planilha ou digite o valor certo aqui)');
      if (c.nome_unico) {
        x = x.trim(); v[i] = x === '' ? null : x; if (x === '') continue; // I11: espaco nas pontas nao conta
        const exato = t.sql + '|' + c.sql + '|' + x.toLowerCase(), ka = t.sql + '|' + c.sql + '|' + semAcento(x);
        const antesE = ctx.nomesExatos.get(exato), antesA = ctx.nomesVistos.get(ka);
        if (antesE === undefined) ctx.nomesExatos.set(exato, l.r);
        if (antesA === undefined) ctx.nomesVistos.set(ka, l.r);
        if (antesE !== undefined && antesE !== l.r) return nao('repetido', 'e o mesmo nome da linha ' + antesE + ' (sem diferenciar maiuscula e espacos); digite outro nome');
        if (antesA !== undefined && antesA !== l.r) {
          if (cr && cr.diferente) ctx.corrigidos.push({ tabela: t.sql, linha: l.r, id: v[0], col: c.sql, antes: x, depois: x, diferente: true, parecido: antesA });
          else return nao('parecido', 'tem nome parecido com o da linha ' + antesA + ' (so muda o acento). E o mesmo produto ou outro diferente?');
        }
      }
    }
    if (c.tipo === 'dec' || c.tipo === 'int') {
      if (typeof x === 'string') {
        // Excel guarda numero sempre com ponto; so TEXTO digitado vem com virgula (estilo brasileiro). Converte o que nao e ambiguo.
        const s = x.trim(); let n = null;
        if (/^-?\d+(\.\d+)?$/.test(s) && !/^-?\d{1,3}\.\d{3}$/.test(s)) n = Number(s); // 1.5 ou 1500 (1.500 e ambiguo)
        else if (/^-?\d+,\d+$/.test(s)) n = Number(s.replace(',', '.')); // 1,5
        else if (/^-?\d{1,3}(\.\d{3})+,\d+$/.test(s)) n = Number(s.replace(/\./g, '').replace(',', '.')); // 1.500,50
        if (n === null) return nao('numero', /^-?\d{1,3}\.\d{3}$/.test(s) ? 'e ambiguo (1.500 pode ser mil e quinhentos ou um e meio); digite o numero certo' : 'nao e numero');
        if (n !== Number(s) && ctx.avisos.length < 20) ctx.avisos.push({ tabela: t.sql, linha: l.r, msg: onde + 'foi lido como ' + n + ' (virgula decimal brasileira)' });
        x = n; v[i] = x;
      }
      if (c.tipo === 'int' && !Number.isInteger(x)) return nao('numero', 'deveria ser numero inteiro');
    } else if (c.tipo === 'data' || c.tipo === 'datahora') {
      if (typeof x !== 'string' || !ISO.test(x)) return nao('data', 'nao e uma data valida (digite como AAAA-MM-DD)');
    } else if (c.tipo === 'enum' && c.dominio && !c.dominio.includes(String(x))) {
      return nao('enum', 'esta fora das opcoes permitidas', c.dominio);
    }
    if (c.unidade && !ctx.med.has(String(x))) return nao('unidade', 'nao e uma unidade cadastrada em Medidas (sigla exata, como em kg, L, sc 60 kg)', [...ctx.med].sort());
  }
  return { v, msg: null };
}

// ---------- Atualizar (mesclar) com planilha: comparar e decidir (D-050) ----------
let tmp = null, plano = null, esqAtual = null, nomesProd = new Map(), avisosTmp = [], corrigidosTmp = [];
const NAO_CONTA = ['criado_em', 'atualizado_em'];
const semAcento = (v) => String(v).normalize('NFD').replace(/[̀-ͯ]/g, '').trim().toLowerCase();
const mesmo = (a, b) => {
  const x = (a === '' ? null : a), y = (b === '' ? null : b);
  if (x === null || y === null) return x === y;
  if (typeof x === 'number' && typeof y === 'number') return Math.abs(x - y) < 1e-9;
  return String(x) === String(y);
};
function pkDe(tab) {
  return db.selectArrays('PRAGMA table_info("' + tab + '")').filter((r) => r[5] > 0).sort((a, b) => a[5] - b[5]).map((r) => r[1]);
}
function unicasDe(tab, pk) { // colunas com UNIQUE sozinho (nome, numero...), fora a chave
  const out = [];
  for (const ix of db.selectArrays('PRAGMA index_list("' + tab + '")')) {
    if (ix[2] !== 1 || ix[4] === 1) continue; // so unicos e nao parciais
    const cs = db.selectValues('SELECT name FROM pragma_index_info(?)', [ix[1]]);
    if (cs.length === 1 && !pk.includes(cs[0])) out.push(cs[0]);
  }
  return out;
}
function carregarTmp(dados, esquema, sql, correcoes) {
  if (tmp) tmp.close();
  tmp = new sqlite3.oo1.DB(':memory:');
  tmp.exec('PRAGMA foreign_keys=OFF');
  tmp.exec(sql);
  const invalidas = [];
  const ctx = contextoPlanilha(dados, esquema, db.selectValues('SELECT sigla FROM medidas'), correcoes);
  nomesProd = ctx.nomes; avisosTmp = ctx.avisos; corrigidosTmp = ctx.corrigidos;
  for (const t of esquema.tabelas) {
    const d = dados[t.tabela]; if (!d || !d.linhas.length) continue;
    const ins = t.colunas.map((c) => c.sql);
    const stmt = tmp.prepare('INSERT INTO ' + t.sql + ' (' + ins.join(',') + ') VALUES (' + ins.map(() => '?').join(',') + ')');
    try {
      for (const l of d.linhas) {
        try {
          const p = preparar(t, l, ctx);
          if (p.msg) { invalidas.push(Object.assign({ tabela: t.sql, linha: l.r, msg: p.msg }, detalhe(t, p))); continue; }
          stmt.bind(p.v).step();
        }
        catch (e) { const q = problemaSql(t, l, e, ctx); invalidas.push(Object.assign({ tabela: t.sql, linha: l.r, msg: q.msg }, detalhe(t, q))); }
        finally { try { stmt.reset(); } catch (x) { /* reset repete o erro do step (A51) */ } }
      }
    } finally { stmt.finalize(); }
  }
  return invalidas;
}
// Ultima movimentacao de cada lado (app e planilha usam as mesmas consultas)
function contexto(conn, tab, o) {
  const dia = (v) => (v ? String(v).slice(0, 10) : null);
  const movProduto = (id) => {
    const m = conn.selectArrays("SELECT data, tipo, quantidade_assinada FROM mov_estoque WHERE id_produto=? AND situacao='Confirmada' ORDER BY data DESC, criado_em DESC LIMIT 1", [id])[0];
    const n = conn.selectValue("SELECT count(*) FROM mov_estoque WHERE id_produto=? AND situacao='Confirmada'", [id]);
    return { m, n };
  };
  if (tab === 'produtos' || tab === 'sementes') {
    const { m, n } = movProduto(o.id_produto);
    const p = conn.selectArrays('SELECT saldo_atual, unidade_base, atualizado_em FROM produtos WHERE id_produto=?', [o.id_produto])[0];
    return {
      data: m ? dia(m[0]) : (p ? dia(p[2]) : null),
      texto: (m ? 'ultima movimentacao ' + dia(m[0]) + ', ' + m[1] + ' (' + m[2] + ')' : 'sem movimentacao de estoque') + '; ' + n + ' movimento(s)'
        + (p ? '; saldo ' + p[0] + ' ' + p[1] : '; produto nao encontrado')
    };
  }
  if (tab === 'areas') {
    const f = conn.selectArrays('SELECT a.numero, a.data_emissao, a.situacao FROM aplicacao_areas aa JOIN aplicacoes a ON a.id_aplicacao = aa.id_aplicacao WHERE aa.id_area=? ORDER BY a.data_emissao DESC, a.numero DESC LIMIT 1', [o.id_area])[0];
    const e = conn.selectArrays('SELECT data_efetiva FROM execucao_itens WHERE id_area=? ORDER BY data_efetiva DESC LIMIT 1', [o.id_area])[0];
    const datas = [f && dia(f[1]), e && dia(e[0])].filter(Boolean).sort();
    return {
      data: datas.length ? datas[datas.length - 1] : dia(o.atualizado_em),
      texto: (f ? 'ultima ficha n. ' + f[0] + ' de ' + dia(f[1]) + ' (' + f[2] + ')' : 'sem ficha') + (e ? '; ultima execucao ' + dia(e[0]) : '; sem execucao')
    };
  }
  if (tab === 'aplicacoes') {
    const id = o.id_aplicacao;
    const areas = conn.selectValues('SELECT area_nome FROM aplicacao_areas WHERE id_aplicacao=?', [id]).join(', ');
    const prods = conn.selectValues('SELECT produto_nome FROM aplicacao_itens WHERE id_aplicacao=?', [id]).join(', ');
    const ex = conn.selectArrays('SELECT count(*), max(data_efetiva) FROM execucao_itens WHERE id_aplicacao=?', [id])[0];
    const mv = conn.selectValue('SELECT count(*) FROM mov_estoque WHERE id_aplicacao=?', [id]);
    return {
      data: ex[1] ? dia(ex[1]) : dia(o.data_emissao),
      texto: 'ficha n. ' + o.numero + ', emitida em ' + dia(o.data_emissao) + ' (' + o.situacao + '); area(s): ' + (areas || '-') + '; produto(s): ' + (prods || '-')
        + '; ' + (ex[0] ? ex[0] + ' execucao(oes), ultima em ' + dia(ex[1]) : 'sem execucao') + '; ' + mv + ' movimento(s) de estoque'
    };
  }
  return { data: dia(o.atualizado_em || o.criado_em), texto: o.atualizado_em ? 'atualizado em ' + dia(o.atualizado_em) : (o.criado_em ? 'criado em ' + dia(o.criado_em) : 'sem data') };
}
const comoObjeto = (cols, r) => { const o = {}; cols.forEach((c, i) => { o[c] = r[i]; }); return o; };
function rotuloDe(o) { return o.nome || o.numero || o.id_produto || Object.values(o)[0]; }
const pad4 = (n) => String(n).padStart(4, '0');

function comparar(dados, esquema, sql, correcoes) {
  esqAtual = esquema;
  const invalidas = carregarTmp(dados, esquema, sql, correcoes);
  plano = {};
  const resumo = [], conflitos = [];
  const fichasConflito = new Set(); // IDs (da planilha) de fichas com numero repetido: o destino delas segue a decisao do usuario
  let proxNum = Math.max(db.selectValue('SELECT COALESCE(max(numero),0) FROM aplicacoes'), tmp.selectValue('SELECT COALESCE(max(numero),0) FROM aplicacoes'));
  for (const t of esquema.tabelas) {
    const cols = t.colunas.map((c) => c.sql), lista = cols.join(',');
    const pk = pkDe(t.sql), pkI = pk.map((c) => cols.indexOf(c));
    const chave = (r) => JSON.stringify(pkI.map((i) => r[i]));
    const unicas = unicasDe(t.sql, pk);
    const appRows = db.selectArrays('SELECT ' + lista + ' FROM ' + t.sql);
    const porChave = new Map(appRows.map((r) => [chave(r), r]));
    const porUnica = unicas.map((u) => { const i = cols.indexOf(u); return { u, i, m: new Map(appRows.filter((r) => r[i] !== null).map((r) => [semAcento(r[i]), r])) }; });
    const novas = tmp.selectArrays('SELECT ' + lista + ' FROM ' + t.sql + ' ORDER BY rowid');
    const p = plano[t.sql] = new Map();
    const r0 = { tabela: t.sql, novos: 0, iguais: 0, conflitos: 0, bloqueados: 0, invalidas: invalidas.filter((x) => x.tabela === t.sql).length };
    for (const r of novas) {
      const k = chave(r), ex = porChave.get(k);
      if (ex) {
        const campos = cols.map((c, j) => ({ col: c, app: ex[j], nova: r[j] })).filter((x) => !NAO_CONTA.includes(x.col) && !mesmo(x.app, x.nova));
        if (!campos.length) { p.set(k, { acao: 'igual' }); r0.iguais++; continue; }
        const id = t.sql + '|' + k;
        p.set(k, { acao: 'conflito', tipo: 'id', id, chaveApp: k });
        conflitos.push(montar(t, cols, id, 'id', campos, ex, r)); r0.conflitos++; continue;
      }
      let colide = null;
      for (const u of porUnica) { if (r[u.i] !== null && u.m.has(semAcento(r[u.i]))) { colide = { u, ex: u.m.get(semAcento(r[u.i])) }; break; } }
      if (colide && t.classe === 'cadastro' && pk.length === 1) {
        const campos = cols.map((c, j) => ({ col: c, app: colide.ex[j], nova: r[j] })).filter((x) => x.col !== pk[0] && !NAO_CONTA.includes(x.col) && !mesmo(x.app, x.nova));
        const id = t.sql + '|' + k;
        p.set(k, { acao: 'conflito', tipo: 'nome', id, chaveApp: chave(colide.ex) });
        const cn = montar(t, cols, id, 'nome', campos, colide.ex, r);
        // so da para importar como outro cadastro se o nome nao for igual (maiuscula/espaco); acento diferente o SQLite aceita
        cn.podeNovo = String(r[colide.u.i]).trim().toLowerCase() !== String(colide.ex[colide.u.i]).trim().toLowerCase();
        conflitos.push(cn); r0.conflitos++; continue;
      }
      if (colide && t.sql === 'aplicacoes' && colide.u.u === 'numero') {
        // ficha com numero ja usado por OUTRA ficha: o usuario decide entre descartar e renumerar
        const id = t.sql + '|' + k, novoNumero = ++proxNum;
        fichasConflito.add(r[pkI[0]]);
        p.set(k, { acao: 'conflito', tipo: 'ficha', id, chaveApp: chave(colide.ex), novoNumero });
        const c = montar(t, cols, id, 'ficha', [], colide.ex, r);
        c.opcoes = ['descartar', 'renumerar']; c.sugestao = null; c.maisRecente = false; c.novoNumero = novoNumero;
        c.rotulo = 'n. ' + r[cols.indexOf('numero')]; c.rotuloApp = 'n. ' + colide.ex[cols.indexOf('numero')];
        conflitos.push(c); r0.conflitos++; continue;
      }
      const iAp = cols.indexOf('id_aplicacao');
      if (colide && iAp >= 0 && fichasConflito.has(r[iAp])) { p.set(k, { acao: 'inserir' }); r0.novos++; continue; } // segue a ficha (renumerada ou descartada)
      if (colide) { p.set(k, { acao: 'bloqueado', motivo: colide.u.u + ' "' + r[colide.u.i] + '" ja existe em outro registro' }); r0.bloqueados++; continue; }
      p.set(k, { acao: 'inserir' }); r0.novos++;
    }
    resumo.push(r0);
  }
  return { resumo, conflitos, invalidas, avisos: avisosTmp, bloqueados: Object.entries(plano).flatMap(([tab, m]) => [...m.values()].filter((v) => v.acao === 'bloqueado').map((v) => tab + ': ' + v.motivo)) };
}
function montar(t, cols, id, tipo, campos, exApp, nova) {
  const oa = comoObjeto(cols, exApp), on = comoObjeto(cols, nova);
  const ca = contexto(db, t.sql, oa), cn = contexto(tmp, t.sql, on);
  return {
    id, tabela: t.sql, tipo, rotulo: String(rotuloDe(on)), rotuloApp: String(rotuloDe(oa)),
    campos: campos.slice(0, 12), totalCampos: campos.length,
    app: ca, nova: cn,
    sugestao: cn.data && (!ca.data || cn.data > ca.data) ? 'planilha' : 'app',
    maisRecente: !!(ca.data || cn.data) && ca.data !== cn.data // so marca "mais recente" quando ha diferenca de data
  };
}

const ENTIDADE = { areas: 'Area', produtos: 'Produto', sementes: 'Semente', safras: 'Safra', aplicacoes: 'Aplicacao' };
function mesclar(decisoes, parcial, arquivo, usuario) {
  const erros = [], descartes = [], contagem = [], eventos = [], fichas = [];
  const erro = (tabela, msg) => { if (erros.length < 60) erros.push({ tabela, linha: null, msg, tipo: 'dado' }); };
  const descartar = (tabela, msg) => { if (descartes.length < 200) descartes.push({ tabela, linha: null, msg }); };
  const alias = {};
  for (const t of esqAtual.tabelas) {
    for (const [k, v] of plano[t.sql]) {
      if (v.acao === 'conflito' && v.tipo === 'nome' && decisoes[v.id] !== 'novo') (alias[t.sql] = alias[t.sql] || new Map()).set(JSON.parse(k)[0], JSON.parse(v.chaveApp)[0]);
    }
  }
  // fichas com numero repetido: cada uma precisa de decisao (descartar ou renumerar)
  const renum = new Map(), excl = { aplicacoes: new Set() }, MOTIVO_F = 'Numero de ficha ja usado por outra ficha; decisao do usuario na importacao de "' + arquivo + '"';
  for (const [k, v] of plano.aplicacoes) {
    if (v.acao !== 'conflito' || v.tipo !== 'ficha') continue;
    const dec = decisoes[v.id], idNovo = JSON.parse(k)[0];
    if (dec !== 'descartar' && dec !== 'renumerar') throw new Error('Decida o que fazer com cada ficha de numero repetido (descartar ou renumerar).');
    const de = tmp.selectValue('SELECT numero FROM aplicacoes WHERE id_aplicacao=?', [idNovo]);
    if (dec === 'renumerar') renum.set(idNovo, { de, para: v.novoNumero }); else excl.aplicacoes.add(idNovo);
    fichas.push({ id: idNovo, de, para: dec === 'renumerar' ? v.novoNumero : null, acao: dec });
  }
  // descartar uma ficha leva junto tudo que depende dela (itens, areas, saidas, execucoes, movimentos), por cascata de ligacoes
  for (let volta = 0; volta < 10; volta++) {
    let mudou = false;
    for (const t of esqAtual.tabelas) {
      const pk1 = pkDe(t.sql); if (pk1.length !== 1) continue;
      const cr = t.colunas.filter((c) => c.ref && excl[c.ref] && excl[c.ref].size); if (!cr.length) continue;
      for (const r of tmp.selectArrays('SELECT ' + pk1[0] + ',' + cr.map((c) => c.sql).join(',') + ' FROM ' + t.sql)) {
        if (cr.some((c, i) => excl[c.ref].has(r[i + 1]))) { const s = excl[t.sql] || (excl[t.sql] = new Set()); if (!s.has(r[0])) { s.add(r[0]); mudou = true; } }
      }
    }
    if (!mudou) break;
  }
  const hoje = (() => { const d = new Date(); return String(d.getDate()).padStart(2, '0') + '/' + String(d.getMonth() + 1).padStart(2, '0') + '/' + d.getFullYear(); })();
  db.exec('BEGIN');
  for (const t of esqAtual.tabelas) {
    const cols = t.colunas.map((c) => c.sql), lista = cols.join(',');
    const pk = pkDe(t.sql), pkI = pk.map((c) => cols.indexOf(c));
    const chave = (r) => JSON.stringify(pkI.map((i) => r[i]));
    const refs = t.colunas.map((c) => (c.ref && alias[c.ref]) || null);
    const naoPk = cols.filter((c) => !pk.includes(c));
    const c0 = { tabela: t.sql, inseridos: 0, atualizados: 0, mantidos: 0, iguais: 0, bloqueados: 0, descartados: 0 };
    const ins = 'INSERT' + (t.classe === 'relacao' ? ' OR IGNORE' : '') + ' INTO ' + t.sql + ' (' + lista + ') VALUES (' + cols.map(() => '?').join(',') + ')';
    const upd = 'UPDATE ' + t.sql + ' SET ' + naoPk.map((c) => c + '=?').join(',') + ' WHERE ' + pk.map((c) => c + '=?').join(' AND ');
    const iAp = cols.indexOf('id_aplicacao'), iNum = cols.indexOf('numero'), iCod = cols.indexOf('codigo'), iDoc = cols.indexOf('documento'), iObs = cols.indexOf('observacoes');
    for (const r of tmp.selectArrays('SELECT ' + lista + ' FROM ' + t.sql + ' ORDER BY rowid')) {
      const pl = plano[t.sql].get(chave(r)); if (!pl) continue;
      if (pk.length === 1 && excl[t.sql] && excl[t.sql].has(r[pkI[0]])) { c0.descartados++; continue; } // ficha descartada pelo usuario
      const rr = r.map((v, j) => (refs[j] && refs[j].has(v) ? refs[j].get(v) : v));
      // renumerar: troca o numero em todos os campos que o carregam
      const rn = t.sql === 'aplicacoes' ? renum.get(r[pkI[0]]) : (iAp >= 0 ? renum.get(rr[iAp]) : null);
      if (rn) {
        if (iNum >= 0) rr[iNum] = rn.para;
        if (t.sql === 'aplicacao_saidas' && iCod >= 0 && rr[iCod]) rr[iCod] = pad4(rn.para) + String(rr[iCod]).replace(/^\d+/, '');
        if (t.sql === 'mov_estoque' && iDoc >= 0 && rr[iDoc]) rr[iDoc] = String(rr[iDoc]).replace(/Aplicacao\s+\d+/, 'Aplicacao ' + pad4(rn.para)).replace(/\b\d{4}-S(\d+)/g, pad4(rn.para) + '-S$1');
        if (t.sql === 'aplicacoes' && iObs >= 0) { // registro da renumeracao na propria ficha
          const nota = '[Renumerada na importacao de ' + hoje + ': era a ficha ' + pad4(rn.de) + ' (arquivo "' + arquivo + '"), agora ' + pad4(rn.para) + '.]';
          rr[iObs] = rr[iObs] ? rr[iObs] + ' ' + nota : nota;
        }
      }
      try {
        if (pl.acao === 'igual') { c0.iguais++; continue; }
        if (pl.acao === 'bloqueado') { c0.bloqueados++; descartar(t.sql, 'nao importado: ' + pl.motivo); continue; }
        if (pl.acao === 'inserir') { db.exec({ sql: ins, bind: rr }); c0.inseridos++; continue; }
        if (pl.tipo === 'ficha') { db.exec({ sql: ins, bind: rr }); c0.inseridos++; continue; } // ficha renumerada (a descartada ja saiu acima)
        if (pl.tipo === 'nome' && decisoes[pl.id] === 'novo') { // usuario: nome parecido, mas e OUTRO cadastro
          db.exec({ sql: ins, bind: rr }); c0.inseridos++;
          eventos.push({ op: 'Importacao - importado como cadastro diferente', ent: ENTIDADE[t.sql] || 'Sistema', id: String(rr[0]), antes: 'nome parecido com "' + rotuloDe(comoObjeto(cols, db.selectArrays('SELECT ' + lista + ' FROM ' + t.sql + ' WHERE ' + pk.map((c) => c + '=?').join(' AND '), JSON.parse(pl.chaveApp))[0] || [])) + '" ja existente', depois: 'cadastro novo, com o nome da planilha', motivo: 'Escolha do usuario na importacao de "' + arquivo + '"' });
          continue;
        }
        if ((decisoes[pl.id] || 'app') !== 'planilha') { c0.mantidos++; continue; }
        const chaveApp = JSON.parse(pl.chaveApp), antesApp = db.selectArrays('SELECT ' + lista + ' FROM ' + t.sql + ' WHERE ' + pk.map((c) => c + '=?').join(' AND '), chaveApp)[0];
        db.exec({ sql: upd, bind: naoPk.map((c) => rr[cols.indexOf(c)]).concat(chaveApp) }); c0.atualizados++;
        if (antesApp) { // auditoria: o que mudou por escolha do usuario
          const dif = cols.map((c, j) => ({ c, a: antesApp[j], n: rr[j] })).filter((x) => !pk.includes(x.c) && !NAO_CONTA.includes(x.c) && !mesmo(x.a, x.n));
          eventos.push({ op: 'Importacao - registro atualizado', ent: ENTIDADE[t.sql] || 'Sistema', id: String(chaveApp[0]), antes: dif.map((x) => x.c + '=' + (x.a === null ? 'vazio' : x.a)).join('; '), depois: dif.map((x) => x.c + '=' + (x.n === null ? 'vazio' : x.n)).join('; '), motivo: 'Escolha do usuario (usar a planilha) na importacao de "' + arquivo + '"' });
        }
      } catch (e) {
        const m = msgSql(e);
        if (parcial) descartar(t.sql, m); else erro(t.sql, m);
      }
    }
    contagem.push(c0);
  }
  // estoque: saldo = saldo inicial + movimentos confirmados (regra do esquema); recalcula e avisa o que mudou
  const antesSaldo = new Map(db.selectArrays('SELECT id_produto, nome, saldo_atual FROM produtos').map((r) => [r[0], r]));
  db.exec("UPDATE produtos SET saldo_atual = saldo_inicial + COALESCE((SELECT SUM(quantidade_assinada) FROM mov_estoque m WHERE m.id_produto = produtos.id_produto AND m.situacao = 'Confirmada'), 0)");
  const saldos = db.selectArrays('SELECT id_produto, nome, saldo_atual FROM produtos').filter((r) => antesSaldo.has(r[0]) && !mesmo(antesSaldo.get(r[0])[2], r[2]))
    .map((r) => r[1] + ': ' + antesSaldo.get(r[0])[2] + ' -> ' + r[2]);
  const cascata = {}, prodMov = new Map(), vistos = new Set();
  if (!erros.length) {
    for (let volta = 0; volta < 20; volta++) {
      const fk = db.selectArrays('PRAGMA foreign_key_check');
      if (!fk.length) break;
      for (const f of fk) {
        const chaveV = db.selectValue('SELECT * FROM "' + f[0] + '" WHERE rowid = ?', [f[1]]);
        const msg = 'chave "' + chaveV + '": aponta para um registro que nao existe em ' + f[2];
        if (parcial) {
          if (!vistos.has(f[0] + '|' + f[1])) { // I2: conta o que sai junto (dependentes) e quais produtos com movimento de estoque caem
            vistos.add(f[0] + '|' + f[1]); cascata[f[0]] = (cascata[f[0]] || 0) + 1;
            if (f[0] === 'mov_estoque' && f[2] === 'produtos') { const idp = db.selectValue('SELECT id_produto FROM mov_estoque WHERE rowid = ?', [f[1]]); prodMov.set(idp, (prodMov.get(idp) || 0) + 1); }
          }
          descartar(f[0], msg); db.exec({ sql: 'DELETE FROM "' + f[0] + '" WHERE rowid = ?', bind: [f[1]] });
          const ce = contagem.find((c) => c.tabela === f[0]); // o que foi inserido e depois descartado nao conta como inserido
          if (ce) { if (ce.inseridos > 0) ce.inseridos--; else if (ce.atualizados > 0) ce.atualizados--; }
        } else erro(f[0], msg);
      }
      if (!parcial) break;
    }
  }
  if (!erros.length) {
    // auditoria (somente inclusao): decisao sobre cada ficha, cada registro atualizado pela planilha e o resumo da importacao
    const resumoDep = () => contagem.filter((c) => c.descartados).map((c) => c.descartados + ' em ' + c.tabela).join(', ');
    for (const f of fichas) {
      eventos.unshift({
        op: f.acao === 'renumerar' ? 'Importacao - ficha renumerada' : 'Importacao - ficha descartada', ent: 'Aplicacao', id: f.id,
        antes: 'ficha ' + pad4(f.de) + ' (arquivo "' + arquivo + '")',
        depois: f.acao === 'renumerar' ? 'ficha ' + pad4(f.para) + ' (registro na observacao da ficha)' : 'nao importada; tambem nao entraram os registros que dependiam dela: ' + (resumoDep() || 'nenhum'),
        motivo: MOTIVO_F
      });
    }
    const tot = (k) => contagem.reduce((s, c) => s + c[k], 0);
    eventos.push({ op: 'Importacao', ent: 'Sistema', id: null, antes: null, motivo: 'Atualizacao (juntar) com a planilha "' + arquivo + '"',
      depois: tot('inseridos') + ' inserido(s), ' + tot('atualizados') + ' atualizado(s) pela planilha, ' + tot('mantidos') + ' mantido(s) do app, ' + tot('iguais') + ' igual(is); '
        + fichas.filter((f) => f.acao === 'renumerar').length + ' ficha(s) renumerada(s), ' + fichas.filter((f) => f.acao === 'descartar').length + ' ficha(s) descartada(s); '
        + descartes.length + ' registro(s) descartado(s) por inconsistencia' });
    eventos.push(...eventosCorrecoes(corrigidosTmp, arquivo));
    for (const ev of eventos) registrarAuditoria(ev.op, ev.ent, ev.id, ev.antes, ev.depois, ev.motivo, usuario);
  }
  return { erros, descartes, contagem, saldos, fichas, cascata, produtosComMov: [...prodMov].map(([id, n]) => ({ id, nome: nomesProd.get(id) || null, movimentos: n })) };
}
// auditoria das correcoes digitadas pelo usuario (valor antigo e novo) e dos nomes parecidos importados como diferentes
function eventosCorrecoes(lista, arquivo) {
  return lista.slice(0, 100).map((c) => ({
    op: c.diferente ? 'Importacao - nome parecido importado como diferente' : 'Importacao - valor corrigido', ent: ENTIDADE[c.tabela] || 'Sistema', id: c.id === null || c.id === undefined ? null : String(c.id),
    antes: c.diferente ? c.col + '="' + c.antes + '" (parecido com o da linha ' + c.parecido + ')' : c.col + '=' + (c.antes === null ? 'vazio' : c.antes) + ' (linha ' + c.linha + ' do Excel)',
    depois: c.diferente ? 'importado como cadastro diferente' : c.col + '=' + (c.depois === null ? 'vazio' : c.depois),
    motivo: 'Correcao feita pelo usuario na tela de importacao de "' + arquivo + '" (a planilha original nao foi alterada)'
  }));
}
function registrarAuditoria(operacao, entidade, idRegistro, antes, depois, motivo, usuario) {
  const d = new Date(); d.setMinutes(d.getMinutes() - d.getTimezoneOffset());
  db.exec({
    sql: 'INSERT INTO auditoria (id_evento, quando, usuario, operacao, entidade, id_registro, antes, depois, motivo, resultado) VALUES (?,?,?,?,?,?,?,?,?,?)',
    bind: ['AUD-' + crypto.randomUUID().replace(/-/g, '').toUpperCase(), d.toISOString().slice(0, 19), usuario || 'app web', operacao, entidade, idRegistro, antes, depois, motivo, 'Sucesso']
  });
}

const acoes = {
  iniciar,
  // 1) le a planilha, compara com o banco e devolve resumo + conflitos (nada e gravado)
  comparar: async ({ dados, esquema, sql, correcoes }) => {
    for (const t of esquema.tabelas) {
      const d = dados[t.tabela], esp = t.colunas.map((c) => c.coluna);
      if (!d || d.cab.length !== esp.length || esp.some((c, i) => d.cab[i] !== c)) {
        return { sucesso: false, erros: [{ tabela: t.tabela, linha: null, msg: 'tabela ausente ou colunas diferentes do esquema atual (planilha de outra versao)', tipo: 'cabecalho' }] };
      }
    }
    return Object.assign({ sucesso: true }, comparar(dados, esquema, sql, correcoes));
  },
  // 2) aplica as decisoes do usuario (tudo ou nada; parcial descarta o que quebrar)
  // simular=true: faz tudo, conta o que seria descartado e DESFAZ (nada e gravado; a planilha continua carregada).
  // Produto com movimento de estoque que cairia so passa com confirmaProdutos=true (I2).
  mesclar: async ({ decisoes, parcial, arquivo, usuario, simular, confirmaProdutos }) => {
    if (!tmp || !plano) throw new Error('A planilha nao esta mais carregada. Escolha o arquivo de novo.');
    const antes = exportar();
    let r;
    try {
      r = mesclar(decisoes || {}, !!parcial, arquivo || 'planilha', usuario);
      if (r.erros.length) { db.exec('ROLLBACK'); return { sucesso: false, erros: r.erros }; }
      if (simular) { db.exec('ROLLBACK'); return { sucesso: true, simulacao: true, erros: [], descartes: r.descartes, cascata: r.cascata, produtosComMov: r.produtosComMov }; }
      if (r.produtosComMov.length && !confirmaProdutos) {
        db.exec('ROLLBACK');
        return { sucesso: false, erros: [{ tabela: 'produtos', linha: null, tipo: 'confirmacao', msg: 'recusado: ' + r.produtosComMov.length + ' produto(s) com movimento de estoque cairiam e precisam de confirmacao explicita' }] };
      }
      db.exec('COMMIT');
    } catch (e) {
      try { db.exec('ROLLBACK'); } catch (x) { /* ja desfeito */ }
      db.close(); db = null; await pool.importDb(NOME, antes); abrir();
      throw e;
    }
    tmp.close(); tmp = null; plano = null;
    return { sucesso: true, erros: [], descartes: r.descartes, contagem: r.contagem, saldos: r.saldos, fichas: r.fichas, tabelas: listaTabelas() };
  },
  cancelarComparacao: async () => { if (tmp) tmp.close(); tmp = null; plano = null; return true; },
  tabelas: async () => listaTabelas(),
  ler: async ({ tabela, limite, desloc, ordem }) => {
    const existe = listaTabelas().find((t) => t.nome === tabela);
    if (!existe) throw new Error('Tabela desconhecida: ' + tabela);
    const colunas = [], linhas = [];
    db.exec({ sql: 'SELECT * FROM "' + tabela + '"' + (ordem === 'desc' ? ' ORDER BY rowid DESC' : '') + ' LIMIT ? OFFSET ?', bind: [limite || 100, desloc || 0], rowMode: 'array', columnNames: colunas, resultRows: linhas });
    return { colunas, linhas, total: existe.linhas };
  },
  exportar: async () => { const bytes = exportar(); return { bytes, transfer: [bytes.buffer] }; },
  importar: async ({ bytes }) => {
    const cab = new TextDecoder().decode(new Uint8Array(bytes).slice(0, 15));
    if (cab !== 'SQLite format 3') throw new Error('Este arquivo nao e um banco SQLite.');
    await substituir(bytes, exigirEsquema);
    return listaTabelas();
  },
  // Importa as tabelas lidas de um .xlsm (mesmo esquema da versao atual). Tudo ou nada:
  // qualquer erro (cabecalho, tipo, CHECK, FK) desfaz e o banco anterior continua.
  // Com parcial=true, linhas com erro e registros que apontam para algo inexistente sao DESCARTADOS
  // (e listados); cabecalho/tabela diferente continua recusando tudo.
  // simular=true (so com parcial): faz tudo, conta o que seria descartado e DESFAZ (banco anterior intacto).
  // Produto com movimento de estoque que cairia so passa com confirmaProdutos=true (I2).
  xlsm: async ({ dados, esquema, sql, parcial, arquivo, usuario, simular, confirmaProdutos, correcoes }) => {
    const erros = [], descartes = [], MAX = 60; let avisosX = [], ctxCorrigidos = [];
    const erro = (tabela, linha, msg, tipo, extra) => { if (erros.length < MAX) erros.push(Object.assign({ tabela, linha, msg, tipo: tipo || 'dado' }, extra)); };
    const descartar = (tabela, linha, msg) => { if (descartes.length < 200) descartes.push({ tabela, linha, msg }); };
    // 1) cabecalhos
    for (const t of esquema.tabelas) {
      const d = dados[t.tabela];
      if (!d) { erro(t.tabela, null, 'tabela ausente no arquivo (versao antiga ou arquivo errado)', 'cabecalho'); continue; }
      const esp = t.colunas.map((c) => c.coluna);
      const dif = esp.findIndex((c, i) => d.cab[i] !== c);
      if (d.cab.length !== esp.length || dif >= 0) {
        erro(t.tabela, null, 'colunas diferentes do esquema atual (' + d.cab.length + ' no arquivo, ' + esp.length + ' esperadas)'
          + (dif >= 0 ? '; primeira diferenca na coluna ' + (dif + 1) + ': arquivo "' + d.cab[dif] + '", esperado "' + esp[dif] + '"' : ''), 'cabecalho');
      }
    }
    if (erros.length) return { sucesso: false, erros, tabelas: null };

    const antes = exportar();
    db.close(); db = null;
    const restaurar = async () => {
      if (db) { db.close(); db = null; }
      await pool.importDb(NOME, antes); abrir();
    };
    try {
      await pool.unlink(NOME);
      abrir();
      db.exec(sql);
      db.exec('BEGIN');
      const ctx = contextoPlanilha(dados, esquema, undefined, correcoes); avisosX = ctx.avisos; ctxCorrigidos = ctx.corrigidos;
      for (const t of esquema.tabelas) {
        const d = dados[t.tabela];
        if (!d.linhas.length) continue;
        const ins = t.colunas.map((c) => c.sql);
        const stmt = db.prepare('INSERT INTO ' + t.sql + ' (' + ins.join(',') + ') VALUES (' + ins.map(() => '?').join(',') + ')');
        try {
          for (const l of d.linhas) {
            try {
              const p = preparar(t, l, ctx);
              if (p.msg) { if (parcial) descartar(t.tabela, l.r, p.msg); else erro(t.tabela, l.r, p.msg, 'dado', detalhe(t, p)); continue; }
              stmt.bind(p.v).step();
            }
            catch (e) {
              const q = problemaSql(t, l, e, ctx), m = q.msg;
              if (parcial) descartar(t.tabela, l.r, m); else erro(t.tabela, l.r, m, 'dado', detalhe(t, q));
            }
            finally { try { stmt.reset(); } catch (x) { /* reset repete o erro do step (A51) */ } }
          }
        } finally { stmt.finalize(); }
      }
      const cascata = {}, prodMov = new Map(), vistos = new Set();
      if (!erros.length) {
        for (let volta = 0; volta < 20; volta++) {
          const fk = db.selectArrays('PRAGMA foreign_key_check');
          if (!fk.length) break;
          for (const f of fk) {
            const chave = db.selectValue('SELECT * FROM "' + f[0] + '" WHERE rowid = ?', [f[1]]);
            const msg = 'aponta para um registro que nao existe em ' + f[2];
            if (parcial && !vistos.has(f[0] + '|' + f[1])) { // I2: conta os dependentes que saem junto e os produtos com movimento que caem
              vistos.add(f[0] + '|' + f[1]); cascata[f[0]] = (cascata[f[0]] || 0) + 1;
              if (f[0] === 'mov_estoque' && f[2] === 'produtos') { const idp = db.selectValue('SELECT id_produto FROM mov_estoque WHERE rowid = ?', [f[1]]); prodMov.set(idp, (prodMov.get(idp) || 0) + 1); }
            }
            if (parcial) { descartar(f[0], null, 'chave "' + chave + '": ' + msg); db.exec({ sql: 'DELETE FROM "' + f[0] + '" WHERE rowid = ?', bind: [f[1]] }); }
            else erro(f[0], null, 'chave "' + chave + '": ' + msg);
          }
          if (!parcial) break;
        }
      }
      if (erros.length) { db.exec('ROLLBACK'); await restaurar(); return { sucesso: false, erros, tabelas: null }; }
      const produtosComMov = [...prodMov].map(([id, n]) => ({ id, nome: ctx.nomes.get(id) || null, movimentos: n }));
      if (simular) { db.exec('ROLLBACK'); await restaurar(); return { sucesso: true, simulacao: true, erros: [], descartes, cascata, produtosComMov, avisos: ctx.avisos, tabelas: null }; }
      if (produtosComMov.length && !confirmaProdutos) {
        db.exec('ROLLBACK'); await restaurar();
        return { sucesso: false, erros: [{ tabela: 'produtos', linha: null, tipo: 'confirmacao', msg: 'recusado: ' + produtosComMov.length + ' produto(s) com movimento de estoque cairiam e precisam de confirmacao explicita' }], tabelas: null };
      }
      db.exec('COMMIT');
    } catch (e) {
      try { if (db) db.exec('ROLLBACK'); } catch (x) { /* ja desfeito */ }
      await restaurar();
      throw e;
    }
    const lt = listaTabelas();
    for (const ev of eventosCorrecoes(ctxCorrigidos, arquivo || 'planilha')) registrarAuditoria(ev.op, ev.ent, ev.id, ev.antes, ev.depois, ev.motivo, usuario);
    registrarAuditoria('Importacao', 'Sistema', null, null, lt.reduce((s, t) => s + t.linhas, 0) + ' linhas; ' + descartes.length + ' descartada(s)',
      'Substituicao do banco pela planilha "' + (arquivo || 'planilha') + '"', usuario);
    return { sucesso: true, erros: [], descartes, avisos: avisosX, tabelas: listaTabelas() };
  },
  vazio: async ({ sql }) => {
    // banco novo so com o esquema (tabelas vazias)
    const antes = exportar();
    db.close(); db = null;
    try {
      await pool.unlink(NOME);
      abrir();
      db.exec(sql);
    } catch (e) {
      if (db) { db.close(); db = null; }
      await pool.importDb(NOME, antes);
      abrir();
      throw e;
    }
    return listaTabelas();
  }
};

self.onmessage = async (e) => {
  const { id, acao, dados } = e.data;
  try {
    const r = await acoes[acao](dados || {});
    if (r && r.transfer) self.postMessage({ id, ok: true, dado: r.bytes }, r.transfer);
    else self.postMessage({ id, ok: true, dado: r });
  } catch (err) {
    self.postMessage({ id, ok: false, erro: String(err && err.message || err) });
  }
};
