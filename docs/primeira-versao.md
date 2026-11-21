# Primeira versão do estoque

## Quem usa o app

A equipe da cozinha confere as quantidades físicas, pede reposição e complementa pedidos já abertos. Gabriel é o único responsável pelas compras nesta primeira versão. Ele consulta as pendências, decide o que e quanto comprar e encerra cada pedido quando a compra estiver concluída. A cozinha registra a necessidade de reposição e Gabriel confirma a compra.

No ensaio técnico, a mesma conta foi usada em sessões separadas para validar o compartilhamento pelo Supabase. Na semana de uso real, as ações devem ficar vinculadas à pessoa que as fez. O acesso para concluir compras é reservado a Gabriel.

## Acesso e conexão

A equipe usa o app nos próprios celulares. A primeira configuração pode ser acompanhada, deixando o ícone da PWA na tela inicial. O acesso por link também fica disponível. O uso diário deve funcionar sem orientação técnica.

A interface e a última lista carregada ficam disponíveis no aparelho após o primeiro acesso. Ao reabrir, o app mostra a lista disponível e busca contagens e pedidos atualizados em segundo plano. Sem conexão, indica que os dados exibidos podem estar desatualizados.

### Acesso da cozinha

O acesso diário precisa ser simples para uma equipe com pouca familiaridade com tecnologia. Cada pessoa da cozinha usa seu nome e um PIN individual. O login da cozinha dispensa e-mail. A sessão deve permanecer aberta no celular de uso habitual para que, depois da configuração inicial, a pessoa possa entrar pelo ícone e ir direto ao estoque.

A proposta para o primeiro acesso é Gabriel entregar a cada pessoa um link individual, de uso único, com o nome já preenchido. A pessoa escolhe um PIN de seis dígitos no próprio celular, com ajuda de Gabriel se precisar. Depois, se for necessário entrar novamente, usa nome e PIN. Se esquecer o PIN, Gabriel pode liberar um novo link. O PIN é digitado no app. O WhatsApp pode ser usado para compartilhar o link.

O app limita tentativas de PIN e mantém cada registro associado à pessoa que fez a ação. As permissões da cozinha continuam restritas a contagens e pedidos de reposição. Gabriel usa seu acesso atual para concluir compras.

### Atualização otimista

Toda ação que altera contagens ou pedidos deve aparecer imediatamente na tela, incluindo registrar, corrigir ou desfazer uma contagem, abrir ou complementar um pedido e marcar como comprado. O envio roda em segundo plano e a pessoa pode seguir para outro insumo.

- **Enviando…** O item já reflete a ação e sinaliza que ela aguarda confirmação.
- **Salvo.** Aparece somente quando o Supabase confirma. O estado confirmado passa a ser a referência para as próximas ações.
- **Falha no envio.** O item volta ao último estado confirmado. O app preserva o que foi digitado e mostra **Tentar de novo** junto ao item, inclusive se a pessoa já tiver seguido para outro. A nova tentativa usa o mesmo identificador para que uma confirmação perdida na rede não gere um registro duplicado.
- **Pedido já aberto por outra pessoa.** A interface mostra o pedido existente e oferece **Complementar pedido**. Cada insumo pode ter no máximo um pedido aberto.

Por exemplo, a cozinha muda uma contagem de 3 para 8 caixas e já vê 8 com **Enviando…**. Se o envio falhar, volta a ver 3 e pode reenviar o 8 sem digitar de novo. A gravação exige conexão. Uma fila de envio automático pode ser avaliada após o piloto.

## Uso na cozinha

A tela inicial abre na lista de insumos. Os mais usados ficam à mão, e a busca encontra os demais. Cada insumo mostra a última contagem com data e hora e indica se há compra pendente.

- **Registrar quantidade.** Digitar o total conferido e salvar. A unidade vem do cadastro. Zero significa que alguém conferiu e encontrou o item zerado. Quando ainda não houver registro, mostrar **Sem contagem**.
- **Pedir compra.** Um toque abre o pedido. Motivo e quantidade sugerida podem ser acrescentados depois. Um insumo pode ter uma contagem recente e uma compra pendente ao mesmo tempo.
- **Compra já pendente.** Mostrar o pedido aberto e permitir complementar o contexto. Cada insumo tem no máximo um pedido aberto.
- **Confirmar e corrigir.** Mostrar quando a ação for salva e oferecer **Desfazer** para o registro acidental. Permitir corrigir um erro identificado, preservando no histórico o valor anterior, o autor e o horário da correção. O motivo é opcional.

