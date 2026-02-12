import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useSessionQueryKey } from "@/lib/auth";
import { GradientHeader } from "@/components/ui/gradient-header";
import { SectionCard } from "@/components/ui/section-card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
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
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { DatePickerWithRange } from "@/components/ui/date-range-picker";
import { DateRange } from "react-day-picker";
import { Link } from "wouter";
import { ArrowLeft, AlertTriangle, FileWarning, Search, Calendar } from "lucide-react";
import { format } from "date-fns";
import { ptBR } from "date-fns/locale";
import type { Exception, OrderItem, Product, User, WorkUnit, Order } from "@shared/schema";

type ExceptionWithDetails = Exception & {
  orderItem: OrderItem & {
    product: Product;
    order: Order;
  };
  reportedByUser: User;
  workUnit: WorkUnit;
};

const exceptionTypeLabels: Record<string, { label: string; color: string }> = {
  nao_encontrado: { label: "Não Encontrado", color: "bg-yellow-100 text-yellow-700" },
  avariado: { label: "Avariado", color: "bg-red-100 text-red-700" },
  vencido: { label: "Vencido", color: "bg-orange-100 text-orange-700" },
};

export default function ExceptionsPage() {
  const exceptionsQueryKey = useSessionQueryKey(["/api/exceptions"]);

  const [filterDateRange, setFilterDateRange] = useState<DateRange | undefined>();
  const [tempDateRange, setTempDateRange] = useState<DateRange | undefined>();
  const [searchOrderQuery, setSearchOrderQuery] = useState("");
  const [selectedExceptionType, setSelectedExceptionType] = useState<string>("all");

  const { data: exceptions, isLoading } = useQuery<ExceptionWithDetails[]>({
    queryKey: exceptionsQueryKey,
  });

  // Lógica de filtro
  const filteredExceptions = exceptions?.filter((exception) => {
    // Filtro de Data
    if (filterDateRange?.from) {
      const exceptionDate = new Date(exception.createdAt);
      if (exceptionDate < filterDateRange.from) return false;
      if (filterDateRange.to) {
        const endOfDay = new Date(filterDateRange.to);
        endOfDay.setHours(23, 59, 59, 999);
        if (exceptionDate > endOfDay) return false;
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

    // Filtro de Pedido (Múltiplos pedidos com vírgula)
    if (searchOrderQuery) {
      const orderMatch = processMultipleOrderSearch(searchOrderQuery, exception.orderItem?.order?.erpOrderId || '');
      if (!orderMatch) return false;
    }

    // Filtro de Motivo/Tipo
    if (selectedExceptionType !== "all") {
      if (exception.type !== selectedExceptionType) return false;
    }

    return true;
  }) || [];

  return (
    <div className="min-h-screen bg-background">
      <GradientHeader title="Exceções" subtitle="Itens com problemas reportados">
        <Link href="/supervisor">
          <Button
            variant="outline"
            size="sm"
            className="bg-white/10 border-white/20 text-white hover:bg-white/20"
            data-testid="button-back"
          >
            <ArrowLeft className="h-4 w-4 mr-2" />
            Voltar
          </Button>
        </Link>
      </GradientHeader>

      <main className="max-w-7xl mx-auto px-4 py-6 space-y-4">
        {/* Filtros */}
        <div className="bg-card p-4 rounded-lg border shadow-sm space-y-4">
          <div className="flex flex-col md:flex-row gap-4">
            {/* Filtro de Data */}
            <div className="flex items-center gap-2">
              <Calendar className="h-4 w-4 text-muted-foreground" />
              <DatePickerWithRange date={tempDateRange} onDateChange={setTempDateRange} />
              <Button variant="secondary" onClick={() => setFilterDateRange(tempDateRange)}>
                Buscar
              </Button>
            </div>

            {/* Filtro de Pedido */}
            <div className="relative w-full md:w-64">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input
                placeholder="Buscar Pedido (separe múltiplos por vírgula)"
                value={searchOrderQuery}
                onChange={(e) => setSearchOrderQuery(e.target.value)}
                className="pl-9"
              />
            </div>

            {/* Filtro de Motivo */}
            <Select value={selectedExceptionType} onValueChange={setSelectedExceptionType}>
              <SelectTrigger className="w-[180px]">
                <SelectValue placeholder="Motivo" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Todos os Motivos</SelectItem>
                <SelectItem value="nao_encontrado">Não Encontrado</SelectItem>
                <SelectItem value="avariado">Avariado</SelectItem>
                <SelectItem value="vencido">Vencido</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>

        <SectionCard
          title={`Exceções Pendentes (${filteredExceptions.length})`}
          icon={<AlertTriangle className="h-4 w-4 text-destructive" />}
        >
          {isLoading ? (
            <div className="space-y-2">
              {Array.from({ length: 5 }).map((_, i) => (
                <Skeleton key={i} className="h-12 w-full" />
              ))}
            </div>
          ) : filteredExceptions && filteredExceptions.length > 0 ? (
            <div className="overflow-x-auto -mx-6">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Pedido</TableHead>
                    <TableHead>Data/Hora</TableHead>
                    <TableHead>Código</TableHead>
                    <TableHead>Descrição</TableHead>
                    <TableHead>Quantidade</TableHead>
                    <TableHead>Motivo</TableHead>
                    <TableHead>Reportado Por</TableHead>
                    <TableHead>Observação</TableHead>
                    <TableHead>Autorizado Por</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filteredExceptions.map((exception) => {
                    const typeConfig = exceptionTypeLabels[exception.type] || {
                      label: exception.type,
                      color: "bg-gray-100 text-gray-700",
                    };
                    return (
                      <TableRow key={exception.id} data-testid={`row-exception-${exception.id}`}>
                        {/* Pedido */}
                        <TableCell className="font-mono font-medium">
                          {exception.orderItem?.order?.erpOrderId || "-"}
                        </TableCell>

                        {/* Data/Hora */}
                        <TableCell className="text-sm whitespace-nowrap">
                          {format(new Date(exception.createdAt), "dd/MM/yyyy HH:mm", {
                            locale: ptBR,
                          })}
                        </TableCell>

                        {/* Código (Barcode) */}
                        <TableCell className="font-mono text-xs">
                          {exception.orderItem?.product?.barcode || "-"}
                        </TableCell>

                        {/* Descrição */}
                        <TableCell className="max-w-[250px]">
                          <p className="font-medium truncate" title={exception.orderItem?.product?.name || "-"}>
                            {exception.orderItem?.product?.name || "-"}
                          </p>
                        </TableCell>

                        {/* Quantidade */}
                        <TableCell className="font-medium">
                          {Number(exception.quantity)} {exception.orderItem?.product?.unit || "UN"}
                        </TableCell>

                        {/* Motivo */}
                        <TableCell>
                          <Badge variant="outline" className={`${typeConfig.color} border-0`}>
                            {typeConfig.label}
                          </Badge>
                        </TableCell>

                        {/* Reportado Por */}
                        <TableCell>{exception.reportedByUser?.name || "-"}</TableCell>

                        {/* Observação */}
                        <TableCell className="max-w-[200px]">
                          <p className="text-sm text-muted-foreground truncate">
                            {exception.observation || "-"}
                          </p>
                        </TableCell>

                        {/* Autorizado Por */}
                        <TableCell>
                          {exception.authorizedByName ? (
                            <div className="flex items-center gap-1 text-sm">
                              <span className="text-green-600">✓</span>
                              <span>{exception.authorizedByName}</span>
                            </div>
                          ) : (
                            <span className="text-xs text-muted-foreground">Pendente</span>
                          )}
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </div>
          ) : (
            <div className="text-center py-12 text-muted-foreground">
              <FileWarning className="h-16 w-16 mx-auto mb-4 opacity-40" />
              <p className="text-lg font-medium">Nenhuma exceção registrada</p>
              <p className="text-sm">
                {exceptions && exceptions.length > 0
                  ? "Nenhuma exceção encontrada com os filtros aplicados"
                  : "Todas as operações estão normais"}
              </p>
            </div>
          )}
        </SectionCard>
      </main>
    </div>
  );
}
