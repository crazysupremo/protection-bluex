# PROTECTION BLUEX — API de verificação de idade, moderação e análise de texto

Produto da **BLUE SPORTS GAMES**. Serviço próprio (separado do NEXT GAME) pra
vender/licenciar como API pra outras empresas integrarem nos próprios
produtos: apps, sites, plataformas de jogo, e-commerce, etc.

> A análise de câmera de segurança comercial (furto/roubo) NÃO está aqui —
> virou um app separado, **BLUEX SECURITY** (outro repositório, outro
> deploy), porque atende outro público (comércio/varejo, não plataformas
> online). Veja `bluex-security/README.md`.

## O que a API faz

Cinco capacidades, cada uma com seu próprio endpoint:

1. **Verificação de idade** (`/v1/age-verify`) — recebe uma foto de rosto, devolve uma estimativa de idade.
2. **Moderação de imagem** (`/v1/moderate-image`) — recebe uma imagem, sinaliza nudez, violência real, maus-tratos a animais, drogas, armas em contexto de ameaça, ódio, automutilação/suicídio, ou suspeita de risco a menor.
3. **Análise de texto** (`/v1/analyze-text`) — recebe uma mensagem/texto, sinaliza comportamento suspeito (aliciamento, adulto se passando por menor, doxxing, ódio, golpe, drogas/armas, automutilação).
4. **Moderação de áudio** (`/v1/moderate-audio`) — recebe um áudio, transcreve a fala e roda a mesma análise de texto do item 3 em cima da transcrição. O áudio em si nunca é guardado, só passa pela memória do processo.
5. **Moderação de vídeo** (`/v1/moderate-video`) — recebe uma lista de frames (imagens) amostrados do vídeo pelo próprio cliente (ex: 1 por segundo) e roda a moderação de imagem em cada um. `flagged=true` se qualquer frame for sinalizado.

### Modo "bem rigoroso" — pensado pra pecar pelo excesso de cautela

- **Checagem dupla opcional:** se `GROQ_VISION_MODEL_2` / `GROQ_TEXT_MODEL_2` estiverem configuradas, toda checagem de imagem ou texto roda em **dois modelos diferentes em paralelo** — se qualquer um dos dois sinalizar, o resultado final é `flagged: true` (lógica OR, não AND). Sem essas variáveis, funciona normal com um modelo só.
- **Confidence em vez de descarte:** os endpoints de imagem/texto agora devolvem também `"confidence": "baixa"|"média"|"alta"`. Os prompts instruem os modelos a sinalizar indícios *ambíguos* com confidence `"baixa"` em vez de simplesmente descartar — isso joga mais coisa pra fila de revisão humana, mas reduz a chance de algo passar despercebido. Use a confidence pra priorizar a fila (revise primeiro os `"alta"`).
- **Categorias novas:** além de nudez, violência grave, maus-tratos a animais e risco a menor, agora também sinaliza drogas ilícitas, armas em contexto de ameaça, discurso/símbolos de ódio, automutilação/incentivo a suicídio, doxxing e golpe/fraude.

Isso é uma troca deliberada: **mais falsos positivos pra revisar, em troca de menos coisa escapando.** Por isso toda sinalização — mesmo confidence `"baixa"` — deve ir pra revisão humana, nunca disparar punição automática sozinha.

## Limitações importantes (leia antes de vender isso pra alguém)

- **Não é detecção de CSAM especializada.** Isso usa um modelo de visão de propósito geral (Groq), não um serviço como PhotoDNA/Thorn Safer que compara contra bancos de hashes conhecidos. Nunca prometa pra um cliente que isso identifica material de abuso infantil — só que sinaliza suspeita de risco pra revisão humana.
- **Não é verificação de idade legalmente vinculante.** É uma estimativa por IA. Não deve ser usada como único método de verificação onde a lei exige comprovação documental (ex: venda de álcool, conteúdo adulto).
- **Nenhuma imagem é guardada.** Só o resultado (sinalizado ou não, motivo, categorias) fica salvo, pra fila de revisão. Isso é bom pra privacidade, mas também significa que não tem como "ver de novo" o que gerou um alerta — só o texto do motivo.
- Todo cliente que usar essa API pra dados de usuários dele vai precisar da própria base legal (consentimento, aviso de privacidade, etc.) — isso é responsabilidade de cada empresa cliente, não da API.

## Como rodar localmente

```bash
npm install
GROQ_API_KEY=sua_chave ADMIN_PASSWORD=uma_senha_forte npm start
```

Abre em `http://localhost:4900`. O painel admin (pra criar clientes e ver
casos sinalizados) fica em `http://localhost:4900/` mesmo.

## Variáveis de ambiente

