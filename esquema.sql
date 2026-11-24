-- Gerado de esquema/colunas.csv. Nao editar. PRAGMA foreign_keys=ON ao abrir a conexao.

CREATE TABLE areas ( -- Cadastro mestre de areas (talhoes). Hectares novos nao alteram snapshots
  id_area TEXT NOT NULL PRIMARY KEY,
  fazenda TEXT NOT NULL,
  nome TEXT NOT NULL UNIQUE COLLATE NOCASE,
  hectares REAL NOT NULL CHECK (hectares > 0),
  cultivar TEXT,
  situacao TEXT NOT NULL CHECK (situacao IN ('Ativa','Inativa')),
  observacoes TEXT,
  criado_em TEXT NOT NULL,
  atualizado_em TEXT NOT NULL
) STRICT;

CREATE TABLE produtos ( -- Cadastro mestre de produtos e saldo inicial. Saldo, Grupo e Principios sao derivados
  id_produto TEXT NOT NULL PRIMARY KEY,
  nome TEXT NOT NULL UNIQUE COLLATE NOCASE,
  tipo TEXT NOT NULL CHECK (tipo IN ('Insumo','Semente')),
  grupo TEXT,
  principios_ativos TEXT,
  unidade_base TEXT NOT NULL,
  saldo_inicial REAL NOT NULL CHECK (saldo_inicial >= 0),
  estoque_minimo REAL CHECK (estoque_minimo >= 0),
  situacao TEXT NOT NULL CHECK (situacao IN ('Ativo','Inativo')),
  observacoes TEXT,
  saldo_atual REAL NOT NULL,
  criado_em TEXT NOT NULL,
  atualizado_em TEXT NOT NULL
) STRICT;

CREATE TABLE safras ( -- Safra por area (ciclo AAAA-N). Uma Aberta por area. A area nao guarda safra: a relacao fica so aqui
  id_safra TEXT NOT NULL PRIMARY KEY,
  id_area TEXT NOT NULL,
  ano INTEGER NOT NULL,
  numero INTEGER NOT NULL,
  safra TEXT NOT NULL CHECK (safra GLOB '[0-9][0-9][0-9][0-9]-[0-9]*'),
  cultivar TEXT NOT NULL,
  situacao TEXT NOT NULL CHECK (situacao IN ('Aberta','Encerrada')),
  criado_em TEXT,
  atualizado_em TEXT,
  FOREIGN KEY (id_area) REFERENCES areas(id_area) DEFERRABLE INITIALLY DEFERRED
) STRICT;

CREATE TABLE grupos ( -- Grupos de produto (lista para selecao)
  id_grupo TEXT NOT NULL PRIMARY KEY,
  nome TEXT NOT NULL UNIQUE COLLATE NOCASE,
  criado_em TEXT
) STRICT;

CREATE TABLE principios_ativos ( -- Principios ativos (lista para selecao)
  id_principio TEXT NOT NULL PRIMARY KEY,
  nome TEXT NOT NULL UNIQUE COLLATE NOCASE,
  criado_em TEXT
) STRICT;

CREATE TABLE produto_grupos ( -- Produto x grupo (N:N). Chave = par
  id_produto TEXT NOT NULL,
  id_grupo TEXT NOT NULL,
  PRIMARY KEY (id_produto, id_grupo),
  FOREIGN KEY (id_produto) REFERENCES produtos(id_produto) DEFERRABLE INITIALLY DEFERRED,
  FOREIGN KEY (id_grupo) REFERENCES grupos(id_grupo) DEFERRABLE INITIALLY DEFERRED
) STRICT;

CREATE TABLE produto_principios ( -- Produto x principio ativo (N:N). Chave = par
  id_produto TEXT NOT NULL,
  id_principio TEXT NOT NULL,
  PRIMARY KEY (id_produto, id_principio),
  FOREIGN KEY (id_produto) REFERENCES produtos(id_produto) DEFERRABLE INITIALLY DEFERRED,
  FOREIGN KEY (id_principio) REFERENCES principios_ativos(id_principio) DEFERRABLE INITIALLY DEFERRED
) STRICT;

