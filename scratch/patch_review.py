import re

with open('apps/web/src/components/dashboard/intake/upload-flow.tsx', 'r') as f:
    content = f.read()

# We need to find the if (experimentTables.length) block
# and remove the return statement, and let the wizard step be set at the end of the function if experimentTables.length > 0.
