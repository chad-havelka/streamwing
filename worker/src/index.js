import { startHttp } from './http.js';
import { startSupervisor } from './poller.js';
import { migrate } from './migrate.js';

await migrate();
startHttp();
startSupervisor();
console.log('[streamwing] worker up');

for (const sig of ['SIGTERM', 'SIGINT']) process.on(sig, () => { console.log(`[streamwing] ${sig}, exiting`); process.exit(0); });