CREATE TABLE medidas ( -- Medidas (estoque e dose) e conversoes. Itens iniciais vem no modelo
  id_medida TEXT NOT NULL PRIMARY KEY,
  sigla TEXT NOT NULL UNIQUE,
  nome TEXT NOT NULL,
  tipo TEXT NOT NULL CHECK (tipo IN ('Quantidade','Dose')),
  grandeza TEXT NOT NULL CHECK (grandeza IN ('Massa','Volume','Sementes','Unidade')),
  fator REAL NOT NULL CHECK (fator > 0),
  por TEXT CHECK (por IN ('ha','kg de semente','sementes')),
  quantidade_por REAL CHECK (quantidade_por > 0),
  apelidos TEXT,
  situacao TEXT NOT NULL CHECK (situacao IN ('Ativa','Inativa')),
  observacoes TEXT,
  criado_em TEXT NOT NULL
) STRICT;

CREATE TABLE cultivares ( -- Catalogo de cultivares (Soja, Milho...). Itens iniciais vem no modelo. Era tbCulturas
  id_cultivar TEXT NOT NULL PRIMARY KEY,
  cultivar TEXT NOT NULL UNIQUE COLLATE NOCASE,
  situacao TEXT NOT NULL CHECK (situacao IN ('Ativa','Inativa')),
  criado_em TEXT NOT NULL
) STRICT;

CREATE TABLE codigos ( -- Catalogo de codigos de fabricante (ex.: XB970), cada um ligado a um cultivar. Era tbCultivares
  id_codigo TEXT NOT NULL PRIMARY KEY,
  id_cultivar TEXT NOT NULL,
  codigo TEXT NOT NULL,
  observacoes TEXT,
  situacao TEXT NOT NULL CHECK (situacao IN ('Ativa','Inativa')),
  criado_em TEXT NOT NULL,
  FOREIGN KEY (id_cultivar) REFERENCES cultivares(id_cultivar) DEFERRABLE INITIALLY DEFERRED
) STRICT;

CREATE TABLE sementes ( -- Dados do lote de cada produto Tipo Semente (1:1 com tbProdutos)
  id_semente TEXT NOT NULL PRIMARY KEY,
  id_produto TEXT NOT NULL,
  id_codigo TEXT,
  cultivar TEXT NOT NULL,
  codigo TEXT,
  lote TEXT,
  germinacao REAL CHECK (germinacao > 0),
  vigor REAL CHECK (vigor > 0),
  pms REAL CHECK (pms > 0),
  peneira TEXT,
  origem_tratamento TEXT NOT NULL CHECK (origem_tratamento IN ('Sem tratamento','Industrial','On farm')),
  id_semente_base TEXT,
  situacao_tratamento TEXT NOT NULL CHECK (situacao_tratamento IN ('Rascunho','Aceito')),
  observacoes TEXT,
  criado_em TEXT NOT NULL,
  atualizado_em TEXT NOT NULL,
  FOREIGN KEY (id_produto) REFERENCES produtos(id_produto) DEFERRABLE INITIALLY DEFERRED,
  FOREIGN KEY (id_codigo) REFERENCES codigos(id_codigo) DEFERRABLE INITIALLY DEFERRED,
  FOREIGN KEY (id_semente_base) REFERENCES produtos(id_produto) DEFERRABLE INITIALLY DEFERRED
) STRICT;

CREATE TABLE tratamento_itens ( -- Receita do tratamento: semente x componente com dose. Chave = par
  id_semente TEXT NOT NULL,
  id_componente TEXT NOT NULL,
  dose REAL NOT NULL CHECK (dose > 0),
  unidade_dose TEXT NOT NULL,
  ordem INTEGER NOT NULL,
  PRIMARY KEY (id_semente, id_componente),
  FOREIGN KEY (id_semente) REFERENCES produtos(id_produto) DEFERRABLE INITIALLY DEFERRED,
  FOREIGN KEY (id_componente) REFERENCES produtos(id_produto) DEFERRABLE INITIALLY DEFERRED
) STRICT;

