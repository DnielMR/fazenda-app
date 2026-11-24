# Prototipo de viabilidade (celular + PC + OneDrive)
Objetivo: provar no SEU iPhone que da para (1) entrar com a conta Microsoft, (2) gravar e ler um arquivo na pasta do app no OneDrive, (3) ter um banco SQLite no aparelho e trocar esse banco com o PC pelo OneDrive. Nao e o app final; as telas sao so botoes de teste.

Estado: testado no navegador do PC (banco abre, grava e mantem os dados ao recarregar; modo offline registrado). NAO testado: login Microsoft, OneDrive, iPhone. Esses dependem dos passos abaixo.

## Passo 1 - Hospedar so o codigo (GitHub Pages, gratuito)
Atencao: suba SOMENTE o conteudo desta pasta (`app/prototipo`). Nunca suba o resto do projeto (tem seus dados e planilhas). O endereco fica publico, mas so com o codigo do teste, sem nenhum dado da fazenda.
1. Crie conta em github.com (se nao tiver).
2. Novo repositorio: nome `fazenda-app`, Public.
3. "Add file > Upload files": arraste TODO o conteudo da pasta `app/prototipo` (inclusive a pasta `lib`). Commit.
4. Settings > Pages > Source: "Deploy from a branch", Branch `main`, pasta `/ (root)`. Salvar.
5. Em 1 a 2 minutos o endereco aparece: `https://SEU-USUARIO.github.io/fazenda-app/` (anote; precisa do `/` no fim).

## Passo 2 - Registrar o app na Microsoft (gratuito)
1. Entre em https://entra.microsoft.com com a sua conta pessoal. (Se pedir para criar um "diretorio", aceite o padrao gratuito.)
2. Identidade > Aplicativos > Registros de aplicativo > Novo registro.
3. Nome: `Gestao Agricola`. Tipos de conta: "Somente contas pessoais da Microsoft".
4. URI de redirecionamento: tipo "Aplicativo de pagina unica (SPA)" e o endereco do passo 1.5 (exato, com `/` no fim). Registrar.
5. Depois de criado: Autenticacao > adicionar tambem `http://localhost:8080/` (para testar no PC).
6. Permissoes de API > Adicionar > Microsoft Graph > Delegadas > `Files.ReadWrite.AppFolder`.
7. Copie o "ID do aplicativo (cliente)" (um codigo com tracos).
8. Abra `config.js`, troque `COLE_AQUI_O_ID_DO_APLICATIVO` por esse codigo e suba o arquivo de novo no GitHub. O ID nao e senha.

## Passo 3 - Testar no iPhone (iOS 16.4 ou mais novo)
1. Abra o endereco no Safari. Confira: HTTPS "sim".
2. Toque em "Entrar com a Microsoft" e aceite a permissao. Deve aparecer sua conta.
3. "Gravar arquivo de teste" e depois "Ler arquivo de teste". No OneDrive aparece a pasta `Apps/Gestao Agricola/teste.json`.
4. "Gravar um registro" 2 vezes. Veja "Registros".
5. Compartilhar > Adicionar a Tela de Inicio. Abra pelo icone (modo app) e repita 2 e 4. Veja se a conta continua entrada e se os registros continuam la.
6. Feche o app, desligue o Wi-Fi e os dados moveis, abra de novo: deve abrir e mostrar os registros.
7. Em dias seguintes (sem abrir o app por 7 a 10 dias) abra de novo e anote se os registros SUMIRAM. Este e o teste do risco do iOS.

## Passo 4 - Troca PC <-> celular
No PC, abra `http://localhost:8080/` (servidor local; peça ao agente para iniciar) ou o mesmo endereco do GitHub, entre com a mesma conta e use "Enviar banco para o OneDrive". No iPhone use "Receber banco do OneDrive" e confira se os registros do PC aparecem. Depois faca o inverso.

## O que me enviar de volta
Prints ou texto do "Registro do que aconteceu" (parte de baixo da tela) em cada passo que falhar, e a resposta do teste 3.7.

## Arquivos
`index.html` tela | `app.js` logica | `db.worker.js` banco SQLite | `config.js` ID | `sw.js` modo offline | `lib/` SQLite 3.46.1 (sqlite-wasm) e msal-browser 3.28.1 (copias locais, licencas incluidas)
