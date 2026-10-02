import { spawn } from 'node:child_process';
const g = spawn(process.execPath, ['--input-type=module', '-e',
  'setTimeout(() => process.exit(0), 3000);'],
  { stdio: ['ignore', 'ignore', 'ignore'], shell: false, detached: false });
process.send?.({ type: 'ready', child: process.pid, grandchild: g.pid });
setTimeout(() => { g.kill('SIGKILL'); process.exit(0); }, 3000);
