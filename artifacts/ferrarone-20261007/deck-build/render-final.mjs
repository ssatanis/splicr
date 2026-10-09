import fs from 'node:fs/promises';import path from 'node:path';
import {FontLibrary} from '/Users/sahaj/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/@oai/artifact-tool/node_modules/skia-canvas/lib/index.mjs';
import {PresentationFile,FileBlob} from '@oai/artifact-tool';
const dir=new URL('.',import.meta.url).pathname;FontLibrary.use('Inter',path.join(dir,'fonts/Inter.ttf'));FontLibrary.use('Instrument Serif',path.join(dir,'fonts/InstrumentSerif.ttf'));
const p=await PresentationFile.importPptx(await FileBlob.load(path.join(dir,'../presentation/SplicR-Varmus-lab-v10.pptx')));await fs.mkdir(path.join(dir,'final-previews'),{recursive:true});for(let i=0;i<p.slides.items.length;i++){const b=await p.export({slide:p.slides.items[i],format:'png'});await fs.writeFile(path.join(dir,'final-previews',`slide-${i+1}.png`),Buffer.from(await b.arrayBuffer()));}console.log(p.slides.items.length+' final slides rendered');
