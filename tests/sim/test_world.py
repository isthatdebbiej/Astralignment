import math

import numpy as np
import pytest

from sim.evaluator import evaluate
from sim.scene import SceneConfig, default_scene, point_clear, randomized_scene
from sim.world import SharedWorld


def test_two_physical_g1s_walk_and_share_one_clock():
    world = SharedWorld()
    start = {rid: world.position(rid).copy() for rid in world.controllers}
    for _ in range(120):
        world.step()
    assert world.model.nu == 24 and world.model.nq == 38
    assert world.tick == 1200
    assert world.data.time == pytest.approx(2.4)
    for rid, controller in world.controllers.items():
        assert np.linalg.norm(world.position(rid)-start[rid]) > .65
        assert not controller.fallen(world.data)
        assert np.max(np.abs(world.data.actuator_force[controller.actuator_ids])) > 1
        assert controller.observation.shape == (47,)


def test_robot_and_branch_recurrent_states_are_independent():
    world = SharedWorld()
    a, b = world.controllers.values()
    for name in ("hidden_state", "cell_state"):
        assert getattr(a.policy, name).data_ptr() != getattr(b.policy, name).data_ptr()
    for _ in range(10):
        world.step({"g1_a": [.5, 0], "g1_b": [0, 0]})
    assert not np.array_equal(a.policy.hidden_state.numpy(), b.policy.hidden_state.numpy())
    frozen = world.checkpoint()
    branch = SharedWorld.from_checkpoint(frozen)
    for name in ("hidden_state", "cell_state"):
        assert getattr(a.policy, name).data_ptr() != getattr(branch.controllers["g1_a"].policy, name).data_ptr()
    branch.step({"g1_a": [0, 0], "g1_b": [.4, 0]})
    assert world.checkpoint() == frozen


def test_checkpoint_restores_integrator_lstm_and_replays_exactly():
    world = SharedWorld()
    for _ in range(55):
        world.step()
    frozen = world.checkpoint()
    for _ in range(30):
        world.step()
    expected = world.checkpoint()
    world.restore(frozen)
    for _ in range(30):
        world.step()
    actual = world.checkpoint()
    np.testing.assert_allclose(actual["physics"], expected["physics"], rtol=0, atol=1e-10)
    assert actual["controllers"] == expected["controllers"]
    assert actual["tick"] == expected["tick"]
    assert actual["metrics"] == expected["metrics"]


def test_contacts_map_both_robot_owners_and_exclude_floor():
    world = SharedWorld()
    for _ in range(250):
        world.step()
    assert world.metrics["robot_contact_ticks"] > 0
    contacts = [event for event in world.events if event["kind"] == "robot_contact"]
    assert contacts and contacts[0]["owners"] == ["g1_a", "g1_b"]
    assert world.metrics["obstacle_contact_ticks"] == 0


def test_model_visual_transforms_are_authored_not_compiled_mesh_poses():
    world = SharedWorld()
    geoms = world.model_description()["geoms"]
    pelvis = next(g for g in geoms if g["body"] == "g1_a/pelvis" and g["mesh"].endswith("pelvis.STL"))
    assert pelvis["local_position"] == [0, 0, 0]
    assert pelvis["local_quaternion"] == [1, 0, 0, 0]
    assert len({g["name"] for g in geoms}) == len(geoms)
    assert {g["body"].split("/")[0] for g in geoms} == {"g1_a", "g1_b"}


def test_obstacle_visual_matches_physical_box_and_body_height():
    spec = default_scene().model_dump()
    spec["obstacles"] = [{"id": "visible", "position": [1.5, 1.0], "size": [.6, .6, .9]}]
    world = SharedWorld(spec)
    visual = next(geom for geom in world.model_description()["geoms"] if geom["name"] == "obstacle/visible")
    body = next(body for body in world.snapshot()["bodies"] if body["name"] == visual["body"])
    assert visual["kind"] == "box"
    assert visual["local_position"] == [0, 0, 0]
    assert visual["local_quaternion"] == [1, 0, 0, 0]
    np.testing.assert_allclose(visual["size"], world.model.geom("obstacle/visible").size, atol=0, rtol=0)
    assert body["position"] == [1.5, 1.0, .45]
    assert body["quaternion"] == [1, 0, 0, 0]


def test_seeded_scene_sampling_and_validation():
    assert randomized_scene(42) == randomized_scene(42)
    assert randomized_scene(42) != randomized_scene(43)
    bad = default_scene().model_dump()
    bad["robots"][1]["spawn"] = bad["robots"][0]["spawn"]
    with pytest.raises(ValueError, match="separation"):
        SceneConfig.model_validate(bad)


def test_envelope_detects_keepout_before_pelvis_enters_and_emits_error():
    spec = default_scene().model_dump()
    spec["keepouts"] = [{"id": "human", "polygon": [[-.5, .35], [.5, .35], [.5, 1.4], [-.5, 1.4]]}]
    world = SharedWorld(spec)
    a = world.controllers["g1_a"]
    # Test fixture places the pelvis outside the keepout; its .45 m envelope overlaps.
    world.data.qpos[a.qbase:a.qbase+2] = [0, 0]
    world.observe_metrics()
    assert world.metrics["keepout_violation_ticks"] == 1
    event = next(e for e in world.events if e["kind"] == "keepout_violation")
    assert event["severity"] == "error" and event["robot_id"] == "g1_a"


def test_nonfinite_velocity_is_rejected_before_physics_changes():
    world = SharedWorld()
    frozen = world.checkpoint()
    for velocity in ([math.nan, 0], [0, math.inf], [0, -math.inf], [.8, 0]):
        with pytest.raises(ValueError):
            world.step({"g1_a": velocity})
        assert world.checkpoint() == frozen
    bad = default_scene().model_dump()
    bad["robots"][0]["spawn"] = [math.nan, 0, 0]
    with pytest.raises(ValueError):
        SceneConfig.model_validate(bad)


def test_reference_reservation_completes_without_robot_contact():
    world = SharedWorld(mode="reservation")
    result = evaluate(world, 30)
    assert result["passed"], result["reason"]
    assert result["metrics"]["goals_reached"] == 2
    assert result["metrics"]["robot_contacts"] == 0
