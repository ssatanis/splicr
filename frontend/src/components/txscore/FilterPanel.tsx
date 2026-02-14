'use client';

import { TxScoreFilters } from '@sdk/txscore-client';

interface FilterPanelProps {
    filters: TxScoreFilters;
    onFilterChange: (newFilters: TxScoreFilters) => void;
    savedOnly?: boolean;
    onSavedOnlyChange?: (val: boolean) => void;
}

export default function FilterPanel({ filters, onFilterChange, savedOnly, onSavedOnlyChange }: FilterPanelProps) {

    const handleChange = (key: keyof TxScoreFilters, value: any) => {
        onFilterChange({ ...filters, [key]: value });
    };

    return (
        <div className="space-y-6 text-foreground">
            <div className="space-y-2">
                <label className="text-sm font-medium">Minimum TVS Score</label>
                <div className="flex items-center gap-4">
                    <input
                        type="range"
                        min="0"
                        max="1"
                        step="0.05"
                        value={filters.min_tvs || 0}
                        onChange={(e) => handleChange('min_tvs', parseFloat(e.target.value))}
                        className="w-full h-2 bg-muted rounded-lg appearance-none cursor-pointer accent-primary"
                    />
                    <span className="font-mono text-sm w-10 text-right">{(filters.min_tvs || 0).toFixed(2)}</span>
                </div>
            </div>

            <div className="space-y-2">
                <label className="text-sm font-medium">Cancer Type</label>
                <select
                    className="w-full p-2 bg-background border border-border rounded-md text-sm focus:outline-none focus:ring-1 focus:ring-primary"
                    value={filters.cancer_type || 'pan-cancer'}
                    onChange={(e) => handleChange('cancer_type', e.target.value)}
                >
                    <option value="pan-cancer">Pan-Cancer</option>
                    <option value="lung">Lung (NSCLC)</option>
                    <option value="breast">Breast (BRCA)</option>
                    <option value="colorectal">Colorectal (CRC)</option>
                    <option value="melanoma">Melanoma</option>
                    <option value="leukemia">Leukemia (AML)</option>
                </select>
            </div>

            <div className="space-y-2">
                <label className="text-sm font-medium">Protein Class</label>
                <select
                    className="w-full p-2 bg-background border border-border rounded-md text-sm focus:outline-none focus:ring-1 focus:ring-primary"
                    value={filters.protein_class || ''}
                    onChange={(e) => handleChange('protein_class', e.target.value || undefined)}
                >
                    <option value="">All Classes</option>
                    <option value="Enzyme">Enzyme</option>
                    <option value="Kinase">Kinase</option>
                    <option value="Receptor">Receptor</option>
                    <option value="Transporter">Transporter</option>
                    <option value="Transcription Factor">Transcription Factor</option>
                </select>
            </div>

            <div className="space-y-2">
                <label className="text-sm font-medium">Recommended Modality</label>
                <select
                    className="w-full p-2 bg-background border border-border rounded-md text-sm focus:outline-none focus:ring-1 focus:ring-primary"
                    value={filters.recommended_modality || ''}
                    onChange={(e) => handleChange('recommended_modality', e.target.value || undefined)}
                >
                    <option value="">Any Modality</option>
                    <option value="small_molecule">Small Molecule</option>
                    <option value="antibody">Antibody</option>
                    <option value="gene_therapy">Gene Therapy</option>
                    <option value="protac">PROTAC/Degrader</option>
                </select>
            </div>

            <div className="pt-4 border-t border-border space-y-3">
                <label className="flex items-center gap-2 cursor-pointer">
                    <input
                        type="checkbox"
                        className="w-4 h-4 rounded border-border text-primary focus:ring-primary"
                        checked={filters.has_approved_drugs || false}
                        onChange={(e) => handleChange('has_approved_drugs', e.target.checked || undefined)}
                    />
                    <span className="text-sm">Has Approved Drugs</span>
                </label>

                <label className="flex items-center gap-2 cursor-pointer">
                    <input
                        type="checkbox"
                        className="w-4 h-4 rounded border-border text-primary focus:ring-primary"
                        checked={filters.has_clinical_trials || false}
                        onChange={(e) => handleChange('has_clinical_trials', e.target.checked || undefined)}
                    />
                    <span className="text-sm">Has Clinical Trials</span>
                </label>

                {onSavedOnlyChange && (
                    <div id="saved-targets-filter" className="pt-2">
                        <label className="flex items-center gap-2 cursor-pointer">
                            <input
                                type="checkbox"
                                className="w-4 h-4 rounded border-border text-amber-500 focus:ring-amber-500"
                                checked={savedOnly || false}
                                onChange={(e) => onSavedOnlyChange(e.target.checked)}
                            />
                            <span className="text-sm font-medium text-amber-600 dark:text-amber-500">Show Saved Only</span>
                        </label>
                    </div>
                )}
            </div>
        </div>
    );
}
