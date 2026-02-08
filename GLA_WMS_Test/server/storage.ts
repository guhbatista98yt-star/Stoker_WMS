import { db } from "./db";
import { eq, and, sql, desc, inArray, isNull, gt, lt } from "drizzle-orm";
import {
  users, orders, orderItems, products, routes, workUnits, exceptions, auditLogs, sessions, sections, sectionGroups,
  type User, type InsertUser, type Order, type InsertOrder, type OrderItem, type InsertOrderItem,
  type Product, type InsertProduct, type Route, type InsertRoute, type WorkUnit, type InsertWorkUnit,
  type Exception, type InsertException, type AuditLog, type InsertAuditLog, type Session,
  type SectionGroup, type InsertSectionGroup, type Section, pickingSessions, type PickingSession, type InsertPickingSession,
} from "@shared/schema";
import { randomUUID } from "crypto";

export interface IStorage {
  // Users
  getUser(id: string): Promise<User | undefined>;
  getUserByUsername(username: string): Promise<User | undefined>;
  createUser(user: InsertUser): Promise<User>;
  getAllUsers(): Promise<User[]>;
  updateUser(id: string, user: Partial<User>): Promise<User | undefined>;

  // Sections
  getAllSections(): Promise<Section[]>;

  // Section Groups
  getAllSectionGroups(): Promise<SectionGroup[]>;
  getSectionGroupById(id: string): Promise<SectionGroup | undefined>;
  createSectionGroup(group: InsertSectionGroup): Promise<SectionGroup>;
  updateSectionGroup(id: string, group: Partial<InsertSectionGroup>): Promise<SectionGroup | undefined>;
  deleteSectionGroup(id: string): Promise<void>;

  // Sessions
  createSession(userId: string, token: string, sessionKey: string, expiresAt: Date): Promise<Session>;
  getSessionByToken(token: string): Promise<Session | undefined>;
  deleteSession(token: string): Promise<void>;

  // Routes
  getAllRoutes(): Promise<Route[]>;
  createRoute(route: InsertRoute): Promise<Route>;
  updateRoute(id: string, route: Partial<InsertRoute>): Promise<Route | undefined>;
  toggleRouteActive(id: string, active: boolean): Promise<Route | undefined>;

  // Products
  getAllProducts(): Promise<Product[]>;
  getProductByBarcode(barcode: string): Promise<Product | undefined>;
  createProduct(product: InsertProduct): Promise<Product>;

  // Orders
  getAllOrders(): Promise<Order[]>;
  getOrderById(id: string): Promise<Order | undefined>;
  getOrderWithItems(id: string): Promise<(Order & { items: (OrderItem & { product: Product })[] }) | undefined>;
  createOrder(order: InsertOrder): Promise<Order>;
  updateOrder(id: string, data: Partial<Order>): Promise<Order | undefined>;
  assignRouteToOrders(orderIds: string[], routeId: string | null): Promise<void>;
  setOrderPriority(orderIds: string[], priority: number): Promise<void>;
  launchOrders(orderIds: string[]): Promise<void>;
  checkAndUpdateOrderStatus(orderId: string): Promise<WorkUnit | null>;

  // Order Items
  createOrderItem(item: InsertOrderItem): Promise<OrderItem>;
  getOrderItemsByOrderId(orderId: string): Promise<(OrderItem & { product: Product; exceptionQty?: number })[]>;
  updateOrderItem(id: string, data: Partial<OrderItem>): Promise<OrderItem | undefined>;
  relaunchOrder(orderId: string): Promise<void>;

  // Work Units
  getWorkUnits(type?: string): Promise<(WorkUnit & { order: Order; items: (OrderItem & { product: Product; exceptionQty?: number })[] })[]>;
  getWorkUnitById(id: string): Promise<(WorkUnit & { order: Order; items: (OrderItem & { product: Product; exceptionQty?: number })[] }) | undefined>;
  createWorkUnit(workUnit: InsertWorkUnit): Promise<WorkUnit>;
  updateWorkUnit(id: string, data: Partial<WorkUnit>): Promise<WorkUnit | undefined>;
  lockWorkUnits(workUnitIds: string[], userId: string, expiresAt: Date): Promise<void>;
  unlockWorkUnits(workUnitIds: string[]): Promise<void>;

