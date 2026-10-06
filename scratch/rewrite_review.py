import re

with open("apps/web/src/components/dashboard/intake/upload-flow.tsx", "r") as f:
    content = f.read()

# Modify `review`
start_idx = content.find("const review = useCallback(async () => {")
end_idx = content.find("  }, [cellLine, items, libraryId, modality, name, phenotype]);", start_idx) + len("  }, [cellLine, items, libraryId, modality, name, phenotype]);")

review_block = content[start_idx:end_idx]

# Replace setStage calls inside `review` with `setWizardStep(2)`
review_block = re.sub(r'setStage\("experiment"\);', 'setWizardStep(2);', review_block)
review_block = re.sub(r'setStage\("design"\);', 'setWizardStep(2);', review_block)
review_block = re.sub(r'setStage\("confirm"\);', 'setWizardStep(2);', review_block)

content = content[:start_idx] + review_block + content[end_idx:]

with open("apps/web/src/components/dashboard/intake/upload-flow.tsx", "w") as f:
    f.write(content)
