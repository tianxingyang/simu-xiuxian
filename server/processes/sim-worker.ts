import vm from 'node:vm';
import type { SimCommand, SimWorkerEvent } from '../ipc.js';
import type { BroadcastMsg, Command, RunnerIO } from '../runner.js';
import { Runner } from '../runner.js';
import { initSchema } from '../db.js';
import { initLogger, getLogger } from '../logger.js';
import { getSimTuning } from '../../src/sim-tuning.js';
import { LEVEL_NAMES, LEVEL_COUNT, MAP_SIZE, REGION_NAMES } from '../../src/constants/index.js';

initLogger({ tag: 'sim' });
initSchema();
const log = getLogger('worker');

function send(msg: SimWorkerEvent): void {
  if (process.send) process.send(msg);
}

let _clientCount = 0;

const io: RunnerIO = {
  broadcast(msg: BroadcastMsg) {
    switch (msg.type) {
      case 'tick':
        send({ type: 'sim:tick', tickId: msg.tickId, summaries: msg.summaries, events: msg.events });
        break;
      case 'paused':
        send({ type: 'sim:paused', reason: msg.reason });
        break;
      case 'reset-done':
        send({ type: 'sim:resetDone' });
        break;
    }
  },
  clientCount: () => _clientCount,
};

const runner = new Runner(io);

if (runner.restore()) {
  log.info('sim_state restored');
}

// Read-only proxy for vm sandbox — prevents mutation of engine objects
function makeReadonlyProxy<T extends object>(target: T): T {
  return new Proxy(target, {
    set() { throw new Error('Cannot modify engine state'); },
    deleteProperty() { throw new Error('Cannot modify engine state'); },
    get(obj, prop) {
      const val = Reflect.get(obj, prop);
      if (typeof val === 'function') return val.bind(obj);
      if (val !== null && typeof val === 'object') return makeReadonlyProxy(val as object);
      return val;
    },
  });
}

send({ type: 'sim:state', state: runner.getState() });
send({ type: 'sim:ready' });

process.on('message', (raw: SimCommand) => {
  switch (raw.type) {
    case 'sim:start': {
      const cmd: Command = { type: 'start', speed: raw.speed, seed: raw.seed, initialPop: raw.initialPop };
      runner.dispatch(cmd);
      break;
    }
    case 'sim:pause':
      runner.dispatch({ type: 'pause' });
      break;
    case 'sim:step':
      runner.dispatch({ type: 'step' });
      break;
    case 'sim:setSpeed':
      runner.dispatch({ type: 'setSpeed', speed: raw.speed });
      break;
    case 'sim:reset':
      runner.dispatch({ type: 'reset', seed: raw.seed, initialPop: raw.initialPop });
      break;
    case 'sim:ack':
      runner.dispatch({ type: 'ack', tickId: raw.tickId });
      break;
    case 'sim:getState':
      send({ type: 'sim:state', state: runner.getState() });
      break;
    case 'sim:getWorldContext': {
      const ctx = runner.getWorldContext();
      if (ctx) send({ type: 'sim:worldContext', context: ctx });
      break;
    }
    case 'sim:clientCount':
      _clientCount = raw.count;
      if (raw.count === 0) runner.onClientDisconnect();
      break;
    case 'sim:evalQuery': {
      const { queryId, expression } = raw;
      const engine = runner.getEngine();
      if (!engine) {
        send({ type: 'sim:queryResult', queryId, error: 'Engine not initialized' });
        break;
      }
      try {
        const identity = runner.getIdentity();
        const sandbox: Record<string, unknown> = {
          engine: makeReadonlyProxy(engine),
          tuning: makeReadonlyProxy(getSimTuning()),
          LEVEL_NAMES,
          LEVEL_COUNT,
          REGION_NAMES,
          MAP_SIZE,
          Array,
          Math,
          JSON,
          Object,
          String,
          Number,
          Boolean,
          Map,
          Set,
          parseInt,
          parseFloat,
          isNaN,
          isFinite,
        };
        if (identity) sandbox.identity = makeReadonlyProxy(identity);
        const ctx = vm.createContext(sandbox);
        const result = vm.runInContext(expression, ctx, { timeout: 1000 });
        const serialized = JSON.parse(JSON.stringify(result ?? null));
        send({ type: 'sim:queryResult', queryId, result: serialized });
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        log.warn(`evalQuery failed: ${msg}`);
        send({ type: 'sim:queryResult', queryId, error: msg });
      }
      break;
    }
  }
});

process.on('SIGTERM', () => {
  log.info('shutting down');
  process.exit(0);
});
