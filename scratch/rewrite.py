import re

with open('apps/web/src/components/dashboard/intake/upload-flow.tsx', 'r') as f:
    content = f.read()

# Fix nextSourceTables
content = content.replace(
    'const nextSourceTables = result.files.flatMap((file) => file.shape?.kind === "tables" ? file.shape.tables.map((table) => ({ fileId: file.fileId, name: file.name, table })) : []);',
    'const nextSourceTables = result.files.flatMap((file) => file.shape?.kind === "tables" ? file.shape.tables.filter(table => table.kind === "context" || table.warnings.length > 0).map((table) => ({ fileId: file.fileId, name: file.name, table })) : []);'
)

# Remove automatic wizardStep advancing in review()
# We want it to stay on Step 1 until "Next Step" is clicked, or maybe when "ready" is true?
# Actually, the user says "Upload (Step 1) -> Click Next (Step 2)". So review() should NOT change wizardStep!
content = re.sub(r'setWizardStep\(nextSourceTables\.length > 0 \|\| nextAliases\.length > 0 \? 2 : 3\);\n?\s*return;', 'return;', content)
content = re.sub(r'setWizardStep\(nextSourceTables\.length > 0 \|\| nextAliases\.length > 0 \? 2 : 3\);', '', content)

with open('apps/web/src/components/dashboard/intake/upload-flow.tsx', 'w') as f:
    f.write(content)

