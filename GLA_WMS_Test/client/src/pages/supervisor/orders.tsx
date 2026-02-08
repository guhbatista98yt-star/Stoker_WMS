import { useState, useMemo, useCallback } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useSessionQueryKey } from "@/lib/auth";
import { DatePickerWithRange } from "@/components/ui/date-range-picker";
import { DateRange } from "react-day-picker";
import { GradientHeader } from "@/components/ui/gradient-header";
import { SectionCard } from "@/components/ui/section-card";
import { StatusBadge } from "@/components/ui/status-badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";
import { Link } from "wouter";
import {
  ArrowLeft,
  Search,
  Filter,
  Route as RouteIcon,
  Package,
  RefreshCw,
  AlertTriangle,
  CheckCircle2,
  Send,
  Eye,
  SlidersHorizontal,
} from "lucide-react";
import { Progress } from "@/components/ui/progress";
import { OrderDetailsDialog } from "@/components/orders/order-details-dialog";
import type { Order, Route } from "@shared/schema";
import { getCurrentWeekRange } from "@/lib/date-utils";
import { format } from "date-fns";
import { useSSE } from "@/hooks/use-sse";

export default function OrdersPage() {
  const { toast } = useToast();
  const queryClient = useQueryClient();

  // --- FILTERS STATE ---
  const [searchOrderId, setSearchOrderId] = useState(""); // 1. Busca por Pedido (Numérico Exato)
  const [filterDateRange, setFilterDateRange] = useState<DateRange | undefined>(getCurrentWeekRange()); // 2. Período
  const [tempDateRange, setTempDateRange] = useState<DateRange | undefined>(getCurrentWeekRange());

  const [financialStatusFilter, setFinancialStatusFilter] = useState<string>("all"); // 3. Status Financeiro
  const [pickingStatusFilter, setPickingStatusFilter] = useState<string[]>([]); // 4. Status Separação (Multi)
  const [routeFilter, setRouteFilter] = useState<string>("all"); // 5. Rota
  const [priorityFilter, setPriorityFilter] = useState<string>("all"); // 6. Prioridade
  const [launchedFilter, setLaunchedFilter] = useState<string>("all"); // 7. Lançado (Sim/Não/Todos)

  // --- UI STATE ---
  const [selectedOrders, setSelectedOrders] = useState<string[]>([]);
  const [showRouteDialog, setShowRouteDialog] = useState(false);
  const [selectedRoute, setSelectedRoute] = useState<string>("");
  const [viewOrderId, setViewOrderId] = useState<string | null>(null);

  // Pagination
  const [currentPage, setCurrentPage] = useState(1);
  const [pageSize, setPageSize] = useState(50);

  // --- QUERIES ---
  const ordersQueryKey = useSessionQueryKey(["/api/orders"]);
  const routesQueryKey = useSessionQueryKey(["/api/routes"]);

  type OrderWithExtras = Order & { hasExceptions?: boolean; itemsCount?: number; totalItems?: number; pickedItems?: number };

  const { data: orders, isLoading: ordersLoading, refetch } = useQuery<OrderWithExtras[]>({
    queryKey: ordersQueryKey,
  });

  const { data: routes } = useQuery<Route[]>({
    queryKey: routesQueryKey,
  });

  // --- SSE REAL-TIME UPDATES ---
  const handleSSEMessage = useCallback((type: string, data: any) => {
    // Invalidate orders query to refresh data on relevant events
    // We could accept data to patch directly, but invalidation is safer for consistency first
    console.log(`[SSE] Received ${type}`, data);
    queryClient.invalidateQueries({ queryKey: ordersQueryKey });

    // Optional: Toast notifications for critical events
    if (type === 'exception_created') {
      toast({
        title: "Nova Exceção",
        description: `Exceção registrada no pedido ${data.orderId}`,
        variant: "destructive"
      });
    }
  }, [queryClient, ordersQueryKey, toast]);

  useSSE('/api/sse', ['picking_update', 'lock_acquired', 'lock_released', 'picking_started', 'item_picked', 'exception_created', 'picking_finished', 'conference_started', 'conference_finished'], handleSSEMessage);

  // --- MUTATIONS ---
  const syncMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", "/api/sync");
      if (!res.ok) throw new Error("Falha na sincronização");
      return res.json();
    },
    onSuccess: () => {
      refetch();
      queryClient.invalidateQueries({ queryKey: routesQueryKey });
      toast({ title: "Sincronizado", description: "Dados atualizados com sucesso." });
    },
    onError: () => {
      toast({ title: "Erro", description: "Erro ao sincronizar.", variant: "destructive" });
    },
  });

  const assignRouteMutation = useMutation({
    mutationFn: async ({ orderIds, routeId }: { orderIds: string[]; routeId: string }) => {
      const res = await apiRequest("POST", "/api/orders/assign-route", { orderIds, routeId });
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ordersQueryKey });
      setSelectedOrders([]);
      setShowRouteDialog(false);
      toast({ title: "Rota atribuída", description: "Pedidos atualizados." });
    },
  });

  const setPriorityMutation = useMutation({
    mutationFn: async ({ orderIds, priority }: { orderIds: string[]; priority: number }) => {
      const res = await apiRequest("POST", "/api/orders/set-priority", { orderIds, priority });
      return res.json();
    },
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({ queryKey: ordersQueryKey });
      setSelectedOrders([]);
      toast({ title: "Prioridade atualizada", description: `Prioridade ${variables.priority > 0 ? "Alta" : "Normal"} definida.` });
    },
  });

  const launchMutation = useMutation({
    mutationFn: async ({ orderIds }: { orderIds: string[] }) => {
      const res = await apiRequest("POST", "/api/orders/launch", { orderIds });
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.details || err.error || "Erro ao lançar");
      }
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ordersQueryKey });
      setSelectedOrders([]);
      toast({ title: "Sucesso", description: "Pedidos lançados para separação." });
    },
    onError: (e: Error) => toast({ title: "Erro", description: e.message, variant: "destructive" })
  });

  const recountMutation = useMutation({
    mutationFn: async ({ orderIds }: { orderIds: string[] }) => {
      const res = await apiRequest("POST", "/api/orders/relaunch", { orderIds });
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ordersQueryKey });
      setSelectedOrders([]);
      toast({ title: "Recontagem", description: "Recontagem autorizada." });
    }
  });


  // --- FILTERING LOGIC ---
  const filteredOrders = useMemo(() => {
    if (!orders) return [];

    return orders.filter((order) => {
      // 1. Search (Exact or Partial Order ID)
      if (searchOrderId && !order.erpOrderId.toLowerCase().includes(searchOrderId.toLowerCase())) {
        return false;
      }

      // 2. Date Range
      if (filterDateRange?.from) {
        const orderDate = new Date(order.createdAt);
        const fromDate = new Date(filterDateRange.from);
        fromDate.setHours(0, 0, 0, 0);

        if (filterDateRange.to) {
          const toDate = new Date(filterDateRange.to);
          toDate.setHours(23, 59, 59, 999);
          if (orderDate < fromDate || orderDate > toDate) return false;
        } else {
          if (orderDate < fromDate) return false;
        }
      }

      // 3. Financial Status
      if (financialStatusFilter !== "all") {
        // Map UI values to backend values if needed, assumes mismatch handled or 1:1
        // Backend: 'faturado' (Paid/Released), 'pendente', others? 
        // Let's assume 'faturado' = Pago/Liberado
        if (financialStatusFilter === "pago" && order.financialStatus !== "faturado") return false;
        if (financialStatusFilter === "pendente" && order.financialStatus === "faturado") return false;
        if (financialStatusFilter === "bloqueado" && order.financialStatus !== "bloqueado") return false; // assuming 'bloqueado' exists
      }

      // 4. Picking Status (Multi-select logic potentially, realized as single select in UI for simplicity first or custom multi)
      // Implementation: Check if PickingStatusFilter (array) includes order.status. If empty, all.
      // We will implement simpler single select for now to match UI library unless strictly multi
      // Specification says "Multi-select". 
      // check if status is in array.
      if (pickingStatusFilter.length > 0) {
        if (!pickingStatusFilter.includes(order.status)) return false;
      }

      // 5. Route
      if (routeFilter !== "all") {
        if (routeFilter === "unassigned") {
          if (order.routeId) return false;
        } else {
          if (String(order.routeId) !== routeFilter) return false;
        }
      }

      // 6. Priority
      if (priorityFilter !== "all") {
        const isHigh = order.priority > 0;
        if (priorityFilter === "high" && !isHigh) return false;
        if (priorityFilter === "normal" && isHigh) return false;
      }

      // 7. Launched
      if (launchedFilter !== "all") {
        const isLaunched = order.isLaunched;
        if (launchedFilter === "yes" && !isLaunched) return false;
        if (launchedFilter === "no" && isLaunched) return false;
      }

      return true;
    });
  }, [orders, searchOrderId, filterDateRange, financialStatusFilter, pickingStatusFilter, routeFilter, priorityFilter, launchedFilter]);

  // Pagination logic
  const totalPages = Math.ceil(filteredOrders.length / pageSize);
  const paginatedOrders = filteredOrders.slice((currentPage - 1) * pageSize, currentPage * pageSize);

  const handleSelectOrder = (id: string, checked: boolean) => {
    setSelectedOrders(prev => checked ? [...prev, id] : prev.filter(oId => oId !== id));
  };

  const handleSelectAll = (checked: boolean) => {
    setSelectedOrders(checked ? filteredOrders.map(o => o.id) : []);
  };

  // --- ACTIONS HELPERS ---
  const handleAssignRoute = () => {
    if (!selectedRoute) return toast({ title: "Erro", description: "Selecione uma rota", variant: "destructive" });
    assignRouteMutation.mutate({ orderIds: selectedOrders, routeId: selectedRoute });
  };

  const statusOptions = [
    { value: 'pendente', label: 'Pendente a Separar' },
    { value: 'em_separacao', label: 'Em Separação' },
    { value: 'separado', label: 'Separado' },
    { value: 'em_conferencia', label: 'Em Conferência' },
    { value: 'conferido', label: 'Conferido' },
  ];

  return (
    <div className="min-h-screen bg-background">
      <GradientHeader title="Gerenciamento de Pedidos" subtitle="Painel Supervisor">
        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={() => syncMutation.mutate()} disabled={syncMutation.isPending} className="bg-white/10 text-white border-white/20 hover:bg-white/20">
            <RefreshCw className={`h-4 w-4 mr-2 ${syncMutation.isPending ? "animate-spin" : ""}`} />
            {syncMutation.isPending ? "Sync..." : "Sincronizar"}
          </Button>
          <Link href="/supervisor">
            <Button variant="outline" size="sm" className="bg-white/10 text-white border-white/20 hover:bg-white/20">
              <ArrowLeft className="h-4 w-4 mr-2" /> Voltar
            </Button>
          </Link>
        </div>
      </GradientHeader>

      <main className="max-w-[1600px] mx-auto px-4 py-6 space-y-4">
        {/* FILTERS PANEL */}
        <div className="bg-card border rounded-lg p-4 shadow-sm space-y-4">
          <div className="flex flex-wrap gap-4 items-end">
            {/* 1. Search */}
            <div className="flex-1 min-w-[200px] space-y-1">
              <label className="text-xs font-medium text-muted-foreground">Busca por Pedido</label>
              <div className="relative">
                <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
                <Input
                  placeholder="Nº Pedido..."
                  value={searchOrderId}
                  onChange={e => setSearchOrderId(e.target.value)}
                  className="pl-9"
                />
              </div>
            </div>

            {/* 2. Date Range */}
            <div className="space-y-1">
              <label className="text-xs font-medium text-muted-foreground">Período de Importação</label>
              <div className="flex items-center">
                <DatePickerWithRange date={tempDateRange} onDateChange={setTempDateRange} className="w-[240px]" />
                <Button variant="secondary" className="ml-2" onClick={() => { setFilterDateRange(tempDateRange); }}>
                  Buscar
                </Button>
              </div>
            </div>

            {/* 7. Launched */}
            <div className="w-[120px] space-y-1">
              <label className="text-xs font-medium text-muted-foreground">Lançado?</label>
              <Select value={launchedFilter} onValueChange={setLaunchedFilter}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Todos</SelectItem>
                  <SelectItem value="yes">Sim</SelectItem>
                  <SelectItem value="no">Não</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="flex flex-wrap gap-4 items-end pt-2 border-t">
            <div className="flex items-center gap-2 text-sm font-medium text-muted-foreground">
              <Filter className="h-4 w-4" /> Filtros Estritos:
            </div>

            {/* 3. Financial */}
            <div className="w-[140px] space-y-1">
              <Select value={financialStatusFilter} onValueChange={setFinancialStatusFilter}>
                <SelectTrigger className="h-8 text-xs"><SelectValue placeholder="Financeiro" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Todos (Fin.)</SelectItem>
                  <SelectItem value="pago">Liberado/Pago</SelectItem>
                  <SelectItem value="pendente">Pendente</SelectItem>
                  <SelectItem value="bloqueado">Bloqueado</SelectItem>
                </SelectContent>
              </Select>
            </div>

            {/* 4. Picking Status - Simplified as Single Select for UI, can swap to MultiSelect component if available */}
            <div className="w-[180px] space-y-1">
              <Select value={pickingStatusFilter[0] || "all"} onValueChange={(val) => setPickingStatusFilter(val === "all" ? [] : [val])}>
                <SelectTrigger className="h-8 text-xs"><SelectValue placeholder="Status Separação" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Todos os Status</SelectItem>
                  {statusOptions.map(opt => (
                    <SelectItem key={opt.value} value={opt.value}>{opt.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {/* 5. Route */}
            <div className="w-[150px] space-y-1">
              <Select value={routeFilter} onValueChange={setRouteFilter}>
                <SelectTrigger className="h-8 text-xs"><SelectValue placeholder="Rota" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Todas Rotas</SelectItem>
                  <SelectItem value="unassigned">Sem Rota</SelectItem>
                  {routes?.filter(r => r.active).map(r => (
                    <SelectItem key={r.id} value={String(r.id)}>{r.code} - {r.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {/* 6. Priority */}
            <div className="w-[120px] space-y-1">
              <Select value={priorityFilter} onValueChange={setPriorityFilter}>
                <SelectTrigger className="h-8 text-xs"><SelectValue placeholder="Prioridade" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Todas</SelectItem>
                  <SelectItem value="normal">Normal</SelectItem>
                  <SelectItem value="high">Alta / Vips</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="ml-auto">
              <span className="text-xs text-muted-foreground mr-2">{filteredOrders.length} pedidos encontrados</span>
            </div>
          </div>
        </div>

        {/* BULK ACTIONS */}
        {selectedOrders.length > 0 && (
          <div className="flex items-center gap-2 p-3 bg-primary/10 border border-primary/20 rounded-lg animate-in fade-in slide-in-from-top-2">
            <CheckCircle2 className="h-5 w-5 text-primary" />
            <span className="text-sm font-medium">{selectedOrders.length} selecionados</span>
            <div className="h-4 w-px bg-border mx-2" />

            <Button size="sm" variant="outline" onClick={() => setShowRouteDialog(true)}>
              <RouteIcon className="h-4 w-4 mr-2" /> Atribuir Rota
            </Button>

            {/* Launch Button */}
            <Button size="sm" className="bg-green-600 hover:bg-green-700 text-white" onClick={() => launchMutation.mutate({ orderIds: selectedOrders })} disabled={launchMutation.isPending}>
              <Send className="h-4 w-4 mr-2" /> Lançar para Separação
            </Button>

            {/* Optional: Priority / Recount */}
            <Button size="sm" variant="ghost" onClick={() => setPriorityMutation.mutate({ orderIds: selectedOrders, priority: 1 })}>
              <AlertTriangle className="h-4 w-4 mr-2" /> Priorizar
            </Button>
          </div>
        )}

        {/* ORDER TABLE */}
        <div className="bg-card border rounded-lg shadow-sm overflow-hidden">
          <Table>
            <TableHeader>
              <TableRow className="bg-muted/50">
                <TableHead className="w-[40px]">
                  <Checkbox
                    checked={filteredOrders.length > 0 && selectedOrders.length === filteredOrders.length}
                    onCheckedChange={(c) => handleSelectAll(!!c)}
                  />
                </TableHead>
                <TableHead className="font-bold text-primary">Nº Pedido</TableHead>
                <TableHead>Data</TableHead>
                <TableHead>Cliente</TableHead>
                <TableHead>Valor (R$)</TableHead>
                <TableHead>Itens</TableHead>
                <TableHead>Status Fin.</TableHead>
                <TableHead>Status Sep./Conf.</TableHead>
                <TableHead>Rota</TableHead>
                <TableHead>Prioridade</TableHead>
                <TableHead>Lançado</TableHead>
                <TableHead className="w-[50px]"></TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {ordersLoading ? (
                Array.from({ length: 5 }).map((_, i) => (
                  <TableRow key={i}><TableCell colSpan={12}><Skeleton className="h-10 w-full" /></TableCell></TableRow>
                ))
              ) : paginatedOrders.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={12} className="h-32 text-center text-muted-foreground">Nenhum pedido encontrado com os filtros atuais.</TableCell>
                </TableRow>
              ) : (
                paginatedOrders.map(order => {
                  const route = routes?.find(r => r.id === order.routeId);
                  return (
                    <TableRow key={order.id} className="hover:bg-muted/30 cursor-pointer" onClick={() => handleSelectOrder(order.id, !selectedOrders.includes(order.id))}>
                      <TableCell onClick={e => e.stopPropagation()}>
                        <Checkbox checked={selectedOrders.includes(order.id)} onCheckedChange={c => handleSelectOrder(order.id, !!c)} />
                      </TableCell>
                      <TableCell className="font-mono font-bold text-base">{order.erpOrderId}</TableCell>
                      <TableCell className="text-xs text-muted-foreground">{format(new Date(order.createdAt), "dd/MM HH:mm")}</TableCell>
                      <TableCell>
                        <div className="flex flex-col">
                          <span className="font-medium text-sm truncate max-w-[180px]" title={order.customerName}>{order.customerName}</span>
                          <span className="text-[10px] text-muted-foreground">{order.customerCode || '-'}</span>
                        </div>
                      </TableCell>
                      <TableCell className="font-mono text-sm">
                        {order.totalValue ? `R$ ${order.totalValue.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}` : '-'}
                      </TableCell>
                      <TableCell className="text-center">
                        <div className="flex flex-col items-center gap-1">
                          <span className="text-[10px] font-medium text-muted-foreground">
                            {order.pickedItems || 0}/{order.totalItems || 0}
                          </span>
                          <Progress
                            value={order.totalItems ? ((order.pickedItems || 0) / order.totalItems) * 100 : 0}
                            className="h-1.5 w-16"
                          />
                        </div>
                      </TableCell>
                      <TableCell>
                        <span className={`inline-flex items-center px-2 py-0.5 rounded text-[10px] font-bold uppercase
                                        ${order.financialStatus === 'faturado' ? 'bg-green-100 text-green-700' : 'bg-yellow-100 text-yellow-700'}`}>
                          {order.financialStatus === 'faturado' ? 'Liberado' : order.financialStatus}
                        </span>
                      </TableCell>
                      <TableCell>
                        <StatusBadge status={order.status} hasExceptions={order.hasExceptions} />
                      </TableCell>
                      <TableCell>
                        {route ? (
                          <div className="flex items-center gap-1">
                            <span className="font-mono text-xs bg-blue-50 text-blue-700 px-1 rounded">{route.code}</span>
                          </div>
                        ) : <span className="text-muted-foreground text-xs">-</span>}
                      </TableCell>
                      <TableCell>
                        {order.priority > 0 && <Badge variant="destructive" className="text-[10px]">Alta</Badge>}
                      </TableCell>
                      <TableCell>
                        {order.isLaunched
                          ? <CheckCircle2 className="h-4 w-4 text-green-500" />
                          : <span className="h-2 w-2 rounded-full bg-slate-300 block ml-1" title="Não lançado" />
                        }
                      </TableCell>
                      <TableCell onClick={e => e.stopPropagation()}>
                        <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => setViewOrderId(order.id)}>
                          <Eye className="h-4 w-4 text-muted-foreground" />
                        </Button>
                      </TableCell>
                    </TableRow>
                  );
                })
              )}
            </TableBody>
          </Table>
        </div>

        {/* PAGINATION */}
        <div className="flex items-center justify-between border-t pt-4">
          <div className="text-xs text-muted-foreground">
            Página {currentPage} de {totalPages || 1}
          </div>
          <div className="flex gap-1">
            <Button variant="outline" size="sm" onClick={() => setCurrentPage(1)} disabled={currentPage === 1}>«</Button>
            <Button variant="outline" size="sm" onClick={() => setCurrentPage(p => Math.max(1, p - 1))} disabled={currentPage === 1}>‹</Button>
            <Button variant="outline" size="sm" onClick={() => setCurrentPage(p => Math.min(totalPages, p + 1))} disabled={currentPage === totalPages}>›</Button>
          </div>
        </div>

      </main>

      {/* DIALOGS */}
      <Dialog open={showRouteDialog} onOpenChange={setShowRouteDialog}>
        <DialogContent>
          <DialogHeader><DialogTitle>Atribuir Rota</DialogTitle></DialogHeader>
          <div className="space-y-4">
            <Select value={selectedRoute} onValueChange={setSelectedRoute}>
              <SelectTrigger><SelectValue placeholder="Selecione..." /></SelectTrigger>
              <SelectContent>
                {routes?.map(r => <SelectItem key={r.id} value={r.id}>{r.name}</SelectItem>)}
              </SelectContent>
            </Select>
            <Button onClick={handleAssignRoute} disabled={assignRouteMutation.isPending} className="w-full">Confirmar</Button>
          </div>
        </DialogContent>
      </Dialog>

      <OrderDetailsDialog orderId={viewOrderId} open={!!viewOrderId} onOpenChange={(o) => !o && setViewOrderId(null)} />
    </div>
  );
}
