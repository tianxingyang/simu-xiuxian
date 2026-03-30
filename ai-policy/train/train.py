"""Train a PPO policy for the xiuxian cultivator behavior decision.

Usage:
    uv pip install -r requirements.txt
    python train.py [--timesteps N] [--seed S] [--output DIR]
"""

from __future__ import annotations

import argparse
from pathlib import Path

from stable_baselines3 import PPO
from stable_baselines3.common.env_util import make_vec_env

from env import XiuxianEnv, load_config


def main() -> None:
    parser = argparse.ArgumentParser(description="Train xiuxian RL policy")
    parser.add_argument("--timesteps", type=int, default=1_000_000, help="Total training timesteps")
    parser.add_argument("--seed", type=int, default=42, help="Random seed")
    parser.add_argument("--output", type=str, default=str(Path(__file__).resolve().parent / "model"), help="Model output directory")
    parser.add_argument("--n-envs", type=int, default=8, help="Number of parallel environments")
    args = parser.parse_args()

    output = Path(args.output)
    output.mkdir(parents=True, exist_ok=True)

    cfg = load_config()
    net_arch = cfg["network"]["hidden"]
    n_features = len(cfg["features"])
    print(f"Training PPO for {args.timesteps} timesteps (seed={args.seed}, n_envs={args.n_envs})")
    print(f"Config v{cfg['version']}: {n_features} features, net_arch={net_arch}")

    env = make_vec_env(
        XiuxianEnv,
        n_envs=args.n_envs,
        seed=args.seed,
    )

    model = PPO(
        "MlpPolicy",
        env,
        verbose=1,
        seed=args.seed,
        learning_rate=3e-4,
        n_steps=2048,
        batch_size=256,
        n_epochs=10,
        gamma=0.995,
        gae_lambda=0.95,
        clip_range=0.2,
        ent_coef=0.01,
        policy_kwargs={
            "net_arch": net_arch,
        },
    )

    model.learn(total_timesteps=args.timesteps)
    model.save(output / "ppo_xiuxian")
    print(f"Model saved to {output / 'ppo_xiuxian'}")


if __name__ == "__main__":
    main()
