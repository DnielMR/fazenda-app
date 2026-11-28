// Leitor de .xlsm/.xlsx no navegador (sem bibliotecas): le as TABELAS do Excel (tbAreas, tbProdutos...)
// e devolve { nomeDaTabela: { cab: [...], linhas: [{ r: linhaNoExcel, v: [...] }] } }.
// Valores sao os ultimos calculados gravados no arquivo (como o Python com data_only=True).
// Datas viram texto ISO "AAAA-MM-DDTHH:MM:SS" (igual a ferramentas/xlsm_para_sqlite.py).
(function () {
  const u16 = (dv, o) => dv.getUint16(o, true), u32 = (dv, o) => dv.getUint32(o, true);

  async function inflarRaw(bytes) {
    const ds = new DecompressionStream('deflate-raw');
    const w = ds.writable.getWriter(); w.write(bytes); w.close();
    return new Uint8Array(await new Response(ds.readable).arrayBuffer());
  }

  // ---- zip ----
  async function abrirZip(buf) {
    const dv = new DataView(buf);
    let eocd = -1;
    for (let i = buf.byteLength - 22; i >= Math.max(0, buf.byteLength - 65557); i--) { if (u32(dv, i) === 0x06054b50) { eocd = i; break; } }
    if (eocd < 0) throw new Error('Este arquivo não é um .xlsm/.xlsx válido (zip não encontrado).');
    const n = u16(dv, eocd + 10); let p = u32(dv, eocd + 16);
    const itens = {}, td = new TextDecoder();
    for (let i = 0; i < n; i++) {
      if (u32(dv, p) !== 0x02014b50) throw new Error('Zip danificado.');
      const metodo = u16(dv, p + 10), comp = u32(dv, p + 20), nl = u16(dv, p + 28), el = u16(dv, p + 30), cl = u16(dv, p + 32), loc = u32(dv, p + 42);
      itens[td.decode(new Uint8Array(buf, p + 46, nl))] = { metodo, comp, loc };
      p += 46 + nl + el + cl;
    }
    async function bytes(nome) {
      const it = itens[nome]; if (!it) return null;
      const nl = u16(dv, it.loc + 26), el = u16(dv, it.loc + 28), ini = it.loc + 30 + nl + el;
      const cru = new Uint8Array(buf, ini, it.comp);
      if (it.metodo === 0) return cru;
      if (it.metodo === 8) return inflarRaw(cru);
      throw new Error('Compactação não suportada no zip: ' + it.metodo);
    }
    return {
      nomes: () => Object.keys(itens),
      async texto(nome) { const b = await bytes(nome); return b ? td.decode(b) : null; }
    };
  }

  const xml = (s) => new DOMParser().parseFromString(s, 'application/xml');
  const lista = (el, tag) => Array.from(el.getElementsByTagName(tag));
  function attrLocal(el, local) { for (const a of Array.from(el.attributes)) { if (a.localName === local) return a.value; } return null; }
  function colNum(ref) { const m = /^([A-Z]+)/.exec(ref)[1]; let n = 0; for (const c of m) n = n * 26 + (c.charCodeAt(0) - 64); return n; }
  function linhaNum(ref) { return parseInt(/([0-9]+)$/.exec(ref)[1], 10); }
  function limites(ref) { // "A1:I20"
    const [a, b] = ref.split(':'); const bb = b || a;
    return { c1: colNum(a), r1: linhaNum(a), c2: colNum(bb), r2: linhaNum(bb) };
  }
  function caminho(base, alvo) { // resolve "../tables/table1.xml" a partir de "xl/worksheets/"
    if (alvo.startsWith('/')) return alvo.slice(1);
    const partes = base.split('/'); partes.pop();
    for (const p of alvo.split('/')) { if (p === '..') partes.pop(); else if (p !== '.') partes.push(p); }
    return partes.join('/');
  }

  const FMT_DATA_BUILTIN = new Set([14, 15, 16, 17, 18, 19, 20, 21, 22, 27, 28, 29, 30, 31, 32, 33, 34, 35, 36, 45, 46, 47, 50, 51, 52, 53, 54, 55, 56, 57, 58]);
  function formatoEhData(codigo) {
    const s = codigo.replace(/"[^"]*"/g, '').replace(/\[[^\]]*\]/g, '').replace(/\\./g, '');
    return /[dmyhs]/i.test(s);
  }
  function serialParaIso(n) {
    const ms = Math.round((n - 25569) * 86400) * 1000;
    return new Date(ms).toISOString().slice(0, 19);
  }

  async function lerXlsm(arquivo) {
    const zip = await abrirZip(await arquivo.arrayBuffer());
    const wbTxt = await zip.texto('xl/workbook.xml');
    if (!wbTxt) throw new Error('Não achei xl/workbook.xml: o arquivo não parece uma planilha do Excel.');
    const rels = {};
    lista(xml(await zip.texto('xl/_rels/workbook.xml.rels')), 'Relationship').forEach((r) => { rels[r.getAttribute('Id')] = r.getAttribute('Target'); });

    // textos compartilhados
    const ss = [];
    const ssTxt = await zip.texto('xl/sharedStrings.xml');
    if (ssTxt) lista(xml(ssTxt), 'si').forEach((si) => { ss.push(lista(si, 't').map((t) => t.textContent).join('')); });

    // estilos: quais indices de formato de celula sao data
    const ehData = [];
    const stTxt = await zip.texto('xl/styles.xml');
    if (stTxt) {
      const sd = xml(stTxt), custom = {};
      lista(sd, 'numFmt').forEach((f) => { custom[f.getAttribute('numFmtId')] = f.getAttribute('formatCode') || ''; });
      const xfs = sd.getElementsByTagName('cellXfs')[0];
      if (xfs) Array.from(xfs.children).forEach((xf) => {
        const id = xf.getAttribute('numFmtId');
        ehData.push(FMT_DATA_BUILTIN.has(Number(id)) || (custom[id] !== undefined && formatoEhData(custom[id])));
      });
    }

    const saida = {};
    for (const sh of lista(xml(wbTxt), 'sheet')) {
      const alvo = rels[attrLocal(sh, 'id')]; if (!alvo) continue;
      const pSheet = caminho('xl/workbook.xml', alvo);
      const nomeRels = pSheet.replace(/([^/]+)$/, '_rels/$1.rels');
      const relTxt = await zip.texto(nomeRels); if (!relTxt) continue;
      const tabelas = [];
      for (const r of lista(xml(relTxt), 'Relationship')) {
        if (!/\/table$/.test(r.getAttribute('Type') || '')) continue;
        const tTxt = await zip.texto(caminho(pSheet, r.getAttribute('Target'))); if (!tTxt) continue;
        const t = xml(tTxt).documentElement;
        tabelas.push({ nome: t.getAttribute('name'), lim: limites(t.getAttribute('ref')),
          colunas: lista(t, 'tableColumn').map((c) => c.getAttribute('name')) });
      }
      if (!tabelas.length) continue;

      // celulas da planilha: so as que caem dentro de alguma tabela
      const grade = {}; // "r:c" -> valor
      const sd = xml(await zip.texto(pSheet));
      const dentro = (r, c) => tabelas.some((t) => r >= t.lim.r1 && r <= t.lim.r2 && c >= t.lim.c1 && c <= t.lim.c2);
      for (const c of lista(sd, 'c')) {
        const ref = c.getAttribute('r'), r = linhaNum(ref), col = colNum(ref);
        if (!dentro(r, col)) continue;
        const t = c.getAttribute('t'), vEl = c.getElementsByTagName('v')[0];
        let v = vEl ? vEl.textContent : null;
        if (t === 'inlineStr') v = lista(c, 't').map((x) => x.textContent).join('');
        else if (v === null) v = null;
        else if (t === 's') v = ss[parseInt(v, 10)];
        else if (t === 'b') v = v === '1' ? 1 : 0;
        else if (t === 'str' || t === 'e') v = v;
        else { // numero ou data
          const num = Number(v);
          v = (ehData[parseInt(c.getAttribute('s') || '0', 10)] && num >= 1) ? serialParaIso(num) : num;
        }
        grade[r + ':' + col] = v;
      }
      for (const t of tabelas) {
        const cab = [], linhas = [];
        for (let c = t.lim.c1; c <= t.lim.c2; c++) {
          const h = grade[t.lim.r1 + ':' + c];
          cab.push(h !== undefined && h !== null && h !== '' ? String(h) : t.colunas[c - t.lim.c1]);
        }
        for (let r = t.lim.r1 + 1; r <= t.lim.r2; r++) {
          const v = [];
          for (let c = t.lim.c1; c <= t.lim.c2; c++) { const x = grade[r + ':' + c]; v.push(x === undefined ? null : x); }
          if (v.some((x) => x !== null && x !== '')) linhas.push({ r, v });
        }
        saida[t.nome] = { cab, linhas };
      }
    }
    return saida;
  }

  window.LerXlsm = lerXlsm;
})();
