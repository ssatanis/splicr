import re

with open("apps/web/src/components/dashboard/intake/upload-flow.tsx", "r") as f:
    content = f.read()

# Add ready and landed back
insertion = """  const uploading = items.some((item) => item.status === "uploading" || item.status === "recording");
  const ready = items.length > 0 && items.every((item) => item.status === "done" || item.status === "failed");
  const landed = items.filter((item) => item.status === "done").length;

  const isNextDisabled = () => {"""
content = content.replace("  const isNextDisabled = () => {", insertion)

with open("apps/web/src/components/dashboard/intake/upload-flow.tsx", "w") as f:
    f.write(content)

with open("apps/web/src/components/dashboard/intake/experiment-review.tsx", "r") as f:
    er_content = f.read()

er_content = er_content.replace("(() => {})(event.target.checked)", "setConfirmed(event.target.checked)")

with open("apps/web/src/components/dashboard/intake/experiment-review.tsx", "w") as f:
    f.write(er_content)

with open("apps/web/src/app/dashboard/new/page.tsx", "r") as f:
    page_content = f.read()

page_content = page_content.replace('span={1}', 'span={"1"}')

with open("apps/web/src/app/dashboard/new/page.tsx", "w") as f:
    f.write(page_content)
