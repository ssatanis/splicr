'use client';

import { useState, useEffect } from 'react';
import { createClient } from '@/lib/supabase/client';
import Button from '@/components/Button';
import {
  Save,
  Loader2,
  CheckCircle2,
  AlertCircle,
  BookOpen,
  Upload,
  Trash2,
  Eye,
  Download,
  Dna,
  FileText,
} from 'lucide-react';

interface LibrarySettings {
  default_library: string;
  custom_libraries: CustomLibrary[];
  reference_genome: string;
  gene_annotation_version: string;
  gene_set_collections: string[];
}

interface CustomLibrary {
  id: string;
  name: string;
  file_url: string;
  species: string;
  target_type: string;
  guide_count: number;
  uploaded_at: string;
}

const PRESET_LIBRARIES = [
  {
    id: 'geckov2_human',
    name: 'GeCKO v2 (Human)',
    description: 'Genome-scale CRISPR knockout library',
    guides: '123,411 sgRNAs',
    species: 'Human (Homo sapiens)',
    coverage: '19,050 genes',
  },
  {
    id: 'brunello_v2',
    name: 'Brunello v2',
    description: 'Optimized genome-scale library',
    guides: '76,441 sgRNAs',
    species: 'Human (Homo sapiens)',
    coverage: '19,114 genes',
  },
  {
    id: 'brie',
    name: 'Brie',
    description: 'High-fidelity library for essentiality screens',
    guides: '71,090 sgRNAs',
    species: 'Human (Homo sapiens)',
    coverage: '17,661 genes',
  },
  {
    id: 'tkov3',
    name: 'TKOv3',
    description: 'Toronto KnockOut Library v3',
    guides: '71,090 sgRNAs',
    species: 'Human (Homo sapiens)',
    coverage: '18,053 genes',
  },
  {
    id: 'geckov2_mouse',
    name: 'GeCKO v2 (Mouse)',
    description: 'Mouse genome-scale knockout library',
    guides: '130,209 sgRNAs',
    species: 'Mouse (Mus musculus)',
    coverage: '20,611 genes',
  },
  {
    id: 'brie_mouse',
    name: 'Brie (Mouse)',
    description: 'High-fidelity mouse library',
    guides: '78,637 sgRNAs',
    species: 'Mouse (Mus musculus)',
    coverage: '19,674 genes',
  },
];

const REFERENCE_GENOMES = [
  { id: 'hg38', name: 'Human (GRCh38/hg38)', organism: 'Homo sapiens' },
  { id: 'hg19', name: 'Human (GRCh37/hg19)', organism: 'Homo sapiens' },
  { id: 'mm10', name: 'Mouse (GRCm38/mm10)', organism: 'Mus musculus' },
  { id: 'mm39', name: 'Mouse (GRCm39/mm39)', organism: 'Mus musculus' },
  { id: 'rn6', name: 'Rat (Rnor_6.0/rn6)', organism: 'Rattus norvegicus' },
  { id: 'dm6', name: 'Drosophila (dm6)', organism: 'Drosophila melanogaster' },
  { id: 'ce11', name: 'C. elegans (ce11)', organism: 'Caenorhabditis elegans' },
];

const GENE_ANNOTATIONS = [
  { id: 'ensembl_110', name: 'Ensembl 110 (Latest)', date: 'July 2023' },
  { id: 'ensembl_109', name: 'Ensembl 109', date: 'Feb 2023' },
  { id: 'gencode_44', name: 'GENCODE 44 (Human)', date: 'May 2023' },
  { id: 'gencode_m33', name: 'GENCODE M33 (Mouse)', date: 'May 2023' },
  { id: 'refseq_2023', name: 'RefSeq (2023)', date: 'Jan 2023' },
];

const GENE_SET_COLLECTIONS = [
  { id: 'go_biological_process', name: 'GO: Biological Process', count: '29,678 gene sets' },
  { id: 'go_molecular_function', name: 'GO: Molecular Function', count: '11,150 gene sets' },
  { id: 'go_cellular_component', name: 'GO: Cellular Component', count: '4,180 gene sets' },
  { id: 'kegg_pathways', name: 'KEGG Pathways', count: '186 pathways' },
  { id: 'reactome', name: 'Reactome Pathways', count: '1,615 pathways' },
  { id: 'msigdb_hallmark', name: 'MSigDB Hallmark', count: '50 gene sets' },
  { id: 'msigdb_c2_canonical', name: 'MSigDB C2: Canonical Pathways', count: '1,329 gene sets' },
  { id: 'msigdb_c6_oncogenic', name: 'MSigDB C6: Oncogenic Signatures', count: '189 gene sets' },
];

