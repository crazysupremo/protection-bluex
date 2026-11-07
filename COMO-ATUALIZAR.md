# Como atualizar o PROTECTION BLUEX

1. Copie TUDO desta pasta para dentro do seu repositório `protection-bluex`, substituindo os arquivos
   (server.js, LEIA-ISSO.md, public/index.html, public/admin.js e a pasta bluex-shield/).
2. Faça commit e push (ou "Adicionar arquivo > Fazer upload" no GitHub). O Render faz o deploy sozinho.
3. Abra o painel admin → aba **🛡️ Verificação**:
   - clique "Rodar teste do Shield" → deve aparecer "Todos os testes passaram";
   - escreva um texto e clique "Analisar" para ver a moderação funcionando;
   - suba uma imagem para testar a moderação de imagem.
4. Nos Logs do Render deve aparecer: `[BLUEX SHIELD] 🛡️ ativo (modo automático).`
Emergência: variável BLUEX_SHIELD=off.
