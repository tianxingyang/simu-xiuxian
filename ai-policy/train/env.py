"""Gymnasium environment: simplified xiuxian cultivator lifecycle.

Simulates a single cultivator from age 10 until death.
Each step = 1 year. State/action/reward definitions driven by config.json.
Now includes memory/emotional state simulation (v2).
"""

from __future__ import annotations

import json
import math
from pathlib import Path
from typing import Any

import gymnasium as gym
import numpy as np
from numpy.typing import NDArray

# ---------------------------------------------------------------------------
# Config loading
# ---------------------------------------------------------------------------

_CONFIG_PATH = Path(__file__).resolve().parent.parent / "config.json"


def load_config(path: Path = _CONFIG_PATH) -> dict[str, Any]:
    with open(path) as f:
        return json.load(f)


# ---------------------------------------------------------------------------
# Balance profile (hardcoded from v2026-03-09 preset)
# ---------------------------------------------------------------------------

_BALANCE = {
    "breakthrough": {
        "a": 0.454,
        "b": 0.085,
        "tailPenalty": {"amplitude": 1.0, "center": 4.9, "steepness": 2.2},
        "gatePenalty": {"amplitude": 0.7, "center": 4.7, "width": 1.2},
    },
    "threshold": {
        "tailBoost": {"amplitude": 1.25, "center": 6.6, "steepness": 1.74},
        "gateBoost": {"amplitude": 1.42, "center": 4.865, "width": 0.325},
        "peakBoost": {"amplitude": 1.55, "center": 5.75, "width": 0.39},
        "reliefBoost": {"amplitude": -0.8, "center": 7.0, "width": 0.28},
        "finalRelief": {"amplitude": 0, "center": 7.0, "width": 0.2},
    },
    "combat": {
        "deathBoost": {"amplitude": 0, "center": 5.5, "width": 0.7},
        "lootPenalty": {"amplitude": 0.37, "center": 5.22, "steepness": 2},
    },
    "tribulation": {
        "chance": {"amplitude": 0.02, "center": 5000, "steepness": 0.001},
        "successRate": 0.12,
    },
}

# ---------------------------------------------------------------------------
# Sim tuning defaults (from DEFAULT_SIM_TUNING)
# ---------------------------------------------------------------------------

_TUNING = {
    "mortalMaxAge": 60,
    "lv7MaxAge": 100_000,
    "lifespanDecayRate": 0.2,
    "earlySustainableMaxAge": [60, 150, 1_070, 11_070],
    "legacyLifespanBonus": [0, 100, 1_000, 10_000],
    "injuryDuration": 5,
    "injuryGrowthRate": 0.5,
    "lightInjuryDuration": 2,
    "lightInjuryGrowthRate": 0.7,
    "meridianDamageDuration": 10,
    "meridianCombatPenalty": 0.3,
    "breakthroughCooldown": 3,
    "breakthroughCultLossRate": 0.2,
    "breakthroughNothingWeight": 5.0,
    "breakthroughCultLossWeight": 2.0,
    "breakthroughInjuryWeight": 2.0,
    "defeatDeathBase": 0.40,
    "defeatDeathDecay": 0.80,
    "defeatGapSeverity": 0.3,
    "defeatMaxDeath": 0.95,
    "defeatDemotionWeight": 0.4,
    "defeatInjuryWeight": 2.9,
    "defeatCultLossWeight": 2.0,
    "defeatLightInjuryWeight": 4.0,
    "defeatMeridianWeight": 1.0,
    "defeatCultLossRate": 0.3,
    "lootBaseRate": 0.28,
    "lootVariableRate": 0.24,
    "terrainDangerEncounterFactor": [0, 0.6, 0.8, 1.0, 1.3, 1.6],
    "spiritualEnergyBreakthroughFactor": [0.5, 0.7, 0.85, 1.0, 1.2, 1.5],
    "encounterRadius": [2, 3, 4, 5, 6, 7, 8, 16],
    "courage_trough": 0.3,
    "courage_youngAmp": 0.1,
    "courage_oldAmp": 0.3,
}

