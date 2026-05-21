import { useState, useEffect, useCallback, useRef, memo } from 'react';
import { Play, Pause, FastForward, RotateCcw, Zap, Info, Cpu, Braces, BrainCircuit, Users, Split } from 'lucide-react';

interface EntropyData {
  epoch: number;
  poolEntropy: number;
  arenaEntropy: number;
}

interface HistoryItem {
  interactionNum: number;
  idxA: number;
  idxB: number;
  dataA: Uint8Array;
  dataB: Uint8Array;
  entropy: number | string;
}

interface ArenaState {
  idxA: number;
  idxB: number;
  tape: Uint8Array;
  ip: number;
  h0: number;
  h1: number;
  cycles: number;
  status: 'idle' | 'running' | 'halted';
}

// SPECIFICATION: arXiv:2406.19108 "Computational Life"
const POOL_SIZE = 131072; // The paper's size (N = 2^17)
const PROG_SIZE = 64;
const TAPE_SIZE = 128; // Concatenated Block A + Block B
const MAX_CYCLES = 8192; // 2^13 cycles per interaction
const INSTRUCTIONS = "<>{}-+.,[]";

// Utility: Maps instruction chars to distinct, bright colors. Noise bytes are dark.
const getByteColor = (byte: number, isBlockB: boolean = false): string => {
  const char = String.fromCharCode(byte);
  switch(char) {
    case '<': return '#ef4444'; // red-500
    case '>': return '#f97316'; // orange-500
    case '{': return '#eab308'; // yellow-500
    case '}': return '#84cc16'; // lime-500
    case '-': return '#06b6d4'; // cyan-500
    case '+': return '#3b82f6'; // blue-500
    case '.': return '#8b5cf6'; // violet-500
    case ',': return '#d946ef'; // fuchsia-500
    case '[': return '#f43f5e'; // rose-500
    case ']': return '#14b8a6'; // teal-500
    default: return byte === 0 
        ? (isBlockB ? '#1e293b' : '#0f172a') 
        : (isBlockB ? '#334155' : '#1e293b'); // Lighter slate for Block B empty
  }
};

// Computes Shannon Entropy (used to detect phase transitions from noise to structure)
const calculateEntropy = (tape: Uint8Array): number => {
  const counts = new Uint32Array(256);
  for(let i=0; i<tape.length; i++) counts[tape[i]]++;
  let entropy = 0;
  for(let i=0; i<256; i++) {
    if(counts[i] > 0) {
      let p = counts[i] / tape.length;
      entropy -= p * Math.log2(p);
    }
  }
  return entropy; // Return raw float instead of string for precise charting
};

// Generate true random bytes using Crypto API for the initial soup
const getSeedBytes = (size: number): Uint8Array => {
  const bytes = new Uint8Array(size);
  const MAX_CHUNK = 65536; // Web Crypto API limit per call
  for (let offset = 0; offset < size; offset += MAX_CHUNK) {
    const chunk = new Uint8Array(Math.min(MAX_CHUNK, size - offset));
    window.crypto.getRandomValues(chunk);
    bytes.set(chunk, offset);
  }
  return bytes;
};

// BFF Step Logic (BFF Interpreter Core)
const computeBFFStep = (state: ArenaState): ArenaState => {
  let { tape, ip, h0, h1, cycles } = state;

  if (ip < 0 || ip >= TAPE_SIZE || cycles >= MAX_CYCLES) {
    return { ...state, status: 'halted' };
  }

  const newTape = new Uint8Array(tape);
  const instrCode = newTape[ip];
  const instr = String.fromCharCode(instrCode);
  let nextIp = ip + 1;
  let newH0 = h0;
  let newH1 = h1;

  switch(instr) {
    case '<': newH0 = (h0 - 1 + TAPE_SIZE) % TAPE_SIZE; break;
    case '>': newH0 = (h0 + 1) % TAPE_SIZE; break;
    case '{': newH1 = (h1 - 1 + TAPE_SIZE) % TAPE_SIZE; break;
    case '}': newH1 = (h1 + 1) % TAPE_SIZE; break;
    case '-': newTape[newH0] = (newTape[newH0] - 1 + 256) % 256; break;
    case '+': newTape[newH0] = (newTape[newH0] + 1) % 256; break;
    case '.': newTape[newH1] = newTape[newH0]; break;
    case ',': newTape[newH0] = newTape[newH1]; break;
    case '[':
      if (newTape[newH0] === 0) {
        let depth = 1; nextIp = ip + 1;
        while (depth > 0 && nextIp < TAPE_SIZE) {
          let c = String.fromCharCode(newTape[nextIp]);
          if (c === '[') depth++; else if (c === ']') depth--;
          nextIp++;
        }
        if (depth > 0) nextIp = TAPE_SIZE; // Halt on unmatched
      }
      break;
    case ']':
      if (newTape[newH0] !== 0) {
        let depth = 1; nextIp = ip - 1;
        while (depth > 0 && nextIp >= 0) {
          let c = String.fromCharCode(newTape[nextIp]);
          if (c === ']') depth++; else if (c === '[') depth--;
          nextIp--;
        }
        if (depth > 0) nextIp = TAPE_SIZE; // Halt on unmatched
        else nextIp += 2; // Jump to start of loop body
      }
      break;
  }

  const status = (nextIp < 0 || nextIp >= TAPE_SIZE || cycles + 1 >= MAX_CYCLES) ? 'halted' : 'running';

  return {
    ...state,
    tape: newTape,
    ip: nextIp,
    h0: newH0,
    h1: newH1,
    cycles: cycles + 1,
    status
  };
};

