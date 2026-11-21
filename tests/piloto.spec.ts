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
  let reads = 0
  for (const client of [page, desktop]) {
    await client.route('https://hblveamovkpbxcmscpkf.supabase.co/**', async route => {
      const path = new URL(route.request().url()).pathname
      if (path === '/auth/v1/token') {
        const claims = Buffer.from(JSON.stringify({ exp: Math.floor(Date.now() / 1000) + 3600 })).toString('base64url')
        await route.fulfill({ json: { access_token: 'eyJhbGciOiJIUzI1NiJ9.' + claims + '.c2ln', token_type: 'bearer',
          refresh_token: 'test-refresh', expires_in: 3600, user: { id: 'test-user', email: 'teste@example.test' } } })
        return
      }
      if (path === '/rest/v1/rpc/rn_estoque_cozinha_gerar_convite') {
        expect(route.request().postDataJSON()).toEqual({ name: 'Cozinha Teste' })
        await route.fulfill({ json: { token: 'a'.repeat(64) } })
        return
      }
      if (path !== '/rest/v1/rpc/rn_estoque_operacao') {
        await route.fulfill({ status: 404 })
        return
      }
      const { change, request_id: id } = route.request().postDataJSON()
      if (!change) reads++
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
    await client.getByRole('button', { name: 'Acesso do Gabriel' }).click()
    await client.getByLabel('E-mail').fill('teste@example.test')
    await client.getByLabel('Senha').fill('teste-apenas')
    await client.getByRole('button', { name: 'Entrar' }).click()
  }
  try {
    await login(page)
    const cream = page.locator('.stock-row').filter({ hasText: 'Creme de leite' })
    await expect(cream).toContainText('Sem contagem')
    const header = page.getByRole('banner')
    const previousReads = reads
    const refresh = header.getByRole('button', { name: 'Atualizar lista' })
    await refresh.click()
    const rotation = await refresh.locator('svg').evaluate(icon => {
      const animation = icon.getAnimations()[0]
      const frames = (animation?.effect as KeyframeEffect | undefined)?.getKeyframes()
      return { duration: animation?.effect?.getTiming().duration, final: frames?.at(-1)?.transform }
    })
    expect(rotation).toEqual({ duration: 500, final: 'rotate(360deg)' })
    await expect(refresh).toBeEnabled()
    await expect.poll(() => reads).toBeGreaterThan(previousReads)
    await expect(page.getByText('Acessos da cozinha')).not.toBeVisible()
    await header.getByRole('button', { name: 'Configurações' }).click()
    const settings = page.getByRole('dialog', { name: 'Configurações' })
    await expect(settings).toHaveCSS('animation-name', 'sheet-enter')
    await settings.getByText('Acessos da cozinha').click()
    await page.getByLabel('Nome da pessoa').fill('Cozinha Teste')
    await page.getByRole('button', { name: 'Gerar link de acesso' }).click()
    await expect(page.getByLabel('Link de acesso')).toHaveValue(url + '#convite=' + 'a'.repeat(64))
    await settings.getByRole('button', { name: 'Fechar painel' }).click()
    await cream.click()
    const dialog = page.getByRole('dialog')
    await expect(dialog).toHaveCSS('animation-name', 'sheet-enter')
    const quantity = page.getByLabel('Quantidade conferida')
    await expect(quantity).toBeVisible()
    await expect(page.getByRole('textbox', { name: 'Observação' })).not.toBeVisible()
    await page.getByRole('button', { name: 'Aumentar quantidade' }).click()
    await expect(quantity).toHaveValue('1')
    await page.getByRole('button', { name: 'Diminuir quantidade' }).click()
    await expect(quantity).toHaveValue('0')
    await expect(page.getByRole('button', { name: 'Diminuir quantidade' })).toBeDisabled()
    await quantity.fill('8')
    await dialog.locator('summary').getByText('Observação').click()
    await page.getByRole('textbox', { name: 'Observação' }).fill('Caixas fechadas')
    await page.getByRole('button', { name: 'Salvar contagem' }).click()
    await expect(page.getByRole('dialog')).toContainText('Enviando…')
    await expect(page.getByRole('dialog')).toContainText('8 caixas')
    await page.getByRole('button', { name: 'Fechar painel' }).click()
    await page.getByRole('button', { name: /Arroz branco/ }).click()
    await page.getByRole('button', { name: 'Aumentar quantidade' }).click()
    await expect(quantity).toHaveValue('0,25')
    await quantity.fill('1,1')
    await page.getByRole('button', { name: 'Aumentar quantidade' }).click()
    await expect(quantity).toHaveValue('1,35')
    await page.getByRole('button', { name: 'Diminuir quantidade' }).click()
    await expect(quantity).toHaveValue('1,1')
    release()
    await page.getByRole('button', { name: 'Fechar painel' }).click()
    await expect(cream).toContainText('Sem contagem')
    await page.getByRole('button', { name: /Tentar de novo.*Creme de leite/ }).click()
    await expect(cream).toContainText('8 caixas')
    await expect(cream).toContainText('Salvo')
    expect(await cream.evaluate(row => {
      const effect = row.getAnimations()[0]?.effect as KeyframeEffect | undefined
      return effect?.getKeyframes().map(frame => frame.backgroundColor)
    })).toEqual(['rgb(230, 240, 223)', 'transparent'])
    await expect(cream).toHaveCSS('background-color', 'rgba(0, 0, 0, 0)')
    await expect(cream).toContainText('Salvo')
    expect(entries.filter(entry => entry.type === 'count')).toHaveLength(1)

    await cream.click()
    const undo = dialog.getByRole('button', { name: 'Desfazer' })
    await expect(undo).toBeVisible()
    expect(await undo.evaluate(button => {
      const outer = button.parentElement!.getBoundingClientRect()
      const inner = button.getBoundingClientRect()
      return Math.min(outer.right - inner.right, outer.bottom - inner.bottom)
    })).toBeGreaterThanOrEqual(8)
    await page.getByRole('button', { name: 'Pedir compra' }).click()
    await expect(page.getByRole('dialog')).toContainText('Salvo')
    await login(desktop)
    await desktop.getByRole('button', { name: /^Compras/ }).click()
    await expect(desktop.getByText('8 caixas')).toBeVisible()
    await desktop.getByRole('button', { name: 'Marcar como comprado' }).click()
    await expect(desktop.getByText('Nenhuma compra pendente.')).toBeVisible()
    await expect(desktop.getByText('Salvo', { exact: true })).toBeVisible()
    const entry = entries.find(record => record.type === 'count')
    expect(entry).toMatchObject({ quantity: 8, note: 'Caixas fechadas', at: '2026-11-21T12:00:00Z' })
    await page.waitForFunction(() => Boolean(navigator.serviceWorker.controller))
    await page.context().setOffline(true)
    await page.reload()
    await expect(page.getByText(/Sem conexão/)).toBeVisible()
    await expect(cream).toContainText('8 caixas')
    await page.emulateMedia({ reducedMotion: 'reduce' })
    await cream.click()
    await expect(page.getByRole('dialog')).toHaveCSS('animation-name', 'none')
  } finally {
    release()
    await other.close()
  }
})