  // Exceptions
  getAllExceptions(): Promise<(Exception & { orderItem: OrderItem & { product: Product }; reportedByUser: User; workUnit: WorkUnit })[]>;
  createException(exception: InsertException): Promise<Exception>;
  deleteExceptionsForItem(orderItemId: string): Promise<void>;

  // Audit Logs
  createAuditLog(log: InsertAuditLog): Promise<AuditLog>;

  // Stats
  getOrderStats(): Promise<{ pendentes: number; emSeparacao: number; separados: number; conferidos: number; excecoes: number }>;

  // Reports
  getPickingListReportData(filters: { orderIds?: string[]; pickupPoints?: string[]; sections?: string[] }): Promise<{
    section: string;
    pickupPoint: number;
    items: (OrderItem & { product: Product; order: Order })[];
  }[]>;

  // Picking Sessions
  createPickingSession(session: InsertPickingSession): Promise<PickingSession>;
  getPickingSession(orderId: string, sectionId: string): Promise<PickingSession | undefined>;
  updatePickingSessionHeartbeat(id: string): Promise<void>;
  deletePickingSession(orderId: string, sectionId: string): Promise<void>;
  getPickingSessionsByOrder(orderId: string): Promise<PickingSession[]>;
}

export class DatabaseStorage implements IStorage {
  // Users
  async getUser(id: string): Promise<User | undefined> {
    const [user] = await db.select().from(users).where(eq(users.id, id));
    return user;
  }

  async getUserByUsername(username: string): Promise<User | undefined> {
    const [user] = await db.select().from(users).where(eq(users.username, username));
    return user;
  }

  async createUser(insertUser: InsertUser): Promise<User> {
    const user = {
      ...insertUser,
      role: insertUser.role as any, // Cast to match schema type
    };
    const [newUser] = await db.insert(users).values(user).returning();
    return newUser;
  }

  async getAllUsers(): Promise<User[]> {
    return db.select().from(users).orderBy(users.name);
  }

  async updateUser(id: string, userUpdate: Partial<User>): Promise<User | undefined> {
    const [updatedUser] = await db
      .update(users)
      .set(userUpdate)
      .where(eq(users.id, id))
      .returning();
    return updatedUser;
  }



  // Sessions
  async createSession(userId: string, token: string, sessionKey: string, expiresAt: Date): Promise<Session> {
    try {
      // console.log(`[STORAGE] createSession: userId=${userId}, token=${token}`);
      const [session] = await db.insert(sessions).values({
        userId,
        token,
        sessionKey,
        expiresAt: expiresAt.toISOString(),
      }).returning();
      return session;
    } catch (e: any) {
      console.error("[STORAGE] createSession ERROR:", e);
      console.error("Message:", e.message);
      throw e;
    }
  }

  async getSessionByToken(token: string): Promise<Session | undefined> {
    const [session] = await db.select().from(sessions)
      .where(and(eq(sessions.token, token), gt(sessions.expiresAt, new Date().toISOString())));
    return session;
  }

  async deleteSession(token: string): Promise<void> {
    await db.delete(sessions).where(eq(sessions.token, token));
  }

  // Routes
  async getAllRoutes(): Promise<Route[]> {
    return db.select().from(routes).orderBy(routes.name);
  }

  async createRoute(route: InsertRoute): Promise<Route> {
    if (!route.code) {
      // Auto-generate code from Name (slug) or UUID
      // Auto-generate code from Name (slug) or UUID
      let slug = route.name.toUpperCase().replace(/[^A-Z0-9]/g, "").substring(0, 10);
      if (!slug || slug.length === 0) {
        slug = `R-${Math.floor(Math.random() * 10000)}`;
      }
      route.code = slug;

      // Check existence
      const existing = await db.select().from(routes).where(eq(routes.code, route.code)).limit(1);
      if (existing.length > 0) {
        route.code = `${route.code}-${Math.floor(Math.random() * 999)}`;
      }
    }
    const [newRoute] = await db.insert(routes).values({
      ...route,
      code: route.code!,
    }).returning();
    return newRoute;
  }

