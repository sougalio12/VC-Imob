import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import vm from 'node:vm';

const catalog = JSON.parse(readFileSync('data/imoveis.json', 'utf8'));
const apartment = catalog.find(p => p.codigo === 'VCI000004');
const house = catalog.find(p => p.codigo === 'VCI000005');
const home = readFileSync('index.html', 'utf8');
const detail = readFileSync('js/imovel.js', 'utf8');
const publicStyles = readFileSync('css/style.css', 'utf8');
const detailStyles = readFileSync('css/imovel.css', 'utf8');

test('catalog codes, IDs and active slugs are unique', () => {
  for (const key of ['codigo', 'id', 'slug']) {
    const values = catalog.map(p => p[key]).filter(Boolean);
    assert.equal(new Set(values).size, values.length);
  }
  assert.ok(catalog.every(p => /^VCI\d{6}$/.test(p.codigo)));
});

test('apartment preserves supplied facts', () => {
  assert.equal(apartment.ativo, true);
  assert.equal(apartment.preco, 315000);
  assert.equal(apartment.areaConstruida, 56);
  assert.equal(apartment.bairro, 'Parque dos Buritis');
  assert.match(apartment.enderecoExibir, /Condomínio Parque Primavera/);
  assert.deepEqual([apartment.quartos, apartment.banheiros, apartment.vagas], [2, 1, 1]);
  assert.deepEqual(apartment.caracteristicas, ['Ampla área de lazer', 'Salão de festas']);
});

test('house preserves supplied areas, construction status and unknown bathrooms', () => {
  assert.equal(house.ativo, true);
  assert.equal(house.preco, 1150000);
  assert.equal(house.bairro, 'Bandeirantes');
  assert.deepEqual([house.areaTotal, house.areaConstruida], [437.5, 246.71]);
  assert.deepEqual([house.quartos, house.suites, house.vagas, house.banheiros], [4, 1, 2, null]);
  assert.match(house.descricao, /em fase de acabamento/);
  assert.equal(house.imagensTipo, 'projeto');
  assert.match(house.legendaImagens, /não fotografias do imóvel pronto/);
});

test('qualifications contain only titles supported by the supplied certificates', () => {
  const section = home.match(/<section class="profile-education"[\s\S]*?<\/section>/)[0];
  const items = [...section.matchAll(/<li>(.*?)<\/li>/g)].map(m => m[1].replace(/<span aria-hidden="true">🎓<\/span>\s*/, ''));
  assert.deepEqual(items, ['Pós-Graduação Lato Sensu em Direito Imobiliário', 'Pós-Graduação Lato Sensu em MBA de Empreendedorismo, Marketing e Finanças']);
  assert.doesNotMatch(section, /CPF|RG|registro|autenticidade|EVCODE|validador/i);
});

test('catalog card follows title, linked photo, information, price and action hierarchy', () => {
  const card = home.match(/<article class="property-card">[\s\S]*?<\/article>/)?.[0] || '';
  const positions = ['property-card-header', 'property-image', 'property-content', 'property-footer', 'property-price', 'property-actions'].map(token => card.indexOf(token));
  assert.ok(positions.every(position => position >= 0), card);
  assert.deepEqual([...positions].sort((a, b) => a - b), positions);
  assert.match(card, /<a\s+[\s\S]*?class="property-image[^"].*?[\s\S]*?href="\$\{detalhesUrl\}"[\s\S]*?aria-label="Abrir anúncio:/);
  assert.match(card, /property-details-link[\s\S]*?Ver imóvel/);
  assert.match(card, /property-interest-button[\s\S]*?Tenho interesse/);
});

test('dynamic watermark is centered, subtle and crops the existing brand symbol', () => {
  for (const css of [publicStyles, detailStyles]) {
    assert.match(css, /left:\s*50%/);
    assert.match(css, /top:\s*50%/);
    assert.match(css, /translate\(-50%,\s*-50%\)/);
    assert.match(css, /4d6f85cd-fe07-4c5c-bbbf-be216a48a1b1\.jpeg/);
    assert.match(css, /380% auto no-repeat/);
    assert.match(css, /grayscale\(1\)/);
    assert.match(css, /opacity:\s*0\.1[58]/);
  }
  assert.match(detailStyles, /property-gallery-main::before[\s\S]*property-thumbnail::after[\s\S]*property-lightbox-media::after/);
});

test('all referenced catalog images are local existing assets', () => {
  for (const property of catalog) for (const image of property.imagens) {
    assert.ok(image.startsWith('./assets/images/imoveis/'), image);
    assert.ok(existsSync(resolve(image)), image);
  }
});

