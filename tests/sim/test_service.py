from fastapi.testclient import TestClient

from sim.server import app


def test_service_checkpoint_branch_and_stale_invalidation():
    with TestClient(app) as client:
        assert client.get("/health").json()["shared_world"] is True
        model = client.get("/model").json()
        assert model["geoms"][0]["mesh"].startswith("/api/sim/assets/")
        before = client.get("/state").json()
        cp = client.post("/checkpoint").json()
        response = client.post("/fork", json={"checkpoint_id": cp["checkpoint_id"], "mode": "external"})
        assert response.status_code == 200, response.text
        branch_id = response.json()["branch_id"]
        stepped = client.post(f"/branch/{branch_id}/step", json={"commands": {"g1_a": [.5, 0], "g1_b": [0, 0]}, "steps": 10})
        assert stepped.status_code == 200, stepped.text
        assert stepped.json()["tick"] == before["tick"]+100
        assert client.get("/state").json()["tick"] == before["tick"]
        assert client.post(f"/branch/{branch_id}/step", json={"commands": {"g1_a": [10, 0]}}).status_code == 422
        assert client.get(f"/branch/{branch_id}/result").json()["passed"] is False
        client.post("/invalidate")
        assert client.post("/fork", json={"checkpoint_id": cp["checkpoint_id"]}).status_code == 409
        assert client.post("/resume").status_code == 409
        assert client.post("/reset", json={}).status_code == 200


def test_realtime_commands_do_not_double_step_and_controller_source_is_real():
    with TestClient(app) as client:
        source = client.get("/controller").json()
        assert "def desired_velocities" in source["source"]
        assert source["envelope_radius_m"] == .45
        assert client.post("/run", json={"mode": "external"}).status_code == 200
        assert client.post("/step", json={"steps": 1}).status_code == 409
        accepted = client.post("/commands", json={"commands": {"g1_a": [.3, 0]}, "ttl_seconds": .2})
        assert accepted.status_code == 200
        assert accepted.json()["expires_tick"]-accepted.json()["tick"] == 100
        assert client.post("/commands", content='{"commands":{"g1_a":[NaN,0]}}', headers={"content-type": "application/json"}).status_code == 422
        one = client.get("/random-scene?seed=28").json()
        two = client.get("/random-scene?seed=28").json()
        assert one == two