  async updateRoute(id: string, route: Partial<InsertRoute>): Promise<Route | undefined> {
    const [updated] = await db.update(routes).set(route).where(eq(routes.id, id)).returning();
    return updated;
  }

  async toggleRouteActive(id: string, active: boolean): Promise<Route | undefined> {
    const [updated] = await db.update(routes).set({ active }).where(eq(routes.id, id)).returning();
    return updated;
  }

  // Products
  async getAllProducts(): Promise<Product[]> {
    return db.select().from(products).orderBy(products.name);
  }

  async getProductByBarcode(barcode: string): Promise<Product | undefined> {
    const [product] = await db.select().from(products).where(eq(products.barcode, barcode));
    return product;
  }

  async createProduct(product: InsertProduct): Promise<Product> {
    const [newProduct] = await db.insert(products).values(product).returning();
    return newProduct;
  }

  // Orders
  async getAllOrders(): Promise<(Order & { hasExceptions: boolean; totalItems: number; pickedItems: number })[]> {
    const allOrders = await db.select().from(orders).orderBy(desc(orders.priority), desc(orders.createdAt));

    // Get Exceptions
    const allExceptions = await db.select({ orderItemId: exceptions.orderItemId }).from(exceptions);
    const exceptionItemIds = new Set(allExceptions.map(e => e.orderItemId));

    // Get Item Stats
    const itemStats = await db.select({
      orderId: orderItems.orderId,
      total: sql<number>`count(*)`,
      picked: sql<number>`sum(case when ${orderItems.status} in ('separado', 'conferido', 'finalizado') then 1 else 0 end)`
    }).from(orderItems).groupBy(orderItems.orderId);

    const statsMap = new Map(itemStats.map(s => [s.orderId, { total: Number(s.total), picked: Number(s.picked) }]));

    const allItems = await db.select({ id: orderItems.id, orderId: orderItems.orderId }).from(orderItems);
    const ordersWithExceptions = new Set<string>();

    for (const item of allItems) {
      if (exceptionItemIds.has(item.id)) {
        ordersWithExceptions.add(item.orderId);
      }
    }

    return allOrders.map(o => {
      const stats = statsMap.get(o.id) || { total: 0, picked: 0 };
      return {
        ...o,
        hasExceptions: ordersWithExceptions.has(o.id),
        totalItems: stats.total,
        pickedItems: stats.picked
      };
    });
  }

  async getOrderById(id: string): Promise<Order | undefined> {
    const [order] = await db.select().from(orders).where(eq(orders.id, id));
    return order;
  }

  async getOrderWithItems(id: string): Promise<(Order & { items: (OrderItem & { product: Product })[] }) | undefined> {
    const [order] = await db.select().from(orders).where(eq(orders.id, id));
    if (!order) return undefined;

    const items = await this.getOrderItemsByOrderId(id);
    return { ...order, items };
  }

  async createOrder(order: InsertOrder): Promise<Order> {
    const [newOrder] = await db.insert(orders).values({
      ...order,
      status: (order.status || "pendente") as any,
    }).returning();
    return newOrder;
  }

  async updateOrder(id: string, data: Partial<Order>): Promise<Order | undefined> {
    const [updated] = await db.update(orders)
      .set({ ...data, updatedAt: new Date().toISOString() })
      .where(eq(orders.id, id))
      .returning();
    return updated;
  }

  async assignRouteToOrders(orderIds: string[], routeId: string | null): Promise<void> {
    await db.update(orders)
      .set({ routeId, updatedAt: new Date().toISOString() })
      .where(inArray(orders.id, orderIds));
  }

  async setOrderPriority(orderIds: string[], priority: number): Promise<void> {
    await db.update(orders)
      .set({ priority, updatedAt: new Date().toISOString() })
      .where(inArray(orders.id, orderIds));
  }

  async launchOrders(orderIds: string[]): Promise<void> {
    await db.update(orders)
      .set({
        isLaunched: true,
        status: "em_separacao", // Explicitly set status
        updatedAt: new Date().toISOString()
      })
      .where(inArray(orders.id, orderIds));
  }