// Pure-JS Optimized Interaction Loop for Fast Forwarding
const simulateInteractionFast = (pAIdx: number, pBIdx: number, pool: Uint8Array, tempTape: Uint8Array): void => {
    // Load concatenanted blocks from huge pool
    tempTape.set(pool.subarray(pAIdx * PROG_SIZE, (pAIdx + 1) * PROG_SIZE), 0);
    tempTape.set(pool.subarray(pBIdx * PROG_SIZE, (pBIdx + 1) * PROG_SIZE), PROG_SIZE);

    let ip = 0, h0 = 0, h1 = 0, cycles = 0;

    while (ip >= 0 && ip < TAPE_SIZE && cycles < MAX_CYCLES) {
        const instr = tempTape[ip];
        let nextIp = ip + 1;
        cycles++;

        if (instr === 60) h0 = (h0 - 1 + TAPE_SIZE) % TAPE_SIZE; // <
        else if (instr === 62) h0 = (h0 + 1) % TAPE_SIZE; // >
        else if (instr === 123) h1 = (h1 - 1 + TAPE_SIZE) % TAPE_SIZE; // {
        else if (instr === 125) h1 = (h1 + 1) % TAPE_SIZE; // }
        else if (instr === 45) tempTape[h0] = (tempTape[h0] - 1 + 256) % 256; // -
        else if (instr === 43) tempTape[h0] = (tempTape[h0] + 1) % 256; // +
        else if (instr === 46) tempTape[h1] = tempTape[h0]; // .
        else if (instr === 44) tempTape[h0] = tempTape[h1]; // ,
        else if (instr === 91) { // [
            if (tempTape[h0] === 0) {
                let depth = 1; nextIp = ip + 1;
                while (depth > 0 && nextIp < TAPE_SIZE) {
                    let c = tempTape[nextIp];
                    if (c === 91) depth++; else if (c === 93) depth--;
                    nextIp++;
                }
                if (depth > 0) nextIp = TAPE_SIZE;
            }
        } else if (instr === 93) { // ]
            if (tempTape[h0] !== 0) {
                let depth = 1; nextIp = ip - 1;
                while (depth > 0 && nextIp >= 0) {
                    let c = tempTape[nextIp];
                    if (c === 93) depth++; else if (c === 91) depth--;
                    nextIp--;
                }
                if (depth > 0) nextIp = TAPE_SIZE;
                else nextIp += 2;
            }
        }
        ip = nextIp;
    }
    // Write-back the split blocks to the pool (Overwrite logic)
    pool.set(tempTape.subarray(0, PROG_SIZE), pAIdx * PROG_SIZE);
    pool.set(tempTape.subarray(PROG_SIZE, TAPE_SIZE), pBIdx * PROG_SIZE);
};

