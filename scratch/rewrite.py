import re

with open("apps/web/src/components/dashboard/intake/experiment-review.tsx", "r") as f:
    content = f.read()

# Replace the "if (plan) return ..." logic
# Find "if (plan) return <section className="rounded-sm border border-stone-200 bg-white p-6"><h3 className="text-sm font-medium text-ink">Confirm analysis plan</h3>..."

plan_start = content.find("if (plan) return <section")
plan_end = content.find("</section>;", plan_start) + len("</section>;")

plan_block = content[plan_start:plan_end].replace("if (plan) return ", "if (step === 5) return ")
plan_block = plan_block.replace("""<button type="button" disabled={disabled} onClick={() => { setPlan(false); setConfirmed(false); }} className="rounded-md border border-stone-200 px-3 text-[12px] text-ink">Edit plan</button>""", "")
plan_block = plan_block.replace("setConfirmed", "(() => {})") # We don't really need setConfirmed here if we handle it in upload-flow? 
# Wait, actually let's just let it be step 5.

content = content[:plan_start] + plan_block + content[plan_end:]

# Replace the main return block.
return_start = content.find('return <div className="space-y-4">')
return_end = content.find('</div>;', return_start) + len('</div>;')

main_block = content[return_start:return_end]

# We want to conditionally render the sections based on step
# 1. Review experiment section
sec1_start = main_block.find('<section className="rounded-sm border border-stone-200 bg-white p-6">')
sec2_start = main_block.find('<section className="rounded-sm border border-stone-200 bg-white p-6">', sec1_start + 1)
sec3_start = main_block.find('<div className="rounded-sm border border-stone-200 bg-white p-6">')

sec1 = main_block[sec1_start:sec2_start]
sec2 = main_block[sec2_start:sec3_start]
sec3_end = main_block.find('{problems.length > 0', sec3_start)
sec3 = main_block[sec3_start:sec3_end]

new_main_block = f"""return (
  <div className="space-y-4">
    {{step === 3 && (
      <>
        {sec1}
        {sec2}
      </>
    )}}
    {{step === 4 && (
      <>
        {sec3}
      </>
    )}}
  </div>
);"""

content = content[:return_start] + new_main_block + content[return_end:]

# remove unused variables
content = content.replace("const [plan, setPlan] = useState(false);", "")
# keep confirmed for step 5
# remove the old buttons
# Let's save

with open("apps/web/src/components/dashboard/intake/experiment-review.tsx", "w") as f:
    f.write(content)
