import { pgTable, text, integer, real, boolean as pgBoolean, jsonb, serial, doublePrecision, unique } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";

const boolean = (name: string) => pgBoolean(name);
const timestamp = (name: string) => text(name);

export const userRoleEnum = ["administrador", "supervisor", "separacao", "conferencia", "balcao"] as const;
export type UserRole = typeof userRoleEnum[number];

export const orderStatusEnum = ["pendente", "em_separacao", "separado", "em_conferencia", "conferido", "finalizado", "cancelado"] as const;
export type OrderStatus = typeof orderStatusEnum[number];

export const workUnitStatusEnum = ["pendente", "em_andamento", "concluido", "recontagem", "excecao"] as const;
export type WorkUnitStatus = typeof workUnitStatusEnum[number];

export const itemStatusEnum = ["pendente", "separado", "conferido", "excecao", "recontagem"] as const;
export type ItemStatus = typeof itemStatusEnum[number];

export const exceptionTypeEnum = ["nao_encontrado", "avariado", "vencido"] as const;
export type ExceptionType = typeof exceptionTypeEnum[number];

export const workUnitTypeEnum = ["separacao", "conferencia", "balcao"] as const;
export type WorkUnitType = typeof workUnitTypeEnum[number];

export interface UserSettings {
  allowManualQty?: boolean;
  allowMultiplier?: boolean;
}

export const users = pgTable("users", {
  id: text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
  username: text("username").notNull(),
  password: text("password").notNull(),
  name: text("name").notNull(),
  role: text("role").notNull().default("separacao").$type<UserRole>(),
  sections: jsonb("sections"),
  settings: jsonb("settings").$type<UserSettings>().default({}),
  active: boolean("active").notNull().default(true),
  createdAt: timestamp("created_at").notNull().default(new Date().toISOString()),
});

export const routes = pgTable("routes", {
  id: text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
  code: text("code").notNull(),
  name: text("name").notNull(),
  description: text("description"),
  active: boolean("active").notNull().default(true),
  createdAt: timestamp("created_at").notNull().default(new Date().toISOString()),
});

export const sections = pgTable("sections", {
  id: integer("id").primaryKey(),
  name: text("name").notNull(),
});

export const sectionGroups = pgTable("section_groups", {
  id: text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
  name: text("name").notNull(),
  sections: jsonb("sections").$type<string[]>().notNull(),
  createdAt: timestamp("created_at").notNull().default(new Date().toISOString()),
  updatedAt: timestamp("updated_at").notNull().default(new Date().toISOString()),
});

export const cacheOrcamentos = pgTable("cache_orcamentos", {
  id: serial("id").primaryKey(),
  chave: text("CHAVE").notNull(),
  idEmpresa: integer("IDEMPRESA"),
  idOrcamento: integer("IDORCAMENTO"),
  idProduto: text("IDPRODUTO"),
  idSubProduto: text("IDSUBPRODUTO"),
  numSequencia: integer("NUMSEQUENCIA"),
  qtdProduto: doublePrecision("QTDPRODUTO"),
  unidade: text("UNIDADE"),
  fabricante: text("FABRICANTE"),
  valUnitBruto: doublePrecision("VALUNITBRUTO"),
  valTotLiquido: doublePrecision("VALTOTLIQUIDO"),
  descrResProduto: text("DESCRRESPRODUTO"),
  idVendedor: text("IDVENDEDOR"),
  idLocalRetirada: integer("IDLOCALRETIRADA"),
  idSecao: integer("IDSECAO"),
  descrSecao: text("DESCRSECAO"),
  tipoEntrega: text("TIPOENTREGA"),
  nomeVendedor: text("NOMEVENDEDOR"),
  tipoEntregaDescr: text("TIPOENTREGA_DESCR"),
  localRetEstoque: text("LOCALRETESTOQUE"),
  flagCancelado: text("FLAGCANCELADO"),
  idCliFor: text("IDCLIFOR"),
  desCliente: text("DESCLIENTE"),
  dtMovimento: text("DTMOVIMENTO"),
  idRecebimento: text("IDRECEBIMENTO"),
  descrRecebimento: text("DESCRRECEBIMENTO"),
  flagPrenotaPaga: text("FLAGPRENOTAPAGA"),
  syncAt: text("sync_at"),
  codBarras: text("CODBARRAS"),
  codBarrasCaixa: text("CODBARRAS_CAIXA"),
});

export const products = pgTable("products", {
  id: text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
  erpCode: text("erp_code").notNull(),
  referenceCode: text("reference_code"),
  barcode: text("barcode"),
  boxBarcode: text("box_barcode"),
  name: text("name").notNull(),
  section: text("section").notNull(),
  pickupPoint: integer("pickup_point").notNull(),
  unit: text("unit").notNull().default("UN"),
  manufacturer: text("manufacturer"),
  price: doublePrecision("price").notNull().default(0),
  stockQty: doublePrecision("stock_qty").notNull().default(0),
  erpUpdatedAt: timestamp("erp_updated_at"),
});

