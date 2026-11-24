# Rota do Enem - Black Friday

Página de vendas com imagens e estilos locais, checkout Pix Atlas Pags de R$ 397, página de obrigado e PDF introdutório. JavaScript nativo e uma função Node.js na Vercel.

## Revisão local

Requer Node.js 24. Execute npm ci e npm run dev:review; abra http://127.0.0.1:4173. Pagamentos simulados são identificados com aviso; nenhuma chamada ao gateway, Blob ou Pushcut é feita. O botão de simular aprovação permite revisar obrigado e PDF. Simulação é recusada na Vercel e com NODE_ENV=production.

Rotas: /, /checkout, /pagamento, /obrigado, /termos, /privacidade. Em Preview e revisão local, /api/review-thanks e /api/review-pdf oferecem uma prévia identificada, sem aprovar pedidos. Retornam 404 em produção.

## Configuração e publicação

Projeto Vercel rota-do-enem-black, equipe team_dZlw0XSD1Tl5Z4gE3kUxXVS6. Repositório conectado: ronald-almeida/rota-do-enem-black. Commits na branch de produção codex/rota-black-review publicam automaticamente em https://rota-do-enem-black.vercel.app/. Outras branches geram previews.

Framework Other, Node.js 24.x, build node scripts/check.mjs, output public.

- ATLAS_SECRET_KEY: chave secreta de produção da Atlas, usada para criar e consultar cobranças. Nunca enviar ao navegador ou Git.
- ATLAS_NOTIFICATIONS_MODE=gateway: usa os avisos GERADO/APROVADO já ativos no painel Atlas e impede o segundo envio pelo site. Novas cobranças não registram postback_url; callbacks de cobranças anteriores são reconhecidos sem encaminhar ao Pushcut.
- BLOB_STORE_ID: store privado conectado ao projeto Vercel, autenticado por OIDC. Guarda somente estado de envio e identidade de evento em hash, sem dados do comprador. BLOB_READ_WRITE_TOKEN é a alternativa para desenvolvimento fora da Vercel.
- PUBLIC_SITE_URL: opcional; padrão https://rota-do-enem-black.vercel.app.
- PUSHCUT_PIX_PENDING_URL e PUSHCUT_PIX_PAID_URL: links secretos de Pix gerado e venda aprovada, somente no servidor.
- NEXUM_API_CHAT_ID, NEXUM_API_CREDENTIAL, NEXUM_API_ORIGIN e NEXUM_WEBHOOK_TOKEN: manter para consultar pedidos Nexum existentes e receber seus avisos. Não são usados para novas compras. A antiga variável NEXUM_ALLOW_LIMIT_TEST não é mais utilizada.
- ORDER_SIGNING_SECRET: opcional; sem ela a sessão usa a credencial do gateway correspondente. Não alterar durante a migração, pois invalida sessões existentes.

Variáveis devem estar em Production; alterações exigem novo deployment. /api/config verifica a chave Atlas com GET /api/v1/ping, sem efeito financeiro, e exige ok: true e livemode: true. Isso verifica autenticação e ambiente, não garante que uma cobrança será aceita pelo processador. Documentação: https://atlaspags.com/docs/ (consultada em 24/11/2026).

## Pagamento e compatibilidade

O servidor fixa R$ 397, valida CPF, nome, e-mail, confirmação, DDD e consentimento. Cria o Pix com POST /api/v1/charges, method: pix, itens totalizando R$ 397, produto rota-black-2026, checkout_url e referência rota-atlas-397-{UUID}. A mesma referência é a Idempotency-Key; uma falha de rede preserva a tentativa. O valor enviado pelo navegador nunca define a cobrança.

O servidor consulta GET /api/v1/charges/{id} e confere ID, referência, produto, método, valor e ambiente. Só um pagamento confirmado sem estorno libera o PDF. Respostas são filtradas: credenciais, callback e dados pessoais não chegam ao navegador. Uma recusa definitiva permite outra tentativa.

