'use client';

import { useState, useCallback } from 'react';
import { Upload, FileText, Database, AlertCircle, CheckCircle } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useDropzone } from 'react-dropzone';
import { Button } from '@/components/ui/button';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { parseSequenceFile, validateSequence } from '@/lib/tea/sequence-utils';

interface ValidationResult {
  isValid: boolean;
  errors: string[];
  warnings: string[];
  metadata?: {
    gcContent: number;
    length: number;
    pamSites: number;
  };
}

const TISSUE_OPTIONS = [
  { value: 'liver', label: 'Liver / Hepatocytes' },
  { value: 'neurons', label: 'Neurons / CNS' },
  { value: 'hsc', label: 'Hematopoietic Stem Cells' },
  { value: 'muscle', label: 'Muscle Tissue' },
  { value: 'retina', label: 'Retinal Cells' },
  { value: 'lung', label: 'Lung Epithelium' },
  { value: 'kidney', label: 'Kidney Cells' },
  { value: 'cardiomyocytes', label: 'Cardiomyocytes' },
  { value: 'pancreas', label: 'Pancreatic Cells' },
  { value: 'other', label: 'Other / Pan-tissue' }
];

const GENOME_BUILD_OPTIONS = [
  { value: 'hg38', label: 'GRCh38/hg38 (Latest)' },
  { value: 'hg19', label: 'GRCh37/hg19' }
];

