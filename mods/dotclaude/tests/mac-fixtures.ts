// Representative output of macOS top / memory_pressure / df / pmset / ps, and of
// `docker ps --format '{{.Names}}\t{{.Status}}'`: synthetic values (round numbers, a fake
// battery id, a generic process list) in the commands' exact formats. Kept inline because
// tests cannot read files.

export const TOP = "Processes: 600 total, 2 running, 598 sleeping, 3000 threads \n2026/01/01 10:00:00\nLoad Avg: 2.00, 2.00, 2.00 \nCPU usage: 20.00% user, 10.00% sys, 70.00% idle \nSharedLibs: 1000M resident, 200M data, 300M linkedit.\nMemRegions: 400000 total, 7000M resident, 600M private, 4000M shared.\nPhysMem: 30G used (3000M wired, 3000M compressor), 600M unused.\nVM: 500T vsize, 50G framework vsize, 0(0) swapins, 0(0) swapouts.\nNetworks: packets: 1000000/1G in, 500000/1G out.\nDisks: 1000000/100G read, 1000000/100G written.\n\n\nProcesses: 600 total, 3 running, 597 sleeping, 3000 threads \n2026/01/01 10:00:01\nLoad Avg: 2.00, 2.00, 2.00 \nCPU usage: 20.00% user, 10.00% sys, 70.00% idle \nSharedLibs: 1000M resident, 200M data, 300M linkedit.\nMemRegions: 0 total, 0B resident, 600M private, 4000M shared.\nPhysMem: 30G used (3000M wired, 3000M compressor), 600M unused.\nVM: 500T vsize, 50G framework vsize, 0(0) swapins, 0(0) swapouts.\nNetworks: packets: 1000000/1G in, 500000/1G out.\nDisks: 1000000/100G read, 1000000/100G written.\n\n\n"

export const MEMORY_PRESSURE = "The system has 34359738368 (2097152 pages with a page size of 16384).\n\nStats: \nPages free: 30000 \nPages purgeable: 50000 \nPages purged: 1000000 \n\nSwap I/O:\nSwapins: 0 \nSwapouts: 0 \n\nPage Q counts:\nPages active: 800000 \nPages inactive: 800000 \nPages speculative: 7000 \nPages throttled: 0 \nPages wired down: 190000 \n\nCompressor Stats:\nPages used by compressor: 200000 \nPages decompressed: 2000000 \nPages compressed: 5000000 \n\nFile I/O:\nPageins: 20000000 \nPageouts: 5000 \n\nSystem-wide memory free percentage: 80%\n"

export const DF = "Filesystem     1024-blocks      Used Available Capacity iused     ifree %iused  Mounted on\n/dev/disk3s1s1   500000000  10000000  300000000    40%  400000 3000000000    0%   /\n"

export const PMSET_BATT = "Now drawing from 'AC Power'\n -InternalBattery-0 (id=1234567)\t100%; finishing charge; 0:05 remaining present: true\n"

export const PMSET_THERM = "Note: No thermal warning level has been recorded\nNote: No performance warning level has been recorded\nNote: No CPU power status has been recorded\n"

export const PS = "  PID  %CPU COMM\n 1001  20.0 Code Helper\n 1002  15.0 WindowServer\n 1003   8.0 node\n 1004   6.0 Code Helper (Renderer)\n 1005   5.0 Safari\n"

export const DOCKER_PS = 'web-dev\tUp 3 hours\npostgres\tUp 26 hours (healthy)\n'

// A Mac without a battery prints only the power source line.
export const PMSET_BATT_DESKTOP = "Now drawing from 'AC Power'\n"
