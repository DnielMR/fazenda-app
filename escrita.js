// Motor de escrita: roda UM comando (regras.js) numa transacao SQLite tudo-ou-nada (R4), com auditoria (R5)
// e idempotencia por idComando. Usado pelo db.worker.js (navegador) e pelos testes (Node, com adaptador de banco).
// O banco recebido precisa ter: exec(sql | {sql, bind}), selectObjects(sql, bind), selectValue(sql, bind) (igual ao oo1 do sqlite-wasm).
// Idempotencia SEM tabela nova: o sucesso grava na auditoria com id_evento = 'AUD-' + idComando (chave primaria):
// repetir o comando acha a linha e nao grava de novo. Falha grava outra linha de auditoria (id aleatorio) e nao trava o reenvio.
import { COMANDOS, validarEnvelope, avaliarSafra, novoId } from './regras.js';

const IDENT = /^[a-z][a-z0-9_]*$/;
const agoraLocal = () => { const d = new Date(); d.setMinutes(d.getMinutes() - d.getTimezoneOffset()); return d.toISOString().slice(0, 19); };

// Leitura para as regras: ler(tabela, {coluna: valor}) -> linhas (objetos). So igualdade; nomes conferidos.
export function fabricaLer(db) {
  return (tabela, onde) => {
    if (!IDENT.test(tabela)) throw new Error('tabela inválida: ' + tabela);
    const ks = Object.keys(onde || {});
    ks.forEach((k) => { if (!IDENT.test(k)) throw new Error('coluna inválida: ' + k); });
    return db.selectObjects('SELECT * FROM ' + tabela + (ks.length ? ' WHERE ' + ks.map((k) => k + ' IS ?').join(' AND ') : ''), ks.map((k) => onde[k]));
  };
}

// Consulta de conferencia (reutilizavel): para cada safra ABERTA (ou so as ids dadas) soma proporcoes e hectares das partes
// e compara com 100% e com a area. Devolve a lista de mensagens de problema (vazia = tudo certo). Nao usa trigger.
export function conferirSafras(db, ids) {
  const lista = ids && ids.length ? ids : null;
  const safras = db.selectObjects(
    "SELECT s.id_safra, s.safra, a.nome AS area_nome, a.hectares AS area_ha FROM safras s JOIN areas a ON a.id_area = s.id_area WHERE s.situacao = 'Aberta'"
    + (lista ? ' AND s.id_safra IN (' + lista.map(() => '?').join(',') + ')' : '') + ' ORDER BY s.id_safra', lista || []);
  const erros = [];
  for (const s of safras) {
    const partes = db.selectObjects('SELECT proporcao, hectares FROM safra_cultivos WHERE id_safra = ?', [s.id_safra]);
    erros.push(...avaliarSafra({ safra: s.safra, areaNome: s.area_nome, areaHa: s.area_ha, partes }));
  }
  return erros;
}

// Confere as operacoes ANTES de gravar: tabela e colunas existem, valores sao texto/numero/nulo, a linha alvo existe.
function conferirOperacoes(db, ops) {
  const e = [], colunas = {};
  const cols = (t) => colunas[t] || (colunas[t] = db.selectObjects('PRAGMA table_info("' + t + '")').map((r) => r.name));
  if (!Array.isArray(ops) || !ops.length) return ['o comando não gerou nenhuma operação'];
  ops.forEach((o, i) => {
    const q = 'operação ' + (i + 1) + ': ';
    if (!o || !['inserir', 'atualizar', 'excluir'].includes(o.op)) { e.push(q + 'tipo desconhecido'); return; }
    if (typeof o.tabela !== 'string' || !IDENT.test(o.tabela) || o.tabela === 'auditoria' || o.tabela.startsWith('sqlite_')) { e.push(q + 'tabela não permitida: ' + o.tabela); return; }
    const c = cols(o.tabela);
    if (!c.length) { e.push(q + 'tabela inexistente: ' + o.tabela); return; }
    const mapas = o.op === 'inserir' ? [o.valores] : o.op === 'atualizar' ? [o.chave, o.set] : [o.chave];
    for (const m of mapas) {
      if (!m || typeof m !== 'object' || !Object.keys(m).length) { e.push(q + 'faltam valores ou chave'); return; }
      for (const [k, v] of Object.entries(m)) {
        if (!c.includes(k)) e.push(q + 'coluna inexistente em ' + o.tabela + ': ' + k);
        if (!(v === null || typeof v === 'string' || (typeof v === 'number' && Number.isFinite(v)))) e.push(q + 'valor inválido em ' + k);
      }
    }
    if (!e.length && o.op !== 'inserir') {
      const ks = Object.keys(o.chave);
      const n = db.selectValue('SELECT count(*) FROM ' + o.tabela + ' WHERE ' + ks.map((k) => k + ' IS ?').join(' AND '), ks.map((k) => o.chave[k]));
      if (n !== 1) e.push(q + 'esperava 1 registro em ' + o.tabela + ' e achou ' + n);
    }
  });
  return e;
}

