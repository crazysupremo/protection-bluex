# PASTA 1 — Atualizar o seu PROTECTION BLUEX (painel + Monitor)

1. Copie TUDO desta pasta para o seu repositório `protection-bluex`, substituindo os arquivos
   (server.js, db.js, LEIA-ISSO.md, public/*, bluex-shield/). Commit + push; o Render faz o deploy
   (as tabelas novas são criadas sozinhas).
2. Entre no painel admin e abra **`SEU-SITE/monitor.html`** (também tem um botão na aba "🛡️ Verificação").
3. Em **Sites protegidos**: digite o nome do jogo do seu amigo → **Cadastrar site**.
4. Na linha do site:
   - **⬇ bluex_shield.json** → baixa o arquivo de vínculo (chave + endereço do seu painel). Mande ao seu amigo.
   - **+ Usuário** → crie usuário e senha para ele. Ele entra em `SEU-SITE/monitor.html` e vê **só o jogo dele**
     (gráfico por minuto, IPs abusivos, botão Derrubar/Liberar).
5. Quando o escudo dele ligar, o site fica **🟢 conectado** e, se as requisições subirem, aparece em **🔔 Alertas**
   com o NOME do jogo (e toca um aviso).
6. (Opcional) Selo 🛡️ no seu perfil do NEXT GAME: no Render do Protection BLUEX crie `BLUEX_OWNER_KEY=uma-chave-sua`;
   no Render do NEXT GAME crie `PROTECTION_BLUEX_URL=https://SEU-PROTECTION-BLUEX` e a mesma `BLUEX_OWNER_KEY`.

A PASTA 2 (`bluex-shield-cpp-amigo.zip`) é o que você envia ao seu amigo.
