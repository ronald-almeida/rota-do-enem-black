# Rota do Enem - Black Friday

Cópia da página de vendas fornecida, com imagens e estilos locais, checkout Pix Nexum de R$ 247, página de obrigado e PDF introdutório. Pronto para Vercel, com JavaScript nativo e uma função Node.js.

## Revisão local

Requer Node.js 24. Não há dependências de aplicação para instalar.

```sh
npm run dev:review
```

Abra `http://127.0.0.1:4173`. Nesse modo os pagamentos são simulados e identificados com um aviso. No pagamento há um botão para simular aprovação e revisar a página de obrigado. Nenhuma chamada ao gateway é feita nesse modo. A simulação é recusada em ambientes Vercel ou com NODE_ENV=production.

Rotas: `/`, `/checkout`, `/pagamento`, `/obrigado`, `/termos`, `/privacidade`.

Nos deployments de Preview e na revisão local, `/api/review-thanks` abre uma prévia visual identificada da página de obrigado e permite revisar o PDF sem pagar. Essa rota e `/api/review-pdf` retornam 404 em produção. A prévia visual não aprova pedidos nem habilita simulações de cobrança na Vercel.

## Configuração Vercel

Projeto existente: `rota-do-enem-black`, equipe `team_dZlw0XSD1Tl5Z4gE3kUxXVS6`.

Repositório conectado: `ronald-almeida/rota-do-enem-black`. A integração nativa do GitHub com a Vercel publica automaticamente os commits da branch de produção `codex/rota-black-review`, que também é a branch padrão atual do repositório; outras branches geram previews. A conexão pode ser conferida em **Settings > Git**, e a branch em **Settings > Environments > Production**.

Site de produção: https://rota-do-enem-black.vercel.app/.

- Framework: Other. Node.js: 24.x.
- Build: `node scripts/check.mjs`. Output: `public`.
- `NEXUM_API_CHAT_ID`: identificador da conta Nexum, obtido em Painel > Integração.
- `NEXUM_API_CREDENTIAL`: credencial fixa da API Nexum, salva como Secret em Production. Não é o token de login do painel. Nunca adicionar ao Git ou ao navegador.
- `NEXUM_API_ORIGIN`: opcional; padrão `https://nexumpaybot.com`, conforme os exemplos oficiais. Deve ser uma origem aceita pelo gateway.
- `ORDER_SIGNING_SECRET`: opcional, segredo aleatório separado para a sessão de consulta. Se ausente, usa a credencial do gateway correspondente. Não trocar durante a migração, pois isso invalida sessões existentes.
- `ATLAS_SECRET_KEY`: manter a chave atual apenas para consultar os pedidos antigos. Nenhuma nova cobrança usa Atlas.
- `/api/config` verifica a autenticação e se a conta aceita depósitos de R$ 247. Sem credenciais válidas, checkout informa indisponibilidade. Nunca gera Pix de demonstração em produção.

Após adicionar/alterar variáveis, é necessário criar novo deployment. A integração segue https://app.nexumpaybot.com/api/index.html (consultada em 24/11/2026). A validação de credenciais usa `GET /api/public/auth/validate`, sem gerar cobrança. Os testes automatizados usam respostas simuladas; não movimentam dinheiro.

## Fluxo e limites

O servidor fixa o preço em 247 reais, valida cadastro e CPF e cria a cobrança com `POST /api/public/pix/create`, `Idempotency-Key` e `externalReference`. Normaliza o nome do pagador para letras sem acentos, como exigido pela Nexum. A mesma tentativa com os mesmos dados é reutilizada após falha de rede. Dados pessoais não ficam no armazenamento do navegador; apenas o hash do formulário, identificador da tentativa e dados técnicos do pedido.

O pagamento é confirmado consultando `GET /api/public/pix/status/{tx_id}` pelo servidor. A sessão assinada vincula gateway, transação, referência e valor; a resposta deve corresponder ao ID e ao valor e, quando presente, à referência externa. Somente os status de confirmação documentados liberam acesso. O QR Code base64 é exibido como imagem local de dados, junto do código Copia e Cola.

O navegador aguarda pelo menos 30 segundos entre consultas e respeita `Retry-After` em HTTP 429, inclusive após recarregar a página. Resultados assinados válidos por 30 segundos e consultas simultâneas compartilhadas evitam chamadas repetidas no fluxo pagamento → obrigado → PDF. Não há webhook nem execução de efeitos em segundo plano; a Nexum é a fonte do estado. Um resultado HTTP 202/PROCESSING mantém a sessão consultável e permite voltar ao checkout com os mesmos dados e a mesma tentativa para recuperar o código, sem inventar aprovação ou trocar a chave idempotente.

Sessões Atlas emitidas antes da migração continuam consultando o gateway antigo e validando o valor original de R$ 397. As telas de pagamento e recibo exibem o valor verificado daquele pedido. O checkout de novas compras sempre usa Nexum e R$ 247.

Somente pedidos pagos dão acesso ao PDF por `/api/intro`. Abrir diretamente `/obrigado` não confirma uma compra. A cobrança expirada, falha, reembolsada ou contestada não aparece como aprovada. A validade da sessão de consulta é de sete dias; depois, atendimento pelo WhatsApp.

A liberação do curso e o envio das credenciais por e-mail são feitos pela equipe, em até dois dias úteis. Este projeto não cria contas na plataforma do curso nem envia e-mails. Os novos pedidos e dados do pagador ficam disponíveis na conta Nexum. O botão de reembolso abre a central fornecida; não executa estorno automático.

WhatsApp: `5575988393742`, confirmado nas páginas recentes. Reembolso: https://reembolso-de-alunos.vercel.app/.

## Verificação

```sh
npm run build
node --test --test-isolation=none
```

Testes de contrato com respostas simuladas: preço imutável, autenticação, idempotência, normalização do nome, CPF, DDD, confirmação de e-mail, tokens adulterados/expirados, validação da cobrança, status, reconciliação HTTP 202, intervalo de consulta, HTTP 429, indisponibilidade, compatibilidade com pedidos Atlas, bloqueio de simulação em Vercel e acesso protegido ao PDF. Nenhuma cobrança real é criada pelos testes.

As imagens, textos e promessas comerciais da página original foram preservados, com atualização do preço e do FAQ de acesso e pagamento. O responsável pela oferta deve confirmar a validade dos bônus, conteúdo e garantias antes da campanha.
