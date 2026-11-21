# Primeira prévia conectada do Estoque

1. Criar o schema estoque no rango-dev com um insumo de demonstração, associação por ID do Auth e registros auditáveis. Expor apenas a função de leitura e gravação, com autorização explícita.
2. Preparar a tela de prévia com login, registro de contagem, pedido, conclusão e histórico. Recarregar os dados ao voltar ao app e permitir nova tentativa usando o mesmo ID da operação.
3. Verificar acesso sem associação, repetição da operação, uma única compra aberta e preservação da contagem após a conclusão.
4. Testar duas sessões isoladas com Playwright. Publicar em uma branch de prévia e conferir a URL do Cloudflare.