test('inline home JavaScript compiles', () => {
  for (const [, attrs, body] of home.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/g)) {
    if (!attrs.includes('application/ld+json') && !attrs.includes('src=')) new vm.Script(body);
  }
});

test('local HTML assets and navigation targets exist', () => {
  for (const file of ['index.html', 'imovel.html', 'crm/index.html']) {
    const html = readFileSync(file, 'utf8');
    for (const [, target] of html.matchAll(/(?:src|href)="(\.[^"]+)"/g)) {
      const path = target.split(/[?#]/)[0];
      assert.ok(existsSync(resolve(dirname(file), path)), `${file}: ${target}`);
    }
  }
});

function renderer(property) {
  const elements = new Map();
  const element = id => {
    if (!elements.has(id)) elements.set(id, { innerHTML: '', addEventListener() {}, setAttribute() {}, focus() {}, classList: {add() {}, remove() {}} });
    return elements.get(id);
  };
  let interest;
  const context = vm.createContext({
    console, URLSearchParams, Intl,
    SITE_CONFIG: {contato: {whatsapp: '5500000000000'}},
    window: { location: {search: ''}, siteLeadCapture: {openInterestFlow: value => { interest = value; }} },
    document: {getElementById: element, querySelector: () => null, querySelectorAll: () => [], addEventListener() {}},
    property
  });
  vm.runInContext(detail, context);
  vm.runInContext('renderProperty(property); openWhatsAppForProperty();', context);
  return {html: element('propertyDetailRoot').innerHTML, context, interest, element};
}

test('new detail pages render facts, galleries, and original lead CTA', () => {
  for (const property of [apartment, house]) {
    const {html, interest} = renderer(property);
    assert.ok(html.includes(property.codigo));
    if (!property.imagens.length) {
      assert.match(html, /Imagens ainda não disponíveis/);
      assert.doesNotMatch(html, /galleryMainButton/);
    } else {
      assert.match(html, /galleryMainButton/);
    }
    assert.doesNotMatch(html, /src=""/);
    assert.equal(interest.propertyCode, property.codigo);
    assert.equal(interest.propertyTitle, property.titulo);
  }
  const {html} = renderer(house);
  assert.match(html, /Área construída/);
  assert.match(html, /246,71 m²/);
  assert.match(html, /Terreno/);
  assert.match(html, /437,50 m²/);
  assert.doesNotMatch(html, /<span>Banheiros<\/span>/);
});

test('new galleries contain exactly seven apartment and three house JPEG assets', () => {
  for (const [property, count, folder] of [[apartment, 7, 'parque-primavera'], [house, 3, 'bandeirantes-acabamento']]) {
    assert.equal(property.imagens.length, count);
    assert.equal(new Set(property.imagens).size, count);
    for (const path of property.imagens) {
      assert.ok(path.includes(`/${folder}/`));
      const bytes = readFileSync(path);
      assert.equal(bytes.subarray(0, 3).toString('hex'), 'ffd8ff');
      assert.ok(bytes.length < 300000, path);
    }
    assert.doesNotMatch(renderer(property).html, /Imagens ainda não disponíveis/);
  }
  assert.match(apartment.imagens[0], /07-entrada-condominio-projeto/);
  assert.equal(apartment.capaTipo, 'projeto');
  assert.match(house.imagens[0], /01-capa-fachada-projeto/);
});

test('project captions follow the selected image in gallery and lightbox', () => {
  const {context, element} = renderer(apartment);
  assert.equal(element('galleryCaption').hidden, false);
  vm.runInContext('setActiveImage(0)', context);
  for (const id of ['galleryCaption', 'lightboxCaption']) {
    assert.equal(element(id).hidden, false);
    assert.match(element(id).textContent, /não é fotografia do apartamento/);
  }
  vm.runInContext('setActiveImage(1)', context);
  assert.equal(element('lightboxCaption').hidden, true);
  const renderedHouse = renderer(house);
  assert.match(renderedHouse.element('galleryCaption').textContent, /Casa em fase de acabamento/);
  assert.match(home, /property-project-label.*Imagem do projeto/);
});

test('existing galleries and project labels reuse the same renderer', () => {
  const existing = catalog.find(p => p.codigo === 'VCI000002');
  assert.match(renderer(existing).html, /galleryMainButton/);
  const {context} = renderer(house);
  assert.match(vm.runInContext('imageAlt(property, 0)', context), /imagem do projeto 1/);
});
