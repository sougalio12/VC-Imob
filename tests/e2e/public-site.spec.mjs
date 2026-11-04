import {test,expect,catalog} from './fixtures.mjs';

const cards=page=>page.locator('#propertiesGrid .property-card');
test('home loads its navigation and controlled catalog',async({page,controlledSite})=>{
  await page.goto('/');
  await expect(page.locator('header').first()).toBeVisible();
  await expect(cards(page)).toHaveCount(2);
  await expect(cards(page).first()).toContainText(catalog[0].titulo);
  await expect.poll(()=>controlledSite.rpcCalls.length).toBe(1);
  const dimensions=await page.evaluate(()=>({width:innerWidth,document:document.documentElement.scrollWidth}));
  expect(dimensions.document).toBeLessThanOrEqual(dimensions.width+1);
});
test('catalog filters controlled properties by type',async({page})=>{
  await page.goto('/');await expect(cards(page)).toHaveCount(2);
  await page.locator('#searchType').selectOption('apartamento');await page.locator('#searchButton').click();
  await expect(cards(page)).toHaveCount(1);await expect(cards(page)).toContainText(catalog[1].titulo);
});
test('property page opens from a catalog card and displays fixture facts',async({page})=>{
  await page.goto('/');await expect(cards(page)).toHaveCount(2);
  await cards(page).first().getByRole('link',{name:'Ver imóvel',exact:true}).click();
  await expect(page).toHaveURL(/imovel\.html\?codigo=VCI990001/);
  await expect(page.getByRole('heading',{level:1})).toHaveText(catalog[0].titulo);
  await expect(page.locator('.property-detail-code')).toContainText('VCI990001');
  await expect(page.locator('.property-description')).toHaveText(catalog[0].descricao);
  await expect(page.locator('#galleryMainImage')).toBeVisible();
});
test('interest modal validates input, captures only fixtures and resets on reopen',async({page,controlledSite})=>{
  await page.goto('/');await expect(cards(page)).toHaveCount(2);
  await cards(page).first().getByRole('button',{name:'Tenho interesse',exact:true}).click();
  const modal=page.getByRole('dialog',{name:'Tenho interesse neste imóvel'});
  await expect(modal).toBeVisible();
  await modal.getByRole('button',{name:'Continuar para o WhatsApp',exact:true}).click();
  await expect(modal.locator('.site-lead-error')).toContainText('Informe nome e telefone válidos');
  expect(controlledSite.captures).toHaveLength(0);
  await modal.getByRole('textbox',{name:'Nome',exact:true}).fill('Pessoa E2E');
  await modal.getByRole('textbox',{name:'Telefone / WhatsApp',exact:true}).fill('65999990000');
  await modal.getByRole('button',{name:'Continuar para o WhatsApp',exact:true}).click();
  await expect(modal).toBeHidden();await expect.poll(()=>controlledSite.captures.length).toBe(1);
  expect(controlledSite.captures[0]).toMatchObject({name:'Pessoa E2E',propertyCode:'VCI990001'});
  await cards(page).nth(1).getByRole('button',{name:'Tenho interesse',exact:true}).click();
  await expect(modal.getByRole('textbox',{name:'Nome',exact:true})).toHaveValue('');
  await modal.getByRole('button',{name:'Continuar sem cadastrar dados',exact:true}).click();
  await expect(modal).toBeHidden();expect(controlledSite.captures).toHaveLength(1);
  const opened=await page.evaluate(()=>window.__e2eOpenedUrls);
  expect(opened).toHaveLength(2);expect(decodeURIComponent(opened[1])).toContain('VCI990002');
});
test('an empty published catalog clears cached listings and never resurrects the static catalog',async({page,controlledSite})=>{
  await page.goto('/');await expect(cards(page)).toHaveCount(2);
  controlledSite.state.catalog=[];await page.reload();
  await expect(cards(page)).toHaveCount(0);await expect(page.locator('#propertiesEmpty')).toBeVisible();
});
