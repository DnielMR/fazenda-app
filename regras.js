// Regras do app: SO funcoes puras (sem tela, sem SQL, sem relogio proprio). Roda no navegador (worker) e no Node (testes).
// Um COMANDO e JSON puro: { tipo, dados, idComando, quando, dispositivo }. Pode ser guardado num arquivo (diario de
// operacoes, D-055) e rodado depois, em outro aparelho: repetir o mesmo idComando nao grava de novo (escrita.js).
// Cada tipo de comando = { entidade, validar(dados, ler) -> [erros], planejar(dados, ler, ctx) -> plano }.
//   ler(tabela, onde) devolve a lista de linhas (objetos) em que cada coluna de `onde` e igual ao valor dado (so leitura).
//   plano = { operacoes: [{op:'inserir'|'atualizar'|'excluir', tabela, valores|chave+set}], idRegistro, antes, depois, motivo, conferir }
//   conferir: ['safra'] + safras: [ids] pedem a conferencia de soma das partes dessas safras, dentro da transacao.

// ---------- IDs (R9): prefixo + 32 hexadecimais MAIUSCULOS, igual ao newID do VBA. Excecao: area AreNN ----------
function bytesAleatorios(n) {
  const b = new Uint8Array(n);
  globalThis.crypto.getRandomValues(b);
  return b;
}
export function novoId(prefixo, aleatorio) {
  if (typeof prefixo !== 'string' || !/^[A-Za-z]{2,6}$/.test(prefixo)) throw new Error('Prefixo de ID inválido: ' + prefixo);
  const b = (aleatorio || bytesAleatorios)(16);
  let h = '';
  for (let i = 0; i < 16; i++) h += b[i].toString(16).padStart(2, '0');
  return prefixo + h.toUpperCase();
}
export const ehIdValido = (id, prefixo) => typeof id === 'string' && new RegExp('^' + prefixo + '[0-9A-F]{32}$').test(id);

// ---------- Envelope do comando ----------
const ISO = /^\d{4}-\d{2}-\d{2}(T\d{2}:\d{2}(:\d{2})?)?/;
export const REGEX_ID_COMANDO = /^[A-Za-z0-9_-]{8,80}$/;
// Cria um comando novo (idComando gerado aqui; "quando" vem de fora para a funcao continuar pura)
export function novoComando(tipo, dados, quando, dispositivo) {
  return { tipo, dados, idComando: novoId('CMD'), quando, dispositivo: dispositivo || 'pc' };
}
// Devolve a lista de problemas do comando (vazia = ok). Confere tambem que e JSON puro (nada de funcao/Date/undefined).
export function validarEnvelope(cmd) {
  const e = [];
  if (!cmd || typeof cmd !== 'object' || Array.isArray(cmd)) return ['comando vazio ou em formato errado'];
  if (typeof cmd.tipo !== 'string' || !cmd.tipo) e.push('falta o tipo do comando');
  else if (!Object.prototype.hasOwnProperty.call(COMANDOS, cmd.tipo)) e.push('tipo de comando desconhecido: ' + cmd.tipo);
  if (typeof cmd.idComando !== 'string' || !REGEX_ID_COMANDO.test(cmd.idComando)) e.push('idComando inválido (use 8 a 80 letras, números, - ou _)');
  if (typeof cmd.quando !== 'string' || !ISO.test(cmd.quando)) e.push('quando inválido (use AAAA-MM-DDThh:mm:ss)');
  if (typeof cmd.dispositivo !== 'string' || !cmd.dispositivo.trim()) e.push('falta o dispositivo');
  if (!cmd.dados || typeof cmd.dados !== 'object' || Array.isArray(cmd.dados)) e.push('dados do comando em formato errado');
  else if (!ehJsonPuro(cmd.dados)) e.push('dados não são JSON puro (só texto, número, verdadeiro/falso, nulo, listas e objetos simples)');
  return e;
}
export function ehJsonPuro(v, fundo) {
  if ((fundo || 0) > 20) return false;
  if (v === null || typeof v === 'string' || typeof v === 'boolean') return true;
  if (typeof v === 'number') return Number.isFinite(v);
  if (Array.isArray(v)) return v.every((x) => ehJsonPuro(x, (fundo || 0) + 1));
  if (typeof v === 'object') {
    const p = Object.getPrototypeOf(v);
    return (p === Object.prototype || p === null) && Object.values(v).every((x) => ehJsonPuro(x, (fundo || 0) + 1));
  }
  return false; // undefined, funcao, Date com prototipo proprio, simbolo...
}

