import { useState, useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useAuth, useSessionQueryKey } from "@/lib/auth";
import { GradientHeader } from "@/components/ui/gradient-header";
import { SectionCard } from "@/components/ui/section-card";
import { StatusBadge } from "@/components/ui/status-badge";
import { ScanInput } from "@/components/ui/scan-input";
import { ResultDialog } from "@/components/ui/result-dialog";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Progress } from "@/components/ui/progress";
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";
import {
  Store,
  LogOut,
  Package,
  Check,
  AlertTriangle,
  ChevronRight,
  Clock,
  Timer,
} from "lucide-react";
import type { WorkUnitWithDetails, OrderItem, Product } from "@shared/schema";

type BalcaoStep = "select" | "picking" | "complete";

interface ItemWithProduct extends OrderItem {
  product: Product;
}

function formatTime(seconds: number): string {
  const mins = Math.floor(seconds / 60);
  const secs = seconds % 60;
  return `${mins.toString().padStart(2, "0")}:${secs.toString().padStart(2, "0")}`;
}

export default function BalcaoPage() {
  const { user, logout } = useAuth();
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const [step, setStep] = useState<BalcaoStep>("select");
  const [selectedWorkUnit, setSelectedWorkUnit] = useState<WorkUnitWithDetails | null>(null);
  const [scanStatus, setScanStatus] = useState<"idle" | "success" | "error" | "warning">("idle");
  const [scanMessage, setScanMessage] = useState("");
  const [showResultDialog, setShowResultDialog] = useState(false);
  const [resultDialogConfig, setResultDialogConfig] = useState({
    type: "success" as "success" | "error" | "warning",
    title: "",
    message: "",
  });
  const [elapsedTime, setElapsedTime] = useState(0);

  const workUnitsQueryKey = useSessionQueryKey(["/api/work-units", "balcao"]);

  const { data: workUnits, isLoading } = useQuery<WorkUnitWithDetails[]>({
    queryKey: workUnitsQueryKey,
  });

  const lockMutation = useMutation({
    mutationFn: async (workUnitId: string) => {
      const res = await apiRequest("POST", "/api/work-units/lock", { workUnitIds: [workUnitId] });
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: workUnitsQueryKey });
    },
  });

  const scanItemMutation = useMutation({
    mutationFn: async ({ workUnitId, barcode }: { workUnitId: string; barcode: string }) => {
      const res = await apiRequest("POST", `/api/work-units/${workUnitId}/balcao-item`, { barcode });
      return res.json();
    },
  });

  const completeMutation = useMutation({
    mutationFn: async (workUnitId: string) => {
      const res = await apiRequest("POST", `/api/work-units/${workUnitId}/complete-balcao`, {
        elapsedTime,
      });
      return res.json();
    },
  });

  // Timer effect
  useEffect(() => {
    let interval: NodeJS.Timeout | null = null;
    if (step === "picking" && selectedWorkUnit) {
      interval = setInterval(() => {
        setElapsedTime((prev) => prev + 1);
      }, 1000);
    }
    return () => {
      if (interval) clearInterval(interval);
    };
  }, [step, selectedWorkUnit]);

  const availableWorkUnits = workUnits?.filter(
    (wu) => wu.status === "pendente" && !wu.lockedBy
  ) || [];

  const handleSelectWorkUnit = async (workUnit: WorkUnitWithDetails) => {
    try {
      await lockMutation.mutateAsync(workUnit.id);
      setSelectedWorkUnit(workUnit);
      setElapsedTime(0);
      setStep("picking");
    } catch {
      toast({
        title: "Erro",
        description: "Falha ao iniciar atendimento",
        variant: "destructive",
      });
    }
  };

  const handleScanItem = async (barcode: string) => {
    if (!selectedWorkUnit) return;

    try {
      const result = await scanItemMutation.mutateAsync({
        workUnitId: selectedWorkUnit.id,
        barcode,
      });

      if (result.status === "success") {
        setScanStatus("success");
        setScanMessage(`${result.product.name} - ${result.quantity} ${result.product.unit}`);
        setSelectedWorkUnit(result.workUnit);

        // Check if all items are complete
        const allComplete = result.workUnit.items.every(
          (item: ItemWithProduct) => Number(item.separatedQty) >= Number(item.quantity)
        );

        if (allComplete) {
          await completeMutation.mutateAsync(selectedWorkUnit.id);
          setResultDialogConfig({
            type: "success",
            title: "Atendimento Concluído",
            message: `Tempo total: ${formatTime(elapsedTime)}`,
          });
          setShowResultDialog(true);
          setStep("complete");
        }
      } else if (result.status === "over_quantity") {
        setScanStatus("error");
        setScanMessage("Quantidade excedida! Verifique o item.");
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
    if (!selectedWorkUnit?.items) return 0;
    const total = selectedWorkUnit.items.reduce(
      (sum, item) => sum + Number(item.quantity),
      0
    );
    const separated = selectedWorkUnit.items.reduce(
      (sum, item) => sum + Number(item.separatedQty),
      0
    );
    return total > 0 ? (separated / total) * 100 : 0;
  };

  const handleReset = () => {
    setStep("select");
    setSelectedWorkUnit(null);
    setScanStatus("idle");
    setScanMessage("");
    setElapsedTime(0);
    queryClient.invalidateQueries({ queryKey: workUnitsQueryKey });
  };

  return (
    <div className="min-h-screen bg-background">
      <GradientHeader title="Balcão" subtitle={user?.name}>
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
          <div className={`flex items-center gap-2 ${step === "picking" ? "text-primary font-medium" : "text-muted-foreground"}`}>
            <span className={`w-6 h-6 rounded-full flex items-center justify-center text-xs ${step !== "select" ? "bg-primary text-white" : "bg-muted text-muted-foreground"}`}>2</span>
            Atender
          </div>
          <ChevronRight className="h-4 w-4 text-muted-foreground" />
          <div className={`flex items-center gap-2 ${step === "complete" ? "text-primary font-medium" : "text-muted-foreground"}`}>
            <span className={`w-6 h-6 rounded-full flex items-center justify-center text-xs ${step === "complete" ? "bg-primary text-white" : "bg-muted text-muted-foreground"}`}>
              {step === "complete" ? <Check className="h-3 w-3" /> : "3"}
            </span>
            Concluir
          </div>
        </div>

        {/* Step: Select Work Unit */}
        {step === "select" && (
          <SectionCard title="Pedidos de Balcão" icon={<Store className="h-4 w-4 text-primary" />}>
            {isLoading ? (
              <div className="space-y-3">
                {Array.from({ length: 3 }).map((_, i) => (
                  <Skeleton key={i} className="h-20 w-full rounded-lg" />
                ))}
              </div>
            ) : availableWorkUnits.length > 0 ? (
              <div className="space-y-3">
                {availableWorkUnits.map((wu) => (
                  <button
                    key={wu.id}
                    onClick={() => handleSelectWorkUnit(wu)}
                    disabled={lockMutation.isPending}
                    className="w-full flex items-center gap-4 p-4 rounded-xl border border-border hover:border-primary/30 hover:bg-muted/50 transition-colors text-left"
                    data-testid={`work-unit-${wu.id}`}
                  >
                    <div className="w-12 h-12 rounded-lg bg-primary/10 flex items-center justify-center">
                      <Package className="h-6 w-6 text-primary" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="font-mono font-semibold">{wu.order.erpOrderId}</span>
                        <StatusBadge status={wu.status} />
                      </div>
                      <p className="text-sm text-muted-foreground truncate">
                        {wu.order.customerName}
                      </p>
                      <p className="text-xs text-muted-foreground">
                        {wu.items?.length || 0} itens • R$ {Number(wu.order.totalValue).toLocaleString("pt-BR", { minimumFractionDigits: 2 })}
                      </p>
                    </div>
                    <ChevronRight className="h-5 w-5 text-muted-foreground" />
                  </button>
                ))}
              </div>
            ) : (
              <div className="text-center py-12 text-muted-foreground">
                <Store className="h-16 w-16 mx-auto mb-4 opacity-40" />
                <p className="text-lg font-medium">Nenhum pedido de balcão</p>
                <p className="text-sm">Aguarde novos clientes</p>
              </div>
            )}
          </SectionCard>
        )}

        {/* Step: Picking */}
        {step === "picking" && selectedWorkUnit && (
          <>
            <SectionCard
              title={`Pedido ${selectedWorkUnit.order.erpOrderId}`}
              icon={<Store className="h-4 w-4 text-primary" />}
              actions={
                <div className="flex items-center gap-2 bg-primary/10 px-3 py-1.5 rounded-full">
                  <Timer className="h-4 w-4 text-primary" />
                  <span className="font-mono font-medium text-primary">{formatTime(elapsedTime)}</span>
                </div>
              }
            >
              <div className="mb-4">
                <p className="text-sm text-muted-foreground mb-2">{selectedWorkUnit.order.customerName}</p>
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

            <SectionCard title="Itens do Pedido">
              <div className="space-y-2">
                {(selectedWorkUnit.items as ItemWithProduct[])?.map((item) => {
                  const remaining = Number(item.quantity) - Number(item.separatedQty);
                  const isComplete = remaining <= 0;

                  return (
                    <div
                      key={item.id}
                      className={`flex items-center gap-3 p-3 rounded-lg border ${
                        isComplete
                          ? "bg-green-50 border-green-200 dark:bg-green-950/30 dark:border-green-900"
                          : "border-border"
                      }`}
                      data-testid={`item-${item.id}`}
                    >
                      <div className={`w-8 h-8 rounded-full flex items-center justify-center ${
                        isComplete ? "bg-green-500 text-white" : "bg-muted"
                      }`}>
                        {isComplete ? (
                          <Check className="h-4 w-4" />
                        ) : (
                          <span className="text-sm font-medium">{remaining}</span>
                        )}
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="font-medium truncate">{item.product.name}</p>
                        <p className="text-xs text-muted-foreground">
                          {item.product.barcode} • Ponto {item.pickupPoint}
                        </p>
                      </div>
                      <div className="text-right">
                        <p className="text-sm font-medium">
                          {Number(item.separatedQty)}/{Number(item.quantity)} {item.product.unit}
                        </p>
                      </div>
                    </div>
                  );
                })}
              </div>

              <div className="flex gap-2 mt-4">
                <Button
                  variant="outline"
                  className="flex-1"
                  onClick={() => {
                    setResultDialogConfig({
                      type: "warning",
                      title: "Registrar Exceção",
                      message: "Deseja reportar um item não encontrado, avariado ou vencido?",
                    });
                    setShowResultDialog(true);
                  }}
                  data-testid="button-exception"
                >
                  <AlertTriangle className="h-4 w-4 mr-2" />
                  Exceção
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
              <h2 className="text-2xl font-bold mb-2">Atendimento Concluído!</h2>
              <div className="flex items-center justify-center gap-2 text-muted-foreground mb-6">
                <Clock className="h-4 w-4" />
                <span>Tempo total: {formatTime(elapsedTime)}</span>
              </div>
              <Button onClick={handleReset} className="w-full h-12" data-testid="button-new-balcao">
                Próximo Cliente
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
    </div>
  );
}
