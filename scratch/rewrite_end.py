import re

with open("apps/web/src/components/dashboard/intake/upload-flow.tsx", "r") as f:
    content = f.read()

# We want to change the file structure.
# Instead of `if (stage === "experiment") { ... }`, we remove `if (stage === "experiment") {` and let it be the default return at the bottom of the file!

# First, extract the block from `if (stage === "experiment") {` to `return (<div className="mx-auto max-w-4xl space-y-6">`
start_experiment_idx = content.find('  if (stage === "experiment") {')
end_experiment_idx = content.find('  // -------------------------------------------------------------------------', start_experiment_idx)

experiment_block = content[start_experiment_idx:end_experiment_idx]

# strip the `if (stage === "experiment") {` and its closing brace
# Actually, the block currently looks like:
#   if (stage === "experiment") {
#     const handleNext ...
#     ...
#     return (
#       ...
#     );
#   }

stripped_experiment_block = experiment_block.replace('  if (stage === "experiment") {\n', '')
# find the last `  }` and remove it
last_brace = stripped_experiment_block.rfind('  }\n')
stripped_experiment_block = stripped_experiment_block[:last_brace] + stripped_experiment_block[last_brace+4:]

# Now, we find the old end block. It starts at `  const uploading = items.some`
old_end_start = content.find('  const uploading = items.some')
old_end_end = content.rfind('}') # end of UploadFlow function

new_content = content[:start_experiment_idx] + "\n  // -------------------------------------------------------------------------\n" + content[end_experiment_idx:old_end_start] + stripped_experiment_block + "\n}\n"

with open("apps/web/src/components/dashboard/intake/upload-flow.tsx", "w") as f:
    f.write(new_content)