  async checkAndUpdateOrderStatus(orderId: string): Promise<WorkUnit | null> {
    const items = await this.getOrderItemsByOrderId(orderId);

    // Check if all items are fully picked (qtyPicked >= quantity)
    // Note: status might be 'separado' on item level.
    const allPicked = items.every(i => Number(i.qtyPicked) >= Number(i.quantity));
    let createdWorkUnit: WorkUnit | null = null;

    if (allPicked) {
      await db.update(orders)
        .set({
          status: "separado",
          updatedAt: new Date().toISOString()
        })
        .where(eq(orders.id, orderId));

      // Create Conference WorkUnit
      // Check if exists first
      const existing = await db.select().from(workUnits)
        .where(and(
          eq(workUnits.orderId, orderId),
          eq(workUnits.type, "conferencia")
        ))
        .limit(1);

      if (existing.length === 0) {
        [createdWorkUnit] = await db.insert(workUnits).values({
          orderId,
          type: "conferencia",
          status: "pendente",
          pickupPoint: 0,
        }).returning();
      }
    } else {
      // Ensure status is em_separacao if launched and not all picked
      // (Optional, but good for consistency if it was somehow reverted)
      await db.update(orders)
        .set({ status: "em_separacao" })
        .where(and(eq(orders.id, orderId), eq(orders.isLaunched, true), eq(orders.status, "pendente")));
    }
    return createdWorkUnit;
  }

  // Order Items
  async createOrderItem(item: InsertOrderItem): Promise<OrderItem> {
    const [newItem] = await db.insert(orderItems).values({
      orderId: item.orderId,
      productId: item.productId,
      quantity: item.quantity,
      section: item.section,
      pickupPoint: item.pickupPoint, // Ensure this exists in item
      status: (item.status || "pendente") as any,
      qtyPicked: item.qtyPicked || 0,
      qtyChecked: item.qtyChecked || 0,
      exceptionType: item.exceptionType as any,
      separatedQty: item.separatedQty || 0,
      checkedQty: item.checkedQty || 0,
    }).returning();
    return newItem;
  }

  async getOrderItemsByOrderId(orderId: string): Promise<(OrderItem & { product: Product; exceptionQty?: number })[]> {
    const items = await db.select().from(orderItems).where(eq(orderItems.orderId, orderId));

    // Fetch products
    const itemsWithProduct = await Promise.all(items.map(async (item) => {
      const [product] = await db.select().from(products).where(eq(products.id, item.productId));
      return { ...item, product };
    }));

    return itemsWithProduct;
  }

  async updateOrderItem(id: string, data: Partial<OrderItem>): Promise<OrderItem | undefined> {
    const [updated] = await db.update(orderItems)
      .set(data)
      .where(eq(orderItems.id, id))
      .returning();
    return updated;
  }

  async relaunchOrder(orderId: string): Promise<void> {
    // Reset Order
    await db.update(orders)
      .set({
        status: "pendente",
        isLaunched: true, // Ensure it's launched
        updatedAt: new Date().toISOString()
      })
      .where(eq(orders.id, orderId));

    // Reset Work Units
    await db.update(workUnits)
      .set({
        status: "pendente",
        lockedBy: null,
        lockedAt: null,
        lockExpiresAt: null,
        startedAt: null,
        completedAt: null,
        cartQrCode: null,
        palletQrCode: null
      })
      .where(eq(workUnits.orderId, orderId));

    // Reset Order Items
    await db.update(orderItems)
      .set({
        status: "pendente",
        separatedQty: 0,
        checkedQty: 0
      })
      .where(eq(orderItems.orderId, orderId));

    // Delete all exceptions for this order
    const orderItemIds = await db.select({ id: orderItems.id })
      .from(orderItems)
      .where(eq(orderItems.orderId, orderId));

    for (const item of orderItemIds) {
      await db.delete(exceptions).where(eq(exceptions.orderItemId, item.id));
    }
  }

