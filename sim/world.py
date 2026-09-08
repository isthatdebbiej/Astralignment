"""Two physical G1 humanoids in ONE MuJoCo world and one physics clock.

The observation layout and PD law are adapted from the selected Mori
sim/adapters/g1.py and Unitree RL Gym's BSD-3-Clause deploy_mujoco.py.
This module has no Mori runtime imports. See models/unitree_g1/provenance.json.
"""
from __future__ import annotations

import copy
import hashlib
import json
import math
import uuid
from pathlib import Path
from xml.etree import ElementTree as ET

import mujoco
import numpy as np
import torch
import yaml

from .scene import SceneConfig, default_scene, point_clear

ASSETS = Path(__file__).parent / "models" / "unitree_g1"
MODES = {"independent", "reservation", "external"}
ROBOT_ENVELOPE_RADIUS = .45
STATE_SPEC = mujoco.mjtState.mjSTATE_INTEGRATION
torch.set_num_threads(1)
torch.use_deterministic_algorithms(True)


def numbers(value, default):
    return [float(x) for x in (value or default).split()]


def inside_polygon(point, polygon):
    x, y = point
    inside = False
    j = len(polygon) - 1
    for i, (xi, yi) in enumerate(polygon):
        xj, yj = polygon[j]
        if ((yi > y) != (yj > y)) and x < (xj-xi)*(y-yi)/(yj-yi)+xi:
            inside = not inside
        j = i
    return inside


class G1Controller:
    """Each controller owns a separately loaded recurrent TorchScript policy."""
    def __init__(self, world, robot):
        self.id = robot.id
        self.robot = robot
        self.config = world.config
        self.policy = torch.jit.load(str(ASSETS / "motion.pt"), map_location="cpu").eval()
        self.policy.reset_memory()
        model = world.model
        prefix = self.id + "/"
        self.body_id = model.body(prefix + "pelvis").id
        self.base_joint = model.joint(prefix + "floating_base_joint").id
        self.qbase = int(model.jnt_qposadr[self.base_joint])
        self.vbase = int(model.jnt_dofadr[self.base_joint])
        self.actuator_ids = np.array([i for i in range(model.nu) if model.actuator(i).name.startswith(prefix)])
        self.joint_ids = model.actuator_trnid[self.actuator_ids, 0]
        self.qids = model.jnt_qposadr[self.joint_ids]
        self.vids = model.jnt_dofadr[self.joint_ids]
        self.default = np.array(self.config["default_angles"], dtype=np.float32)
        self.kp = np.array(self.config["kps"])
        self.kd = np.array(self.config["kds"])
        self.action = np.zeros(12, dtype=np.float32)
        self.target = self.default.copy()
        self.observation = np.zeros(47, dtype=np.float32)
        self.command = np.zeros(3, dtype=np.float32)
        self.velocity = np.zeros(2, dtype=np.float32)
        self.waiting = False

    def gravity(self, data):
        w, x, y, z = data.qpos[self.qbase+3:self.qbase+7]
        return np.array([2*(-z*x+w*y), -2*(z*y+w*x), 1-2*(w*w+z*z)])

    def yaw(self, data):
        w, x, y, z = data.qpos[self.qbase+3:self.qbase+7]
        return math.atan2(2*(w*z+x*y), 1-2*(y*y+z*z))

    def fallen(self, data):
        return bool(data.qpos[self.qbase+2] < .40 or self.gravity(data)[2] > -.5)

    def command_velocity(self, data, velocity):
        self.velocity = np.array(velocity, dtype=np.float32)
        speed = float(np.linalg.norm(self.velocity))
        yaw = self.yaw(data)
        heading = math.atan2(velocity[1], velocity[0]) if speed > .01 else yaw
        error = math.atan2(math.sin(heading-yaw), math.cos(heading-yaw))
        self.command = np.array([min(speed, .7)*max(0., math.cos(error)), 0., np.clip(error*1.5, -.8, .8)], dtype=np.float32)

    def pd(self, data):
        data.ctrl[self.actuator_ids] = (self.target-data.qpos[self.qids])*self.kp-data.qvel[self.vids]*self.kd

    def infer(self, world):
        data, cfg = world.data, self.config
        obs = np.zeros(47, dtype=np.float32)
        obs[:3] = data.qvel[self.vbase+3:self.vbase+6]*cfg["ang_vel_scale"]
        obs[3:6] = self.gravity(data)
        obs[6:9] = self.command*np.array(cfg["cmd_scale"])
        obs[9:21] = (data.qpos[self.qids]-self.default)*cfg["dof_pos_scale"]
        obs[21:33] = data.qvel[self.vids]*cfg["dof_vel_scale"]
        obs[33:45] = self.action
        phase = (world.tick*world.model.opt.timestep) % .8 / .8
        obs[45:] = [math.sin(2*math.pi*phase), math.cos(2*math.pi*phase)]
        self.observation = obs
        with torch.inference_mode():
            self.action = self.policy(torch.from_numpy(obs).unsqueeze(0)).numpy().reshape(12).copy()
        self.target = self.action*cfg["action_scale"]+self.default

    def checkpoint(self):
        return {"action": self.action.tolist(), "target": self.target.tolist(),
                "observation": self.observation.tolist(), "command": self.command.tolist(),
                "velocity": self.velocity.tolist(), "waiting": self.waiting,
                "buffers": {name: value.detach().cpu().numpy().tolist() for name, value in self.policy.named_buffers()}}

    def restore(self, state):
        for name in ("action", "target", "observation", "command", "velocity"):
            setattr(self, name, np.array(state[name], dtype=np.float32))
        self.waiting = state["waiting"]
        for name, values in state["buffers"].items():
            target = dict(self.policy.named_buffers())[name]
            incoming = torch.tensor(values, dtype=target.dtype)
            if target.shape == incoming.shape:
                target.copy_(incoming)
            else:
                # Recurrent modules may lazily resize hidden/cell buffers.
                module = self.policy
                parts = name.split(".")
                for part in parts[:-1]:
                    module = getattr(module, part)
                setattr(module, parts[-1], incoming)


