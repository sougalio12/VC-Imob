# Documentos imobiliários — fontes, versões e limites jurídicos

Revisão técnica das fontes: **22/09/2026**. Templates atuais: versão **2**, base jurídica `BR-IMOB-2026-09-22`. Os documentos da versão 1 permanecem imutáveis e consultáveis.

O VC Imob produz minutas controladas a partir dos dados conferidos pelo usuário. O módulo não substitui a revisão por advogado, não certifica assinaturas, não registra documentos no SGR ou no Registro de Imóveis e não promete adequação universal. Situações especiais são bloqueadas para finalização e permanecem disponíveis como rascunho.

## Fontes oficiais verificadas

- [Lei nº 6.530/1978](https://www.planalto.gov.br/ccivil_03/leis/l6530.htm): exercício da profissão, competência normativa do COFECI e autorização escrita para anúncio.
- [Decreto nº 81.871/1978](https://www.planalto.gov.br/ccivil_03/decreto/antigos/d81871.htm): regulamentação profissional.
- [Código Civil — Lei nº 10.406/2002](https://www.planalto.gov.br/ccivil_03/leis/2002/l10406compilada.htm): arts. 107 e 108; 417 e seguintes; 481 e seguintes; 490; 722 a 729; 1.227 e 1.245.
- [Resolução COFECI nº 1.504/2023 e Anexo](https://intranet.cofeci.gov.br/arquivos/legislacao/resolucao_1504_2023.pdf): contrato-padrão de corretagem para venda, campos, modalidades, consulta/registro no SGR e assinatura eletrônica na modalidade oficial.
- [Código de Ética Profissional — Resolução COFECI nº 326/1992](https://intranet.cofeci.gov.br/arquivos/legislacao/resolucao_326_1992.pdf): deveres de diligência, informação e zelo.
- [Lei de Registros Públicos — Lei nº 6.015/1973](https://www.planalto.gov.br/ccivil_03/leis/l6015compilada.htm): títulos e requisitos de ingresso no registro.
- [LGPD — Lei nº 13.709/2018](https://www.planalto.gov.br/ccivil_03/_ato2015-2018/2018/lei/l13709compilado.htm): necessidade, segurança e tratamento de dados pessoais.
- [Lei nº 14.063/2020](https://www.planalto.gov.br/ccivil_03/_ato2019-2022/2020/lei/l14063.htm): espécies e uso de assinaturas eletrônicas, sem equivalência universal presumida.
- [Lei nº 14.905/2024](https://www.planalto.gov.br/ccivil_03/_ato2023-2026/2024/lei/l14905.htm): atualização monetária, juros e alteração do art. 418 do Código Civil.

Regimes especiais considerados para triagem, sem criação automática de cláusulas: [Lei nº 4.591/1964](https://www.planalto.gov.br/ccivil_03/leis/l4591.htm) (incorporação), [Lei nº 6.766/1979](https://www.planalto.gov.br/ccivil_03/leis/l6766.htm) (parcelamento do solo), [Lei nº 9.514/1997](https://www.planalto.gov.br/ccivil_03/leis/l9514.htm) (alienação fiduciária), [Código de Defesa do Consumidor](https://www.planalto.gov.br/ccivil_03/leis/l8078compilada.htm) e [Estatuto da Terra](https://www.planalto.gov.br/ccivil_03/leis/l4504.htm).

## Versão 2 — contrato de corretagem para venda

Código: `sale_intermediation`; versão `2`; status `legal_review_required`.

Comparação com a versão 1 e com o anexo da Resolução COFECI nº 1.504/2023:

- acrescenta qualificação das partes, documentação apresentada, autorização de substituição, método de assinatura e confirmação da consulta prévia ao SGR;
- mantém imóvel, matrícula, oferta/condições, prazo, honorários, publicidade, identificação profissional e escolha expressa entre exclusividade e não exclusividade;
- usa a nomenclatura **Contrato de Corretagem Imobiliária para Venda**, preservando a natureza de intermediação;
- o PDF do VC Imob não é apresentado como registro no SGR nem como assinatura avançada/qualificada; a consulta ao SGR deve ser declarada pelo profissional e o registro oficial continua externo ao produto;
- não cria percentuais, multas, consequências de exclusividade ou poderes de representação não informados.

## Versão 2 — instrumento de compra e venda

Código: `property_sale_purchase`; versão `2`; status `legal_review_required`.

O documento é apresentado como **instrumento particular/minuta**, nunca como escritura pública ou certificado de transferência. A redação esclarece que, em regra, a propriedade imobiliária se transfere com o registro do título no Registro de Imóveis, observados forma, valor, natureza do negócio e exigências aplicáveis.

A versão 2 acrescenta triagem objetiva sobre natureza do instrumento, imóvel urbano/rural, estágio, incorporação/loteamento, matrícula, financiamento, alienação fiduciária, possível relação de consumo, coproprietários, arras, posse, despesas, débitos e corretagem. Não predefine multa, percentual, arras, juros, atualização, financiamento, tributos ou comissão.

Reconhecimento de firma e testemunhas não são tratados como obrigação universal nem como universalmente dispensáveis. A necessidade depende da natureza, finalidade e apresentação do instrumento, devendo ser confirmada no caso concreto.

## Cenários e bloqueios

O fluxo usa revelação progressiva. Campos complementares aparecem somente quando a resposta anterior os torna pertinentes. A finalização é bloqueada, sem impedir o rascunho, nos seguintes cenários:

- consulta prévia ao SGR não confirmada no contrato de corretagem;
- imóvel rural;
- unidade futura/empreendimento, incorporação ou loteamento;
- financiamento ou alienação fiduciária;
- possível relação de consumo;
- matrícula indisponível.

Esses bloqueios são uma fronteira de segurança do modelo, não uma conclusão de invalidade. A mensagem exibida é: “Este cenário requer análise jurídica específica.”

## Checklist, snapshot e imutabilidade

O preview classifica cada verificação como obrigatória, atenção ou informativa, sempre com texto além da cor. Partes, imóvel, matrícula, preço, pagamento, arras, financiamento, posse, formalização/registro, despesas, corretagem, débitos, inadimplemento, rescisão, local/data e assinaturas são verificados conforme o tipo e o cenário.

Cada versão salva mantém snapshot de conteúdo, identidade, template, `template_version`, `legal_basis_version`, fontes jurídicas, checklist, bloqueios e data de geração. Versões finalizadas não são reescritas quando um template novo é publicado.

## Atualização legislativa

Nenhuma mudança normativa reescreve cláusulas automaticamente. O fluxo previsto é: detectar possível alteração, marcar revisão necessária, comparar as normas, realizar revisão humana/jurídica e só então publicar nova versão para documentos futuros. Documentos finalizados permanecem imutáveis.

## Privacidade, acesso e arquivos

- RLS e verificações explícitas preservam tenant, organização, papel e carteira do corretor.
- Preview expira e é vinculado ao usuário e ao hash do payload.
- Auditoria registra apenas metadados operacionais; não registra CPF, RG, texto integral ou bytes de documentos.
- O PDF é gerado localmente a partir do snapshot privado e não entra no Cache Storage do PWA.
- O módulo atual não possui upload de versão assinada. Adicioná-lo com storage privado, MIME/assinatura binária, limite, URLs temporárias, RLS e proteção IDOR requer projeto e migration separados.

## Assinatura eletrônica e SGR

Não existe assinatura eletrônica caseira, integração com provedor ou registro automático no SGR. SGR Sistema COFECI-CRECI e provedores juridicamente adequados são evoluções futuras separadas. A expressão “Assinado”, caso venha a existir, deverá significar apenas que o usuário registrou uma versão assinada, e não certificação jurídica pelo VC Imob.
