# GLA Stock - Warehouse Management System

## Overview

GLA Stock (formerly GLA WMS) is a warehouse management system designed for logistics operations in Brazil. It manages the full lifecycle of warehouse order fulfillment — from order entry via ERP synchronization through picking (separação), verification (conferência), and counter service (balcão) workflows. The system is optimized for handheld Zebra TC21 collector devices with compact, touch-friendly UIs.

The system uses a work unit model where atomic tasks are assigned to operators with a locking mechanism (TTL + heartbeat) to prevent concurrent conflicts. Orders flow through defined status states: `pendente` → `em_separacao` → `separado` → `em_conferencia` → `conferido` → `finalizado`. Role-based access control ensures supervisors, pickers, verifiers, and counter attendants each see only their relevant interfaces.

### Module Color Themes
- **Separação**: Blue theme (hsl 210) — `data-module="separacao"`
- **Conferência**: Teal theme (hsl 168) — `data-module="conferencia"`
- **Balcão**: Amber theme (hsl 30) — `data-module="balcao"`

### Module Workflow Patterns
All three operational modules (Separação, Conferência, Balcão) follow the same handheld-optimized multi-step flow:
1. **Select**: Choose orders with checkboxes, filter by date range and order ID
2. **Scan Cart**: Scan a cart/pallet QR code to associate with the session
3. **Picking/Checking**: Scan barcodes to process items, with product view and list view tabs

Key differences:
- **Separação**: Filters by user's assigned sections, shows pending orders, tracks separatedQty vs quantity
- **Conferência**: Shows ALL sections (no section filter), only separated orders, tracks checkedQty vs separatedQty
- **Balcão**: Shows ALL sections (no section filter), any order (except finalizado), tracks separatedQty vs quantity, includes elapsed timer

The project lives primarily in the `GLA_WMS_Test/` directory, which contains the full application. The root-level `package.json` is minimal and separate from the actual application.

## User Preferences

Preferred communication style: Simple, everyday language.

## System Architecture

### Directory Structure
- `GLA_WMS_Test/` — Main application root
  - `client/` — React frontend (Vite-based SPA)
    - `client/src/pages/` — Pages organized by role (supervisor, separacao, conferencia, balcao)
    - `client/src/components/ui/` — shadcn/ui component library
  - `server/` — Express backend
    - `server/index.ts` — Express app entry point
    - `server/routes.ts` — All API route registration under `/api/*`
    - `server/storage.ts` — Data access layer implementing `IStorage` interface
    - `server/auth.ts` — Authentication helpers (bcrypt, JWT/cookie tokens, session management)
    - `server/db.ts` — Drizzle ORM connection to PostgreSQL
    - `server/seed.ts` — Database seeding with default users and test data
    - `server/sse.ts` — Server-Sent Events for real-time updates
    - `server/vite.ts` — Vite dev server middleware integration
    - `server/static.ts` — Production static file serving
  - `shared/schema.ts` — Drizzle ORM schema definitions (single source of truth for types)
  - `script/build.ts` — Production build script (esbuild + vite)
  - `sync_db2.py` — Python script for ERP (DB2) → local database synchronization

### Frontend Architecture
- **Framework**: React 18 with TypeScript
- **Build Tool**: Vite with `@vitejs/plugin-react`
- **Routing**: Wouter (lightweight client-side router)
- **Server State**: TanStack React Query with session-controlled cache invalidation
- **UI Components**: shadcn/ui (Radix primitives) with Tailwind CSS, themed via CSS custom properties
- **Form Handling**: React Hook Form with Zod validation
- **Date Utilities**: date-fns
- **Path Aliases**: `@/` → `client/src/`, `@shared/` → `shared/`

### Backend Architecture
- **Runtime**: Node.js with Express (ESM modules via `"type": "module"`)
- **Language**: TypeScript (transpiled with tsx)
- **ORM**: Drizzle ORM with PostgreSQL dialect (`drizzle-orm/node-postgres`)
- **Database Connection**: `pg` (node-postgres) Pool, connection string from `DATABASE_URL` env var
- **Authentication**: Custom token-based sessions stored in HttpOnly cookies with bcrypt password hashing
- **Real-time**: Server-Sent Events (SSE) for broadcasting status changes to connected clients
- **API Pattern**: RESTful routes under `/api/*`, storage layer abstracts all DB operations

### Database
- **Production Database**: PostgreSQL (configured via `DATABASE_URL` environment variable)
- **ORM**: Drizzle ORM with schema defined in `shared/schema.ts`
- **Migration Tool**: Drizzle Kit (`drizzle-kit push` for schema sync)
- **Historical Note**: The project migrated from SQLite (better-sqlite3) to PostgreSQL. Some legacy Python/JS migration scripts reference SQLite but the current codebase targets PostgreSQL exclusively.

