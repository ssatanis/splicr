const fs = require('fs');
const file = 'apps/web/src/components/dashboard/intake/upload-flow.tsx';
let content = fs.readFileSync(file, 'utf8');

// 1. Remove "No tables require manual mapping" text
content = content.replace(
  /\{sourceTables\.length > 0 \? interpretations : \([\s\S]*?<p className="text-\[13px\] text-muted">No tables require manual mapping\.<\/p>\[\s\S]*?<\/div>[\s\S]*?\)\}/,
  '{sourceTables.length > 0 ? interpretations : null}'
);

// wait, the actual text is:
/*
            {sourceTables.length > 0 ? interpretations : (
              <div className="rounded-sm border border-stone-200 bg-white p-6">
                <p className="text-[13px] text-muted">No tables require manual mapping.</p>
              </div>
            )}
*/