class SharedWorld:
    def __init__(self, scene: SceneConfig | dict | None = None, mode="independent", scene_epoch=1):
        if mode not in MODES:
            raise ValueError("Unknown controller mode")
        self.scene = SceneConfig.model_validate(scene) if isinstance(scene, dict) else (scene or default_scene())
        self.config = yaml.safe_load((ASSETS / "policy-config.yaml").read_text())
        self.provenance = json.loads((ASSETS / "provenance.json").read_text())
        self.policy_hash = hashlib.sha256((ASSETS / "motion.pt").read_bytes()).hexdigest()
        self.xml, self.geometries = self.compose()
        self.model = mujoco.MjModel.from_xml_string(self.xml)
        self.model_hash = hashlib.sha256(self.xml.encode()).hexdigest()
        self.data = mujoco.MjData(self.model)
        if self.model.nu != 24 or self.model.nq != 38:
            raise RuntimeError("Shared G1 model must contain two 12-DOF controllers and two free bases")
        self.controllers = {r.id: G1Controller(self, r) for r in self.scene.robots}
        self.geom_owners = {i: self.model.body(int(self.model.geom_bodyid[i])).name.split("/")[0]
                            for i in range(self.model.ngeom)}
        self.mode = mode
        self.scene_epoch = scene_epoch
        self.episode_id = str(uuid.uuid4())
        self.tick = 0
        self.paused = True
        self.invalidated = False
        self.rng = np.random.default_rng(self.scene.seed)
        self.metrics = {"min_separation_m": None, "robot_contact_ticks": 0, "obstacle_contact_ticks": 0,
                        "keepout_violation_ticks": 0, "boundary_violation_ticks": 0,
                        "falls": [], "goals_reached": [], "path_length_m": {r.id: 0.0 for r in self.scene.robots}}
        self.events = []
        self.active_contacts = set()
        self.active_violations = set()
        self.external_commands = {r.id: [0., 0.] for r in self.scene.robots}
        self.external_expires_tick = -1
        self.reservation_owner = "g1_a"
        for robot in self.scene.robots:
            ctrl = self.controllers[robot.id]
            x, y, yaw = robot.spawn
            self.data.qpos[ctrl.qbase:ctrl.qbase+2] = [x, y]
            self.data.qpos[ctrl.qbase+3:ctrl.qbase+7] = [math.cos(yaw/2), 0, 0, math.sin(yaw/2)]
            self.data.qpos[ctrl.qids] = ctrl.default
        mujoco.mj_forward(self.model, self.data)
        self.last_positions = {rid: self.position(rid).copy() for rid in self.controllers}

    def compose(self):
        root = ET.parse(ASSETS / "g1.xml").getroot()
        root.set("model", "astralignment_two_g1")
        root.find("compiler").set("meshdir", str((ASSETS / "meshes").resolve()))
        ET.SubElement(root, "option", timestep="0.002", gravity="0 0 -9.81", integrator="implicitfast")
        world, actuators = root.find("worldbody"), root.find("actuator")
        body_template = copy.deepcopy(world.find("body"))
        actuator_templates = [copy.deepcopy(a) for a in actuators]
        world.clear()
        actuators.clear()
        ET.SubElement(world, "geom", name="ground", type="plane", size=f"{self.scene.width/2} {self.scene.depth/2} .1", friction="1 .005 .0001", rgba=".07 .09 .13 1")
        meshes = {m.get("name"): m.get("file") for m in root.find("asset").findall("mesh")}
        geometries = []
        for robot in self.scene.robots:
            body = copy.deepcopy(body_template)
            for node in body.iter():
                if node.get("name"):
                    node.set("name", robot.id + "/" + node.get("name"))
            world.append(body)
            for parent in body.iter("body"):
                for geom in parent.findall("geom"):
                    # Render only the authored visual layer; collision meshes overlap it.
                    if geom.get("group") != "1":
                        continue
                    geometries.append({"name": f"{parent.get('name')}/visual_{len(geometries)}",
                                       "body": parent.get("name"), "kind": geom.get("type", "sphere"),
                                       "local_position": numbers(geom.get("pos"), "0 0 0"),
                                       "local_quaternion": numbers(geom.get("quat"), "1 0 0 0"),
                                       "size": numbers(geom.get("size"), "0 0 0"),
                                       "rgba": numbers(geom.get("rgba"), ".7 .7 .7 1"),
                                       "mesh": "/api/sim/assets/meshes/" + meshes[geom.get("mesh")]})
            for source in actuator_templates:
                actuator = copy.deepcopy(source)
                for key in ("name", "joint"):
                    actuator.set(key, robot.id + "/" + actuator.get(key))
                actuators.append(actuator)
        for obstacle in self.scene.obstacles:
            x, y = obstacle.position
            sx, sy, sz = obstacle.size
            body = ET.SubElement(world, "body", name="obstacle/"+obstacle.id, pos=f"{x} {y} {sz/2}")
            ET.SubElement(body, "geom", name="obstacle/"+obstacle.id, type="box", size=f"{sx/2} {sy/2} {sz/2}", rgba=".35 .4 .5 1")
        return ET.tostring(root, encoding="unicode"), geometries

    def position(self, rid):
        c = self.controllers[rid]
        return self.data.qpos[c.qbase:c.qbase+2]

    def event(self, kind, **details):
        severity = "error" if kind in {"fall", "robot_contact", "obstacle_contact", "keepout_violation", "boundary_violation"} else "success" if kind == "goal_reached" else "info"
        self.events.append({"id": f"{self.episode_id}:{self.tick}:{len(self.events)}", "tick": self.tick,
                            "sim_time": round(float(self.data.time), 6), "kind": kind,
                            "message": kind.replace("_", " ").capitalize(), "severity": severity, **details})
        self.events = self.events[-200:]

    def desired_velocities(self):
        if self.mode == "external":
            return self.external_commands if self.tick < self.external_expires_tick else {rid: [0, 0] for rid in self.controllers}
        velocities = {}
        # Conservative single stage reservation is an explicit reference controller.
        # It grants g1_a passage first, then g1_b, and makes no safety-certification claim.
        if self.reservation_owner == "g1_a" and "g1_a" in self.metrics["goals_reached"]:
            self.reservation_owner = "g1_b"
            self.event("reservation_granted", robot_id="g1_b")
        for rid, controller in self.controllers.items():
            delta = np.array(controller.robot.goal)-self.position(rid)
            distance = np.linalg.norm(delta)
            waiting = self.mode == "reservation" and rid != self.reservation_owner and distance > .28
            controller.waiting = waiting
            velocity = delta/max(distance, .001)*min(.55, distance*.85)
            if waiting or distance < .22 or controller.fallen(self.data):
                velocity[:] = 0
            velocities[rid] = velocity
        return velocities

    def step(self, velocities=None):
        if self.invalidated:
            raise ValueError("Scene was invalidated; reset before stepping")
        velocities = velocities if velocities is not None else self.desired_velocities()
        for rid, velocity in velocities.items():
            array = np.asarray(velocity, dtype=float)
            if rid not in self.controllers or array.shape != (2,) or not np.isfinite(array).all() or np.linalg.norm(array) > .70001:
                raise ValueError("Commands require known robot IDs and finite 2D world velocities bounded to 0.7 m/s")
        for rid, controller in self.controllers.items():
            controller.command_velocity(self.data, velocities.get(rid, [0., 0.]))
        for _ in range(10):
            for controller in self.controllers.values():
                controller.pd(self.data)
            # Exactly one shared integration for the complete 24-actuator world.
            mujoco.mj_step(self.model, self.data)
            self.tick += 1
            self.observe_metrics()
        for controller in self.controllers.values():
            controller.infer(self)
        mujoco.mj_forward(self.model, self.data)
        if not np.isfinite(self.data.qpos).all():
            self.paused = True
            raise RuntimeError("Physics produced nonfinite state")
        return self.snapshot()

    def observe_metrics(self):
        separation = float(np.linalg.norm(self.position("g1_a")-self.position("g1_b")))
        prev = self.metrics["min_separation_m"]
        self.metrics["min_separation_m"] = separation if prev is None else min(prev, separation)
        contacts = set()
        for contact in self.data.contact:
            a, b = self.geom_owners[int(contact.geom1)], self.geom_owners[int(contact.geom2)]
            if a == b or not ({a, b} & set(self.controllers)):
                continue
            if a in self.controllers and b in self.controllers:
                contacts.add(("robot_contact", *sorted([a, b])))
            elif a == "obstacle" or b == "obstacle":
                contacts.add(("obstacle_contact", *sorted([a, b])))
        if any(c[0] == "robot_contact" for c in contacts):
            self.metrics["robot_contact_ticks"] += 1
        if any(c[0] == "obstacle_contact" for c in contacts):
            self.metrics["obstacle_contact_ticks"] += 1
        for kind, a, b in contacts-self.active_contacts:
            self.event(kind, owners=[a, b])
        self.active_contacts = contacts
        violations = set()
        for rid, controller in self.controllers.items():
            pos = self.position(rid)
            self.metrics["path_length_m"][rid] += float(np.linalg.norm(pos-self.last_positions[rid]))
            self.last_positions[rid] = pos.copy()
            if controller.fallen(self.data) and rid not in self.metrics["falls"]:
                self.metrics["falls"].append(rid)
                self.event("fall", robot_id=rid)
            if np.linalg.norm(pos-np.array(controller.robot.goal)) < .28 and rid not in self.metrics["goals_reached"]:
                self.metrics["goals_reached"].append(rid)
                self.event("goal_reached", robot_id=rid)
            if abs(pos[0])+ROBOT_ENVELOPE_RADIUS > self.scene.width/2 or abs(pos[1])+ROBOT_ENVELOPE_RADIUS > self.scene.depth/2:
                self.metrics["boundary_violation_ticks"] += 1
                violations.add(("boundary_violation", rid))
            if not point_clear(pos, [], self.scene.keepouts, ROBOT_ENVELOPE_RADIUS):
                self.metrics["keepout_violation_ticks"] += 1
                violations.add(("keepout_violation", rid))
        for kind, rid in violations-self.active_violations:
            self.event(kind, robot_id=rid, envelope_radius_m=ROBOT_ENVELOPE_RADIUS)
        self.active_violations = violations

    def snapshot(self):
        robots = []
        for rid, controller in self.controllers.items():
            q = self.data.qpos[controller.qbase:controller.qbase+7]
            robots.append({"id": rid, "position": q[:3].tolist(), "quaternion": q[3:7].tolist(),
                           "yaw": controller.yaw(self.data), "goal": list(controller.robot.goal),
                           "velocity": self.data.qvel[controller.vbase:controller.vbase+3].tolist(),
                           "fallen": controller.fallen(self.data), "waiting": controller.waiting,
                           "goal_reached": rid in self.metrics["goals_reached"],
                           "command": controller.command.tolist(), "action": "wait" if controller.waiting else "go",
                           "distance_to_goal": float(np.linalg.norm(q[:2]-np.array(controller.robot.goal))),
                           "joints": self.data.qpos[controller.qids].tolist()})
        return {"episode_id": self.episode_id, "scene_epoch": self.scene_epoch, "tick": self.tick,
                "sim_time": round(float(self.data.time), 6), "paused": self.paused, "mode": self.mode,
                "invalidated": self.invalidated, "robots": robots,
                "bodies": [{"name": self.model.body(i).name, "position": self.data.xpos[i].tolist(), "quaternion": self.data.xquat[i].tolist()}
                           for i in range(1, self.model.nbody)],
                "metrics": self.public_metrics(), "events": copy.deepcopy(self.events[-30:]),
                "physics_hz": 500, "policy_hz": 50}

    def model_description(self):
        return {"basis": "right-handed-z-up", "units": "meters", "quaternion_order": "wxyz",
                "geoms": self.geometries, "scene": self.scene.model_dump(mode="json"),
                "model_hash": self.model_hash, "policy_hash": self.policy_hash,
                "provenance": self.provenance, "physics_hz": 500, "policy_hz": 50,
                "controller": "Unitree RL Gym TorchScript LSTM + PD; independent recurrent state per robot"}

    def public_metrics(self):
        return {"min_separation": self.metrics["min_separation_m"],
                "robot_contacts": self.metrics["robot_contact_ticks"],
                "obstacle_contacts": self.metrics["obstacle_contact_ticks"],
                "keepout_violations": self.metrics["keepout_violation_ticks"],
                "boundary_violations": self.metrics["boundary_violation_ticks"],
                "falls": len(self.metrics["falls"]), "goals_reached": len(self.metrics["goals_reached"]),
                "elapsed": round(float(self.data.time), 6),
                "deadlock": bool(self.data.time > 30 and len(self.metrics["goals_reached"]) < 2),
                "path_length_m": copy.deepcopy(self.metrics["path_length_m"])}

    def checkpoint(self):
        state = np.empty(mujoco.mj_stateSize(self.model, STATE_SPEC))
        mujoco.mj_getState(self.model, self.data, state, STATE_SPEC)
        return {"version": 1, "scene": self.scene.model_dump(mode="json"), "model_hash": self.model_hash,
                "policy_hash": self.policy_hash, "episode_id": self.episode_id, "scene_epoch": self.scene_epoch,
                "tick": self.tick, "mode": self.mode, "paused": self.paused, "invalidated": self.invalidated,
                "physics": state.tolist(), "controllers": {rid: c.checkpoint() for rid, c in self.controllers.items()},
                "metrics": copy.deepcopy(self.metrics), "events": copy.deepcopy(self.events),
                "active_contacts": [list(x) for x in sorted(self.active_contacts)],
                "active_violations": [list(x) for x in sorted(self.active_violations)],
                "last_positions": {rid: pos.tolist() for rid, pos in self.last_positions.items()},
                "external_commands": copy.deepcopy(self.external_commands), "external_expires_tick": self.external_expires_tick,
                "reservation_owner": self.reservation_owner, "rng_state": copy.deepcopy(self.rng.bit_generator.state)}

    def restore(self, checkpoint):
        if checkpoint["model_hash"] != self.model_hash or checkpoint["policy_hash"] != self.policy_hash:
            raise ValueError("Checkpoint model/policy does not match this world")
        state = np.array(checkpoint["physics"], dtype=np.float64)
        if len(state) != mujoco.mj_stateSize(self.model, STATE_SPEC) or not np.isfinite(state).all():
            raise ValueError("Invalid MuJoCo integration checkpoint")
        mujoco.mj_setState(self.model, self.data, state, STATE_SPEC)
        mujoco.mj_forward(self.model, self.data)
        for key in ("episode_id", "scene_epoch", "tick", "mode", "paused", "invalidated", "reservation_owner", "external_expires_tick"):
            setattr(self, key, checkpoint[key])
        for key in ("metrics", "events", "external_commands"):
            setattr(self, key, copy.deepcopy(checkpoint[key]))
        self.active_contacts = {tuple(x) for x in checkpoint["active_contacts"]}
        self.active_violations = {tuple(x) for x in checkpoint["active_violations"]}
        self.last_positions = {rid: np.array(pos) for rid, pos in checkpoint["last_positions"].items()}
        self.rng.bit_generator.state = copy.deepcopy(checkpoint["rng_state"])
        for rid, controller in self.controllers.items():
            controller.restore(checkpoint["controllers"][rid])

    @classmethod
    def from_checkpoint(cls, checkpoint):
        world = cls(checkpoint["scene"], checkpoint["mode"], checkpoint["scene_epoch"])
        world.restore(checkpoint)
        return world
