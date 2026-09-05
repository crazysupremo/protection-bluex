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
