import { useQuery } from "@tanstack/react-query";
import { useSessionQueryKey } from "@/lib/auth";
import { GradientHeader } from "@/components/ui/gradient-header";
import { SectionCard } from "@/components/ui/section-card";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Link } from "wouter";
import { ArrowLeft, AlertTriangle, FileWarning } from "lucide-react";
import { format } from "date-fns";
import { ptBR } from "date-fns/locale";
import type { Exception, OrderItem, Product, User, WorkUnit } from "@shared/schema";

type ExceptionWithDetails = Exception & {
  orderItem: OrderItem & { product: Product };
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

  const { data: exceptions, isLoading } = useQuery<ExceptionWithDetails[]>({
    queryKey: exceptionsQueryKey,
  });

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
        <SectionCard
          title="Exceções Pendentes"
          icon={<AlertTriangle className="h-4 w-4 text-destructive" />}
        >
          {isLoading ? (
            <div className="space-y-2">
              {Array.from({ length: 5 }).map((_, i) => (
                <Skeleton key={i} className="h-12 w-full" />
              ))}
            </div>
          ) : exceptions && exceptions.length > 0 ? (
            <div className="overflow-x-auto -mx-6">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Data/Hora</TableHead>
                    <TableHead>Produto</TableHead>
                    <TableHead>Tipo</TableHead>
                    <TableHead>Quantidade</TableHead>
                    <TableHead>Reportado Por</TableHead>
                    <TableHead>Observação</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {exceptions.map((exception) => {
                    const typeConfig = exceptionTypeLabels[exception.type] || {
                      label: exception.type,
                      color: "bg-gray-100 text-gray-700",
                    };
                    return (
                      <TableRow key={exception.id} data-testid={`row-exception-${exception.id}`}>
                        <TableCell className="text-sm">
                          {format(new Date(exception.createdAt), "dd/MM/yyyy HH:mm", {
                            locale: ptBR,
                          })}
                        </TableCell>
                        <TableCell>
                          <div>
                            <p className="font-medium">{exception.orderItem?.product?.name || "-"}</p>
                            <p className="text-xs text-muted-foreground font-mono">
                              {exception.orderItem?.product?.barcode || "-"}
                            </p>
                          </div>
                        </TableCell>
                        <TableCell>
                          <Badge variant="outline" className={`${typeConfig.color} border-0`}>
                            {typeConfig.label}
                          </Badge>
                        </TableCell>
                        <TableCell className="font-medium">
                          {Number(exception.quantity)} {exception.orderItem?.product?.unit || "UN"}
                        </TableCell>
                        <TableCell>{exception.reportedByUser?.name || "-"}</TableCell>
                        <TableCell className="max-w-[200px]">
                          <p className="text-sm text-muted-foreground truncate">
                            {exception.observation || "-"}
                          </p>
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
              <p className="text-sm">Todas as operações estão normais</p>
            </div>
          )}
        </SectionCard>
      </main>
    </div>
  );
}