// ---------- Conferencia de safra (R: partes somam 100% e hectares somam a area da safra Aberta) ----------
// Funcao pura: recebe os numeros ja lidos pela consulta de conferencia (escrita.js) e devolve as mensagens.
export function avaliarSafra({ safra, areaNome, areaHa, partes }) {
  const e = [];
  if (!partes.length) return e; // safra sem partes: nada a conferir (e a regra so vale para quem tem partes)
  const prop = partes.reduce((s, p) => s + (Number(p.proporcao) || 0), 0), ha = partes.reduce((s, p) => s + (Number(p.hectares) || 0), 0);
  const rotulo = 'Safra ' + safra + (areaNome ? ' (' + areaNome + ')' : '');
  if (partes.some((p) => p.proporcao === null || p.proporcao === undefined)) e.push(rotulo + ': há parte sem proporção (%).');
  else if (Math.abs(prop - 100) > 0.01) e.push(rotulo + ': as partes somam ' + Number(prop.toFixed(4)) + '% (precisa ser 100%).');
  const tol = Math.max(0.01, Math.abs(areaHa) * 0.0001);
  if (Math.abs(ha - areaHa) > tol) e.push(rotulo + ': as partes somam ' + Number(ha.toFixed(4)) + ' ha, e a área tem ' + areaHa + ' ha.');
  return e;
}

// ---------- Areas (Fase A1; R9, R12, C3) ----------
// Chave de comparacao do nome: sem diferenca de maiuscula, acento ou espaco ("Talhão 1" = "talhao1" = " TALHAO  1 ").
// So serve para COMPARAR; o nome gravado e o digitado (sem os espacos das pontas), nunca esta chave.
export const chaveNome = (t) => String(t === null || t === undefined ? '' : t).normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/\s+/g, '');
// R9: a area e a unica excecao do novoId: "Are" + numero com 2 digitos (Are01, Are02... Are100), maior existente + 1 (igual NovoIDArea do VBA)
export function proximoIdArea(ids) {
  let maior = 0;
  for (const id of ids || []) { const m = /^Are(\d+)$/i.exec(String(id || '').trim()); if (m) maior = Math.max(maior, Number(m[1])); }
  return 'Are' + String(maior + 1).padStart(2, '0');
}
// R12: area inativa nao entra em operacao nova (safra, ficha, execucao). Devolve a lista de problemas (vazia = pode usar).
export function conferirAreaParaOperacao(area) {
  if (!area) return ['área não encontrada'];
  return area.situacao === 'Ativa' ? [] : ['A área "' + area.nome + '" está inativa: não entra em operação nova. Reative a área antes, se precisar.'];
}
// C3: area corrigida -> as partes da safra Aberta acompanham, mantendo a proporcao de cada parte. A ultima parte fica com
// o resto (4 casas) para a soma bater EXATAMENTE com a area nova. Devolve [{id_cultivo, hectares, proporcao}].
export function recalcularPartes(partes, haAntigo, haNovo) {
  const ord = partes.slice().sort((a, b) => a.ordem - b.ordem);
  const r4 = (x) => Math.round(x * 10000) / 10000;
  const temProp = ord.every((p) => Number(p.proporcao) > 0);
  let soma = 0;
  return ord.map((p, i) => {
    const prop = temProp ? Number(p.proporcao) : Number(p.hectares) / haAntigo * 100;
    const ha = i === ord.length - 1 ? r4(haNovo - soma) : r4(haNovo * prop / 100);
    soma += ha;
    return { id_cultivo: p.id_cultivo, hectares: ha, proporcao: temProp ? Number(p.proporcao) : r4(prop) };
  });
}
const CAMPOS_AREA = ['fazenda', 'nome', 'hectares', 'situacao', 'observacoes'];
const fmtHa = (n) => String(n).replace('.', ',') + ' ha';
// Confere os campos que vieram (novo = todos obrigatorios). Devolve a lista de erros.
function conferirCamposArea(d, novo, ler, idProprio) {
  const e = [];
  const tem = (k) => Object.prototype.hasOwnProperty.call(d, k);
  for (const k of ['fazenda', 'nome', 'observacoes']) if (tem(k) && d[k] !== null && typeof d[k] !== 'string') e.push(k + ' deve ser texto');
  if (novo || tem('fazenda')) { if (!texto(d.fazenda)) e.push('falta a fazenda'); else if (texto(d.fazenda).length > 80) e.push('fazenda passa de 80 letras'); }
  if (novo || tem('nome')) {
    const nome = texto(d.nome);
    if (!nome) e.push('falta o nome da área');
    else if (nome.length > 80) e.push('nome da área passa de 80 letras');
    else {
      const igual = ler('areas', {}).find((a) => a.id_area !== idProprio && chaveNome(a.nome) === chaveNome(nome));
      if (igual) e.push('Já existe uma área chamada "' + igual.nome + '" (fazenda ' + igual.fazenda + (igual.situacao === 'Ativa' ? '' : ', inativa') + '). Use um nome diferente.');
    }
  }
  if (novo || tem('hectares')) { if (typeof d.hectares !== 'number' || !Number.isFinite(d.hectares) || d.hectares <= 0) e.push('hectares deve ser um número maior que zero'); else if (d.hectares > 1000000) e.push('hectares grande demais'); }
  if (tem('situacao') || novo) { const s = d.situacao === undefined || d.situacao === null ? (novo ? 'Ativa' : null) : d.situacao; if (!['Ativa', 'Inativa'].includes(s)) e.push('situação deve ser Ativa ou Inativa'); }
  if (tem('observacoes') && typeof d.observacoes === 'string' && d.observacoes.length > 2000) e.push('observações passa de 2000 letras');
  return e;
}
const resumoArea = (a) => a.fazenda + ' / ' + a.nome + ' / ' + fmtHa(a.hectares) + ' / ' + a.situacao + (a.observacoes ? ' / obs.: ' + a.observacoes : '');

