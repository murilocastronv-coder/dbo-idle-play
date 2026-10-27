# Forgotten Lands

RPG idle multiplayer de navegador: contas salvas em PostgreSQL, cidade compartilhada com outros jogadores, 230+ hunts, bosses e transformações.

**[▶ Jogar](https://dbo-idle-multiplayer-server.onrender.com/)** · [Wiki](https://alanfmf.github.io/dbo-idle-play/wiki/)

## O que é isto

O jogo funcionou por 15 dias como piloto fechado em uma VPS, com Node.js, PostgreSQL e WebSocket. Encerrado o piloto, o cliente foi convertido para rodar sozinho no navegador e publicado aqui, para que o projeto continue jogável sem custo de servidor.

O que muda sem backend:

| Sistema | Nesta versão |
|---|---|
| Conta e personagem | Criados normalmente, guardados no `localStorage` do navegador |
| Verificação por e-mail | Não existe: qualquer código de 6 dígitos conclui o cadastro |
| Hunts, combate, transformações, inventário, forja, bestiário, quests, treino | Funcionam, simulados no próprio cliente |
| Market, guilda, party, PvP, rankings, loja VIP, pagamentos | Indisponíveis — dependiam do servidor autoritativo |

Como o progresso vive no navegador, limpar os dados do site apaga a conta, e não há sincronização entre dispositivos.

## Contas no banco de dados

As contas e os personagens ficam no servidor (`multiplayer-server/accounts.js`):

- Com a variável `DATABASE_URL` (PostgreSQL), tudo vai para as tabelas `fl_accounts`,
  `fl_sessions` e `fl_characters`, criadas automaticamente na primeira execução.
- Sem `DATABASE_URL` (ex.: rodando no PC para jogar na Wi-Fi), os dados ficam em
  `multiplayer-server/data/accounts.json`.

Senhas guardadas com scrypt, sessão por token. O jogo salva o personagem sozinho
cerca de 1 s depois de cada mudança e ao fechar/minimizar a página. Quem tinha
personagens salvos só no navegador e entra com o mesmo e-mail tem esses
personagens importados para a conta.

## Multiplayer (cidade compartilhada)

Quem estiver conectado ao mesmo servidor aparece na cidade de Earth, anda em tempo
real, fala no chat (com balão em cima do personagem) e entra na contagem de
jogadores online. Quem está em hunt/treino some da cidade e volta quando retorna ao PZ.

### Rodar o servidor

```bash
npm install
npm start
```

O terminal mostra o endereço para abrir no celular (mesma Wi-Fi), algo como
`http://192.168.0.10:10000/`. A raiz é a página inicial; o jogo fica em `/play/`.
Comando no chat: `/online`.

Na Render, o serviço web roda `npm start` e serve tudo: página inicial, jogo,
API de contas e WebSocket (`/ws`). Sites estáticos (GitHub Pages ou o static
site da Render) usam esse servidor automaticamente; para apontar para outro, abra
o jogo uma vez com `?server=wss://seu-servidor/ws`.

## Estrutura

| Caminho | Conteúdo |
|---|---|
| `index.html`, `landing-assets/` | Página inicial |
| `play/` | Cliente do jogo — `src/` com o código, `assets/` e `generated/` com arte e catálogos |
| `wiki/` | Wiki estática: vocações, hunts, bosses, itens, transformações |
| `aplicar-modo-offline.ps1` | Script que converteu a build online nesta versão estática |

## Rodar localmente

O cliente usa ES Modules, então precisa de um servidor HTTP — abrir o `index.html` pelo `file://` não funciona.

```bash
npx --yes serve -l 8080
# http://localhost:8080/play/
```

A landing e a wiki usam caminhos absolutos com o prefixo `/dbo-idle-play/`, que é onde o GitHub Pages publica este repositório. Localmente elas só funcionam se a pasta for servida sob esse mesmo caminho; o jogo em `play/` usa caminhos relativos e roda em qualquer lugar.

Se um dia o site mudar de endereço — outro repositório ou um domínio próprio — basta um find-and-replace de `/dbo-idle-play/` nos arquivos da raiz e da wiki.

## Aviso

Projeto independente de fã, sem fins comerciais e sem vínculo oficial com as franquias que serviram de inspiração. Este repositório distribui o cliente completo, incluindo arte de terceiros — leia o [`NOTICE.md`](NOTICE.md) antes de reaproveitar qualquer coisa daqui.