# Memory tuning defaults (from DEFAULT_SIM_TUNING.memory)
_MEMORY = {
    "emotionalDecayRate": 0.95,
    "confidenceWinDelta": 0.12,
    "confidenceLossDelta": 0.15,
    "cautionHeavyInjuryDelta": 0.3,
    "cautionLightInjuryDelta": 0.1,
    "ambitionSuccessDelta": 0.2,
    "ambitionFailHighCourageDelta": 0.08,
    "ambitionFailLowCourageDelta": 0.12,
    "ambitionCourageThreshold": 0.5,
    "bloodlustKillDelta": 0.2,
    "bloodlustWinDelta": 0.05,
    "rootednessSettlingDelta": 0.02,
    "rootednessDisplaceDelta": 0.15,
    "breakthroughFearDelta": 0.15,
}

LEVEL_COUNT = 8
MAX_LEVEL = LEVEL_COUNT - 1

# Threshold log correction polynomial coefficients (from threshold.ts)
_THRESHOLD_LOG_CORR = [
    0.3715635564324824,
    0.056458557592892256,
    -0.5746050492793122,
    -0.0025278639621033328,
    0.1614363053810571,
    -0.0012504358018764136,
    -0.011075070363141586,
]


# ---------------------------------------------------------------------------
# Math helpers (ported from balance.ts)
# ---------------------------------------------------------------------------


def _sigmoid(level: float, curve: dict[str, float]) -> float:
    amp = curve["amplitude"]
    if amp == 0:
        return 0.0
    steepness = max(1e-6, curve["steepness"])
    return amp / (1.0 + math.exp(-steepness * (level - curve["center"])))


def _gaussian(level: float, curve: dict[str, float]) -> float:
    amp = curve["amplitude"]
    if amp == 0:
        return 0.0
    width = max(1e-3, curve["width"])
    normed = (level - curve["center"]) / width
    return amp * math.exp(-0.5 * normed * normed)


# ---------------------------------------------------------------------------
# Game mechanic functions (faithful ports from TS)
# ---------------------------------------------------------------------------


def _threshold_log_correction(x: float) -> float:
    c = _THRESHOLD_LOG_CORR
    val = c[6]
    for i in range(5, -1, -1):
        val = val * x + c[i]
    return val


def _compute_threshold_with_tail(level: int, tail_boost: float) -> float:
    if level <= 0:
        return 0.0
    x = level - 4
    base = 10**level * math.exp(_threshold_log_correction(x))
    return max(0.0, round(base * math.exp(tail_boost)))


def threshold(level: int) -> float:
    """Cultivation threshold to reach *level*."""
    if level <= 0:
        return 0.0
    bp = _BALANCE["threshold"]
    tail = _sigmoid(level, bp["tailBoost"])
    gate = _gaussian(level, bp["gateBoost"])
    peak = _gaussian(level, bp["peakBoost"])
    relief = _gaussian(level, bp["reliefBoost"])
    final = _gaussian(level, bp["finalRelief"])
    return _compute_threshold_with_tail(level, tail + gate + peak + relief + final)


# Pre-compute thresholds
THRESHOLDS: list[float] = [threshold(lv) for lv in range(LEVEL_COUNT)]


def breakthrough_chance(level: int) -> float:
    """Probability of successful breakthrough at *level*."""
    bp = _BALANCE["breakthrough"]
    tail = _sigmoid(level, bp["tailPenalty"])
    gate = _gaussian(level, bp["gatePenalty"])
    return math.exp(-(bp["a"] + bp["b"] * (2 * level + 1) + tail + gate))


def _sustainable_max_age(level: int) -> int:
    if level <= 0:
        return _TUNING["mortalMaxAge"]
    early = _TUNING["earlySustainableMaxAge"]
    if level < len(early):
        return early[level]
    high_start = len(early) - 1
    span = MAX_LEVEL - high_start
    if span <= 0:
        return _TUNING["lv7MaxAge"]
    progress = (level - high_start) / span
    start_age = early[high_start]
    end_age = _TUNING["lv7MaxAge"]
    if start_age <= 0 or end_age <= 0:
        return round(start_age + (end_age - start_age) * progress)
    return round(start_age * math.exp(math.log(end_age / start_age) * progress))


def lifespan_bonus(level: int) -> int:
    if level <= 0:
        return 0
    legacy = _TUNING["legacyLifespanBonus"]
    if level < len(legacy):
        return legacy[level]
    return max(0, _sustainable_max_age(level) - _sustainable_max_age(level - 1))


