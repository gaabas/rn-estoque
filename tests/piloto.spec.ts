import { expect, test } from '@playwright/test'

test('abre o catálogo, continua durante o envio e recupera confirmação perdida', async ({ page, browser }) => {
  const other = await browser.newContext()
  const desktop = await other.newPage()
  const entries: Array<Record<string, unknown>> = []
  const url = 'http://127.0.0.1:4173/piloto.html'
  const items = [
    { id: 'arroz-branco', name: 'Arroz branco', group: 'Despensa', unit: 'kg', fractional: true },
    { id: 'creme-de-leite', name: 'Creme de leite', group: 'Laticínios', unit: 'caixas', fractional: false },
  ]
  let release = () => {}
  const firstResponse = new Promise<void>(resolve => { release = resolve })
  let lostConfirmation = false
  for (const client of [page, desktop]) {
    await client.route('https://hblveamovkpbxcmscpkf.supabase.co/**', async route => {
      const path = new URL(route.request().url()).pathname
      if (path === '/auth/v1/token') {
        const claims = Buffer.from(JSON.stringify({ exp: Math.floor(Date.now() / 1000) + 3600 })).toString('base64url')
        await route.fulfill({ json: { access_token: 'eyJhbGciOiJIUzI1NiJ9.' + claims + '.c2ln', token_type: 'bearer',
          refresh_token: 'test-refresh', expires_in: 3600, user: { id: 'test-user', email: 'teste@example.test' } } })
        return
      }
      if (path !== '/rest/v1/rpc/rn_estoque_operacao') {
        await route.fulfill({ status: 404 })
        return
      }
      const { change, request_id: id } = route.request().postDataJSON()
      if (change && !entries.some(entry => entry.id === id)) {
        entries.push({ ...change, id, at: '2026-11-21T12:00:00Z', author: 'Gabriel' })
      }
      if (change?.type === 'count' && !lostConfirmation) {
        lostConfirmation = true
        await firstResponse
        await route.fulfill({ status: 503, json: { message: 'Indisponível' } })
        return
      }
      await route.fulfill({ json: { items, entries, canClose: true, name: 'Gabriel', revision: entries.length } })
    })
  }
  async function login(client: typeof page) {
    await client.goto(url)
    await client.getByLabel('E-mail').fill('teste@example.test')
    await client.getByLabel('Senha').fill('teste-apenas')
    await client.getByRole('button', { name: 'Entrar' }).click()
  }
  try {
    await login(page)
    const cream = page.locator('.stock-row').filter({ hasText: 'Creme de leite' })
    await expect(cream).toContainText('Sem contagem')
    await cream.click()
    await page.getByRole('button', { name: 'Registrar quantidade' }).click()
    await page.getByLabel('Quantidade conferida').fill('8')
    await page.getByRole('button', { name: 'Salvar contagem' }).click()
    await expect(page.getByRole('dialog')).toContainText('Enviando…')
    await expect(page.getByRole('dialog')).toContainText('8 caixas')
    await page.getByRole('button', { name: 'Fechar painel' }).click()
    await page.getByRole('button', { name: /Arroz branco/ }).click()
    release()
    await page.getByRole('button', { name: 'Fechar painel' }).click()
    await expect(cream).toContainText('Sem contagem')
    await page.getByRole('button', { name: /Tentar de novo.*Creme de leite/ }).click()
    await expect(cream).toContainText('8 caixas')
    await expect(cream).toContainText('Salvo')
    expect(entries.filter(entry => entry.type === 'count')).toHaveLength(1)

    await cream.click()
    await page.getByRole('button', { name: 'Pedir compra' }).click()
    await expect(page.getByRole('dialog')).toContainText('Salvo')
    await login(desktop)
    await desktop.getByRole('button', { name: /^Compras/ }).click()
    await expect(desktop.getByText('8 caixas')).toBeVisible()
    await desktop.getByRole('button', { name: 'Marcar como comprado' }).click()
    await expect(desktop.getByText('Nenhuma compra pendente.')).toBeVisible()
    await expect(desktop.getByText('Salvo', { exact: true })).toBeVisible()
    const entry = entries.find(record => record.type === 'count')
    expect(entry).toMatchObject({ quantity: 8, at: '2026-11-21T12:00:00Z' })
    await page.waitForFunction(() => Boolean(navigator.serviceWorker.controller))
    await page.context().setOffline(true)
    await page.reload()
    await expect(page.getByText(/Sem conexão/)).toBeVisible()
    await expect(cream).toContainText('8 caixas')
  } finally {
    release()
    await other.close()
  }
})
