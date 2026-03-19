import type { SimCommand, SimWorkerEvent } from '../ipc.js';
import type { BroadcastMsg, Command, RunnerIO } from '../runner.js';
import { Runner } from '../runner.js';
import { initSchema } from '../db.js';
import { initLogger, getLogger } from '../logger.js';

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
  }
});

process.on('SIGTERM', () => {
  log.info('shutting down');
  process.exit(0);
});
