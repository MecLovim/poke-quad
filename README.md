# Poke Quad

> ## ⚠️ Aviso
>
> **Poke Quad é um projeto independente, feito por jogadores. Não tem nenhum
> vínculo com a equipe do Poke Idle World, nem com a Nintendo, Creatures Inc.
> ou GAME FREAK.**
>
> **A regra 03 do jogo proíbe o uso de programas, scripts ou extensões sem
> autorização prévia da administração. Ao usar este app você assume esse risco
> por conta própria. Os autores não se responsabilizam por advertências,
> suspensões, remoção de itens ou exclusão de contas decorrentes do uso desta
> ferramenta.**
>
> **Peça autorização à staff no Discord oficial antes de usar.**
>
> **O software é fornecido "como está", sem garantia de qualquer tipo.**

Uma janela, quatro navegadores independentes em grid 2x2, cada um com sessão
própria (cookies e localStorage separados): dá para manter quatro contas de
[Poke Idle World](https://poke.idleworld.online) logadas ao mesmo tempo, sem
que uma derrube a outra. Os logins ficam salvos entre uma execução e outra.

## Download

**[⬇ Baixar a versão mais recente](https://github.com/meclovim/poke-quad/releases/latest)**

Na página que abrir, baixe o arquivo do seu sistema:

| Sistema | Arquivo |
|---|---|
| Windows | `Poke-Quad-Setup-x.x.x.exe` |
| macOS (Intel) | `Poke-Quad-x.x.x-x64.dmg` |
| macOS (Apple Silicon) | `Poke-Quad-x.x.x-arm64.dmg` |
| Linux | `Poke-Quad-x.x.x.AppImage` |

Não precisa instalar nada além disso — nada de npm, Node ou código.

## Instalação

Depois de baixar:

- **Windows**: rode o `Poke-Quad-Setup-x.x.x.exe`, escolha a pasta e conclua.
  Um atalho é criado na área de trabalho.
- **macOS**: abra o `.dmg` (x64 para Intel, arm64 para Apple Silicon) e
  arraste o app para a pasta Aplicativos.
- **Linux**: dê permissão de execução ao `.AppImage`
  (`chmod +x Poke-Quad-*.AppImage`) e execute.

Na primeira abertura o app mostra a tela de aviso acima; marque a caixa e
clique em "Li e concordo" para continuar.

## Build bloqueada pelo sistema?

As builds **não são assinadas digitalmente**, então o sistema pode desconfiar:

- **Windows (SmartScreen)**: clique em **Mais informações** e depois em
  **Executar assim mesmo**.
- **macOS (Gatekeeper)**: clique com o botão direito no app e escolha
  **Abrir** (a opção de abrir mesmo assim só aparece nesse caminho). Se ainda
  bloquear, rode no Terminal:
  `xattr -dr com.apple.quarantine "/Applications/Poke Quad.app"`

## Onde ficam os dados de cada conta

Cada painel usa uma partição persistente própria (`slot1` a `slot4`), gravada
em:

- **Windows**: `%APPDATA%\Poke Quad\Partitions\`
- **macOS**: `~/Library/Application Support/Poke Quad/Partitions/`
- **Linux**: `~/.config/Poke Quad/Partitions/`

Para limpar o login de um único slot, use o botão de lixeira na barra do
próprio painel (pede confirmação e desloga só aquela conta). O botão
"Limpar tudo" na barra de título faz o mesmo para as quatro de uma vez.
Também funciona manualmente: com o app fechado, apague a pasta do slot
desejado (por exemplo `Partitions\slot2`).

Outros arquivos na pasta acima de `Partitions`:

- `accepted.json` — guarda o aceite da tela de aviso; apague-o para vê-la
  de novo.
- `credentials.json` — dados de login salvos pelo botão de chave de cada
  painel, criptografados pelo sistema (DPAPI no Windows, Keychain no macOS).
  Com eles salvos, o app preenche usuário e senha sozinho quando a tela de
  login abre — só a caixa "confirme que é humano" continua manual. Para
  remover, use "Apagar salvos" no próprio formulário ou apague o arquivo.