A conferência pode acontecer antes de montar a lista de compras. A equipe registra os itens que efetivamente conferiu e pode pedir reposição durante o turno. Combine a unidade e os locais de conferência por insumo. Para creme de leite, por exemplo, conte as caixas fechadas na despensa e na geladeira e registre em observação uma embalagem aberta quando ela fizer diferença para a compra.

## Uso em compras

Em **Compras**, Gabriel vê os pedidos pendentes, a última contagem com data e hora e, quando preenchidos, o motivo e a quantidade sugerida. Exemplo: a cozinha contou 8 caixas de creme de leite e pediu mais porque há muito estrogonofe previsto para amanhã.

Gabriel decide a quantidade e toca em **Marcar como comprado** quando concluir a compra. O pedido sai das pendências e fica no histórico com os horários de abertura e conclusão. A compra preserva a última contagem e sua data original. Se a compra for parcial ou ficar para outra ida, Gabriel pode manter o pedido aberto. Uma contagem antiga continua visível com a data e a hora da conferência para ele decidir se precisa pedir uma nova.

## Dados e evolução

- **Insumos.** Cada um tem ID próprio, nome e unidade padrão.
- **Contagens.** Cada registro aponta para um insumo e guarda quantidade, unidade, data, autor e observação opcional. Uma nova contagem acrescenta uma observação ao histórico. A diferença entre duas contagens, por si só, não determina o consumo.
- **Pedidos de compra.** Cada pedido aponta para um insumo e guarda a abertura, quem solicitou, os dados opcionais e o encerramento da compra.

O protótipo usa dados de exemplo. A versão operacional deve usar o mesmo projeto Supabase da produção, com acesso adequado às funções da equipe. O app grava contagens e pedidos no Supabase. O n8n fica previsto para automações futuras.

Com entradas registradas e fichas técnicas ligadas aos IDs dos insumos, será possível estimar a necessidade da produção em aberto e comparar o saldo esperado com a próxima contagem física. Recebimento, importação de cupons e previsão fazem parte dessa evolução.

## Catálogo da primeira semana

Os 12 insumos começam como **Sem contagem**. A equipe preenche a primeira quantidade à medida que confere cada item. As unidades abaixo são propostas para confirmar com a cozinha antes da semana de uso real.

| Insumo | Unidade proposta |
| --- | --- |
| Arroz branco | kg |
| Arroz integral | kg |
| Seleta | kg |
| Carne de panela | kg |
| Carne de tiras | kg |
| Carne moída | kg |
| Frango | kg |
| Ovo | unidades |
| Camarão | kg |
| Cuscuz | kg |
| Creme de leite | caixas |
| Manteiga | kg |

Combinar o que entra na contagem e onde conferir cada item. Por exemplo, definir se as carnes são pesadas cruas ou já preparadas e se a manteiga será contada por peso ou por embalagem.

## Teste inicial

Começar com os 12 insumos do catálogo e observar uma semana de uso real. Antes disso, conferir a versão conectada nos celulares da cozinha e no aparelho de Gabriel. Após a configuração inicial, cada pessoa deve conseguir reabrir o app pelo ícone e seguir o fluxo sem ajuda.

1. Uma pessoa da cozinha encontra o creme de leite, registra quanto tem e pede compra sem orientação.
2. Outra pessoa encontra o mesmo item, vê que já há um pedido e consegue acrescentar contexto.
3. Gabriel decide o que levar pela lista e encerra a compra. A pendência sai da lista e o histórico continua consultável.
4. Uma contagem de zero e um item sem contagem aparecem como situações distintas. Uma correção mantém o registro anterior acessível.
5. Com conexão instável, a tela responde de imediato, preserva o que foi digitado em caso de falha e confirma o reenvio sem criar duplicidade.
6. Ao fim da semana, revisar quais pedidos Gabriel resolveu com a informação do app, quais precisaram de confirmação por fora e onde a cozinha teve dificuldade para registrar.
