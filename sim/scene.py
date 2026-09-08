"""Validated spatial contracts: metres, XY floor, Z up."""
import math
import random
from typing import Literal
from pydantic import BaseModel, ConfigDict, Field, model_validator


class StrictModel(BaseModel):
    model_config = ConfigDict(extra="forbid", allow_inf_nan=False)


class RobotConfig(StrictModel):
    id: Literal["g1_a", "g1_b"]
    spawn: tuple[float, float, float]
    goal: tuple[float, float]


class Obstacle(StrictModel):
    id: str = Field(pattern=r"^[a-zA-Z0-9_-]{1,64}$")
    position: tuple[float, float]
    size: tuple[float, float, float]

    @model_validator(mode="after")
    def positive_size(self):
        if any(v <= 0 or v > 10 for v in self.size):
            raise ValueError("Obstacle dimensions must be in (0, 10] metres")
        return self


class Keepout(StrictModel):
    id: str = Field(pattern=r"^[a-zA-Z0-9_-]{1,64}$")
    polygon: list[tuple[float, float]] = Field(min_length=3, max_length=32)


class SceneConfig(StrictModel):
    width: float = Field(default=8, ge=3, le=30)
    depth: float = Field(default=8, ge=3, le=30)
    seed: int = Field(default=7, ge=0, le=2**31 - 1)
    robots: list[RobotConfig] = Field(min_length=2, max_length=2)
    obstacles: list[Obstacle] = Field(default_factory=list, max_length=24)
    keepouts: list[Keepout] = Field(default_factory=list, max_length=12)

    @model_validator(mode="after")
    def valid_stage(self):
        if {r.id for r in self.robots} != {"g1_a", "g1_b"}:
            raise ValueError("Scene requires exactly g1_a and g1_b")
        points = [r.spawn[:2] for r in self.robots] + [r.goal for r in self.robots]
        if any(abs(x) > self.width/2 - .45 or abs(y) > self.depth/2 - .45 for x, y in points):
            raise ValueError("Robot spawn and goal must be inside stage with 0.45 m margin")
        if len({o.id for o in self.obstacles}) != len(self.obstacles):
            raise ValueError("Obstacle IDs must be unique")
        if len({k.id for k in self.keepouts}) != len(self.keepouts):
            raise ValueError("Keepout IDs must be unique")
        if math.dist(self.robots[0].spawn[:2], self.robots[1].spawn[:2]) < .9:
            raise ValueError("Robot spawns require 0.9 m separation")
        for obstacle in self.obstacles:
            if abs(obstacle.position[0])+obstacle.size[0]/2 > self.width/2 or abs(obstacle.position[1])+obstacle.size[1]/2 > self.depth/2:
                raise ValueError("Obstacle must fit inside the stage")
        if any(not point_clear(point, self.obstacles, self.keepouts) for point in points):
            raise ValueError("Robot spawn/goal overlaps an obstacle or keepout (0.45 m clearance required)")
        return self


def default_scene() -> SceneConfig:
    return SceneConfig(depth=6, robots=[
        RobotConfig(id="g1_a", spawn=(-2, 0, 0), goal=(2, 0)),
        RobotConfig(id="g1_b", spawn=(0, -2, 1.5707963267948966), goal=(0, 2)),
    ], keepouts=[Keepout(id="presenter", polygon=[(-3.8, -2.7), (-2.85, -2.7), (-2.85, 2.7), (-3.8, 2.7)])])


def point_clear(point, obstacles, keepouts, margin=.45):
    x, y = point
    for obstacle in obstacles:
        dx = max(abs(x-obstacle.position[0])-obstacle.size[0]/2, 0)
        dy = max(abs(y-obstacle.position[1])-obstacle.size[1]/2, 0)
        if math.hypot(dx, dy) < margin:
            return False
    for keepout in keepouts:
        polygon = keepout.polygon
        inside = False
        for i, (ax, ay) in enumerate(polygon):
            bx, by = polygon[(i+1) % len(polygon)]
            if (ay > y) != (by > y) and x < (bx-ax)*(y-ay)/(by-ay)+ax:
                inside = not inside
            length_sq = (bx-ax)**2+(by-ay)**2
            t = max(0., min(1., ((x-ax)*(bx-ax)+(y-ay)*(by-ay))/max(length_sq, 1e-12)))
            if math.hypot(x-ax-t*(bx-ax), y-ay-t*(by-ay)) < margin:
                return False
        if inside:
            return False
    return True


def randomized_scene(seed: int, template: SceneConfig | None = None) -> SceneConfig:
    """Seeded crossing variations, rejection sampled with explicit spawn clearance."""
    template = template or default_scene()
    rng = random.Random(seed)
    radius_limit = min(template.width, template.depth)/2-.55
    for _ in range(1000):
        angle = rng.uniform(-math.pi, math.pi)
        crossing_angle = angle+rng.uniform(1.2, 1.9)
        robots = []
        for rid, theta in [("g1_a", angle), ("g1_b", crossing_angle)]:
            radius = rng.uniform(max(.9, radius_limit*.7), radius_limit)
            x, y = radius*math.cos(theta), radius*math.sin(theta)
            robots.append(RobotConfig(id=rid, spawn=(x, y, theta+math.pi), goal=(-x, -y)))
        try:
            return SceneConfig(width=template.width, depth=template.depth, seed=seed,
                               robots=robots, obstacles=template.obstacles, keepouts=template.keepouts)
        except ValueError:
            continue
    raise ValueError("Could not sample valid robot spawn/goal positions for this scene")