CREATE TABLE safra_cultivos ( -- Partes da area na safra: cultivar, variedade (semente), hectares, dose. tbSafras.Cultivar deriva daqui
  id_cultivo TEXT NOT NULL PRIMARY KEY,
  id_safra TEXT NOT NULL,
  ordem INTEGER NOT NULL,
  cultivar TEXT NOT NULL,
  id_codigo TEXT,
  id_produto TEXT,
  proporcao REAL CHECK (proporcao > 0),
  hectares REAL NOT NULL CHECK (hectares > 0),
  dose REAL CHECK (dose > 0),
  unidade_dose TEXT,
  observacoes TEXT,
  criado_em TEXT NOT NULL,
  FOREIGN KEY (id_safra) REFERENCES safras(id_safra) DEFERRABLE INITIALLY DEFERRED,
  FOREIGN KEY (id_codigo) REFERENCES codigos(id_codigo) DEFERRABLE INITIALLY DEFERRED,
  FOREIGN KEY (id_produto) REFERENCES produtos(id_produto) DEFERRABLE INITIALLY DEFERRED
) STRICT;

CREATE TABLE aplicacoes ( -- Cabecalho da recomendacao. Numero visivel 1,2,3
  id_aplicacao TEXT NOT NULL PRIMARY KEY,
  numero INTEGER NOT NULL UNIQUE,
  fazenda TEXT NOT NULL,
  produtor TEXT,
  safra TEXT NOT NULL CHECK (safra GLOB '[0-9][0-9][0-9][0-9]-[0-9]*'),
  data_emissao TEXT NOT NULL,
  data_prevista TEXT,
  data_efetiva TEXT,
  cultivar TEXT NOT NULL,
  estagio_cultura TEXT,
  alvo TEXT,
  responsavel_tecnico TEXT,
  observacoes TEXT,
  situacao TEXT NOT NULL CHECK (situacao IN ('Recomendada','Parcialmente executada','Executada','Cancelada')),
  area_total_ha REAL NOT NULL CHECK (area_total_ha > 0),
  caminho_pdf TEXT,
  pdf_em TEXT,
  pdf_versao INTEGER,
  criado_por TEXT NOT NULL,
  criado_em TEXT NOT NULL,
  atualizado_em TEXT NOT NULL,
  email_envio TEXT,
  status_envio TEXT
) STRICT;

CREATE TABLE aplicacao_areas ( -- Area da ficha como estava no dia da emissao
  id_aplicacao_area TEXT NOT NULL PRIMARY KEY,
  id_aplicacao TEXT NOT NULL,
  id_area TEXT NOT NULL,
  fazenda TEXT NOT NULL,
  area_nome TEXT NOT NULL,
  safra TEXT NOT NULL CHECK (safra GLOB '[0-9][0-9][0-9][0-9]-[0-9]*'),
  cultivar TEXT NOT NULL,
  id_cultivo TEXT,
  parte TEXT,
  hectares REAL NOT NULL CHECK (hectares > 0),
  ordem INTEGER NOT NULL,
  observacoes TEXT,
  FOREIGN KEY (id_aplicacao) REFERENCES aplicacoes(id_aplicacao) DEFERRABLE INITIALLY DEFERRED,
  FOREIGN KEY (id_area) REFERENCES areas(id_area) DEFERRABLE INITIALLY DEFERRED,
  FOREIGN KEY (id_cultivo) REFERENCES safra_cultivos(id_cultivo) DEFERRABLE INITIALLY DEFERRED
) STRICT;

