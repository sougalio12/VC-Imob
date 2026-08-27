# Configuração da função `property-ad`

A função registra o lead antes de tentar o e-mail. Configure os valores somente como secrets/env do backend:

- `SELL_PROPERTY_ORGANIZATION_ID`: UUID da organização destinatária.
- `SELL_PROPERTY_RECIPIENT_EMAIL`: e-mail profissional que recebe as solicitações.
- `SELL_PROPERTY_FROM_EMAIL`: remetente verificado no provedor.
- `SELL_PROPERTY_ALLOWED_ORIGINS`: origins públicos permitidos, separados por vírgula.
- `SELL_PROPERTY_RATE_LIMIT_SALT`: valor secreto e aleatório usado no hash de rate limit.
- `SELL_PROPERTY_EMAIL_MODE=resend` e `RESEND_API_KEY`: transporte real.

O modo `mock` exige também `SELL_PROPERTY_ALLOW_MOCK=true` e `SELL_PROPERTY_EMAIL_MOCK_URL`; use-os somente no Supabase local. Nenhum envio real é feito pelos testes.
