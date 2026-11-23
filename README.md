# Rota do Enem - Black Friday

Cópia da página de vendas fornecida, com imagens e estilos locais, checkout Pix de R$ 397, página de obrigado e PDF introdutório. Pronto para Vercel, com JavaScript nativo e uma função Node.js.

## Revisão local

Requer Node.js 24. Não há dependências de aplicação para instalar.

```sh
npm run dev:review
```

Abra `http://127.0.0.1:4173`. Nesse modo os pagamentos são simulados e identificados com um aviso. No pagamento há um botão para simular aprovação e revisar a página de obrigado. Nenhuma chamada à Atlas é feita nesse modo. A simulação é recusada em ambientes Vercel ou com NODE_ENV=production.

Rotas: `/`, `/checkout`, `/pagamento`, `/obrigado`, `/termos`, `/privacidade`.

## Configuração Vercel

Projeto existente: `rota-do-enem-black`, equipe `team_dZlw0XSD1Tl5Z4gE3kUxXVS6`.

- Framework: Other. Node.js: 24.x.
- Build: `node scripts/check.mjs`. Output: `public`.
- `ATLAS_SECRET_KEY`: chave de API aprovada da Atlas; adicionar somente nas variáveis de ambiente Vercel. Não adicionar ao Git.
- `PUBLIC_SITE_URL`: URL final da oferta; padrão `https://rota-do-enem-black.vercel.app`.
- `ORDER_SIGNING_SECRET`: opcional, segredo aleatório separado para a sessão de consulta. Se ausente, usa a chave de API. Alterar o segredo invalida sessões existentes.
- Sem chave: checkout bloqueia geração e informa indisponibilidade. Nunca gera um Pix de demonstração em produção.

Após adicionar/alterar variáveis, é necessário criar novo deployment. A integração segue https://atlaspags.com/docs/ (consultada em 23/11/2026). A API da Atlas atualmente opera com dinheiro real; a revisão usa mocks locais. Antes de liberar a campanha, validar a conta e a nominal em uso e fazer uma conferência operacional autorizada do pagamento real.

## Fluxo e limites

O servidor fixa o preço em 397 reais, valida cadastro e CPF e cria a cobrança com `POST /charges` e `Idempotency-Key`. A mesma tentativa com os mesmos dados é reutilizada após falha de rede. Dados pessoais não ficam no armazenamento do navegador; apenas o hash do formulário, identificador da tentativa e dados técnicos do pedido.

O pagamento é confirmado consultando `GET /charges/{id}` pelo servidor. A sessão assinada permite consultar apenas aquele pedido. Valor, método, produto, identificador e ambiente da cobrança são conferidos. O navegador consulta automaticamente enquanto a tela estiver aberta e retoma ao voltar para a aba. Não há webhook nem execução de efeitos em segundo plano; a Atlas é a fonte do estado do pagamento.

Somente pedidos pagos dão acesso ao PDF por `/api/intro`. Abrir diretamente `/obrigado` não confirma uma compra. A cobrança expirada, falha, reembolsada ou contestada não aparece como aprovada. A validade da sessão de consulta é de sete dias; depois, atendimento pelo WhatsApp.

A liberação do curso e o envio das credenciais por e-mail são feitos pela equipe, em até dois dias úteis. Este projeto não cria contas na plataforma do curso nem envia e-mails. Os pedidos e dados de compra ficam disponíveis na conta Atlas. O botão de reembolso abre a central fornecida; não executa estorno automático.

WhatsApp: `5575988393742`, confirmado nas páginas recentes. Reembolso: https://reembolso-de-alunos.vercel.app/.

## Verificação

```sh
npm run build
node --test --test-isolation=none
```

Testes de contrato com respostas simuladas: preço imutável, idempotência, CPF, confirmação de e-mail, tokens adulterados/expirados, validação da cobrança, indisponibilidade, bloqueio de simulação em Vercel e acesso protegido ao PDF. Nenhuma cobrança real é criada pelos testes.

As imagens, textos e promessas comerciais da página original foram preservados, com atualização do preço e do FAQ de acesso e pagamento. O responsável pela oferta deve confirmar a validade dos bônus, conteúdo e garantias antes da campanha.
