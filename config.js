// Configuracao do prototipo. So o CLIENT_ID precisa ser trocado (passo a passo em LEIA-ME.md).
// O CLIENT_ID nao e segredo: identifica o aplicativo registrado na Microsoft.
window.APP_CONFIG = {
  CLIENT_ID: "COLE_AQUI_O_ID_DO_APLICATIVO",
  // Conta pessoal da Microsoft (Outlook, Hotmail, Live). Nao serve para conta de trabalho.
  AUTHORITY: "https://login.microsoftonline.com/consumers",
  SCOPES: ["Files.ReadWrite.AppFolder"],
  // Arquivos que o prototipo grava na pasta do app (OneDrive > Apps > <nome do aplicativo>)
  ARQUIVO_TEXTO: "teste.json",
  ARQUIVO_BANCO: "fazenda_teste.db"
};
