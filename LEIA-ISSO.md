# O que mudou nesse `server.js` (Protection BLUEX)

## O bug real que deixou a imagem de teste passar

O `MODERATE_IMAGE_PROMPT` só marcava arma como suspeita se fosse **"arma de
fogo real anunciada pra venda"** — qualquer outra situação com arma real
(ameaça, ostentação, ferimento) passava direto. Corrigido pra cobrir arma
real em contexto de ameaça também, não só venda.

## A "checagem dupla" que o README prometia, mas nunca existiu de verdade

O README já falava de `GROQ_VISION_MODEL_2` / `GROQ_TEXT_MODEL_2` ligando
dois modelos em paralelo (se qualquer um sinalizar, já conta como
sinalizado), e o banco (`db.js`) já tinha até a coluna `confidence` pronta
pra isso. Mas o `server.js` de antes nunca lia essas variáveis — sempre
rodava com 1 modelo só, mesmo que você configurasse as duas. Agora está
implementado de verdade: `callGroqVision`/`callGroqText` rodam os dois
modelos em paralelo quando a variável `_2` existir, e combinam o resultado.

## Categorias ampliadas (o README já prometia isso também)

- Imagem: agora também sinaliza drogas ilícitas, ódio (símbolos/discurso
  visual), automutilação/incentivo a suicídio — além de nudez, violência
  real, maus-tratos a animais, arma real em ameaça, risco a menor.
- Texto: agora também sinaliza doxxing e golpe/fraude, além de aliciamento,
  adulto se passando por menor, ódio, drogas/armas.
- Os dois agora pedem um campo `"confidence"` — indício ambíguo (não 100%
  claro) já marca `flagged=true` com confidence baixa, em vez de descartar.
  Isso joga mais coisa pra fila de revisão humana (mais falso positivo,
  menos coisa escapando) — igual o README já dizia que devia funcionar.

## Endpoints que faltavam

`/v1/moderate-audio` e `/v1/moderate-video` estavam documentados no README
mas não existiam no código. Adicionei os dois.

## O que você precisa fazer

1. Sobe esse `server.js` no lugar do atual no repositório
   `crazysupremo/protection-bluex` (substitui o arquivo).
2. Se quiser a checagem dupla ATIVA de verdade (recomendado, já que é o
   "modo bem rigoroso"), adiciona no Render (Environment) duas variáveis
   novas: `GROQ_VISION_MODEL_2` e `GROQ_TEXT_MODEL_2` — um modelo Groq
   diferente do principal em cada uma (ex: `llama-4-scout` ou outro modelo
   de visão disponível na sua conta Groq, pra vision; qualquer modelo de
   texto Groq diferente do `llama-3.3-70b-versatile` pra texto). Sem essas
   duas, continua funcionando com 1 modelo só — só que já com o prompt
   corrigido, que sozinho já deve resolver a maior parte do problema.
3. Depois de subir e o Render fazer o redeploy, testa de novo a mesma
   imagem que passou antes.

## Segunda rodada de melhorias (segurança, robustez e painel admin)

### Senha do admin comparada em tempo constante
A senha do admin era comparada com `password !== ADMIN_PASSWORD` — uma
comparação de string comum em JS para no primeiro byte diferente, o que em
teoria vaza (por tempo de resposta) quantos caracteres do início a
tentativa acertou. Trocado por `crypto.timingSafeEqual` (função
`passwordMatches`). O import do `bcryptjs` foi removido — estava no
`package.json` e no `server.js` mas nunca era usado em lugar nenhum.

### Proteção contra SSRF em `audio_url`
`/v1/moderate-audio` baixa o áudio de `audio_url` DIRETO no seu servidor
(diferente de `image_url`, que é só repassada pra Groq buscar). Isso
significa que uma empresa cliente mal-intencionada — ou com a chave de API
vazada — podia mandar uma `audio_url` apontando pra rede interna (ex.
`http://169.254.169.254/...`, o endereço clássico de metadata de nuvem, ou
`http://localhost:...`) e usar seu servidor como proxy pra sondar essa
rede. Agora `isSafeExternalUrl` resolve o hostname e bloqueia IP privado/
loopback/link-local antes de baixar qualquer coisa.

### Validação do formato de imagem
`/v1/age-verify`, `/v1/moderate-image` e `/v1/moderate-video` aceitavam
qualquer string em `image`/`image_url`/`frames`, inclusive coisas como
`javascript:alert(1)`. Agora só aceita data URL de imagem
(`data:image/...;base64,...`) ou URL `http(s)://` — erro 400 claro antes de
gastar uma chamada da Groq com lixo.