function aplicarOperacoes(db, ops) {
  for (const o of ops) {
    if (o.op === 'inserir') {
      const ks = Object.keys(o.valores);
      db.exec({ sql: 'INSERT INTO ' + o.tabela + ' (' + ks.join(',') + ') VALUES (' + ks.map(() => '?').join(',') + ')', bind: ks.map((k) => o.valores[k]) });
    } else if (o.op === 'atualizar') {
      const ks = Object.keys(o.set), cs = Object.keys(o.chave);
      db.exec({ sql: 'UPDATE ' + o.tabela + ' SET ' + ks.map((k) => k + '=?').join(',') + ' WHERE ' + cs.map((k) => k + ' IS ?').join(' AND '), bind: ks.map((k) => o.set[k]).concat(cs.map((k) => o.chave[k])) });
    } else {
      const cs = Object.keys(o.chave);
      db.exec({ sql: 'DELETE FROM ' + o.tabela + ' WHERE ' + cs.map((k) => k + ' IS ?').join(' AND '), bind: cs.map((k) => o.chave[k]) });
    }
  }
}

// Mesmo formato de registrarAuditoria do worker (tbAuditoria: somente inclusao)
export function gravarAuditoria(db, ev) {
  db.exec({
    sql: 'INSERT INTO auditoria (id_evento, quando, usuario, operacao, entidade, id_registro, antes, depois, motivo, resultado) VALUES (?,?,?,?,?,?,?,?,?,?)',
    bind: [ev.id, ev.quando, ev.usuario || 'app web', ev.operacao, ev.entidade, ev.idRegistro === undefined ? null : ev.idRegistro, ev.antes === undefined ? null : ev.antes, ev.depois === undefined ? null : ev.depois, ev.motivo === undefined ? null : ev.motivo, ev.resultado]
  });
}

// Roda o comando. Devolve { sucesso, repetido, erros: [texto], idComando }. Nunca deixa gravacao pela metade.
export function executarComando(db, cmd, op) {
  const usuario = (op && op.usuario) || 'app web', agora = (op && op.agora) || agoraLocal();
  const idCmd = cmd && typeof cmd.idComando === 'string' ? cmd.idComando : null;
  const falha = (erros, def) => {
    try { // falha tambem fica na auditoria (R5); se ate isso falhar, a resposta ainda diz o erro
      gravarAuditoria(db, {
        id: 'AUD-' + novoId('AUD').slice(3), quando: agora, usuario, operacao: (cmd && cmd.tipo) || 'comando inválido', entidade: (def && def.entidade) || 'Sistema',
        idRegistro: idCmd, antes: null, depois: null,
        motivo: 'Comando recusado, nada foi gravado (idComando ' + idCmd + ', dispositivo ' + (cmd && cmd.dispositivo) + ', feito em ' + (cmd && cmd.quando) + ')',
        resultado: 'Erro: ' + erros.join(' | ').slice(0, 900)
      });
    } catch (x) { /* sem auditoria da falha */ }
    return { sucesso: false, repetido: false, erros, idComando: idCmd };
  };
  const prob = validarEnvelope(cmd);
  if (prob.length) return falha(prob, null);
  const def = COMANDOS[cmd.tipo];
  const idEvento = 'AUD-' + cmd.idComando;
  if (db.selectValue('SELECT count(*) FROM auditoria WHERE id_evento = ?', [idEvento]) > 0) return { sucesso: true, repetido: true, erros: [], idComando: idCmd };
  let plano;
  try {
    const ler = fabricaLer(db); // 1) validar tudo ANTES de gravar (so leitura)
    const erros = def.validar(cmd.dados, ler);
    if (erros.length) return falha(erros, def);
    plano = def.planejar(cmd.dados, ler, { agora, usuario });
    const eo = conferirOperacoes(db, plano.operacoes);
    if (eo.length) return falha(eo, def);
  } catch (e) { return falha([String(e && e.message || e)], def); }
  let msg = null;
  db.exec('BEGIN'); // 2) gravar tudo numa transacao
  try {
    aplicarOperacoes(db, plano.operacoes);
    if (plano.conferir && plano.conferir.includes('safra')) {
      const er = conferirSafras(db, plano.safras);
      if (er.length) throw new Error(er.join(' | '));
    }
    gravarAuditoria(db, {
      id: idEvento, quando: agora, usuario, operacao: cmd.tipo, entidade: def.entidade, idRegistro: plano.idRegistro, antes: plano.antes, depois: plano.depois,
      motivo: (plano.motivo || '') + ' [dispositivo ' + cmd.dispositivo + '; feito em ' + cmd.quando + ']', resultado: 'Sucesso'
    });
    db.exec('COMMIT'); // chaves estrangeiras sao conferidas aqui (DEFERRABLE INITIALLY DEFERRED)
  } catch (e) {
    msg = String(e && e.message || e);
    try { db.exec('ROLLBACK'); } catch (x) { /* o SQLite ja desfez */ }
  }
  if (msg) return falha([msg.replace(/^.*?SQLITE_[A-Z_]+:\s*/, '')], def);
  return { sucesso: true, repetido: false, erros: [], idComando: idCmd };
}