export function LibraryManagementSettings() {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [viewingLibrary, setViewingLibrary] = useState<string | null>(null);

  const [settings, setSettings] = useState<LibrarySettings>({
    default_library: 'brunello_v2',
    custom_libraries: [],
    reference_genome: 'hg38',
    gene_annotation_version: 'ensembl_110',
    gene_set_collections: ['go_biological_process', 'kegg_pathways'],
  });

  const supabase = createClient();

  useEffect(() => {
    loadSettings();
  }, []);

  useEffect(() => {
    if (success) {
      const timer = setTimeout(() => setSuccess(false), 3000);
      return () => clearTimeout(timer);
    }
  }, [success]);

  async function loadSettings() {
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;

      const { data: defaultsData, error } = await (supabase
        .from('analysis_defaults') as any)
        .select('default_library, organism, gene_annotation')
        .eq('user_id', user.id)
        .maybeSingle();

      if (error && error.code !== 'PGRST116') {
        console.error('Error loading analysis defaults:', error);
      }

      if (defaultsData) {
        setSettings(prev => ({
          ...prev,
          default_library: defaultsData.default_library ?? prev.default_library,
          reference_genome: defaultsData.organism ?? prev.reference_genome,
          gene_annotation_version: defaultsData.gene_annotation ?? prev.gene_annotation_version,
        }));
      }

      const { data: libraries } = await (supabase.from('sgrna_libraries') as any)
        .select('id, name, organism, library_type, total_sgrnas, total_genes, file_url, created_at')
        .eq('uploaded_by', user.id)
        .order('created_at', { ascending: false });

      if (libraries?.length) {
        setSettings(prev => ({
          ...prev,
          custom_libraries: libraries.map((r: { id: string; name: string; organism?: string; library_type?: string; total_sgrnas?: number; total_genes?: number; file_url?: string; created_at: string }) => ({
            id: r.id,
            name: r.name,
            file_url: r.file_url ?? '',
            species: r.organism ?? 'human',
            target_type: r.library_type ?? 'knockout',
            guide_count: r.total_sgrnas ?? r.total_genes ?? 0,
            uploaded_at: r.created_at,
          })),
        }));
      }
    } catch (error) {
      console.error('Error:', error);
    } finally {
      setLoading(false);
    }
  }

  async function saveSettings() {
    setSaving(true);
    setError(null);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error('Not authenticated');

      const { error } = await (supabase.from('analysis_defaults') as any).upsert({
        user_id: user.id,
        default_library: settings.default_library,
        organism: settings.reference_genome,
        gene_annotation: settings.gene_annotation_version,
        updated_at: new Date().toISOString(),
      });

      if (error) throw error;
      setSuccess(true);
    } catch (error: any) {
      console.error('Error saving settings:', error);
      setError(error.message || 'Failed to save settings');
    } finally {
      setSaving(false);
    }
  }

  async function handleLibraryUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;

    if (!file.name.endsWith('.csv') && !file.name.endsWith('.txt')) {
      setError('Library file must be CSV or TXT format');
      return;
    }

    setUploading(true);
    setError(null);

    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error('Not authenticated');

      // Upload file to storage
      const fileName = `${user.id}-${Date.now()}-${file.name}`;
      const filePath = `libraries/${fileName}`;

      const { error: uploadError } = await supabase.storage
        .from('user-uploads')
        .upload(filePath, file);

      if (uploadError) throw uploadError;

      const { data: { publicUrl } } = supabase.storage
        .from('user-uploads')
        .getPublicUrl(filePath);

      const { error: insertError } = await (supabase.from('sgrna_libraries') as any).insert({
        name: file.name.replace(/\.(csv|txt)$/i, ''),
        organism: 'Homo sapiens',
        library_type: 'knockout',
        total_sgrnas: 0,
        total_genes: 0,
        file_url: publicUrl,
        is_public: false,
        uploaded_by: user.id,
      });

      if (insertError) throw insertError;

      setSuccess(true);
      await loadSettings(); // Reload to show new library
    } catch (error: any) {
      console.error('Error uploading library:', error);
      setError(error.message || 'Failed to upload library');
    } finally {
      setUploading(false);
    }
  }

  async function deleteCustomLibrary(libraryId: string) {
    try {
      const { error } = await (supabase.from('sgrna_libraries') as any).delete().eq('id', libraryId);
      if (error) throw error;

      setSettings(prev => ({
        ...prev,
        custom_libraries: prev.custom_libraries.filter(l => l.id !== libraryId),
      }));
    } catch (error) {
      console.error('Error deleting library:', error);
      setError('Failed to delete library');
    }
  }

  function toggleGeneSetCollection(collectionId: string) {
    setSettings(prev => ({
      ...prev,
      gene_set_collections: prev.gene_set_collections.includes(collectionId)
        ? prev.gene_set_collections.filter(id => id !== collectionId)
        : [...prev.gene_set_collections, collectionId],
    }));
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center p-8">
        <Loader2 className="w-8 h-8 animate-spin text-accent" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <h2 className="text-2xl font-serif text-text-primary mb-2 flex items-center gap-2">
          <BookOpen className="w-6 h-6" />
          Library Management
        </h2>
        <p className="text-sm text-text-secondary">
          Manage sgRNA libraries, reference genomes, and gene annotations
        </p>
      </div>

      {/* Toast Messages */}
      {error && (
        <div className="flex items-center gap-2 p-4 bg-red-500/10 border border-red-500/20 rounded-xl text-red-500">
          <AlertCircle className="w-5 h-5" />
          <span className="text-sm">{error}</span>
        </div>
      )}
      {success && (
        <div className="flex items-center gap-2 p-4 bg-green-500/10 border border-green-500/20 rounded-xl text-green-500">
          <CheckCircle2 className="w-5 h-5" />
          <span className="text-sm">Settings saved successfully!</span>
        </div>
      )}

      {/* sgRNA Libraries */}
      <div className="bg-surface rounded-xl p-6 border border-border">
        <h3 className="text-lg font-serif text-text-primary mb-4 flex items-center gap-2">
          <Dna className="w-5 h-5" />
          sgRNA Libraries
        </h3>

        <div>
          <label className="block text-sm font-serif text-text-secondary mb-3">
            Default Library for New Analyses
          </label>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            {PRESET_LIBRARIES.map((library) => (
              <button
                key={library.id}
                onClick={() => setSettings({ ...settings, default_library: library.id })}
                className={`p-4 rounded-lg border-2 transition-all text-left ${
                  settings.default_library === library.id
                    ? 'border-accent bg-accent/5'
                    : 'border-border hover:border-accent/50'
                }`}
              >
                <div className="flex items-start justify-between mb-2">
                  <h4 className="font-serif text-text-primary font-medium">{library.name}</h4>
                  {settings.default_library === library.id && (
                    <CheckCircle2 className="w-5 h-5 text-accent" />
                  )}
                </div>
                <p className="text-xs text-text-secondary mb-2">{library.description}</p>
                <div className="flex flex-wrap gap-2 text-xs text-text-tertiary">
                  <span className="px-2 py-0.5 bg-background rounded">{library.guides}</span>
                  <span className="px-2 py-0.5 bg-background rounded">{library.coverage}</span>
                </div>
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Custom Libraries */}
      <div className="bg-surface rounded-xl p-6 border border-border">
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-lg font-serif text-text-primary">Custom Libraries</h3>
          <label className="cursor-pointer">
            <input
              type="file"
              accept=".csv,.txt"
              onChange={handleLibraryUpload}
              className="hidden"
              disabled={uploading}
            />
            <div className="flex items-center gap-2 px-4 py-2 bg-accent text-text-primary rounded-lg hover:bg-[#D9F03E] transition-colors">
              {uploading ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin" />
                  Uploading...
                </>
              ) : (
                <>
                  <Upload className="w-4 h-4" />
                  Upload Library
                </>
              )}
            </div>
          </label>
        </div>

        <p className="text-sm text-text-secondary mb-4">
          Upload custom sgRNA libraries in CSV or TXT format. Files should contain columns for guide sequence, gene target, and strand.
        </p>

        {settings.custom_libraries.length > 0 ? (
          <div className="space-y-2">
            {settings.custom_libraries.map((library) => (
              <div
                key={library.id}
                className="flex items-center justify-between p-4 bg-background rounded-lg border border-border hover:border-accent/50 transition-colors"
              >
                <div className="flex-1">
                  <h4 className="font-serif text-text-primary font-medium">{library.name}</h4>
                  <div className="flex gap-3 mt-1 text-xs text-text-tertiary">
                    <span>{library.species}</span>
                    <span>•</span>
                    <span>{library.guide_count.toLocaleString()} guides</span>
                    <span>•</span>
                    <span>Uploaded {new Date(library.uploaded_at).toLocaleDateString()}</span>
                  </div>
                </div>
                <div className="flex gap-2">
                  <button
                    onClick={() => setViewingLibrary(library.id)}
                    className="p-2 text-text-secondary hover:text-text-primary transition-colors"
                    title="View details"
                  >
                    <Eye className="w-4 h-4" />
                  </button>
                  <a
                    href={library.file_url}
                    download
                    className="p-2 text-text-secondary hover:text-text-primary transition-colors"
                    title="Download"
                  >
                    <Download className="w-4 h-4" />
                  </a>
                  <button
                    onClick={() => deleteCustomLibrary(library.id)}
                    className="p-2 text-text-secondary hover:text-error transition-colors"
                    title="Delete"
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>
              </div>
            ))}
          </div>
        ) : (
          <div className="text-center py-8 text-text-tertiary">
            <FileText className="w-12 h-12 mx-auto mb-2 opacity-50" />
            <p className="text-sm">No custom libraries uploaded yet</p>
          </div>
        )}
      </div>

      {/* Reference Genomes */}
      <div className="bg-surface rounded-xl p-6 border border-border">
        <h3 className="text-lg font-serif text-text-primary mb-4">Reference Genome</h3>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          {REFERENCE_GENOMES.map((genome) => (
            <button
              key={genome.id}
              onClick={() => setSettings({ ...settings, reference_genome: genome.id })}
              className={`p-3 rounded-lg border transition-all text-left ${
                settings.reference_genome === genome.id
                  ? 'border-accent bg-accent/5'
                  : 'border-border hover:border-accent/50'
              }`}
            >
              <div className="flex items-center justify-between">
                <div>
                  <h4 className="font-serif text-text-primary text-sm font-medium">
                    {genome.name}
                  </h4>
                  <p className="text-xs text-text-tertiary italic">{genome.organism}</p>
                </div>
                {settings.reference_genome === genome.id && (
                  <CheckCircle2 className="w-5 h-5 text-accent" />
                )}
              </div>
            </button>
          ))}
        </div>
      </div>

      {/* Gene Annotation Version */}
      <div className="bg-surface rounded-xl p-6 border border-border">
        <h3 className="text-lg font-serif text-text-primary mb-4">Gene Annotation Version</h3>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          {GENE_ANNOTATIONS.map((annotation) => (
            <button
              key={annotation.id}
              onClick={() => setSettings({ ...settings, gene_annotation_version: annotation.id })}
              className={`p-3 rounded-lg border transition-all text-left ${
                settings.gene_annotation_version === annotation.id
                  ? 'border-accent bg-accent/5'
                  : 'border-border hover:border-accent/50'
              }`}
            >
              <div className="flex items-center justify-between">
                <div>
                  <h4 className="font-serif text-text-primary text-sm font-medium">
                    {annotation.name}
                  </h4>
                  <p className="text-xs text-text-tertiary">{annotation.date}</p>
                </div>
                {settings.gene_annotation_version === annotation.id && (
                  <CheckCircle2 className="w-5 h-5 text-accent" />
                )}
              </div>
            </button>
          ))}
        </div>
      </div>

      {/* Gene Set Collections */}
      <div className="bg-surface rounded-xl p-6 border border-border">
        <h3 className="text-lg font-serif text-text-primary mb-4">Gene Set Collections</h3>
        <p className="text-sm text-text-secondary mb-4">
          Select collections for pathway enrichment analysis (multi-select)
        </p>

        <div className="space-y-2">
          {GENE_SET_COLLECTIONS.map((collection) => (
            <label
              key={collection.id}
              className="flex items-center justify-between p-3 rounded-lg border border-border hover:bg-background cursor-pointer transition-colors"
            >
              <div className="flex items-center gap-3">
                <input
                  type="checkbox"
                  checked={settings.gene_set_collections.includes(collection.id)}
                  onChange={() => toggleGeneSetCollection(collection.id)}
                  className="w-4 h-4 rounded border-border accent-accent"
                />
                <div>
                  <p className="text-sm font-medium text-text-primary">{collection.name}</p>
                  <p className="text-xs text-text-tertiary">{collection.count}</p>
                </div>
              </div>
              {settings.gene_set_collections.includes(collection.id) && (
                <CheckCircle2 className="w-5 h-5 text-accent" />
              )}
            </label>
          ))}
        </div>
      </div>

      {/* Save Button */}
      <div className="flex justify-end pt-4 border-t border-border">
        <Button onClick={saveSettings} disabled={saving} size="lg">
          {saving ? (
            <>
              <Loader2 className="w-4 h-4 mr-2 animate-spin" />
              Saving...
            </>
          ) : (
            <>
              <Save className="w-4 h-4 mr-2" />
              Save library settings
            </>
          )}
        </Button>
      </div>
    </div>
  );
}