### Senha do admin agora dá pra trocar pelo próprio painel
Antes, a única forma de trocar a senha do admin era editando a variável
`ADMIN_PASSWORD` no Render (Environment) e esperando o redeploy. Agora tem
uma aba nova, **Segurança**, dentro do painel: entra com a senha atual +
nova senha (mínimo 8 caracteres), e pronto — a senha nova fica salva com
hash no banco (`admin_settings`, usando `scrypt`, nunca em texto puro) e
passa a valer no lugar da `ADMIN_PASSWORD`. Enquanto ninguém troca pela
primeira vez, o login continua caindo de volta pra `ADMIN_PASSWORD` (só
serve de "bootstrap" do primeiro acesso). Se você já tinha uma senha
configurada no Render e quer trocar agora: entra com ela, vai em
Segurança, e cadastra a nova.

### Paginação e filtro por empresa no painel admin
`/admin/usage` e `/admin/flagged` sempre devolviam só os últimos 200
registros, sem jeito de navegar pro resto nem filtrar por empresa. Agora
aceitam `?limit=&offset=&client_id=` (limit capado em 200) e devolvem
`{ rows, total, limit, offset }`. O painel (`admin.js`/`index.html`) ganhou
um filtro por empresa e botões de "Anterior"/"Próxima" nas abas de Uso e
Casos sinalizados.

## Terceira rodada: BLUEX SHIELD v2 + moderação que não "finge limpo"

- **Pasta `bluex-shield/`** (2 arquivos) ligada na linha 1 do `server.js`: limita pedidos por IP,
  bane flood (10 min até 24h), derruba scanners (`/.env`, `/wp-login`...), cobra a mais por varredura
  de 404, protege o login do admin e entra em modo proteção se o servidor engasgar.
  Emergência: variável `BLUEX_SHIELD=off` no Render.
- **`unverified`**: se a Groq falhar (limite/queda/chave ausente), `/v1/age-verify`,
  `/v1/moderate-image` e `/v1/analyze-text` agora respondem `"unverified": true` (antes diziam
  "limpo") e o caso vai pra fila de revisão com a categoria `nao_verificado`.
  A empresa cliente deve tratar `unverified` como "segurar até revisar".

## Aba "🛡️ Verificação" no painel admin

Nova aba no painel (depois de Segurança): estado do sistema (servidor, banco, Shield, Groq,
checagem dupla), **teste automático do Shield** (simula flood/scanner/ban sem afetar tráfego real),
lista de IPs banidos com botão "Liberar", e **testes de moderação de texto e imagem** direto no painel.
Rotas novas (todas exigem login de admin): `GET /admin/system-check`, `POST /admin/shield/self-test`,
`POST /admin/shield/unban`, `POST /admin/test-text`, `POST /admin/test-image`.

## Monitor BLUEX SHIELD (`/monitor.html`)

Página profissional para analisar requisições: gráfico por minuto (linhas de 1 mil / 5 mil / 10 mil),
banner de nível (normal / elevado / suspeito ≥5 mil / extremo ≥10 mil), IPs abusivos com botão **Derrubar**,
IPs derrubados com **Liberar**, eventos suspeitos e **Sites protegidos** (cadastrar site → gera chave +
cria usuário para o seu amigo entrar e ver só o site dele).

- O Shield do site do amigo manda 1 resumo por minuto para `POST /shield/report` (com a chave `bxs_...`).
  **Só números e IPs claramente abusivos (200+ pedidos/min). Nenhum dado de jogador.**
- Derrubar/Liberar pelo painel vira comando que o Shield do site aplica no próximo envio (~1 min).
- Defesa automática: ≥5 mil/min limites 4× mais apertados; ≥10 mil/min 8× mais apertados.
- Tabelas novas: `shield_sites`, `shield_users`, `shield_reports` (24 h), `shield_commands`.
- Passo a passo para o amigo: `bluex-shield/MANUAL.md`.

### Jogo do amigo em C++ (Windows)
O site do amigo usa o **BLUEX SHIELD em C++** (`bluex_shield.hpp`, zip `bluex-shield-cpp-amigo.zip`). Ele manda o resumo por minuto
para `POST /shield/report` (mesmo formato do Shield em Node). No monitor, clique **⬇ bluex_shield.json** na linha do site
e envie esse arquivo a ele; ele coloca ao lado do `.exe` do jogo.