// ---------- Registro de comandos: tipo -> definicao ----------
const texto = (v) => (typeof v === 'string' ? v.trim() : '');

export const COMANDOS = {
  // Exemplo simples (prova o mecanismo): troca o texto de Observacoes de uma ficha. Nao mexe em estoque nem em numero.
  ajustar_observacao_ficha: {
    entidade: 'Aplicacao',
    validar(d, ler) {
      const e = [];
      if (!texto(d.id_aplicacao)) e.push('falta a ficha (id_aplicacao)');
      else if (!ler('aplicacoes', { id_aplicacao: d.id_aplicacao }).length) e.push('ficha não encontrada: ' + d.id_aplicacao);
      if (d.observacoes !== null && typeof d.observacoes !== 'string') e.push('observações deve ser texto');
      else if (typeof d.observacoes === 'string' && d.observacoes.length > 2000) e.push('observações passa de 2000 letras');
      return e;
    },
    planejar(d, ler, ctx) {
      const ficha = ler('aplicacoes', { id_aplicacao: d.id_aplicacao })[0];
      const novo = texto(d.observacoes) || null;
      return {
        operacoes: [{ op: 'atualizar', tabela: 'aplicacoes', chave: { id_aplicacao: d.id_aplicacao }, set: { observacoes: novo, atualizado_em: ctx.agora } }],
        idRegistro: d.id_aplicacao,
        antes: 'observacoes=' + (ficha.observacoes === null ? 'vazio' : ficha.observacoes),
        depois: 'observacoes=' + (novo === null ? 'vazio' : novo),
        motivo: d.motivo ? String(d.motivo) : 'Ajuste de observação da ficha ' + ficha.numero
      };
    }
  },

  // Fase A1: nova area. dados {fazenda, nome, hectares, situacao?='Ativa', observacoes?}. ID AreNN (R9).
  cadastrar_area: {
    entidade: 'Area',
    validar(d, ler) { return conferirCamposArea(d, true, ler, null); },
    planejar(d, ler, ctx) {
      const v = { id_area: proximoIdArea(ler('areas', {}).map((a) => a.id_area)), fazenda: texto(d.fazenda), nome: texto(d.nome), hectares: d.hectares,
        situacao: d.situacao || 'Ativa', observacoes: texto(d.observacoes) || null, criado_em: ctx.agora, atualizado_em: ctx.agora };
      return { operacoes: [{ op: 'inserir', tabela: 'areas', valores: v }], idRegistro: v.id_area, antes: null, depois: resumoArea(v), motivo: d.motivo ? String(d.motivo) : 'Cadastro de área' };
    }
  },

  // Fase A1: editar/inativar/reativar area. dados {id_area, + so os campos que mudam: fazenda, nome, hectares, situacao, observacoes; motivo}.
  // Nunca apaga (R5). Hectares: exige motivo; se a area tem safra Aberta, recalcula as partes dela (C3), na mesma transacao,
  // e a conferencia de soma roda antes do COMMIT. Fichas ja emitidas guardam os hectares delas (snapshot) e nao mudam.
  // Inativar com safra Aberta e recusado (encerre a safra antes).
  editar_area: {
    entidade: 'Area',
    validar(d, ler) {
      if (!texto(d.id_area)) return ['falta a área (id_area)'];
      const a = ler('areas', { id_area: d.id_area })[0];
      if (!a) return ['área não encontrada: ' + d.id_area];
      const e = conferirCamposArea(d, false, ler, a.id_area);
      if (e.length) return e;
      const muda = CAMPOS_AREA.filter((k) => Object.prototype.hasOwnProperty.call(d, k) && (k === 'hectares' ? d.hectares !== a.hectares : (texto(d[k]) || null) !== (a[k] === null ? null : String(a[k]).trim() || null)));
      if (!muda.length) return ['Nada mudou: não há o que gravar.'];
      const abertas = ler('safras', { id_area: a.id_area, situacao: 'Aberta' });
      if (muda.includes('hectares') && !texto(d.motivo)) e.push('Diga o motivo da correção dos hectares (fica na auditoria).');
      if (muda.includes('situacao') && d.situacao === 'Inativa' && abertas.length) e.push('A área "' + a.nome + '" tem a safra ' + abertas.map((s) => s.safra).join(', ') + ' aberta: encerre a safra antes de inativar a área.');
      return e;
    },
    planejar(d, ler, ctx) {
      const a = ler('areas', { id_area: d.id_area })[0];
      const set = {}, novo = Object.assign({}, a);
      for (const k of CAMPOS_AREA) {
        if (!Object.prototype.hasOwnProperty.call(d, k)) continue;
        const v = k === 'hectares' ? d.hectares : (texto(d[k]) || null);
        if (v !== a[k]) { set[k] = v; novo[k] = v; }
      }
      set.atualizado_em = ctx.agora;
      const ops = [{ op: 'atualizar', tabela: 'areas', chave: { id_area: a.id_area }, set }];
      const safras = [], notas = [];
      if (set.hectares !== undefined) {
        for (const s of ler('safras', { id_area: a.id_area, situacao: 'Aberta' })) {
          const partes = ler('safra_cultivos', { id_safra: s.id_safra });
          if (!partes.length) continue;
          for (const p of recalcularPartes(partes, a.hectares, set.hectares)) ops.push({ op: 'atualizar', tabela: 'safra_cultivos', chave: { id_cultivo: p.id_cultivo }, set: { hectares: p.hectares, proporcao: p.proporcao } });
          ops.push({ op: 'atualizar', tabela: 'safras', chave: { id_safra: s.id_safra }, set: { atualizado_em: ctx.agora } });
          safras.push(s.id_safra); notas.push('partes da safra ' + s.safra + ' recalculadas (' + partes.length + ')');
        }
      }
      const acao = set.situacao === 'Inativa' ? 'Inativação' : set.situacao === 'Ativa' ? 'Reativação' : set.hectares !== undefined ? 'Correção de hectares' : 'Edição';
      return {
        operacoes: ops, idRegistro: a.id_area, antes: resumoArea(a), depois: resumoArea(novo) + (notas.length ? ' | ' + notas.join('; ') : ''),
        motivo: acao + ' de área' + (texto(d.motivo) ? ': ' + texto(d.motivo) : ''),
        conferir: safras.length ? ['safra'] : undefined, safras
      };
    }
  }
};
// Para testes e para fases futuras: registrar um tipo novo sem editar este arquivo
export function registrarComando(tipo, def) { COMANDOS[tipo] = def; }
