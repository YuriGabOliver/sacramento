# Ficha de RPG – Velho Oeste (mesa online)

Fichas dos jogadores guardadas em um banco, painel do mestre (vida e dor de todos),
e convite por link. Sem mapa, sem dependências para instalar.

## Estrutura
- `index.html`: o site (ficha + painel do mestre + telas de entrada)
- `api/mesa.js`: o servidor (uma função do Vercel)
- `package.json`, `vercel.json`: configuração

## Como publicar no Vercel
1. Coloque estes arquivos num repositório do GitHub (ou use a CLI: `npm i -g vercel` e rode `vercel` nesta pasta).
2. No Vercel: **Add New → Project** e importe o repositório. Não precisa mudar nenhuma configuração de build.
3. No projeto, aba **Storage**: crie um banco **Upstash for Redis** (pelo Marketplace) e conecte ao projeto.
   Isso cria as variáveis `KV_REST_API_URL` e `KV_REST_API_TOKEN` (o código também aceita
   `UPSTASH_REDIS_REST_URL` e `UPSTASH_REDIS_REST_TOKEN`). Confira os nomes em Settings → Environment Variables.
4. Em **Settings → Environment Variables**, crie `MESTRE_SENHA` com a senha que só você vai usar.
5. Faça um novo deploy (Deployments → Redeploy) para as variáveis valerem.

## Como usar
- **Mestre:** abra o site, toque em "Sou o mestre" e digite a senha. Toque em **Convidar jogadores**
  para copiar ou compartilhar o link de convite. A Mesa mostra vida e dor de todos e atualiza a cada 5 segundos.
  "Abrir ficha" abre a ficha completa do jogador (você pode editar).
- **Jogador:** abre o link de convite, escreve o nome e cria suas fichas. Salva sozinho.
  O botão **Meu link de acesso** copia um link pessoal para continuar em outro aparelho. Quem tiver esse link entra como o jogador.
- **Novo link de convite:** "Gerar novo link" invalida o antigo. Quem já entrou continua na mesa.

## Limites e segurança
- A senha do mestre fica só no servidor (variável de ambiente) e é enviada a cada pedido. Use HTTPS (o Vercel já usa) e uma senha forte.
- Não há limite de tentativas de senha. Para uso entre amigos basta; para uso aberto, adicione limite de tentativas.
- Limites: 60 jogadores, 30 fichas por jogador, ficha de até 300 KB.
- Todos os dados ficam no seu banco Upstash. Veja os limites do plano gratuito no site deles.
