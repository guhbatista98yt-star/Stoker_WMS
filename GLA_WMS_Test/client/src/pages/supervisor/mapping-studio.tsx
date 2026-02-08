import { useState, useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useAuth, useSessionQueryKey } from "@/lib/auth";
import { apiRequest } from "@/lib/queryClient";
import { GradientHeader } from "@/components/ui/gradient-header";
import { SectionCard } from "@/components/ui/section-card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";
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
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  ArrowLeft,
  Database,
  Eye,
  Save,
  CheckCircle2,
  AlertCircle,
  ArrowRightLeft,
  Loader2,
  Info,
  Zap,
} from "lucide-react";
import { Link } from "wouter";
import type { DataContractField, MappingField, Db2Mapping } from "@shared/schema";

interface DatasetInfo {
  name: string;
  label: string;
  description: string;
}

interface CacheColumn {
  name: string;
  sampleValue: any;
}

const CAST_OPTIONS = [
  { value: "", label: "Nenhum" },
  { value: "string", label: "Texto" },
  { value: "number", label: "Número" },
  { value: "divide_100", label: "Dividir por 100" },
  { value: "divide_1000", label: "Dividir por 1000" },
  { value: "boolean_T_F", label: "T/F → Sim/Não" },
];

export default function MappingStudioPage() {
  const { user } = useAuth();
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const [selectedDataset, setSelectedDataset] = useState<string>("");
  const [mappingRows, setMappingRows] = useState<MappingField[]>([]);
  const [previewOpen, setPreviewOpen] = useState(false);
  const [previewData, setPreviewData] = useState<any>(null);
  const [description, setDescription] = useState("");

  const datasetsQueryKey = useSessionQueryKey(["/api/datasets"]);
  const { data: datasets, isLoading: datasetsLoading } = useQuery<DatasetInfo[]>({
    queryKey: datasetsQueryKey,
  });

  const columnsQueryKey = useSessionQueryKey(["/api/cache-columns"]);
  const { data: cacheColumnsData } = useQuery<{ columns: CacheColumn[]; message?: string }>({
    queryKey: columnsQueryKey,
  });

  const schemaQueryKey = useSessionQueryKey([`/api/schema/${selectedDataset}`]);
  const { data: schemaData, isLoading: schemaLoading } = useQuery<{ dataset: string; fields: DataContractField[] }>({
    queryKey: schemaQueryKey,
    enabled: !!selectedDataset,
  });

  const mappingQueryKey = useSessionQueryKey([`/api/mapping/${selectedDataset}`]);
  const { data: existingMapping } = useQuery<Db2Mapping | null>({
    queryKey: mappingQueryKey,
    enabled: !!selectedDataset,
  });

  useEffect(() => {
    if (schemaData?.fields) {
      const existingFields = existingMapping?.mappingJson as MappingField[] | undefined;
      const rows: MappingField[] = schemaData.fields.map(field => {
        const existing = existingFields?.find(m => m.appField === field.appField);
        return {
          appField: field.appField,
          type: field.type,
          required: field.required,
          dbExpression: existing?.dbExpression || "",
          cast: existing?.cast || "",
          defaultValue: existing?.defaultValue || "",
        };
      });
      setMappingRows(rows);
    }
  }, [schemaData, existingMapping]);

  const saveMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", `/api/mapping/${selectedDataset}`, {
        mappingJson: mappingRows,
        description: description || `Mapping para ${selectedDataset}`,
      });
      if (!res.ok) {
        const errorData = await res.json();
        throw new Error(errorData.details?.join("; ") || errorData.error || "Erro ao salvar");
      }
      return res.json();
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: mappingQueryKey });
      toast({ title: "Salvo!", description: `Mapping v${data.version} salvo com sucesso.` });
    },
    onError: (error: Error) => {
      toast({ title: "Erro", description: error.message, variant: "destructive" });
    },
  });

  const activateMutation = useMutation({
    mutationFn: async (id: string) => {
      const res = await apiRequest("POST", `/api/mapping/${id}/activate`);
      if (!res.ok) throw new Error("Erro ao ativar");
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: mappingQueryKey });
      toast({ title: "Ativado!", description: "Mapping ativado. A próxima sincronização usará este mapeamento." });
    },
    onError: () => {
      toast({ title: "Erro", description: "Falha ao ativar mapping", variant: "destructive" });
    },
  });

  const previewMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", `/api/preview/${selectedDataset}`, {
        mappingJson: mappingRows,
      });
      if (!res.ok) throw new Error("Erro ao gerar preview");
      return res.json();
    },
    onSuccess: (data) => {
      setPreviewData(data);
      setPreviewOpen(true);
    },
    onError: () => {
      toast({ title: "Erro", description: "Falha ao gerar preview", variant: "destructive" });
    },
  });

  const updateMappingRow = (index: number, field: keyof MappingField, value: string) => {
    setMappingRows(prev => {
      const next = [...prev];
      next[index] = { ...next[index], [field]: value };
      return next;
    });
  };

  const cacheColumns = cacheColumnsData?.columns || [];

  return (
    <div className="min-h-screen bg-background">
      <GradientHeader title="Mapping Studio" subtitle="Mapeamento DB2 → Aplicação">
        <Button variant="outline" size="sm" className="bg-white/10 border-white/20 text-white hover:bg-white/20" asChild>
          <Link href="/supervisor">
            <ArrowLeft className="h-4 w-4 mr-2" />
            Voltar
          </Link>
        </Button>
      </GradientHeader>

      <main className="max-w-7xl mx-auto px-4 py-6 space-y-6">
        <SectionCard
          title="Selecionar Dataset"
          icon={<Database className="h-4 w-4 text-primary" />}
        >
          <div className="flex flex-col sm:flex-row gap-4 items-start sm:items-end">
            <div className="flex-1 w-full">
              <label className="text-sm font-medium mb-2 block text-muted-foreground">
                Escolha o dataset para configurar o mapeamento
              </label>
              {datasetsLoading ? (
                <Skeleton className="h-10 w-full" />
              ) : (
                <Select value={selectedDataset} onValueChange={setSelectedDataset}>
                  <SelectTrigger className="w-full">
                    <SelectValue placeholder="Selecione um dataset..." />
                  </SelectTrigger>
                  <SelectContent>
                    {datasets?.map(ds => (
                      <SelectItem key={ds.name} value={ds.name}>
                        <span className="font-medium">{ds.label}</span>
                        <span className="text-muted-foreground ml-2 text-xs">— {ds.description}</span>
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}
            </div>
            {existingMapping && (
              <div className="flex items-center gap-2 text-sm">
                <Badge variant="outline" className="bg-green-50 text-green-700 border-green-200">
                  <CheckCircle2 className="h-3 w-3 mr-1" />
                  Ativo v{existingMapping.version}
                </Badge>
              </div>
            )}
          </div>
        </SectionCard>

        {cacheColumns.length > 0 && (
          <SectionCard
            title="Colunas Disponíveis no Cache DB2"
            icon={<Info className="h-4 w-4 text-primary" />}
          >
            <div className="flex flex-wrap gap-2">
              {cacheColumns.map(col => (
                <Badge
                  key={col.name}
                  variant="secondary"
                  className="cursor-help font-mono text-xs"
                  title={`Exemplo: ${col.sampleValue !== null ? String(col.sampleValue) : "null"}`}
                >
                  {col.name}
                </Badge>
              ))}
            </div>
            <p className="text-xs text-muted-foreground mt-2">
              Passe o mouse sobre uma coluna para ver um valor de exemplo. Use estes nomes no campo "Expressão DB2".
            </p>
          </SectionCard>
        )}

        {selectedDataset && (
          <SectionCard
            title={`Mapeamento: ${datasets?.find(d => d.name === selectedDataset)?.label || selectedDataset}`}
            icon={<ArrowRightLeft className="h-4 w-4 text-primary" />}
            actions={
              <div className="flex gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => previewMutation.mutate()}
                  disabled={previewMutation.isPending}
                >
                  {previewMutation.isPending ? (
                    <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  ) : (
                    <Eye className="h-4 w-4 mr-2" />
                  )}
                  Testar / Preview
                </Button>
                <Button
                  size="sm"
                  onClick={() => saveMutation.mutate()}
                  disabled={saveMutation.isPending}
                >
                  {saveMutation.isPending ? (
                    <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  ) : (
                    <Save className="h-4 w-4 mr-2" />
                  )}
                  Salvar
                </Button>
              </div>
            }
          >
            {schemaLoading ? (
              <div className="space-y-2">
                {Array.from({ length: 5 }).map((_, i) => (
                  <Skeleton key={i} className="h-12 w-full" />
                ))}
              </div>
            ) : (
              <>
                <div className="mb-4">
                  <label className="text-sm font-medium text-muted-foreground">Descrição (opcional)</label>
                  <Input
                    value={description}
                    onChange={e => setDescription(e.target.value)}
                    placeholder="Ex: Mapeamento padrão DB2 CISSERP"
                    className="mt-1"
                  />
                </div>

                <div className="overflow-x-auto -mx-6">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead className="w-[180px]">Campo App</TableHead>
                        <TableHead className="w-[80px]">Tipo</TableHead>
                        <TableHead className="w-[60px]">Obrig.</TableHead>
                        <TableHead className="min-w-[200px]">Expressão DB2 (coluna)</TableHead>
                        <TableHead className="w-[160px]">Conversão</TableHead>
                        <TableHead className="w-[140px]">Valor Padrão</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {mappingRows.map((row, idx) => {
                        const contractField = schemaData?.fields.find(f => f.appField === row.appField);
                        return (
                          <TableRow key={row.appField}>
                            <TableCell>
                              <div>
                                <span className="font-mono text-sm font-medium">{row.appField}</span>
                                {contractField && (
                                  <p className="text-xs text-muted-foreground mt-0.5">{contractField.description}</p>
                                )}
                              </div>
                            </TableCell>
                            <TableCell>
                              <Badge variant="outline" className="font-mono text-xs">
                                {row.type}
                              </Badge>
                            </TableCell>
                            <TableCell>
                              {row.required ? (
                                <Badge className="bg-red-100 text-red-700 border-red-200">Sim</Badge>
                              ) : (
                                <span className="text-muted-foreground text-xs">Não</span>
                              )}
                            </TableCell>
                            <TableCell>
                              <Select
                                value={row.dbExpression}
                                onValueChange={(val) => updateMappingRow(idx, "dbExpression", val)}
                              >
                                <SelectTrigger className="font-mono text-sm">
                                  <SelectValue placeholder="Selecione coluna..." />
                                </SelectTrigger>
                                <SelectContent>
                                  <SelectItem value="">
                                    <span className="text-muted-foreground">Nenhuma</span>
                                  </SelectItem>
                                  {cacheColumns.map(col => (
                                    <SelectItem key={col.name} value={col.name}>
                                      <span className="font-mono">{col.name}</span>
                                      <span className="text-muted-foreground ml-2 text-xs">
                                        {col.sampleValue !== null ? `(${String(col.sampleValue).substring(0, 30)})` : "(null)"}
                                      </span>
                                    </SelectItem>
                                  ))}
                                </SelectContent>
                              </Select>
                            </TableCell>
                            <TableCell>
                              <Select
                                value={row.cast || ""}
                                onValueChange={(val) => updateMappingRow(idx, "cast", val)}
                              >
                                <SelectTrigger className="text-sm">
                                  <SelectValue placeholder="Nenhum" />
                                </SelectTrigger>
                                <SelectContent>
                                  {CAST_OPTIONS.map(opt => (
                                    <SelectItem key={opt.value} value={opt.value || "_none"}>
                                      {opt.label}
                                    </SelectItem>
                                  ))}
                                </SelectContent>
                              </Select>
                            </TableCell>
                            <TableCell>
                              <Input
                                value={row.defaultValue || ""}
                                onChange={e => updateMappingRow(idx, "defaultValue", e.target.value)}
                                placeholder="—"
                                className="text-sm"
                              />
                            </TableCell>
                          </TableRow>
                        );
                      })}
                    </TableBody>
                  </Table>
                </div>

                {existingMapping && !existingMapping.isActive && (
                  <div className="mt-4 p-3 bg-amber-50 border border-amber-200 rounded-lg flex items-center justify-between">
                    <div className="flex items-center gap-2 text-amber-700 text-sm">
                      <AlertCircle className="h-4 w-4" />
                      <span>Este mapping está salvo mas não está ativo.</span>
                    </div>
                    <Button
                      size="sm"
                      variant="outline"
                      className="border-amber-300 text-amber-700 hover:bg-amber-100"
                      onClick={() => activateMutation.mutate(existingMapping.id)}
                      disabled={activateMutation.isPending}
                    >
                      {activateMutation.isPending ? (
                        <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                      ) : (
                        <Zap className="h-4 w-4 mr-2" />
                      )}
                      Ativar Mapping
                    </Button>
                  </div>
                )}
              </>
            )}
          </SectionCard>
        )}

        {!selectedDataset && (
          <div className="text-center py-12 text-muted-foreground">
            <Database className="h-16 w-16 mx-auto mb-4 opacity-30" />
            <h3 className="text-lg font-medium mb-2">Selecione um Dataset</h3>
            <p className="text-sm max-w-md mx-auto">
              Escolha um dataset acima para começar a configurar o mapeamento entre as colunas do DB2 e os campos que a aplicação espera.
            </p>
          </div>
        )}
      </main>

      <Dialog open={previewOpen} onOpenChange={setPreviewOpen}>
        <DialogContent className="max-w-4xl max-h-[80vh] overflow-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Eye className="h-5 w-5" />
              Preview do Mapeamento
            </DialogTitle>
          </DialogHeader>

          {previewData && (
            <div className="space-y-4">
              {previewData.errors?.length > 0 && (
                <div className="p-3 bg-red-50 border border-red-200 rounded-lg">
                  <p className="font-medium text-red-700 text-sm mb-1">Erros encontrados:</p>
                  <ul className="list-disc pl-4 text-sm text-red-600">
                    {previewData.errors.map((err: string, i: number) => (
                      <li key={i}>{err}</li>
                    ))}
                  </ul>
                </div>
              )}

              {previewData.warnings?.length > 0 && (
                <div className="p-3 bg-amber-50 border border-amber-200 rounded-lg">
                  <p className="font-medium text-amber-700 text-sm mb-1">Avisos:</p>
                  <ul className="list-disc pl-4 text-sm text-amber-600">
                    {previewData.warnings.map((warn: string, i: number) => (
                      <li key={i}>{warn}</li>
                    ))}
                  </ul>
                </div>
              )}

              {previewData.preview?.length > 0 ? (
                <div>
                  <p className="text-sm text-muted-foreground mb-2">
                    Mostrando {previewData.preview.length} registros transformados:
                  </p>
                  <div className="overflow-x-auto border rounded-lg">
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead className="w-8">#</TableHead>
                          {Object.keys(previewData.preview[0]).map(key => (
                            <TableHead key={key} className="font-mono text-xs whitespace-nowrap">{key}</TableHead>
                          ))}
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {previewData.preview.map((row: Record<string, any>, idx: number) => (
                          <TableRow key={idx}>
                            <TableCell className="text-muted-foreground text-xs">{idx + 1}</TableCell>
                            {Object.values(row).map((val, colIdx) => (
                              <TableCell key={colIdx} className="text-xs whitespace-nowrap max-w-[200px] truncate">
                                {val === null ? (
                                  <span className="text-muted-foreground italic">null</span>
                                ) : (
                                  String(val)
                                )}
                              </TableCell>
                            ))}
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </div>
                </div>
              ) : previewData.errors?.length === 0 && previewData.warnings?.length === 0 ? (
                <p className="text-center text-muted-foreground py-4">Nenhum dado para exibir.</p>
              ) : null}
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
