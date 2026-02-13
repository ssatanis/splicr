
import { loadRealLibrary } from '../frontend/src/lib/analysis/analysis-utils';
import path from 'path';

async function test() {
    console.log("Testing Brunello Library Loading...");
    try {
        const projectRoot = process.cwd();
        console.log(`Using project root: ${projectRoot}`);

        const library = await loadRealLibrary('brunello', projectRoot);

        console.log(`Loaded ${library.size} sgRNAs.`);

        if (library.size < 76000) {
            console.error(`FAIL: Library size (${library.size}) is too small! Expected > 76000.`);
            process.exit(1);
        }

        console.log("SUCCESS: Library loaded correctly with expected size.");
    } catch (e) {
        console.error("FAIL: Error loading library:", e);
        process.exit(1);
    }
}

test();