export const orders = pgTable("orders", {
  id: text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
  erpOrderId: text("erp_order_id").notNull().unique(),
  customerName: text("customer_name").notNull(),
  customerCode: text("customer_code"),
  totalValue: doublePrecision("total_value").notNull().default(0),
  observation: text("observation"),
  status: text("status").notNull().default("pendente").$type<OrderStatus>(),
  priority: integer("priority").notNull().default(0),
  isLaunched: boolean("is_launched").notNull().default(false),
  routeId: text("route_id").references(() => routes.id),
  separationCode: text("separation_code"),
  pickupPoints: jsonb("pickup_points"),
  erpUpdatedAt: timestamp("erp_updated_at"),
  financialStatus: text("financial_status").notNull().default("pendente"),
  createdAt: timestamp("created_at").notNull().default(new Date().toISOString()),
  updatedAt: timestamp("updated_at").notNull().default(new Date().toISOString()),
});

export const orderItems = pgTable("order_items", {
  id: text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
  orderId: text("order_id").notNull().references(() => orders.id),
  productId: text("product_id").notNull().references(() => products.id),
  quantity: doublePrecision("quantity").notNull(),
  separatedQty: doublePrecision("separated_qty").notNull().default(0),
  checkedQty: doublePrecision("checked_qty").notNull().default(0),
  section: text("section").notNull(),
  pickupPoint: integer("pickup_point").notNull(),
  qtyPicked: doublePrecision("qty_picked").default(0),
  qtyChecked: doublePrecision("qty_checked").default(0),
  status: text("status").default("pendente").$type<ItemStatus>(),
  exceptionType: text("exception_type").$type<ExceptionType>(),
});

export const pickingSessions = pgTable("picking_sessions", {
  id: text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
  userId: text("user_id").notNull().references(() => users.id),
  orderId: text("order_id").notNull().references(() => orders.id),
  sectionId: text("section_id").notNull(),
  lastHeartbeat: timestamp("last_heartbeat").notNull().default(new Date().toISOString()),
  createdAt: timestamp("created_at").notNull().default(new Date().toISOString()),
}, (table) => ({
  unq: unique().on(table.orderId, table.sectionId),
}));

export const workUnits = pgTable("work_units", {
  id: text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
  orderId: text("order_id").notNull().references(() => orders.id),
  pickupPoint: integer("pickup_point").notNull(),
  section: text("section"),
  type: text("type").notNull().$type<WorkUnitType>(),
  status: text("status").notNull().default("pendente").$type<WorkUnitStatus>(),
  lockedBy: text("locked_by").references(() => users.id),
  lockedAt: timestamp("locked_at"),
  lockExpiresAt: timestamp("lock_expires_at"),
  cartQrCode: text("cart_qr_code"),
  palletQrCode: text("pallet_qr_code"),
  startedAt: timestamp("started_at"),
  completedAt: timestamp("completed_at"),
  createdAt: timestamp("created_at").notNull().default(new Date().toISOString()),
});

export const exceptions = pgTable("exceptions", {
  id: text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
  workUnitId: text("work_unit_id").references(() => workUnits.id),
  orderItemId: text("order_item_id").notNull().references(() => orderItems.id),
  type: text("type").notNull().$type<ExceptionType>(),
  quantity: doublePrecision("quantity").notNull(),
  observation: text("observation"),
  reportedBy: text("reported_by").notNull().references(() => users.id),
  createdAt: timestamp("created_at").notNull().default(new Date().toISOString()),
});

export const auditLogs = pgTable("audit_logs", {
  id: text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
  userId: text("user_id").references(() => users.id),
  action: text("action").notNull(),
  entityType: text("entity_type").notNull(),
  entityId: text("entity_id"),
  details: text("details"),
  previousValue: text("previous_value"),
  newValue: text("new_value"),
  ipAddress: text("ip_address"),
  userAgent: text("user_agent"),
  createdAt: timestamp("created_at").notNull().default(new Date().toISOString()),
});

export const sessions = pgTable("sessions", {
  id: text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
  userId: text("user_id").notNull().references(() => users.id),
  token: text("token").notNull(),
  sessionKey: text("session_key").notNull(),
  expiresAt: timestamp("expires_at").notNull(),
  createdAt: timestamp("created_at").notNull().default(new Date().toISOString()),
});

export const manualQtyRuleTypeEnum = ["product_code", "barcode", "description_keyword", "manufacturer"] as const;
export type ManualQtyRuleType = typeof manualQtyRuleTypeEnum[number];

