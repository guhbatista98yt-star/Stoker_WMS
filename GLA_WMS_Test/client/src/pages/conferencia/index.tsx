import { useState, useEffect, useMemo, useCallback } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useAuth, useSessionQueryKey } from "@/lib/auth";
import { DatePickerWithRange } from "@/components/ui/date-range-picker";
import { DateRange } from "react-day-picker";
import { ScanInput } from "@/components/ui/scan-input";
import { ResultDialog } from "@/components/ui/result-dialog";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Checkbox } from "@/components/ui/checkbox";
import { Progress } from "@/components/ui/progress";
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";
import { useSSE } from "@/hooks/use-sse";
import { useBarcodeScanner } from "@/hooks/use-barcode-scanner";
import {
  ClipboardCheck,
  Package,
  List,
  LogOut,
  Check,
  AlertTriangle,
  Search,
  Plus,
  ArrowRight,
  Calendar,
  Truck,
  Lock,
} from "lucide-react";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import type { WorkUnitWithDetails, OrderItem, Product, ExceptionType, UserSettings } from "@shared/schema";
import { ExceptionDialog } from "@/components/orders/exception-dialog";
import { getCurrentWeekRange } from "@/lib/date-utils";
import { format } from "date-fns";

type ConferenciaStep = "select" | "checking";
type CheckingTab = "product" | "list";

const STORAGE_KEY = "wms:conferencia-session";

interface SessionData {
  tab: CheckingTab;
  productIndex: number;
  workUnitIds: string[];
}

interface ItemWithProduct extends OrderItem {
  product: Product;
  exceptionQty?: number;
}

interface AggregatedProduct {
  product: Product;
  totalSeparatedQty: number;
  checkedQty: number;
  exceptionQty: number;
  items: ItemWithProduct[];
  orderCodes: string[];
  sections: string[];
}

function saveSession(data: SessionData) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
  } catch {}
}

function loadSession(): SessionData | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) return JSON.parse(raw);
  } catch {}
  return null;
}

function clearSession() {
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch {}
}

