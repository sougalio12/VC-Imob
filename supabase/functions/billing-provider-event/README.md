# billing-provider-event

Entrada server-to-server, desabilitada por padrão, para eventos **já verificados** por adapters Apple, Google ou Web.

- Não é chamada pelo frontend.
- Falha com `503` enquanto `BILLING_PROVIDER_EVENTS_ENABLED=true` e `BILLING_PROVIDER_INGRESS_SECRET` não forem configurados.
- Não valida StoreKit JWS nem consulta Google Play Developer API por conta própria; habilitar antes disso é proibido.
- A idempotência e a ordenação final são impostas por `apply_verified_billing_event` no banco.
- Nunca registrar receipts, tokens ou o segredo de ingresso.