CREATE TABLE aplicacao_itens ( -- Produto e dose da ficha
  id_item TEXT NOT NULL PRIMARY KEY,
  id_aplicacao TEXT NOT NULL,
  id_produto TEXT NOT NULL,
  produto_nome TEXT NOT NULL,
  grupo TEXT,
  dose REAL NOT NULL CHECK (dose > 0),
  unidade_dose TEXT NOT NULL,
  area_ref_ha REAL NOT NULL CHECK (area_ref_ha > 0),
  quantidade REAL NOT NULL CHECK (quantidade > 0),
  unidade_quantidade TEXT NOT NULL,
  alvo_especifico TEXT,
  observacoes TEXT,
  conferencia TEXT,
  quantidade_efetiva REAL,
  status_item TEXT,
  escopo_area TEXT,
  FOREIGN KEY (id_aplicacao) REFERENCES aplicacoes(id_aplicacao) DEFERRABLE INITIALLY DEFERRED,
  FOREIGN KEY (id_produto) REFERENCES produtos(id_produto) DEFERRABLE INITIALLY DEFERRED
) STRICT;

CREATE TABLE aplicacao_saidas ( -- Uma saida por produto x area. Codigo NNNN-SNN impresso no PDF
  id_saida TEXT NOT NULL PRIMARY KEY,
  id_aplicacao TEXT NOT NULL,
  numero INTEGER NOT NULL,
  codigo TEXT NOT NULL UNIQUE,
  id_item TEXT NOT NULL,
  id_area TEXT NOT NULL,
  fazenda TEXT NOT NULL,
  area_nome TEXT NOT NULL,
  id_produto TEXT NOT NULL,
  produto_nome TEXT NOT NULL,
  grupo TEXT,
  dose REAL NOT NULL CHECK (dose > 0),
  unidade_dose TEXT NOT NULL,
  hectares REAL NOT NULL CHECK (hectares > 0),
  quantidade REAL NOT NULL CHECK (quantidade > 0),
  unidade_quantidade TEXT NOT NULL,
  ordem INTEGER NOT NULL,
  observacoes TEXT,
  situacao TEXT NOT NULL CHECK (situacao IN ('Recomendada','Parcialmente executada','Executada','Cancelada')),
  criado_em TEXT NOT NULL,
  FOREIGN KEY (id_aplicacao) REFERENCES aplicacoes(id_aplicacao) DEFERRABLE INITIALLY DEFERRED,
  FOREIGN KEY (id_item) REFERENCES aplicacao_itens(id_item) DEFERRABLE INITIALLY DEFERRED,
  FOREIGN KEY (id_area) REFERENCES areas(id_area) DEFERRABLE INITIALLY DEFERRED,
  FOREIGN KEY (id_produto) REFERENCES produtos(id_produto) DEFERRABLE INITIALLY DEFERRED
) STRICT;

CREATE TABLE execucao_itens ( -- Etapas de execucao confirmadas (baixam estoque)
  id_execucao TEXT NOT NULL PRIMARY KEY,
  id_etapa TEXT NOT NULL,
  id_aplicacao TEXT NOT NULL,
  numero INTEGER NOT NULL,
  id_area TEXT NOT NULL,
  area_nome TEXT NOT NULL,
  id_item TEXT NOT NULL,
  id_produto TEXT NOT NULL,
  produto_nome TEXT NOT NULL,
  dose REAL NOT NULL,
  unidade_dose TEXT NOT NULL,
  hectares_previstos REAL NOT NULL CHECK (hectares_previstos > 0),
  hectares_tratados REAL NOT NULL CHECK (hectares_tratados > 0),
  quantidade_recomendada REAL NOT NULL,
  quantidade_efetiva REAL NOT NULL CHECK (quantidade_efetiva > 0),
  unidade_quantidade TEXT NOT NULL,
  data_efetiva TEXT NOT NULL,
  responsavel TEXT NOT NULL,
  conferencia TEXT,
  observacoes TEXT,
  situacao TEXT NOT NULL CHECK (situacao IN ('Pendente','Confirmada')),
  id_movimentacao TEXT NOT NULL,
  confirmado_em TEXT NOT NULL,
  FOREIGN KEY (id_aplicacao) REFERENCES aplicacoes(id_aplicacao) DEFERRABLE INITIALLY DEFERRED,
  FOREIGN KEY (id_area) REFERENCES areas(id_area) DEFERRABLE INITIALLY DEFERRED,
  FOREIGN KEY (id_item) REFERENCES aplicacao_itens(id_item) DEFERRABLE INITIALLY DEFERRED,
  FOREIGN KEY (id_produto) REFERENCES produtos(id_produto) DEFERRABLE INITIALLY DEFERRED,
  FOREIGN KEY (id_movimentacao) REFERENCES mov_estoque(id_movimentacao) DEFERRABLE INITIALLY DEFERRED
) STRICT;

