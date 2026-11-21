import { expect, test } from '@playwright/test'

test('compartilha a contagem e a compra entre duas sessões', async ({ page, browser }) => {
  const other = await browser.newContext()
  const desktop = await other.newPage()
  const itemId = '00000000-0000-4000-8000-000000000001'
  const owner = '00000000-0000-4000-8000-000000000002'
  const history: Array<{ id: string, action: string, at: string, quantity: number | null }> = []
  let lostConfirmation = false
  const url = 'http://127.0.0.1:4173/piloto.html'
  for (const client of [page, desktop]) {
    await client.route('https://hblveamovkpbxcmscpkf.supabase.co/**', async route => {
      const path = new URL(route.request().url()).pathname
      if (path === '/auth/v1/token') {
        const claims = Buffer.from(JSON.stringify({ exp: Math.floor(Date.now() / 1000) + 3600 })).toString('base64url')
        await route.fulfill({ json: { access_token: 'eyJhbGciOiJIUzI1NiJ9.' + claims + '.c2ln', token_type: 'bearer',
          refresh_token: 'test-refresh', expires_in: 3600, user: { id: owner, email: 'teste@example.test' } } })
        return
      }
      if (path === '/rest/v1/rpc/rn_estoque_piloto') {
        const input = route.request().postDataJSON()
        if (input.operation !== 'read' && !history.some(record => record.id === input.request_id)) {
          history.unshift({ id: input.request_id, action: input.operation, at: '2026-11-21T12:00:00Z', quantity: input.amount })
        }
        if (input.operation === 'count' && !lostConfirmation) {
          lostConfirmation = true
          await route.fulfill({ status: 503, json: { message: 'Indisponível' } })
          return
        }
        await route.fulfill({ json: {
          item_name: 'Creme de leite', unit: 'caixas', item_id: itemId,
          count: history.find(record => record.action === 'count') ?? null,
          pending_id: history.find(record => record.action !== 'count')?.action === 'open'
            ? history.find(record => record.action === 'open')?.id : null,
          history,
        } })
        return
      }
      await route.fulfill({ status: 404 })
    })
  }
  try {
    await page.goto(url)
    await page.getByLabel('E-mail').fill('teste@example.test')
    await page.getByLabel('Senha').fill('teste-apenas')
    await page.getByRole('button', { name: 'Entrar' }).click()
    await page.getByLabel('Quantidade conferida').fill('8')
    await page.getByRole('button', { name: 'Registrar quantidade' }).click()
    await expect(page.getByLabel('Quantidade conferida')).toHaveValue('8')
    await expect(page.getByText('Salvo', { exact: true })).toHaveCount(0)
    await page.getByRole('button', { name: 'Tentar de novo' }).click()
    await expect(page.getByText('Salvo', { exact: true })).toBeVisible()
    expect(history.filter(record => record.action === 'count')).toHaveLength(1)
    await page.getByRole('button', { name: 'Pedir compra' }).click()

    await desktop.goto(url)
    await desktop.getByLabel('E-mail').fill('teste@example.test')
    await desktop.getByLabel('Senha').fill('teste-apenas')
    await desktop.getByRole('button', { name: 'Entrar' }).click()
    await expect(desktop.getByText('Última contagem: 8 caixas')).toBeVisible()
    await desktop.getByRole('button', { name: 'Marcar como comprado' }).click()
    await page.getByRole('button', { name: 'Atualizar lista' }).click()
    await expect(page.getByText('Compra concluída')).toBeVisible()
    await expect(page.getByText('Última contagem: 8 caixas')).toBeVisible()
  } finally {
    await other.close()
  }
})