export default function ConferenciaPage() {
  const { user, logout } = useAuth();
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const [step, setStep] = useState<ConferenciaStep>("select");
  const [selectedWorkUnits, setSelectedWorkUnits] = useState<string[]>([]);
  const [checkingTab, setCheckingTab] = useState<CheckingTab>("product");
  const [currentProductIndex, setCurrentProductIndex] = useState(0);

  const [scanStatus, setScanStatus] = useState<"idle" | "success" | "error" | "warning">("idle");
  const [scanMessage, setScanMessage] = useState("");
  const [showResultDialog, setShowResultDialog] = useState(false);
  const [resultDialogConfig, setResultDialogConfig] = useState({
    type: "success" as "success" | "error" | "warning",
    title: "",
    message: "",
  });

  useEffect(() => {
    if (scanStatus !== "idle") {
      const timer = setTimeout(() => {
        setScanStatus("idle");
        setScanMessage("");
      }, 2000);
      return () => clearTimeout(timer);
    }
  }, [scanStatus]);

  const [showExceptionDialog, setShowExceptionDialog] = useState(false);
  const [exceptionItem, setExceptionItem] = useState<ItemWithProduct | null>(null);

  const [filterOrderId, setFilterOrderId] = useState("");
  const [filterRoute, setFilterRoute] = useState<string>("");
  const [dateRange, setDateRange] = useState<DateRange | undefined>(getCurrentWeekRange());
  const [tempDateRange, setTempDateRange] = useState<DateRange | undefined>(getCurrentWeekRange());

  const [sessionRestored, setSessionRestored] = useState(false);
  const [multiplierValue, setMultiplierValue] = useState(1);
  const [manualQtyAllowed, setManualQtyAllowed] = useState<Record<string, boolean>>({});

  const userSettings = (user?.settings as UserSettings) || {};
  const hasManualQtyPermission = !!userSettings.allowManualQty;
  const hasMultiplierPermission = !!userSettings.allowMultiplier;

  const workUnitsQueryKey = useSessionQueryKey(["/api/work-units", "conferencia"]);
  const routesQueryKey = useSessionQueryKey(["/api/routes"]);

  const { data: workUnits, isLoading } = useQuery<WorkUnitWithDetails[]>({
    queryKey: workUnitsQueryKey,
    refetchInterval: 1000,
  });

  const { data: routes } = useQuery<{id: string; code: string; name: string}[]>({
    queryKey: routesQueryKey,
  });

  const handleSSEMessage = useCallback((type: string, _data: any) => {
    queryClient.invalidateQueries({ queryKey: workUnitsQueryKey });
    if (type === "exception_created") {
      toast({
        title: "Nova Exceção",
        description: "Uma exceção foi registrada",
        variant: "destructive",
      });
    }
  }, [queryClient, workUnitsQueryKey, toast]);

  useSSE("/api/sse", [
    "picking_update", "lock_acquired", "lock_released", "picking_finished",
    "conference_started", "conference_finished", "exception_created",
  ], handleSSEMessage);

  const myLockedUnits = useMemo(() => {
    if (!workUnits || !user) return [];
    return workUnits.filter(wu => wu.lockedBy === user.id && wu.status !== "concluido");
  }, [workUnits, user]);

  const allMyUnits = useMemo(() => {
    if (!workUnits || !user) return [];
    return workUnits.filter(wu => wu.lockedBy === user.id);
  }, [workUnits, user]);

  const aggregatedProducts = useMemo((): AggregatedProduct[] => {
    const units = allMyUnits.length > 0 ? allMyUnits : [];
    const allItems: ItemWithProduct[] = units.flatMap(wu => (wu.items as ItemWithProduct[]) || []).filter(item => Number(item.separatedQty) > 0);

    const map: Record<string, AggregatedProduct> = {};
    allItems.forEach(item => {
      const pid = item.productId;
      if (!map[pid]) {
        map[pid] = {
          product: item.product,
          totalSeparatedQty: 0,
          checkedQty: 0,
          exceptionQty: 0,
          items: [],
          orderCodes: [],
          sections: [],
        };
      }
      map[pid].totalSeparatedQty += Number(item.separatedQty);
      map[pid].checkedQty += Number(item.checkedQty);
      map[pid].exceptionQty += Number(item.exceptionQty || 0);
      map[pid].items.push(item);

      const wu = units.find(w => w.items.some(i => i.id === item.id));
      if (wu && !map[pid].orderCodes.includes(wu.order.erpOrderId)) {
        map[pid].orderCodes.push(wu.order.erpOrderId);
      }
      if (item.section && !map[pid].sections.includes(item.section)) {
        map[pid].sections.push(item.section);
      }
    });

    return Object.values(map);
  }, [allMyUnits]);

  const currentProduct = aggregatedProducts[currentProductIndex] || aggregatedProducts[0] || null;

  useEffect(() => {
    if (aggregatedProducts.length > 0 && currentProductIndex >= aggregatedProducts.length) {
      setCurrentProductIndex(0);
    }
  }, [aggregatedProducts.length, currentProductIndex]);

  useEffect(() => {
    if (!hasManualQtyPermission && !hasMultiplierPermission) return;
    if (aggregatedProducts.length === 0) return;

    const productIds = aggregatedProducts.map(ap => ap.product.id).filter(id => !(id in manualQtyAllowed));
    if (productIds.length === 0) return;

    apiRequest("POST", "/api/manual-qty-rules/check", { productIds })
      .then(res => res.json())
      .then((results: Record<string, boolean>) => {
        setManualQtyAllowed(prev => ({ ...prev, ...results }));
      })
      .catch(() => {
        const fallback: Record<string, boolean> = {};
        productIds.forEach(id => { fallback[id] = false; });
        setManualQtyAllowed(prev => ({ ...prev, ...fallback }));
      });
  }, [aggregatedProducts, hasManualQtyPermission, hasMultiplierPermission]);

  useEffect(() => {
    if (workUnits && user && !sessionRestored) {
      setSessionRestored(true);
      const saved = loadSession();
      if (saved && saved.workUnitIds.length > 0) {
        const stillLockedIds = saved.workUnitIds.filter(id =>
          workUnits.some(wu => wu.id === id && wu.lockedBy === user.id)
        );
        if (stillLockedIds.length > 0) {
          setStep("checking");
          setCheckingTab(saved.tab);
          setCurrentProductIndex(0);
          setSelectedWorkUnits(stillLockedIds);
          toast({ title: "Sessão Restaurada", description: "Retomando conferência anterior" });
          return;
        } else {
          clearSession();
        }
      }

      const myUnit = workUnits.find(wu => wu.lockedBy === user.id && wu.status !== "concluido");
      if (myUnit) {
        const myIds = workUnits.filter(wu => wu.lockedBy === user.id).map(wu => wu.id);
        setStep("checking");
        setSelectedWorkUnits(myIds);
        toast({ title: "Sessão Restaurada", description: `Retomando pedido ${myUnit.order.erpOrderId}` });
      }
    }
  }, [workUnits, user, sessionRestored, toast]);

  useEffect(() => {
    if (step === "checking" && allMyUnits.length > 0) {
      saveSession({
        tab: checkingTab,
        productIndex: currentProductIndex,
        workUnitIds: allMyUnits.map(wu => wu.id),
      });
    }
  }, [step, checkingTab, currentProductIndex, allMyUnits]);

  const lockMutation = useMutation({
    mutationFn: async (workUnitIds: string[]) => {
      const res = await apiRequest("POST", "/api/work-units/lock", { workUnitIds });
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: workUnitsQueryKey });
    },
  });

  const unlockMutation = useMutation({
    mutationFn: async (data: string[] | { ids: string[], reset: boolean }) => {
      const body = Array.isArray(data)
        ? { workUnitIds: data }
        : { workUnitIds: data.ids, reset: data.reset };
      const res = await apiRequest("POST", "/api/work-units/unlock", body);
      if (!res.ok) throw new Error("Erro ao desbloquear unidades");
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: workUnitsQueryKey });
      clearSession();
      setSelectedWorkUnits([]);
      setStep("select");
      setCurrentProductIndex(0);
      setCheckingTab("product");
    },
  });

  const scanItemMutation = useMutation({
    mutationFn: async ({ workUnitId, barcode }: { workUnitId: string; barcode: string }) => {
      const res = await apiRequest("POST", `/api/work-units/${workUnitId}/check-item`, { barcode });
      return res.json();
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: workUnitsQueryKey });
      if (data.workUnit) {
        queryClient.setQueryData(workUnitsQueryKey, (oldData: any[]) => {
          if (!oldData) return oldData;
          return oldData.map(wu => wu.id === data.workUnit.id ? data.workUnit : wu);
        });
      }
    },
  });

  const createExceptionMutation = useMutation({
    mutationFn: async (data: {
      workUnitId: string;
      orderItemId: string;
      type: ExceptionType;
      quantity: number;
      observation: string;
    }) => {
      const res = await apiRequest("POST", "/api/exceptions", data);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: workUnitsQueryKey });
      toast({ title: "Exceção Registrada", description: "A exceção foi reportada com sucesso" });
      setShowExceptionDialog(false);
      setExceptionItem(null);
    },
    onError: (error: Error) => {
      let message = "Falha ao registrar exceção";
      try {
        const errorData = JSON.parse(error.message);
        if (errorData.error) message = errorData.error;
      } catch {}
      toast({ title: "Erro", description: message, variant: "destructive" });
    },
  });

  const completeWorkUnitMutation = useMutation({
    mutationFn: async (id: string) => {
      const res = await apiRequest("POST", `/api/work-units/${id}/complete`);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: workUnitsQueryKey });
    },
    onError: () => {
      toast({ title: "Erro", description: "Itens pendentes.", variant: "destructive" });
    },
  });

  const clearExceptionsMutation = useMutation({
    mutationFn: async (orderItemId: string) => {
      const res = await apiRequest("DELETE", `/api/exceptions/item/${orderItemId}`);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: workUnitsQueryKey });
      toast({ title: "Exceções Limpas", description: "As exceções foram removidas com sucesso" });
    },
    onError: () => {
      toast({ title: "Erro", description: "Falha ao limpar exceções", variant: "destructive" });
    },
  });

  const availableWorkUnits = useMemo(() => {
    return workUnits?.filter((wu) => {
      const orderStatus = wu.order.status;
      if (orderStatus !== "separado" && orderStatus !== "em_conferencia") return false;
      if (!wu.order.isLaunched) return false;
      if (wu.status === "concluido") return false;
      if (filterOrderId && !wu.order.erpOrderId.toLowerCase().includes(filterOrderId.toLowerCase())) return false;

      if (filterRoute && wu.order.routeId !== filterRoute) return false;

      if (dateRange?.from) {
        const orderDate = new Date(wu.order.createdAt);
        const fromDate = new Date(dateRange.from);
        fromDate.setHours(0, 0, 0, 0);
        if (dateRange.to) {
          const toDate = new Date(dateRange.to);
          toDate.setHours(23, 59, 59, 999);
          if (orderDate < fromDate || orderDate > toDate) return false;
        } else {
          if (orderDate < fromDate) return false;
        }
      }

      return true;
    }) || [];
  }, [workUnits, user, filterOrderId, filterRoute, dateRange]);

  const groupedWorkUnits = useMemo(() => {
    const groups: Record<string, typeof availableWorkUnits> = {};
    availableWorkUnits.forEach((wu) => {
      if (!groups[wu.orderId]) groups[wu.orderId] = [];
      groups[wu.orderId].push(wu);
    });
    return Object.values(groups);
  }, [availableWorkUnits]);

  const handleSelectGroup = (wus: typeof availableWorkUnits, checked: boolean) => {
    const safeWus = wus.filter(wu => !wu.lockedBy || wu.lockedBy === user?.id);
    const ids = safeWus.map((wu) => wu.id);
    if (ids.length === 0) return;
    if (checked) {
      setSelectedWorkUnits((prev) => Array.from(new Set([...prev, ...ids])));
    } else {
      setSelectedWorkUnits((prev) => prev.filter((id) => !ids.includes(id)));
    }
  };

  const handleStartConferencia = async () => {
    if (selectedWorkUnits.length === 0) {
      toast({ title: "Atenção", description: "Selecione pelo menos um pedido", variant: "destructive" });
      return;
    }
    try {
      await lockMutation.mutateAsync(selectedWorkUnits);
      setStep("checking");
      setCheckingTab("product");
      setCurrentProductIndex(0);
      setScanStatus("idle");
      setScanMessage("");
    } catch {
      toast({ title: "Erro", description: "Falha ao bloquear unidades de trabalho", variant: "destructive" });
    }
  };

  const handleScanItem = useCallback(async (barcode: string) => {
    const units = allMyUnits;
    if (units.length === 0) return;

    const unitsWithProduct = units.filter(wu =>
      (wu.items as ItemWithProduct[]).some(item =>
        item.product?.barcode === barcode || item.product?.boxBarcode === barcode
      )
    );

    let targetUnit = unitsWithProduct.find(wu => {
      const item = (wu.items as ItemWithProduct[]).find(i =>
        i.product?.barcode === barcode || i.product?.boxBarcode === barcode
      );
      if (!item) return false;
      const exceptionQty = Number(item.exceptionQty || 0);
      return Number(item.checkedQty) + exceptionQty < Number(item.separatedQty);
    });

    const finalUnit = targetUnit || unitsWithProduct[0] || units[0];
    if (!finalUnit) return;

    try {
      const result = await scanItemMutation.mutateAsync({ workUnitId: finalUnit.id, barcode });

      if (result.status === "success") {
        setScanStatus("success");
        setScanMessage(`${result.product.name} - ${result.quantity} ${result.product.unit}`);

        const productId = result.product.id;
        const idx = aggregatedProducts.findIndex(ap => ap.product.id === productId);
        if (idx >= 0) {
          setCurrentProductIndex(idx);
        }
        setCheckingTab("product");

        const updatedUnits = units.map(wu => wu.id === result.workUnit.id ? result.workUnit : wu);
        const allCompleted = updatedUnits.every(wu => wu.status === "concluido");
        if (allCompleted) {
          handleCompleteAll();
        }
      } else if (result.status === "over_quantity_with_exception") {
        setScanStatus("error");
        setScanMessage(result.message || "Quantidade excedida considerando exceções");
        setResultDialogConfig({ type: "warning", title: "Exceções Registradas", message: result.message || "Este item tem exceções registradas." });
        setShowResultDialog(true);
      } else if (result.status === "over_quantity") {
        setScanStatus("error");
        setScanMessage("Quantidade excedida!");
        setResultDialogConfig({ type: "error", title: "Quantidade Excedida", message: "O item foi conferido mais vezes que o necessário." });
        setShowResultDialog(true);
      } else if (result.status === "not_found") {
        setScanStatus("warning");
        setScanMessage("Produto não encontrado neste pedido");
      }
    } catch {
      setScanStatus("error");
      setScanMessage("Erro ao processar leitura");
    }
  }, [allMyUnits, scanItemMutation, aggregatedProducts]);

  const globalScanHandler = useCallback((barcode: string) => {
    if (step === "checking") {
      handleScanItem(barcode);
    }
  }, [step, handleScanItem]);

  useBarcodeScanner(globalScanHandler, step === "checking");

  const handleIncrementProduct = async (ap: AggregatedProduct, qty: number = 1) => {
    const remaining = ap.totalSeparatedQty - ap.checkedQty - ap.exceptionQty;
    if (remaining <= 0) return;

    const effectiveQty = Math.min(qty, remaining);
    const barcode = ap.product.barcode;
    if (!barcode) return;

    try {
      let successCount = 0;
      for (let i = 0; i < effectiveQty; i++) {
        const incompleteItem = ap.items.find(it =>
          Number(it.checkedQty) + Number(it.exceptionQty || 0) + successCount < Number(it.separatedQty)
        );
        if (!incompleteItem) break;
        const wu = allMyUnits.find(w => w.items.some(it => it.id === incompleteItem.id));
        if (!wu) break;

        try {
          const result = await scanItemMutation.mutateAsync({ workUnitId: wu.id, barcode });
          if (result.status === "success") {
            successCount++;
          } else {
            break;
          }
        } catch {
          break;
        }
      }
      if (successCount > 0) {
        setScanStatus("success");
        setScanMessage(`+${successCount} ${ap.product.name}`);
        setMultiplierValue(1);
      } else {
        setScanStatus("error");
        setScanMessage("Quantidade excedida!");
      }
    } catch {
      setScanStatus("error");
      setScanMessage("Erro ao incrementar");
    }
  };

  const handleCompleteAll = async () => {
    const incompleteUnits = myLockedUnits.filter(wu => wu.status !== "concluido");
    try {
      for (const wu of incompleteUnits) {
        await completeWorkUnitMutation.mutateAsync(wu.id);
      }
      clearSession();
      setStep("select");
      setSelectedWorkUnits([]);
      setCurrentProductIndex(0);
      setCheckingTab("product");
      toast({ title: "Conferência Concluída!", description: "Todos os itens foram conferidos com sucesso." });
    } catch {
      toast({ title: "Erro", description: "Falha ao concluir. Verifique itens pendentes.", variant: "destructive" });
    }
  };

  const handleCancelChecking = () => {
    const ids = allMyUnits.map(wu => wu.id);
    if (ids.length > 0) {
      unlockMutation.mutate({ ids, reset: true });
    } else {
      clearSession();
      setStep("select");
      setSelectedWorkUnits([]);
    }
  };

  const handleNextProduct = () => {
    const nextIdx = aggregatedProducts.findIndex((ap, idx) => {
      if (idx <= currentProductIndex) return false;
      const remaining = ap.totalSeparatedQty - ap.checkedQty - ap.exceptionQty;
      return remaining > 0;
    });

    if (nextIdx >= 0) {
      setCurrentProductIndex(nextIdx);
    } else {
      const wrapIdx = aggregatedProducts.findIndex((ap) => {
        const remaining = ap.totalSeparatedQty - ap.checkedQty - ap.exceptionQty;
        return remaining > 0;
      });
      if (wrapIdx >= 0) {
        setCurrentProductIndex(wrapIdx);
      }
    }
  };

  const getProgress = () => {
    if (aggregatedProducts.length === 0) return 0;
    const total = aggregatedProducts.reduce((s, ap) => s + ap.totalSeparatedQty, 0);
    const done = aggregatedProducts.reduce((s, ap) => s + ap.checkedQty + ap.exceptionQty, 0);
    return total > 0 ? (done / total) * 100 : 0;
  };

  const allItemsComplete = aggregatedProducts.length > 0 && aggregatedProducts.every(ap =>
    ap.checkedQty + ap.exceptionQty >= ap.totalSeparatedQty
  );

  const handleApplyDateFilter = () => {
    setDateRange(tempDateRange);
  };

  return (
    <div className="min-h-screen bg-background flex flex-col" data-module="conferencia">
      <header className="flex items-center justify-between px-3 py-2 border-b border-border bg-card">
        <div className="flex items-center gap-2 min-w-0">
          <ClipboardCheck className="h-4 w-4 text-primary shrink-0" />
          <span className="text-sm font-medium truncate">{user?.name}</span>
        </div>
        <Button variant="ghost" size="sm" onClick={logout} className="h-8 px-2 text-xs" data-testid="button-logout">
          <LogOut className="h-3.5 w-3.5 mr-1" />
          Sair
        </Button>
      </header>

      {step === "select" && (
        <div className="flex-1 overflow-auto px-3 py-3 space-y-3">
          <div className="space-y-2 p-2.5 bg-muted/30 rounded-lg border border-border">
            <div className="flex items-center gap-2">
              <Search className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
              <Input
                placeholder="N° Pedido..."
                value={filterOrderId}
                onChange={(e) => setFilterOrderId(e.target.value)}
                className="h-8 text-xs"
              />
            </div>
            <div className="flex items-center gap-2">
              <Calendar className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
              <div className="flex-1">
                <DatePickerWithRange
                  date={tempDateRange}
                  onDateChange={setTempDateRange}
                  className="text-xs h-8"
                />
              </div>
              <Button size="sm" className="h-8 px-3 text-xs" onClick={handleApplyDateFilter}>
                Buscar
              </Button>
            </div>
            <div className="flex items-center gap-2">
              <Truck className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
              <Select value={filterRoute} onValueChange={(val) => setFilterRoute(val === "__all__" ? "" : val)}>
                <SelectTrigger className="h-8 text-xs flex-1">
                  <SelectValue placeholder="Todas as rotas" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="__all__">Todas as rotas</SelectItem>
                  {routes?.map(route => (
                    <SelectItem key={route.id} value={route.id}>{route.code} - {route.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          {isLoading ? (
            <div className="space-y-2">
              {Array.from({ length: 4 }).map((_, i) => (
                <Skeleton key={i} className="h-14 w-full rounded-lg" />
              ))}
            </div>
          ) : groupedWorkUnits.length > 0 ? (
            <div className="space-y-1.5">
              {groupedWorkUnits.map((group) => {
                const firstWU = group[0];
                const groupIds = group.map(g => g.id);
                const isSelected = groupIds.every(id => selectedWorkUnits.includes(id));
                const lockedByOther = group.some(wu => wu.lockedBy && wu.lockedBy !== user?.id);
                const lockerName = group.find(wu => wu.lockedBy && wu.lockedBy !== user?.id)?.lockedByName;

                const totalItems = group.reduce((acc, wu) => {
                  const items = wu.items || [];
                  return acc + items.reduce((s, item) => s + Number(item.separatedQty), 0);
                }, 0);

                let createdAt = "";
                try {
                  createdAt = format(new Date(firstWU.order.createdAt), "dd/MM HH:mm");
                } catch {}

                const routeName = routes?.find(r => r.id === firstWU.order.routeId)?.name;

                return (
                  <div
                    key={firstWU.orderId}
                    className={`flex items-center gap-2.5 p-2.5 rounded-lg border transition-colors ${
                      lockedByOther
                        ? "opacity-50 cursor-not-allowed border-border"
                        : isSelected ? "border-primary bg-primary/5" : "border-border"
                    }`}
                    onClick={() => !lockedByOther && handleSelectGroup(group, !isSelected)}
                    data-testid={`order-group-${firstWU.orderId}`}
                  >
                    {lockedByOther ? (
                      <Lock className="h-4 w-4 text-muted-foreground shrink-0" />
                    ) : (
                      <Checkbox
                        checked={isSelected}
                        onCheckedChange={(checked) => handleSelectGroup(group, !!checked)}
                        className="shrink-0"
                        data-testid={`checkbox-order-${firstWU.orderId}`}
                      />
                    )}
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-1.5">
                        <span className="font-mono text-sm font-semibold">{firstWU.order.erpOrderId}</span>
                        {routeName && <span className="text-[10px] px-1.5 py-0.5 bg-blue-100 text-blue-700 rounded font-medium">Rota: {routeName}</span>}
                      </div>
                      <p className="text-xs text-muted-foreground truncate">{firstWU.order.customerName}</p>
                      {lockedByOther && (
                        <p className="text-[10px] text-orange-600 font-medium flex items-center gap-1 mt-0.5">
                          <Lock className="h-3 w-3" />
                          Em conferência por: {lockerName || "outro usuário"}
                        </p>
                      )}
                    </div>
                    <div className="text-right shrink-0">
                      <p className="text-xs font-medium">{totalItems} itens</p>
                      <p className="text-[10px] text-muted-foreground">{createdAt}</p>
                    </div>
                  </div>
                );
              })}

              <Button
                className="w-full h-11 text-sm mt-3"
                onClick={handleStartConferencia}
                disabled={selectedWorkUnits.length === 0 || lockMutation.isPending}
                data-testid="button-start-conferencia"
              >
                <ClipboardCheck className="h-4 w-4 mr-1.5" />
                Conferir
                {selectedWorkUnits.length > 0 && ` (${new Set(
                  workUnits?.filter(wu => selectedWorkUnits.includes(wu.id)).map(wu => wu.orderId)
                ).size})`}
              </Button>
            </div>
          ) : (
            <div className="text-center py-10 text-muted-foreground">
              <ClipboardCheck className="h-12 w-12 mx-auto mb-3 opacity-40" />
              <p className="text-sm font-medium">Nenhum pedido para conferir</p>
              <p className="text-xs">Aguarde a conclusão das separações</p>
            </div>
          )}
        </div>
      )}

      {step === "checking" && (
        <>
          <div className="px-3 pt-2 pb-1 space-y-1.5 border-b border-border bg-card">
            <div className="flex items-center justify-between">
              <span className="text-xs text-muted-foreground">
                {allMyUnits.map(wu => wu.order.erpOrderId).filter((v, i, a) => a.indexOf(v) === i).join(", ")}
              </span>
              <span className="text-xs font-medium">{Math.round(getProgress())}%</span>
            </div>
            <Progress value={getProgress()} className="h-1.5" />
            <ScanInput
              placeholder="Leia o código de barras..."
              onScan={handleScanItem}
              status={scanStatus}
              statusMessage={scanMessage}
              autoFocus
              className="[&_input]:h-10 [&_input]:text-sm"
            />
          </div>

          <div className="flex-1 overflow-auto">
            {checkingTab === "product" && currentProduct && (
              <div className="px-3 py-3 space-y-3">
                <div className="bg-card border border-border rounded-lg p-3 space-y-2.5">
                  <div className="flex items-center gap-1.5 flex-wrap">
                    {currentProduct.orderCodes.map(code => (
                      <span key={code} className="text-[10px] bg-primary/10 text-primary px-1.5 py-0.5 rounded font-mono">{code}</span>
                    ))}
                  </div>

                  <p className="text-sm font-medium leading-tight">{currentProduct.product.name}</p>

                  <div className="grid grid-cols-2 gap-x-3 gap-y-1 text-xs">
                    <div>
                      <span className="text-muted-foreground">Código:</span>
                      <span className="ml-1 font-mono font-medium">{currentProduct.product.erpCode}</span>
                    </div>
                    <div>
                      <span className="text-muted-foreground">Ref:</span>
                      <span className="ml-1 font-mono">{currentProduct.product.referenceCode || "—"}</span>
                    </div>
                    <div>
                      <span className="text-muted-foreground">Cód. Barras:</span>
                      <span className="ml-1 font-mono">{currentProduct.product.barcode || "—"}</span>
                    </div>
                    <div>
                      <span className="text-muted-foreground">Caixa:</span>
                      <span className="ml-1 font-mono">{currentProduct.product.boxBarcode || "Indisponível"}</span>
                    </div>
                  </div>

                  <div className="flex items-center justify-between pt-1 border-t border-border">
                    <div>
                      <span className="text-xs text-muted-foreground">Conferido</span>
                      <p className="text-lg font-bold">
                        {currentProduct.checkedQty}
                        <span className="text-muted-foreground font-normal text-sm">/{currentProduct.totalSeparatedQty}</span>
                        {currentProduct.exceptionQty > 0 && (
                          <span className="text-orange-500 text-xs ml-1">(-{currentProduct.exceptionQty} exc)</span>
                        )}
                      </p>
                    </div>
                    <div className="flex items-center gap-2">
                      {(hasManualQtyPermission || hasMultiplierPermission) && manualQtyAllowed[currentProduct.product.id] && (
                        <>
                          <div className="flex items-center gap-1">
                            <span className="text-xs text-muted-foreground">Qtd:</span>
                            <Input
                              type="number"
                              min={1}
                              max={currentProduct.totalSeparatedQty - currentProduct.checkedQty - currentProduct.exceptionQty}
                              value={multiplierValue}
                              onChange={(e) => setMultiplierValue(Math.max(1, parseInt(e.target.value) || 1))}
                              className="h-10 w-20 text-center text-sm font-bold"
                              disabled={!hasMultiplierPermission}
                            />
                          </div>
                          <Button
                            size="sm"
                            className="h-10 px-3"
                            onClick={() => handleIncrementProduct(currentProduct, multiplierValue)}
                            disabled={
                              scanItemMutation.isPending ||
                              (currentProduct.checkedQty + currentProduct.exceptionQty >= currentProduct.totalSeparatedQty) ||
                              !currentProduct.product.barcode
                            }
                          >
                            <Plus className="h-5 w-5 mr-1" />
                            Conferir
                          </Button>
                        </>
                      )}
                    </div>
                  </div>
                </div>

                <div className="flex gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    className="flex-1 h-9 text-xs"
                    onClick={() => {
                      const firstIncompleteItem = currentProduct.items.find(i =>
                        Number(i.separatedQty) > Number(i.checkedQty) + Number(i.exceptionQty || 0)
                      ) || currentProduct.items[0];
                      setExceptionItem(firstIncompleteItem);
                      setShowExceptionDialog(true);
                    }}
                  >
                    <AlertTriangle className="h-3.5 w-3.5 mr-1" />
                    Exceção
                  </Button>
                  <Button
                    size="sm"
                    className="flex-1 h-9 text-xs"
                    onClick={handleNextProduct}
                  >
                    Próximo
                    <ArrowRight className="h-3.5 w-3.5 ml-1" />
                  </Button>
                </div>

                <div className="flex gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    className="flex-1 h-9 text-xs text-destructive border-destructive/30 hover:bg-destructive/10"
                    onClick={handleCancelChecking}
                    disabled={unlockMutation.isPending}
                    data-testid="button-cancel-checking"
                  >
                    Cancelar
                  </Button>
                  <Button
                    size="sm"
                    className="flex-1 h-9 text-xs bg-green-600 hover:bg-green-700"
                    onClick={handleCompleteAll}
                    disabled={!allItemsComplete || completeWorkUnitMutation.isPending}
                    data-testid="button-complete-checking"
                  >
                    <Check className="h-3.5 w-3.5 mr-1" />
                    Concluir
                  </Button>
                </div>
              </div>
            )}

            {checkingTab === "product" && !currentProduct && aggregatedProducts.length === 0 && (
              <div className="flex items-center justify-center h-40 text-muted-foreground text-sm">
                Nenhum produto para conferir
              </div>
            )}

            {checkingTab === "list" && (
              <div className="px-3 py-3 space-y-2">
                {aggregatedProducts.length === 0 ? (
                  <div className="text-center py-8 text-muted-foreground text-xs">
                    Nenhum produto encontrado
                  </div>
                ) : (
                  <div className="space-y-1">
                    {aggregatedProducts.map((ap, idx) => {
                      const remaining = ap.totalSeparatedQty - ap.checkedQty - ap.exceptionQty;
                      const isComplete = remaining <= 0;
                      const hasException = ap.exceptionQty > 0;

                      return (
                        <div
                          key={ap.product.id}
                          className={`flex items-center gap-2 p-2 rounded-lg border cursor-pointer transition-colors ${
                            isComplete
                              ? hasException
                                ? "bg-amber-50/50 border-amber-200 dark:bg-amber-950/20 dark:border-amber-900/50"
                                : "bg-green-50/50 border-green-200 dark:bg-green-950/20 dark:border-green-900/50"
                              : "border-border hover:bg-muted/50"
                          }`}
                          onClick={() => {
                            setCurrentProductIndex(idx);
                            setCheckingTab("product");
                          }}
                        >
                          <div className={`w-6 h-6 rounded-full flex items-center justify-center shrink-0 ${
                            isComplete
                              ? hasException ? "bg-amber-500 text-white" : "bg-green-500 text-white"
                              : "bg-muted"
                          }`}>
                            {isComplete ? (
                              hasException ? <AlertTriangle className="h-3 w-3" /> : <Check className="h-3 w-3" />
                            ) : (
                              <span className="text-[10px] font-medium">{remaining}</span>
                            )}
                          </div>
                          <div className="flex-1 min-w-0">
                            <p className="text-xs font-medium truncate">{ap.product.name}</p>
                            <div className="flex items-center gap-1.5 text-[10px] text-muted-foreground">
                              <span className="font-mono">{ap.product.erpCode}</span>
                              <span>•</span>
                              <span className="font-mono">{ap.product.barcode || "—"}</span>
                            </div>
                            <div className="flex items-center gap-1 mt-0.5">
                              {ap.orderCodes.map(code => (
                                <span key={code} className="text-[9px] bg-muted px-1 py-0.5 rounded font-mono">{code}</span>
                              ))}
                            </div>
                          </div>
                          <div className="text-right shrink-0">
                            <p className="text-xs font-medium">
                              {ap.checkedQty}/{ap.totalSeparatedQty}
                            </p>
                            {ap.exceptionQty > 0 && (
                              <span className="text-[10px] text-orange-500">-{ap.exceptionQty}</span>
                            )}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}

                <div className="flex gap-2 pt-2">
                  <Button
                    variant="outline"
                    size="sm"
                    className="flex-1 h-9 text-xs text-destructive border-destructive/30 hover:bg-destructive/10"
                    onClick={handleCancelChecking}
                    disabled={unlockMutation.isPending}
                  >
                    Cancelar
                  </Button>
                  <Button
                    size="sm"
                    className="flex-1 h-9 text-xs bg-green-600 hover:bg-green-700"
                    onClick={handleCompleteAll}
                    disabled={!allItemsComplete || completeWorkUnitMutation.isPending}
                  >
                    <Check className="h-3.5 w-3.5 mr-1" />
                    Concluir
                  </Button>
                </div>
              </div>
            )}
          </div>

          <nav className="flex border-t border-border bg-card shrink-0">
            <button
              className={`flex-1 flex flex-col items-center py-2 gap-0.5 transition-colors ${
                checkingTab === "product" ? "text-primary bg-primary/5" : "text-muted-foreground"
              }`}
              onClick={() => setCheckingTab("product")}
            >
              <Package className="h-5 w-5" />
              <span className="text-[10px] font-medium">Produto</span>
            </button>
            <button
              className={`flex-1 flex flex-col items-center py-2 gap-0.5 transition-colors ${
                checkingTab === "list" ? "text-primary bg-primary/5" : "text-muted-foreground"
              }`}
              onClick={() => setCheckingTab("list")}
            >
              <List className="h-5 w-5" />
              <span className="text-[10px] font-medium">Lista</span>
            </button>
          </nav>
        </>
      )}

      <ResultDialog
        open={showResultDialog}
        onOpenChange={setShowResultDialog}
        type={resultDialogConfig.type}
        title={resultDialogConfig.title}
        message={resultDialogConfig.message}
      />

      {exceptionItem && (
        <ExceptionDialog
          open={showExceptionDialog}
          onOpenChange={setShowExceptionDialog}
          productName={exceptionItem.product.name}
          maxQuantity={Math.max(0, Number(exceptionItem.separatedQty) - Number(exceptionItem.checkedQty) - (exceptionItem.exceptionQty || 0))}
          hasExceptions={(exceptionItem.exceptionQty || 0) > 0}
          onSubmit={(data) => {
            const wu = allMyUnits.find(w => w.items.some(i => i.id === exceptionItem.id));
            if (wu) {
              createExceptionMutation.mutate({
                workUnitId: wu.id,
                orderItemId: exceptionItem.id,
                ...data,
              });
            }
          }}
          onClearExceptions={() => {
            clearExceptionsMutation.mutate(exceptionItem.id);
            setShowExceptionDialog(false);
          }}
          isSubmitting={createExceptionMutation.isPending}
          isClearing={clearExceptionsMutation.isPending}
        />
      )}
    </div>
  );
}