def _effective_courage(base_courage: float, age: int, max_age: int) -> float:
    t = age / max_age if max_age > 0 else 1.0
    trough = _TUNING["courage_trough"]
    if t < trough:
        boost = _TUNING["courage_youngAmp"] * (1 - t / trough) ** 2
    else:
        boost = _TUNING["courage_oldAmp"] * ((t - trough) / (1 - trough)) ** 2
    return min(1.0, round(base_courage + boost, 2))


# ---------------------------------------------------------------------------
# Combat encounter probability (simplified, no spatial grid)
# ---------------------------------------------------------------------------


def _base_encounter_prob(level: int, danger: int) -> float:
    if level == 0:
        base = 0.03
    else:
        base = max(0.01, 0.12 - 0.01 * level)
    factor = _TUNING["terrainDangerEncounterFactor"]
    d_idx = max(1, min(danger, len(factor) - 1))
    return base * factor[d_idx]


# ---------------------------------------------------------------------------
# Gymnasium Environment
# ---------------------------------------------------------------------------


def _clamp01(v: float) -> float:
    return max(0.0, min(1.0, v))


def _decay(value: float, baseline: float, rate: float) -> float:
    return baseline + (value - baseline) * rate


class XiuxianEnv(gym.Env[NDArray[np.float32], int]):
    """Single-cultivator xiuxian lifecycle environment with memory.

    Observation: 18-dim float32 vector (12 base + 6 memory features).
    Action: Discrete(5) behavior state index.
    """

    metadata = {"render_modes": []}

    def __init__(self, seed: int | None = None, config_path: Path = _CONFIG_PATH) -> None:
        super().__init__()
        self.cfg = load_config(config_path)
        n_features = len(self.cfg["features"])
        n_actions = len(self.cfg["actions"])

        self.observation_space = gym.spaces.Box(
            low=0.0, high=1.0, shape=(n_features,), dtype=np.float32,
        )
        self.action_space = gym.spaces.Discrete(n_actions)

        self._reward_map: dict[str, dict[str, Any]] = {}
        for r in self.cfg["rewards"]:
            self._reward_map[r["event"]] = r

        self._rng = np.random.default_rng(seed)

        # Cultivator state
        self._age: int = 0
        self._cultivation: float = 0.0
        self._level: int = 0
        self._courage: float = 0.0
        self._max_age: int = 0
        self._injured_until: int = 0
        self._light_injury_until: int = 0
        self._meridian_damaged_until: int = 0
        self._bt_cooldown_until: int = 0
        self._year: int = 0
        self._alive: bool = False

        # Cell terrain
        self._spiritual_energy: int = 3
        self._danger: int = 3

        # Memory / emotional state
        self._confidence: float = 0.0
        self._caution: float = 0.0
        self._ambition: float = 0.5
        self._bloodlust: float = 0.0
        self._rootedness: float = 0.0
        self._breakthrough_fear: float = 0.0

    # ------------------------------------------------------------------
    # Gym API
    # ------------------------------------------------------------------

    def reset(
        self,
        *,
        seed: int | None = None,
        options: dict[str, Any] | None = None,
    ) -> tuple[NDArray[np.float32], dict[str, Any]]:
        super().reset(seed=seed)
        if seed is not None:
            self._rng = np.random.default_rng(seed)

        self._year = 0
        self._age = 10
        self._cultivation = 0.0
        self._level = 0
        self._courage = float(np.clip(self._rng.normal(0.5, 0.15), 0.01, 1.00))
        self._max_age = _TUNING["mortalMaxAge"]
        self._injured_until = 0
        self._light_injury_until = 0
        self._meridian_damaged_until = 0
        self._bt_cooldown_until = 0
        self._alive = True

        self._spiritual_energy = int(self._rng.integers(1, 6))
        self._danger = int(self._rng.integers(1, 6))

        # Reset memory
        self._confidence = self._courage
        self._caution = 0.0
        self._ambition = 0.5
        self._bloodlust = 0.0
        self._rootedness = 0.0
        self._breakthrough_fear = 0.0

        return self._obs(), {}

    def step(
        self, action: int,
    ) -> tuple[NDArray[np.float32], float, bool, bool, dict[str, Any]]:
        assert self._alive, "step() called after death"
        self._year += 1
        reward = 0.0
        info: dict[str, Any] = {}

        action_name = self.cfg["actions"][action]
        self._apply_behavior_terrain(action_name)

        # --- Emotional decay ---
        dr = _MEMORY["emotionalDecayRate"]
        self._confidence = _decay(self._confidence, self._courage, dr)
        self._caution = _decay(self._caution, 0.0, dr)
        self._ambition = _decay(self._ambition, 0.5, dr)
        self._bloodlust = _decay(self._bloodlust, 0.0, dr)
        self._rootedness = _decay(self._rootedness, 0.0, dr)
        self._breakthrough_fear = _decay(self._breakthrough_fear, 0.0, dr)

        # Rootedness: settling increases it
        if action_name == "settling":
            self._rootedness = _clamp01(self._rootedness + _MEMORY["rootednessSettlingDelta"])

        # --- Cultivation growth ---
        cult_before = self._cultivation
        growth = 1.0
        if self._injured_until > self._year:
            growth = _TUNING["injuryGrowthRate"]
        elif self._light_injury_until > self._year:
            growth = _TUNING["lightInjuryGrowthRate"]
        se_growth_factor = _TUNING["spiritualEnergyBreakthroughFactor"]
        se_idx = max(0, min(self._spiritual_energy, len(se_growth_factor) - 1))
        growth *= se_growth_factor[se_idx]
        self._cultivation += growth

        # --- Recuperating accelerates injury recovery ---
        if action_name == "recuperating":
            if self._injured_until > self._year + 1:
                self._injured_until -= 1
            if self._light_injury_until > self._year + 1:
                self._light_injury_until -= 1

        # Lifespan decay toward sustainable max
        target = _sustainable_max_age(self._level)
        if self._max_age > target:
            self._max_age = max(
                _TUNING["mortalMaxAge"],
                round(self._max_age - (self._max_age - target) * _TUNING["lifespanDecayRate"]),
            )

        # --- Breakthrough attempt ---
        if (
            self._level < MAX_LEVEL
            and self._cultivation >= THRESHOLDS[self._level + 1]
            and self._bt_cooldown_until <= self._year
            and self._injured_until <= self._year
        ):
            bt_success, bt_reward = self._try_breakthrough()
            reward += bt_reward
            if bt_success:
                reward += self._reward("breakthrough", scale_value=self._level)

        # --- Combat encounter ---
        enc_prob = _base_encounter_prob(self._level, self._danger)
        if self._alive and self._rng.random() < enc_prob:
            combat_reward = self._resolve_combat()
            reward += combat_reward

        # --- Age & expiry ---
        self._age += 1
        if self._alive and self._age >= self._max_age:
            self._alive = False
            reward += self._reward("death")
            info["cause"] = "expiry"

        # --- Per-year rewards ---
        if self._alive:
            reward += self._reward("survive_year")
            cult_gained = self._cultivation - cult_before
            next_thresh = THRESHOLDS[min(self._level + 1, MAX_LEVEL)]
            if next_thresh > 0:
                reward += self._reward("cultivation_gain") * (cult_gained / next_thresh)

        terminated = not self._alive
        return self._obs(), reward, terminated, False, info

    # ------------------------------------------------------------------
    # Internal mechanics
    # ------------------------------------------------------------------

    def _apply_behavior_terrain(self, action: str) -> None:
        if action == "seeking_breakthrough":
            self._spiritual_energy = min(5, self._spiritual_energy + int(self._rng.choice([0, 1])))
            self._danger = max(0, min(5, self._danger + int(self._rng.choice([-1, 0, 1]))))
        elif action == "escaping":
            self._danger = max(0, self._danger - 1)
            self._spiritual_energy = max(0, min(5, self._spiritual_energy + int(self._rng.choice([-1, 0]))))
        elif action == "settling":
            pass
        elif action == "recuperating":
            self._danger = max(0, min(5, self._danger + int(self._rng.choice([-1, 0]))))
        else:
            self._spiritual_energy = max(0, min(5, self._spiritual_energy + int(self._rng.choice([-1, 0, 1]))))
            self._danger = max(0, min(5, self._danger + int(self._rng.choice([-1, 0, 1]))))

    def _try_breakthrough(self) -> tuple[bool, float]:
        se_factor_table = _TUNING["spiritualEnergyBreakthroughFactor"]
        se_idx = max(1, min(self._spiritual_energy, len(se_factor_table) - 1))
        se_factor = se_factor_table[se_idx]

        chance = breakthrough_chance(self._level) * se_factor
        if self._rng.random() < chance:
            self._level += 1
            bonus = lifespan_bonus(self._level)
            self._max_age = min(_sustainable_max_age(MAX_LEVEL), self._max_age + bonus)
            # Memory: success
            self._ambition = _clamp01(self._ambition + _MEMORY["ambitionSuccessDelta"])
            self._breakthrough_fear = 0.0
            return True, 0.0

        # Failure
        self._bt_cooldown_until = self._year + _TUNING["breakthroughCooldown"]

        # Memory: fear increases
        self._breakthrough_fear = _clamp01(self._breakthrough_fear + _MEMORY["breakthroughFearDelta"])
        if self._courage >= _MEMORY["ambitionCourageThreshold"]:
            self._ambition = _clamp01(self._ambition + _MEMORY["ambitionFailHighCourageDelta"])
        else:
            self._ambition = _clamp01(self._ambition - _MEMORY["ambitionFailLowCourageDelta"])

        total_w = (
            _TUNING["breakthroughNothingWeight"]
            + _TUNING["breakthroughCultLossWeight"]
            + _TUNING["breakthroughInjuryWeight"]
        )
        nothing_t = _TUNING["breakthroughNothingWeight"] / total_w
        cult_loss_t = nothing_t + _TUNING["breakthroughCultLossWeight"] / total_w

        r = self._rng.random()
        if r >= nothing_t:
            if r < cult_loss_t:
                base = THRESHOLDS[self._level]
                self._cultivation = max(
                    base,
                    self._cultivation - (self._cultivation - base) * _TUNING["breakthroughCultLossRate"],
                )
            else:
                self._injured_until = self._year + _TUNING["injuryDuration"]
                self._caution = _clamp01(self._caution + _MEMORY["cautionHeavyInjuryDelta"])
                return False, self._reward("heavy_injury")
        return False, 0.0

    def _resolve_combat(self) -> float:
        reward = 0.0

        opp_level = max(0, min(MAX_LEVEL, self._level + int(self._rng.integers(-1, 2))))
        opp_cult = float(THRESHOLDS[opp_level]) + self._rng.random() * max(1.0, float(THRESHOLDS[min(opp_level + 1, MAX_LEVEL)] - THRESHOLDS[opp_level]) * 0.5)

        my_power = self._cultivation
        if self._meridian_damaged_until > self._year:
            my_power *= (1.0 - _TUNING["meridianCombatPenalty"])
        opp_power = opp_cult

        total = my_power + opp_power
        if total <= 0:
            return 0.0

        win_prob = my_power / total
        if self._rng.random() < win_prob:
            # Win
            level_base = THRESHOLDS[opp_level]
            loot = max(0.1, level_base * _TUNING["lootBaseRate"] + max(0.0, opp_cult - level_base) * _TUNING["lootVariableRate"])
            loot_penalty = math.exp(-_sigmoid(opp_level, _BALANCE["combat"]["lootPenalty"]))
            self._cultivation += loot * loot_penalty
            reward += self._reward("combat_win")
            # Memory: win
            self._confidence = _clamp01(self._confidence + _MEMORY["confidenceWinDelta"])
            killed = self._rng.random() < 0.3  # simplified kill chance
            self._bloodlust = _clamp01(self._bloodlust + (_MEMORY["bloodlustKillDelta"] if killed else _MEMORY["bloodlustWinDelta"]))
        else:
            # Lose
            self._confidence = _clamp01(self._confidence - _MEMORY["confidenceLossDelta"])
            self._rootedness = _clamp01(self._rootedness - _MEMORY["rootednessDisplaceDelta"])

            gap = (opp_power - my_power) / (opp_power + my_power) if (opp_power + my_power) > 0 else 0
            death_boost = math.exp(_gaussian(self._level, _BALANCE["combat"]["deathBoost"]))
            death_chance = min(
                _TUNING["defeatMaxDeath"],
                _TUNING["defeatDeathBase"]
                * _TUNING["defeatDeathDecay"] ** self._level
                * (1 + _TUNING["defeatGapSeverity"] * gap)
                * death_boost,
            )

            if self._rng.random() < death_chance:
                self._alive = False
                reward += self._reward("death")
            else:
                outcome = self._roll_defeat_outcome()
                if outcome == "demotion" and self._level > 0:
                    self._level -= 1
                    self._cultivation = float(THRESHOLDS[self._level]) if self._level >= 1 else 0.0
                elif outcome == "heavy_injury":
                    self._injured_until = self._year + _TUNING["injuryDuration"]
                    self._caution = _clamp01(self._caution + _MEMORY["cautionHeavyInjuryDelta"])
                    reward += self._reward("heavy_injury")
                elif outcome == "cult_loss":
                    base = float(THRESHOLDS[self._level])
                    self._cultivation = max(base, self._cultivation * (1 - _TUNING["defeatCultLossRate"]))
                elif outcome == "meridian_damage":
                    self._meridian_damaged_until = self._year + _TUNING["meridianDamageDuration"]
                elif outcome == "light_injury":
                    self._light_injury_until = self._year + _TUNING["lightInjuryDuration"]
                    self._caution = _clamp01(self._caution + _MEMORY["cautionLightInjuryDelta"])

        return reward

    def _roll_defeat_outcome(self) -> str:
        total = (
            _TUNING["defeatLightInjuryWeight"]
            + _TUNING["defeatInjuryWeight"]
            + _TUNING["defeatCultLossWeight"]
            + _TUNING["defeatMeridianWeight"]
            + _TUNING["defeatDemotionWeight"]
        )
        r = self._rng.random()
        cum = _TUNING["defeatLightInjuryWeight"] / total
        if r < cum:
            return "light_injury"
        cum += _TUNING["defeatInjuryWeight"] / total
        if r < cum:
            return "heavy_injury"
        cum += _TUNING["defeatCultLossWeight"] / total
        if r < cum:
            return "cult_loss"
        cum += _TUNING["defeatMeridianWeight"] / total
        if r < cum:
            return "meridian_damage"
        return "demotion"

    # ------------------------------------------------------------------
    # Observation & reward helpers
    # ------------------------------------------------------------------

    def _obs(self) -> NDArray[np.float32]:
        features = self.cfg["features"]
        obs = np.zeros(len(features), dtype=np.float32)
        for i, feat in enumerate(features):
            obs[i] = self._extract_feature(feat["name"])
        return obs

    def _extract_feature(self, name: str) -> float:
        if name == "remaining_lifespan_ratio":
            return max(0.0, (self._max_age - self._age) / self._max_age) if self._max_age > 0 else 0.0
        if name == "cultivation_progress":
            next_thresh = THRESHOLDS[min(self._level + 1, MAX_LEVEL)]
            return min(1.0, self._cultivation / next_thresh) if next_thresh > 0 else 1.0
        if name == "level_normalized":
            return self._level / MAX_LEVEL
        if name == "courage":
            return self._courage
        if name == "is_heavy_injured":
            return 1.0 if self._injured_until > self._year else 0.0
        if name == "is_light_injured":
            return 1.0 if self._light_injury_until > self._year else 0.0
        if name == "is_meridian_damaged":
            return 1.0 if self._meridian_damaged_until > self._year else 0.0
        if name == "breakthrough_ready":
            if self._level >= MAX_LEVEL:
                return 0.0
            ready = (
                self._cultivation >= THRESHOLDS[self._level + 1]
                and self._bt_cooldown_until <= self._year
                and self._injured_until <= self._year
            )
            return 1.0 if ready else 0.0
        if name == "spiritual_energy":
            return self._spiritual_energy / 5.0
        if name == "danger_level":
            return self._danger / 5.0
        if name == "breakthrough_cooldown":
            if self._bt_cooldown_until <= self._year:
                return 0.0
            remaining = self._bt_cooldown_until - self._year
            return min(1.0, remaining / _TUNING["breakthroughCooldown"])
        if name == "age_ratio":
            return self._age / self._max_age if self._max_age > 0 else 1.0
        # Memory features
        if name == "confidence":
            return self._confidence
        if name == "caution":
            return self._caution
        if name == "ambition":
            return self._ambition
        if name == "bloodlust":
            return self._bloodlust
        if name == "rootedness":
            return self._rootedness
        if name == "breakthrough_fear":
            return self._breakthrough_fear
        return 0.0

    def _reward(self, event: str, scale_value: float = 0.0) -> float:
        entry = self._reward_map.get(event)
        if entry is None:
            return 0.0
        w = entry["weight"]
        if entry.get("scale_by") == "level":
            w *= scale_value
        return w
