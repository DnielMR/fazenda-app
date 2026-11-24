// Configuracao do prototipo. So o CLIENT_ID precisa ser trocado (passo a passo em LEIA-ME.md).
// O CLIENT_ID nao e segredo: identifica o aplicativo registrado no Google Cloud.
window.APP_CONFIG = {
  VERSAO: "0.0.1",
  CLIENT_ID: "208384938083-jj7ho6o2l5rf6abs0qk3cds3qg1e2090.apps.googleusercontent.com",
  // drive.file: o app so enxerga os arquivos que ele mesmo criou (nunca o resto do seu Drive).
  SCOPES: "https://www.googleapis.com/auth/drive.file",
  // Pasta criada no seu Google Drive (visivel, voce pode copiar o banco como backup)
  PASTA: "Gestao Agricola",
  ARQUIVO_TEXTO: "teste.json",
  ARQUIVO_BANCO: "fazenda_teste.db"
};
