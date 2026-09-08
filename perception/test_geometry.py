"""Synthetic geometry tests, explicitly not learned-model accuracy evidence."""
import numpy as np
import pytest
from perception.geometry import (GeometryError, fit_floor, homogeneous, metric_depth,
    relative_camera, reprojection_error, robust_scale, world_to_clip)


def scene_depth(width=320, height=240):
    k = np.array([[250., 0., width/2], [0., 250., height/2], [0., 0., 1.]])
    yy, xx = np.mgrid[:height, :width]
    rays = np.stack([(xx-width/2)/250, (yy-height/2)/250, np.ones_like(xx)], axis=-1)
    normal = np.array([0., -.8, -.6])
    return -1.6/(rays @ normal), k, normal


def test_floor_ransac_outliers_and_canonical_frame():
    depth, k, normal = scene_depth()
    rng = np.random.default_rng(4)
    noisy = depth+rng.normal(0, .003, depth.shape)
    noisy[rng.random(depth.shape) < .2] = 8
    floor = fit_floor(noisy, k, np.ones(depth.shape))
    assert floor.inlier_ratio > .7
    assert floor.normal @ normal > .999
    assert abs(floor.offset-1.6) < .02
    assert np.linalg.det(floor.anchor_from_stage[:3, :3]) == pytest.approx(1)
    points = np.array([[0., 0., 0., 1.], [1., 2., 0., 1.]]) @ floor.anchor_from_stage.T
    assert np.max(np.abs(points[:, :3] @ floor.normal+floor.offset)) < 1e-6


def test_no_floor_is_not_calibrated():
    depth, k, _ = scene_depth()
    for invalid in [np.full_like(depth, np.nan), np.full_like(depth, 2.), np.zeros_like(depth)]:
        with pytest.raises(GeometryError):
            fit_floor(invalid, k)


def test_metric_focal_scaling_and_robust_alignment():
    depth, k, _ = scene_depth()
    assert np.allclose(metric_depth(np.ones_like(depth), k), 250/300)
    relative = depth/3
    scale, scatter = robust_scale(relative, depth, np.ones_like(depth))
    assert scale == pytest.approx(3) and scatter < 1e-10
    with pytest.raises(GeometryError):
        robust_scale(relative, np.full_like(depth, np.nan))


def test_world_clip_column_major_matches_camera_pixels_and_depth():
    depth, k, _ = scene_depth()
    floor = fit_floor(depth, k)
    matrix = np.array(world_to_clip(k, 320, 240, floor.anchor_from_stage)).reshape((4, 4), order="F")
    points = np.array([[0, 0, 0, 1], [.2, .3, 1, 1]], dtype=float)
    camera = points @ floor.anchor_from_stage.T
    pixels = camera[:, :3] @ k.T
    pixels = pixels[:, :2]/pixels[:, 2:]
    clip = points @ matrix.T
    ndc = clip[:, :3]/clip[:, 3:]
    assert np.allclose(ndc[:, 0], 2*pixels[:, 0]/320-1)
    assert np.allclose(ndc[:, 1], 1-2*pixels[:, 1]/240)
    assert np.all(clip[:, 3] > 0)
    assert np.all((-1 < ndc[:, 2]) & (ndc[:, 2] < 1))


def test_shared_scale_moves_translation_not_rotation():
    anchor = np.eye(4)
    current = np.eye(4)
    current[0, 3] = -.1
    relative = relative_camera(current, anchor, 3)
    assert relative[0, 3] == pytest.approx(-.3)
    assert np.array_equal(relative[:3, :3], np.eye(3))
    invalid = np.eye(4)
    invalid[0, 0] = -1
    with pytest.raises(GeometryError):
        homogeneous(invalid)


def test_independent_reprojection_detects_wrong_pose():
    depth, k, _ = scene_depth()
    xx, yy = np.meshgrid(np.linspace(50, 270, 8), np.linspace(50, 190, 7))
    uv = np.column_stack([xx.ravel(), yy.ravel()])
    error, inliers, count = reprojection_error(uv, uv, depth, k, k, np.eye(4))
    assert error < 1e-8 and inliers == 1 and count == 56
    wrong = np.eye(4)
    wrong[0, 3] = 1
    error, _, _ = reprojection_error(uv, uv, depth, k, k, wrong)
    assert error > 30
