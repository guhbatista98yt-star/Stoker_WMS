import {
    Dialog,
    DialogContent,
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
import { useQuery } from "@tanstack/react-query";
import { Loader2 } from "lucide-react";
import type { OrderWithItems } from "@shared/schema";

interface OrderDetailsDialogProps {
    orderId: string | null;
    open: boolean;
    onOpenChange: (open: boolean) => void;
}

export function OrderDetailsDialog({
    orderId,
    open,
    onOpenChange,
}: OrderDetailsDialogProps) {
    const { data: order, isLoading } = useQuery<OrderWithItems>({
        queryKey: [`/api/orders/${orderId}`],
        enabled: !!orderId && open,
    });

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent className="max-w-3xl max-h-[80vh] overflow-y-auto">
                <DialogHeader>
                    <DialogTitle>Detalhes do Pedido {order?.erpOrderId}</DialogTitle>
                </DialogHeader>

                {isLoading ? (
                    <div className="flex justify-center p-8">
                        <Loader2 className="h-8 w-8 animate-spin text-primary" />
                    </div>
                ) : order ? (
                    <div className="space-y-6">
                        <div className="grid grid-cols-2 gap-4 text-sm">
                            <div>
                                <p className="font-medium text-muted-foreground">Cliente</p>
                                <p>{order.customerName}</p>
                            </div>
                            <div>
                                <p className="font-medium text-muted-foreground">Valor Total</p>
                                <p>
                                    R$ {Number(order.totalValue).toLocaleString("pt-BR", {
                                        minimumFractionDigits: 2,
                                    })}
                                </p>
                            </div>
                        </div>

                        <div className="border rounded-md">
                            <Table>
                                <TableHeader>
                                    <TableRow>
                                        <TableHead>Código</TableHead>
                                        <TableHead>Produto</TableHead>
                                        <TableHead>Fornecedor</TableHead>
                                        <TableHead>Seção</TableHead>
                                        <TableHead>Qtd</TableHead>
                                        <TableHead>Status</TableHead>
                                    </TableRow>
                                </TableHeader>
                                <TableBody>
                                    {order.items.map((item) => (
                                        <TableRow key={item.id}>
                                            <TableCell className="font-mono text-xs">
                                                {item.product.erpCode}
                                            </TableCell>
                                            <TableCell>{item.product.name}</TableCell>
                                            <TableCell className="text-xs text-muted-foreground">{item.product.manufacturer || '-'}</TableCell>
                                            <TableCell>{item.section}</TableCell>
                                            <TableCell>
                                                <div className="flex flex-col">
                                                    <span>{item.quantity} {item.product.unit}</span>
                                                    {(item as any).exceptionQty > 0 && (
                                                        <span className="text-amber-600 text-xs font-medium">
                                                            Exceção: {(item as any).exceptionQty}
                                                        </span>
                                                    )}
                                                </div>
                                            </TableCell>
                                            <TableCell>
                                                <div className="flex flex-col gap-1">
                                                    <span className="capitalize text-xs">{item.status}</span>
                                                    {(item as any).exceptionQty > 0 && (
                                                        <span className="text-amber-600 text-[10px] px-1 py-0.5 bg-amber-50 rounded-full w-fit">
                                                            Com Exceção
                                                        </span>
                                                    )}
                                                </div>
                                            </TableCell>
                                        </TableRow>
                                    ))}
                                </TableBody>
                            </Table>
                        </div>
                    </div>
                ) : (
                    <div className="text-center p-4">Pedido não encontrado</div>
                )}
            </DialogContent>
        </Dialog>
    );
}
