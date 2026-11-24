# Prototipo de viabilidade (celular + PC + Google Drive)
Objetivo: provar no SEU iPhone que da para (1) entrar com a conta Google, (2) gravar e ler um arquivo numa pasta do Google Drive, (3) ter um banco SQLite no aparelho e trocar esse banco com o PC pelo Drive. Nao e o app final; as telas sao so botoes de teste.

Estado: testado no navegador do PC (banco abre, grava e mantem os dados ao recarregar; modo offline). NAO testado: login Google, Drive, iPhone. Dependem dos passos abaixo.
Historia: a primeira tentativa foi com OneDrive/Microsoft, mas conta pessoal sem diretorio do Azure nao consegue registrar o app (D-044). Os arquivos da Microsoft estao em `_arquivo/microsoft_msal/`.

## Versao do app (0.0.1)
Aparece no topo da tela e no titulo da aba: "Versao 0.0.1 (tela | config | logica | offline)". Se algum dos quatro for diferente, aparece aviso vermelho: algum arquivo nao subiu ou o navegador usa copia antiga (suba todos, abra com Ctrl+F5). A cada mudanca o agente sobe o numero nos 4 arquivos (index.html, config.js, app.js, sw.js) e voce reenvia os arquivos alterados.

## Passo 1 - Hospedar so o codigo (GitHub Pages) - FEITO
Endereco: https://dnielmr.github.io/fazenda-app/ . Suba sempre SOMENTE o conteudo desta pasta. Nunca o resto do projeto (tem seus dados).
Depois desta troca, reenvie ao GitHub (Add file > Upload files, sobrescrevendo): `app.js`, `config.js`, `index.html`, `sw.js`. Na pasta `lib` do GitHub, o arquivo `msal-browser.min.js` pode ficar la, nao atrapalha.

## Passo 2 - Registrar o app no Google Cloud (gratuito, sem cartao)
Use a conta profissional (a sua). Se a empresa/Workspace bloquear, me avise.
1. Acesse https://console.cloud.google.com e entre. Aceite os termos se pedir.
2. Seletor de projeto (topo) > Novo projeto > nome `Gestao Agricola` > Criar. Selecione o projeto criado.
3. Menu > APIs e servicos > Biblioteca > pesquise "Google Drive API" > Ativar.
4. Menu > APIs e servicos > Tela de consentimento OAuth (ou "Google Auth Platform"):
   - Tipo de usuario / Publico: **Interno** (so contas da sua organizacao Workspace). Se so aparecer "Externo", escolha Externo, deixe em "Teste" e adicione seu e-mail como usuario de teste.
   - Nome do app `Gestao Agricola`; e-mail de suporte e de contato: o seu.
   - Escopos: adicione `.../auth/drive.file` (so os arquivos que o app cria).
5. Menu > APIs e servicos > Credenciais > Criar credenciais > **ID do cliente OAuth** > tipo **Aplicativo da Web**:
   - Nome: `Gestao Agricola web`.
   - Origens JavaScript autorizadas (so origem, sem barra no fim e sem caminho): `https://dnielmr.github.io` e `http://localhost:8080`.
   - URIs de redirecionamento: deixe em branco.
   - Criar. Copie o **ID do cliente** (termina em `.apps.googleusercontent.com`). Nao e senha. NAO copie nem use o "segredo do cliente".
6. Abra `config.js`, troque `COLE_AQUI_O_ID_DO_CLIENTE_GOOGLE` pelo ID e suba o arquivo de novo no GitHub.

## Passo 3 - Testar no iPhone (iOS 16.4 ou mais novo)
1. Abra o endereco no Safari. Confira: HTTPS "sim".
2. Toque em "Entrar com o Google" e aceite. Deve aparecer o seu e-mail.
3. "Gravar arquivo de teste" e depois "Ler arquivo de teste". No Google Drive aparece a pasta `Gestao Agricola` com `teste.json`.
4. "Gravar um registro" 2 vezes. Veja "Registros".
5. Compartilhar > Adicionar a Tela de Inicio. Abra pelo icone (modo app) e repita 2 e 4. Veja se o login funciona nesse modo (o ponto mais incerto no iOS) e se os registros continuam la.
6. Feche o app, desligue Wi-Fi e dados moveis, abra de novo: deve abrir e mostrar os registros.
7. Depois de 7 a 10 dias sem abrir, abra e anote se os registros SUMIRAM. Este e o teste do risco do iOS.
Observacao: o acesso ao Google dura cerca de 1 hora; passado isso o app pede para tocar em "Entrar" de novo.

## Passo 4 - Troca PC <-> celular
No PC abra o mesmo endereco, entre com a mesma conta e use "Enviar banco para o Drive". No iPhone use "Receber banco do Drive" e confira se os registros do PC aparecem. Depois faca o inverso.

## O que me enviar de volta
Texto do "Registro do que aconteceu" (parte de baixo da tela) em cada passo que falhar, e a resposta do teste 3.7.

## Arquivos
`index.html` tela | `app.js` logica | `db.worker.js` banco SQLite | `config.js` ID | `sw.js` modo offline | `lib/` SQLite 3.46.1 (sqlite-wasm, copia local) | login do Google vem de accounts.google.com (precisa de internet so para entrar)
