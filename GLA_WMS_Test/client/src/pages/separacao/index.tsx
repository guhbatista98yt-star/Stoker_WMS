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
  Package,
  List,
  LogOut,
  Check,
  AlertTriangle,
  Search,
  Plus,
  ArrowRight,
  Calendar,
} from "lucide-react";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type { WorkUnitWithDetails, OrderItem, Product, ExceptionType, UserSettings, Exception } from "@shared/schema";
import { ExceptionDialog } from "@/components/orders/exception-dialog";
import { ExceptionAuthorizationModal } from "@/components/orders/exception-authorization-modal";
import { getCurrentWeekRange } from "@/lib/date-utils";
import { format } from "date-fns";

type SeparacaoStep = "select" | "scan_cart" | "picking";
type PickingTab = "product" | "list";

const STORAGE_KEY = "wms:separacao-session";

interface SessionData {
  tab: PickingTab;
  productIndex: number;
  workUnitIds: string[];
}

interface ItemWithProduct extends OrderItem {
  product: Product;
  exceptionQty?: number;
  exceptions?: Exception[];
}

interface AggregatedProduct {
  product: Product;
  totalQty: number;
  separatedQty: number;
  exceptionQty: number;
  items: ItemWithProduct[];
  orderCodes: string[];
  sections: string[];
}

function saveSession(data: SessionData) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
  } catch { }
}

function loadSession(): SessionData | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) return JSON.parse(raw);
  } catch { }
  return null;
}

function clearSession() {
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch { }
}

