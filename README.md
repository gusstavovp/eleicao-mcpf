# Eleição MCPF

Sistema de eleições de líderes e vice-líderes de turma, desenvolvido com Next.js e Supabase.

## Recursos
- Turmas, candidatos com números de dois dígitos e fotos.
- Urna com teclado físico e virtual, sons, votos brancos e nulos.
- Histórico de eleições, apuração por cargo e eleição automática sem oponentes.
- Administração restrita, com login por link enviado por e-mail.

## Executar
Requer Node.js 22 ou superior.

```sh
npm ci
cp .env.example .env.local
# Preencha .env.local antes de executar
npm run dev
```

Para verificar a versão de produção: `npm run build`.

## Vercel
Importe este repositório e selecione Next.js. O diretório raiz é a própria raiz do repositório.

Configure as variáveis de ambiente no painel da Vercel:
- `NEXT_PUBLIC_SUPABASE_URL`: URL do projeto Supabase.
- `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`: chave publicável.
- `ADMIN_EMAIL`: e-mail autorizado para administração, consistente com as políticas RLS do banco.

As permissões de banco e Storage são controladas por RLS no Supabase. Nunca inclua chaves service_role no frontend. Este repositório não inclui dados de eleições ou credenciais administrativas.

## Login e entrada em produção
Configure no Supabase Auth a Site URL e a Redirect URL com o domínio final e o caminho `/admin`. Verifique a entrega dos links de acesso; o serviço de e-mail padrão do Supabase pode exigir SMTP próprio para destinatários fora da equipe.

A migração do banco é uma cópia do site anterior. Antes de trocar o endereço usado nas eleições, reconcilie possíveis alterações feitas no sistema anterior e teste o login administrativo. A publicação na Vercel e o login real ainda precisam ser concluídos.
