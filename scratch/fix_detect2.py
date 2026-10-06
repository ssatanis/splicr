with open('apps/web/src/components/dashboard/intake/upload-flow.tsx', 'r') as f:
    lines = f.readlines()

out = []
detect_lines = []
in_detect = False
for line in lines:
    if "setDetected(" in line and "result.libraries" not in line and "[]" not in line: # we want the block
        in_detect = True
    if in_detect:
        detect_lines.append(line)
        if "if (nextLibraryId !==" in line:
            in_detect = False
            continue
        continue
    out.append(line)

# Wait, let me just do this with text replace.
