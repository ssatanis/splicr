import re

with open("apps/web/src/lib/intake/mapping.ts", "r") as f:
    content = f.read()

index_start = content.find("  const index = (name: string | undefined, required = false, label?: string) => {")
index_end = content.find("  };\n", index_start) + 5

new_index = """  const index = (name: string | undefined, required = false, label?: string) => {
    if (!name && !required) return -1;
    const cleanName = name?.trim() ?? "";
    if (!cleanName && !required) return -1;
    if (!cleanName) throw new Error(`Select a ${label ?? "column"}.`);
    let i = header.indexOf(cleanName);
    if (i < 0) {
      i = header.findIndex(h => h.toLowerCase() === cleanName.toLowerCase());
    }
    if (i < 0) throw new Error(`Column "${name}" is missing from the table.`);
    return i;
  };
"""

content = content[:index_start] + new_index + content[index_end:]

with open("apps/web/src/lib/intake/mapping.ts", "w") as f:
    f.write(content)
