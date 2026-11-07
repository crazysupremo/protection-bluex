# Como atualizar o PROTECTION BLUEX (Monitor do Shield)

1. Copie TUDO desta pasta para o seu repositório `protection-bluex`, substituindo os arquivos
   (server.js, db.js, LEIA-ISSO.md, public/index.html, public/admin.js, public/monitor.html, public/monitor.js, pasta bluex-shield/).
2. Commit + push. O Render faz o deploy (as tabelas novas são criadas sozinhas).
3. Abra `SEU-SITE/monitor.html` (entre no painel admin antes) → **Sites protegidos** → digite o nome do jogo do seu amigo → **Cadastrar site**.
   Aparece a chave e as 3 variáveis de ambiente para ele colocar no Render dele.
4. Clique **+ Usuário** na linha do site, crie usuário/senha e passe ao seu amigo junto com a pasta `bluex-shield` (zip "para amigo", já com o MANUAL.md).
   Ele entra em `SEU-SITE/monitor.html` e vê só o site dele.
5. Nos Logs do Render deve aparecer `[BLUEX SHIELD] 🛡️ ativo`.
