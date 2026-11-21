import { expect, test } from '@playwright/test'

test('ativa pelo link, volta com nome e PIN e registra a primeira contagem', async ({ page }) => {
  const secret = 'a'.repeat(64)
  let activated = false
  const session = { id: 'kitchen-1', token: 'b'.repeat(64) }
  const entries: unknown[] = []
  await page.route('https://hblveamovkpbxcmscpkf.supabase.co/rest/v1/rpc/**', async route => {
    const url = new URL(route.request().url())
    const data = route.request().postDataJSON()
    switch (url.pathname.split('/').at(-1)) {
      case 'rn_estoque_cozinha_convite':
        await route.fulfill({ json: { name: 'Cozinha Teste' } })
        break
      case 'rn_estoque_cozinha_ativar':
        expect(data).toEqual({ token: secret, pin: '924608' })
        activated = true
        await route.fulfill({ json: session })
        break
      case 'rn_estoque_cozinha_entrar':
        expect(data).toEqual({ username: 'Cozinha Teste', pin: '924608' })
        expect(activated).toBe(true)
        await route.fulfill({ json: session })
        break
      case 'rn_estoque_cozinha_sair':
        await route.fulfill({ json: null })
        break
      case 'rn_estoque_cozinha_operacao':
        expect(data.session_token).toBe(session.token)
        if (data.change) entries.push({ ...data.change, id: data.request_id, author: 'Cozinha Teste', at: '2026-11-21T12:00:00Z' })
        await route.fulfill({ json: {
          canClose: false, name: 'Cozinha Teste', revision: entries.length, entries,
          items: [{ id: 'ovo', name: 'Ovo', group: 'Proteínas', unit: 'unidades', fractional: false }],
        } })
        break
      default:
        await route.fulfill({ status: 404 })
    }
  })

  await page.goto('/piloto.html#convite=' + secret)
  await expect(page.getByRole('heading', { name: 'Cozinha Teste' })).toBeVisible()
  await page.getByLabel('Escolha seu PIN').fill('924608')
  await page.getByLabel('Repita seu PIN').fill('924608')
  await page.getByRole('button', { name: 'Começar' }).click()
  await expect(page).not.toHaveURL(/#convite/)
  const item = page.locator('.stock-row').filter({ hasText: 'Ovo' })
  await item.click()
  await page.getByRole('button', { name: 'Aumentar quantidade' }).click()
  await page.getByRole('button', { name: 'Salvar contagem' }).click()
  await expect(page.getByRole('dialog')).toHaveCount(0)
  await expect(item).toContainText('Salvo')
  await item.click()
  await page.getByRole('button', { name: 'Pedir compra' }).click()
  await expect(page.getByRole('button', { name: 'Complementar pedido' })).toBeVisible()
  await page.getByRole('button', { name: 'Fechar painel' }).click()
  await page.getByRole('button', { name: /^Compras/ }).click()
  await expect(page.getByRole('button', { name: 'Marcar como comprado' })).toHaveCount(0)

  await page.reload()
  await expect(item).toContainText('1 unidades')
  const manifest = await page.request.get('/manifest-piloto.webmanifest')
  expect((await manifest.json()).start_url).toBe('/piloto')
  await page.getByRole('button', { name: 'Configurações' }).click()
  const settings = page.getByRole('dialog', { name: 'Configurações' })
  await expect(settings.getByText('Cozinha Teste')).toBeVisible()
  await expect(settings.getByText('Acessos da cozinha')).toHaveCount(0)
  await expect(settings.getByRole('button', { name: 'Zerar conferências' })).toHaveCount(0)
  await settings.getByRole('button', { name: 'Sair', exact: true }).click()
  await page.getByLabel('Nome').fill('Cozinha Teste')
  await page.getByLabel('PIN', { exact: true }).fill('924608')
  await page.getByRole('button', { name: 'Entrar', exact: true }).click()
  await expect(item).toContainText('1 unidades')
})