| Variável | Obrigatória | Pra quê |
|---|---|---|
| `GROQ_API_KEY` | Sim (senão a API sempre responde `flagged: false`) | Roda as análises de visão/texto |
| `ADMIN_PASSWORD` | Sim (senão o painel admin não abre) | Senha do painel admin — só você usa |
| `SESSION_SECRET` | Recomendado em produção | Assina o cookie de sessão do admin |
| `TURSO_DATABASE_URL` + `TURSO_AUTH_TOKEN` | Recomendado em produção | Sem isso usa SQLite local, que some a cada redeploy no Render |
| `PORT` | Não | Porta do servidor (padrão 4900) |
| `GROQ_VISION_MODEL` / `GROQ_TEXT_MODEL` | Não | Trocar o modelo principal usado, se precisar |
| `GROQ_VISION_MODEL_2` / `GROQ_TEXT_MODEL_2` | Não | **Liga a checagem dupla** — um segundo modelo, diferente do principal, que roda em paralelo. Se qualquer um dos dois sinalizar, o resultado final é flagged. Deixe sem configurar pra usar só um modelo. |
| `GROQ_AUDIO_MODEL` | Não | Modelo de transcrição usado em `/v1/moderate-audio` (padrão `whisper-large-v3`) |

## Como uma empresa cliente integra

1. Você cria a empresa no painel admin → gera uma chave de API (`bluex_...`).
2. A empresa manda a chave em todo request, no header `X-API-Key`.

### Verificação de idade

```bash
curl -X POST https://sua-api.onrender.com/v1/age-verify \
  -H "X-API-Key: bluex_xxx" \
  -H "Content-Type: application/json" \
  -d '{"image": "data:image/jpeg;base64,...."}'
```

Resposta:
```json
{ "estimated_age": 24, "confidence": "média", "flagged_as_minor": false, "reason": "..." }
```

### Moderação de imagem

```bash
curl -X POST https://sua-api.onrender.com/v1/moderate-image \
  -H "X-API-Key: bluex_xxx" -H "Content-Type: application/json" \
  -d '{"image_url": "https://exemplo.com/foto.jpg"}'
```

Resposta:
```json
{ "flagged": true, "categories": ["violencia_grave"], "confidence": "alta", "reason": "..." }
```

### Análise de texto

```bash
curl -X POST https://sua-api.onrender.com/v1/analyze-text \
  -H "X-API-Key: bluex_xxx" -H "Content-Type: application/json" \
  -d '{"text": "mensagem do usuário aqui"}'
```

Resposta:
```json
{ "flagged": false, "categories": [], "confidence": "baixa", "reason": null }
```

### Moderação de áudio

```bash
curl -X POST https://sua-api.onrender.com/v1/moderate-audio \
  -H "X-API-Key: bluex_xxx" -H "Content-Type: application/json" \
  -d '{"audio_url": "https://exemplo.com/mensagem-de-voz.ogg"}'
```

Aceita `"audio"` (data URL base64) ou `"audio_url"`. Resposta igual à de análise de texto.

### Moderação de vídeo

```bash
curl -X POST https://sua-api.onrender.com/v1/moderate-video \
  -H "X-API-Key: bluex_xxx" -H "Content-Type: application/json" \
  -d '{"frames": ["data:image/jpeg;base64,...", "data:image/jpeg;base64,..."]}'
```

O vídeo em si não é processado no servidor (isso pediria ffmpeg) — o cliente extrai os frames (ex: 1 por segundo, até 12 por requisição) e manda como imagens. Resposta:
```json
{
  "flagged": true,
  "categories": ["violencia_grave"],
  "confidence": "alta",
  "reason": "frame 3: ...",
  "frames": [{ "index": 0, "flagged": false, "...": "..." }, { "index": 3, "flagged": true, "...": "..." }]
}
```

Todos os endpoints de imagem aceitam `"image"` (data URL base64) ou
`"image_url"` (link http/https direto) — não precisa dos dois.

## Limites

- 60 requisições por minuto por IP em todos os endpoints `/v1/*`, mais um limite extra de 20/min pra `/v1/moderate-audio` e `/v1/moderate-video` (são bem mais caros — transcrição ou múltiplos frames por chamada). Ajuste em `server.js` se precisar de mais, dependendo do plano do cliente.
- Corpo da requisição limitado a 28MB (dá pra um áudio de até 20MB em base64, ou até 12 frames de vídeo no mesmo request). Em produção real, prefira mandar `image_url`/`audio_url` já hospedados em algum storage — é mais leve que base64.
- Vídeo: máximo de 12 frames por requisição.
- Áudio: máximo de 20MB por arquivo.

## Deploy (Render, mesmo fluxo do NEXT GAME)

1. Sobe esse código num repositório Git.
2. No Render: New → Web Service → conecta o repositório.
3. Build command: `npm install`. Start command: `npm start`.
4. Configura as variáveis de ambiente da tabela acima.
5. Depois do primeiro deploy, entra no painel admin com a `ADMIN_PASSWORD` e cria seu primeiro cliente de teste.