CREATE TABLE tratamentos ( -- Tratamento de semente on farm feito: baixa base e componentes, entra a tratada
  id_tratamento TEXT NOT NULL PRIMARY KEY,
  data TEXT NOT NULL,
  id_semente_tratada TEXT NOT NULL,
  id_semente_base TEXT NOT NULL,
  quantidade REAL NOT NULL CHECK (quantidade > 0),
  unidade TEXT NOT NULL,
  responsavel TEXT NOT NULL,
  situacao TEXT NOT NULL CHECK (situacao IN ('Confirmado','Estornado')),
  motivo_estorno TEXT,
  criado_em TEXT NOT NULL,
  atualizado_em TEXT,
  FOREIGN KEY (id_semente_tratada) REFERENCES produtos(id_produto) DEFERRABLE INITIALLY DEFERRED,
  FOREIGN KEY (id_semente_base) REFERENCES produtos(id_produto) DEFERRABLE INITIALLY DEFERRED
) STRICT;

CREATE TABLE mov_estoque ( -- Razao do estoque. Nunca apagar: estorno cria movimento inverso
  id_movimentacao TEXT NOT NULL PRIMARY KEY,
  data TEXT NOT NULL,
  id_produto TEXT NOT NULL,
  produto_nome TEXT NOT NULL,
  quantidade REAL NOT NULL CHECK (quantidade > 0),
  unidade_base TEXT NOT NULL,
  tipo TEXT NOT NULL CHECK (tipo IN ('Entrada','Ajuste positivo','Ajuste negativo','Saida por aplicacao','Estorno ou reversao','Saida por tratamento','Entrada por tratamento')),
  documento TEXT,
  id_aplicacao TEXT,
  id_area TEXT,
  id_execucao TEXT,
  id_movimentacao_revertida TEXT,
  id_tratamento TEXT,
  responsavel TEXT NOT NULL,
  observacoes TEXT,
  quantidade_assinada REAL NOT NULL,
  situacao TEXT NOT NULL CHECK (situacao IN ('Pendente','Confirmada')),
  autoriza_negativo TEXT,
  motivo_autorizacao TEXT,
  criado_em TEXT NOT NULL,
  FOREIGN KEY (id_produto) REFERENCES produtos(id_produto) DEFERRABLE INITIALLY DEFERRED,
  FOREIGN KEY (id_aplicacao) REFERENCES aplicacoes(id_aplicacao) DEFERRABLE INITIALLY DEFERRED,
  FOREIGN KEY (id_area) REFERENCES areas(id_area) DEFERRABLE INITIALLY DEFERRED,
  FOREIGN KEY (id_execucao) REFERENCES execucao_itens(id_execucao) DEFERRABLE INITIALLY DEFERRED,
  FOREIGN KEY (id_movimentacao_revertida) REFERENCES mov_estoque(id_movimentacao) DEFERRABLE INITIALLY DEFERRED,
  FOREIGN KEY (id_tratamento) REFERENCES tratamentos(id_tratamento) DEFERRABLE INITIALLY DEFERRED
) STRICT;

