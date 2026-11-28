// Telas de cadastro da Fase A (roteiro: um arquivo por fase). A1 = Áreas. Usa SO o padrão de tela.js (D-059):
// lista com busca -> Nova/Editar no formulário -> "Confira antes de gravar" -> Tela.gravar (comandos cadastrar_area /
// editar_area de regras.js) -> mensagem final. Nada é apagado: inativar troca a situação (R5, R12). Dado do usuário aparece
// exatamente como foi gravado (D-060); nomes na tela, nunca IDs (R2).
(function (raiz) {
  'use strict';
  const Tela = raiz.Tela;
  const chamar = (acao, dados) => raiz.appFazenda.chamar(acao, dados);
  async function lerTudo(tabela) {
    const r = await chamar('ler', { tabela, limite: 100000 });
    return r.linhas.map((l) => Object.fromEntries(r.colunas.map((c, i) => [c, l[i]])));
  }
  const chave = (t) => Tela.semAcento(t).replace(/\s+/g, ''); // mesma comparação de regras.js (chaveNome)
  const ha = (n) => String(n).replace('.', ',') + ' ha';
  const $ = (id) => document.getElementById(id);

  let areas = [], abertas = {}; // abertas: id_area -> [safras Abertas]
  async function carregarAreas() {
    const alvo = $('telaAreas');
    if (!alvo || !raiz.appFazenda) return;
    alvo.innerHTML = '';
    try { areas = await lerTudo('areas'); const sf = await lerTudo('safras'); abertas = {}; sf.filter((s) => s.situacao === 'Aberta').forEach((s) => { (abertas[s.id_area] = abertas[s.id_area] || []).push(s); }); }
    catch (e) {
      const semBanco = /Tabela desconhecida|banco|worker/i.test(String(e && e.message));
      const p = Tela.el('p', semBanco ? 'Abra, crie ou importe um banco primeiro.' : 'Não consegui ler as áreas: ' + Tela.erroSimples(e), 'sub');
      alvo.appendChild(p); return;
    }
    const nova = Tela.el('button', '+ Nova área'); nova.type = 'button'; nova.onclick = () => formulario(null);
    const lista = Tela.el('div');
    alvo.appendChild(nova); alvo.appendChild(lista);
    const itens = areas.slice().sort((a, b) => (a.situacao === b.situacao ? 0 : a.situacao === 'Ativa' ? -1 : 1) || String(a.nome).localeCompare(String(b.nome), 'pt-BR', { numeric: true }))
      .map((a) => ({ area: a, titulo: a.nome, detalhe: a.fazenda + ' | ' + ha(a.hectares) + ' | ' + a.situacao + ((abertas[a.id_area] || []).length ? ' | safra ' + abertas[a.id_area].map((s) => s.safra).join(', ') + ' aberta' : '') }));
    Tela.lista({ alvo: lista, itens, rotuloBusca: 'Buscar área por nome, fazenda...', vazio: 'Nenhuma área cadastrada ainda. Toque em "+ Nova área".', aoEscolher: (it) => formulario(it.area) });
  }

  function fazendaMaisUsada() {
    const n = {}; areas.forEach((a) => { n[a.fazenda] = (n[a.fazenda] || 0) + 1; });
    return Object.keys(n).sort((x, y) => n[y] - n[x])[0] || '';
  }

  // a = área existente (editar) ou null (nova)
  function formulario(a) {
    const alvo = $('telaAreas');
    const sAbertas = a ? (abertas[a.id_area] || []) : [];
    const campos = [
      { nome: 'nome', rotulo: 'Nome da área', tipo: 'texto', obrigatorio: true, max: 80, ajuda: 'Único: não pode repetir outro nome, nem com outra maiúscula, acento ou espaço.' },
      { nome: 'fazenda', rotulo: 'Fazenda', tipo: 'texto', obrigatorio: true, max: 80 },
      { nome: 'hectares', rotulo: 'Hectares', tipo: 'numero', obrigatorio: true, ajuda: 'Ex.: 12,5' + (sAbertas.length ? '. Esta área tem safra aberta: se mudar, as partes da safra são recalculadas na mesma proporção.' : '') },
      { nome: 'observacoes', rotulo: 'Observações', tipo: 'texto longo', max: 2000 }
    ];
    if (a) {
      campos.splice(3, 0, { nome: 'situacao', rotulo: 'Situação', tipo: 'lista', obrigatorio: true, opcoes: [{ valor: 'Ativa', rotulo: 'Ativa' }, { valor: 'Inativa', rotulo: 'Inativa (sai das operações novas; nada é apagado)' }] });
      campos.push({ nome: 'motivo', rotulo: 'Motivo da mudança', tipo: 'texto', max: 200, ajuda: 'Obrigatório se mudar os hectares. Fica na auditoria.' });
    }
    const inicial = a ? { nome: a.nome, fazenda: a.fazenda, hectares: a.hectares, situacao: a.situacao, observacoes: a.observacoes || '', motivo: '' } : { fazenda: fazendaMaisUsada() };
    const mudou = (v, k) => (k === 'hectares' ? v.hectares !== a.hectares : (v[k] || null) !== (a[k] === null || a[k] === undefined || a[k] === '' ? null : a[k]));
    Tela.formulario({
      alvo, titulo: a ? 'Editar a área ' + a.nome : 'Nova área', campos, valores: inicial,
      validar(v) {
        const e = [];
        if (v.hectares !== null && !(v.hectares > 0)) e.push('Hectares precisa ser maior que zero.');
        if (v.nome) { const igual = areas.find((x) => (!a || x.id_area !== a.id_area) && chave(x.nome) === chave(v.nome)); if (igual) e.push('Já existe uma área chamada "' + igual.nome + '" (fazenda ' + igual.fazenda + '). Use um nome diferente.'); }
        if (a) {
          if (!['nome', 'fazenda', 'hectares', 'situacao', 'observacoes'].some((k) => mudou(v, k))) e.push('Nada mudou além do motivo: não há o que gravar.');
          if (mudou(v, 'hectares') && !v.motivo) e.push('Diga o motivo da correção dos hectares.');
          if (mudou(v, 'situacao') && v.situacao === 'Inativa' && sAbertas.length) e.push('Esta área tem a safra ' + sAbertas.map((s) => s.safra).join(', ') + ' aberta: encerre a safra antes de inativar.');
        }
        return e;
      },
      resumo(v, mudancas) {
        if (!a) return ['Nova área "' + v.nome + '"', 'Fazenda: "' + v.fazenda + '"', 'Hectares: ' + ha(v.hectares)].concat(v.observacoes ? ['Observações: "' + v.observacoes + '"'] : []);
        const rot = { nome: 'Nome', fazenda: 'Fazenda', hectares: 'Hectares', situacao: 'Situação', observacoes: 'Observações', motivo: 'Motivo' };
        const txt = (k, x) => (x === null || x === undefined || x === '' ? '(vazio)' : k === 'hectares' ? ha(x) : '"' + x + '"');
        const l = mudancas.filter((c) => c.nome !== 'motivo').map((c) => rot[c.nome] + ': ' + txt(c.nome, inicial[c.nome]) + ' → ' + txt(c.nome, v[c.nome]));
        if (v.motivo) l.push('Motivo: "' + v.motivo + '"');
        if (mudou(v, 'hectares') && sAbertas.length) l.push('A safra ' + sAbertas.map((s) => s.safra).join(', ') + ' está aberta: as partes serão recalculadas na mesma proporção, para somar ' + ha(v.hectares) + '. Fichas já emitidas não mudam.');
        if (mudou(v, 'situacao') && v.situacao === 'Inativa') l.push('A área não será apagada: só deixa de aparecer em safra, ficha e execução novas.');
        return l;
      },
      async gravar(v) {
        let dados;
        if (!a) dados = { fazenda: v.fazenda, nome: v.nome, hectares: v.hectares, observacoes: v.observacoes };
        else {
          dados = { id_area: a.id_area };
          ['nome', 'fazenda', 'hectares', 'situacao', 'observacoes'].forEach((k) => { if (mudou(v, k)) dados[k] = v[k]; });
          if (v.motivo) dados.motivo = v.motivo;
        }
        const r = await Tela.gravar([{ tipo: a ? 'editar_area' : 'cadastrar_area', dados }]);
        if (r.resultados[0].repetido) return 'Isto já estava gravado; nada mudou.';
        const fim = [a ? 'Gravado: área "' + v.nome + '" atualizada.' : 'Gravado: área "' + v.nome + '" cadastrada (' + v.fazenda + ', ' + ha(v.hectares) + ').'];
        if (a && mudou(v, 'situacao')) fim.push(v.situacao === 'Inativa' ? 'A área agora está Inativa (não foi apagada).' : 'A área voltou a ficar Ativa.');
        if (a && mudou(v, 'hectares') && sAbertas.length) fim.push('As partes da safra ' + sAbertas.map((s) => s.safra).join(', ') + ' foram recalculadas para ' + ha(v.hectares) + '.');
        fim.push('Fica registrado na auditoria.');
        return fim;
      },
      aoFechar: () => carregarAreas()
    });
  }

  raiz.TelaCadastros = { carregarAreas };
})(window);
