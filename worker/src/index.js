import { startHttp } from './http.js';
import { startSupervisor } from './poller.js';
import { migrate } from './migrate.js';
import { startMonitor } from './monitor.js';
import { startPurge } from './purge.js';

await migrate();
startHttp();
startSupervisor();
startMonitor();
startPurge();
console.log('[streamwing] worker up');

for (const sig of ['SIGTERM', 'SIGINT']) process.on(sig, () => { console.log(`[streamwing] ${sig}, exiting`); process.exit(0); });