  // Work Units
  // Work Units
  async getWorkUnits(type?: string): Promise<(WorkUnit & { order: Order; items: (OrderItem & { product: Product; exceptionQty?: number })[] })[]> {
    const query = type
      ? db.select().from(workUnits).where(eq(workUnits.type, type as any))
      : db.select().from(workUnits);

    const wus = await query;
    if (wus.length === 0) return [];

    const orderIds = [...new Set(wus.map(wu => wu.orderId))];

    // Fetch Orders
    const ordersData = await db.select().from(orders).where(inArray(orders.id, orderIds));
    const ordersMap = new Map(ordersData.map(o => [o.id, o]));

    // Fetch Items
    const itemsData = await db.select().from(orderItems).where(inArray(orderItems.orderId, orderIds));

    // Fetch Products
    const productIds = [...new Set(itemsData.map(i => i.productId))];
    const productsData = productIds.length > 0
      ? await db.select().from(products).where(inArray(products.id, productIds))
      : [];
    const productsMap = new Map(productsData.map(p => [p.id, p]));

    // Fetch Exceptions
    const itemIds = itemsData.map(i => i.id);
    const exceptionsData = itemIds.length > 0
      ? await db.select().from(exceptions).where(inArray(exceptions.orderItemId, itemIds))
      : [];

    // Group exceptions by itemId
    const exceptionsMap = new Map<string, number>(); // itemId -> totalQty
    for (const exc of exceptionsData) {
      const current = exceptionsMap.get(exc.orderItemId) || 0;
      exceptionsMap.set(exc.orderItemId, current + Number(exc.quantity));
    }

    // Assemble Items
    const itemsByOrder = new Map<string, (OrderItem & { product: Product; exceptionQty?: number })[]>();
    for (const item of itemsData) {
      const product = productsMap.get(item.productId);
      if (!product) continue;

      const exceptionQty = exceptionsMap.get(item.id) || 0;
      const fullItem = { ...item, product, exceptionQty };

      const list = itemsByOrder.get(item.orderId) || [];
      list.push(fullItem);
      itemsByOrder.set(item.orderId, list);
    }

    // Assemble Result
    const result: (WorkUnit & { order: Order; items: (OrderItem & { product: Product; exceptionQty?: number })[] })[] = [];

    for (const wu of wus) {
      const order = ordersMap.get(wu.orderId);
      if (order) {
        const allItems = itemsByOrder.get(wu.orderId) || [];
        const filteredItems = wu.section
          ? allItems.filter(i => i.section === wu.section && i.pickupPoint === wu.pickupPoint)
          : allItems.filter(i => i.pickupPoint === wu.pickupPoint);
        result.push({ ...wu, order, items: filteredItems });
      }
    }

    return result;
  }

  async getWorkUnitById(id: string): Promise<(WorkUnit & { order: Order; items: (OrderItem & { product: Product; exceptionQty?: number })[] }) | undefined> {
    const [wu] = await db.select().from(workUnits).where(eq(workUnits.id, id));
    if (!wu) return undefined;

    const [order] = await db.select().from(orders).where(eq(orders.id, wu.orderId));
    if (!order) return undefined;

    const items = await this.getOrderItemsByOrderId(wu.orderId);
    const filteredItems = wu.section
      ? items.filter(i => i.section === wu.section && i.pickupPoint === wu.pickupPoint)
      : items.filter(i => i.pickupPoint === wu.pickupPoint);

    return { ...wu, order, items: filteredItems };
  }

  async createWorkUnit(workUnit: InsertWorkUnit): Promise<WorkUnit> {
    const [newWu] = await db.insert(workUnits).values({
      ...workUnit,
      type: workUnit.type as any,
      status: (workUnit.status || "pendente") as any,
    }).returning();
    return newWu;
  }

  async updateWorkUnit(id: string, data: Partial<WorkUnit>): Promise<WorkUnit | undefined> {
    const [updated] = await db.update(workUnits)
      .set(data)
      .where(eq(workUnits.id, id))
      .returning();
    return updated;
  }

