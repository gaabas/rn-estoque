# Estoque · Rango in Natura

App web instalável (PWA) para a equipe da cozinha usar nos próprios celulares. A equipe registra a quantidade conferida de um insumo e avisa quem faz as compras quando precisa repor algo.

**Simplicidade é requisito do produto.** Registrar uma contagem ou pedir uma compra deve levar poucos segundos durante um turno. Antes de acrescentar um passo, valide qual problema da rotina ele resolve e teste a mudança no celular com a equipe.

## Fluxo inicial

- **Cozinha:** busca o insumo e toca em **Registrar quantidade** ou **Pedir compra**. As duas ações podem ser feitas para o mesmo item.
- **Compras:** consulta as pendências junto da última contagem, decide quanto levar e marca o item como comprado.
- **Histórico:** mostra as contagens, as correções e os pedidos de compra por insumo.

A primeira versão usa contagens pontuais. A data da última conferência acompanha a quantidade exibida.

## Desenvolvimento

O primeiro passo é um protótipo para celular com dados de exemplo. Para o app operacional, a base prevista é React, TypeScript e Vite, com hospedagem no Cloudflare Pages. O Supabase da operação da Rango deve armazenar os dados e identificar os usuários. A integração com produção vem depois do teste do fluxo básico.

Veja a [especificação da primeira versão](docs/primeira-versao.md).
