# Gerador de Documentos Imobiliários - fontes e controle jurídico

Revisão técnica das fontes: **16/09/2026**. Templates iniciais: versão **1**, efetivos a partir de **17/09/2026**.

Este módulo gera minutas controladas a partir de dados expressamente informados. Ele não substitui a revisão por advogado, não executa assinatura eletrônica e não afirma que uma minuta serve indistintamente para toda situação imobiliária.

## Fontes oficiais consultadas

- [Lei nº 6.530/1978](https://www.planalto.gov.br/ccivil_03/leis/l6530.htm): disciplina a profissão; o art. 3º trata da intermediação, e o art. 20, III, veda anúncio sem autorização escrita.
- [Decreto nº 81.871/1978](https://www.planalto.gov.br/ccivil_03/decreto/antigos/d81871.htm): regulamenta a Lei nº 6.530/1978 e delimita a atuação profissional.
- [Código Civil - Lei nº 10.406/2002](https://www.planalto.gov.br/ccivil_03/leis/2002/l10406compilada.htm): arts. 722 a 729 (corretagem) e regras aplicáveis à compra e venda, forma, transmissão e obrigações.
- [Resolução COFECI nº 1.504/2023 e Contrato-Padrão](https://intranet.cofeci.gov.br/arquivos/legislacao/resolucao_1504_2023.pdf): modelos de intermediação com e sem exclusividade, campos mínimos, registro no SGR e requisitos próprios para a modalidade eletrônica oficial.
- [LGPD - Lei nº 13.709/2018](https://www.planalto.gov.br/ccivil_03/_ato2015-2018/2018/lei/l13709compilado.htm): princípios de necessidade e segurança e tratamento necessário à execução contratual/obrigações legais.

## Template 1 - autorização / intermediação para venda

Código: `sale_intermediation`; versão inicial: `1`.

Obrigatórios: contratante, corretor, CRECI, identificação do imóvel, preço pretendido, condições comerciais, remuneração, prazo, escolha expressa entre exclusiva e não exclusiva, autorização/limites de divulgação, encerramento, local e data.

Opcionais: contatos das partes e matrícula/registro, que só é preenchida quando efetivamente cadastrada. A escolha de exclusividade nunca possui valor padrão. A redação informa o efeito geral da escolha e remete às condições expressas e à legislação; não cria percentual ou consequência adicional.

Pontos de revisão profissional: adequação ao negócio concreto, poderes do proprietário, titularidade, regime de exclusividade, cálculo/exigibilidade da remuneração, prazo, publicidade, encerramento e eventual uso do contrato-padrão registrado no SGR. O PDF do VC Imob não é apresentado como registro no SGR nem como assinatura eletrônica avançada/qualificada.

## Template 2 - contrato particular de compra e venda

Código: `property_sale_purchase`; versão inicial: `1`; status técnico: `legal_review_required`.

Obrigatórios: vendedor, comprador, imóvel, preço, pagamento, decisão expressa sobre sinal/arras, decisão expressa sobre financiamento, posse, escritura/transferência, tributos/despesas, débitos informados, corretagem, inadimplemento, rescisão, local e data. Se arras ou financiamento forem marcados como aplicáveis, suas condições tornam-se obrigatórias.

Opcionais: contatos, matrícula/registro e testemunhas. O módulo não predefine multa, percentual, arras, data de posse, financiamento, IPTU, condomínio, tributos, comissão ou prazo.

Pontos de revisão profissional: capacidade e estado civil das partes, outorga conjugal quando aplicável, cadeia dominial, ônus, matrícula atualizada, forma exigida, registro, financiamento, arras, posse, tributos, condomínio, inadimplemento, rescisão e assinaturas/testemunhas. A primeira versão deliberadamente não exige CPF/RG; se esses dados forem necessários ao caso, a arquitetura deverá ganhar campos protegidos após revisão jurídica e de privacidade.

## Controle e segurança

- O usuário não edita HTML, JavaScript ou cláusulas estruturais; somente valores de campos permitidos.
- O backend valida a lista de campos, tamanho, tipo do documento, referências e tenant.
- Preview gera recibo de curta duração vinculado ao usuário e ao hash do conteúdo. O backend rejeita salvamento se o conteúdo divergir do preview.
- Toda gravação cria uma nova versão. Versões anteriores permanecem consultáveis e não são atualizadas pelo cliente.
- Finalização é bloqueada enquanto existirem campos obrigatórios ausentes.
- PDF é produzido localmente a partir do conteúdo finalizado e não recebe URL pública permanente.
- Logs de auditoria registram ação, versão e template, mas não o texto integral nem dados pessoais das partes.

## Evolução futura deliberadamente excluída

Assinatura eletrônica, ICP-Brasil, reconhecimento facial, envio para assinatura, integração paga e registro automático no SGR não fazem parte desta etapa. Qualquer integração futura exigirá autenticação própria, evidência de consentimento, validação jurídica, gestão de chaves e trilha de auditoria específica.
