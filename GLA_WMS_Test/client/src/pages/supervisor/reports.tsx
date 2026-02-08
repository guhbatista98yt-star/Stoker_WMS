import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { FileText, Package, ArrowLeft } from "lucide-react";
import { useLocation, Link } from "wouter";
import { GradientHeader } from "@/components/ui/gradient-header";
import { SectionCard } from "@/components/ui/section-card";

export default function Reports() {
    const [, setLocation] = useLocation();

    return (
        <div className="min-h-screen bg-background">
            <GradientHeader>
                <div className="flex items-center justify-between w-full">
                    <div>
                        <h1 className="text-3xl font-bold text-white">Relatórios</h1>
                        <p className="text-white/80">Gere relatórios personalizados do sistema</p>
                    </div>
                    <Link href="/supervisor">
                        <Button variant="ghost" className="text-white hover:bg-white/10">
                            <ArrowLeft className="h-4 w-4 mr-2" />
                            Voltar
                        </Button>
                    </Link>
                </div>
            </GradientHeader>

            <div className="p-6">
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                    <div
                        className="cursor-pointer"
                        onClick={() => setLocation("/supervisor/reports/picking-list")}
                    >
                        <SectionCard className="hover:shadow-lg transition-shadow">
                            <CardHeader>
                                <div className="flex items-center gap-2">
                                    <Package className="h-5 w-5 text-primary" />
                                    <CardTitle>Romaneio de Separação</CardTitle>
                                </div>
                                <CardDescription>
                                    Gere romaneios de separação por ponto de retirada e local de estoque
                                </CardDescription>
                            </CardHeader>
                            <CardContent>
                                <Button className="w-full">
                                    <FileText className="mr-2 h-4 w-4" />
                                    Gerar Relatório
                                </Button>
                            </CardContent>
                        </SectionCard>
                    </div>
                </div>
            </div>
        </div>
    );
}
