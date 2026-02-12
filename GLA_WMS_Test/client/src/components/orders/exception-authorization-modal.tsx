import { useState } from "react";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";
import type { Exception, Product } from "@shared/schema";

interface ExceptionWithDetails extends Exception {
    orderItem: {
        product: Product;
        order: {
            erpOrderId: string;
        };
    };
}

interface ExceptionAuthorizationModalProps {
    open: boolean;
    onClose: () => void;
    exceptions: ExceptionWithDetails[];
    onAuthorized: () => void;
}

const exceptionTypeLabels: Record<string, string> = {
    nao_encontrado: "Não Encontrado",
    avariado: "Avariado",
    vencido: "Vencido",
};

export function ExceptionAuthorizationModal({
    open,
    onClose,
    exceptions,
    onAuthorized
}: ExceptionAuthorizationModalProps) {
    const [username, setUsername] = useState("");
    const [password, setPassword] = useState("");
    const [isLoading, setIsLoading] = useState(false);
    const [error, setError] = useState("");
    const { toast } = useToast();

    const handleAuthorize = async () => {
        try {
            setIsLoading(true);
            setError("");

            if (!username.trim() || !password.trim()) {
                setError("Preencha usuário e senha");
                return;
            }

            const exceptionIds = exceptions.map(e => e.id);
            const res = await apiRequest("POST", "/api/exceptions/authorize", {
                username: username.trim(),
                password,
                exceptionIds,
            });

            if (res.ok) {
                const data = await res.json();
                toast({
                    title: "Exceções Autorizadas",
                    description: `Por ${data.authorizedByName}`,
                });
                onAuthorized();
                onClose();
                // Reset form
                setUsername("");
                setPassword("");
            } else {
                const data = await res.json();
                setError(data.error || "Erro ao autorizar exceções");
            }
        } catch (err) {
            setError("Erro de conexão");
        } finally {
            setIsLoading(false);
        }
    };

    const handleClose = () => {
        setUsername("");
        setPassword("");
        setError("");
        onClose();
    };

    // Group exceptions by product
    const groupedExceptions = exceptions.reduce((acc, exc) => {
        const productId = exc.orderItem.product.id;
        if (!acc[productId]) {
            acc[productId] = {
                product: exc.orderItem.product,
                exceptions: [],
                totalQty: 0,
                orderCodes: new Set<string>(),
            };
        }
        acc[productId].exceptions.push(exc);
        acc[productId].totalQty += Number(exc.quantity);
        acc[productId].orderCodes.add(exc.orderItem.order.erpOrderId);
        return acc;
    }, {} as Record<string, {
        product: Product;
        exceptions: ExceptionWithDetails[];
        totalQty: number;
        orderCodes: Set<string>;
    }>);

    const groupedList = Object.values(groupedExceptions);

    return (
        <Dialog open={open} onOpenChange={(isOpen) => !isOpen && handleClose()}>
            <DialogContent className="max-w-2xl">
                <DialogHeader>
                    <DialogTitle>Autorização de Exceções</DialogTitle>
                    <DialogDescription>
                        {exceptions.length} exceção(ões) detectada(s).
                        Supervisor ou Administrador deve autorizar para continuar.
                    </DialogDescription>
                </DialogHeader>

                {/* Lista de Exceções */}
                <div className="max-h-[300px] overflow-y-auto border rounded-lg p-3 space-y-2">
                    {groupedList.map(group => (
                        <div key={group.product.id} className="p-2.5 bg-muted/40 rounded-lg">
                            <p className="font-medium text-sm mb-1.5">{group.product.name}</p>
                            <div className="grid grid-cols-2 gap-x-3 gap-y-1 text-xs text-muted-foreground">
                                <div>
                                    <span className="font-medium">Pedido(s):</span> {Array.from(group.orderCodes).join(", ")}
                                </div>
                                <div>
                                    <span className="font-medium">Qtd Total:</span> {group.totalQty}
                                </div>
                                {group.exceptions.map((exc, idx) => (
                                    <div key={exc.id} className="col-span-2 text-xs mt-1 pl-2 border-l-2 border-orange-300">
                                        <div><span className="font-medium">Motivo:</span> {exceptionTypeLabels[exc.type] || exc.type}</div>
                                        {exc.observation && <div><span className="font-medium">Obs:</span> {exc.observation}</div>}
                                    </div>
                                ))}
                            </div>
                        </div>
                    ))}
                </div>

                {/* Form de Autenticação */}
                <div className="space-y-3 pt-2">
                    <div>
                        <label className="text-sm font-medium mb-1.5 block">Usuário (Supervisor/Admin)</label>
                        <Input
                            placeholder="Digite o usuário"
                            value={username}
                            onChange={(e) => setUsername(e.target.value)}
                            disabled={isLoading}
                            onKeyDown={(e) => e.key === "Enter" && handleAuthorize()}
                        />
                    </div>
                    <div>
                        <label className="text-sm font-medium mb-1.5 block">Senha</label>
                        <Input
                            type="password"
                            placeholder="Digite a senha"
                            value={password}
                            onChange={(e) => setPassword(e.target.value)}
                            disabled={isLoading}
                            onKeyDown={(e) => e.key === "Enter" && handleAuthorize()}
                        />
                    </div>
                </div>

                {error && (
                    <Alert variant="destructive">
                        <AlertDescription>{error}</AlertDescription>
                    </Alert>
                )}

                <DialogFooter>
                    <Button variant="outline" onClick={handleClose} disabled={isLoading}>
                        Cancelar
                    </Button>
                    <Button onClick={handleAuthorize} disabled={isLoading || !username.trim() || !password.trim()}>
                        {isLoading ? "Autorizando..." : "Autorizar Exceções"}
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
}
