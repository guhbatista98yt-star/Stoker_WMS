import { useState, useEffect, useMemo } from "react";
import { useBarcodeScanner } from "@/hooks/use-barcode-scanner";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useAuth, useSessionQueryKey } from "@/lib/auth";
import { DatePickerWithRange } from "@/components/ui/date-range-picker";
import { DateRange } from "react-day-picker";
import { GradientHeader } from "@/components/ui/gradient-header";
import { SectionCard } from "@/components/ui/section-card";
import { StatusBadge } from "@/components/ui/status-badge";
import { ScanInput } from "@/components/ui/scan-input";
import { ResultDialog } from "@/components/ui/result-dialog";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Checkbox } from "@/components/ui/checkbox";
import { Progress } from "@/components/ui/progress";
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";
import {
  Package,
  LogOut,
  ShoppingCart,
  Check,
  AlertTriangle,
  ChevronRight,
  Search,
  Filter,
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
import type { WorkUnitWithDetails, OrderItem, Product, ExceptionType } from "@shared/schema";
import { ExceptionDialog } from "@/components/orders/exception-dialog";
import { getCurrentWeekRange } from "@/lib/date-utils";

type SeparacaoStep = "select" | "scan_cart" | "picking" | "complete";

interface ItemWithProduct extends OrderItem {
  product: Product;
  exceptionQty?: number;
}

export default function SeparacaoPage() {
  const { user, logout } = useAuth();
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const [step, setStep] = useState<SeparacaoStep>("select");
  const [selectedWorkUnits, setSelectedWorkUnits] = useState<string[]>([]);
  const [activeWorkUnitId, setActiveWorkUnitId] = useState<string | null>(null);


  const [scanStatus, setScanStatus] = useState<"idle" | "success" | "error" | "warning">("idle");
  const [scanMessage, setScanMessage] = useState("");
  const [lastScannedItemId, setLastScannedItemId] = useState<string | null>(null);
  const [showResultDialog, setShowResultDialog] = useState(false);
  const [resultDialogConfig, setResultDialogConfig] = useState({
    type: "success" as "success" | "error" | "warning",
    title: "",
    message: "",
  });
  const [cartInputValue, setCartInputValue] = useState("");

  // Exception dialog state
  const [showExceptionDialog, setShowExceptionDialog] = useState(false);
  const [exceptionItem, setExceptionItem] = useState<ItemWithProduct | null>(null);

  // Filters
  const [filterOrderId, setFilterOrderId] = useState("");
  const [dateRange, setDateRange] = useState<DateRange | undefined>(getCurrentWeekRange());
  const [filterPriority, setFilterPriority] = useState<string>("all");

  const workUnitsQueryKey = useSessionQueryKey(["/api/work-units", "separacao"]);

  const { data: workUnits, isLoading } = useQuery<WorkUnitWithDetails[]>({
    queryKey: workUnitsQueryKey,
    refetchInterval: 1000,
  });

  const activeWorkUnit = useMemo(() => {
    if (!activeWorkUnitId || !workUnits) return null;
    return workUnits.find(wu => wu.id === activeWorkUnitId) || null;
  }, [activeWorkUnitId, workUnits]);

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
      setSelectedWorkUnits([]);
      setStep("select");
      setActiveWorkUnitId(null);
    },
  });

  const scanCartMutation = useMutation({
    mutationFn: async ({ workUnitId, qrCode }: { workUnitId: string; qrCode: string }) => {
      const res = await apiRequest("POST", `/api/work-units/${workUnitId}/scan-cart`, { qrCode });
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
    }
  });

  const scanItemMutation = useMutation({
    mutationFn: async ({ workUnitId, barcode }: { workUnitId: string; barcode: string }) => {
      const res = await apiRequest("POST", `/api/work-units/${workUnitId}/scan-item`, { barcode });
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
    }
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
      toast({
        title: "Exceção Registrada",
        description: "A exceção foi reportada com sucesso",
      });
      setShowExceptionDialog(false);
      setExceptionItem(null);
    },
    onError: (error: Error) => {
      let message = "Falha ao registrar exceção";
      try {
        const errorData = JSON.parse(error.message);
        if (errorData.error) message = errorData.error;
      } catch {
        // use default
      }

      toast({
        title: "Erro",
        description: message,
        variant: "destructive",
      });
    },
  });

  const completeWorkUnitMutation = useMutation({
    mutationFn: async (id: string) => {
      const res = await apiRequest("POST", `/api/work-units/${id}/complete`);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: workUnitsQueryKey });
      setStep("complete");
      toast({
        title: "Sucesso", // No description needed
      });
    },
    onError: () => {
      toast({
        title: "Erro",
        description: "Itens pendentes.",
        variant: "destructive",
      });
    },
  });

  const clearExceptionsMutation = useMutation({
    mutationFn: async (orderItemId: string) => {
      const res = await apiRequest("DELETE", `/api/exceptions/item/${orderItemId}`);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: workUnitsQueryKey });
      toast({
        title: "Exceções Limpas",
        description: "As exceções foram removidas com sucesso",
      });
    },
    onError: () => {
      toast({
        title: "Erro",
        description: "Falha ao limpar exceções",
        variant: "destructive",
      });
    },
  });

  // Auto-resume session
  useEffect(() => {
    if (workUnits && user && step === "select" && !activeWorkUnit) {
      const myUnit = workUnits.find(
        (wu) => wu.lockedBy === user.id && wu.status !== "concluido"
      );
      if (myUnit) {
        // Resume session - either to scan_cart or picking depending on progress
        setActiveWorkUnitId(myUnit.id);
        setStep(myUnit.cartQrCode ? "picking" : "scan_cart");
        toast({
          title: "Sessão Restaurada",
          description: `Retomando pedido ${myUnit.order.erpOrderId}`,
        });
      }
    }
  }, [workUnits, user, step, activeWorkUnit, toast]);

  const availableWorkUnits = workUnits?.filter((wu) => {
    // Must be pending and not locked by someone else (lockedBy null is ok, lockedBy me is handled by auto-resume but verified here just in case)
    if (wu.status !== "pendente" || (wu.lockedBy && wu.lockedBy !== user?.id)) {
      return false;
    }


    // Only show launched orders
    if (!wu.order.isLaunched) {
      return false;
    }

    // Filter by User Sections (if defined)
    const userSections = (user?.sections as string[]) || [];
    if (userSections.length > 0) {
      // Check if WU has a specific section that matches
      if (wu.section && !userSections.includes(wu.section)) {
        return false;
      }

      // Also check if there are valid items for this user in the WU
      const hasRelevantItems = wu.items.some(item => userSections.includes(item.section));
      if (!wu.section && !hasRelevantItems) {
        return false;
      }
    }


    // Filters
    if (filterOrderId && !wu.order.erpOrderId.toLowerCase().includes(filterOrderId.toLowerCase())) {
      return false;
    }

    if (dateRange?.from) {
      const orderDate = new Date(wu.order.createdAt).toISOString().split("T")[0];
      const fromDate = dateRange.from.toISOString().split("T")[0];
      if (orderDate < fromDate) return false;
    }

    if (dateRange?.to) {
      const orderDate = new Date(wu.order.createdAt).toISOString().split("T")[0];
      const toDate = dateRange.to.toISOString().split("T")[0];
      if (orderDate > toDate) return false;
    }

    if (filterPriority !== "all") {
      // Assuming priority is numeric on order, high=1, medium=2, etc. Or just match value if string key
      // Let's assume order.priority maps: 1=High, 2=Medium, 3=Low for this UI
      // Adjust logic based on actual schema priority type.
      // Schema says priority is integer. Let's assume specific values or just generic equality if mapped.
      // For now, let's just filter by exact match or ranges if we knew them.
      // If we don't have clear priority mapping, maybe just skip or use simple equality.
      // Let's check schema. Priority is number.
      if (String(wu.order.priority) !== filterPriority) return false;
    }

    return true;
  }) || [];

  const groupedWorkUnits = useMemo(() => {
    const groups: Record<string, typeof availableWorkUnits> = {};
    availableWorkUnits.forEach((wu) => {
      if (!groups[wu.orderId]) {
        groups[wu.orderId] = [];
      }
      groups[wu.orderId].push(wu);
    });
    return Object.values(groups);
  }, [availableWorkUnits]);

  const handleSelectGroup = (wus: typeof availableWorkUnits, checked: boolean) => {
    const ids = wus.map((wu) => wu.id);
    if (checked) {
      // Add all IDs from group, avoiding duplicates
      setSelectedWorkUnits((prev) => {
        const newSet = new Set([...prev, ...ids]);
        return Array.from(newSet);
      });
    } else {
      // Remove all IDs from group
      setSelectedWorkUnits((prev) => prev.filter((id) => !ids.includes(id)));
    }
  };

  const handleSelectWorkUnit = (workUnitId: string, checked: boolean) => {
    if (checked) {
      setSelectedWorkUnits((prev) => [...prev, workUnitId]);
    } else {
      setSelectedWorkUnits((prev) => prev.filter((id) => id !== workUnitId));
    }
  };

  const handleStartSeparation = async () => {
    if (selectedWorkUnits.length === 0) {
      toast({
        title: "Atenção",
        description: "Selecione pelo menos uma unidade de trabalho",
        variant: "destructive",
      });
      return;
    }

    try {
      await lockMutation.mutateAsync(selectedWorkUnits);
      setStep("scan_cart");
    } catch {
      toast({
        title: "Erro",
        description: "Falha ao bloquear unidades de trabalho",
        variant: "destructive",
      });
    }
  };

  const handleScanCart = async (qrCode: string) => {
    if (!selectedWorkUnits.length) return;

    try {
      const result = await scanCartMutation.mutateAsync({
        workUnitId: selectedWorkUnits[0],
        qrCode,
      });
      setScanStatus("success");
      setScanMessage("Carrinho validado!");
      setActiveWorkUnitId(result.workUnit.id);
      setTimeout(() => {
        setStep("picking");
        setScanStatus("idle");
        setScanMessage("");
      }, 1000);
    } catch {
      setScanStatus("error");
      setScanMessage("QR Code inválido ou já em uso");
    }
  };

  const handleScanItem = async (barcode: string) => {
    // Find the correct work unit for this product (supporting multi-order picking)
    const myWorkUnits = workUnits?.filter(wu =>
      wu.lockedBy === user?.id
    ) || [];

    // Find units containing this product
    const unitsWithProduct = myWorkUnits.filter(wu =>
      (wu.items as ItemWithProduct[]).some(item => item.product?.barcode === barcode)
    );

    // Prioritize unit where the item is not yet complete
    let targetUnit = unitsWithProduct.find(wu => {
      const item = (wu.items as ItemWithProduct[]).find(i => i.product?.barcode === barcode);
      if (!item) return false;
      const exceptionQty = Number(item.exceptionQty || 0);
      return Number(item.separatedQty) + exceptionQty < Number(item.quantity);
    });

    // If all complete or not found, fallback to first unit with product (will trigger over-quantity) or active unit
    const finalUnit = targetUnit || unitsWithProduct[0] || activeWorkUnit;

    console.log("[Scan Debug]", { barcode, unitsWithProduct: unitsWithProduct.length, finalUnitId: finalUnit?.id });

    if (!finalUnit) return;

    try {
      const result = await scanItemMutation.mutateAsync({
        workUnitId: finalUnit.id,
        barcode,
      });

      if (result.status === "success") {
        setScanStatus("success");
        setScanMessage(`${result.product.name} - ${result.quantity} ${result.product.unit}`);
        setActiveWorkUnitId(result.workUnit.id);

        // Highlight and scroll to item
        // We need to find the item ID in the *updated* unit or current unit
        const currentItem = result.workUnit.items.find((i: any) => i.product.id === result.product.id);
        if (currentItem) {
          setLastScannedItemId(currentItem.id);
          setTimeout(() => {
            const el = document.getElementById(`item-${currentItem.id}`);
            if (el) el.scrollIntoView({ behavior: "smooth", block: "center" });
          }, 100);
        }

        const myWorkUnits = workUnits?.filter(wu =>
          wu.lockedBy === user?.id
        ) || [];

        // Create a merged list with the latest update
        const updatedUnits = myWorkUnits.map(wu =>
          wu.id === result.workUnit.id ? result.workUnit : wu
        );

        // Check if all units are fully separated (status 'separado' or 'concluido')
        // OR check if progress is 100% by calculating logic manually if status isn't reliable yet
        // Check if all units are fully separated (status 'concluido' implies all items are done)
        const allCompleted = updatedUnits.every(wu => wu.status === "concluido");

        if (allCompleted) {
          setScanStatus("success");
          setScanMessage("Todos os itens foram separados! Clique em 'Concluir Separação' para finalizar.");
        }
      } else if (result.status === "over_quantity_with_exception") {
        setScanStatus("error");
        setScanMessage(result.message || "Quantidade excedida considerando exceções");
        if (result.workUnit) {
          setActiveWorkUnitId(result.workUnit.id);
          queryClient.setQueryData(workUnitsQueryKey, (oldData: any[]) => {
            if (!oldData) return oldData;
            return oldData.map(wu => wu.id === result.workUnit.id ? result.workUnit : wu);
          });
        }

        setResultDialogConfig({
          type: "warning",
          title: "Exceções Registradas",
          message: result.message || `Este item tem exceções registradas. A separação foi resetada.`,
        });
        setShowResultDialog(true);
      } else if (result.status === "over_quantity") {
        setScanStatus("error");
        setScanMessage("Quantidade excedida! Recontagem necessária.");
        if (result.workUnit) {
          setActiveWorkUnitId(result.workUnit.id);
          queryClient.setQueryData(workUnitsQueryKey, (oldData: any[]) => {
            if (!oldData) return oldData;
            return oldData.map(wu => wu.id === result.workUnit.id ? result.workUnit : wu);
          });
        }

        setResultDialogConfig({
          type: "error",
          title: "Quantidade Excedida",
          message: "O item foi bipado mais vezes que o necessário. Entre em modo recontagem.",
        });
        setShowResultDialog(true);
      } else if (result.status === "not_found") {
        setScanStatus("warning");
        setScanMessage("Produto não encontrado neste pedido");
      }
    } catch {
      setScanStatus("error");
      setScanMessage("Erro ao processar leitura");
    }
  };

  const getProgress = () => {
    // Get all work units locked by this user
    const myWorkUnits = workUnits?.filter(wu =>
      wu.lockedBy === user?.id && wu.status !== "concluido"
    ) || [];

    if (myWorkUnits.length === 0) return 0;

    // Combine all items from all locked work units
    const allItems: ItemWithProduct[] = myWorkUnits.flatMap(wu =>
      (wu.items as ItemWithProduct[]) || []
    );

    // Filter by user's sections
    const userSections = (user?.sections as string[]) || [];
    const filteredItems = allItems.filter(item =>
      userSections.length === 0 || userSections.includes(item.section)
    );

    const total = filteredItems.reduce(
      (sum, item) => sum + Number(item.quantity),
      0
    );
    const separated = filteredItems.reduce(
      (sum, item) => sum + Number(item.separatedQty) + Number(item.exceptionQty || 0),
      0
    );
    return total > 0 ? (separated / total) * 100 : 0;
  };

  const handleReset = () => {
    setStep("select");
    setSelectedWorkUnits([]);
    setActiveWorkUnitId(null);
    setScanStatus("idle");
    setScanMessage("");
    queryClient.invalidateQueries({ queryKey: workUnitsQueryKey });
  };

  return (
    <div className="min-h-screen bg-background">
      <GradientHeader
        title="Separação"
        subtitle={user?.name}
      >
        <Button
          variant="outline"
          size="sm"
          onClick={logout}
          className="bg-white/10 border-white/20 text-white hover:bg-white/20"
          data-testid="button-logout"
        >
          <LogOut className="h-4 w-4 mr-2" />
          Sair
        </Button>
      </GradientHeader>

      <main className="max-w-2xl mx-auto px-4 py-6 space-y-4">
        {/* Step Progress */}
        <div className="flex items-center justify-between text-sm mb-6">
          <div className={`flex items-center gap-2 ${step === "select" ? "text-primary font-medium" : "text-muted-foreground"}`}>
            <span className="w-6 h-6 rounded-full bg-primary text-white flex items-center justify-center text-xs">1</span>
            Selecionar
          </div>
          <ChevronRight className="h-4 w-4 text-muted-foreground" />
          <div className={`flex items-center gap-2 ${step === "scan_cart" ? "text-primary font-medium" : "text-muted-foreground"}`}>
            <span className={`w-6 h-6 rounded-full flex items-center justify-center text-xs ${step === "scan_cart" || step === "picking" || step === "complete" ? "bg-primary text-white" : "bg-muted text-muted-foreground"}`}>2</span>
            Carrinho
          </div>
          <ChevronRight className="h-4 w-4 text-muted-foreground" />
          <div className={`flex items-center gap-2 ${step === "picking" ? "text-primary font-medium" : "text-muted-foreground"}`}>
            <span className={`w-6 h-6 rounded-full flex items-center justify-center text-xs ${step === "picking" || step === "complete" ? "bg-primary text-white" : "bg-muted text-muted-foreground"}`}>3</span>
            Separar
          </div>
          <ChevronRight className="h-4 w-4 text-muted-foreground" />
          <div className={`flex items-center gap-2 ${step === "complete" ? "text-primary font-medium" : "text-muted-foreground"}`}>
            <span className={`w-6 h-6 rounded-full flex items-center justify-center text-xs ${step === "complete" ? "bg-primary text-white" : "bg-muted text-muted-foreground"}`}>
              {step === "complete" ? <Check className="h-3 w-3" /> : "4"}
            </span>
            Concluir
          </div>
        </div>

        {/* Step: Select Work Units */}
        {step === "select" && (
          <SectionCard title="Unidades de Trabalho Disponíveis" icon={<Package className="h-4 w-4 text-primary" />}>

            {/* Filters */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6 p-4 bg-muted/30 rounded-lg">
              <div className="space-y-2">
                <label className="text-sm font-medium flex items-center gap-2">
                  <Search className="h-4 w-4" />
                  Pedido
                </label>
                <Input
                  placeholder="Buscar N° Pedido..."
                  value={filterOrderId}
                  onChange={(e) => setFilterOrderId(e.target.value)}
                />
              </div>

              <div className="space-y-2">
                <label className="text-sm font-medium flex items-center gap-2">
                  <Calendar className="h-4 w-4" />
                  Período
                </label>
                <DatePickerWithRange
                  date={dateRange}
                  onDateChange={setDateRange}
                  className="w-full"
                />
              </div>

              <div className="space-y-2">
                <label className="text-sm font-medium flex items-center gap-2">
                  <Filter className="h-4 w-4" />
                  Prioridade
                </label>
                <Select value={filterPriority} onValueChange={setFilterPriority}>
                  <SelectTrigger className="w-full">
                    <SelectValue placeholder="Todas" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">Todas</SelectItem>
                    <SelectItem value="1">Alta (1)</SelectItem>
                    <SelectItem value="2">Média (2)</SelectItem>
                    <SelectItem value="3">Baixa (3)</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>

            {isLoading ? (
              <div className="space-y-3">
                {Array.from({ length: 3 }).map((_, i) => (
                  <Skeleton key={i} className="h-16 w-full rounded-lg" />
                ))}
              </div>
            ) : availableWorkUnits.length > 0 ? (
              <div className="space-y-3">
                {groupedWorkUnits.map((group) => {
                  const firstWU = group[0];
                  const groupIds = group.map(g => g.id);
                  const isSelected = groupIds.every(id => selectedWorkUnits.includes(id));

                  // Calculate total filtered items for this group
                  const totalItems = group.reduce((acc, wu) => {
                    const filteredItems = wu.items?.filter(item => {
                      const userSections = (user?.sections as string[]) || [];
                      return userSections.length === 0 || userSections.includes(item.section);
                    }) || [];
                    return acc + filteredItems.length;
                  }, 0);

                  // Unique points
                  const points = Array.from(new Set(group.map(wu => wu.pickupPoint))).sort((a, b) => a - b).join(", ");
                  // Unique sections
                  const sections = Array.from(new Set(group.map(wu => wu.section).filter(Boolean))).join(", ");

                  return (
                    <div
                      key={firstWU.orderId}
                      className="flex items-center gap-4 p-4 rounded-xl border border-border hover:border-primary/30 transition-colors"
                      data-testid={`order-group-${firstWU.orderId}`}
                    >
                      <Checkbox
                        checked={isSelected}
                        onCheckedChange={(checked) => handleSelectGroup(group, !!checked)}
                        data-testid={`checkbox-order-${firstWU.orderId}`}
                      />
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="font-mono font-semibold">{firstWU.order.erpOrderId}</span>
                          <StatusBadge status={firstWU.status} />
                        </div>
                        <p className="text-sm text-muted-foreground truncate">
                          {firstWU.order.customerName}
                          {points && ` • Pontos: ${points}`}
                          {sections && ` • ${sections}`}
                        </p>
                      </div>
                      <div className="text-right">
                        <p className="text-sm font-medium">
                          {totalItems} itens
                        </p>
                      </div>
                    </div>
                  );
                })}

                <Button
                  className="w-full h-14 text-lg mt-4"
                  onClick={handleStartSeparation}
                  disabled={selectedWorkUnits.length === 0 || lockMutation.isPending}
                  data-testid="button-start-separation"
                >
                  <ShoppingCart className="h-5 w-5 mr-2" />
                  Separar {selectedWorkUnits.length > 0 && `(${(() => {
                    // Count unique orders instead of work units
                    const uniqueOrders = new Set(
                      workUnits
                        ?.filter(wu => selectedWorkUnits.includes(wu.id))
                        .map(wu => wu.orderId)
                    );
                    return uniqueOrders.size;
                  })()})`}
                </Button>
              </div>
            ) : (
              <div className="text-center py-12 text-muted-foreground">
                <Package className="h-16 w-16 mx-auto mb-4 opacity-40" />
                <p className="text-lg font-medium">Nenhuma unidade disponível</p>
                <p className="text-sm">Aguarde novos pedidos ou verifique com o supervisor</p>
              </div>
            )}
          </SectionCard>
        )}

        {/* Step: Scan Cart */}
        {step === "scan_cart" && (
          <SectionCard title="Validar Carrinho" icon={<ShoppingCart className="h-4 w-4 text-primary" />}>
            <div className="text-center py-4">
              <ShoppingCart className="h-16 w-16 mx-auto mb-4 text-primary opacity-60" />
              <p className="text-lg font-medium mb-2">Leia o QR Code do Carrinho</p>
              <p className="text-sm text-muted-foreground mb-6">
                Escaneie o código QR do carrinho para iniciar a separação
              </p>
              <ScanInput
                placeholder="Aguardando leitura do QR Code..."
                onScan={handleScanCart}
                status={scanStatus}
                statusMessage={scanMessage}
                value={cartInputValue}
                onChange={setCartInputValue}
              />
              <div className="flex gap-4 mt-6">
                <Button
                  variant="outline"
                  className="flex-1"
                  onClick={() => {
                    if (selectedWorkUnits.length > 0) {
                      unlockMutation.mutate({ ids: selectedWorkUnits, reset: true });
                      setCartInputValue("");
                    } else {
                      setStep("select");
                      setSelectedWorkUnits([]);
                      setCartInputValue("");
                    }
                  }}
                  disabled={unlockMutation.isPending}
                >
                  Cancelar
                </Button>
                <Button
                  className="flex-1"
                  onClick={() => handleScanCart(cartInputValue)}
                  disabled={!cartInputValue.trim() || scanStatus === "success"}
                >
                  Avançar
                </Button>
              </div>
            </div>
          </SectionCard>
        )}

        {/* Step: Picking */}
        {step === "picking" && activeWorkUnit && (
          <>
            <SectionCard
              title={(() => {
                const myWorkUnits = workUnits?.filter(wu =>
                  wu.lockedBy === user?.id && wu.status !== "concluido"
                ) || [];
                const orderIds = Array.from(new Set(myWorkUnits.map(wu => wu.order.erpOrderId))).join(", ");
                return `Separando Pedido(s): ${orderIds}`;
              })()}
              icon={<Package className="h-4 w-4 text-primary" />}
            >
              <div className="mb-4">
                <div className="flex justify-between text-sm mb-2">
                  <span>Progresso</span>
                  <span className="font-medium">{Math.round(getProgress())}%</span>
                </div>
                <Progress value={getProgress()} className="h-2" />
              </div>

              <ScanInput
                placeholder="Leia o código de barras do produto..."
                onScan={handleScanItem}
                status={scanStatus}
                statusMessage={scanMessage}
                autoFocus
              />
            </SectionCard>

            <SectionCard title="Itens a Separar" icon={<Package className="h-4 w-4 text-primary" />}>
              <div className="mb-2 flex justify-end">
                <span className="text-[10px] font-semibold bg-primary/10 text-primary px-2 py-1 rounded-full border border-primary/20">
                  Modo Agrupado por Produto
                </span>
              </div>
              <div className="space-y-3">
                {(() => {
                  // Get all work units locked by this user
                  const myWorkUnits = workUnits?.filter(wu =>
                    wu.lockedBy === user?.id
                  ) || [];

                  // Combine all items from all locked work units
                  const allItems: ItemWithProduct[] = myWorkUnits.flatMap(wu =>
                    (wu.items as ItemWithProduct[]) || []
                  );

                  // Filter by user's sections
                  const userSections = (user?.sections as string[]) || [];
                  const filteredItems = allItems.filter(item =>
                    userSections.length === 0 || userSections.includes(item.section)
                  );

                  // Aggregate items by product
                  const aggregatedItems = filteredItems.reduce((acc, item) => {
                    const productId = item.productId;
                    if (!acc[productId]) {
                      acc[productId] = {
                        product: item.product,
                        totalQty: 0,
                        separatedQty: 0,
                        exceptionQty: 0,
                        items: []
                      };
                    }
                    acc[productId].totalQty += Number(item.quantity);
                    acc[productId].separatedQty += Number(item.separatedQty);
                    acc[productId].exceptionQty += Number(item.exceptionQty || 0);
                    acc[productId].items.push(item);
                    return acc;
                  }, {} as Record<string, {
                    product: Product;
                    totalQty: number;
                    separatedQty: number;
                    exceptionQty: number;
                    items: ItemWithProduct[];
                  }>);

                  return Object.values(aggregatedItems).map((group) => {
                    const remaining = group.totalQty - group.separatedQty - group.exceptionQty;
                    const isComplete = remaining <= 0;
                    const hasException = group.exceptionQty > 0;
                    const productId = group.product.id;

                    // Find first incomplete item for exception handling shortcut
                    const firstIncompleteItem = group.items.find(i =>
                      Number(i.quantity) > Number(i.separatedQty) + Number(i.exceptionQty || 0)
                    ) || group.items[0];

                    return (
                      <div
                        key={productId}
                        className={`flex items-center gap-3 p-3 rounded-lg border transition-all duration-500 ${group.items.some(i => lastScannedItemId === i.id)
                          ? "ring-2 ring-primary scale-[1.02] bg-primary/5 shadow-lg z-10"
                          : isComplete
                            ? hasException
                              ? "bg-amber-50 border-amber-200 dark:bg-amber-950/30 dark:border-amber-900"
                              : "bg-green-50 border-green-200 dark:bg-green-950/30 dark:border-green-900"
                            : hasException
                              ? "bg-amber-50/50 border-amber-100 dark:border-amber-900/50"
                              : "border-border"
                          }`}
                        data-testid={`item-group-${productId}`}
                        id={`item-group-${productId}`}
                      >
                        <div className={`w-8 h-8 rounded-full flex items-center justify-center ${isComplete
                          ? hasException ? "bg-amber-500 text-white" : "bg-green-500 text-white"
                          : "bg-muted"
                          }`}>
                          {isComplete ? (
                            <Check className="h-4 w-4" />
                          ) : (
                            <span className="text-sm font-medium">{remaining}</span>
                          )}
                        </div>
                        <div className="flex-1 min-w-0">
                          <p className="font-medium truncate">{group.product.name}</p>
                          <div className="text-xs text-muted-foreground flex items-center gap-2">
                            <div className="flex flex-col gap-1">
                              <span>SKU: {group.product.erpCode}</span>
                              <span>Unit: {group.product.barcode || "S/N"}</span>
                            </div>
                            {isComplete && (
                              hasException
                                ? <span className="font-bold text-amber-600 dark:text-amber-400">COM EXCEÇÃO</span>
                                : <span className="font-bold text-green-600 dark:text-green-400">SEPARADO</span>
                            )}
                          </div>
                        </div>
                        <div className="text-right">
                          <p className="text-sm font-medium">
                            {group.separatedQty}/{group.totalQty} {group.product.unit}
                            {group.exceptionQty > 0 && (
                              <span className="text-orange-600 dark:text-orange-400"> -{group.exceptionQty}</span>
                            )}
                          </p>
                          {group.items.length > 1 && (
                            <span className="text-[10px] text-muted-foreground block mt-1">
                              {group.items.length} pedidos agrupados
                            </span>
                          )}
                        </div>
                        <Button
                          variant="outline"
                          size="sm"
                          className="h-8 w-8 p-0"
                          onClick={() => {
                            setExceptionItem(firstIncompleteItem);
                            setShowExceptionDialog(true);
                          }}
                          data-testid={`button-exception-${productId}`}
                        >
                          <AlertTriangle className="h-4 w-4" />
                        </Button>
                      </div>
                    );
                  });
                })()}
              </div>

              <div className="flex gap-2 mt-4">
                <Button
                  variant="outline"
                  className="flex-1"
                  onClick={() => {
                    // Get all locked units for this user (Multi-Order)
                    const myWorkUnits = workUnits?.filter(wu => wu.lockedBy === user?.id) || [];
                    const ids = myWorkUnits.length > 0 ? myWorkUnits.map(wu => wu.id) : (activeWorkUnit ? [activeWorkUnit.id] : []);

                    if (ids.length > 0) {
                      unlockMutation.mutate({ ids, reset: true });
                    }
                  }}
                  disabled={unlockMutation.isPending}
                  data-testid="button-cancel-picking"
                >
                  Cancelar
                </Button>
                <Button
                  className="flex-1"
                  onClick={() => {
                    if (activeWorkUnit && activeWorkUnit.status !== "concluido") {
                      completeWorkUnitMutation.mutate(activeWorkUnit.id);
                    } else {
                      setStep("complete");
                    }
                  }}
                  disabled={(() => {
                    if (!activeWorkUnit) return true;
                    if (completeWorkUnitMutation.isPending) return true;
                    if (activeWorkUnit.status === "concluido") return false;

                    const itemsReady = activeWorkUnit.items.every(item => {
                      const excQty = (item as any).exceptionQty || 0;
                      const sepQty = Number(item.separatedQty);
                      return (sepQty + excQty) >= Number(item.quantity);
                    });
                    return !itemsReady;
                  })()}
                  data-testid="button-complete-picking"
                >
                  Concluir Separação
                </Button>
              </div>
            </SectionCard>
          </>
        )}

        {/* Step: Complete */}
        {step === "complete" && (
          <SectionCard>
            <div className="text-center py-8">
              <div className="w-20 h-20 rounded-full bg-green-100 dark:bg-green-900/30 flex items-center justify-center mx-auto mb-4">
                <Check className="h-10 w-10 text-green-600 dark:text-green-400" />
              </div>
              <h2 className="text-2xl font-bold mb-2">Separação Concluída!</h2>
              <p className="text-muted-foreground mb-6">
                Todos os itens foram separados com sucesso.
              </p>
              <Button onClick={handleReset} className="w-full h-12" data-testid="button-new-separation">
                Nova Separação
              </Button>
            </div>
          </SectionCard>
        )}
      </main>

      <ResultDialog
        open={showResultDialog}
        onOpenChange={setShowResultDialog}
        type={resultDialogConfig.type}
        title={resultDialogConfig.title}
        message={resultDialogConfig.message}
        onAction={step === "complete" ? handleReset : undefined}
      />

      {exceptionItem && (
        <ExceptionDialog
          open={showExceptionDialog}
          onOpenChange={setShowExceptionDialog}
          productName={exceptionItem.product.name}
          maxQuantity={Math.max(0, Number(exceptionItem.quantity) - Number(exceptionItem.separatedQty) - (exceptionItem.exceptionQty || 0))}
          hasExceptions={(exceptionItem.exceptionQty || 0) > 0}
          onSubmit={(data) => {
            if (activeWorkUnit) {
              createExceptionMutation.mutate({
                workUnitId: activeWorkUnit.id,
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