### Key Database Tables (from `shared/schema.ts`)
- `users` — User accounts with roles (`supervisor`, `separacao`, `conferencia`, `balcao`) and section assignments
- `orders` — Orders synced from ERP with status tracking and financial status
- `order_items` — Individual items within orders with separation/verification quantities
- `products` — Product catalog with barcode and box barcode fields
- `work_units` — Atomic work tasks with locking, assignment, and completion tracking
- `routes` — Delivery routes
- `sections` — Warehouse sections (numbered, named)
- `section_groups` — Groups of sections for operator assignment
- `db2_mappings` — DB2-to-app field mapping configurations with versioning and active status
- `exceptions` — Exception records (damaged, missing, expired items)
- `audit_logs` — Full audit trail of system actions
- `sessions` — Auth sessions with tokens, session keys, and expiration
- `picking_sessions` — Multi-order picking session tracking
- `manual_qty_rules` — Rules for allowing manual quantity entry (by product_code, barcode, description_keyword, manufacturer)

### Authentication & Authorization
- JWT-style tokens stored in HttpOnly cookies (cookie name: `authToken`)
- bcrypt for password hashing (cost factor 10)
- Session table with unique session keys for cache invalidation on logout
- 24-hour token expiry
- RBAC middleware: `isAuthenticated`, `requireRole` protect API routes
- Five roles: `administrador` (full access to all modules), `supervisor` (management access), `separacao` (picking), `conferencia` (verification), `balcao` (counter)

### Work Unit & Locking System
- Work units are atomic tasks derived from orders (one per section/pickup-point combination)
- Lock mechanism with 15-minute TTL prevents concurrent operations on the same work unit
- Heartbeat system extends locks for active sessions
- Supervisors can force-unlock stuck work units
- State machine: `pendente` → `em_andamento` → `concluido` (with `recontagem` and `excecao` branches)

### ERP Synchronization
- Python script (`sync_db2.py`) connects to IBM DB2 via pyodbc to pull order data
- Can run in loop mode (periodic sync) or one-shot mode
- Triggered manually via `/api/sync` endpoint (authenticated)
- Historical staging concept: ERP data flows into a cache table, then gets processed into operational tables
- Supports dynamic field mapping: when active mappings exist in `db2_mappings` table, sync uses them instead of hardcoded column references
- Falls back to legacy hardcoded mapping when no active mapping is found

### Mapping Studio
- Visual interface for mapping DB2 columns to application fields without code editing
- Accessible from supervisor dashboard at `/supervisor/mapping-studio`
- Supports 3 datasets: orders, products, order_items (work_units are derived automatically)
- Data contracts define the fields each dataset expects (appField, type, required, description, example)
- Mappings are versioned and can be activated/deactivated
- Preview/Test feature applies mapping to cached DB2 data and shows 20 transformed rows
- Cast options: string, number, divide_100, divide_1000, boolean_T_F
- API endpoints: GET/POST `/api/mapping/:dataset`, GET `/api/schema/:dataset`, POST `/api/preview/:dataset`
- Server file: `server/data-contracts.ts` defines field inventories per dataset

### Build & Development
- **Dev**: `npm run dev` → runs `tsx server/index.ts` with Vite middleware for HMR
- **Build**: `npm run build` → Vite builds client to `dist/public/`, esbuild bundles server to `dist/index.cjs`
- **Start**: `npm run start` → runs production `node dist/index.cjs`
- **Schema Push**: `npm run db:push` → `drizzle-kit push` syncs schema to database
- **Testing**: Playwright for E2E tests, Vitest for unit tests

## External Dependencies

### Database
- **PostgreSQL** — Primary operational database, connected via `DATABASE_URL` environment variable using the `pg` (node-postgres) driver

### ERP Integration
- **IBM DB2** — Source ERP system accessed via pyodbc (Python) for order synchronization. Connection string configured in `sync_db2.py` with DSN-based ODBC configuration

### Key NPM Dependencies
- `express` — HTTP server framework
- `drizzle-orm` + `pg` — Database ORM and PostgreSQL driver
- `bcrypt` — Password hashing
- `cookie-parser` — Cookie parsing middleware
- `zod` + `drizzle-zod` — Schema validation
- `@tanstack/react-query` — Server state management
- `wouter` — Client-side routing
- `date-fns` — Date manipulation
- `tailwindcss` — Utility-first CSS
- shadcn/ui component library (Radix UI primitives)

### Python Dependencies (for sync script)
- `pyodbc` — DB2/ODBC database connectivity
- `sqlite3` (stdlib) — Legacy local caching (historical, being phased out)

### Environment Variables Required
- `DATABASE_URL` — PostgreSQL connection string (required)
- `NODE_ENV` — `development` or `production`