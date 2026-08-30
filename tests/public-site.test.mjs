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

test('qualifications contain only the two supplied qualifications', () => {
  const section = home.match(/<section class="profile-education"[\s\S]*?<\/section>/)[0];
  const items = [...section.matchAll(/<li>(.*?)<\/li>/g)].map(m => m[1]);
  assert.deepEqual(items, ['Pós-Graduação Lato Sensu em Direito Imobiliário', 'MBA em Empreendedorismo, Marketing e Finanças']);
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
  return {html: element('propertyDetailRoot').innerHTML, context, interest};
}

test('new detail pages render facts, honest empty media state, and original lead CTA', () => {
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

test('existing galleries and project labels reuse the same renderer', () => {
  const existing = catalog.find(p => p.codigo === 'VCI000002');
  assert.match(renderer(existing).html, /galleryMainButton/);
  const {context} = renderer(house);
  assert.match(vm.runInContext('imageAlt(property, 0)', context), /imagem do projeto 1/);
});
