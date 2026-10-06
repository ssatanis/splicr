with open('apps/web/src/components/dashboard/intake/upload-flow.tsx', 'r') as f:
    lines = f.readlines()

out = []
detect_lines = []
in_detect = False
for line in lines:
    if "setDetected(" in line and "candidate" in line:
        in_detect = True
    if in_detect:
        detect_lines.append(line)
        if "if (nextLibraryId !==" in line:
            in_detect = False
            continue
        continue
    out.append(line)

# Now we need to insert detect_lines above `if (experimentTables.length)`
final_out = []
for line in out:
    if "if (experimentTables.length) {" in line:
        final_out.extend(detect_lines)
    final_out.append(line)

with open('apps/web/src/components/dashboard/intake/upload-flow.tsx', 'w') as f:
    f.writelines(final_out)