Sessões Atlas anteriores continuam válidas por R$ 397. Sessões Nexum existentes continuam consultando GET /api/public/pix/status/{tx_id} por R$ 247. Pagamento e recibo mostram o valor verificado daquele pedido. Sessões são assinadas e expiram em sete dias. Credenciais antigas são preservadas para essa compatibilidade.

O navegador aguarda pelo menos 30 segundos entre consultas e respeita Retry-After, inclusive após recarregar. Para Nexum, snapshots assinados e consultas simultâneas compartilhadas evitam chamadas repetidas entre pagamento, obrigado e PDF. Pedidos Nexum em PROCESSING continuam consultáveis sem inventar código Pix ou aprovação.

## Notificações Pushcut

Em produção, ATLAS_NOTIFICATIONS_MODE=gateway mantém somente o envio direto configurado no painel Atlas. A duplicação ocorria porque o painel e o site enviavam ao mesmo Pushcut. Não apagar os destinos do painel: eles também atendem outros produtos da conta. O checkout permanece Atlas de R$ 397; a migração Anubis foi cancelada antes de publicar.

Se futuramente os destinos diretos do painel forem removidos, a ausência desse modo permite encaminhamento pelo site. Nesse modo alternativo, cada cobrança registra postback_url em /api/webhooks/atlas, com token secreto derivado da chave Atlas por HMAC e separado por finalidade. O endpoint compara o token em tempo constante e consulta novamente a cobrança na API autenticada da Atlas. O corpo do callback nunca é usado como prova de pagamento.

Somente transaction.pending e transaction.paid em produção, de pedidos rota-atlas-397-*, são considerados. A consulta deve confirmar valor, produto, referência, ID, método, ambiente, ausência de estorno e status correspondente. Forjar um status no callback não dispara venda aprovada. Os avisos independem de o comprador manter a página aberta.

O endpoint /api/webhooks/nexum continua autenticando X-Webhook-Token para os pedidos anteriores de R$ 247. PENDING gera o aviso de Pix; PAID com paid: true gera o aviso de venda. Falhas, reembolsos e outros pedidos são ignorados.

Para avisos encaminhados pelo site, nenhum dado pessoal é enviado ao Pushcut, e os textos configurados no aplicativo são preservados. A deduplicação usa registros privados persistentes no Blob, com criação exclusiva e atualização condicional por ETag. Um evento já reservado ou entregue não é reenviado por outra instância ou deployment. Pendência e aprovação têm identidades distintas; o estado de entrega não expira automaticamente.

Uma rejeição HTTP 4xx permite nova tentativa. Timeout, erro 5xx ou falha depois do envio deixam o evento reservado/incerto para impedir duplicação: nesses casos pode ser necessária conferência manual. Não há garantia de entrega exatamente uma vez entre dois serviços sem protocolo transacional. O envio direto da Atlas segue as retentativas do próprio gateway. /api/config verifica acesso real ao armazenamento com um marcador privado fixo, sem notificar o Pushcut. Webhooks não liberam o PDF: ele exige consulta autenticada ao gateway.

## Acesso e suporte

Somente pedidos pagos dão acesso a /api/intro. Abrir /obrigado diretamente não confirma compra. A equipe libera o curso e envia credenciais por e-mail em até dois dias úteis. Este projeto não cria contas na plataforma do curso nem envia e-mails. Novos pedidos ficam na conta Atlas; o botão de reembolso abre a central fornecida, sem executar estorno automático.

WhatsApp: 5575988393742. Reembolso: https://reembolso-de-alunos.vercel.app/. As remoções solicitadas do vídeo privado e caixas de prazo/ajuda no checkout e pagamento foram preservadas.

## Verificação

Execute npm run build e node --test --test-isolation=none.

Testes usam respostas simuladas, sem cobranças ou notificações reais: contrato Atlas de R$ 397, idempotência, autenticação, cadastro, sessões, consulta de pedidos antigos, status, intervalo de consultas Nexum, indisponibilidade, bloqueio de simulação em produção, PDF protegido, envio exclusivo pelo painel Atlas e deduplicação persistente com concorrência, reinicialização, timeout e retentativa.