  async lockWorkUnits(workUnitIds: string[], userId: string, expiresAt: Date): Promise<void> {
    await db.update(workUnits)
      .set({
        lockedBy: userId,
        lockedAt: new Date().toISOString(),
        lockExpiresAt: expiresAt.toISOString(),
        // status: "em_andamento", // Status update moved to scan-cart
        // startedAt: new Date().toISOString(), // Moved to scan-cart
      })
      .where(inArray(workUnits.id, workUnitIds));
  }

  async unlockWorkUnits(workUnitIds: string[]): Promise<void> {
    await db.update(workUnits)
      .set({
        status: "pendente",
        lockedBy: null,
        lockedAt: null,
        lockExpiresAt: null,
      })
      .where(inArray(workUnits.id, workUnitIds));
  }

  async resetWorkUnitProgress(id: string): Promise<void> {
    const [workUnit] = await db.select().from(workUnits).where(eq(workUnits.id, id));
    if (!workUnit) return;

    // Reset items logic: Match by OrderId, Section (if present), PickupPoint
    // Note: Section in WorkUnit might be null, but OrderItem section is NotNull. 
    // If WorkUnit section is null, does it imply ALL sections? Or is it just logic?
    // Based on scanning logic, we match exactly.

    // Construct where clause
    const whereClause = and(
      eq(orderItems.orderId, workUnit.orderId),
      eq(orderItems.pickupPoint, workUnit.pickupPoint),
      // If workUnit.section is null, we might be in a mode where section doesn't matter?
      // But usually it matches. Let's assume strict match if workUnit.section is present.
      workUnit.section ? eq(orderItems.section, workUnit.section) : undefined
    );

    const items = await db.select().from(orderItems).where(whereClause);

    for (const item of items) {
      // Reset item
      await db.update(orderItems)
        .set({ separatedQty: 0, status: "pendente" })
        .where(eq(orderItems.id, item.id));

      // Delete exceptions
      await db.delete(exceptions).where(eq(exceptions.orderItemId, item.id));
    }

    // Reset WorkUnit
    await db.update(workUnits)
      .set({
        status: "pendente",
        startedAt: null,
        cartQrCode: null
      })
      .where(eq(workUnits.id, id));
  }



  async checkAndCompleteWorkUnit(id: string): Promise<boolean> {
    const [workUnit] = await db.select().from(workUnits).where(eq(workUnits.id, id));
    if (!workUnit) return false;

    // Manual items fetch matching reset logic
    const whereClause = and(
      eq(orderItems.orderId, workUnit.orderId),
      eq(orderItems.pickupPoint, workUnit.pickupPoint),
      workUnit.section ? eq(orderItems.section, workUnit.section) : undefined
    );
    const items = await db.select().from(orderItems).where(whereClause);

    // Get exceptions for this work unit
    const unitExceptions = await db.select().from(exceptions).where(eq(exceptions.workUnitId, id));

    const allComplete = items.every(item => {
      const itemExcs = unitExceptions.filter(e => e.orderItemId === item.id);
      const excQty = itemExcs.reduce((sum, e) => sum + Number(e.quantity), 0);
      const isItemDone = Number(item.separatedQty) + excQty >= Number(item.quantity);
      console.log(`Debug WU ${id}: Item ${item.id} status - Sep: ${item.separatedQty}, Exc: ${excQty}, Target: ${item.quantity}. Done: ${isItemDone}`);
      return isItemDone;
    });

    console.log(`Debug WU ${id}: All Complete ? ${allComplete} `);

    if (allComplete) {
      await db.update(workUnits)
        .set({ status: "concluido", completedAt: new Date().toISOString() })
        .where(eq(workUnits.id, id));
      return true;
    }
    return false;
  }

  async adjustItemQuantityForException(orderItemId: string): Promise<void> {
    const [item] = await db.select().from(orderItems).where(eq(orderItems.id, orderItemId));
    if (!item) return;

    const itemExceptions = await db.select().from(exceptions).where(eq(exceptions.orderItemId, orderItemId));
    const totalExceptionQty = itemExceptions.reduce((sum, e) => sum + Number(e.quantity), 0);

    const currentSeparated = Number(item.separatedQty);
    const target = Number(item.quantity);

    // Logic: separated + exception should not exceed target?
    // Or strictly: separated cannot exceed (target - exception).
    // The user implies they are converting separated to exception.

    const maxSeparated = Math.max(0, target - totalExceptionQty);

    if (currentSeparated > maxSeparated) {
      await db.update(orderItems)
        .set({ separatedQty: maxSeparated })
        .where(eq(orderItems.id, orderItemId));
    }
  }

