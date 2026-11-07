# 🛡️ BLUEX SHIELD — MANUAL

Proteção contra **ataque de flood / DDoS** para o seu jogo ou site em Node.js.
Este manual explica **o que o sistema faz, como ele reage a um ataque e o que você deve fazer**.

---

## 1. Instalação (2 minutos)

1. Copie a pasta `bluex-shield` para dentro do projeto, ao lado do `server.js`.
2. Na **linha 1** do `server.js` (ou `index.js`) cole:
   ```js
   require('./bluex-shield');
   ```
3. Faça commit/push. No Render, abra **Logs** e procure:
   ```
   [BLUEX SHIELD] 🛡️ ativo (modo automático).
   ```

Pronto: já está protegendo. Não precisa instalar mais nada.

### Ligar o painel de monitoramento (opcional, recomendado)

O dono do sistema (Protection BLUEX) vai te passar **uma chave** e um **usuário/senha**.
No Render → seu serviço → **Environment**, crie:

| Variável | Valor |
|---|---|
| `BLUEX_SHIELD_KEY` | a chave que você recebeu (`bxs_...`) |
| `BLUEX_SHIELD_URL` | o endereço do Protection BLUEX que você recebeu |
| `BLUEX_SHIELD_SITE` | o nome do seu jogo (aparece no painel) |

Reinicie. Em ~1 minuto o seu site aparece no painel (`/monitor.html` do Protection BLUEX), onde você entra com o usuário e a senha recebidos.

---

## 2. Como o Shield protege (sem você fazer nada)

Cada pedido que chega ao servidor passa pelo Shield **antes** do seu código:

- **Limite por IP:** cada IP pode fazer no máximo ~60 pedidos por segundo (600 a cada 10 s).
  Passou disso → recebe erro 429 ("muitas requisições").
- **Ban automático:** quem estoura o limite 3 vezes é banido por 10 min; reincidente dobra (20, 40… até 24 h).
  Flood muito forte = ban imediato.
- **Rotas sensíveis** (login, cadastro, senha): limite próprio por minuto, contra tentativa de invadir contas.
- **Armadilhas de scanner:** quem pede `/.env`, `/wp-login`, `/phpmyadmin` etc. (robôs procurando brecha) é banido rápido.
- **Varredura de URLs:** muitos "404" seguidos custam mais ao IP.
- **WebSocket / Socket.IO:** limite de conexões abertas por IP e timeouts contra conexões lentas (slowloris).
- **Detecta sozinho** se está atrás do Render, Heroku, nginx ou Cloudflare, para enxergar o **IP real**.
- **Se o Shield tiver algum erro interno, ele deixa o pedido passar.** Nunca derruba o jogo.

---

## 3. Níveis de alerta (pedidos por minuto, no site inteiro)

| Nível | Pedidos/minuto | O que acontece |
|---|---|---|
| ✅ **Normal** | menos de 1.000 | Nada. Funcionamento padrão. |
| ⚠️ **Elevado** | 1.000 ou mais | Só **sinaliza** no painel (amarelo). Nenhuma restrição extra. |
| 🟠 **Suspeito (provável DDoS)** | 5.000 ou mais | **Defesa automática LIGA**: limites por IP ficam **4× mais apertados** e **IPs novos esperam** (quem já estava jogando continua). |
| 🚨 **Extremo** | 10.000 ou mais | **Defesa máxima**: limites **8× mais apertados**, alerta imediato ao painel do dono. |

A defesa **desliga sozinha** quando o tráfego volta ao normal por ~2 minutos.

---

## 4. O que acontece em caso de ataque (passo a passo)

1. O tráfego sobe. Nos **Logs** aparece `⚠️ DEFESA AUTOMÁTICA ligada (~XXXX pedidos/min)`.
2. O Shield **derruba os IPs** que fazem pedidos demais e **segura IPs novos** (típico de ataque vindo de milhares de máquinas). Jogadores que já estavam conectados seguem normalmente.
3. Se passar de 10.000/min: `🚨 DEFESA MÁXIMA ligada` e o painel mostra **alerta vermelho**.
4. A cada minuto o Shield manda ao painel um resumo (números + só os IPs claramente abusivos).
5. **Você (ou o dono) pode agir pelo painel:** botão **Derrubar** ao lado de qualquer IP, ou digitar um IP manualmente. O comando chega ao seu Shield em até ~1 minuto.
6. Quando acaba o ataque, os bans expiram sozinhos. Para liberar antes, use **Liberar** no painel.

### O que o Shield NÃO consegue fazer sozinho
Um ataque **gigante com milhares de IPs diferentes** pode saturar a internet/servidor antes de chegar ao código. Nesse caso:
- A defesa máxima já reduz muito o estrago, **mas o ideal é colocar a Cloudflare na frente** (grátis, precisa de domínio próprio) — ela absorve o grosso do ataque.
- No Render, avise o dono do sistema pelo painel; ele consegue ajudar a analisar e derrubar os IPs.

---

## 5. Privacidade (importante para jogo de celular)

O Shield **não coleta dados de jogadores**. Ele **não guarda nem envia**: rotas acessadas, aparelho/navegador, cookies, conteúdo dos pedidos, contas, mensagens.

O que sai do seu servidor (só se você ligou o painel):
- números do minuto (total de pedidos, quantos bloqueados);
- **apenas IPs claramente abusivos** (200+ pedidos no minuto) e o **motivo** (ex.: "passou do limite", "scanner").

IP de jogador normal **nunca** é enviado.

> Atenção a celulares: muitos jogadores de operadora móvel dividem o mesmo IP (CGNAT). Os limites padrão já são folgados para isso. Se notar jogadores legítimos sendo bloqueados, aumente `maxPerWindow` (veja o item 6) ou use **Liberar** no painel.

---

## 6. Ajustes (opcional)

No `index.js`, dentro de `createShield({ ... })`:

```js
const shield = createShield({
  maxPerWindow: 600,          // pedidos por IP a cada 10 s (600 = 60/s)
  maxSocketsPerIp: 40,        // WebSockets abertos por IP
  skipPaths: ['/healthz'],    // caminhos que não contam (ex.: health check)
  allowlist: ['SEU.IP.AQUI'], // IPs que nunca são bloqueados (o seu!)
  suspectPerMinute: 5000,     // nível "suspeito"
  alertPerMinute: 10000,      // nível "extremo"
});
```

---

## 7. Desligar numa emergência

Crie a variável de ambiente **`BLUEX_SHIELD`** com valor **`off`** e reinicie. Sem mexer no código.
(Use só se o Shield estiver atrapalhando; seu jogo fica sem proteção enquanto estiver desligado.)

---

## 8. Perguntas rápidas

**Meu jogo caiu, foi o Shield?** Improvável (ele deixa passar em caso de erro). Teste com `BLUEX_SHIELD=off`; se voltar, avise o dono.
**Vi "429" nos logs.** Normal: é o Shield recusando IPs que passaram do limite.
**Um jogador reclamou que está bloqueado.** Peça o IP dele, procure no painel em "IPs derrubados" e clique **Liberar**.
**Quero ver o que está acontecendo.** Painel: `/monitor.html` do Protection BLUEX → gráfico por minuto, IPs abusivos, IPs derrubados e eventos.
