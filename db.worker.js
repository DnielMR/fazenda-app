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

const acoes = {
  iniciar,
  tabelas: async () => listaTabelas(),
  ler: async ({ tabela, limite, desloc }) => {
    const existe = listaTabelas().find((t) => t.nome === tabela);
    if (!existe) throw new Error('Tabela desconhecida: ' + tabela);
    const colunas = [], linhas = [];
    db.exec({ sql: 'SELECT * FROM "' + tabela + '" LIMIT ? OFFSET ?', bind: [limite || 100, desloc || 0], rowMode: 'array', columnNames: colunas, resultRows: linhas });
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
  xlsm: async ({ dados, esquema, sql, parcial }) => {
    const erros = [], descartes = [], MAX = 60;
    const erro = (tabela, linha, msg, tipo) => { if (erros.length < MAX) erros.push({ tabela, linha, msg, tipo: tipo || 'dado' }); };
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
      for (const t of esquema.tabelas) {
        const d = dados[t.tabela];
        if (!d.linhas.length) continue;
        const ins = t.colunas.map((c) => c.sql);
        const stmt = db.prepare('INSERT INTO ' + t.sql + ' (' + ins.join(',') + ') VALUES (' + ins.map(() => '?').join(',') + ')');
        try {
          for (const l of d.linhas) {
            try { stmt.bind(l.v.map((x) => (x === '' ? null : x))).step(); }
            catch (e) {
              const m = String(e.message || e).replace(/^.*?SQLITE_/, 'SQLITE_');
              if (parcial) descartar(t.tabela, l.r, m); else erro(t.tabela, l.r, m);
            }
            finally { stmt.reset(); }
          }
        } finally { stmt.finalize(); }
      }
      if (!erros.length) {
        for (let volta = 0; volta < 20; volta++) {
          const fk = db.selectArrays('PRAGMA foreign_key_check');
          if (!fk.length) break;
          for (const f of fk) {
            const chave = db.selectValue('SELECT * FROM "' + f[0] + '" WHERE rowid = ?', [f[1]]);
            const msg = 'aponta para um registro que nao existe em ' + f[2];
            if (parcial) { descartar(f[0], null, 'chave "' + chave + '": ' + msg); db.exec({ sql: 'DELETE FROM "' + f[0] + '" WHERE rowid = ?', bind: [f[1]] }); }
            else erro(f[0], null, 'chave "' + chave + '": ' + msg);
          }
          if (!parcial) break;
        }
      }
      if (erros.length) { db.exec('ROLLBACK'); await restaurar(); return { sucesso: false, erros, tabelas: null }; }
      db.exec('COMMIT');
    } catch (e) {
      try { if (db) db.exec('ROLLBACK'); } catch (x) { /* ja desfeito */ }
      await restaurar();
      throw e;
    }
    return { sucesso: true, erros: [], descartes, tabelas: listaTabelas() };
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