CREATE TABLE historico_aplicacoes ( -- Consolidacao aplicacao x area x produto. Recriavel a partir da execucao
  id_historico TEXT NOT NULL PRIMARY KEY,
  id_aplicacao TEXT NOT NULL,
  numero INTEGER NOT NULL,
  fazenda TEXT NOT NULL,
  safra TEXT NOT NULL CHECK (safra GLOB '[0-9][0-9][0-9][0-9]-[0-9]*'),
  cultivar TEXT NOT NULL,
  id_area TEXT NOT NULL,
  area_nome TEXT NOT NULL,
  id_cultivo TEXT,
  parte TEXT,
  hectares_previstos REAL NOT NULL,
  hectares_tratados REAL NOT NULL,
  id_produto TEXT NOT NULL,
  produto_nome TEXT NOT NULL,
  tipo_produto TEXT CHECK (tipo_produto IN ('Insumo','Semente')),
  grupo TEXT,
  dose REAL NOT NULL,
  unidade_dose TEXT NOT NULL,
  quantidade_recomendada REAL NOT NULL,
  quantidade_efetiva REAL NOT NULL,
  unidade_quantidade TEXT NOT NULL,
  data_recomendacao TEXT NOT NULL,
  data_efetiva TEXT NOT NULL,
  mes TEXT,
  alvo TEXT,
  observacoes TEXT,
  conferencia TEXT,
  responsavel TEXT NOT NULL,
  situacao TEXT NOT NULL CHECK (situacao IN ('Parcialmente executada','Executada')),
  id_execucao_origem TEXT NOT NULL,
  FOREIGN KEY (id_aplicacao) REFERENCES aplicacoes(id_aplicacao) DEFERRABLE INITIALLY DEFERRED,
  FOREIGN KEY (id_area) REFERENCES areas(id_area) DEFERRABLE INITIALLY DEFERRED,
  FOREIGN KEY (id_cultivo) REFERENCES safra_cultivos(id_cultivo) DEFERRABLE INITIALLY DEFERRED,
  FOREIGN KEY (id_produto) REFERENCES produtos(id_produto) DEFERRABLE INITIALLY DEFERRED,
  FOREIGN KEY (id_execucao_origem) REFERENCES execucao_itens(id_execucao) DEFERRABLE INITIALLY DEFERRED
) STRICT;

CREATE TABLE auditoria ( -- Registro de eventos e erros. Somente inclusao
  id_evento TEXT NOT NULL PRIMARY KEY,
  quando TEXT NOT NULL,
  usuario TEXT NOT NULL,
  operacao TEXT NOT NULL,
  entidade TEXT NOT NULL,
  id_registro TEXT,
  antes TEXT,
  depois TEXT,
  motivo TEXT,
  resultado TEXT NOT NULL
) STRICT;

CREATE TABLE dose_excecoes ( -- Dose excepcional por area. Nunca usada (uma area por ficha)
  id_excecao TEXT NOT NULL PRIMARY KEY,
  id_aplicacao TEXT NOT NULL,
  id_item TEXT NOT NULL,
  id_area TEXT NOT NULL,
  dose REAL NOT NULL,
  unidade_dose TEXT NOT NULL,
  motivo TEXT NOT NULL,
  criado_por TEXT NOT NULL,
  criado_em TEXT NOT NULL,
  FOREIGN KEY (id_aplicacao) REFERENCES aplicacoes(id_aplicacao) DEFERRABLE INITIALLY DEFERRED,
  FOREIGN KEY (id_item) REFERENCES aplicacao_itens(id_item) DEFERRABLE INITIALLY DEFERRED,
  FOREIGN KEY (id_area) REFERENCES areas(id_area) DEFERRABLE INITIALLY DEFERRED
) STRICT;

CREATE TABLE glossario ( -- Glossario: termos, explicacoes e onde aparecem como dica. Itens iniciais de esquema/glossario.csv
  id_termo TEXT NOT NULL PRIMARY KEY,
  termo TEXT NOT NULL UNIQUE,
  explicacao TEXT NOT NULL,
  onde TEXT,
  criado_em TEXT NOT NULL
) STRICT;

CREATE UNIQUE INDEX uq_safra_aberta_por_area ON safras(id_area) WHERE situacao = 'Aberta';
CREATE UNIQUE INDEX uq_safra_rotulo_por_area ON safras(id_area, safra);
