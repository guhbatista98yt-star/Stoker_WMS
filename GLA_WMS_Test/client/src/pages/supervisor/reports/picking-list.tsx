import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { DatePickerWithRange } from "@/components/ui/date-range-picker";
import { DateRange } from "react-day-picker";
import { getCurrentWeekRange } from "@/lib/date-utils";
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle,
} from "@/components/ui/dialog";
import {
    Table,
    TableBody,
    TableCell,
    TableHead,
    TableHeader,
    TableRow,
} from "@/components/ui/table";
import {
    FileDown,
    Loader2,
    ArrowLeft,
    Search as SearchIcon,
    X,
    Plus,
    Pencil,
    Trash2,
    Save,
} from "lucide-react";
import { apiRequest } from "@/lib/queryClient";
import { GradientHeader } from "@/components/ui/gradient-header";
import { SectionCard } from "@/components/ui/section-card";
import { StatusBadge } from "@/components/ui/status-badge";
import { Link } from "wouter";
import { useToast } from "@/hooks/use-toast";


type FlowStep = "initial" | "pickup-points" | "select-orders" | "sections" | "summary";
type SectionMode = "individual" | "group";

interface SectionGroup {
    id: string;
    name: string;
    sections: string[];
    createdAt: string;
    updatedAt: string;
}

