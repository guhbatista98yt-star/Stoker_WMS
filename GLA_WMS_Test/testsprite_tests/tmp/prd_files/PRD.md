# Product Requirements Document (PRD) - GLA WMS

## 1. Visão Geral

O **GLA WMS (Warehouse Management System)** é um sistema de gerenciamento de armazém projetado para otimizar operações logísticas. O foco principal é o controle detalhado dos processos de separação, conferência e atendimento de balcão, garantindo rastreabilidade e eficiência.

### Objetivo
Fornecer uma plataforma robusta e responsiva para gerenciar o fluxo de pedidos dentro do armazém, desde a entrada do pedido via ERP até a finalização da conferência.

### Público-Alvo
- **Supervisores**: Gerenciamento de equipe, visão geral, desbloqueio de tarefas.
- **Separadores**: Execução da separação de produtos.
- **Conferentes**: Validação dos itens separados.
- **Atendentes de Balcão**: Gestão de entregas rápidas/balcão.

## 2. Arquitetura do Sistema

O sistema segue uma arquitetura moderna baseada em web, otimizada para performance e facilidade de manutenção.

### Frontend
- **Framework**: React 18 com TypeScript.
- **Build Tool**: Vite.
- **Estilização**: Tailwind CSS + shadcn/ui.
- **Gerenciamento de Estado**: TanStack Query (React Query).
- **Roteamento**: Wouter.

### Backend
- **Runtime**: Node.js com Express.
- **Linguagem**: TypeScript.
- **ORM**: Drizzle ORM.
- **Banco de Dados**: SQLite (Desenvolvimento/Testes) / PostgreSQL (Produção).
- **Autenticação**: Sessão baseada em cookies (HttpOnly) com Passport/Bcrypt.

## 3. Funcionalidades Principais

### 3.1 Autenticação e Controle de Acesso
- **Login Seguro**: Autenticação via usuário e senha.
- **RBAC (Role-Based Access Control)**:
    - `supervisor`: Acesso total, relatórios, desbloqueio.
    - `separacao`: Acesso à fila de separação.
    - `conferencia`: Acesso à fila de conferência.
    - `balcao`: Acesso ao módulo de balcão.

### 3.2 Gestão de Pedidos (Orders)
- Sincronização com ERP (via banco intermediário/staging).
- Status de pedidos: `pendente` -> `em_separacao` -> `separado` -> `em_conferencia` -> `conferido` -> `finalizado`.
- Priorização de pedidos.

### 3.3 Unidades de Trabalho (Work Units)
- Conceito atômico de tarefa (ex: separar um pedido, conferir um pedido).
- **Sistema de Bloqueio (Locking)**:
    - Impede que dois usuários trabalhem no mesmo pedido simultaneamente.
    - TTL (Time-To-Live) de 15 minutos para locks.
    - Mecanismo de Heartbeat para manter locks ativos.
    - Desbloqueio forçado por supervisores.

### 3.4 Operação (Separação e Conferência)
- **Leitura de Código de Barras**: Integração com leitores para validação de produtos.
- **Tratamento de Exceções**: Registro de avarias, itens não encontrados ou vencidos.
- **Auditoria**: Log de todas as ações críticas (quem fez, quando, o que mudou).

## 4. Modelo de Dados

O banco de dados é relacional e normalizado. Abaixo estão as principais entidades:

- **Users**: Usuários do sistema, credenciais e papéis.
- **Products**: Catálogo de produtos, códigos de barras (EAN/Caixa), localização.
- **Orders**: Cabeçalho dos pedidos (Cliente, Valor, Status).
- **OrderItems**: Itens do pedido, quantidades solicitadas vs. atendidas.
- **WorkUnits**: Tarefas ativas, controle de locks e status da tarefa.
- **Exceptions**: Ocorrências durante o processo (Avaria, Falta).
- **AuditLogs**: Rastreabilidade de ações.
- **Routes/Sections**: Organização logística (Rotas de entrega, Seções do armazém).

## 5. Requisitos Não Funcionais

- **Performance**: Resposta rápida para coletores de dados e interação ágil nas listas.
- **Usabilidade**: Interface limpa e otimizada para dispositivos móveis (coletores) e desktops.
- **Confiabilidade**: Garantia de integridade dos dados, especialmente em operações concorrentes (locks).
- **Segurança**: Senhas hash (bcrypt), proteção contra acesso não autorizado.

## 6. Fluxos de Status

### Fluxo de Pedido
1. **Pendente**: Pedido importado, aguardando início.
2. **Em Separação**: Unidade de trabalho criada e bloqueada por um separador.
3. **Separado**: Todos os itens separados.
4. **Em Conferência**: Bloqueado por um conferente.
5. **Finalizado**: Conferência concluída com sucesso.

### Fluxo de Exceção
- Caso um item não seja encontrado ou esteja avariado, uma exceção é gerada e associada ao item/pedido, requerendo intervenção ou validação posterior.
