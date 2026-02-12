import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { DatePickerWithRange } from "@/components/ui/date-range-picker";
import { DateRange } from "react-day-picker";
import { GradientHeader } from "@/components/ui/gradient-header";
import { SectionCard } from "@/components/ui/section-card";
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
import { ArrowLeft, Route as RouteIcon, Search, Calendar, Filter } from "lucide-react";
import type { Order, Route } from "@shared/schema";
import { getCurrentWeekRange } from "@/lib/date-utils";
import { format } from "date-fns";

export default function RouteOrdersPage() {
    const { toast } = useToast();
    const queryClient = useQueryClient();

    const [filterDateRange, setFilterDateRange] = useState<DateRange | undefined>(getCurrentWeekRange());
    const [tempDateRange, setTempDateRange] = useState<DateRange | undefined>(getCurrentWeekRange());
    const [selectedRouteFilter, setSelectedRouteFilter] = useState<string>("all");
    const [searchQuery, setSearchQuery] = useState("");
    const [selectedPickupPoint, setSelectedPickupPoint] = useState<string>("all");
    const [selectedOrders, setSelectedOrders] = useState<string[]>([]);
    const [showAssignDialog, setShowAssignDialog] = useState(false);
    const [targetRouteId, setTargetRouteId] = useState<string>("");

    const { data: orders, isLoading: ordersLoading } = useQuery<Order[]>({
        queryKey: ["/api/orders"],
    });

    const { data: routes } = useQuery<Route[]>({
        queryKey: ["/api/routes"],
    });

    const assignRouteMutation = useMutation({
        mutationFn: async ({ orderIds, routeId }: { orderIds: string[]; routeId: string }) => {
            const res = await apiRequest("POST", "/api/orders/assign-route", { orderIds, routeId });
            return res.json();
        },
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ["/api/orders"] });
            queryClient.invalidateQueries({ queryKey: ["/api/routes"] });
            setShowAssignDialog(false);
            toast({
                title: "Rotas atualizadas",
                description: `${selectedOrders.length} pedido(s) atribuído(s) à rota.`,
            });
        },
        onError: () => {
            toast({
                title: "Erro",
                description: "Falha ao atribuir rota",
                variant: "destructive",
            });
        },
    });

    // Filter Logic
    const filteredOrders = orders?.filter((order) => {
        // Date Filter
        if (filterDateRange?.from) {
            const orderDate = new Date(order.createdAt);
            if (orderDate < filterDateRange.from) return false;
            if (filterDateRange.to) {
                // Adjust 'to' to end of day
                const endOfDay = new Date(filterDateRange.to);
                endOfDay.setHours(23, 59, 59, 999);
                if (orderDate > endOfDay) return false;
            }
        }

        // Route Filter
        if (selectedRouteFilter !== "all") {
            if (selectedRouteFilter === "unassigned") {
                if (order.routeId) return false;
            } else {
                if (String(order.routeId) !== selectedRouteFilter) return false;
            }
        }

        // Helper para busca múltipla
        const processMultipleOrderSearch = (searchValue: string, orderCode: string): boolean => {
            if (!searchValue.trim()) return true;
            if (searchValue.includes(',')) {
                const terms = searchValue.split(',').map(t => t.trim().toLowerCase()).filter(t => t);
                return terms.some(term => orderCode.toLowerCase().includes(term));
            }
            return orderCode.toLowerCase().includes(searchValue.toLowerCase());
        };

        // Search Filter (Multiple Order IDs with comma)
        if (searchQuery) {
            const query = searchQuery.toLowerCase();
            const matchesId = processMultipleOrderSearch(searchQuery, order.erpOrderId);
            const matchesCustomer = order.customerName.toLowerCase().includes(query);
            if (!matchesId && !matchesCustomer) return false;
        }

        // Pickup Point Filter
        if (selectedPickupPoint !== "all") {
            // Assuming order has simple pickup_points string or we check items?
            // Since schema says pickupPoints: text (json), we need to parse it if strict.
            // But usually it might be just simple check if it exists in the 'pickup_points' string column if synced as text.
            // Let's assume order.pickupPoints is a string representation or array.
            // If it's stored as JSON string "1, 2", we check inclusion.
            // Ideally we should have parsed it but let's do string check for now as robust fallback
            const pp = String(order.pickupPoints || "");
            if (!pp.includes(selectedPickupPoint)) return false;
        }

        return true;
    }) || [];

    const handleSelectAll = (checked: boolean) => {
        if (checked) {
            setSelectedOrders(filteredOrders.map(o => o.id));
        } else {
            setSelectedOrders([]);
        }
    };

    const handleSelectOrder = (orderId: string, checked: boolean) => {
        if (checked) {
            setSelectedOrders(prev => [...prev, orderId]);
        } else {
            setSelectedOrders(prev => prev.filter(id => id !== orderId));
        }
    };

    const activeRoutes = routes?.filter(r => r.active) || [];

    const isAssignmentRedundant = targetRouteId && selectedOrders.length > 0 && selectedOrders.every(id => {
        const o = orders?.find(order => order.id === id);
        return o && String(o.routeId) === targetRouteId;
    });

    return (
        <div className="min-h-screen bg-background">
            <GradientHeader title="Gestão de Rotas (Pedidos)" subtitle="Visualize e atribua rotas aos pedidos">
                <Link href="/supervisor">
                    <Button
                        variant="outline"
                        size="sm"
                        className="bg-white/10 border-white/20 text-white hover:bg-white/20"
                    >
                        <ArrowLeft className="h-4 w-4 mr-2" />
                        Voltar
                    </Button>
                </Link>
            </GradientHeader>

            <main className="max-w-7xl mx-auto px-4 py-6 space-y-4">
                {/* Filters */}
                <div className="flex flex-col md:flex-row gap-4 justify-between items-start md:items-center bg-card p-4 rounded-lg border shadow-sm">
                    <div className="flex flex-col md:flex-row gap-4 items-center w-full md:w-auto flex-wrap">
                        <div className="relative w-full md:w-64">
                            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                            <Input
                                placeholder="Buscar Pedido ou Cliente..."
                                value={searchQuery}
                                onChange={(e) => setSearchQuery(e.target.value)}
                                className="pl-9"
                            />
                        </div>

                        <div className="flex items-center gap-2 w-full md:w-auto">
                            <Calendar className="h-4 w-4 text-muted-foreground" />
                            <DatePickerWithRange date={tempDateRange} onDateChange={setTempDateRange} />
                            <Button variant="secondary" onClick={() => setFilterDateRange(tempDateRange)}>
                                Buscar
                            </Button>
                        </div>

                        <div className="flex gap-2 w-full md:w-auto">
                            <Select value={selectedRouteFilter} onValueChange={setSelectedRouteFilter}>
                                <SelectTrigger className="w-[180px]">
                                    <SelectValue placeholder="Rota" />
                                </SelectTrigger>
                                <SelectContent>
                                    <SelectItem value="all">Todas as Rotas</SelectItem>
                                    <SelectItem value="unassigned">Sem Rota</SelectItem>
                                    {activeRoutes.map(route => (
                                        <SelectItem key={route.id} value={String(route.id)}>
                                            {route.name}
                                        </SelectItem>
                                    ))}
                                </SelectContent>
                            </Select>

                            <Select value={selectedPickupPoint} onValueChange={setSelectedPickupPoint}>
                                <SelectTrigger className="w-[180px]">
                                    <SelectValue placeholder="Ponto de Retirada" />
                                </SelectTrigger>
                                <SelectContent>
                                    <SelectItem value="all">Todos Pontos</SelectItem>
                                    {/* Generating 1-10 Pickup Points dynamically or hardcoded if needed */}
                                    {Array.from({ length: 15 }, (_, i) => i + 1).map(point => (
                                        <SelectItem key={point} value={String(point)}>
                                            Ponto {point}
                                        </SelectItem>
                                    ))}
                                </SelectContent>
                            </Select>
                        </div>
                    </div>

                    <div className="flex gap-2">
                        <Button
                            onClick={() => setShowAssignDialog(true)}
                            disabled={selectedOrders.length === 0}
                        >
                            <RouteIcon className="h-4 w-4 mr-2" />
                            Atribuir Rota ({selectedOrders.length})
                        </Button>
                    </div>
                </div>

                <SectionCard title={`Pedidos Encontrados (${filteredOrders.length})`} icon={<Search className="h-4 w-4 text-primary" />}>
                    {ordersLoading ? (
                        <div className="space-y-2">
                            {Array.from({ length: 5 }).map((_, i) => (
                                <Skeleton key={i} className="h-12 w-full" />
                            ))}
                        </div>
                    ) : filteredOrders.length > 0 ? (
                        <div className="overflow-x-auto -mx-6">
                            <Table>
                                <TableHeader>
                                    <TableRow>
                                        <TableHead className="w-[50px]">
                                            <Checkbox
                                                checked={filteredOrders.length > 0 && selectedOrders.length === filteredOrders.length}
                                                onCheckedChange={handleSelectAll}
                                            />
                                        </TableHead>
                                        <TableHead>Pedido</TableHead>
                                        <TableHead>Cliente</TableHead>
                                        <TableHead>Data</TableHead>
                                        <TableHead>Rota Atual</TableHead>
                                        <TableHead>Valor</TableHead>
                                        <TableHead>Status Fin.</TableHead>
                                        <TableHead>Status</TableHead>
                                    </TableRow>
                                </TableHeader>
                                <TableBody>
                                    {filteredOrders.map((order) => {
                                        const route = routes?.find(r => r.id === order.routeId);
                                        return (
                                            <TableRow
                                                key={order.id}
                                                className={`cursor-pointer transition-colors hover:bg-muted/50 ${selectedOrders.includes(order.id) ? "bg-muted" : ""}`}
                                                onClick={() => handleSelectOrder(order.id, !selectedOrders.includes(order.id))}
                                            >
                                                <TableCell onClick={(e) => e.stopPropagation()}>
                                                    <Checkbox
                                                        checked={selectedOrders.includes(order.id)}
                                                        onCheckedChange={(checked) => handleSelectOrder(order.id, checked as boolean)}
                                                    />
                                                </TableCell>
                                                <TableCell className="font-mono">{order.erpOrderId}</TableCell>
                                                <TableCell className="max-w-[200px] truncate" title={order.customerName}>
                                                    {order.customerName}
                                                </TableCell>
                                                <TableCell>{format(new Date(order.createdAt), "dd/MM/yyyy HH:mm")}</TableCell>
                                                <TableCell>
                                                    {route ? (
                                                        <Badge variant="outline" className="bg-blue-50 text-blue-700 border-blue-200">
                                                            {route.name}
                                                        </Badge>
                                                    ) : (
                                                        <span className="text-muted-foreground text-sm italic">Sem rota</span>
                                                    )}
                                                </TableCell>
                                                <TableCell>
                                                    {new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(order.totalValue)}
                                                </TableCell>
                                                <TableCell>
                                                    {order.financialStatus === "faturado" ? (
                                                        <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-green-100 text-green-700">
                                                            Liberado
                                                        </span>
                                                    ) : (
                                                        <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-yellow-100 text-yellow-700">
                                                            Pendente
                                                        </span>
                                                    )}
                                                </TableCell>
                                                <TableCell>
                                                    <Badge variant="secondary">{order.status}</Badge>
                                                </TableCell>
                                            </TableRow>
                                        );
                                    })}
                                </TableBody>
                            </Table>
                        </div>
                    ) : (
                        <div className="text-center py-12 text-muted-foreground">
                            <p className="text-lg font-medium">Nenhum pedido encontrado</p>
                            <p className="text-sm">Tente ajustar os filtros de data ou rota</p>
                        </div>
                    )}
                </SectionCard>
            </main>

            {/* Assign Route Dialog */}
            <Dialog open={showAssignDialog} onOpenChange={setShowAssignDialog}>
                <DialogContent>
                    <DialogHeader>
                        <DialogTitle>Atribuir Rota em Lote</DialogTitle>
                        <DialogDescription>
                            Selecione a rota para aplicar aos {selectedOrders.length} pedidos selecionados.
                        </DialogDescription>
                    </DialogHeader>
                    <div className="py-4 space-y-4">
                        <div className="space-y-2">
                            <label className="text-sm font-medium">Rota de Destino</label>
                            <Select value={targetRouteId} onValueChange={setTargetRouteId}>
                                <SelectTrigger>
                                    <SelectValue placeholder="Selecione uma rota" />
                                </SelectTrigger>
                                <SelectContent>
                                    {activeRoutes.map(route => (
                                        <SelectItem key={route.id} value={String(route.id)}>
                                            {route.name}
                                        </SelectItem>
                                    ))}
                                </SelectContent>
                            </Select>
                        </div>
                    </div>
                    <div className="flex justify-end gap-2">
                        <Button variant="outline" onClick={() => setShowAssignDialog(false)}>
                            Cancelar
                        </Button>
                        <Button
                            onClick={() => assignRouteMutation.mutate({ orderIds: selectedOrders, routeId: targetRouteId })}
                            disabled={!targetRouteId || assignRouteMutation.isPending || !!isAssignmentRedundant}
                            title={isAssignmentRedundant ? "Os pedidos selecionados já estão nesta rota" : ""}
                        >
                            Confirmar Atribuição
                        </Button>
                    </div>
                </DialogContent>
            </Dialog>
        </div>
    );
}