export default function SeparacaoPage() {
  const { user, logout } = useAuth();
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const [step, setStep] = useState<SeparacaoStep>("select");
  const [selectedWorkUnits, setSelectedWorkUnits] = useState<string[]>([]);
  const [pickingTab, setPickingTab] = useState<PickingTab>("product");
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
  const [showAuthModal, setShowAuthModal] = useState(false);
  const [pendingExceptions, setPendingExceptions] = useState<any[]>([]);

  const [filterOrderId, setFilterOrderId] = useState("");
  const [dateRange, setDateRange] = useState<DateRange | undefined>(getCurrentWeekRange());
  const [tempDateRange, setTempDateRange] = useState<DateRange | undefined>(getCurrentWeekRange());
  const [sectionFilter, setSectionFilter] = useState<string>("all");

  const [sessionRestored, setSessionRestored] = useState(false);
  const [multiplierValue, setMultiplierValue] = useState(1);

  const userSettings = (user?.settings as UserSettings) || {};
  const hasManualQtyPermission = !!userSettings.allowManualQty;
  // const hasMultiplierPermission = !!userSettings.allowMultiplier;

  const workUnitsQueryKey = useSessionQueryKey(["/api/work-units", "separacao"]);

  const { data: workUnits, isLoading } = useQuery<WorkUnitWithDetails[]>({
    queryKey: workUnitsQueryKey,
    refetchInterval: 1000,
  });

  const { data: sections } = useQuery<{ id: string; name: string }[]>({
    queryKey: ["/api/sections"],
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
    "picking_update", "lock_acquired", "lock_released", "picking_started",
    "item_picked", "exception_created", "picking_finished",
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
    const allItems: ItemWithProduct[] = units.flatMap(wu => (wu.items as ItemWithProduct[]) || []);
    const userSections = (user?.sections as string[]) || [];
    const filteredItems = allItems.filter(item =>
      userSections.length === 0 || userSections.includes(item.section)
    );

    const map: Record<string, AggregatedProduct> = {};
    filteredItems.forEach(item => {
      const pid = item.productId;
      if (!map[pid]) {
        const wu = units.find(w => w.items.some(i => i.productId === pid));
        map[pid] = {
          product: item.product,
          totalQty: 0,
          separatedQty: 0,
          exceptionQty: 0,
          items: [],
          orderCodes: [],
          sections: [],
        };
      }
      map[pid].totalQty += Number(item.quantity);
      map[pid].separatedQty += Number(item.separatedQty);
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
  }, [allMyUnits, user]);

  const filteredAggregatedProducts = useMemo(() => {
    if (sectionFilter === "all") return aggregatedProducts;
    return aggregatedProducts.filter(ap => ap.sections.includes(sectionFilter));
  }, [aggregatedProducts, sectionFilter]);

  const availableSections = useMemo(() => {
    const secs = new Set<string>();
    aggregatedProducts.forEach(ap => ap.sections.forEach(s => secs.add(s)));
    return Array.from(secs).sort();
  }, [aggregatedProducts]);

  // Buscar regras de quantidade manual para os produtos atuais
  const productIds = useMemo(() => aggregatedProducts.map(ap => ap.product.id), [aggregatedProducts]);
  const { data: manualQtyRulesMap } = useQuery<Record<string, boolean>>({
    queryKey: ["manual-qty-rules", productIds],
    queryFn: async () => {
      if (productIds.length === 0) return {};
      const res = await apiRequest("POST", "/api/manual-qty-rules/check", { productIds });
      return res.json();
    },
    enabled: productIds.length > 0,
  });

  const currentProduct = filteredAggregatedProducts[currentProductIndex] || filteredAggregatedProducts[0] || null;

  // Permissão efetiva: Global do usuário OU Regra específica do produto
  const canUseManualQty = useMemo(() => {
    if (hasManualQtyPermission) return true;
    if (currentProduct && manualQtyRulesMap) {
      return !!manualQtyRulesMap[currentProduct.product.id];
    }
    return false;
  }, [hasManualQtyPermission, currentProduct, manualQtyRulesMap]);

  // Avanço automático quando produto atual é completado
  useEffect(() => {
    if (currentProduct && step === "picking") {
      const isComplete = currentProduct.separatedQty + currentProduct.exceptionQty >= currentProduct.totalQty;

      if (isComplete) {
        console.log(`[DEBUG] Produto ${currentProduct.product.id} completo. Buscando pr\u00f3ximo...`);
        // Tentar encontrar p\u00f3ximo incompleto (circular)
        let nextIdx = filteredAggregatedProducts.findIndex((p, idx) =>
          idx > currentProductIndex && (p.separatedQty + p.exceptionQty < p.totalQty)
        );

        // Se n\u00e3o achou depois, tenta do in\u00edcio
        if (nextIdx === -1) {
          nextIdx = filteredAggregatedProducts.findIndex((p, idx) =>
            idx < currentProductIndex && (p.separatedQty + p.exceptionQty < p.totalQty)
          );
        }

        if (nextIdx >= 0 && nextIdx !== currentProductIndex) {
          console.log(`[DEBUG] Avan\u00e7ando para o \u00edndice ${nextIdx}`);
          setCurrentProductIndex(nextIdx);
        } else {
          console.log(`[DEBUG] Nenhum outro produto incompleto encontrado.`);
        }
      }
    }
  }, [currentProduct?.separatedQty, currentProduct?.exceptionQty, currentProduct?.totalQty, step, filteredAggregatedProducts, currentProductIndex]);

  useEffect(() => {
    if (filteredAggregatedProducts.length > 0 && currentProductIndex >= filteredAggregatedProducts.length) {
      setCurrentProductIndex(0);
    }
  }, [filteredAggregatedProducts.length, currentProductIndex]);

  useEffect(() => {
    if (workUnits && user && !sessionRestored) {
      setSessionRestored(true);
      const saved = loadSession();
      if (saved && saved.workUnitIds.length > 0) {
        const stillLockedIds = saved.workUnitIds.filter(id =>
          workUnits.some(wu => wu.id === id && wu.lockedBy === user.id)
        );
        if (stillLockedIds.length > 0) {
          setStep("picking");
          setPickingTab(saved.tab);
          setCurrentProductIndex(0);
          setSelectedWorkUnits(stillLockedIds);
          toast({ title: "Sessão Restaurada", description: "Retomando separação anterior" });
          return;
        } else {
          clearSession();
        }
      }

      const myUnit = workUnits.find(wu => wu.lockedBy === user.id && wu.status !== "concluido");
      if (myUnit) {
        const myIds = workUnits.filter(wu => wu.lockedBy === user.id).map(wu => wu.id);
        setStep("picking");
        setSelectedWorkUnits(myIds);
        toast({ title: "Sessão Restaurada", description: `Retomando pedido ${myUnit.order.erpOrderId}` });
      }
    }
  }, [workUnits, user, sessionRestored, toast]);

  useEffect(() => {
    if (step === "picking" && allMyUnits.length > 0) {
      saveSession({
        tab: pickingTab,
        productIndex: currentProductIndex,
        workUnitIds: allMyUnits.map(wu => wu.id),
      });
    }
  }, [step, pickingTab, currentProductIndex, allMyUnits]);

  const lockMutation = useMutation({
    mutationFn: async (workUnitIds: string[]) => {
      const res = await apiRequest("POST", "/api/work-units/lock", { workUnitIds });
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: workUnitsQueryKey });
    },
  });

  const batchScanCartMutation = useMutation({
    mutationFn: async ({ workUnitIds, qrCode }: { workUnitIds: string[]; qrCode: string }) => {
      const res = await apiRequest("POST", "/api/work-units/batch/scan-cart", { workUnitIds, qrCode });
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
      setPickingTab("product");
    },
  });

  const scanItemMutation = useMutation({
    mutationFn: async ({ workUnitId, barcode, quantity }: { workUnitId: string; barcode: string; quantity?: number }) => {
      const body = quantity ? { barcode, quantity } : { barcode };
      const res = await apiRequest("POST", `/api/work-units/${workUnitId}/scan-item`, body);
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
      } catch { }
      toast({ title: "Erro", description: message, variant: "destructive" });
    },
  });

  const completeWorkUnitMutation = useMutation({
    mutationFn: async (id: string) => {
      const res = await apiRequest("POST", `/api/work-units/${id}/complete`);
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || "Erro ao concluir unidade");
      }
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: workUnitsQueryKey });
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

  // Helper para busca múltipla por vírgula
  const processMultipleOrderSearch = (searchValue: string, orderCode: string): boolean => {
    if (!searchValue.trim()) return true;
    if (searchValue.includes(',')) {
      const terms = searchValue.split(',').map(t => t.trim().toLowerCase()).filter(t => t);
      return terms.some(term => orderCode.toLowerCase().includes(term));
    }
    return orderCode.toLowerCase().includes(searchValue.toLowerCase());
  };

  const availableWorkUnits = useMemo(() => {
    return workUnits?.filter((wu) => {
      if (wu.status !== "pendente" || (wu.lockedBy && wu.lockedBy !== user?.id)) return false;
      if (!wu.order.isLaunched) return false;

      const userSections = (user?.sections as string[]) || [];
      if (userSections.length > 0) {
        if (wu.section && !userSections.includes(wu.section)) return false;
        const hasRelevantItems = wu.items.some(item => userSections.includes(item.section));
        if (!wu.section && !hasRelevantItems) return false;
      }

      // Busca múltipla por vírgula
      if (filterOrderId && !processMultipleOrderSearch(filterOrderId, wu.order.erpOrderId)) return false;

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
  }, [workUnits, user, filterOrderId, dateRange]);

  const groupedWorkUnits = useMemo(() => {
    const groups: Record<string, typeof availableWorkUnits> = {};
    availableWorkUnits.forEach((wu) => {
      if (!groups[wu.orderId]) groups[wu.orderId] = [];
      groups[wu.orderId].push(wu);
    });
    return Object.values(groups);
  }, [availableWorkUnits]);

  const handleSelectGroup = (wus: typeof availableWorkUnits, checked: boolean) => {
    const ids = wus.map((wu) => wu.id);
    if (checked) {
      setSelectedWorkUnits((prev) => Array.from(new Set([...prev, ...ids])));
    } else {
      setSelectedWorkUnits((prev) => prev.filter((id) => !ids.includes(id)));
    }
  };

  const handleStartSeparation = async () => {
    if (selectedWorkUnits.length === 0) {
      toast({ title: "Atenção", description: "Selecione pelo menos um pedido", variant: "destructive" });
      return;
    }
    try {
      await lockMutation.mutateAsync(selectedWorkUnits);
      setStep("scan_cart");
      setScanStatus("idle");
      setScanMessage("");
    } catch {
      toast({ title: "Erro", description: "Falha ao bloquear unidades de trabalho", variant: "destructive" });
    }
  };

  const handleScanCart = async (qrCode: string) => {
    const units = allMyUnits.length > 0 ? allMyUnits : selectedWorkUnits.map(id => workUnits?.find(wu => wu.id === id)).filter(Boolean) as WorkUnitWithDetails[];
    if (units.length === 0) return;

    try {
      const workUnitIds = units.map(wu => wu.id);
      await batchScanCartMutation.mutateAsync({ workUnitIds, qrCode });
      setScanStatus("success");
      setScanMessage("Cesto/carrinho registrado!");
      setTimeout(() => {
        setStep("picking");
        setPickingTab("product");
        setCurrentProductIndex(0);
        setScanStatus("idle");
        setScanMessage("");
      }, 800);
    } catch {
      setScanStatus("error");
      setScanMessage("Erro ao registrar cesto/carrinho");
    }
  };

  const handleCompleteAll = async () => {
    // Verificar se há exceções não autorizadas
    const allExceptions: Exception[] = [];
    allMyUnits.forEach(wu => {
      wu.items.forEach((item: ItemWithProduct) => {
        if (item.exceptions && item.exceptions.length > 0) {
          item.exceptions.forEach((exc: Exception) => {
            if (!exc.authorizedBy) {
              allExceptions.push({
                ...exc,
                orderItem: {
                  ...item,
                  order: wu.order,
                },
              } as any);
            }
          });
        }
      });
    });

    if (allExceptions.length > 0) {
      const userSettings = user?.settings as UserSettings;
      if (userSettings?.canAuthorizeOwnExceptions) {
        try {
          await apiRequest("POST", "/api/exceptions/auto-authorize", {
            exceptionIds: allExceptions.map(e => e.id),
          });
          toast({ title: "Auto-autorização", description: "Exceções autorizadas automaticamente." });
        } catch (error) {
          toast({ title: "Erro", description: "Falha ao auto-autorizar exceções", variant: "destructive" });
          return;
        }
      } else {
        setPendingExceptions(allExceptions);
        setShowAuthModal(true);
        return;
      }
    }

    // Continuar com finalização normal
    await finalizeWorkUnits();
  };

  const finalizeWorkUnits = async () => {
    try {
      let anyUnlock = false;
      for (const wu of allMyUnits) {
        try {
          await completeWorkUnitMutation.mutateAsync(wu.id);
        } catch (error: any) {
          // Se falhar porque há itens pendentes (outras seções), fazemos apenas unlock
          if (error.message === "Existem itens pendentes" || error.message?.includes("pendentes")) {
            // console.log(`Unidade ${wu.id} tem itens pendentes de outras seções. Liberando bloqueio.`);
            await unlockMutation.mutateAsync({ ids: [wu.id], reset: false });
            anyUnlock = true;
          } else {
            throw error;
          }
        }
      }
      setStep("select");
      setSelectedWorkUnits([]);
      clearSession();
      if (anyUnlock) {
        toast({ title: "Salvo", description: "Sua parte foi concluída. Pedido liberado para outras seções.", variant: "default" });
      } else {
        toast({ title: "Concluído", description: "Separação finalizada com sucesso", variant: "default" });
      }
    } catch (error) {
      console.error("Error completing work units:", error);
      toast({ title: "Erro", description: "Falha ao finalizar separação", variant: "destructive" });
    }
  };

  const handleExceptionAuthorized = async () => {
    await queryClient.invalidateQueries({ queryKey: workUnitsQueryKey });
    await finalizeWorkUnits();
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
      return Number(item.separatedQty) + exceptionQty < Number(item.quantity);
    });

    const finalUnit = targetUnit || unitsWithProduct[0] || units[0];
    if (!finalUnit) return;

    try {
      const result = await scanItemMutation.mutateAsync({ workUnitId: finalUnit.id, barcode });

      if (result.status === "success") {
        setScanStatus("success");
        setScanMessage(`${result.product.name} - ${result.quantity} ${result.product.unit}`);

        const productId = result.product.id;
        const idx = filteredAggregatedProducts.findIndex(ap => ap.product.id === productId);
        if (idx >= 0) {
          setCurrentProductIndex(idx);
        }
        setPickingTab("product");

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
        setResultDialogConfig({ type: "error", title: "Quantidade Excedida", message: "O item foi bipado mais vezes que o necessário." });
        setShowResultDialog(true);
      } else if (result.status === "not_found") {
        setScanStatus("warning");
        setScanMessage("Produto não encontrado neste pedido");
      }
    } catch {
      setScanStatus("error");
      setScanMessage("Erro ao processar leitura");
    }
  }, [allMyUnits, scanItemMutation, filteredAggregatedProducts]);

  const globalScanHandler = useCallback((barcode: string) => {
    if (step === "picking") {
      handleScanItem(barcode);
    } else if (step === "scan_cart") {
      handleScanCart(barcode);
    }
  }, [step, handleScanItem]);

  useBarcodeScanner(globalScanHandler, step === "picking" || step === "scan_cart");

  const handleIncrementProduct = async (ap: AggregatedProduct, qty: number = 1) => {
    const remaining = ap.totalQty - ap.separatedQty - ap.exceptionQty;
    if (remaining <= 0) return;

    // Verificar permissão para multiplicador - REMOVIDO (Unificado com Qtd Manual)
    /*
    if (qty > 1 && !hasMultiplierPermission) {
      toast({
        title: "Permissão Negada",
        description: "Você não tem permissão para usar multiplicador",
        variant: "destructive"
      });
      return;
    }
    */

    // Verificar permissão para quantidade manual
    // Regra: Apenas switch global do usuário OU Regra de Produto
    if (!canUseManualQty) {
      toast({
        title: "Permissão Negada",
        description: "Você não tem permissão para alterar quantidade manual",
        variant: "destructive"
      });
      return;
    }

    // Enviar quantidade digitada ao backend sem limitar
    // O backend aplicará a regra: se exceder, reseta para zero
    const barcode = ap.product.barcode;
    if (!barcode) return;

    try {
      // Encontrar o primeiro item incompleto
      const incompleteItem = ap.items.find(it =>
        Number(it.separatedQty) + Number(it.exceptionQty || 0) < Number(it.quantity)
      );
      if (!incompleteItem) return;

      const wu = allMyUnits.find(w => w.items.some(it => it.id === incompleteItem.id));
      if (!wu) return;

      const result = await scanItemMutation.mutateAsync({
        workUnitId: wu.id,
        barcode,
        quantity: qty
      });

      if (result.status === "success") {
        setScanStatus("success");
        setScanMessage(`+${result.quantity} ${ap.product.name}`);
        setMultiplierValue(1);
        // O avanço automático agora é feito pelo useEffect que observa mudanças no currentProduct
      } else if (result.status === "over_quantity" || result.status === "over_quantity_with_exception") {
        setScanStatus("error");
        setScanMessage(result.message || "Quantidade excedida! Separação resetada.");
      } else {
        setScanStatus("error");
        setScanMessage("Erro ao incrementar");
      }
    } catch {
      setScanStatus("error");
      setScanMessage("Erro ao incrementar");
    }
  };

  const handleCancelPicking = () => {
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
    const nextIdx = filteredAggregatedProducts.findIndex((ap, idx) => {
      if (idx <= currentProductIndex) return false;
      const remaining = ap.totalQty - ap.separatedQty - ap.exceptionQty;
      return remaining > 0;
    });

    if (nextIdx >= 0) {
      setCurrentProductIndex(nextIdx);
    } else {
      const wrapIdx = filteredAggregatedProducts.findIndex((ap) => {
        const remaining = ap.totalQty - ap.separatedQty - ap.exceptionQty;
        return remaining > 0;
      });
      if (wrapIdx >= 0) {
        setCurrentProductIndex(wrapIdx);
      }
    }
  };

  const getProgress = () => {
    if (aggregatedProducts.length === 0) return 0;
    const total = aggregatedProducts.reduce((s, ap) => s + ap.totalQty, 0);
    const done = aggregatedProducts.reduce((s, ap) => s + ap.separatedQty + ap.exceptionQty, 0);
    return total > 0 ? (done / total) * 100 : 0;
  };

  const allItemsComplete = aggregatedProducts.length > 0 && aggregatedProducts.every(ap =>
    ap.separatedQty + ap.exceptionQty >= ap.totalQty
  );

  const handleApplyDateFilter = () => {
    setDateRange(tempDateRange);
  };

  return (
    <div className="min-h-screen bg-background flex flex-col" data-module="separacao">
      <header className="flex items-center justify-between px-3 py-2 border-b border-border bg-card">
        <div className="flex items-center gap-2 min-w-0">
          <Package className="h-4 w-4 text-primary shrink-0" />
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
                placeholder="N° Pedido (separe múltiplos por vírgula)"
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
          </div>

          {isLoading ? (
            <div className="space-y-2">
              {Array.from({ length: 4 }).map((_, i) => (
                <Skeleton key={i} className="h-14 w-full rounded-lg" />
              ))}
            </div>
          ) : groupedWorkUnits.length > 0 ? (
            <div className="space-y-3">
              {/* Lista com scroll */}
              <div className="max-h-[400px] overflow-y-auto border rounded-lg">
                <div className="space-y-1.5 p-2">
                  {groupedWorkUnits.map((group) => {
                    const firstWU = group[0];
                    const groupIds = group.map(g => g.id);
                    const isSelected = groupIds.every(id => selectedWorkUnits.includes(id));

                    const userSections = (user?.sections as string[]) || [];
                    const distinctProductCount = group.reduce((acc, wu) => {
                      const filtered = wu.items?.filter(item =>
                        userSections.length === 0 || userSections.includes(item.section)
                      ) || [];
                      const productIds = new Set(filtered.map(item => item.productId));
                      return new Set([...acc, ...productIds]);
                    }, new Set<string>()).size;

                    let createdAt = "";
                    try {
                      createdAt = format(new Date(firstWU.order.createdAt), "dd/MM HH:mm");
                    } catch { }

                    return (
                      <div
                        key={firstWU.orderId}
                        className={`flex items-center gap-2.5 p-2.5 rounded-lg border transition-colors ${isSelected ? "border-primary bg-primary/5" : "border-border"}`}
                        onClick={() => handleSelectGroup(group, !isSelected)}
                        data-testid={`order-group-${firstWU.orderId}`}
                      >
                        <Checkbox
                          checked={isSelected}
                          onCheckedChange={(checked) => handleSelectGroup(group, !!checked)}
                          className="shrink-0"
                          data-testid={`checkbox-order-${firstWU.orderId}`}
                        />
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-1.5">
                            <span className="font-mono text-sm font-semibold">{firstWU.order.erpOrderId}</span>
                          </div>
                          <p className="text-xs text-muted-foreground truncate">{firstWU.order.customerName}</p>
                        </div>
                        <div className="text-right shrink-0">
                          <p className="text-xs font-medium">{distinctProductCount} produtos</p>
                          <p className="text-[10px] text-muted-foreground">{createdAt}</p>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>

              {/* Botão fixo separado */}
              <Button
                className="w-full h-11 text-sm"
                onClick={handleStartSeparation}
                disabled={selectedWorkUnits.length === 0 || lockMutation.isPending}
                data-testid="button-start-separation"
              >
                <Package className="h-4 w-4 mr-1.5" />
                Separar
                {selectedWorkUnits.length > 0 && ` (${new Set(
                  workUnits?.filter(wu => selectedWorkUnits.includes(wu.id)).map(wu => wu.orderId)
                ).size})`}
              </Button>
            </div>
          ) : (
            <div className="text-center py-10 text-muted-foreground">
              <Package className="h-12 w-12 mx-auto mb-3 opacity-40" />
              <p className="text-sm font-medium">Nenhum pedido disponível</p>
              <p className="text-xs">Aguarde novos pedidos</p>
            </div>
          )}
        </div>
      )}

      {step === "scan_cart" && (
        <div className="flex-1 flex items-center justify-center px-4">
          <div className="w-full max-w-md space-y-6 text-center">
            <div className="space-y-2">
              <div className="w-20 h-20 rounded-full bg-primary/10 flex items-center justify-center mx-auto">
                <Package className="h-10 w-10 text-primary" />
              </div>
              <h2 className="text-lg font-semibold">Leia o Cesto/Carrinho</h2>
              <p className="text-sm text-muted-foreground">
                Escaneie o código do cesto ou carrinho onde os produtos separados serão colocados
              </p>
            </div>
            <ScanInput
              placeholder="Leia o código do cesto/carrinho..."
              onScan={handleScanCart}
              status={scanStatus}
              statusMessage={scanMessage}
              autoFocus
            />
            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                const ids = allMyUnits.map(wu => wu.id);
                if (ids.length > 0) {
                  unlockMutation.mutate({ ids, reset: true });
                } else {
                  setStep("select");
                  setSelectedWorkUnits([]);
                }
              }}
              className="text-xs"
            >
              Cancelar
            </Button>
          </div>
        </div>
      )}

      {step === "picking" && (
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

          <div className="flex-1 flex flex-col min-h-0 overflow-hidden">
            {pickingTab === "product" && currentProduct && (
              <div className="px-3 py-3 space-y-3">
                <div className="bg-card border border-border rounded-lg p-3 space-y-2.5">
                  <div className="flex items-center gap-1.5 flex-wrap">
                    {currentProduct.orderCodes.map(code => (
                      <span key={code} className="text-[10px] bg-primary/10 text-primary px-1.5 py-0.5 rounded font-mono">{code}</span>
                    ))}
                  </div>

                  <p className="text-sm font-medium leading-tight">{currentProduct.product.name}</p>
                  {currentProduct.product.manufacturer && (
                    <p className="text-xs text-muted-foreground mt-0.5">Fabricante: {currentProduct.product.manufacturer}</p>
                  )}

                  <div className="grid grid-cols-2 gap-x-3 gap-y-1 text-xs">
                    <div>
                      <span className="text-muted-foreground">Código:</span>
                      <span className="ml-1 font-mono font-medium">{currentProduct.product.erpCode}</span>
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
                      <span className="text-xs text-muted-foreground">Separado</span>
                      <p className="text-lg font-bold">
                        {currentProduct.separatedQty}
                        <span className="text-muted-foreground font-normal text-sm">/{currentProduct.totalQty}</span>
                        {currentProduct.exceptionQty > 0 && (
                          <span className="text-orange-500 text-xs ml-1">(-{currentProduct.exceptionQty} exc)</span>
                        )}
                      </p>
                    </div>
                    <div className="flex items-center gap-2">
                      {canUseManualQty && (
                        <>
                          <div className="flex items-center gap-1">
                            <span className="text-xs text-muted-foreground">Qtd:</span>
                            <Input
                              type="number"
                              min={1}
                              max={currentProduct.totalQty - currentProduct.separatedQty - currentProduct.exceptionQty}
                              value={multiplierValue}
                              onChange={(e) => {
                                const newVal = Math.max(1, parseInt(e.target.value) || 1);
                                setMultiplierValue(newVal);
                              }}
                              className="h-10 w-20 text-center text-sm font-bold"
                            // disabled={!hasMultiplierPermission} // Merged logic: always enabled if blocking condition is met (block is rendered)
                            />
                          </div>
                          <Button
                            size="sm"
                            className="h-10 px-3"
                            onClick={() => handleIncrementProduct(currentProduct, multiplierValue)}
                            disabled={
                              scanItemMutation.isPending ||
                              (currentProduct.separatedQty + currentProduct.exceptionQty >= currentProduct.totalQty) ||
                              !currentProduct.product.barcode
                            }
                          >
                            <Plus className="h-5 w-5 mr-1" />
                            Separar
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
                        Number(i.quantity) > Number(i.separatedQty) + Number(i.exceptionQty || 0)
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
                    onClick={handleCancelPicking}
                    disabled={unlockMutation.isPending}
                    data-testid="button-cancel-picking"
                  >
                    Cancelar
                  </Button>
                  <Button
                    size="sm"
                    className="flex-1 h-9 text-xs bg-green-600 hover:bg-green-700"
                    onClick={handleCompleteAll}
                    disabled={!allItemsComplete || completeWorkUnitMutation.isPending}
                    data-testid="button-complete-picking"
                  >
                    <Check className="h-3.5 w-3.5 mr-1" />
                    Concluir
                  </Button>
                </div>
              </div>
            )}

            {pickingTab === "product" && !currentProduct && filteredAggregatedProducts.length === 0 && (
              <div className="flex-1 flex items-center justify-center p-4 text-muted-foreground text-sm">
                Nenhum produto para separar
              </div>
            )}

            {pickingTab === "list" && (
              <div className="flex flex-col h-full min-h-0">
                <div className="flex-1 overflow-y-auto px-3 py-3 space-y-2">
                  {availableSections.length > 1 && (
                    <Select value={sectionFilter} onValueChange={setSectionFilter}>
                      <SelectTrigger className="h-8 text-xs">
                        <SelectValue placeholder="Todas as se\u00e7\u00f5es" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="all">Todas as se\u00e7\u00f5es</SelectItem>
                        {availableSections.map(sid => {
                          const secName = sections?.find(s => String(s.id) === sid)?.name;
                          return (
                            <SelectItem key={sid} value={sid}>
                              {secName ? `${sid} - ${secName}` : sid}
                            </SelectItem>
                          );
                        })}
                      </SelectContent>
                    </Select>
                  )}

                  {filteredAggregatedProducts.length === 0 ? (
                    <div className="text-center py-8 text-muted-foreground text-xs">
                      Nenhum produto encontrado
                    </div>
                  ) : (
                    <div className="space-y-1">
                      {filteredAggregatedProducts.map((ap, idx) => {
                        const remaining = ap.totalQty - ap.separatedQty - ap.exceptionQty;
                        const isComplete = remaining <= 0;
                        const hasException = ap.exceptionQty > 0;

                        return (
                          <div
                            key={ap.product.id}
                            className={`flex items-center gap-2 p-2 rounded-lg border cursor-pointer transition-colors ${isComplete
                              ? hasException
                                ? "bg-amber-50/50 border-amber-200 dark:bg-amber-950/20 dark:border-amber-900/50"
                                : "bg-green-50/50 border-green-200 dark:bg-green-950/20 dark:border-green-900/50"
                              : "border-border hover:bg-muted/50"
                              }`}
                            onClick={() => {
                              setCurrentProductIndex(idx);
                              setPickingTab("product");
                            }}
                          >
                            <div className={`w-6 h-6 rounded-full flex items-center justify-center shrink-0 ${isComplete
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
                              {ap.product.manufacturer && (
                                <p className="text-[10px] text-muted-foreground truncate">Fabricante: {ap.product.manufacturer}</p>
                              )}
                              <div className="flex items-center gap-1.5 text-[10px] text-muted-foreground">
                                <span className="font-mono">{ap.product.erpCode}</span>
                                <span>\u2022</span>
                                <span className="font-mono">{ap.product.barcode || "\u2014"}</span>
                              </div>
                              <div className="flex items-center gap-1 mt-0.5">
                                {ap.orderCodes.map(code => (
                                  <span key={code} className="text-[9px] bg-muted px-1 py-0.5 rounded font-mono">{code}</span>
                                ))}
                              </div>
                            </div>
                            <div className="text-right shrink-0">
                              <p className="text-xs font-medium">
                                {ap.separatedQty}/{ap.totalQty}
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
                </div>

                <div className="p-3 border-t bg-background mt-auto">
                  <div className="flex gap-2">
                    <Button
                      variant="outline"
                      size="sm"
                      className="flex-1 h-9 text-xs text-destructive border-destructive/30 hover:bg-destructive/10"
                      onClick={handleCancelPicking}
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
              </div>
            )}
          </div>

          <nav className="flex border-t border-border bg-card shrink-0">
            <button
              className={`flex-1 flex flex-col items-center py-2 gap-0.5 transition-colors ${pickingTab === "product" ? "text-primary bg-primary/5" : "text-muted-foreground"
                }`}
              onClick={() => setPickingTab("product")}
            >
              <Package className="h-5 w-5" />
              <span className="text-[10px] font-medium">Produto</span>
            </button>
            <button
              className={`flex-1 flex flex-col items-center py-2 gap-0.5 transition-colors ${pickingTab === "list" ? "text-primary bg-primary/5" : "text-muted-foreground"
                }`}
              onClick={() => setPickingTab("list")}
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
          maxQuantity={Math.max(0, Number(exceptionItem.quantity) - Number(exceptionItem.separatedQty) - (exceptionItem.exceptionQty || 0))}
          hasExceptions={(exceptionItem.exceptionQty || 0) > 0}
          onSubmit={(data) => {
            const wu = allMyUnits.find(w => w.items.some(i => i.id === exceptionItem.id));
            if (wu) {
              createExceptionMutation.mutate({
                workUnitId: wu.id,
                orderItemId: exceptionItem.id,
                type: data.type,
                quantity: data.quantity,
                observation: data.observation,
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

      <ExceptionAuthorizationModal
        open={showAuthModal}
        onClose={() => setShowAuthModal(false)}
        exceptions={pendingExceptions}
        onAuthorized={handleExceptionAuthorized}
      />
    </div>
  );
}
