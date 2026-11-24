// Banco SQLite no aparelho (worker). Guarda em OPFS com o modo "sahpool"
// (nao exige cabecalhos especiais do servidor; funciona no Safari 16.4+).
import sqlite3InitModule from './lib/sqlite3.mjs';

const NOME = '/fazenda_teste.db';
let sqlite3 = null, pool = null, db = null;

function abrir() {
  db = new pool.OpfsSAHPoolDb(NOME);
  db.exec('CREATE TABLE IF NOT EXISTS teste (id INTEGER PRIMARY KEY, texto TEXT, quando TEXT)');
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

function resumo() {
  return {
    linhas: db.selectValue('SELECT count(*) FROM teste'),
    ultimas: db.selectArrays('SELECT id, texto, quando FROM teste ORDER BY id DESC LIMIT 5')
  };
}

const acoes = {
  iniciar,
  resumo: async () => resumo(),
  inserir: async ({ texto }) => {
    db.exec({ sql: 'INSERT INTO teste (texto, quando) VALUES (?, ?)', bind: [texto, new Date().toISOString()] });
    return resumo();
  },
  exportar: async () => {
    const bytes = sqlite3.capi.sqlite3_js_db_export(db);
    return { bytes, transfer: [bytes.buffer] };
  },
  importar: async ({ bytes }) => {
    db.close(); db = null;
    await pool.importDb(NOME, new Uint8Array(bytes));
    abrir();
    return resumo();
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
