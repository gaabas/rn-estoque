# AGENTS.md

Estas instruções valem para todo o repositório. Leia o [README](README.md) e a [especificação da primeira versão](docs/primeira-versao.md) antes de alterar um fluxo.

## Experiência da equipe

- Projete primeiro para os celulares pessoais da equipe. Depois da instalação assistida, a pessoa deve conseguir abrir a PWA pelo ícone e usar o fluxo sozinha. Mantenha o acesso por link.
- A cozinha tem duas ações principais: **Registrar quantidade** e **Pedir compra**. Preserve o caminho curto. Preencha a unidade pelo cadastro e deixe motivo, observação e quantidade sugerida opcionais, conforme a ação.
- Use rótulos claros em português, botões fáceis de tocar e feedback junto da ação. Só acrescente um passo quando ele resolver um problema observado na rotina.

## Regras do produto

- Uma contagem é uma observação datada. Mostre quando foi feita e diferencie **0** de **Sem contagem**. Ao corrigir, preserve o registro anterior, quem corrigiu e quando.
- A cozinha pode informar uma quantidade e pedir compra para o mesmo insumo. Mantenha no máximo um pedido aberto por insumo e permita complementar o pedido existente.
- **Marcar como comprado** encerra o pedido e registra a conclusão no histórico. A contagem continua vinculada à última conferência física.

## Resposta da interface

- Exiba a última lista carregada assim que possível e atualize em segundo plano. Sem conexão, sinalize que os dados podem estar desatualizados.
- Na versão conectada ao Supabase, permita seguir para outro item enquanto o registro é enviado. Exiba **Salvo** só após a confirmação. Em caso de falha, preserve o que foi digitado e permita tentar novamente sem duplicar o registro. A gravação da primeira versão exige conexão.

## Escopo e verificação

- Use React, TypeScript e Vite. O primeiro protótipo usa dados fictícios. A versão operacional usa o Supabase da operação da Rango e tem o Cloudflare Workers com Static Assets como hospedagem prevista. Integração com produção, entradas, importação de cupons e previsão ficam para etapas próprias.
- Faça mudanças pequenas e aproveite os componentes existentes. Traga ao responsável as decisões que alterem a rotina da equipe, as permissões ou o significado dos registros e explique a consequência em termos práticos.
- Ao mudar um fluxo, teste em largura de celular e execute as verificações disponíveis no projeto. Confira o caminho afetado em **Estoque**, **Compras** ou **Histórico**. Em mudanças de sincronização, verifique também falha de conexão e nova tentativa.

## Publicação

- Execute os testes relevantes e faça uma verificação prática da mudança antes de publicar. Para alterações na interface, abra a tela afetada e confira o fluxo em largura de celular.
- Com as verificações aprovadas, o responsável autoriza o envio direto à `main` como fluxo padrão. Abra um pull request quando o responsável pedir revisão ou prévia antes da publicação.
- Depois do push à `main`, confira o resultado do deploy no Cloudflare e, quando o endereço estiver acessível, verifique o comportamento publicado.