export default function PickingListReport() {
    const { toast } = useToast();
    const queryClient = useQueryClient();

    // Flow state
    const [currentStep, setCurrentStep] = useState<FlowStep>("initial");

    // Modal 1 - Pickup Points
    const [selectedPickupPoints, setSelectedPickupPoints] = useState<number[]>([]);
    const [selectAllPickupPoints, setSelectAllPickupPoints] = useState(false);

    // Modal 2 - Orders
    const [selectedOrders, setSelectedOrders] = useState<string[]>([]);
    const [orderSearchQuery, setOrderSearchQuery] = useState("");
    const [showSelectedOrdersOnly, setShowSelectedOrdersOnly] = useState(false);
    const [filterDateRange, setFilterDateRange] = useState<DateRange | undefined>(getCurrentWeekRange());
    const [tempDateRange, setTempDateRange] = useState<DateRange | undefined>(getCurrentWeekRange());

    // Modal 3 - Sections/Groups
    const [sectionMode, setSectionMode] = useState<SectionMode>("individual");
    const [selectedSections, setSelectedSections] = useState<string[]>([]);
    const [selectedGroupId, setSelectedGroupId] = useState<string>("");
    const [showCreateGroupDialog, setShowCreateGroupDialog] = useState(false);
    const [showEditGroupDialog, setShowEditGroupDialog] = useState(false);
    const [editingGroup, setEditingGroup] = useState<SectionGroup | null>(null);
    const [newGroupName, setNewGroupName] = useState("");
    const [newGroupSections, setNewGroupSections] = useState<string[]>([]);
    const [groupSearchQuery, setGroupSearchQuery] = useState("");

    // Modal 4 - Generate
    const [isGenerating, setIsGenerating] = useState(false);

    const [ordersLoaded, setOrdersLoaded] = useState(false);

    const { data: pickupPointsData } = useQuery({
        queryKey: ["/api/pickup-points"],
    });
    const pickupPoints: number[] = (pickupPointsData as number[]) || [];

    const { data: ordersData, refetch: refetchOrders, isFetching: isLoadingOrders } = useQuery({
        queryKey: ["/api/orders"],
        enabled: ordersLoaded,
    });
    const orders = (ordersData as any[]) || [];

    const { data: sectionsData } = useQuery({
        queryKey: ["/api/sections"],
        enabled: currentStep === "sections",
    });
    const sections = (sectionsData as string[]) || [];

    const { data: groupsData } = useQuery({
        queryKey: ["/api/sections/groups"],
        enabled: currentStep === "sections",
    });
    const groups = (groupsData as SectionGroup[]) || [];

    const { data: routesData } = useQuery({
        queryKey: ["/api/routes"],
    });
    const routes = (routesData as any[]) || [];

    // Mutations
    const createGroupMutation = useMutation({
        mutationFn: async (data: { name: string; sections: string[] }) => {
            try {
                console.log('Creating group with data:', data);
                const response = await apiRequest("POST", "/api/sections/groups", data);
                if (!response.ok) {
                    const text = await response.text();
                    console.error('Create group failed:', text);
                    throw new Error(text || "Falha ao criar grupo");
                }
                const result = await response.json();
                console.log('Group created successfully:', result);
                return result;
            } catch (error) {
                console.error('Error creating group:', error);
                throw error;
            }
        },
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ["/api/sections/groups"] });
            toast({ title: "✅ Grupo criado com sucesso!" });
            setShowCreateGroupDialog(false);
            setNewGroupName("");
            setNewGroupSections([]);
        },
        onError: (error: Error) => {
            console.error('Create group mutation error:', error);
            toast({
                title: "❌ Erro ao criar grupo",
                description: "Verifique o console para mais detalhes.",
                variant: "destructive"
            });
        },
    });

    const updateGroupMutation = useMutation({
        mutationFn: async (data: { id: string; name: string; sections: string[] }) => {
            const response = await apiRequest("PUT", `/api/sections/groups/${data.id}`, { name: data.name, sections: data.sections });
            if (!response.ok) {
                const text = await response.text();
                throw new Error(text || "Falha ao atualizar grupo");
            }
            return response.json();
        },
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ["/api/sections/groups"] });
            toast({ title: "✅ Grupo atualizado!" });
            setShowEditGroupDialog(false);
            setEditingGroup(null);
        },
        onError: () => {
            toast({ title: "❌ Erro ao atualizar grupo", variant: "destructive" });
        },
    });

    const deleteGroupMutation = useMutation({
        mutationFn: async (id: string) => {
            const response = await apiRequest("DELETE", `/api/sections/groups/${id}`);
            if (!response.ok) {
                const text = await response.text();
                throw new Error(text || "Falha ao excluir grupo");
            }
            return response.json();
        },
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ["/api/sections/groups"] });
            toast({ title: "🗑️ Grupo excluído." });
        },
        onError: () => {
            toast({ title: "❌ Erro ao excluir grupo", variant: "destructive" });
        },
    });

    const filteredOrders = orders.filter(order => {
        if (filterDateRange?.from) {
            const orderDate = new Date(order.createdAt);
            const from = new Date(filterDateRange.from);
            from.setHours(0, 0, 0, 0);
            if (orderDate < from) return false;
        }
        if (filterDateRange?.to) {
            const orderDate = new Date(order.createdAt);
            const to = new Date(filterDateRange.to);
            to.setHours(23, 59, 59, 999);
            if (orderDate > to) return false;
        }

        if (!selectAllPickupPoints && selectedPickupPoints.length > 0) {
            if (!order.pickupPoints) return false;
            let orderPoints: any[] = order.pickupPoints;
            if (typeof orderPoints === 'string') {
                try {
                    orderPoints = JSON.parse(orderPoints);
                } catch (e) {
                    return false;
                }
            }
            if (!Array.isArray(orderPoints)) return false;
            if (!orderPoints.some((pp: string | number) => selectedPickupPoints.includes(Number(pp)))) return false;
        }

        return true;
    });

    // Search filtered orders
    const displayedOrders = filteredOrders.filter(order => {
        if (orderSearchQuery) {
            const query = orderSearchQuery.toLowerCase();
            const matchesId = order.erpOrderId?.toLowerCase().includes(query);
            const matchesCustomer = order.customerName?.toLowerCase().includes(query);
            if (!matchesId && !matchesCustomer) return false;
        }

        if (showSelectedOrdersOnly && !selectedOrders.includes(order.id)) {
            return false;
        }

        return true;
    });

    // Handlers
    const handleStartFlow = () => {
        setCurrentStep("pickup-points");
    };

    const handleCancelFlow = () => {
        // Reset all state
        setCurrentStep("initial");
        setSelectedPickupPoints([]);
        setSelectAllPickupPoints(false);
        setSelectedOrders([]);
        setOrderSearchQuery("");
        setShowSelectedOrdersOnly(false);
        setSectionMode("individual");
        setSelectedSections([]);
        setSelectedGroupId("");
    };

    const handlePickupPointsNext = () => {
        setCurrentStep("select-orders");
    };

    const handleSelectOrdersBack = () => {
        setCurrentStep("pickup-points");
    };

    const handleSelectOrdersNext = () => {
        setCurrentStep("sections");
    };

    const handleSectionsBack = () => {
        setCurrentStep("select-orders");
    };

    const handleSectionsNext = () => {
        setCurrentStep("summary");
    };

    const handleSummaryBack = () => {
        setCurrentStep("sections");
    };

    const handleGeneratePDF = async () => {
        setIsGenerating(true);

        try {
            const payload = {
                orderIds: selectedOrders,
                pickupPoints: selectAllPickupPoints ? pickupPoints : selectedPickupPoints,
                mode: sectionMode,
                sections: sectionMode === "individual" ? selectedSections : undefined,
                groupId: sectionMode === "group" ? selectedGroupId : undefined,
            };

            const response = await apiRequest("POST", "/api/reports/picking-list/generate", payload);
            if (!response.ok) throw new Error("Falha ao gerar relatório");
            const data = await response.json();

            const reportOrders = data.orders || [];
            const now = new Date().toLocaleString("pt-BR");

            const usedPickupPoints = selectAllPickupPoints ? pickupPoints : selectedPickupPoints;
            const ppLabel = usedPickupPoints.length > 0 ? usedPickupPoints.join("; ") : "Todos";
            const orderIdsLabel = reportOrders.map((o: any) => o.erpOrderId).join("; ");

            const activeSections = sectionMode === "individual" && selectedSections.length > 0
                ? selectedSections
                : sectionMode === "group" && selectedGroupId
                    ? (groups.find(g => g.id === selectedGroupId)?.sections || [])
                    : [];
            const sectionFilterLabel = activeSections.length > 0 ? activeSections.join("; ") : "Todos";

            const routeIds = [...new Set(reportOrders.map((o: any) => o.routeId).filter(Boolean))] as string[];
            const routeNames = routeIds.map((rid: string) => {
                const r = routes.find((rt: any) => rt.id === rid);
                return r ? (r.name || r.erpRouteId || rid) : rid;
            });
            const titleRouteLabel = routeNames.length > 0 ? routeNames.join(", ") : "";
            const titlePrefix = titleRouteLabel ? `${titleRouteLabel} - ` : "";

            interface AggregatedProduct {
                erpCode: string;
                name: string;
                barcode: string;
                manufacturer: string;
                section: string;
                totalQty: number;
            }

            const productMap = new Map<string, AggregatedProduct>();

            for (const order of reportOrders) {
                const items = order.items || [];
                for (const item of items) {
                    if (activeSections.length > 0 && !activeSections.includes(item.section)) continue;

                    const erpCode = item.product?.erpCode || item.productId || "";
                    const section = item.section || "";
                    const key = `${section}::${erpCode}`;

                    const existing = productMap.get(key);
                    if (existing) {
                        existing.totalQty += Number(item.quantity) || 0;
                    } else {
                        productMap.set(key, {
                            erpCode,
                            name: item.product?.name || "",
                            barcode: item.product?.barcode || "",
                            manufacturer: item.product?.manufacturer || "",
                            section,
                            totalQty: Number(item.quantity) || 0,
                        });
                    }
                }
            }

            const allProducts = Array.from(productMap.values());
            const sectionGroups = new Map<string, AggregatedProduct[]>();
            for (const p of allProducts) {
                const sectionName = p.section || "Sem Seção";
                if (!sectionGroups.has(sectionName)) {
                    sectionGroups.set(sectionName, []);
                }
                sectionGroups.get(sectionName)!.push(p);
            }

            let bodyHtml = "";
            let grandTotal = 0;

            const sortedSections = Array.from(sectionGroups.keys()).sort();
            for (const sectionName of sortedSections) {
                const items = sectionGroups.get(sectionName)!.sort((a, b) => a.erpCode.localeCompare(b.erpCode));
                bodyHtml += `<tr class="section-row"><td colspan="6"><strong>Seção: &nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;${sectionName.toUpperCase()}</strong></td></tr>`;

                for (const item of items) {
                    const qtyFormatted = item.totalQty % 1 === 0 ? item.totalQty.toFixed(0) + ",00" : item.totalQty.toFixed(2).replace(".", ",");
                    bodyHtml += `<tr>
                        <td>${item.erpCode}</td>
                        <td>${item.name}</td>
                        <td>${item.barcode}</td>
                        <td></td>
                        <td>${item.manufacturer}</td>
                        <td style="text-align:right">${qtyFormatted}</td>
                    </tr>`;
                }

                bodyHtml += `<tr class="count-row"><td colspan="6"><strong>&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;${items.length}</strong></td></tr>`;
                grandTotal += items.length;
            }

            bodyHtml += `<tr class="total-row"><td colspan="6"><strong>Total</strong></td></tr>`;
            bodyHtml += `<tr class="total-row"><td colspan="6"><strong>&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;<u>${grandTotal}</u></strong></td></tr>`;

            const html = `<!DOCTYPE html>
<html><head><meta charset="utf-8"><title>${titlePrefix}Romaneio de Separação</title>
<style>
    body { font-family: Arial, sans-serif; margin: 15px 20px; font-size: 10px; color: #000; }
    .header { text-align: center; margin-bottom: 6px; }
    .header h1 { font-size: 16px; font-weight: bold; margin: 0 0 6px 0; }
    .header .params { font-size: 9px; color: #333; line-height: 1.5; }
    .sub-header { display: flex; justify-content: space-between; border-bottom: 1px solid #000; padding-bottom: 2px; margin-bottom: 4px; font-size: 9px; }
    .sub-header .left { font-style: italic; text-decoration: underline; }
    .sub-header .right { text-align: right; }
    table { width: 100%; border-collapse: collapse; }
    th { border-top: 1px solid #000; border-bottom: 1px solid #000; padding: 3px 5px; text-align: left; font-size: 9px; font-weight: bold; }
    th:last-child { text-align: right; }
    td { padding: 2px 5px; font-size: 9px; border: none; }
    td:last-child { text-align: right; }
    .section-row td { padding-top: 8px; padding-bottom: 2px; border: none; font-size: 9px; }
    .count-row td { padding-top: 2px; border: none; font-size: 9px; }
    .total-row td { padding-top: 2px; border: none; font-size: 9px; }
    @media print {
        body { margin: 5mm; }
        @page { size: landscape; margin: 5mm; }
    }
</style></head><body>
<div class="header">
    <h1>${titlePrefix}Romaneio de Separação</h1>
    <div class="params">
        Informe o Ponto de Retirada::&nbsp; Multi-valor ${ppLabel}<br/>
        Informe os Pedidos::&nbsp; Multi-valor ${orderIdsLabel}<br/>
        Informe o Local de Estoque::&nbsp; Multi-valor ${sectionFilterLabel}
    </div>
</div>
<div class="sub-header">
    <span class="left">Logística/Movimento de Entrega</span>
    <span class="right">Versão 1<br/>${now}</span>
</div>
<table>
    <thead>
        <tr>
            <th>Cód. Produto</th>
            <th>Descrição do Produto</th>
            <th>Cód. de Barras</th>
            <th>Lote</th>
            <th>Fornecedor</th>
            <th>Separar</th>
        </tr>
    </thead>
    <tbody>${bodyHtml}</tbody>
</table>
</body></html>`;

            const printWindow = window.open("", "_blank");
            if (printWindow) {
                printWindow.document.write(html);
                printWindow.document.close();
            }

            toast({
                title: "Relatório gerado!",
                description: "O relatório foi aberto em uma nova aba."
            });

            handleCancelFlow();
        } catch (error) {
            toast({
                title: "Erro ao gerar relatório",
                variant: "destructive",
                description: "Não foi possível gerar o PDF. Tente novamente."
            });
        } finally {
            setIsGenerating(false);
        }
    };

    const togglePickupPoint = (id: number) => {
        setSelectedPickupPoints(prev =>
            prev.includes(id) ? prev.filter(p => p !== id) : [...prev, id]
        );
        setSelectAllPickupPoints(false);
    };

    const toggleAllPickupPoints = (checked: boolean) => {
        setSelectAllPickupPoints(checked);
        if (checked) {
            setSelectedPickupPoints([]);
        }
    };

    const toggleOrder = (id: string) => {
        setSelectedOrders(prev =>
            prev.includes(id) ? prev.filter(o => o !== id) : [...prev, id]
        );
    };

    const toggleSelectAllOrders = (checked: boolean) => {
        if (checked) {
            setSelectedOrders(displayedOrders.map(o => o.id));
        } else {
            setSelectedOrders([]);
        }
    };

    const toggleSection = (section: string) => {
        setSelectedSections(prev =>
            prev.includes(section) ? prev.filter(s => s !== section) : [...prev, section]
        );
    };

    const handleCreateGroup = () => {
        if (!newGroupName || newGroupSections.length === 0) {
            toast({ title: "⚠️ Preencha nome e selecione seções", variant: "destructive" });
            return;
        }
        createGroupMutation.mutate({ name: newGroupName, sections: newGroupSections });
    };

    const handleEditGroup = (group: SectionGroup) => {
        setEditingGroup(group);
        setNewGroupName(group.name);
        setNewGroupSections(group.sections);
        setShowEditGroupDialog(true);
    };

    const handleUpdateGroup = () => {
        if (!editingGroup || !newGroupName || newGroupSections.length === 0) {
            toast({ title: "⚠️ Preencha nome e selecione seções", variant: "destructive" });
            return;
        }
        updateGroupMutation.mutate({ id: editingGroup.id, name: newGroupName, sections: newGroupSections });
    };

    const handleDeleteGroup = (id: string) => {
        if (confirm("Tem certeza que deseja excluir este grupo? Esta ação não pode ser desfeita.")) {
            deleteGroupMutation.mutate(id);
        }
    };

    const handleSaveGroup = () => {
        if (showEditGroupDialog) {
            handleUpdateGroup();
        } else {
            handleCreateGroup();
        }
    };

    // Pickup points badge label
    const pickupPointsBadge = selectAllPickupPoints
        ? "Todos os pontos"
        : selectedPickupPoints.length === 0
            ? "0 pontos selecionados"
            : `${selectedPickupPoints.length} ponto${selectedPickupPoints.length > 1 ? 's' : ''} selecionado${selectedPickupPoints.length > 1 ? 's' : ''}`;

    return (
        <div className="min-h-screen bg-background">
            <GradientHeader>
                <div className="flex items-center justify-between w-full">
                    <div>
                        <h1 className="text-3xl font-bold text-white">Romaneio de Separação</h1>
                        <p className="text-white/80">Gere relatórios de separação personalizados</p>
                    </div>
                    <Link href="/supervisor/reports">
                        <Button variant="ghost" className="text-white hover:bg-white/10">
                            <ArrowLeft className="h-4 w-4 mr-2" />
                            Voltar
                        </Button>
                    </Link>
                </div>
            </GradientHeader>

            <div className="p-6 max-w-7xl mx-auto">
                {/* Stepper Header */}
                <div className="mb-8">
                    <div className="flex items-center justify-between relative">
                        {/* Progress Bar Background */}
                        <div className="absolute left-0 top-1/2 transform -translate-y-1/2 w-full h-1 bg-muted -z-10"></div>

                        {/* Progress Bar Active */}
                        <div
                            className="absolute left-0 top-1/2 transform -translate-y-1/2 h-1 bg-primary -z-10 transition-all duration-300"
                            style={{
                                width: currentStep === 'initial' ? '0%' :
                                    currentStep === 'pickup-points' ? '15%' :
                                        currentStep === 'select-orders' ? '50%' :
                                            currentStep === 'sections' ? '85%' : '100%'
                            }}
                        ></div>

                        {/* Steps */}
                        {[
                            { id: 'pickup-points', label: '1. Pontos', icon: '📍' },
                            { id: 'select-orders', label: '2. Pedidos', icon: '📦' },
                            { id: 'sections', label: '3. Seções', icon: '🏗️' },
                            { id: 'summary', label: '4. Gerar', icon: '📄' }
                        ].map((step, index) => {
                            const steps = ['pickup-points', 'select-orders', 'sections', 'summary'];
                            const currentIndex = steps.indexOf(currentStep);
                            const stepIndex = steps.indexOf(step.id);
                            const isActive = stepIndex <= currentIndex;
                            const isCurrent = step.id === currentStep;

                            return (
                                <div key={step.id} className="flex flex-col items-center bg-background px-2">
                                    <div
                                        className={`
                                            w-10 h-10 rounded-full flex items-center justify-center border-2 
                                            transition-colors duration-300 z-10
                                            ${isActive ? 'bg-primary border-primary text-primary-foreground' : 'bg-background border-muted text-muted-foreground'}
                                            ${isCurrent ? 'ring-2 ring-offset-2 ring-primary' : ''}
                                        `}
                                    >
                                        {isActive ? <span className="text-lg">{step.icon}</span> : <span className="text-sm font-bold">{index + 1}</span>}
                                    </div>
                                    <span className={`text-sm mt-2 font-medium ${isActive ? 'text-foreground' : 'text-muted-foreground'}`}>
                                        {step.label}
                                    </span>
                                </div>
                            );
                        })}
                    </div>
                </div>

                {/* Step Content: Initial */}
                {currentStep === "initial" && (
                    <SectionCard>
                        <CardHeader>
                            <CardTitle>Gerar Novo Relatório</CardTitle>
                            <CardDescription>
                                Configure os filtros e selecione os pedidos para gerar o romaneio de separação
                            </CardDescription>
                        </CardHeader>
                        <CardContent>
                            <Button onClick={handleStartFlow} className="w-full md:w-auto">
                                <FileDown className="mr-2 h-4 w-4" />
                                Iniciar Configuração
                            </Button>
                        </CardContent>
                    </SectionCard>
                )}

                {/* Step Content: Pickup Points */}
                {currentStep === "pickup-points" && (
                    <Card>
                        <CardHeader>
                            <CardTitle>Filtrar por Ponto de Retirada</CardTitle>
                            <CardDescription>Selecione um ou mais pontos para buscar pedidos</CardDescription>
                        </CardHeader>
                        <CardContent className="space-y-4">
                            <div className="flex items-center space-x-2 p-4 border rounded-lg bg-muted/20">
                                <Checkbox
                                    id="all-points"
                                    checked={selectAllPickupPoints}
                                    onCheckedChange={toggleAllPickupPoints}
                                />
                                <Label htmlFor="all-points" className="font-medium cursor-pointer">
                                    Todos os Pontos
                                </Label>
                            </div>

                            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                                {pickupPoints.length === 0 && (
                                    <p className="text-muted-foreground text-sm col-span-2">Nenhum ponto de retirada encontrado</p>
                                )}
                                {pickupPoints.map(pointId => (
                                    <div key={pointId} className="flex items-center space-x-2 p-3 border rounded hover:bg-muted/50 transition-colors">
                                        <Checkbox
                                            id={`point-${pointId}`}
                                            checked={selectedPickupPoints.includes(pointId)}
                                            onCheckedChange={() => togglePickupPoint(pointId)}
                                            disabled={selectAllPickupPoints}
                                        />
                                        <Label htmlFor={`point-${pointId}`} className="cursor-pointer font-medium text-sm w-full py-1">
                                            Ponto {pointId}
                                        </Label>
                                    </div>
                                ))}
                            </div>

                            <div className="pt-2">
                                <Badge variant="secondary" className="px-3 py-1 text-sm">{pickupPointsBadge}</Badge>
                            </div>
                        </CardContent>
                        <div className="flex justify-between p-6 border-t bg-muted/10">
                            <Button variant="outline" onClick={handleCancelFlow}>Cancelar</Button>
                            <Button
                                onClick={handlePickupPointsNext}
                                disabled={!selectAllPickupPoints && selectedPickupPoints.length === 0}
                            >
                                Continuar →
                            </Button>
                        </div>
                    </Card>
                )}

                {/* Step Content: Select Orders */}
                {currentStep === "select-orders" && (
                    <Card>
                        <CardHeader>
                            <CardTitle>Selecionar Pedidos</CardTitle>
                            <CardDescription>
                                {filteredOrders.length} pedidos encontrados | {pickupPointsBadge} | {selectedOrders.length} selecionados
                            </CardDescription>
                        </CardHeader>
                        <CardContent className="space-y-4">
                            <div className="flex flex-col md:flex-row gap-4">
                                <DatePickerWithRange
                                    date={tempDateRange}
                                    onDateChange={setTempDateRange}
                                    className="flex-1"
                                />
                                <Button
                                    onClick={() => {
                                        setFilterDateRange(tempDateRange);
                                        if (!ordersLoaded) {
                                            setOrdersLoaded(true);
                                        } else {
                                            refetchOrders();
                                        }
                                    }}
                                    variant="default"
                                    disabled={isLoadingOrders}
                                >
                                    {isLoadingOrders ? (
                                        <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                                    ) : (
                                        <SearchIcon className="h-4 w-4 mr-2" />
                                    )}
                                    {isLoadingOrders ? "Carregando..." : "Buscar Pedidos"}
                                </Button>
                            </div>

                            <div className="relative">
                                <SearchIcon className="absolute left-2 top-2.5 h-4 w-4 text-muted-foreground" />
                                <Input
                                    placeholder="Filtrar na lista (Cliente, ID)..."
                                    value={orderSearchQuery}
                                    onChange={(e) => setOrderSearchQuery(e.target.value)}
                                    className="pl-8"
                                />
                            </div>

                            <div className="flex flex-wrap items-center justify-between gap-4 py-2">
                                <div className="flex items-center space-x-2">
                                    <Checkbox
                                        id="select-all-orders"
                                        checked={displayedOrders.length > 0 && selectedOrders.length === displayedOrders.length}
                                        onCheckedChange={toggleSelectAllOrders}
                                    />
                                    <Label htmlFor="select-all-orders" className="cursor-pointer">
                                        Selecionar todos visíveis ({displayedOrders.length})
                                    </Label>
                                </div>
                                <div className="flex items-center space-x-2">
                                    <Checkbox
                                        id="show-selected"
                                        checked={showSelectedOrdersOnly}
                                        onCheckedChange={(checked) => setShowSelectedOrdersOnly(!!checked)}
                                    />
                                    <Label htmlFor="show-selected" className="cursor-pointer">Mostrar apenas Selecionados</Label>
                                </div>
                            </div>

                            <div className="border rounded-md overflow-hidden">
                                <div className="max-h-[500px] overflow-auto">
                                    <Table>
                                        <TableHeader className="bg-muted/50 sticky top-0 z-10">
                                            <TableRow>
                                                <TableHead className="w-12 text-center">
                                                    <Checkbox
                                                        checked={displayedOrders.length > 0 && selectedOrders.length === displayedOrders.length}
                                                        onCheckedChange={toggleSelectAllOrders}
                                                    />
                                                </TableHead>
                                                <TableHead>Pedido</TableHead>
                                                <TableHead>Cliente</TableHead>
                                                <TableHead className="text-center">Prod.</TableHead>
                                                <TableHead className="text-center">Status</TableHead>
                                            </TableRow>
                                        </TableHeader>
                                        <TableBody>
                                            {displayedOrders.length === 0 ? (
                                                <TableRow>
                                                    <TableCell colSpan={5} className="h-32 text-center text-muted-foreground">
                                                        {orders.length === 0
                                                            ? <div className="flex flex-col items-center gap-2"><SearchIcon className="h-8 w-8 opacity-50" /><span>Clique em "Buscar" para carregar os pedidos</span></div>
                                                            : 'Nenhum pedido encontrado com os filtros atuais'
                                                        }
                                                    </TableCell>
                                                </TableRow>
                                            ) : (
                                                displayedOrders.map(order => (
                                                    <TableRow
                                                        key={order.id}
                                                        className={`cursor-pointer transition-colors ${selectedOrders.includes(order.id) ? 'bg-primary/5' : 'hover:bg-muted/50'}`}
                                                        onClick={() => toggleOrder(order.id)}
                                                    >
                                                        <TableCell onClick={(e) => e.stopPropagation()} className="text-center">
                                                            <Checkbox
                                                                checked={selectedOrders.includes(order.id)}
                                                                onCheckedChange={() => toggleOrder(order.id)}
                                                            />
                                                        </TableCell>
                                                        <TableCell className="font-mono font-medium text-primary">{order.erpOrderId}</TableCell>
                                                        <TableCell className="font-medium">{order.customerName}</TableCell>
                                                        <TableCell className="text-center">
                                                            <Badge variant="outline">{order.itemCount || 0}</Badge>
                                                        </TableCell>
                                                        <TableCell className="text-center">
                                                            <Badge variant={order.financialStatus === 'Aprovado' ? 'default' : 'secondary'} className="shadow-none">
                                                                {order.financialStatus || 'Pendente'}
                                                            </Badge>
                                                        </TableCell>
                                                    </TableRow>
                                                ))
                                            )}
                                        </TableBody>
                                    </Table>
                                </div>
                            </div>
                        </CardContent>
                        <div className="flex justify-between p-6 border-t bg-muted/10">
                            <Button variant="outline" onClick={handleSelectOrdersBack}>← Voltar</Button>
                            <Button
                                onClick={handleSelectOrdersNext}
                                disabled={selectedOrders.length === 0}
                            >
                                Continuar ({selectedOrders.length}) →
                            </Button>
                        </div>
                    </Card>
                )}

                {/* Step Content: Sections/Groups */}
                {currentStep === "sections" && (
                    <Card>
                        <CardHeader>
                            <CardTitle>Organizar Relatório</CardTitle>
                            <CardDescription>Como você deseja agrupar os itens no relatório?</CardDescription>
                        </CardHeader>
                        <CardContent className="space-y-6">
                            <RadioGroup value={sectionMode} onValueChange={(v) => setSectionMode(v as SectionMode)} className="grid grid-cols-1 md:grid-cols-2 gap-4">
                                <div className={`flex items-start space-x-3 border p-4 rounded-lg cursor-pointer transition-all ${sectionMode === 'individual' ? 'border-primary bg-primary/5 ring-1 ring-primary' : 'hover:bg-muted/50'}`}>
                                    <RadioGroupItem value="individual" id="mode-individual" className="mt-1" />
                                    <div className="grid gap-1.5">
                                        <Label htmlFor="mode-individual" className="font-semibold text-base cursor-pointer">
                                            Por Seção Individual
                                        </Label>
                                        <p className="text-sm text-muted-foreground">
                                            Gera uma quebra de página para cada seção selecionada (ex: Tubos, Conexões).
                                        </p>
                                    </div>
                                </div>
                                <div className={`flex items-start space-x-3 border p-4 rounded-lg cursor-pointer transition-all ${sectionMode === 'group' ? 'border-primary bg-primary/5 ring-1 ring-primary' : 'hover:bg-muted/50'}`}>
                                    <RadioGroupItem value="group" id="mode-group" className="mt-1" />
                                    <div className="grid gap-1.5">
                                        <Label htmlFor="mode-group" className="font-semibold text-base cursor-pointer">
                                            Por Grupo de Seções
                                        </Label>
                                        <p className="text-sm text-muted-foreground">
                                            Agrupa várias seções em uma única lista (ex: "Hidráulica" contendo tubos e conexões).
                                        </p>
                                    </div>
                                </div>
                            </RadioGroup>

                            {sectionMode === "individual" && (
                                <div className="space-y-4 border-t pt-6 animate-in fade-in slide-in-from-top-4 duration-300">
                                    <div className="flex items-center justify-between">
                                        <h4 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider">Seções Disponíveis</h4>
                                        <Badge variant="secondary">{selectedSections.length} selecionadas</Badge>
                                    </div>
                                    <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
                                        {sections.map((section: any) => (
                                            <div key={section.id} className="flex items-center space-x-2 p-3 rounded border bg-card hover:bg-accent transition-colors cursor-pointer" onClick={() => toggleSection(section.name)}>
                                                <Checkbox
                                                    id={`section-${section.id}`}
                                                    checked={selectedSections.includes(section.name)}
                                                    onCheckedChange={() => toggleSection(section.name)}
                                                    className="pointer-events-none"
                                                />
                                                <Label htmlFor={`section-${section.id}`} className="cursor-pointer flex-1 text-sm line-clamp-1 py-1" title={section.name}>
                                                    <span className="font-mono text-muted-foreground mr-2">{section.id}</span>
                                                    {section.name}
                                                </Label>
                                            </div>
                                        ))}
                                    </div>
                                </div>
                            )}

                            {sectionMode === "group" && (
                                <div className="space-y-4 border-t pt-6 animate-in fade-in slide-in-from-top-4 duration-300">
                                    {/* Create/Edit Group Inline Form */}
                                    {(showCreateGroupDialog || showEditGroupDialog) ? (
                                        <div className="border-2 border-dashed border-primary/20 rounded-xl p-6 bg-muted/30 space-y-5">
                                            <div className="flex items-center justify-between">
                                                <h3 className="text-lg font-semibold text-primary">
                                                    {showEditGroupDialog ? "✏️ Editar Grupo" : "✨ Novo Grupo"}
                                                </h3>
                                                <Button
                                                    variant="ghost"
                                                    size="sm"
                                                    onClick={() => {
                                                        setShowCreateGroupDialog(false);
                                                        setShowEditGroupDialog(false);
                                                        setEditingGroup(null);
                                                        setNewGroupName("");
                                                        setNewGroupSections([]);
                                                    }}
                                                >
                                                    Cancelar
                                                </Button>
                                            </div>

                                            <div className="grid gap-4">
                                                <div className="grid gap-2">
                                                    <Label htmlFor="inline-group-name">Nome do Grupo</Label>
                                                    <Input
                                                        id="inline-group-name"
                                                        value={newGroupName}
                                                        onChange={(e) => setNewGroupName(e.target.value)}
                                                        placeholder="Ex: Kit Banheiro Completo"
                                                        className="bg-background"
                                                    />
                                                </div>

                                                <div className="grid gap-2">
                                                    <Label>Selecione as Seções do Grupo</Label>
                                                    <div className="border rounded-md bg-background max-h-[250px] overflow-auto p-4 grid grid-cols-2 gap-3">
                                                        {sections.map(section => (
                                                            <div key={section} className="flex items-center space-x-3 p-3 border rounded-md hover:bg-accent transition-colors cursor-pointer" onClick={() => {
                                                                setNewGroupSections(prev =>
                                                                    prev.includes(section)
                                                                        ? prev.filter(s => s !== section)
                                                                        : [...prev, section]
                                                                );
                                                            }}>
                                                                <Checkbox
                                                                    id={`inline-section-${section}`}
                                                                    checked={newGroupSections.includes(section)}
                                                                    onCheckedChange={() => {
                                                                        // Handled by parent div click
                                                                    }}
                                                                    className="pointer-events-none" // Pass click to parent
                                                                />
                                                                <Label htmlFor={`inline-section-${section}`} className="text-sm cursor-pointer flex-1 py-1">{section}</Label>
                                                            </div>
                                                        ))}
                                                    </div>
                                                    <p className="text-xs text-muted-foreground text-right">
                                                        {newGroupSections.length} seções selecionadas
                                                    </p>
                                                </div>
                                            </div>

                                            <div className="flex justify-end gap-3 pt-2">
                                                <Button
                                                    onClick={handleSaveGroup}
                                                    className="w-full md:w-auto min-w-[150px]"
                                                >
                                                    <Save className="h-4 w-4 mr-2" />
                                                    Salvar Grupo
                                                </Button>
                                            </div>
                                        </div>
                                    ) : (
                                        <div className="space-y-4">
                                            <Button
                                                variant="outline"
                                                className="w-full border-dashed h-12 text-muted-foreground hover:text-primary hover:border-primary transition-colors"
                                                onClick={() => {
                                                    setNewGroupName("");
                                                    setNewGroupSections([]);
                                                    setShowCreateGroupDialog(true);
                                                }}
                                            >
                                                <Plus className="h-4 w-4 mr-2" />
                                                Criar Novo Grupo Personalizado
                                            </Button>

                                            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                                                {groups.length === 0 ? (
                                                    <div className="col-span-full py-12 text-center text-muted-foreground border rounded-lg bg-muted/10">
                                                        <p>Nenhum grupo de seções encontrado.</p>
                                                        <p className="text-sm">Crie um grupo para facilitar a geração de relatórios recorrentes.</p>
                                                    </div>
                                                ) : (
                                                    groups.map(group => (
                                                        <div
                                                            key={group.id}
                                                            className={`
                                                                relative border rounded-xl p-4 cursor-pointer transition-all duration-200
                                                                ${selectedGroupId === group.id
                                                                    ? 'bg-primary/5 border-primary ring-1 ring-primary shadow-sm'
                                                                    : 'hover:bg-muted/50 hover:border-muted-foreground/50'}
                                                            `}
                                                            onClick={() => setSelectedGroupId(group.id)}
                                                        >
                                                            <div className="flex items-start justify-between mb-2">
                                                                <div className="flex items-center gap-2">
                                                                    <div className={`
                                                                        w-4 h-4 rounded-full border flex items-center justify-center
                                                                        ${selectedGroupId === group.id ? 'border-primary' : 'border-muted-foreground'}
                                                                    `}>
                                                                        {selectedGroupId === group.id && <div className="w-2 h-2 rounded-full bg-primary" />}
                                                                    </div>
                                                                    <h4 className="font-semibold text-foreground line-clamp-1" title={group.name}>{group.name}</h4>
                                                                </div>
                                                                <div className="flex gap-1 -mr-2 -mt-2">
                                                                    <Button
                                                                        variant="ghost"
                                                                        size="icon"
                                                                        className="h-8 w-8 hover:text-primary"
                                                                        onClick={(e) => {
                                                                            e.stopPropagation();
                                                                            handleEditGroup(group);
                                                                        }}
                                                                    >
                                                                        <Pencil className="h-3.5 w-3.5" />
                                                                    </Button>
                                                                    <Button
                                                                        variant="ghost"
                                                                        size="icon"
                                                                        className="h-8 w-8 hover:text-destructive"
                                                                        onClick={(e) => {
                                                                            e.stopPropagation();
                                                                            handleDeleteGroup(group.id);
                                                                        }}
                                                                    >
                                                                        <Trash2 className="h-3.5 w-3.5" />
                                                                    </Button>
                                                                </div>
                                                            </div>

                                                            <div className="pl-6">
                                                                <p className="text-xs text-muted-foreground mb-2">{group.sections.length} seções incluídas</p>
                                                                <div className="flex flex-wrap gap-1">
                                                                    {group.sections.slice(0, 3).map(s => (
                                                                        <Badge key={s} variant="secondary" className="px-1.5 py-0 text-[10px] font-normal text-muted-foreground bg-muted/50 border-0">
                                                                            {s}
                                                                        </Badge>
                                                                    ))}
                                                                    {group.sections.length > 3 && (
                                                                        <span className="text-[10px] text-muted-foreground px-1 self-center">+{group.sections.length - 3}</span>
                                                                    )}
                                                                </div>
                                                            </div>
                                                        </div>
                                                    ))
                                                )}
                                            </div>
                                        </div>
                                    )}
                                </div>
                            )}
                        </CardContent>
                        <div className="flex justify-between p-6 border-t bg-muted/10">
                            <Button variant="outline" onClick={handleSectionsBack}>← Voltar</Button>
                            <Button
                                onClick={handleSectionsNext}
                                disabled={
                                    (sectionMode === "individual" && selectedSections.length === 0) ||
                                    (sectionMode === "group" && !selectedGroupId) ||
                                    showCreateGroupDialog || showEditGroupDialog
                                }
                            >
                                Continuar →
                            </Button>
                        </div>
                    </Card>
                )}

                {/* Step Content: Summary */}
                {currentStep === "summary" && (
                    <Card>
                        <CardHeader>
                            <CardTitle>Resumo e Geração</CardTitle>
                            <CardDescription>Confira os dados antes de gerar o PDF final</CardDescription>
                        </CardHeader>
                        <CardContent className="space-y-6">
                            <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                                <div className="space-y-2">
                                    <h4 className="font-medium text-sm text-muted-foreground uppercase">Pontos de Retirada</h4>
                                    <div className="p-4 bg-muted/30 rounded-lg border">
                                        {selectAllPickupPoints ? (
                                            <div className="flex items-center gap-2"><Badge>Todos</Badge> <span className="text-sm">Todos os pontos selecionados</span></div>
                                        ) : (
                                            <div className="flex flex-col gap-2">
                                                {selectedPickupPoints.map(point => (
                                                    <div key={point} className="flex items-center gap-2">
                                                        <div className="w-2 h-2 rounded-full bg-primary" />
                                                        <span className="text-sm font-medium">Ponto {point}</span>
                                                    </div>
                                                ))}
                                            </div>
                                        )}
                                    </div>
                                </div>

                                <div className="space-y-2">
                                    <h4 className="font-medium text-sm text-muted-foreground uppercase">Pedidos Selecionados</h4>
                                    <div className="p-4 bg-muted/30 rounded-lg border">
                                        <div className="flex items-baseline gap-2 mb-2">
                                            <span className="text-3xl font-bold">{selectedOrders.length}</span>
                                            <span className="text-sm text-muted-foreground">pedidos</span>
                                        </div>
                                        <p className="text-xs text-muted-foreground">
                                            Clique em voltar para ver a lista detalhada.
                                        </p>
                                    </div>
                                </div>

                                <div className="space-y-2">
                                    <h4 className="font-medium text-sm text-muted-foreground uppercase">Organização</h4>
                                    <div className="p-4 bg-muted/30 rounded-lg border h-full">
                                        {sectionMode === "individual" ? (
                                            <div>
                                                <div className="flex items-center gap-2 mb-2">
                                                    <Badge variant="outline" className="bg-background">Seção Individual</Badge>
                                                </div>
                                                <p className="text-sm font-medium">{selectedSections.length} seções selecionadas</p>
                                            </div>
                                        ) : (
                                            <div>
                                                <div className="flex items-center gap-2 mb-2">
                                                    <Badge variant="outline" className="bg-background">Agrupado</Badge>
                                                </div>
                                                <p className="text-sm font-medium">{groups.find(g => g.id === selectedGroupId)?.name}</p>
                                                <p className="text-xs text-muted-foreground mt-1">
                                                    {groups.find(g => g.id === selectedGroupId)?.sections.length} seções incluídas
                                                </p>
                                            </div>
                                        )}
                                    </div>
                                </div>
                            </div>

                            <div className="flex items-center gap-3 p-4 bg-yellow-50 border border-yellow-200 rounded-lg text-yellow-800 text-sm">
                                <FileDown className="h-5 w-5" />
                                <p>O relatório será gerado em formato PDF e aberto em uma nova aba do navegador.</p>
                            </div>
                        </CardContent>
                        <div className="flex justify-between p-6 border-t bg-muted/10">
                            <Button variant="outline" onClick={handleSummaryBack}>← Voltar</Button>
                            <Button
                                onClick={handleGeneratePDF}
                                disabled={isGenerating}
                                className="min-w-[200px]"
                                size="lg"
                            >
                                {isGenerating ? (
                                    <>
                                        <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                                        Gerando Relatório...
                                    </>
                                ) : (
                                    <>
                                        <FileDown className="mr-2 h-5 w-5" />
                                        Gerar PDF Agora
                                    </>
                                )}
                            </Button>
                        </div>
                    </Card>
                )}
            </div>
        </div>
    );
}
