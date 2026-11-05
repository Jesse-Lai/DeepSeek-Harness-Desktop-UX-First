import { stat, readdir } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { supportsNativeCompanion } from '../src/companion.js';
if (supportsNativeCompanion()) {
  const root = fileURLToPath(new URL('../', import.meta.url));
  const executable = join(root, 'dist/native/DSH Companion.app/Contents/MacOS/JesseCompanion');
  const built = await stat(executable).then(s=>s.mtimeMs).catch(()=>0);
  const source = join(root, 'native/DSHCompanion/Sources/JesseCompanion');
  const entries = (await readdir(source)).filter(n=>n.endsWith('.swift'));
  const times = await Promise.all(entries.map(n=>stat(join(source,n)).then(s=>s.mtimeMs)));
  if (!built || times.some(time=>time>built)) {
    const child=spawn(process.execPath,[join(root,'scripts/build-companion.js')],{stdio:'inherit'});
    const code=await new Promise((resolve,reject)=>{child.once('error',reject);child.once('exit',resolve);});
    if(code!==0) process.exit(code??1);
  }
}