// Component to render the dynamic Epoch vs Entropy line chart
const EntropyChart = memo(({ data }: { data: EntropyData[] }) => {
  const maxEpoch = data.length > 0 ? Math.max(...data.map(d => d.epoch)) : 0;
  // Step X axis scale: 10 -> 100 -> 1000 -> 10000, then grow linearly in 10k steps
  const baseMax = Math.max(10, maxEpoch);
  const xAxisMax = baseMax <= 10000 
    ? ([10, 100, 1000, 10000].find(v => v >= baseMax) || 10)
    : Math.ceil(baseMax / 10000) * 10000;

  const width = 500;
  const height = 180;
  const padX = 35;
  const padY = 20;
  const plotW = width - padX - 10;
  const plotH = height - padY * 2;

  const getPoolPoints = () => {
    return data.map((d) => {
      const x = padX + (d.epoch / xAxisMax) * plotW;
      const y = padY + plotH - (d.poolEntropy / 8.0) * plotH;
      return `${x},${y}`;
    }).join(" ");
  };

  const getArenaPoints = () => {
    return data.map((d) => {
      const x = padX + (d.epoch / xAxisMax) * plotW;
      const y = padY + plotH - ((d.arenaEntropy || 0) / 8.0) * plotH;
      return `${x},${y}`;
    }).join(" ");
  };

  const currentPoolEnt = data.length > 0 ? data[data.length - 1].poolEntropy.toFixed(4) : '8.0000';
  const currentArenaEnt = data.length > 0 ? (data[data.length - 1].arenaEntropy || 0).toFixed(2) : '0.00';

  return (
    <div className="w-full flex flex-col gap-1">
       <div className="flex justify-between items-center text-xs text-slate-400 font-semibold uppercase tracking-wider mb-1">
         <div className="flex items-center gap-4">
           <span className="flex items-center gap-1.5"><BrainCircuit className="w-3 h-3 text-cyan-400" /> Pool: <span className="text-cyan-400 font-mono">{currentPoolEnt}</span></span>
           <span className="flex items-center gap-1.5"><Cpu className="w-3 h-3 text-fuchsia-400" /> Arena Sample: <span className="text-fuchsia-400 font-mono">{currentArenaEnt}</span></span>
         </div>
       </div>
       <svg viewBox={`0 0 ${width} ${height}`} className="w-full h-auto overflow-visible mt-2">
         {/* Y-axis Grid (0 to 8.0 Entropy limit) */}
         {[0, 2, 4, 6, 8].map(val => {
            const y = padY + plotH - (val / 8.0) * plotH;
            return (
              <g key={`y-${val}`}>
                <line x1={padX} y1={y} x2={width-10} y2={y} stroke="#334155" strokeWidth="1" strokeDasharray="3 3" />
                <text x={padX - 8} y={y + 3} fill="#64748b" fontSize="10" textAnchor="end" fontFamily="monospace">{val}</text>
              </g>
            );
         })}
         {/* X-axis labels (Epochs) */}
         {[0, xAxisMax/2, xAxisMax].map((val, i) => {
            const x = padX + (val / xAxisMax) * plotW;
            return (
              <text key={`x-${i}`} x={x} y={height - 2} fill="#64748b" fontSize="10" textAnchor="middle" fontFamily="monospace">
                {val >= 1000 ? (val/1000) + 'k' : val}
              </text>
            );
         })}
         
         {/* The Arena Data Line (Faded/Dotted) */}
         {data.length > 1 && (
           <polyline points={getArenaPoints()} fill="none" stroke="#d946ef" strokeWidth="1" strokeDasharray="2 3" opacity="0.6" />
         )}
         {/* The Global Pool Data Line */}
         {data.length > 1 && (
           <polyline points={getPoolPoints()} fill="none" stroke="#06b6d4" strokeWidth="2" strokeLinejoin="round" />
         )}
         
         {/* Pulse dot at the current leading edge */}
         {data.length > 0 && (
           <circle 
             cx={padX + (data[data.length - 1].epoch / xAxisMax) * plotW} 
             cy={padY + plotH - (data[data.length - 1].poolEntropy / 8.0) * plotH} 
             r="3" 
             fill="#22d3ee" 
           />
         )}
       </svg>
       <p className="text-[10px] text-slate-500 mt-2 text-center">
         Note: Global Pool Entropy stays near 8.0000 until spontaneous replicators emerge. This phase transition takes anywhere from 2,000 to 16,000 epochs (and happens in ~40% of runs).
       </p>
    </div>
  );
});

// Component to render a compressed visual of a Program History Item
const HistoryItemView = memo(({
  idxA,
  idxB,
  dataA,
  dataB,
  entropy,
  isCurrent
}: {
  interactionNum?: number;
  idxA: number;
  idxB: number;
  dataA: Uint8Array;
  dataB: Uint8Array;
  entropy: number | string;
  isCurrent?: boolean;
}) => {
  return (
    <div className={`p-3 border-b border-slate-800 flex flex-col gap-2 ${isCurrent ? 'bg-blue-950/20 ring-1 ring-blue-500/50' : 'bg-[#0a0f18] hover:bg-slate-900/50'}`}>
      <div className="flex justify-between items-center text-xs font-mono text-slate-500">
        <span>{isCurrent ? <span className="text-blue-400 font-bold animate-pulse">● LIVE ARENA PAIR</span> : `Interaction Entropy: ${typeof entropy === 'number' ? entropy.toFixed(2) : entropy}`}</span>
        <div className="flex gap-4">
          <span className="text-blue-400">Prog {idxA}</span>
          <span>↔</span>
          <span className="text-red-400">Prog {idxB}</span>
        </div>
      </div>
      <div className="grid grid-cols-2 gap-2">
        {/* Block A (Source) */}
        <div className="grid grid-cols-8 gap-0.5 aspect-square border border-blue-500/20 p-1 rounded-sm">
          {Array.from(dataA).map((byte, i) => (
            <div key={`a-${i}`} className="aspect-square rounded-[1px]" style={{ backgroundColor: getByteColor(byte, false) }} title={String.fromCharCode(byte)} />
          ))}
        </div>
        {/* Block B (Target) */}
        <div className="grid grid-cols-8 gap-0.5 aspect-square border border-red-500/20 p-1 rounded-sm">
          {Array.from(dataB).map((byte, i) => (
            <div key={`b-${i}`} className="aspect-square rounded-[1px]" style={{ backgroundColor: getByteColor(byte, true) }} title={String.fromCharCode(byte)} />
          ))}
        </div>
      </div>
    </div>
  );
});

