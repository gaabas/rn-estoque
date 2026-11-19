# Primeira versão do estoque

## Acesso e conexão

A equipe usa o app nos próprios celulares. A primeira configuração pode ser acompanhada, deixando o ícone da PWA na tela inicial. O acesso por link também fica disponível. O uso diário deve funcionar sem orientação técnica.

A interface e a última lista carregada ficam disponíveis no aparelho após o primeiro acesso. Ao reabrir, o app mostra a lista disponível e busca contagens e pedidos atualizados em segundo plano. Sem conexão, indica que os dados exibidos podem estar desatualizados.

Ao registrar uma contagem ou pedir uma compra, o app atualiza a tela imediatamente e permite seguir para o próximo item. **Salvo** aparece quando o Supabase confirma. Se o envio falhar, o app mantém o que foi digitado e oferece **Tentar de novo**. A gravação exige conexão. Uma fila de envio automático pode ser avaliada após o piloto.

## Uso na cozinha

A tela inicial abre na lista de insumos. Os mais usados ficam à mão, e a busca encontra os demais. Cada insumo mostra a última contagem com data e hora e indica se há compra pendente.

- **Registrar quantidade.** Digitar o total conferido e salvar. A unidade vem do cadastro. Zero significa que alguém conferiu e encontrou o item zerado. Quando ainda não houver registro, mostrar **Sem contagem**.
- **Pedir compra.** Um toque abre o pedido. Motivo e quantidade sugerida podem ser acrescentados depois. Um insumo pode ter uma contagem recente e uma compra pendente ao mesmo tempo.
- **Compra já pendente.** Mostrar o pedido aberto e permitir complementar o contexto. Cada insumo tem no máximo um pedido aberto.
- **Confirmar e corrigir.** Mostrar quando a ação for salva e oferecer **Desfazer** para o registro acidental. Permitir corrigir um erro identificado, preservando no histórico o valor anterior, o autor e o horário da correção. O motivo é opcional.

A conferência pode acontecer antes de montar a lista de compras. A equipe registra os itens que efetivamente conferiu e pode pedir reposição durante o turno. Combine a unidade e os locais de conferência por insumo. Para creme de leite, por exemplo, conte as caixas fechadas na despensa e na geladeira e registre em observação uma embalagem aberta quando ela fizer diferença para a compra.

## Uso em compras

Em **Compras**, quem compra vê os pedidos pendentes, a última contagem com data e hora e, quando preenchidos, o motivo e a quantidade sugerida. Exemplo: a cozinha contou 8 caixas de creme de leite e pediu mais porque há muito estrogonofe previsto para amanhã.

Quem compra decide a quantidade e toca em **Marcar como comprado** quando concluir a compra. O pedido sai das pendências e fica no histórico com os horários de abertura e conclusão. A compra preserva a última contagem e sua data original. O que ficar para outra ida ao mercado continua pendente.

## Dados e evolução

- **Insumos.** Cada um tem ID próprio, nome e unidade padrão.
- **Contagens.** Cada registro aponta para um insumo e guarda quantidade, unidade, data, autor e observação opcional. Uma nova contagem acrescenta uma observação ao histórico. A diferença entre duas contagens, por si só, não determina o consumo.
- **Pedidos de compra.** Cada pedido aponta para um insumo e guarda a abertura, quem solicitou, os dados opcionais e o encerramento da compra.

O protótipo usa dados de exemplo. A versão operacional deve usar o mesmo projeto Supabase da produção, com acesso adequado às funções da equipe. O app grava contagens e pedidos no Supabase. O n8n fica previsto para automações futuras.

Com entradas registradas e fichas técnicas ligadas aos IDs dos insumos, será possível estimar a necessidade da produção em aberto e comparar o saldo esperado com a próxima contagem física. Recebimento, importação de cupons e previsão fazem parte dessa evolução.

## Teste inicial

Começar com cerca de 10 insumos frequentes e observar uma semana de uso real após a implantação operacional. Antes disso, testar o protótipo nos celulares pessoais com a equipe. Após a configuração inicial, cada pessoa deve conseguir reabrir o app pelo ícone e seguir o fluxo sem ajuda.

1. Uma pessoa da cozinha encontra o creme de leite, registra quanto tem e pede compra sem orientação.
2. Outra pessoa encontra o mesmo item, vê que já há um pedido e consegue acrescentar contexto.
3. Quem compra decide o que levar pela lista e encerra a compra. A pendência sai da lista e o histórico continua consultável.
4. Uma contagem de zero e um item sem contagem aparecem como situações distintas. Uma correção mantém o registro anterior acessível.
5. Ao fim do piloto, revisar o que faltou, o que precisou de confirmação fora do app e onde houve atrito para registrar.