export default function TEAInputForm() {
  const router = useRouter();
  const [activeTab, setActiveTab] = useState<'manual' | 'upload' | 'database'>('manual');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [validation, setValidation] = useState<ValidationResult | null>(null);

  // Form state
  const [formData, setFormData] = useState({
    sequence: '',
    variantId: '',
    geneSymbol: '',
    tissue: 'liver',
    genomeBuild: 'hg38',
    chromosome: '',
    position: '',
    refAllele: '',
    altAllele: '',
    hgvsNotation: ''
  });

  // File upload state
  const [uploadedFile, setUploadedFile] = useState<File | null>(null);

  // Handle file drop
  const onDrop = useCallback(async (acceptedFiles: File[]) => {
    const file = acceptedFiles[0];
    if (!file) return;

    setUploadedFile(file);

    // Read and parse file
    const text = await file.text();
    const parsed = parseSequenceFile(text, file.name.endsWith('.fasta') ? 'fasta' : 'text');

    if (parsed.success && parsed.sequence) {
      setFormData(prev => ({
        ...prev,
        sequence: parsed.sequence!,
        geneSymbol: parsed.metadata?.gene || prev.geneSymbol,
        variantId: parsed.metadata?.variant || prev.variantId
      }));

      // Validate immediately
      handleValidation(parsed.sequence);
    } else {
      setValidation({
        isValid: false,
        errors: [parsed.error || 'Failed to parse file'],
        warnings: []
      });
    }
  }, []);

  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    onDrop,
    accept: {
      'text/plain': ['.txt', '.fasta', '.fa', '.seq'],
      'application/x-fasta': ['.fasta', '.fa']
    },
    maxFiles: 1,
    maxSize: 1024 * 1024 // 1MB
  });

  // Validate sequence
  const handleValidation = (sequence: string) => {
    const result = validateSequence(sequence);
    
    if (result.isValid) {
      setValidation({
        isValid: true,
        errors: [],
        warnings: result.warnings || [],
        metadata: result.metadata
      });
    } else {
      setValidation({
        isValid: false,
        errors: result.errors || ['Invalid sequence'],
        warnings: result.warnings || []
      });
    }
  };

  // Handle manual input change
  const handleSequenceChange = (value: string) => {
    setFormData(prev => ({ ...prev, sequence: value }));
    if (value.length >= 50) {
      handleValidation(value);
    } else {
      setValidation(null);
    }
  };

  // Database lookup
  const handleDatabaseLookup = async (type: 'clinvar' | 'dbsnp') => {
    setIsSubmitting(true);
    try {
      const endpoint = type === 'clinvar' 
        ? `/api/tea/clinvar/${formData.variantId}`
        : `/api/tea/dbsnp/${formData.variantId}`;

      const response = await fetch(endpoint);
      if (!response.ok) throw new Error('Variant not found');

      const variant = await response.json();

      setFormData(prev => ({
        ...prev,
        geneSymbol: variant.gene || prev.geneSymbol,
        chromosome: variant.chromosome,
        position: variant.position.toString(),
        refAllele: variant.ref,
        altAllele: Array.isArray(variant.alt) ? variant.alt[0] : variant.alt,
        hgvsNotation: variant.hgvs
      }));

      setValidation({
        isValid: true,
        errors: [],
        warnings: [`Found variant: ${variant.gene} - ${variant.hgvs}`]
      });
    } catch (error) {
      setValidation({
        isValid: false,
        errors: [(error as Error).message],
        warnings: []
      });
    } finally {
      setIsSubmitting(false);
    }
  };

  // Submit analysis
  const handleSubmit = async () => {
    if (!validation?.isValid) {
      setValidation({
        isValid: false,
        errors: ['Please provide a valid sequence'],
        warnings: []
      });
      return;
    }

    setIsSubmitting(true);
    try {
      const response = await fetch('/api/tea/analyze', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          sequence: formData.sequence,
          variantId: formData.variantId,
          geneSymbol: formData.geneSymbol,
          tissue: formData.tissue,
          genomeBuild: formData.genomeBuild,
          chromosome: formData.chromosome,
          position: formData.position ? parseInt(formData.position) : undefined,
          refAllele: formData.refAllele,
          altAllele: formData.altAllele,
          hgvsNotation: formData.hgvsNotation
        })
      });

      if (!response.ok) throw new Error('Analysis failed');

      const result = await response.json();
      router.push(`/tea/report/${result.reportId}`);
    } catch (error) {
      setValidation({
        isValid: false,
        errors: [(error as Error).message],
        warnings: []
      });
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="max-w-4xl mx-auto space-y-6">
      <Tabs value={activeTab} onValueChange={(v) => setActiveTab(v as any)}>
        <TabsList className="grid w-full grid-cols-3">
          <TabsTrigger value="manual">
            <FileText className="w-4 h-4 mr-2" />
            Manual Input
          </TabsTrigger>
          <TabsTrigger value="upload">
            <Upload className="w-4 h-4 mr-2" />
            File Upload
          </TabsTrigger>
          <TabsTrigger value="database">
            <Database className="w-4 h-4 mr-2" />
            Database Lookup
          </TabsTrigger>
        </TabsList>

        {/* Manual Input */}
        <TabsContent value="manual" className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="sequence">Target Sequence</Label>
            <Textarea
              id="sequence"
              placeholder="Enter DNA sequence (50-10000 bp)..."
              value={formData.sequence}
              onChange={(e) => handleSequenceChange(e.target.value)}
              rows={6}
              className="font-mono text-sm"
            />
            <p className="text-xs text-muted-foreground">
              Paste the genomic sequence containing your target variant (200-500bp recommended)
            </p>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="gene">Gene Symbol</Label>
              <Input
                id="gene"
                placeholder="e.g., BRCA1"
                value={formData.geneSymbol}
                onChange={(e) => setFormData(prev => ({ ...prev, geneSymbol: e.target.value }))}
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="variant">Variant ID (Optional)</Label>
              <Input
                id="variant"
                placeholder="e.g., c.6046G>A or rs80357906"
                value={formData.variantId}
                onChange={(e) => setFormData(prev => ({ ...prev, variantId: e.target.value }))}
              />
            </div>
          </div>
        </TabsContent>

        {/* File Upload */}
        <TabsContent value="upload" className="space-y-4">
          <div
            {...getRootProps()}
            className={`border-2 border-dashed rounded-lg p-12 text-center cursor-pointer transition-colors ${
              isDragActive ? 'border-primary bg-primary/5' : 'border-muted-foreground/25 hover:border-primary/50'
            }`}
          >
            <input {...getInputProps()} />
            <Upload className="w-12 h-12 mx-auto mb-4 text-muted-foreground" />
            {isDragActive ? (
              <p className="text-lg font-medium">Drop the file here...</p>
            ) : (
              <>
                <p className="text-lg font-medium mb-2">
                  Drag & drop a FASTA file here
                </p>
                <p className="text-sm text-muted-foreground mb-4">
                  or click to browse
                </p>
                <p className="text-xs text-muted-foreground">
                  Supports .fasta, .fa, .txt (max 1MB)
                </p>
              </>
            )}
          </div>

          {uploadedFile && (
            <Alert>
              <CheckCircle className="h-4 w-4" />
              <AlertDescription>
                Loaded: {uploadedFile.name} ({Math.round(uploadedFile.size / 1024)} KB)
              </AlertDescription>
            </Alert>
          )}
        </TabsContent>

        {/* Database Lookup */}
        <TabsContent value="database" className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="dbVariantId">Variant Identifier</Label>
            <div className="flex gap-2">
              <Input
                id="dbVariantId"
                placeholder="Enter ClinVar ID or rsID..."
                value={formData.variantId}
                onChange={(e) => setFormData(prev => ({ ...prev, variantId: e.target.value }))}
              />
              <Button
                onClick={() => handleDatabaseLookup('clinvar')}
                disabled={!formData.variantId || isSubmitting}
                variant="outline"
              >
                ClinVar
              </Button>
              <Button
                onClick={() => handleDatabaseLookup('dbsnp')}
                disabled={!formData.variantId || isSubmitting}
                variant="outline"
              >
                dbSNP
              </Button>
            </div>
            <p className="text-xs text-muted-foreground">
              Enter a ClinVar Variation ID (e.g., 12345) or dbSNP rsID (e.g., rs80357906)
            </p>
          </div>

          {formData.chromosome && (
            <div className="p-4 border rounded-lg space-y-2">
              <h4 className="font-semibold">Retrieved Variant:</h4>
              <div className="grid grid-cols-2 gap-2 text-sm">
                <div><span className="text-muted-foreground">Gene:</span> {formData.geneSymbol}</div>
                <div><span className="text-muted-foreground">Position:</span> {formData.chromosome}:{formData.position}</div>
                <div><span className="text-muted-foreground">Change:</span> {formData.refAllele}→{formData.altAllele}</div>
                <div><span className="text-muted-foreground">HGVS:</span> {formData.hgvsNotation}</div>
              </div>
            </div>
          )}
        </TabsContent>
      </Tabs>

      {/* Common Parameters */}
      <div className="space-y-4 p-6 border rounded-lg">
        <h3 className="font-semibold">Analysis Parameters</h3>
        
        <div className="grid grid-cols-2 gap-4">
          <div className="space-y-2">
            <Label htmlFor="tissue">Target Tissue / Cell Type</Label>
            <Select value={formData.tissue} onValueChange={(v) => setFormData(prev => ({ ...prev, tissue: v }))}>
              <SelectTrigger id="tissue">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {TISSUE_OPTIONS.map(opt => (
                  <SelectItem key={opt.value} value={opt.value}>
                    {opt.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-2">
            <Label htmlFor="genome">Genome Build</Label>
            <Select value={formData.genomeBuild} onValueChange={(v) => setFormData(prev => ({ ...prev, genomeBuild: v }))}>
              <SelectTrigger id="genome">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {GENOME_BUILD_OPTIONS.map(opt => (
                  <SelectItem key={opt.value} value={opt.value}>
                    {opt.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>
      </div>

      {/* Validation Messages */}
      {validation && (
        <>
          {validation.errors.length > 0 && (
            <Alert variant="destructive">
              <AlertCircle className="h-4 w-4" />
              <AlertDescription>
                <ul className="list-disc list-inside">
                  {validation.errors.map((err, i) => (
                    <li key={i}>{err}</li>
                  ))}
                </ul>
              </AlertDescription>
            </Alert>
          )}

          {validation.warnings.length > 0 && (
            <Alert>
              <AlertCircle className="h-4 w-4" />
              <AlertDescription>
                <ul className="list-disc list-inside">
                  {validation.warnings.map((warn, i) => (
                    <li key={i}>{warn}</li>
                  ))}
                </ul>
              </AlertDescription>
            </Alert>
          )}

          {validation.isValid && validation.metadata && (
            <div className="p-4 border rounded-lg">
              <h4 className="font-semibold mb-2">Sequence Analysis:</h4>
              <div className="grid grid-cols-3 gap-4 text-sm">
                <div>
                  <span className="text-muted-foreground">Length:</span>{' '}
                  {validation.metadata.length} bp
                </div>
                <div>
                  <span className="text-muted-foreground">GC Content:</span>{' '}
                  {validation.metadata.gcContent.toFixed(1)}%
                </div>
                <div>
                  <span className="text-muted-foreground">PAM Sites:</span>{' '}
                  {validation.metadata.pamSites}
                </div>
              </div>
            </div>
          )}
        </>
      )}

      {/* Submit Button */}
      <Button
        onClick={handleSubmit}
        disabled={!validation?.isValid || isSubmitting}
        className="w-full"
        size="lg"
      >
        {isSubmitting ? 'Analyzing...' : 'Analyze Therapeutic Potential'}
      </Button>
    </div>
  );
}