export default function App() {
  // PERSISTENT THE HUGE POOL (N=131072) - Only initialized once
  const poolRef = useRef<Uint8Array | null>(null);
  const poolInitialized = useRef<boolean>(false);

  // Simulation State
  const [interactionCount, setInteractionCount] = useState<number>(0);
  const [pairHistory, setPairHistory] = useState<HistoryItem[]>([]); // [ {interactionNum, idxA, idxB, dataA, dataB, entropy } ]
  const [arena, setArena] = useState<ArenaState>({
    idxA: 0, idxB: 0, tape: new Uint8Array(TAPE_SIZE), ip: 0, h0: 0, h1: 0, cycles: 0, status: 'idle'
  });
  
  const [autoPlay, setAutoPlay] = useState<boolean>(false);
  const [autoEpochs, setAutoEpochs] = useState<boolean>(true);
  const [speed, setSpeed] = useState<number>(10); // steps per tick
  const [simProgress, setSimProgress] = useState<{ active: boolean; current: number; total: number }>({ active: false, current: 0, total: 0 });
  const [entropyHistory, setEntropyHistory] = useState<EntropyData[]>([]); // Tracks global pool entropy over epochs
  const [customEpochs, setCustomEpochs] = useState<number>(1000);

  // Correctly loads the next visual pair from the persistent pool
  const loadNextPair = useCallback(() => {
    if(!poolRef.current) return;
    const pool = poolRef.current;
    
    // Pick two random indices from the huge pool
    const idxA = Math.floor(Math.random() * POOL_SIZE);
    let idxB = Math.floor(Math.random() * POOL_SIZE);
    while (idxB === idxA) idxB = Math.floor(Math.random() * POOL_SIZE);
    
    const newTape = new Uint8Array(TAPE_SIZE);
    newTape.set(pool.subarray(idxA * PROG_SIZE, (idxA + 1) * PROG_SIZE), 0);
    newTape.set(pool.subarray(idxB * PROG_SIZE, (idxB + 1) * PROG_SIZE), PROG_SIZE);

    setArena({
      idxA, idxB, tape: newTape, ip: 0, h0: 0, h1: 0, cycles: 0, status: 'running'
    });
  }, []);

  // Initialize huge random pool ONCE
  useEffect(() => {
    if (!poolInitialized.current) {
        console.log("Initializing Primordial Soup (131,072 programs, ~8.4 MB)...");
        poolRef.current = getSeedBytes(POOL_SIZE * PROG_SIZE);
        poolInitialized.current = true;
        
        // Setup initial global entropy point at epoch 0
        const initialEntropy = calculateEntropy(poolRef.current);
        setEntropyHistory([{ epoch: 0, poolEntropy: initialEntropy, arenaEntropy: initialEntropy }]);

        loadNextPair(); // Initial load for arena
    }
  }, [loadNextPair]);

  // Split logic: write visual results back to huge pool and add to timeline
  const finalizeEpoch = useCallback(() => {
    if(!poolRef.current) return;
    const pool = poolRef.current;
    
    // Overwrite parents in the huge pool
    pool.set(arena.tape.subarray(0, PROG_SIZE), arena.idxA * PROG_SIZE);
    pool.set(arena.tape.subarray(PROG_SIZE, TAPE_SIZE), arena.idxB * PROG_SIZE);

    // Update global interaction count and check for an exact epoch completion
    setInteractionCount(c => {
      const nextCount = c + 1;
      if (nextCount % (POOL_SIZE / 2) === 0) {
         const currentEpoch = nextCount / (POOL_SIZE / 2);
         const arenaEnt = calculateEntropy(arena.tape);
         setEntropyHistory(prev => [...prev, { epoch: currentEpoch, poolEntropy: poolRef.current ? calculateEntropy(poolRef.current) : 8.0, arenaEntropy: arenaEnt }]);
      }
      return nextCount;
    });

    // Update the timeline (history)
    const newHistoryItem = {
      interactionNum: interactionCount + 1,
      idxA: arena.idxA,
      idxB: arena.idxB,
      // We take copies here for the visual snapshot
      dataA: new Uint8Array(arena.tape.subarray(0, PROG_SIZE)), 
      dataB: new Uint8Array(arena.tape.subarray(PROG_SIZE, TAPE_SIZE)),
      entropy: calculateEntropy(arena.tape),
    };

    setPairHistory(prev => [newHistoryItem, ...prev].slice(0, 8)); // Keep last 8

    loadNextPair();
  }, [arena, loadNextPair, interactionCount]);

  // Real-time visual execution loop
  useEffect(() => {
    let timer: any;
    if (autoPlay && arena.status === 'running') {
      timer = setTimeout(() => {
        setArena(prev => {
          let current = prev;
          for (let i = 0; i < speed; i++) {
            current = computeBFFStep(current);
            if (current.status === 'halted') break;
          }
          return current;
        });
      }, 50);
    } else if (arena.status === 'halted' && autoEpochs) {
      timer = setTimeout(finalizeEpoch, 100); 
    }
    return () => clearTimeout(timer);
  }, [autoPlay, arena, autoEpochs, speed, finalizeEpoch]);

  // Massive Fast Forward Simulation Engine (Yielding version)
  const simulateEpochsAsync = async (numEpochs: number) => {
    if(!poolRef.current) return;
    setSimProgress({ active: true, current: 0, total: numEpochs });
    setAutoPlay(false);
    console.log(`Starting massive simulation of ${numEpochs} epochs...`);
    
    const pool = poolRef.current;
    const tempInteractionTape = new Uint8Array(TAPE_SIZE);
    const interactionsPerEpoch = Math.floor(POOL_SIZE / 2);
    
    // Lock the starting epoch before we enter the asynchronous simulation loop
    const baseEpoch = Math.floor(interactionCount / (POOL_SIZE / 2));
    let epochsDone = 0;
    const CHUNK_SIZE = 50; // Yield to UI every 50 epochs

    while (epochsDone < numEpochs) {
        await new Promise<void>(resolve => {
            setTimeout(() => {
                const epochsToRun = Math.min(CHUNK_SIZE, numEpochs - epochsDone);
                const numInteractions = epochsToRun * interactionsPerEpoch;
                
                for (let i = 0; i < numInteractions; i++) {
                    const pAIdx = Math.floor(Math.random() * POOL_SIZE);
                    let pBIdx = Math.floor(Math.random() * POOL_SIZE);
                    while (pBIdx === pAIdx) pBIdx = Math.floor(Math.random() * POOL_SIZE);

                    simulateInteractionFast(pAIdx, pBIdx, pool, tempInteractionTape);
                }
                
                epochsDone += epochsToRun;
                setInteractionCount(c => c + numInteractions);
                setSimProgress(prev => ({ ...prev, current: epochsDone }));
                
                // Record global pool entropy for the line chart right before yielding
                const currentEpochPoint = baseEpoch + epochsDone;
                const poolEnt = calculateEntropy(pool);
                const arenaEnt = calculateEntropy(tempInteractionTape);
                setEntropyHistory(prev => [...prev, { epoch: currentEpochPoint, poolEntropy: poolEnt, arenaEntropy: arenaEnt }]);

                loadNextPair(); // Update arena visually mid-flight
                resolve();
            }, 10);
        });
    }
    
    console.log(`Finished ${numEpochs} epochs.`);
    setSimProgress({ active: false, current: 0, total: 0 });
  };

  const resetPool = () => {
    if(confirm("Reset the whole 131,072 pool to raw noise? This erases all evolved history.")) {
        console.log("Extinction event triggered: Resetting pool...");
        poolRef.current = getSeedBytes(POOL_SIZE * PROG_SIZE);
        setInteractionCount(0);
        setPairHistory([]);
        
        const initialEntropy = calculateEntropy(poolRef.current);
        setEntropyHistory([{ epoch: 0, poolEntropy: initialEntropy, arenaEntropy: initialEntropy }]);
        
        setArena(prev => ({...prev, status: 'idle'}));
        loadNextPair();
    }
  };

  return (
    <div className="min-h-screen bg-slate-950 text-slate-300 font-sans p-4 lg:p-6 selection:bg-blue-900">
      
      {/* Header */}
      <div className="max-w-[1600px] mx-auto mb-6 flex flex-col md:flex-row justify-between items-start md:items-center gap-4 border-b border-slate-800 pb-6">
        <div>
          <h1 className="text-3xl font-bold text-slate-100 flex items-center gap-3">
            <BrainCircuit className="text-rose-500 w-8 h-8" />
            Computational Life: Primordial Soup (<a href="https://arxiv.org/pdf/2406.19108.pdf" target="_blank" rel="noopener noreferrer" className="text-rose-400 hover:text-rose-300 underline decoration-rose-400/30 hover:decoration-rose-400 transition-colors">arXiv:2406.19108</a>)
          </h1>
          <p className="text-sm text-slate-400 mt-2 max-w-5xl leading-relaxed">
            Replication attempt of <i>"How Well-formed, Self-replicating Programs Emerge from Simple Interaction"</i>. This visualization uses the paper's actual <b>Pool Size (N=131,072)</b> and <b>Max Cycles (8,192)</b>. Random BFF programs concatenate, interact, and overwrite each other. No external mutation is applied. Watch the Timeline closely as self-replicators spontaneously evolve from the initial raw noise.
          </p>
        </div>
        <div className="flex flex-col gap-2 bg-slate-900 p-4 rounded-xl border border-slate-800 min-w-[240px] shadow-lg">
          <div className="text-xs uppercase tracking-wider text-slate-500 font-semibold flex items-center gap-2"><Users className="w-3 h-3"/> Pool Status (131k Slots)</div>
          <div className="flex justify-between items-end">
            <div className="text-3xl font-mono text-cyan-400">{Math.floor(interactionCount / (POOL_SIZE / 2)).toLocaleString()}</div>
            <div className="text-xs text-slate-400 mb-1">Epochs</div>
          </div>
          <div className="flex justify-between items-end">
            <div className="text-sm font-mono text-slate-400">{interactionCount.toLocaleString()}</div>
            <div className="text-xs text-slate-500 mb-1">Interactions</div>
          </div>
          <div className="flex justify-between items-end mt-1 pt-2 border-t border-slate-800">
            <div className="text-xl font-mono text-cyan-400">
              {entropyHistory.length > 0 ? entropyHistory[entropyHistory.length - 1].poolEntropy.toFixed(4) : '8.0000'}
            </div>
            <div className="text-xs text-slate-400 mb-1">Global Entropy</div>
          </div>
        </div>
      </div>

      <div className="max-w-[1600px] mx-auto grid grid-cols-1 lg:grid-cols-[2fr_1fr] gap-6">
        
        {/* Left Column: The Arena */}
        <div className="flex flex-col gap-4">
          <div className="bg-slate-900 rounded-xl border border-slate-800 shadow-xl overflow-hidden flex flex-col">
            <div className="p-4 border-b border-slate-800 bg-slate-900 flex justify-between items-center flex-wrap gap-x-6 gap-y-2">
              <div className="flex items-center gap-3">
                <Cpu className="text-cyan-500 w-5 h-5" />
                <h2 className="text-lg font-semibold text-slate-100">Interaction Arena (Visual Sample)</h2>
                <span className={`px-2 py-1 text-[10px] uppercase font-bold rounded-full ${arena.status === 'running' ? 'bg-green-500/20 text-green-400' : 'bg-rose-500/20 text-rose-400'}`}>
                  {arena.status}
                </span>
              </div>
              <div className="flex gap-x-5 gap-y-1 text-xs font-mono text-slate-400 flex-wrap">
                <div className="flex items-center gap-1.5"><span className="w-2 h-2 bg-yellow-400 rounded-full"></span> IP: {arena.ip}</div>
              <div className="flex items-center gap-1.5"><span className="w-2 h-2 bg-cyan-400 rounded-full"></span> H0: {arena.h0}</div>
              <div className="flex items-center gap-1.5"><span className="w-2 h-2 bg-fuchsia-400 rounded-full"></span> H1: {arena.h1}</div>
              <div className="ml-2">Cycles: {arena.cycles}/{MAX_CYCLES}</div>
            </div>
          </div>

          {/* Tape Visualization (Fixed Grid Layout) */}
          <div className="p-3 bg-[#0a0f18]">
            <div className="grid gap-0.5" style={{ gridTemplateColumns: 'repeat(32, minmax(0, 1fr))' }}>
              {Array.from(arena.tape).map((byte, i) => {
                const char = String.fromCharCode(byte);
                const isInstr = INSTRUCTIONS.includes(char);
                const isIp = arena.ip === i;
                const isH0 = arena.h0 === i;
                const isH1 = arena.h1 === i;
                // Block boundaries: first 64 are Block A, last 64 are Block B
                const isBlockA = i < PROG_SIZE;

                // Use inset shadows for pointers to avoid obscuring the cell's true background color
                let shadows = [];
                if (isIp) shadows.push('inset 0 0 0 2px #facc15'); // Yellow ring
                if (isH0) shadows.push('inset 0 -4px 0 0 #22d3ee'); // Cyan bottom line
                if (isH1) shadows.push('inset 0 4px 0 0 #e879f9'); // Fuchsia top line

                return (
                  <div 
                    key={i} 
                    className="relative w-full aspect-square flex items-center justify-center rounded-sm transition-colors duration-75"
                    style={{ 
                      backgroundColor: getByteColor(byte, !isBlockA),
                      boxShadow: shadows.join(', ') || 'none'
                    }}
                    title={`Idx: ${i} | Char: ${char} | Val: ${byte}`}
                  >
                    <span className={`z-10 text-[9px] md:text-xs font-mono ${isInstr ? 'font-bold text-white' : 'font-light text-slate-500'}`}>
                      {isInstr ? char : '' /* Hide numeric values to reduce noise */}
                    </span>
                  </div>
                );
              })}
            </div>
            <div className="flex justify-between text-xs font-medium text-slate-500 mt-2 font-mono uppercase tracking-wider px-1">
                <span className="text-blue-400">Prog {arena.idxA} (Source) &rarr;</span>
                <span className="text-red-400">&larr; Prog {arena.idxB} (Target)</span>
              </div>
            </div>

            {/* Execution Controls */}
            <div className="p-4 bg-slate-900 border-t border-slate-800 flex flex-wrap items-center justify-between gap-4">
              <div className="flex gap-2.5">
                <button 
                  onClick={() => setAutoPlay(!autoPlay)}
                  className={`flex items-center gap-2 px-5 py-2.5 rounded-lg font-medium transition-colors ${autoPlay ? 'bg-amber-500/20 text-amber-400 hover:bg-amber-500/30' : 'bg-green-500/20 text-green-400 hover:bg-green-500/30'}`}
                >
                  {autoPlay ? <Pause className="w-4 h-4" /> : <Play className="w-4 h-4" />}
                  {autoPlay ? 'Pause' : 'Auto Play'}
                </button>
                <button 
                  onClick={() => setArena(computeBFFStep(arena))}
                  disabled={autoPlay || arena.status === 'halted'}
                  className="flex items-center gap-2 px-5 py-2.5 rounded-lg font-medium bg-slate-800 hover:bg-slate-700 text-slate-200 disabled:opacity-50"
                >
                  Step
                </button>
                <button 
                  onClick={finalizeEpoch}
                  className="flex items-center gap-2 px-5 py-2.5 rounded-lg font-medium bg-blue-500/20 text-blue-400 hover:bg-blue-500/30"
                >
                  <Split className="w-4 h-4" /> Split & Next Pair
                </button>
              </div>

              <div className="flex items-center gap-4 bg-slate-950 p-2.5 rounded-xl border border-slate-800">
                <label className="text-xs text-slate-400 flex items-center gap-2.5">
                  Visual Speed: {speed}x
                  <input type="range" min="1" max="200" value={speed} onChange={(e) => setSpeed(Number(e.target.value))} className="w-24 h-1 accent-cyan-500 cursor-pointer" />
                </label>
                <label className="text-xs text-slate-400 flex items-center gap-2 cursor-pointer border-l border-slate-800 pl-4">
                  <input type="checkbox" checked={autoEpochs} onChange={(e) => setAutoEpochs(e.target.checked)} className="rounded border-slate-700 text-cyan-500 focus:ring-cyan-500 bg-slate-900" />
                  Auto-Epoch
                </label>
              </div>
            </div>
          </div>

          {/* Reference Pane */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {/* BFF Instructions Panel */}
            <div className="bg-slate-900 p-5 rounded-xl border border-slate-800 shadow-lg text-sm text-slate-400">
              <h3 className="text-slate-200 font-semibold mb-2 flex items-center gap-2"><Braces className="w-4 h-4 text-rose-400" /> BFF Instructions</h3>
              <ul className="grid grid-cols-2 gap-x-4 gap-y-1.5 font-mono text-xs">
                <li><span style={{color: getByteColor(60)}} className="font-bold">&lt;</span> H0 Left</li>
                <li><span style={{color: getByteColor(62)}} className="font-bold">&gt;</span> H0 Right</li>
                <li><span style={{color: getByteColor(123)}} className="font-bold">{"{"}</span> H1 Left</li>
                <li><span style={{color: getByteColor(125)}} className="font-bold">{"}"}</span> H1 Right</li>
                <li><span style={{color: getByteColor(45)}} className="font-bold">-</span> Dec H0</li>
                <li><span style={{color: getByteColor(43)}} className="font-bold">+</span> Inc H0</li>
                <li><span style={{color: getByteColor(46)}} className="font-bold">.</span> Copy H0 &rarr; H1</li>
                <li><span style={{color: getByteColor(44)}} className="font-bold">,</span> Copy H1 &rarr; H0</li>
                <li><span style={{color: getByteColor(91)}} className="font-bold">[</span> Loop if H0!=0</li>
                <li><span style={{color: getByteColor(93)}} className="font-bold">]</span> End Loop</li>
              </ul>
              <p className="mt-4 text-xs italic border-t border-slate-800 pt-3">Non-instruction bytes (dark squares) are NO-OPs. Programs are concatenated (Block A+B), run, then split. Key interaction is <span className="text-violet-400 font-medium">.</span> which allows Program A to modify Program B (Inter-block overwriting).</p>
            </div>

            <div className="bg-slate-900 p-5 rounded-xl border border-slate-800 shadow-lg text-sm text-slate-400">
            <h3 className="text-slate-200 font-semibold mb-2 flex items-center gap-2"><Info className="w-4 h-4 text-cyan-400" /> Experiment Details</h3>
            <p className="text-xs leading-relaxed">This replicates Figure 3 of the paper. Replicators (well-formed copy loops) take time to emerge from raw noise. In the paper, a state transition occurs in ~40% of runs, taking anywhere from <b>2,000 to 16,000 epochs</b> to first appear. Once a replicator is born, it usually overwrites the entire pool within 150-300 epochs, causing the Global Entropy chart to plunge. Use the NATIVE SIMULATION to jump thousands of epochs!</p>
            <div className="flex flex-col gap-2 mt-4 pt-3 border-t border-slate-800">
              <button onClick={resetPool} className="w-full text-left px-3 py-2 rounded bg-rose-950/40 hover:bg-rose-900/40 text-rose-200 text-xs transition-colors border border-rose-900/50 flex justify-between items-center">
                  <span>Trigger Extinction Event (Reset 131k Pool)</span> <RotateCcw className="w-3 h-3 text-rose-400" />
                </button>
              </div>
            </div>

            {/* The Global Entropy Chart spanning full width of reference pane */}
            <div className="md:col-span-2 bg-slate-900 p-5 rounded-xl border border-slate-800 shadow-lg">
               <EntropyChart data={entropyHistory} />
            </div>
          </div>
        </div>

        {/* Right Column: Interaction History Timeline */}
        <div className="bg-slate-900 rounded-xl border border-slate-800 shadow-xl overflow-hidden flex flex-col h-fit lg:h-[calc(100vh-140px)]">
            <div className="p-4 border-b border-slate-800 flex justify-between items-center">
              <h2 className="text-lg font-semibold text-slate-100 flex items-center gap-2">
                <BrainCircuit className="w-5 h-5 text-fuchsia-500" />
                Paired Program History (Timeline)
              </h2>
            </div>
            
            {/* The actual timeline of last 8 interactions */}
          <div className="flex-1 overflow-y-auto scrollbar-thin scrollbar-thumb-slate-700 scrollbar-track-slate-900">
            <HistoryItemView 
              idxA={arena.idxA} 
              idxB={arena.idxB} 
              dataA={arena.tape.subarray(0, PROG_SIZE)} 
              dataB={arena.tape.subarray(PROG_SIZE, TAPE_SIZE)} 
              entropy={calculateEntropy(arena.tape)} 
              isCurrent={true} 
            />
            {pairHistory.map((item, i) => (
              <HistoryItemView key={`history-${interactionCount}-${i}`} {...item} />
            ))}
          </div>

          {/* Fast Forward Controls */}
            <div className="p-5 bg-slate-950 border-t border-slate-800 space-y-3">
              <h3 className="text-xs uppercase tracking-wider text-slate-500 font-semibold mb-2">Time Machine (NATIVE SIMULATION)</h3>
              
              {simProgress.active ? (
                  <div className="flex flex-col gap-2 p-3 bg-slate-900 border border-slate-700 rounded-xl">
                      <div className="flex justify-between text-xs text-slate-400 font-medium">
                          <span>Simulating...</span>
                          <span>{simProgress.current.toLocaleString()} / {simProgress.total.toLocaleString()} Epochs</span>
                      </div>
                      <div className="w-full bg-slate-800 h-2.5 rounded-full overflow-hidden">
                          <div 
                              className="bg-cyan-500 h-full transition-all duration-300 relative"
                              style={{ width: `${(simProgress.current / simProgress.total) * 100}%` }}
                          >
                              <div className="absolute inset-0 bg-white/20 animate-pulse"></div>
                          </div>
                      </div>
                      <div className="text-[10px] text-slate-500 flex items-center gap-1.5 mt-1">
                          <RotateCcw className="w-3 h-3 animate-spin text-cyan-500" />
                          Heavy computation in progress. UI updates every 50 epochs.
                      </div>
                  </div>
              ) : (
                  <>
                      <div className="grid grid-cols-2 gap-3">
                        <button 
                            onClick={() => simulateEpochsAsync(10)}
                            className="flex items-center justify-center gap-2 px-4 py-3 rounded-lg font-medium bg-slate-800 text-slate-300 hover:bg-slate-700 transition-all text-sm"
                        >
                            <FastForward className="w-4 h-4" />
                            10 Epochs
                        </button>
                        <button 
                            onClick={() => simulateEpochsAsync(100)}
                            className="flex items-center justify-center gap-2 px-4 py-3 rounded-lg font-medium bg-blue-500/10 text-blue-400 hover:bg-blue-500/20 border border-blue-500/20 transition-all text-sm"
                        >
                            <FastForward className="w-4 h-4" />
                            100 Epochs
                        </button>
                      </div>
                      <div className="flex gap-2 mt-1">
                        <input 
                            type="number" 
                            value={customEpochs} 
                            onChange={(e) => setCustomEpochs(Math.max(1, parseInt(e.target.value) || 1))}
                            className="w-24 px-3 py-2.5 rounded-xl bg-slate-900 border border-slate-800 text-slate-100 text-sm font-mono focus:outline-none focus:border-fuchsia-500 text-center"
                            min="1"
                            title="Number of epochs to simulate"
                        />
                        <button 
                            onClick={() => simulateEpochsAsync(customEpochs)}
                            className="flex-1 flex items-center justify-center gap-2.5 px-4 py-2.5 rounded-xl font-semibold bg-fuchsia-500/10 text-fuchsia-400 hover:bg-fuchsia-500/20 border border-fuchsia-500/20 transition-all text-sm"
                        >
                            <Zap className="w-4 h-4" />
                            Simulate {customEpochs.toLocaleString()} {customEpochs === 1 ? 'Epoch' : 'Epochs'}
                        </button>
                      </div>
                  </>
              )}
              
              <p className="text-[11px] text-slate-500 mt-3 text-center leading-relaxed">
                1 Epoch = { (POOL_SIZE / 2).toLocaleString() } interactions. Fast-forward runs a pure-JS loop.
              </p>
            </div>
        </div>

      </div>
    </div>
  );
}