  async canCreateException(orderItemId: string, newQuantity: number): Promise<boolean> {
    const [item] = await db.select().from(orderItems).where(eq(orderItems.id, orderItemId));
    if (!item) return false;

    const itemExceptions = await db.select().from(exceptions).where(eq(exceptions.orderItemId, orderItemId));
    const currentExceptionQty = itemExceptions.reduce((sum, e) => sum + Number(e.quantity), 0);

    return (currentExceptionQty + Number(newQuantity)) <= Number(item.quantity);
  }

  // Exceptions
  async getAllExceptions(): Promise<(Exception & { orderItem: OrderItem & { product: Product }; reportedByUser: User; workUnit: WorkUnit })[]> {
    const excs = await db.select().from(exceptions).orderBy(desc(exceptions.createdAt));
    const result: (Exception & { orderItem: OrderItem & { product: Product }; reportedByUser: User; workUnit: WorkUnit })[] = [];

    for (const exc of excs) {
      const [item] = await db.select().from(orderItems).where(eq(orderItems.id, exc.orderItemId));
      const [product] = item ? await db.select().from(products).where(eq(products.id, item.productId)) : [undefined];
      const [user] = await db.select().from(users).where(eq(users.id, exc.reportedBy));
      const [wu] = exc.workUnitId ? await db.select().from(workUnits).where(eq(workUnits.id, exc.workUnitId)) : [undefined];

      if (item && product && user && wu) {
        result.push({
          ...exc,
          orderItem: { ...item, product },
          reportedByUser: user,
          workUnit: wu,
        });
      }
    }

    return result;
  }

  async createException(exception: InsertException): Promise<Exception> {
    const [newExc] = await db.insert(exceptions).values({
      ...exception,
      type: exception.type as any,
    }).returning();
    return newExc;
  }

  async deleteExceptionsForItem(orderItemId: string): Promise<void> {
    await db.delete(exceptions).where(eq(exceptions.orderItemId, orderItemId));
  }

  // Audit Logs
  async createAuditLog(log: InsertAuditLog): Promise<AuditLog> {
    const [newLog] = await db.insert(auditLogs).values(log).returning();
    return newLog;
  }

  async getAllSections(): Promise<Section[]> {
    return db.select().from(sections).orderBy(sections.id);
  }

  // Section Groups
  async getAllSectionGroups(): Promise<SectionGroup[]> {
    return await db.select().from(sectionGroups);
  }

  async getSectionGroupById(id: string): Promise<SectionGroup | undefined> {
    const [group] = await db.select().from(sectionGroups).where(eq(sectionGroups.id, id));
    return group;
  }

  async createSectionGroup(group: InsertSectionGroup): Promise<SectionGroup> {
    console.log('Storage: Creating section group:', group);
    try {
      const [newGroup] = await db.insert(sectionGroups).values(group).returning();
      console.log('Storage: Group created:', newGroup);
      return newGroup;
    } catch (error) {
      console.error('Storage: Error creating group:', error);
      throw error;
    }
  }

  async updateSectionGroup(id: string, group: Partial<InsertSectionGroup>): Promise<SectionGroup | undefined> {
    const [updated] = await db
      .update(sectionGroups)
      .set({ ...group, updatedAt: new Date().toISOString() })
      .where(eq(sectionGroups.id, id))
      .returning();
    return updated;
  }

  async deleteSectionGroup(id: string): Promise<void> {
    await db.delete(sectionGroups).where(eq(sectionGroups.id, id));
  }

