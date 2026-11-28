// Padrao de tela do app (Fase F, D-059). TODA tela nova (fases A-E) usa estas pecas, para o app inteiro se comportar igual:
//   Tela.lista(...)       lista com busca (sem diferenca de acento ou maiuscula); mostra NOMES, nunca IDs (R2)
//   Tela.formulario(...)  campos + Salvar/Cancelar -> confere os campos -> "Confira antes de gravar" -> grava -> mensagem
//                          final dizendo o que gravou (R1). Erro aparece em portugues simples, no proprio formulario.
//   Tela.gravar(...)      monta os comandos (regras.js) e chama appFazenda.executarComandos (copia de seguranca antes)
//   Tela.numeroFicha(7) = "0007" e Tela.codigoSaida(7, 1) = "0007-S01" (R9)
//   Tela.acentuar(texto)  so para TEXTO FIXO do proprio app (ex.: nome de coluna do esquema). NUNCA em mensagem que tenha
//                          dado do usuario (nome de area/produto, texto digitado): dado aparece exatamente como foi gravado.
//                          As frases do worker/regras/escrita ja tem acento na origem (P-36, D-060).
//   Tela.erroSimples(e)   traduz erro tecnico (SQLite, rede, Drive) para portugues simples
// As funcoes de texto nao usam a tela: rodam tambem no Node (module.exports), por isso o arquivo e um script comum.
(function (raiz) {
  'use strict';

  // ---------- Acentos (P-32) ----------
  // So mexe em palavra feita SO de letras (sem numero, _ . -): nome de arquivo, ID e coluna (id_aplicacao) ficam como estao.
  // Palavras ambiguas ficam de fora de proposito: e/e, esta/esta, ha/ha (hectare), tem/tem, media, ira.
  const DIC = {
    nao: 'não', sao: 'são', ja: 'já', so: 'só', ate: 'até', voce: 'você', voces: 'vocês', tambem: 'também', entao: 'então',
    alem: 'além', apos: 'após', porem: 'porém', mes: 'mês', tres: 'três', ninguem: 'ninguém', alguem: 'alguém', atraves: 'através',
    ultimo: 'último', ultima: 'última', ultimos: 'últimos', ultimas: 'últimas', unico: 'único', unica: 'única', unicos: 'únicos', unicas: 'únicas',
    codigo: 'código', codigos: 'códigos', numero: 'número', numeros: 'números', area: 'área', areas: 'áreas', pagina: 'página',
    proximo: 'próximo', proxima: 'próxima', proximos: 'próximos', valido: 'válido', valida: 'válida', validos: 'válidos', validas: 'válidas',
    invalido: 'inválido', invalida: 'inválida', invalidos: 'inválidos', invalidas: 'inválidas', historico: 'histórico', tecnico: 'técnico',
    tecnica: 'técnica', principio: 'princípio', principios: 'princípios', automatico: 'automático', automatica: 'automática',
    periodo: 'período', conteudo: 'conteúdo', espaco: 'espaço', seguranca: 'segurança', copia: 'cópia', copias: 'cópias',
    mantem: 'mantém', contem: 'contém', temporaria: 'temporária', temporario: 'temporário', concluida: 'concluída', concluido: 'concluído',
    incluida: 'incluída', incluido: 'incluído', excluida: 'excluída', excluido: 'excluído', rotulo: 'rótulo', titulo: 'título',
    saida: 'saída', saidas: 'saídas', inicio: 'início', logica: 'lógica', agricola: 'agrícola', estagio: 'estágio', analise: 'análise',
    virgula: 'vírgula', obrigatoria: 'obrigatória', memoria: 'memória', historia: 'história', maquina: 'máquina', facil: 'fácil',
    dificil: 'difícil', util: 'útil', propria: 'própria', proprio: 'próprio', proprias: 'próprias', proprios: 'próprios',
    minimo: 'mínimo', maximo: 'máximo', calculo: 'cálculo', calculos: 'cálculos', parametro: 'parâmetro', especifico: 'específico',
    servico: 'serviço', servicos: 'serviços', preco: 'preço', endereco: 'endereço', cabecalho: 'cabeçalho', indice: 'índice',
    celula: 'célula', celulas: 'células', sera: 'será', havera: 'haverá', ficara: 'ficará', podera: 'poderá', tera: 'terá',
    nivel: 'nível', diferenca: 'diferença', duvida: 'dúvida', agronomo: 'agrônomo', portugues: 'português', medio: 'médio',
    rapido: 'rápido', grafico: 'gráfico', pratico: 'prático', basico: 'básico', simbolo: 'símbolo',
    sequencia: 'sequência', especie: 'espécie', serie: 'série', varios: 'vários', varias: 'várias', comeco: 'começo', excecao: 'exceção',
    precos: 'preços', niveis: 'níveis', duvidas: 'dúvidas', paginas: 'páginas', indices: 'índices'
  };
  const NAO_MEXER = new Set(['cao', 'cacao', 'tao']); // curtas que as regras abaixo errariam
  const REGRAS = [ // terminacao sem acento -> com acento (so palavras com 4 letras ou mais)
    [/coes$/, 'ções'], [/cao$/, 'ção'], [/oes$/, 'ões'], [/aos$/, 'ãos'], [/ao$/, 'ão'], [/aes$/, 'ães'],
    [/encias$/, 'ências'], [/encia$/, 'ência'], [/ancias$/, 'âncias'], [/ancia$/, 'ância'],
    [/aveis$/, 'áveis'], [/iveis$/, 'íveis'], [/avel$/, 'ável'], [/ivel$/, 'ível'],
    [/orios$/, 'órios'], [/orio$/, 'ório'], [/arios$/, 'ários'], [/ario$/, 'ário']
  ];
  function acentuarPalavra(p, maiusculas) {
    const m = p.toLowerCase();
    let r = DIC[m];
    if (r === undefined && m.length >= 4 && !NAO_MEXER.has(m)) {
      for (const [re, fim] of REGRAS) { if (re.test(m)) { r = m.replace(re, fim); break; } }
    }
    if (r === undefined || r === m) return p;
    if (p === m) return r;
    if (p === m.charAt(0).toUpperCase() + m.slice(1)) return r.charAt(0).toUpperCase() + r.slice(1);
    if (maiusculas && p === m.toUpperCase() && p.length > 1) return r.toUpperCase();
    return p; // MiStUrAdo (ex.: sigla) fica como esta
  }
  // opc.maiusculas: tambem palavras TODAS EM MAIUSCULA (usado so nos textos do proprio app; nos dados, nome de produto em
  // maiuscula fica como foi digitado).
  function acentuar(texto, opc) {
    if (texto === null || texto === undefined) return '';
    const mai = !!(opc && opc.maiusculas);
    return String(texto).replace(/[A-Za-z0-9_]+(?:[.\-][A-Za-z0-9_]+)*/g, (t) => (/^[A-Za-z]+$/.test(t) ? acentuarPalavra(t, mai) : t));
  }
  // Para busca: tira acento e maiuscula ("Talhão" acha "talhao")
  const semAcento = (t) => String(t === null || t === undefined ? '' : t).normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

  // ---------- Numeros visiveis (R9) ----------
  const numeroFicha = (n) => (n === null || n === undefined || n === '' ? '' : String(n).padStart(4, '0'));
  const codigoSaida = (numero, seq) => numeroFicha(numero) + '-S' + String(seq).padStart(2, '0');
  // Numero digitado do jeito brasileiro: "1.234,5" ou "12,5" -> 12.5; devolve NaN se nao for numero
  function lerNumero(t) {
    let s = String(t === null || t === undefined ? '' : t).trim().replace(/\s/g, '');
    if (!s) return NaN;
    if (s.indexOf(',') >= 0) s = s.replace(/\./g, '').replace(',', '.');
    return /^-?\d+(\.\d+)?$/.test(s) ? Number(s) : NaN;
  }

  // ---------- Erros em portugues simples ----------
  const nomeColuna = (c) => acentuar(String(c).replace(/^id_/, '').replace(/_/g, ' '));
  const TRADUCOES = [
    [/UNIQUE constraint failed: \w+\.(\w+)/i, (c) => 'Já existe outro cadastro com o mesmo ' + nomeColuna(c) + '. Use outro valor. Nada foi gravado.'],
    [/UNIQUE constraint failed/i, () => 'Já existe outro cadastro com esses mesmos dados. Nada foi gravado.'],
    [/NOT NULL constraint failed: \w+\.(\w+)/i, (c) => 'Falta preencher: ' + nomeColuna(c) + '. Nada foi gravado.'],
    [/FOREIGN KEY constraint failed/i, () => 'Este registro depende de outro que não existe (ou ainda é usado por outro). Nada foi gravado.'],
    [/CHECK constraint failed/i, () => 'Um dos valores está fora do permitido. Confira os campos. Nada foi gravado.'],
    [/Failed to fetch|NetworkError|Load failed|network/i, () => 'Sem internet, ou o servidor não respondeu. Confira a conexão e tente de novo.'],
    [/QuotaExceeded|quota/i, () => 'Acabou o espaço deste aparelho para o app. Libere espaço e tente de novo.'],
    [/Access Handle|NoModificationAllowed|database is locked/i, () => 'O banco já está aberto em outra aba ou janela deste app. Feche as outras (inclusive o app da tela inicial) e recarregue.'],
    [/Drive respondeu 401/, () => 'O acesso ao Google venceu. Toque em "Entrar com o Google" de novo.'],
    [/Drive respondeu 403/, () => 'O Google recusou o pedido (sem permissão ou limite de uso). Espere um pouco e tente de novo.'],
    [/Drive respondeu 404/, () => 'O arquivo não foi encontrado no Google Drive.'],
    [/Drive respondeu 5\d\d/, () => 'O Google Drive está com problema agora. Tente de novo em alguns minutos.']
  ];
  function erroSimples(e) {
    const m = String((e && e.message) || e || 'erro desconhecido').replace(/^Error:\s*/, '');
    for (const [re, f] of TRADUCOES) { const x = m.match(re); if (x) return f(x[1]); }
    return m; // frase ja vem com acento da origem; pode conter dado do usuario: nao mexer
  }

  const Tela = { acentuar, semAcento, numeroFicha, codigoSaida, lerNumero, erroSimples };

  // ---------- Pecas de tela (so no navegador) ----------
  if (typeof document !== 'undefined') {
    const el = (tag, txt, cls) => { const e = document.createElement(tag); if (txt !== undefined && txt !== null) e.textContent = txt; if (cls) e.className = cls; return e; };
    const botao = (txt, cls) => { const b = el('button', txt, cls); b.type = 'button'; return b; };
    Tela.el = el;

    // Caixa de mensagem: tipo 'ok' (verde: gravou), 'erro' (vermelho: nada gravado), 'info' (cinza). Aceita texto ou lista.
    Tela.mensagem = function (alvo, tipo, linhas) {
      const box = el('div', undefined, 'msg ' + (tipo || 'info'));
      box.setAttribute('role', tipo === 'erro' ? 'alert' : 'status');
      [].concat(linhas).forEach((t, i) => box.appendChild(el(i ? 'div' : 'b', t)));
      if (alvo) alvo.appendChild(box);
      return box;
    };

    // Painel "Confira antes de gravar" dentro da tela (o confirm() do navegador some no app instalado do iPhone).
    // Devolve uma Promise: true = confirmou, false = voltou.
    Tela.confirmar = function (alvo, linhas, rotuloOk) {
      return new Promise((resolve) => {
        const box = el('div', undefined, 'confirmar');
        box.appendChild(el('b', 'Confira antes de gravar:'));
        const ul = el('ul'); [].concat(linhas).forEach((t) => ul.appendChild(el('li', t))); box.appendChild(ul);
        const ok = botao(rotuloOk || 'Confirmar e gravar'), volta = botao('Voltar e corrigir', 'sec');
        const fim = (v) => { box.remove(); resolve(v); };
        ok.onclick = () => fim(true); volta.onclick = () => fim(false);
        box.appendChild(ok); box.appendChild(volta);
        alvo.appendChild(box); ok.focus();
      });
    };

    // Lista com busca. itens: [{titulo, detalhe, ...qualquer}]; aoEscolher(item). Mostra no maximo `limite` itens.
    Tela.lista = function (o) {
      const alvo = o.alvo; alvo.innerHTML = '';
      const busca = el('input'); busca.type = 'search'; busca.placeholder = o.rotuloBusca || 'Buscar...'; busca.setAttribute('aria-label', busca.placeholder);
      const info = el('p', '', 'sub'), ul = el('ul', undefined, 'lista');
      const limite = o.limite || 200;
      const desenhar = () => {
        const q = semAcento(busca.value).trim().split(/\s+/).filter(Boolean);
        const achados = o.itens.filter((it) => { const t = semAcento(it.titulo + ' ' + (it.detalhe || '')); return q.every((p) => t.indexOf(p) >= 0); });
        ul.innerHTML = '';
        achados.slice(0, limite).forEach((it) => {
          const li = el('li'), b = botao(undefined, 'item');
          b.appendChild(el('b', it.titulo)); if (it.detalhe) b.appendChild(el('span', it.detalhe));
          b.onclick = () => o.aoEscolher(it);
          li.appendChild(b); ul.appendChild(li);
        });
        info.textContent = !o.itens.length ? (o.vazio || 'Nada cadastrado ainda.')
          : (!achados.length ? 'Nada encontrado para "' + busca.value.trim() + '".'
            : achados.length + (achados.length === 1 ? ' encontrado' : ' encontrados') + (q.length ? ' de ' + o.itens.length : '') + (achados.length > limite ? ' (mostrando ' + limite + '; refine a busca)' : ''));
      };
      busca.oninput = desenhar;
      if (o.itens.length) alvo.appendChild(busca);
      alvo.appendChild(info); alvo.appendChild(ul);
      desenhar();
      return { redesenhar: desenhar };
    };

    // Formulario padrao. o = {
    //   alvo, titulo, campos: [{nome, rotulo, tipo: 'texto'|'texto longo'|'numero'|'data'|'lista', obrigatorio, max, min, ajuda,
    //                           opcoes: [{valor, rotulo}] (lista: o usuario ve o rotulo = NOME; grava o valor = ID)}],
    //   valores: {nome: valor inicial}, validar(valores) -> [mensagens], resumo(valores, mudancas) -> [linhas da confirmacao],
    //   gravar(valores, mudancas) -> Promise<texto ou [linhas]> (mensagem final do que gravou), aoFechar() (Voltar/Cancelar) }
    Tela.formulario = function (o) {
      const alvo = o.alvo; alvo.innerHTML = '';
      const form = el('form', undefined, 'form'); form.noValidate = true;
      if (o.titulo) form.appendChild(el('h3', o.titulo));
      const inicial = Object.assign({}, o.valores || {});
      const ents = {};
      o.campos.forEach((c) => {
        const id = 'campo_' + c.nome + '_' + Math.random().toString(36).slice(2, 8);
        const wrap = el('div', undefined, 'campo');
        const lab = el('label', c.rotulo + (c.obrigatorio ? ' *' : '')); lab.htmlFor = id; wrap.appendChild(lab);
        let ent;
        if (c.tipo === 'lista') {
          ent = el('select'); ent.appendChild(new Option(c.obrigatorio ? 'escolha...' : '(nenhum)', ''));
          (c.opcoes || []).forEach((op) => ent.appendChild(new Option(op.rotulo, op.valor)));
        } else if (c.tipo === 'texto longo') { ent = el('textarea'); ent.rows = 4; }
        else { ent = el('input'); ent.type = c.tipo === 'data' ? 'date' : 'text'; if (c.tipo === 'numero') ent.inputMode = 'decimal'; }
        if (c.max && c.tipo !== 'numero') ent.maxLength = c.max;
        ent.id = id; ent.name = c.nome;
        const v0 = inicial[c.nome];
        ent.value = v0 === null || v0 === undefined ? '' : (c.tipo === 'numero' ? String(v0).replace('.', ',') : String(v0));
        wrap.appendChild(ent);
        if (c.ajuda) wrap.appendChild(el('small', c.ajuda));
        const erro = el('div', '', 'erro-campo'); wrap.appendChild(erro);
        ents[c.nome] = { c, ent, erro };
        form.appendChild(wrap);
      });
      const zona = el('div'); // confirmacao e mensagens
      const salvar = botao('Salvar'), cancelar = botao('Cancelar', 'sec');
      salvar.type = 'submit';
      form.appendChild(salvar); form.appendChild(cancelar); form.appendChild(zona);
      alvo.appendChild(form);

      const textoDe = (c, v) => {
        if (v === null || v === undefined || v === '') return '(vazio)';
        if (c.tipo === 'lista') { const op = (c.opcoes || []).find((x) => String(x.valor) === String(v)); return op ? op.rotulo : String(v); }
        if (c.tipo === 'numero') return String(v).replace('.', ',');
        if (c.tipo === 'data') { const m = String(v).match(/^(\d{4})-(\d{2})-(\d{2})/); return m ? m[3] + '/' + m[2] + '/' + m[1] : String(v); }
        return '"' + String(v) + '"';
      };
      function ler() {
        const v = {}, erros = [];
        Object.values(ents).forEach(({ c, ent, erro }) => {
          erro.textContent = ''; ent.removeAttribute('aria-invalid');
          let x = ent.value.trim();
          let msg = '';
          if (!x) { x = null; if (c.obrigatorio) msg = 'Preencha ' + c.rotulo.toLowerCase() + '.'; }
          else if (c.tipo === 'numero') {
            const n = lerNumero(x);
            if (Number.isNaN(n)) msg = 'Digite só o número (ex.: 12,5).';
            else if (c.min !== undefined && n < c.min) msg = 'O mínimo é ' + String(c.min).replace('.', ',') + '.';
            else if (c.max !== undefined && n > c.max) msg = 'O máximo é ' + String(c.max).replace('.', ',') + '.';
            else x = n;
          } else if (c.max && x.length > c.max) msg = 'Use no máximo ' + c.max + ' letras (tem ' + x.length + ').';
          if (msg) { erro.textContent = msg; ent.setAttribute('aria-invalid', 'true'); erros.push({ ent, msg }); }
          v[c.nome] = x;
        });
        return { v, erros };
      }
      let ocupado = false;
      form.onsubmit = async (ev) => {
        ev.preventDefault();
        if (ocupado) return; // Repeticao de botao: um toque so
        zona.innerHTML = '';
        const { v, erros } = ler();
        if (erros.length) { erros[0].ent.focus(); Tela.mensagem(zona, 'erro', ['Confira o campo marcado. Nada foi gravado.']); return; }
        const extra = o.validar ? (o.validar(v) || []) : [];
        if (extra.length) { Tela.mensagem(zona, 'erro', ['Não deu para gravar:'].concat(extra)); return; }
        const mudancas = o.campos.filter((c) => {
          const a = inicial[c.nome], b = v[c.nome];
          return (a === undefined || a === '' ? null : a) !== b && String(a === undefined || a === null ? '' : a) !== String(b === null ? '' : b);
        });
        if (!mudancas.length) { Tela.mensagem(zona, 'info', ['Nada mudou: não há o que gravar.']); return; }
        const linhas = o.resumo ? o.resumo(v, mudancas) : mudancas.map((c) => c.rotulo + ': ' + textoDe(c, inicial[c.nome]) + ' → ' + textoDe(c, v[c.nome]));
        ocupado = true; salvar.disabled = true; cancelar.disabled = true;
        const ok = await Tela.confirmar(zona, linhas);
        if (!ok) { ocupado = false; salvar.disabled = false; cancelar.disabled = false; return; }
        const rot = salvar.textContent; salvar.textContent = 'Gravando...';
        try {
          const fim = await o.gravar(v, mudancas);
          form.querySelectorAll('input,textarea,select').forEach((x) => { x.disabled = true; });
          salvar.hidden = true; cancelar.hidden = true;
          Tela.mensagem(zona, 'ok', fim || 'Gravado.');
          const volta = botao('Voltar', 'sec'); volta.onclick = () => { if (o.aoFechar) o.aoFechar(true); };
          zona.appendChild(volta); volta.focus();
        } catch (e) {
          Tela.mensagem(zona, 'erro', ['Não foi gravado.', erroSimples(e)]);
          salvar.disabled = false; cancelar.disabled = false; ocupado = false;
        } finally { salvar.textContent = rot; }
      };
      cancelar.onclick = () => { if (o.aoFechar) o.aoFechar(false); };
      const primeiro = Object.values(ents)[0]; if (primeiro) primeiro.ent.focus();
      return { form, ents };
    };

    // Grava uma lista [{tipo, dados}] como comandos (regras.js), com copia de seguranca antes (padrao de executarComandos).
    // Devolve o resultado de executarComandos; se algum comando for recusado, lanca o erro (o formulario mostra em portugues).
    let regras = null;
    const agoraLocal = () => { const d = new Date(); d.setMinutes(d.getMinutes() - d.getTimezoneOffset()); return d.toISOString().slice(0, 19); };
    Tela.gravar = async function (lista, opc) {
      regras = regras || await import('./regras.js');
      const disp = /iPhone|iPad|iPod/.test(navigator.userAgent) ? 'iphone' : 'pc';
      const cmds = lista.map((x) => regras.novoComando(x.tipo, x.dados, agoraLocal(), disp));
      const r = await raiz.appFazenda.executarComandos(cmds, opc);
      if (r.parouEm !== null) throw new Error(r.resultados[r.parouEm].erros.join('; '));
      return r;
    };
  }

  raiz.Tela = Tela;
  if (typeof module !== 'undefined' && module.exports) module.exports = Tela;
})(typeof window !== 'undefined' ? window : globalThis);
