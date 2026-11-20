# Estoque · Rango in Natura

App web instalável (PWA) para a equipe da cozinha usar nos próprios celulares. A equipe registra a quantidade conferida de um insumo e avisa quem faz as compras quando precisa repor algo.

**Simplicidade é requisito do produto.** Registrar uma contagem ou pedir uma compra deve levar poucos segundos durante um turno. Antes de acrescentar um passo, valide qual problema da rotina ele resolve e teste a mudança no celular com a equipe.

## Fluxo inicial

- **Cozinha:** busca o insumo e toca em **Registrar quantidade** ou **Pedir compra**. As duas ações podem ser feitas para o mesmo item.
- **Compras:** consulta as pendências junto da última contagem, decide quanto levar e marca o item como comprado.
- **Histórico:** mostra as contagens, as correções e os pedidos de compra por insumo.

A primeira versão usa contagens pontuais. A data da última conferência acompanha a quantidade exibida.

## Desenvolvimento

O primeiro passo é um protótipo para celular com dados de exemplo. Para o app operacional, a base prevista é React, TypeScript e Vite, com hospedagem no Cloudflare Workers com Static Assets. O Supabase da operação da Rango deve armazenar os dados e identificar os usuários. A integração com produção vem depois do teste do fluxo básico.

Veja a [especificação da primeira versão](docs/primeira-versao.md).

### Rodar o protótipo

Use Node.js 22.12+ ou 24 LTS.

```sh
npm ci
npm run dev
```

O protótipo usa dados fictícios e grava os registros no armazenamento local do navegador. A versão de produção da prévia mantém a interface em cache depois do primeiro acesso. As ações da demonstração também funcionam offline e são salvas no aparelho. Essa gravação é independente da confirmação do Supabase prevista para o app operacional.

```sh
npm run build
npm run preview
```

O build gera `dist/` com a interface, o manifesto, os ícones e o service worker. A instalação da PWA usa HTTPS fora de localhost. O Worker `rn-estoque` publica os arquivos estáticos dessa pasta.

### Testar

```sh
npx playwright install chromium
npm test
```

Os testes usam a saída de produção e um perfil de celular. Se já houver Chromium no sistema, é possível indicar seu caminho em `PLAYWRIGHT_CHROMIUM_EXECUTABLE`.
