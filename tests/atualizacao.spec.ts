import { createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { createServer } from 'node:http'
import { expect, test } from '@playwright/test'

test('troca de publicação com a PWA aberta e preserva registros offline', async ({ page, context }) => {
  const html = await readFile('dist/index.html', 'utf8')
  const worker = await readFile('dist/sw.js', 'utf8')
  const scriptPath = new URL(html.match(/src="(\/assets\/[^"]+\.js)"/)![1], 'http://localhost').pathname
  const script = await readFile('dist' + scriptPath, 'utf8')
  const nextScript = script + '\n// Nova publicação'
  const nextScriptPath = scriptPath.replace('.js', '-next.js')
  const nextHtml = html.replace('</title>', ' · Nova versão</title>').replace(scriptPath, nextScriptPath)
  const integrity = (body: string) => 'sha256-' + createHash('sha256').update(body).digest('base64')
  let published = false
  const server = createServer(async (request, response) => {
    const path = new URL(request.url!, 'http://localhost').pathname
    try {
      if (path === '/index.html') {
        response.writeHead(307, { Location: '/' }).end()
      } else if (path === '/') {
        response.setHeader('Content-Type', 'text/html')
        response.end(published ? nextHtml : html)
      } else if (path === '/sw.js') {
        response.setHeader('Content-Type', 'application/javascript')
        response.end(published ? worker.replace(/rn-estoque-[a-f0-9]{64}/, 'rn-estoque-next')
          .replace(integrity(html), integrity(nextHtml))
          .replace(scriptPath, nextScriptPath)
          .replace(integrity(script), integrity(nextScript)) : worker)
      } else if (path === nextScriptPath && published) {
        response.setHeader('Content-Type', 'application/javascript')
        response.end(nextScript)
      } else {
        if (path.endsWith('.js')) response.setHeader('Content-Type', 'application/javascript')
        if (path.endsWith('.css')) response.setHeader('Content-Type', 'text/css')
        response.end(await readFile(path === '/piloto' ? 'dist/piloto.html' : 'dist' + path))
      }
    } catch {
      response.writeHead(404).end()
    }
  })
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  const address = server.address()
  if (!address || typeof address === 'string') throw new Error('Servidor de teste indisponível')
  const url = 'http://127.0.0.1:' + address.port

  try {
    await page.goto(url)
    await page.waitForFunction(() => Boolean(navigator.serviceWorker.controller))
    const item = page.getByRole('button', { name: /Creme de leite/ })
    await item.click()
    await page.getByRole('button', { name: 'Registrar quantidade' }).click()
    const quantity = page.getByLabel('Quantidade conferida')
    await quantity.fill('8')

    published = true
    await page.evaluate(async () => (await navigator.serviceWorker.ready).update().then(() => undefined))
    await page.waitForFunction(async () => Boolean((await navigator.serviceWorker.getRegistration())?.waiting))
    await expect(quantity).toHaveValue('8')
    await expect(page).not.toHaveTitle(/Nova versão/)
    const reopened = await context.newPage()
    await reopened.goto(url)
    await expect(reopened).toHaveTitle(/Nova versão/)
    await expect(reopened.getByRole('searchbox')).toBeVisible()
    await reopened.close()
    await page.getByRole('button', { name: 'Salvar contagem' }).click()
    await page.getByRole('button', { name: 'Fechar painel' }).click()
    await page.getByRole('button', { name: 'Atualizar agora' }).click()
    await expect(page).toHaveTitle(/Nova versão/)
    await expect(item).toContainText('8 caixas')

    await context.setOffline(true)
    await page.reload()
    await expect(page).toHaveTitle(/Nova versão/)
    await expect(item).toContainText('8 caixas')
  } finally {
    server.closeAllConnections()
    await new Promise<void>(resolve => server.close(() => resolve()))
  }
})