  // Stats
  async getOrderStats(): Promise<{ pendentes: number; emSeparacao: number; separados: number; conferidos: number; excecoes: number }> {
    const allOrders = await db.select().from(orders);
    const allExceptions = await db.select().from(exceptions);

    return {
      pendentes: allOrders.filter(o => o.status === "pendente").length,
      emSeparacao: allOrders.filter(o => o.status === "em_separacao").length,
      separados: allOrders.filter(o => o.status === "separado").length,
      conferidos: allOrders.filter(o => o.status === "conferido").length,
      excecoes: allExceptions.length,
    };
  }

  async getPickingListReportData(filters: { orderIds?: string[]; pickupPoints?: string[]; sections?: string[] }): Promise<{
    section: string;
    pickupPoint: number;
    items: (OrderItem & { product: Product; order: Order })[];
  }[]> {
    const conditions = [];

    if (filters.orderIds && filters.orderIds.length > 0) {
      conditions.push(inArray(orderItems.orderId, filters.orderIds));
    }

    if (filters.pickupPoints && filters.pickupPoints.length > 0) {
      // pickupPoint in db is integer
      const ppInts = filters.pickupPoints.map(p => parseInt(p)).filter(p => !isNaN(p));
      if (ppInts.length > 0) {
        conditions.push(inArray(orderItems.pickupPoint, ppInts));
      }
    }

    if (filters.sections && filters.sections.length > 0) {
      conditions.push(inArray(orderItems.section, filters.sections));
    }

    const whereClause = conditions.length > 0 ? and(...conditions) : undefined;

    const items = await db.select().from(orderItems).where(whereClause);
    const result: any[] = [];

    // Optimize: Fetch all related products and orders in batch if possible, or just lazily for now (simple report)
    // For better perf, batch fetch.
    const productIds = Array.from(new Set(items.map(i => i.productId)));
    const orderIds = Array.from(new Set(items.map(i => i.orderId)));

    const fetchedProducts = productIds.length > 0
      ? await db.select().from(products).where(inArray(products.id, productIds))
      : [];
    const fetchedOrders = orderIds.length > 0
      ? await db.select().from(orders).where(inArray(orders.id, orderIds))
      : [];

    const productMap = new Map(fetchedProducts.map(p => [p.id, p]));
    const orderMap = new Map(fetchedOrders.map(o => [o.id, o]));

    // Grouping: Section -> Pickup Point
    const grouped = new Map<string, any>();

    for (const item of items) {
      const product = productMap.get(item.productId);
      const order = orderMap.get(item.orderId);

      if (!product || !order) continue;

      const key = `${item.section}|${item.pickupPoint}`;

      if (!grouped.has(key)) {
        grouped.set(key, {
          section: item.section,
          pickupPoint: item.pickupPoint,
          items: []
        });
      }

      grouped.get(key).items.push({ ...item, product, order });
    }

    // Convert map to array and sort
    return Array.from(grouped.values()).sort((a, b) => {
      // Sort by Section then PickupPoint
      const secDiff = a.section.localeCompare(b.section);
      if (secDiff !== 0) return secDiff;
      return a.pickupPoint - b.pickupPoint;
    });
  }



  // Picking Sessions
  async createPickingSession(session: InsertPickingSession): Promise<PickingSession> {
    const [newSession] = await db.insert(pickingSessions).values(session).returning();
    return newSession;
  }

  async getPickingSession(orderId: string, sectionId: string): Promise<PickingSession | undefined> {
    const [session] = await db.select()
      .from(pickingSessions)
      .where(and(eq(pickingSessions.orderId, orderId), eq(pickingSessions.sectionId, sectionId)));
    return session;
  }

  async updatePickingSessionHeartbeat(id: string): Promise<void> {
    await db.update(pickingSessions)
      .set({ lastHeartbeat: new Date().toISOString() })
      .where(eq(pickingSessions.id, id));
  }

  async deletePickingSession(orderId: string, sectionId: string): Promise<void> {
    await db.delete(pickingSessions)
      .where(and(eq(pickingSessions.orderId, orderId), eq(pickingSessions.sectionId, sectionId)));
  }

  async getPickingSessionsByOrder(orderId: string): Promise<PickingSession[]> {
    return await db.select().from(pickingSessions).where(eq(pickingSessions.orderId, orderId));
  }
}

export const storage = new DatabaseStorage();
