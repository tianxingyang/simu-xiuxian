import type { BehaviorState } from '../types.js';

// --- Config & Weights types ---

interface FeatureDef {
  name: string;
  source: string;
  range: [number, number];
}

interface RewardDef {
  event: string;
  weight: number;
  scale_by?: string;
}

interface PolicyConfig {
  version: number;
  features: FeatureDef[];
  actions: string[];
  rewards: RewardDef[];
  network: {
    hidden: number[];
    activation: string;
  };
}

interface LayerWeights {
  w: number[][];
  b: number[];
}

interface PolicyWeights {
  version: number;
  layers: LayerWeights[];
}

// --- Activation functions ---

function relu(x: number): number {
  return x > 0 ? x : 0;
}

function applyActivation(values: number[], activation: string): number[] {
  if (activation === 'relu') {
    for (let i = 0; i < values.length; i++) {
      values[i] = relu(values[i]);
    }
  }
  // tanh / sigmoid can be added here if needed
  return values;
}

// --- Generic MLP forward pass ---

function denseLayer(input: number[], w: number[][], b: number[]): number[] {
  const outSize = b.length;
  const out = new Array<number>(outSize);
  for (let j = 0; j < outSize; j++) {
    let sum = b[j];
    for (let k = 0; k < input.length; k++) {
      sum += input[k] * w[k][j];
    }
    out[j] = sum;
  }
  return out;
}

function softmax(values: number[]): number[] {
  let maxVal = values[0];
  for (let i = 1; i < values.length; i++) {
    if (values[i] > maxVal) maxVal = values[i];
  }
  const exp = new Array<number>(values.length);
  let sum = 0;
  for (let i = 0; i < values.length; i++) {
    exp[i] = Math.exp(values[i] - maxVal);
    sum += exp[i];
  }
  for (let i = 0; i < exp.length; i++) {
    exp[i] /= sum;
  }
  return exp;
}

function forward(input: number[], weights: PolicyWeights, activation: string): number[] {
  let x = input;
  const lastIdx = weights.layers.length - 1;
  for (let i = 0; i < lastIdx; i++) {
    x = denseLayer(x, weights.layers[i].w, weights.layers[i].b);
    x = applyActivation(x, activation);
  }
  // Last layer: no activation, apply softmax
  x = denseLayer(x, weights.layers[lastIdx].w, weights.layers[lastIdx].b);
  return softmax(x);
}

// --- Weight validation ---

function validateWeights(config: PolicyConfig, weights: PolicyWeights): string | null {
  if (weights.version !== config.version) {
    return `version mismatch: config=${config.version}, weights=${weights.version}`;
  }

  const expectedLayerCount = config.network.hidden.length + 1;
  if (weights.layers.length !== expectedLayerCount) {
    return `layer count mismatch: expected ${expectedLayerCount}, got ${weights.layers.length}`;
  }

  // Validate dimensions: input -> hidden[0] -> hidden[1] -> ... -> actions
  const dims = [config.features.length, ...config.network.hidden, config.actions.length];
  for (let i = 0; i < weights.layers.length; i++) {
    const layer = weights.layers[i];
    const expectedIn = dims[i];
    const expectedOut = dims[i + 1];

    if (layer.b.length !== expectedOut) {
      return `layer ${i} bias size: expected ${expectedOut}, got ${layer.b.length}`;
    }
    if (layer.w.length !== expectedIn) {
      return `layer ${i} weight rows: expected ${expectedIn}, got ${layer.w.length}`;
    }
    for (let r = 0; r < layer.w.length; r++) {
      if (layer.w[r].length !== expectedOut) {
        return `layer ${i} weight row ${r} cols: expected ${expectedOut}, got ${layer.w[r].length}`;
      }
    }
  }

  return null;
}

// --- PolicyEngine ---

export class PolicyEngine {
  readonly config: PolicyConfig;
  readonly actions: readonly string[];
  readonly fallback: boolean;
  private readonly weights: PolicyWeights | null;
  private readonly activation: string;

  constructor(config: PolicyConfig, weights: PolicyWeights | null) {
    this.config = config;
    this.actions = config.actions;
    this.activation = config.network.activation;

    if (weights === null) {
      this.fallback = true;
      this.weights = null;
      return;
    }

    const err = validateWeights(config, weights);
    if (err !== null) {
      console.warn(`[ai-policy] weight validation failed: ${err}, falling back to rules`);
      this.fallback = true;
      this.weights = null;
      return;
    }

    this.fallback = false;
    this.weights = weights;
  }

  predict(state: number[]): number[] {
    if (this.weights === null) {
      return uniformDistribution(this.actions.length);
    }
    return forward(state, this.weights, this.activation);
  }

  selectAction(state: number[], rng: () => number): number {
    const probs = this.predict(state);
    return sampleFromDistribution(probs, rng);
  }

  actionName(index: number): BehaviorState {
    return this.actions[index] as BehaviorState;
  }
}

function uniformDistribution(n: number): number[] {
  const p = 1 / n;
  return new Array<number>(n).fill(p);
}

function sampleFromDistribution(probs: number[], rng: () => number): number {
  const r = rng();
  let cumulative = 0;
  for (let i = 0; i < probs.length; i++) {
    cumulative += probs[i];
    if (r < cumulative) return i;
  }
  return probs.length - 1;
}

// --- Loading helpers ---

export function loadPolicyConfig(configJson: string): PolicyConfig {
  return JSON.parse(configJson) as PolicyConfig;
}

export function loadPolicyWeights(weightsJson: string): PolicyWeights {
  return JSON.parse(weightsJson) as PolicyWeights;
}

export function createPolicyEngine(configJson: string, weightsJson: string | null): PolicyEngine {
  const config = loadPolicyConfig(configJson);
  const weights = weightsJson !== null ? loadPolicyWeights(weightsJson) : null;
  return new PolicyEngine(config, weights);
}