export const manualQtyRules = pgTable("manual_qty_rules", {
  id: text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
  ruleType: text("rule_type").notNull().$type<ManualQtyRuleType>(),
  value: text("value").notNull(),
  description: text("description"),
  active: boolean("active").notNull().default(true),
  createdBy: text("created_by").references(() => users.id),
  createdAt: timestamp("created_at").notNull().default(new Date().toISOString()),
});

export const insertUserSchema = createInsertSchema(users).omit({ id: true, createdAt: true });
export const insertRouteSchema = createInsertSchema(routes).omit({ id: true }).extend({ code: z.string().optional() });
export const insertSectionSchema = createInsertSchema(sections);
export const insertProductSchema = createInsertSchema(products).omit({ id: true });
export const insertOrderSchema = createInsertSchema(orders).omit({ id: true, createdAt: true, updatedAt: true });
export const insertOrderItemSchema = createInsertSchema(orderItems).omit({ id: true });
export const insertWorkUnitSchema = createInsertSchema(workUnits).omit({ id: true });
export const insertPickingSessionSchema = createInsertSchema(pickingSessions).omit({ id: true, createdAt: true, lastHeartbeat: true });
export const insertExceptionSchema = createInsertSchema(exceptions).omit({ id: true, createdAt: true });
export const insertAuditLogSchema = createInsertSchema(auditLogs).omit({ id: true, createdAt: true });
export const insertManualQtyRuleSchema = createInsertSchema(manualQtyRules).omit({ id: true, createdAt: true });

export type InsertUser = z.infer<typeof insertUserSchema>;
export type User = typeof users.$inferSelect;
export type InsertRoute = z.infer<typeof insertRouteSchema>;
export type Route = typeof routes.$inferSelect;
export type InsertProduct = z.infer<typeof insertProductSchema>;
export type Product = typeof products.$inferSelect;
export type InsertOrder = z.infer<typeof insertOrderSchema>;
export type Order = typeof orders.$inferSelect;
export type InsertOrderItem = z.infer<typeof insertOrderItemSchema>;
export type OrderItem = typeof orderItems.$inferSelect;
export type InsertWorkUnit = z.infer<typeof insertWorkUnitSchema>;
export type WorkUnit = typeof workUnits.$inferSelect;
export type InsertPickingSession = z.infer<typeof insertPickingSessionSchema>;
export type PickingSession = typeof pickingSessions.$inferSelect;
export type InsertException = z.infer<typeof insertExceptionSchema>;
export type Exception = typeof exceptions.$inferSelect;
export type InsertAuditLog = z.infer<typeof insertAuditLogSchema>;
export type AuditLog = typeof auditLogs.$inferSelect;
export type Session = typeof sessions.$inferSelect;
export type SectionGroup = typeof sectionGroups.$inferSelect;
export type InsertSectionGroup = typeof sectionGroups.$inferInsert;
export type ManualQtyRule = typeof manualQtyRules.$inferSelect;
export type InsertManualQtyRule = z.infer<typeof insertManualQtyRuleSchema>;


export const db2Mappings = pgTable("db2_mappings", {
  id: text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
  dataset: text("dataset").notNull(),
  version: integer("version").notNull().default(1),
  isActive: boolean("is_active").notNull().default(false),
  mappingJson: jsonb("mapping_json").$type<MappingField[]>().notNull(),
  description: text("description"),
  createdBy: text("created_by").references(() => users.id),
  createdAt: timestamp("created_at").notNull().default(new Date().toISOString()),
  updatedAt: timestamp("updated_at").notNull().default(new Date().toISOString()),
});

export interface MappingField {
  appField: string;
  type: "string" | "number" | "date" | "boolean";
  required: boolean;
  dbExpression: string;
  cast?: string;
  defaultValue?: string;
}

export interface DataContractField {
  appField: string;
  type: "string" | "number" | "date" | "boolean";
  required: boolean;
  description: string;
  example: string;
}

export const datasetEnum = ["orders", "products", "order_items", "work_units"] as const;
export type DatasetName = typeof datasetEnum[number];

export type Db2Mapping = typeof db2Mappings.$inferSelect;
export type InsertDb2Mapping = typeof db2Mappings.$inferInsert;

export const loginSchema = z.object({
  username: z.string().min(1, "Usuário é obrigatório"),
  password: z.string().min(1, "Senha é obrigatória"),
});

export type LoginInput = z.infer<typeof loginSchema>;

export type OrderWithItems = Order & {
  items: (OrderItem & { product: Product })[];
  route?: Route | null;
  pickingSessions?: PickingSession[];
};

export type WorkUnitWithDetails = WorkUnit & {
  order: Order;
  items: (OrderItem & { product: Product })[];
  lockedByUser?: User | null;
};

export type Section = typeof sections.$inferSelect;
