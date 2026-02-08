import type { Express, Request, Response } from "express";
import { createServer, type Server } from "http";
import cookieParser from "cookie-parser";
import { storage } from "./storage";
import { hashPassword, verifyPassword, createAuthSession, isAuthenticated, requireRole, getTokenFromRequest, getUserFromToken } from "./auth";
import { loginSchema, insertRouteSchema, orderItems, pickingSessions, type MappingField, datasetEnum } from "@shared/schema";
import { z } from "zod";
import { exec } from "child_process";
import path from "path";
import { setupSSE, broadcastSSE } from "./sse";
import { db } from "./db";
import { getDataContract, getAvailableDatasets } from "./data-contracts";

const LOCK_TTL_MINUTES = 15;

function getClientIp(req: Request): string | undefined {
  const ip = req.ip;
  if (Array.isArray(ip)) return ip[0];
  return ip;
}

function getUserAgent(req: Request): string | undefined {
  const ua = req.headers["user-agent"];
  if (Array.isArray(ua)) return ua[0];
  return ua;
}

export async function registerRoutes(
  httpServer: Server,
  app: Express
): Promise<Server> {
  console.log("[Routes] Registering routes...");
  app.use(cookieParser());

  // Setup SSE
  setupSSE(app);

  // System Sync Route
  app.post("/api/sync", isAuthenticated, async (req: Request, res: Response) => {
    try {
      console.log("[API] Triggering manual DB sync...");
      // Assuming sync_db2.py is in the project root (parent of server/) or current working dir
      // We are running from project root usually.
      const scriptPath = path.resolve(process.cwd(), "sync_db2.py");

      // Execute python script
      exec(`python "${scriptPath}" --quiet`, { windowsHide: true }, (error, stdout, stderr) => {
        if (error) {
          console.error(`[Sync] Error: ${error.message}`);
          // Don't fail the request immediately if it's just a warning, but here error usually means crash
          return res.status(500).json({ error: "Falha na sincronização", details: error.message });
        }
        if (stderr) {
          // stderr might contain logs, not just errors
          // console.log(`[Sync] Log: ${stderr}`);
        }
        console.log("[Sync] Synchronization completed.");

        res.json({ success: true, message: "Sincronização concluída com sucesso" });
      });
    } catch (error) {
      res.status(500).json({ error: "Erro interno ao sincronizar" });
    }
  });

  // Handheld: Picking Submit
  app.post("/api/picking/submit", isAuthenticated, async (req: Request, res: Response) => {
    try {
      const { orderId, sectionId, items } = req.body;
      const userId = (req as any).user.id;

      // 1. Verify Lock
      const lock = await storage.getPickingSession(orderId, sectionId);
      if (!lock || lock.userId !== userId) {
        return res.status(409).json({ error: "Sessão expirada ou inválida. Bloqueie novamente." });
      }

      // Refresh heartbeat
      await storage.updatePickingSessionHeartbeat(lock.id);

      // 2. Process Items
      const updates = [];
      for (const item of items) {
        const orderItem = (await storage.getOrderItemsByOrderId(orderId)).find(i => i.id === item.id);
        if (!orderItem) continue;

        const newQty = Number(item.qtyPicked);
        const targetQty = Number(orderItem.quantity);
        const status = newQty >= targetQty ? "separado" : "pendente"; // Using 'pendente' for partial as schema default

        await storage.updateOrderItem(item.id, {
          qtyPicked: newQty,
          status: status as any
        });

        updates.push({ id: item.id, qtyPicked: newQty, status });
      }

      // Broadcast update
      broadcastSSE("picking_update", {
        orderId,
        sectionId,
        userId,
        items: updates
      });

      // Check if order is fully picked and update status
      const conferenceUnit = await storage.checkAndUpdateOrderStatus(orderId);

      if (conferenceUnit) {
        broadcastSSE("work_unit_created", conferenceUnit);
      }

      res.json({ success: true });
    } catch (error) {
      console.error("Picking submit error:", error);
      res.status(500).json({ error: "Erro ao salvar separação" });
    }
  });

  // Handheld: Locking Routes
  app.post("/api/lock", isAuthenticated, async (req: Request, res: Response) => {
    try {
      const { orderId, sectionId } = req.body;
      const userId = (req as any).user.id;

      // 1. Check if locked by someone else
      const existing = await storage.getPickingSession(orderId, sectionId);
      if (existing) {
        if (existing.userId !== userId) {
          // Check if expired
          const minutesSinceHeartbeat = (Date.now() - new Date(existing.lastHeartbeat).getTime()) / 1000 / 60;
          if (minutesSinceHeartbeat < 2) { // 2 mins TTL for heartbeat
            return res.status(409).json({
              error: "Bloqueado",
              lockedBy: existing.userId,
              message: "Seção sendo separada por outro usuário"
            });
          } else {
            // Expired, steal lock
            await storage.deletePickingSession(orderId, sectionId);
          }
        } else {
          // Self-lock, just refresh
          await storage.updatePickingSessionHeartbeat(existing.id);
          return res.json({ success: true, sessionId: existing.id });
        }
      }

      // 2. Create lock
      const session = await storage.createPickingSession({
        userId,
        orderId,
        sectionId,
      });

      broadcastSSE("lock_acquired", { orderId, sectionId, userId });

      res.json({ success: true, sessionId: session.id });
    } catch (error) {
      console.error("Lock error:", error);
      res.status(500).json({ error: "Erro ao bloquear seção" });
    }
  });

  app.post("/api/heartbeat", isAuthenticated, async (req: Request, res: Response) => {
    try {
      const { sessionId } = req.body;
      await storage.updatePickingSessionHeartbeat(sessionId);
      res.json({ success: true });
    } catch (error) {
      res.status(500).json({ error: "Erro no heartbeat" });
    }
  });

  app.post("/api/unlock", isAuthenticated, async (req: Request, res: Response) => {
    try {
      const { orderId, sectionId } = req.body;
      await storage.deletePickingSession(orderId, sectionId);

      broadcastSSE("lock_released", { orderId, sectionId });

      res.json({ success: true });
    } catch (error) {
      res.status(500).json({ error: "Erro ao desbloquear" });
    }
  });

  // Auth routes
  app.post("/api/auth/login", async (req: Request, res: Response) => {
    try {
      const data = loginSchema.parse(req.body);
      const user = await storage.getUserByUsername(data.username);

      if (!user || !await verifyPassword(data.password, user.password)) {
        return res.status(401).json({ error: "Credenciais inválidas" });
      }

      if (!user.active) {
        return res.status(401).json({ error: "Usuário inativo" });
      }

      const { token, sessionKey } = await createAuthSession(user.id);

      res.cookie("authToken", token, {
        httpOnly: true,
        secure: process.env.NODE_ENV === "production",
        sameSite: "lax",
        maxAge: 24 * 60 * 60 * 1000,
      });

      await storage.createAuditLog({
        userId: user.id,
        action: "login",
        entityType: "user",
        entityId: user.id,
        details: "Login realizado",
        ipAddress: getClientIp(req),
        userAgent: getUserAgent(req),
      });

      const { password: _, ...safeUser } = user;
      res.json({ user: safeUser, sessionKey });
    } catch (error) {
      if (error instanceof z.ZodError) {
        return res.status(400).json({ error: "Dados inválidos" });
      }
      console.error("Login error:", error);
      res.status(500).json({ error: "Erro interno" });
    }
  });

  app.post("/api/auth/logout", async (req: Request, res: Response) => {
    const token = getTokenFromRequest(req);
    if (token) {
      try {
        const result = await getUserFromToken(token);
        if (result) {
          await storage.createAuditLog({
            userId: result.user.id,
            action: "logout",
            entityType: "user",
            entityId: result.user.id,
            details: "Logout realizado",
            ipAddress: getClientIp(req),
            userAgent: getUserAgent(req),
          });
          // Attach user to request for logging middleware
          (req as any).user = result.user;
        }
      } catch { }
    }
    res.clearCookie("authToken");
    res.json({ success: true });
  });

  app.get("/api/auth/me", isAuthenticated, (req: Request, res: Response) => {
    const user = (req as any).user;
    const sessionKey = (req as any).sessionKey;
    const { password: _, ...safeUser } = user;
    res.json({ user: safeUser, sessionKey });
  });

  // Users routes
  app.get("/api/users", isAuthenticated, requireRole("supervisor", "administrador"), async (req: Request, res: Response) => {
    try {
      const users = await storage.getAllUsers();
      const safeUsers = users.map(({ password: _, ...u }) => u);
      res.json(safeUsers);
    } catch (error) {
      console.error("Get users error:", error);
      res.status(500).json({ error: "Erro interno" });
    }
  });

  app.post("/api/users", isAuthenticated, requireRole("supervisor", "administrador"), async (req: Request, res: Response) => {
    try {
      const { username, password, name, role } = req.body;

      const existing = await storage.getUserByUsername(username);
      if (existing) {
        return res.status(400).json({ error: "Usuário já existe" });
      }

      const hashedPassword = await hashPassword(password);
      const user = await storage.createUser({
        username,
        password: hashedPassword,
        name,
        role,
      });

      await storage.createAuditLog({
        userId: (req as any).user.id,
        action: "create_user",
        entityType: "user",
        entityId: user.id,
        details: `Usuário ${username} criado`,
        ipAddress: getClientIp(req),
        userAgent: getUserAgent(req),
      });

      const { password: _, ...safeUser } = user;
      res.json(safeUser);
    } catch (error) {
      console.error("Create user error:", error);
      res.status(500).json({ error: "Erro interno" });
    }
  });

  app.patch("/api/users/:id", isAuthenticated, requireRole("supervisor", "administrador"), async (req: Request, res: Response) => {
    try {
      const id = req.params.id as string;
      const { password, ...updates } = req.body;

      const user = await storage.getUser(id);
      if (!user) {
        return res.status(404).json({ error: "Usuário não encontrado" });
      }

      const updateData: Partial<typeof user> = { ...updates };

      if (password && password.trim() !== "") {
        updateData.password = await hashPassword(password);
      }

      // If sections are provided, ensure they are stored correctly (handled by schema/storage types usually, but let's be explicit if needed)
      // The schema defines sections as json, and drizzle/sqlite handles it. 

      const updatedUser = await storage.updateUser(id, updateData);

      if (updatedUser) {
        await storage.createAuditLog({
          userId: (req as any).user.id,
          action: "update_user",
          entityType: "user",
          entityId: updatedUser.id,
          details: `Usuário ${updatedUser.username} atualizado`,
          ipAddress: getClientIp(req),
          userAgent: getUserAgent(req),
        });

        const { password: _, ...safeUser } = updatedUser;
        res.json(safeUser);
      } else {
        res.status(500).json({ error: "Falha ao atualizar usuário" });
      }
    } catch (error) {
      console.error("Update user error:", error);
      res.status(500).json({ error: "Erro interno" });
    }
  });

  app.get("/api/pickup-points", isAuthenticated, async (req: Request, res: Response) => {
    try {
      const result = await db.selectDistinct({ pickupPoint: orderItems.pickupPoint }).from(orderItems).orderBy(orderItems.pickupPoint);
      res.json(result.map(r => r.pickupPoint));
    } catch (error) {
      console.error("Get pickup points error:", error);
      res.status(500).json({ error: "Erro interno" });
    }
  });

  app.get("/api/sections", isAuthenticated, async (req: Request, res: Response) => {
    try {
      const sections = await storage.getAllSections();
      res.json(sections);
    } catch (error) {
      console.error("Get sections error:", error);
      res.status(500).json({ error: "Erro interno" });
    }
  });

  // Section Groups endpoints
  app.get("/api/sections/groups", isAuthenticated, async (req: Request, res: Response) => {
    try {
      const groups = await storage.getAllSectionGroups();
      res.json(groups);
    } catch (error) {
      console.error("Get section groups error:", error);
      res.status(500).json({ error: "Erro ao buscar grupos de seções" });
    }
  });

  app.post("/api/sections/groups", isAuthenticated, async (req: Request, res: Response) => {
    try {
      console.log('POST /api/sections/groups - Request body:', req.body);
      const { name, sections } = req.body;

      if (!name || !sections || !Array.isArray(sections)) {
        console.error('Validation failed:', { name, sections, isArray: Array.isArray(sections) });
        return res.status(400).json({ error: "Nome e seções são obrigatórios" });
      }

      console.log('Creating group:', { name, sectionCount: sections.length });
      const newGroup = await storage.createSectionGroup({ name, sections });
      console.log('Group created successfully:', newGroup);

      res.json(newGroup);
    } catch (error) {
      console.error("Create section group error:", error);
      res.status(500).json({ error: "Erro ao criar grupo de seções", details: error instanceof Error ? error.message : String(error) });
    }
  });

  app.put("/api/sections/groups/:id", isAuthenticated, async (req: Request, res: Response) => {
    try {
      const id = req.params.id as string;
      const { name, sections } = req.body;

      const updates: Partial<{ name: string; sections: string[] }> = {};
      if (name) updates.name = name;
      if (sections && Array.isArray(sections)) updates.sections = sections;

      const updated = await storage.updateSectionGroup(id, updates);
      if (!updated) {
        return res.status(404).json({ error: "Grupo não encontrado" });
      }
      res.json(updated);
    } catch (error) {
      console.error("Update section group error:", error);
      res.status(500).json({ error: "Erro ao atualizar grupo de seções" });
    }
  });

  app.delete("/api/sections/groups/:id", isAuthenticated, async (req: Request, res: Response) => {
    try {
      const id = req.params.id as string;
      await storage.deleteSectionGroup(id);
      res.json({ success: true });
    } catch (error) {
      console.error("Delete section group error:", error);
      res.status(500).json({ error: "Erro ao excluir grupo de seções" });
    }
  });


  // Routes (delivery routes)
  app.get("/api/routes", isAuthenticated, async (req: Request, res: Response) => {
    try {
      const routes = await storage.getAllRoutes();
      res.json(routes);
    } catch (error) {
      console.error("Get routes error:", error);
      res.status(500).json({ error: "Erro interno" });
    }
  });

  app.post("/api/routes", isAuthenticated, requireRole("supervisor", "administrador"), async (req: Request, res: Response) => {
    try {
      const data = insertRouteSchema.parse(req.body);
      const route = await storage.createRoute(data);
      res.json(route);
    } catch (error) {
      if (error instanceof z.ZodError) {
        return res.status(400).json({ error: "Dados inválidos", details: error.errors });
      }
      console.error("Create route error:", error);
      res.status(500).json({ error: "Erro interno", details: error instanceof Error ? error.message : String(error) });
    }
  });

  app.patch("/api/routes/:id", isAuthenticated, requireRole("supervisor", "administrador"), async (req: Request, res: Response) => {
    try {
      const id = req.params.id as string;

      const data = insertRouteSchema.partial().parse(req.body);
      const route = await storage.updateRoute(id, data);

      if (!route) return res.status(404).json({ error: "Rota não encontrada" });
      res.json(route);
    } catch (error) {
      if (error instanceof z.ZodError) {
        return res.status(400).json({ error: "Dados inválidos", details: error.errors });
      }
      console.error("Update route error:", error);
      res.status(500).json({ error: "Erro interno" });
    }
  });

  app.delete("/api/routes/:id", isAuthenticated, requireRole("supervisor", "administrador"), async (req: Request, res: Response) => {
    try {
      const id = req.params.id as string;

      const route = await storage.toggleRouteActive(id, false);
      if (!route) return res.status(404).json({ error: "Rota não encontrada" });

      res.json({ success: true });
    } catch (error) {
      console.error("Delete route error:", error);
      res.status(500).json({ error: "Erro interno" });
    }
  });

  // Orders routes
  app.get("/api/orders", isAuthenticated, async (req: Request, res: Response) => {
    try {
      const orders = await storage.getAllOrders();
      res.json(orders);
    } catch (error) {
      console.error("Get orders error:", error);
      res.status(500).json({ error: "Erro interno" });
    }
  });

  app.get("/api/orders/:id", isAuthenticated, async (req: Request, res: Response) => {
    try {
      const order = await storage.getOrderWithItems(req.params.id as string);
      if (!order) {
        return res.status(404).json({ error: "Pedido não encontrado" });
      }
      res.json(order);
    } catch (error) {
      console.error("Get order error:", error);
      res.status(500).json({ error: "Erro interno" });
    }
  });

  app.post("/api/orders/assign-route", isAuthenticated, requireRole("supervisor", "administrador"), async (req: Request, res: Response) => {
    try {
      const { orderIds, routeId } = req.body;

      if (!orderIds || !Array.isArray(orderIds) || orderIds.length === 0) {
        return res.status(400).json({ error: "Selecione pelo menos um pedido" });
      }

      // routeId is UUID string or null/undefined
      const targetRouteId = routeId || null;

      if (routeId && typeof routeId !== 'string') {
        return res.status(400).json({ error: "ID da rota inválido" });
      }

      // Validate if route exists
      if (targetRouteId) {
        const routes = await storage.getAllRoutes();
        const routeExists = routes.find(r => r.id === targetRouteId);
        if (!routeExists) {
          return res.status(400).json({ error: "Rota não encontrada", details: `Rota ID ${targetRouteId} não existe.` });
        }
      }

      await storage.assignRouteToOrders(orderIds, targetRouteId);

      await storage.createAuditLog({
        userId: (req as any).user.id,
        action: "assign_route",
        entityType: "order",
        details: `Rota ${routeId} atribuída a ${orderIds.length} pedidos`,
        ipAddress: getClientIp(req),
        userAgent: getUserAgent(req),
      });

      res.json({ success: true });
    } catch (error) {
      console.error("Assign route error:", error);
      res.status(500).json({ error: "Erro interno" });
    }
  });

  app.post("/api/orders/relaunch", isAuthenticated, requireRole("supervisor", "administrador"), async (req: Request, res: Response) => {
    try {
      const { orderIds } = req.body;

      if (!Array.isArray(orderIds)) {
        return res.status(400).json({ error: "IDs inválidos" });
      }

      for (const id of orderIds) {
        await storage.relaunchOrder(id);
      }

      await storage.createAuditLog({
        userId: (req as any).user.id,
        action: "relaunch_orders",
        entityType: "order",
        details: `Recontagem autorizada para ${orderIds.length} pedidos`,
        ipAddress: getClientIp(req),
        userAgent: getUserAgent(req),
      });

      res.json({ success: true });
    } catch (error) {
      console.error("Relaunch order error:", error);
      res.status(500).json({ error: "Erro interno" });
    }
  });

  app.post("/api/orders/set-priority", isAuthenticated, requireRole("supervisor", "administrador"), async (req: Request, res: Response) => {
    try {
      const { orderIds, priority } = req.body;
      await storage.setOrderPriority(orderIds, priority);

      await storage.createAuditLog({
        userId: (req as any).user.id,
        action: "set_priority",
        entityType: "order",
        details: `Prioridade ${priority} definida para ${orderIds.length} pedidos`,
        ipAddress: getClientIp(req),
        userAgent: getUserAgent(req),
      });

      res.json({ success: true });
    } catch (error) {
      console.error("Set priority error:", error);
      res.status(500).json({ error: "Erro interno" });
    }
  });

  app.post("/api/orders/launch", isAuthenticated, requireRole("supervisor", "administrador"), async (req: Request, res: Response) => {
    try {
      const { orderIds } = req.body;

      const toLaunch: string[] = [];
      const toRelaunch: string[] = [];

      // Verify orders
      for (const orderId of orderIds) {
        const order = await storage.getOrderById(orderId);
        if (!order) continue;

        if (!order.routeId) {
          // Skip orders without routes
          return res.status(400).json({
            error: "Ação bloqueada",
            details: `O pedido ${order.erpOrderId} não possui rota atribuída. Por favor, atribua uma rota antes de lançar.`
          });
        }

        if (order.isLaunched) {
          // Allow relaunch only if finished
          const allowedStatuses = ["separado", "conferido", "finalizado", "cancelado"];

          if (allowedStatuses.includes(order.status)) {
            // Can relaunch - add to relaunch list
            toRelaunch.push(orderId);
          } else {
            // Error if trying to launch an in-progress order
            return res.status(400).json({
              error: "Ação bloqueada",
              details: `O pedido ${order.erpOrderId} já foi lançado e está em processo de separação.`
            });
          }
        } else {
          // Launch the order (force status update even if inconsistent)
          console.log(`[Launch] Preparing to launch order ${orderId}, current status: ${order.status}`);
          toLaunch.push(orderId);
        }
      }

      if (toLaunch.length > 0) {
        await storage.launchOrders(toLaunch);
      }

      for (const id of toRelaunch) {
        await storage.relaunchOrder(id);
      }

      await storage.createAuditLog({
        userId: (req as any).user.id,
        action: "launch_orders",
        entityType: "order",
        details: `Lançados ${orderIds.length} pedidos para separação`,
        ipAddress: getClientIp(req),
        userAgent: getUserAgent(req),
      });

      res.json({ success: true });
    } catch (error) {
      console.error("Launch orders error:", error);
      res.status(500).json({ error: "Erro interno" });
    }
  });

  // Stats
  app.get("/api/stats", isAuthenticated, async (req: Request, res: Response) => {
    try {
      const stats = await storage.getOrderStats();
      res.json(stats);
    } catch (error) {
      console.error("Get stats error:", error);
      res.status(500).json({ error: "Erro interno" });
    }
  });

  // Reports
  app.post("/api/reports/picking-list", isAuthenticated, requireRole("supervisor", "administrador"), async (req: Request, res: Response) => {
    try {
      const { orderIds, pickupPoints, sections } = req.body;
      const data = await storage.getPickingListReportData({ orderIds, pickupPoints, sections });
      res.json(data);
    } catch (error) {
      console.error("Get picking list report error:", error);
      res.status(500).json({ error: "Erro interno" });
    }
  });

  // Work Units routes
  app.get("/api/work-units", isAuthenticated, async (req: Request, res: Response) => {
    try {
      const type = req.query.type as string | undefined;
      const workUnits = await storage.getWorkUnits(type);
      res.json(workUnits);
    } catch (error) {
      console.error("Get work units error:", error);
      res.status(500).json({ error: "Erro interno" });
    }
  });

  app.post("/api/work-units/unlock", isAuthenticated, async (req: Request, res: Response) => {
    try {
      const { workUnitIds, reset } = req.body;
      const userId = (req as any).user.id;

      const affectedOrderIds = new Set<string>();
      for (const wuId of workUnitIds) {
        const wu = await storage.getWorkUnitById(wuId);
        if (wu?.orderId) affectedOrderIds.add(wu.orderId);
      }

      await storage.unlockWorkUnits(workUnitIds);

      if (reset) {
        for (const id of workUnitIds) {
          await storage.resetWorkUnitProgress(id);
        }
      }

      for (const orderId of affectedOrderIds) {
        await storage.recalculateOrderStatus(orderId);
      }

      await storage.createAuditLog({
        userId,
        action: "unlock_work_units",
        entityType: "work_unit",
        details: `${workUnitIds.length} unidades desbloqueadas${reset ? ' e resetadas' : ''}`,
        ipAddress: getClientIp(req),
        userAgent: getUserAgent(req),
      });

      broadcastSSE("work_units_unlocked", { workUnitIds, affectedOrderIds: [...affectedOrderIds] });

      res.json({ success: true });
    } catch (error) {
      console.error("Unlock work units error:", error);
      res.status(500).json({ error: "Erro interno" });
    }
  });

  app.post("/api/work-units/lock", isAuthenticated, async (req: Request, res: Response) => {
    try {
      const { workUnitIds } = req.body;
      const userId = (req as any).user.id;
      const expiresAt = new Date(Date.now() + LOCK_TTL_MINUTES * 60 * 1000);

      await storage.lockWorkUnits(workUnitIds, userId, expiresAt);

      await storage.createAuditLog({
        userId,
        action: "lock_work_units",
        entityType: "work_unit",
        details: `${workUnitIds.length} unidades bloqueadas`,
        ipAddress: getClientIp(req),
        userAgent: getUserAgent(req),
      });

      res.json({ success: true, expiresAt });
    } catch (error) {
      console.error("Lock work units error:", error);
      res.status(500).json({ error: "Erro interno" });
    }
  });

  app.post("/api/work-units/:id/scan-cart", isAuthenticated, async (req: Request, res: Response) => {
    try {
      const { qrCode } = req.body;
      const workUnit = await storage.getWorkUnitById(req.params.id as string);

      if (!workUnit) {
        return res.status(404).json({ error: "Unidade não encontrada" });
      }

      await storage.updateWorkUnit(req.params.id as string, {
        cartQrCode: qrCode,
        status: "em_andamento",
        startedAt: new Date().toISOString()
      });

      // Update Order Status to "em_separacao" if it's "pendente"
      if (workUnit.orderId) {
        const order = await storage.getOrderById(workUnit.orderId);
        if (order && order.status === "pendente") {
          await storage.updateOrder(workUnit.orderId, {
            status: "em_separacao",
            updatedAt: new Date().toISOString()
          });
        }
      }

      broadcastSSE("picking_started", { workUnitId: req.params.id, orderId: workUnit.orderId, userId: (req as any).user.id });

      const updated = await storage.getWorkUnitById(req.params.id as string);

      res.json({ workUnit: updated });
    } catch (error) {
      console.error("Scan cart error:", error);
      res.status(500).json({ error: "Erro interno" });
    }
  });

  app.post("/api/work-units/:id/scan-pallet", isAuthenticated, async (req: Request, res: Response) => {
    try {
      const { qrCode } = req.body;
      const workUnit = await storage.getWorkUnitById(req.params.id as string);

      if (!workUnit) {
        return res.status(404).json({ error: "Unidade não encontrada" });
      }

      await storage.updateWorkUnit(req.params.id as string, { palletQrCode: qrCode, status: "em_andamento", startedAt: new Date().toISOString() });

      if (workUnit.orderId) {
        const order = await storage.getOrderById(workUnit.orderId);
        if (order && order.status === "separado") {
          await storage.updateOrder(workUnit.orderId, { status: "em_conferencia", updatedAt: new Date().toISOString() });
        }
      }

      broadcastSSE("conference_started", { workUnitId: req.params.id, orderId: workUnit.orderId, userId: (req as any).user.id });

      const updated = await storage.getWorkUnitById(req.params.id as string);

      res.json({ workUnit: updated });
    } catch (error) {
      console.error("Scan pallet error:", error);
      res.status(500).json({ error: "Erro interno" });
    }
  });

  app.post("/api/work-units/:id/scan-item", isAuthenticated, async (req: Request, res: Response) => {
    try {
      const { barcode } = req.body;
      const workUnit = await storage.getWorkUnitById(req.params.id as string);

      if (!workUnit) {
        return res.status(404).json({ error: "Unidade não encontrada" });
      }

      const product = await storage.getProductByBarcode(barcode);
      if (!product) {
        return res.json({ status: "not_found" });
      }

      const item = workUnit.items.find(i => i.productId === product.id);
      if (!item) {
        return res.json({ status: "not_found" });
      }

      const currentQty = Number(item.separatedQty);
      const targetQty = Number(item.quantity);
      const exceptionQty = Number(item.exceptionQty || 0);
      const adjustedTarget = targetQty - exceptionQty;

      // If trying to scan more than adjusted target (accounting for exceptions)
      if (currentQty >= adjustedTarget) {
        // If there are exceptions, reset and inform user
        if (exceptionQty > 0) {
          await storage.updateOrderItem(item.id, {
            separatedQty: 0,
            status: "recontagem",
          });
          // Also reset work unit status if it was completed
          await storage.updateWorkUnit(req.params.id as string, { status: "em_andamento" });

          const resetWorkUnit = await storage.getWorkUnitById(req.params.id as string);

          return res.json({
            status: "over_quantity_with_exception",
            workUnit: resetWorkUnit,
            product,
            quantity: 1,
            exceptionQty,
            message: `Este item tem ${exceptionQty} unidade(s) com exceção. Quantidade disponível para separar: ${adjustedTarget}. Separação resetada, bipe novamente.`
          });
        }
        // No exceptions, just over quantity - RESET behavior requested
        await storage.updateOrderItem(item.id, {
          separatedQty: 0,
          status: "recontagem",
        });
        // Also reset work unit status if it was completed
        await storage.updateWorkUnit(req.params.id as string, { status: "em_andamento" });

        const resetWorkUnit = await storage.getWorkUnitById(req.params.id as string);

        return res.json({
          status: "over_quantity",
          product,
          quantity: 1,
          workUnit: resetWorkUnit, // Return the reset work unit!
          message: `Quantidade excedida! Separação resetada. Bipe os ${adjustedTarget} itens novamente.`
        });
      }

      const newQty = currentQty + 1;
      await storage.updateOrderItem(item.id, {
        separatedQty: Number(newQty),
        status: newQty >= adjustedTarget ? "separado" : "pendente",
      });

      const updated = await storage.getWorkUnitById(req.params.id as string);

      broadcastSSE("item_picked", { workUnitId: req.params.id, orderId: workUnit.orderId, productId: product.id, userId: (req as any).user.id });

      const isComplete = await storage.checkAndCompleteWorkUnit(req.params.id as string);

      if (isComplete) {
        await storage.updateOrder(workUnit.orderId, { status: "separado" });
        broadcastSSE("picking_finished", { workUnitId: req.params.id, orderId: workUnit.orderId });
      }

      const finalWorkUnit = await storage.getWorkUnitById(req.params.id as string);

      res.json({
        status: "success",
        product,
        quantity: 1,
        workUnit: finalWorkUnit,
      });
    } catch (error) {
      console.error("Scan item error:", error);
      res.status(500).json({ error: "Erro interno" });
    }
  });

  app.post("/api/work-units/:id/check-item", isAuthenticated, async (req: Request, res: Response) => {
    try {
      const { barcode } = req.body;
      const workUnit = await storage.getWorkUnitById(req.params.id as string);

      if (!workUnit) {
        return res.status(404).json({ error: "Unidade não encontrada" });
      }

      const product = await storage.getProductByBarcode(barcode);
      if (!product) {
        return res.json({ status: "not_found" });
      }

      const item = workUnit.items.find(i => i.productId === product.id);
      if (!item) {
        return res.json({ status: "not_found" });
      }

      const currentQty = Number(item.checkedQty);
      const targetQty = Number(item.separatedQty);

      if (targetQty <= 0) {
        return res.json({ status: "not_found" });
      }

      if (currentQty >= targetQty) {
        return res.json({ status: "over_quantity", product, quantity: 1 });
      }

      const newQty = currentQty + 1;
      await storage.updateOrderItem(item.id, {
        checkedQty: Number(newQty),
        status: newQty >= targetQty ? "conferido" : "separado",
      });

      const updated = await storage.getWorkUnitById(req.params.id as string);

      const allComplete = updated?.items.every(i => {
        const sep = Number(i.separatedQty) || 0;
        return sep > 0 && Number(i.checkedQty) >= sep;
      });
      if (allComplete) {
        await storage.updateWorkUnit(req.params.id as string, { status: "concluido", completedAt: new Date().toISOString() });
        await storage.updateOrder(workUnit.orderId, { status: "conferido" });
        broadcastSSE("conference_finished", { workUnitId: req.params.id, orderId: workUnit.orderId });
      }

      const finalWorkUnit = await storage.getWorkUnitById(req.params.id as string);

      res.json({
        status: "success",
        product,
        quantity: 1,
        workUnit: finalWorkUnit,
      });
    } catch (error) {
      console.error("Check item error:", error);
      res.status(500).json({ error: "Erro interno" });
    }
  });

  app.post("/api/work-units/:id/balcao-item", isAuthenticated, async (req: Request, res: Response) => {
    try {
      const { barcode } = req.body;
      const workUnit = await storage.getWorkUnitById(req.params.id as string);

      if (!workUnit) {
        return res.status(404).json({ error: "Unidade não encontrada" });
      }

      const product = await storage.getProductByBarcode(barcode);
      if (!product) {
        return res.json({ status: "not_found" });
      }

      const item = workUnit.items.find(i => i.productId === product.id);
      if (!item) {
        return res.json({ status: "not_found" });
      }

      const currentQty = Number(item.separatedQty);
      const targetQty = Number(item.quantity);

      if (currentQty >= targetQty) {
        return res.json({ status: "over_quantity", product, quantity: 1 });
      }

      const newQty = currentQty + 1;
      await storage.updateOrderItem(item.id, {
        separatedQty: Number(newQty),
        status: newQty >= targetQty ? "conferido" : "pendente",
      });

      const updated = await storage.getWorkUnitById(req.params.id as string);

      res.json({
        status: "success",
        product,
        quantity: 1,
        workUnit: updated,
      });
    } catch (error) {
      console.error("Balcao item error:", error);
      res.status(500).json({ error: "Erro interno" });
    }
  });

  app.post("/api/work-units/:id/complete-balcao", isAuthenticated, async (req: Request, res: Response) => {
    try {
      const { elapsedTime } = req.body;

      await storage.updateWorkUnit(req.params.id as string, {
        status: "concluido",
        completedAt: new Date().toISOString(),
      });

      const workUnit = await storage.getWorkUnitById(req.params.id as string);
      if (workUnit) {
        await storage.updateOrder(workUnit.orderId, { status: "finalizado" });
      }

      await storage.createAuditLog({
        userId: (req as any).user.id,
        action: "complete_balcao",
        entityType: "work_unit",
        entityId: req.params.id as string,
        details: `Atendimento balcão concluído em ${elapsedTime}s`,
        ipAddress: getClientIp(req),
        userAgent: getUserAgent(req),
      });

      res.json({ success: true });
    } catch (error) {
      console.error("Complete balcao error:", error);
      res.status(500).json({ error: "Erro interno" });
    }
  });

  app.post("/api/work-units/:id/complete", isAuthenticated, async (req: Request, res: Response) => {
    try {
      const id = req.params.id as string;
      const isComplete = await storage.checkAndCompleteWorkUnit(id);

      if (isComplete) {
        const wu = await storage.getWorkUnitById(id);
        if (wu) {
          await storage.updateOrder(wu.orderId, { status: "separado" });
        }
        res.json({ success: true });
      } else {
        res.status(400).json({ error: "Existem itens pendentes" });
      }
    } catch (error) {
      console.error("Manual complete error:", error);
      res.status(500).json({ error: "Erro interno" });
    }
  });

  // Exceptions
  app.get("/api/exceptions", isAuthenticated, async (req: Request, res: Response) => {
    try {
      const exceptions = await storage.getAllExceptions();
      res.json(exceptions);
    } catch (error) {
      console.error("Get exceptions error:", error);
      res.status(500).json({ error: "Erro interno" });
    }
  });

  app.post("/api/exceptions", isAuthenticated, async (req: Request, res: Response) => {
    try {
      const { workUnitId, orderItemId, type, quantity, observation } = req.body;

      const canCreate = await storage.canCreateException(orderItemId, quantity);
      if (!canCreate) {
        return res.status(400).json({ error: "Quantidade da exceção excede o total do item." });
      }

      const exception = await storage.createException({
        workUnitId,
        orderItemId,
        type,
        quantity,
        observation,
        reportedBy: (req as any).user.id,
      });

      // Decrease separated quantity if needed (if converting separated to exception)
      await storage.adjustItemQuantityForException(orderItemId);

      await storage.updateOrderItem(orderItemId, { status: "excecao" });

      // Check if work unit is now complete
      await storage.checkAndCompleteWorkUnit(workUnitId);

      broadcastSSE("exception_created", { workUnitId, orderItemId, type, quantity, exceptionId: exception.id });

      await storage.createAuditLog({
        userId: (req as any).user.id,
        action: "create_exception",
        entityType: "exception",
        entityId: exception.id,
        details: `Exceção ${type} registrada`,
        ipAddress: getClientIp(req),
        userAgent: getUserAgent(req),
      });

      res.json(exception);
    } catch (error) {
      console.error("Create exception error:", error);
      res.status(500).json({ error: "Erro interno" });
    }
  });

  // Manual Quantity Rules
  app.get("/api/manual-qty-rules", isAuthenticated, async (req: Request, res: Response) => {
    try {
      const rules = await storage.getAllManualQtyRules();
      res.json(rules);
    } catch (error) {
      console.error("Get manual qty rules error:", error);
      res.status(500).json({ error: "Erro interno" });
    }
  });

  app.post("/api/manual-qty-rules", isAuthenticated, requireRole("supervisor", "administrador"), async (req: Request, res: Response) => {
    try {
      const { ruleType, value, description } = req.body;
      if (!ruleType || !value) {
        return res.status(400).json({ error: "Tipo e valor são obrigatórios" });
      }
      const rule = await storage.createManualQtyRule({
        ruleType,
        value: value.trim(),
        description: description || null,
        createdBy: (req as any).user.id,
      });

      await storage.createAuditLog({
        userId: (req as any).user.id,
        action: "create_manual_qty_rule",
        entityType: "manual_qty_rule",
        entityId: rule.id,
        details: `Regra ${ruleType}: "${value}" criada`,
        ipAddress: getClientIp(req),
        userAgent: getUserAgent(req),
      });

      res.json(rule);
    } catch (error) {
      console.error("Create manual qty rule error:", error);
      res.status(500).json({ error: "Erro interno" });
    }
  });

  app.patch("/api/manual-qty-rules/:id", isAuthenticated, requireRole("supervisor", "administrador"), async (req: Request, res: Response) => {
    try {
      const id = req.params.id as string;
      const { ruleType, value, description, active } = req.body;
      const updates: any = {};
      if (ruleType !== undefined) updates.ruleType = ruleType;
      if (value !== undefined) updates.value = value.trim();
      if (description !== undefined) updates.description = description;
      if (active !== undefined) updates.active = active;

      const updated = await storage.updateManualQtyRule(id, updates);
      if (!updated) return res.status(404).json({ error: "Regra não encontrada" });

      res.json(updated);
    } catch (error) {
      console.error("Update manual qty rule error:", error);
      res.status(500).json({ error: "Erro interno" });
    }
  });

  app.delete("/api/manual-qty-rules/:id", isAuthenticated, requireRole("supervisor", "administrador"), async (req: Request, res: Response) => {
    try {
      const id = req.params.id as string;
      await storage.deleteManualQtyRule(id);
      res.json({ success: true });
    } catch (error) {
      console.error("Delete manual qty rule error:", error);
      res.status(500).json({ error: "Erro interno" });
    }
  });

  app.post("/api/manual-qty-rules/check", isAuthenticated, async (req: Request, res: Response) => {
    try {
      const { productIds } = req.body;
      if (!Array.isArray(productIds)) {
        return res.status(400).json({ error: "productIds deve ser um array" });
      }

      const allProducts = await storage.getAllProducts();
      const results: Record<string, boolean> = {};

      for (const productId of productIds) {
        const product = allProducts.find(p => p.id === productId);
        if (product) {
          results[productId] = await storage.checkProductManualQty(product);
        } else {
          results[productId] = false;
        }
      }

      res.json(results);
    } catch (error) {
      console.error("Check manual qty rules error:", error);
      res.status(500).json({ error: "Erro interno" });
    }
  });

  // Report PDF generation endpoint
  app.post("/api/reports/picking-list/generate", isAuthenticated, async (req: Request, res: Response) => {
    try {
      const { orderIds, pickupPoints, mode, sections: filterSections, groupId } = req.body;

      if (!orderIds || !Array.isArray(orderIds) || orderIds.length === 0) {
        return res.status(400).json({ error: "Selecione pelo menos um pedido" });
      }

      const reportData = await storage.getPickingListReportData({
        orderIds,
        pickupPoints: pickupPoints?.map(String),
        sections: filterSections,
      });

      const selectedOrders: any[] = [];
      for (const oid of orderIds) {
        const order = await storage.getOrderWithItems(oid);
        if (order) selectedOrders.push(order);
      }

      res.json({
        reportData,
        orders: selectedOrders,
        filters: { orderIds, pickupPoints, mode, sections: filterSections, groupId },
        generatedAt: new Date().toISOString(),
      });
    } catch (error) {
      console.error("Generate picking list error:", error);
      res.status(500).json({ error: "Erro ao gerar relatório" });
    }
  });

  app.delete("/api/exceptions/item/:orderItemId", isAuthenticated, async (req: Request, res: Response) => {
    try {
      const orderItemId = req.params.orderItemId as string;

      // Delete all exceptions for this order item via storage
      await storage.deleteExceptionsForItem(orderItemId);

      // Reset item status if it was in exception status
      await storage.updateOrderItem(orderItemId, { status: "pendente" });

      await storage.createAuditLog({
        userId: (req as any).user.id,
        action: "clear_exceptions",
        entityType: "order_item",
        entityId: orderItemId,
        details: `Exceções limpas para o item`,
        ipAddress: getClientIp(req),
        userAgent: getUserAgent(req),
      });

      res.json({ success: true });
    } catch (error) {
      console.error("Clear exceptions error:", error);
      res.status(500).json({ error: "Erro interno" });
    }
  });

  // ==================== Mapping Studio ====================

  app.get("/api/datasets", isAuthenticated, requireRole("supervisor", "administrador"), async (req: Request, res: Response) => {
    try {
      res.json(getAvailableDatasets());
    } catch (error) {
      console.error("Get datasets error:", error);
      res.status(500).json({ error: "Erro interno" });
    }
  });

  app.get("/api/schema/:dataset", isAuthenticated, requireRole("supervisor", "administrador"), async (req: Request, res: Response) => {
    try {
      const dataset = req.params.dataset as string;
      const contract = getDataContract(dataset);
      if (!contract) {
        return res.status(404).json({ error: "Dataset não encontrado" });
      }
      res.json({ dataset, fields: contract });
    } catch (error) {
      console.error("Get schema error:", error);
      res.status(500).json({ error: "Erro interno" });
    }
  });

  app.get("/api/mapping/:dataset", isAuthenticated, requireRole("supervisor", "administrador"), async (req: Request, res: Response) => {
    try {
      const dataset = req.params.dataset as string;
      const mapping = await storage.getMappingByDataset(dataset);
      res.json(mapping || null);
    } catch (error) {
      console.error("Get mapping error:", error);
      res.status(500).json({ error: "Erro interno" });
    }
  });

  app.get("/api/mappings", isAuthenticated, requireRole("supervisor", "administrador"), async (req: Request, res: Response) => {
    try {
      const mappings = await storage.getAllMappings();
      res.json(mappings);
    } catch (error) {
      console.error("Get all mappings error:", error);
      res.status(500).json({ error: "Erro interno" });
    }
  });

  app.post("/api/mapping/:dataset", isAuthenticated, requireRole("supervisor", "administrador"), async (req: Request, res: Response) => {
    try {
      const dataset = req.params.dataset as string;
      const contract = getDataContract(dataset);
      if (!contract) {
        return res.status(404).json({ error: "Dataset não encontrado" });
      }

      const { mappingJson, description } = req.body;
      if (!mappingJson || !Array.isArray(mappingJson)) {
        return res.status(400).json({ error: "mappingJson é obrigatório e deve ser um array" });
      }

      const errors: string[] = [];
      for (const field of contract) {
        if (field.required) {
          const mapped = mappingJson.find((m: MappingField) => m.appField === field.appField);
          if (!mapped || (!mapped.dbExpression && !mapped.defaultValue)) {
            errors.push(`Campo obrigatório '${field.appField}' precisa de uma expressão DB2 ou valor padrão`);
          }
        }
      }

      if (errors.length > 0) {
        return res.status(400).json({ error: "Validação falhou", details: errors });
      }

      const userId = (req as any).user.id;
      const mapping = await storage.saveMapping(dataset, mappingJson, description || null, userId);

      await storage.createAuditLog({
        userId,
        action: "save_mapping",
        entityType: "db2_mapping",
        entityId: mapping.id,
        details: `Mapping v${mapping.version} salvo para dataset '${dataset}'`,
        ipAddress: getClientIp(req),
        userAgent: getUserAgent(req),
      });

      res.json(mapping);
    } catch (error) {
      console.error("Save mapping error:", error);
      res.status(500).json({ error: "Erro interno" });
    }
  });

  app.post("/api/mapping/:id/activate", isAuthenticated, requireRole("supervisor", "administrador"), async (req: Request, res: Response) => {
    try {
      const id = req.params.id as string;
      const mapping = await storage.activateMapping(id);
      if (!mapping) {
        return res.status(404).json({ error: "Mapping não encontrado" });
      }

      const userId = (req as any).user.id;
      await storage.createAuditLog({
        userId,
        action: "activate_mapping",
        entityType: "db2_mapping",
        entityId: id as string,
        details: `Mapping v${mapping.version} ativado para dataset '${mapping.dataset}'`,
        ipAddress: getClientIp(req),
        userAgent: getUserAgent(req),
      });

      res.json(mapping);
    } catch (error) {
      console.error("Activate mapping error:", error);
      res.status(500).json({ error: "Erro interno" });
    }
  });

  app.post("/api/preview/:dataset", isAuthenticated, requireRole("supervisor", "administrador"), async (req: Request, res: Response) => {
    try {
      const dataset = req.params.dataset as string;
      const contract = getDataContract(dataset);
      if (!contract) {
        return res.status(404).json({ error: "Dataset não encontrado" });
      }

      const { mappingJson } = req.body;
      if (!mappingJson || !Array.isArray(mappingJson)) {
        return res.status(400).json({ error: "mappingJson é obrigatório" });
      }

      const cachedRows = await storage.getCacheOrcamentosPreview(20);

      if (cachedRows.length === 0) {
        return res.json({
          preview: [],
          warnings: ["Nenhum dado no cache. Execute a sincronização DB2 primeiro."],
          errors: [],
        });
      }

      const preview: any[] = [];
      const errors: string[] = [];
      const warnings: string[] = [];

      const requiredFields = contract.filter(f => f.required).map(f => f.appField);
      const mappedRequiredFields = mappingJson
        .filter((m: MappingField) => requiredFields.includes(m.appField) && (m.dbExpression || m.defaultValue))
        .map((m: MappingField) => m.appField);

      for (const reqField of requiredFields) {
        if (!mappedRequiredFields.includes(reqField)) {
          errors.push(`Campo obrigatório '${reqField}' não mapeado`);
        }
      }

      for (const row of cachedRows) {
        const transformed: Record<string, any> = {};
        const rowObj = row as Record<string, any>;

        for (const mapping of mappingJson as MappingField[]) {
          const { appField, dbExpression, cast, defaultValue, type } = mapping;

          let value: any = null;

          if (dbExpression) {
            const colName = dbExpression.trim();
            const upperCol = colName.toUpperCase();
            const matchingKey = Object.keys(rowObj).find(k => k.toUpperCase() === upperCol);
            if (matchingKey) {
              value = rowObj[matchingKey];
            } else {
              const camelKey = Object.keys(rowObj).find(k => {
                const snake = k.replace(/([A-Z])/g, '_$1').toLowerCase().replace(/^_/, '');
                return snake.toUpperCase() === upperCol || k.toUpperCase() === upperCol;
              });
              if (camelKey) {
                value = rowObj[camelKey];
              }
            }
          }

          if (value === null || value === undefined || value === '') {
            value = defaultValue || null;
          }

          if (value !== null && cast) {
            switch (cast) {
              case "number":
                value = Number(value);
                break;
              case "string":
                value = String(value);
                break;
              case "divide_100":
                value = Number(value) / 100;
                break;
              case "divide_1000":
                value = Number(value) / 1000;
                break;
              case "boolean_T_F":
                value = value === "T" || value === "t";
                break;
            }
          }

          transformed[appField] = value;
        }

        preview.push(transformed);
      }

      res.json({ preview, errors, warnings });
    } catch (error) {
      console.error("Preview error:", error);
      res.status(500).json({ error: "Erro interno" });
    }
  });

  app.get("/api/cache-columns", isAuthenticated, requireRole("supervisor", "administrador"), async (req: Request, res: Response) => {
    try {
      const cachedRows = await storage.getCacheOrcamentosPreview(1);
      if (cachedRows.length === 0) {
        return res.json({ columns: [], message: "Nenhum dado no cache. Execute a sincronização DB2 primeiro." });
      }
      const row = cachedRows[0] as Record<string, any>;
      const columns = Object.keys(row).map(key => ({
        name: key,
        sampleValue: row[key],
      }));
      res.json({ columns });
    } catch (error) {
      console.error("Get cache columns error:", error);
      res.status(500).json({ error: "Erro interno" });
    }
  });

  return httpServer;
}
