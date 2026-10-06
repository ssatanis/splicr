import re

with open("apps/web/src/components/dashboard/intake/upload-flow.tsx", "r") as f:
    content = f.read()

# We need to replace the entire `if (stage === "experiment") ...` block
# From `if (stage === "experiment") return <div className="space-y-4">`
# to `</div>;`

start_idx = content.find('if (stage === "experiment") return <div className="space-y-4">')
# the block ends at `/></div>;` just before `// --------------------------------`
end_idx = content.find('// -------------------------------------------------------------------------', start_idx)
# go back to find `</div>;`
end_idx = content.rfind('</div>;', start_idx, end_idx) + len('</div>;')

block_to_replace = content[start_idx:end_idx]

new_block = """  if (stage === "experiment") {
    const handleNext = () => setWizardStep((prev) => Math.min(prev + 1, 5));
    const handleBack = () => setWizardStep((prev) => Math.max(prev - 1, 1));
    const isNextDisabled = () => {
      if (wizardStep === 1) return !ready || landed === 0 || busy || starting;
      if (wizardStep === 2) return !aliasesConfirmed || starting;
      if (wizardStep === 3) return !comparisons.some((row) => row.enabled) || comparisons.some((row) => row.enabled && (!row.treatment.length || !row.control.length)) || starting;
      if (wizardStep === 4) return starting;
      return false;
    };

    return (
      <div className="mx-auto max-w-4xl space-y-6">
        <PhaseRail stage={stage} />
        
        {wizardStep === 1 && (
          <div className="space-y-6">
            <DropZone compact onFiles={(files) => void onFiles(files)} disabled={busy || starting}/>
            <FileList items={items} onRemove={(key) => void onRemove(key)} onRetry={(key) => void retryUpload(key)} busy={busy || starting}/>
            <FileInspection files={reviewedFiles}/>
          </div>
        )}

        {wizardStep === 2 && (
          <div className="space-y-6">
            {sourceTables.length > 0 ? interpretations : (
              <div className="rounded-sm border border-stone-200 bg-white p-6">
                <p className="text-[13px] text-muted">No tables require manual mapping.</p>
              </div>
            )}
            {aliases.length > 0 && (
              <section className="rounded-sm border border-orange-200 bg-white p-6">
                <h3 className="text-sm font-medium text-ink">Confirm guide ID mapping</h3>
                <p className="mt-1 text-[12px] text-muted">These count IDs do not exactly match the library. Review the proposed matches before running.</p>
                {aliases.map((alias, index) => (
                  <label key={alias.source} className="mt-2 flex items-center gap-3 text-[12px] text-ink">
                    <span className="min-w-32">{alias.source}</span>
                    <input aria-label={`Map ${alias.source}`} value={alias.target} onChange={(event) => { setAliases((current) => current.map((row, i) => i === index ? { ...row, target: event.target.value } : row)); setAliasesConfirmed(false); }} className="h-8 min-w-0 flex-1 rounded border border-stone-200 px-2"/>
                  </label>
                ))}
                <button type="button" disabled={starting || aliases.some((alias) => !alias.target)} onClick={() => setAliasesConfirmed(true)} className="mt-3 rounded-md border border-stone-200 px-3 py-1.5 text-[12px] text-ink">{aliasesConfirmed ? "Mapping confirmed" : "Confirm guide mapping"}</button>
              </section>
            )}
          </div>
        )}

        {wizardStep >= 3 && (
          <ExperimentReview 
            step={wizardStep}
            mappingReady={aliasesConfirmed} tables={tables} onTables={setTables} comparisons={comparisons} onChange={setComparisons} libraryUploads={libraryUploads} libraries={[...libraries, ...customLibraries]} libraryId={libraryId} onLibrary={setLibraryId} onImport={importLibrary} onFiles={onFiles} settings={settings} onSettings={setSettings} disabled={starting} onStart={() => void startExperiment()}
          />
        )}

        {notice && <p role="status" className="rounded-sm border border-orange-200 p-4 text-[13px] text-orange-700 bg-orange-50">{notice}</p>}
        
        <div className="flex items-center justify-between border-t border-stone-200 pt-6">
          <div className="flex gap-3">
             {wizardStep > 1 && (
               <button type="button" onClick={handleBack} disabled={busy || starting} className="h-9 rounded-md border border-stone-200 bg-white px-4 text-[13px] font-medium text-ink hover:bg-mist-soft">Back</button>
             )}
             {wizardStep < 5 ? (
               <button type="button" onClick={handleNext} disabled={isNextDisabled()} className="h-9 rounded-md bg-ink px-4 text-[13px] font-medium text-white hover:bg-ink/90 disabled:bg-mist disabled:text-muted">Next Step</button>
             ) : null}
          </div>
          <button type="button" onClick={() => { window.location.href = "/dashboard"; }} disabled={busy || starting} className="h-9 rounded-md border border-stone-200 bg-white px-4 text-[13px] font-medium text-ink hover:bg-mist-soft">Save as Draft</button>
        </div>
      </div>
    );
  }"""

content = content[:start_idx] + new_block + content[end_idx:]

with open("apps/web/src/components/dashboard/intake/upload-flow.tsx", "w") as f:
    f.write(content)
