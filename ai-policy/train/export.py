"""Export trained PPO policy weights to JSON for TS inference.

Usage:
    python export.py [--model PATH] [--output PATH]

Output JSON format:
    {
      "version": <config version>,
      "layers": [
        { "w": [[...], ...], "b": [...] },
        ...
      ]
    }

Weight matrix `w` has shape [input_dim][output_dim] -- w[i] is the weights
from input neuron i to all output neurons.
"""

from __future__ import annotations

import argparse
import json
from pathlib import Path

import torch
from stable_baselines3 import PPO

from env import load_config

_ROOT = Path(__file__).resolve().parent.parent


def export_weights(model_path: str, output_path: str) -> None:
    cfg = load_config()
    version = cfg["version"]

    model = PPO.load(model_path)
    policy = model.policy

    # SB3 MlpPolicy stores the policy network in policy.mlp_extractor.policy_net
    # and the final action head in policy.action_net.
    extractor = policy.mlp_extractor.policy_net  # type: ignore[union-attr]
    action_net = policy.action_net  # type: ignore[union-attr]

    layers: list[dict[str, list]] = []

    # Hidden layers from the MLP extractor
    for module in extractor:
        if isinstance(module, torch.nn.Linear):
            # module.weight has shape [out, in], transpose to [in, out]
            w = module.weight.detach().cpu().numpy().T.tolist()
            b = module.bias.detach().cpu().numpy().tolist()
            layers.append({"w": w, "b": b})

    # Final action layer (logits)
    if isinstance(action_net, torch.nn.Linear):
        w = action_net.weight.detach().cpu().numpy().T.tolist()
        b = action_net.bias.detach().cpu().numpy().tolist()
        layers.append({"w": w, "b": b})

    result = {"version": version, "layers": layers}

    out = Path(output_path)
    out.parent.mkdir(parents=True, exist_ok=True)
    with open(out, "w") as f:
        json.dump(result, f)

    total_params = sum(
        len(layer["w"]) * len(layer["w"][0]) + len(layer["b"])
        for layer in layers
    )
    print(f"Exported {len(layers)} layers ({total_params} parameters) to {out}")
    print(f"Version: {version}")


def main() -> None:
    parser = argparse.ArgumentParser(description="Export PPO weights to JSON")
    default_model = str(Path(__file__).resolve().parent / "model" / "ppo_xiuxian")
    default_output = str(_ROOT / "weights" / "v1.json")

    parser.add_argument("--model", type=str, default=default_model, help="Path to saved SB3 model (without .zip)")
    parser.add_argument("--output", type=str, default=default_output, help="Output JSON path")
    args = parser.parse_args()

    export_weights(args.model, args.output)


if __name__ == "__main__":
    main()
