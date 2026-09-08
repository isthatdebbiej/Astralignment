"""Auditable camera geometry. NumPy only; no network, models or hidden poses.

OpenCV camera coordinates: X right, Y down, Z forward. Canonical stage:
X right, Y away from the initial camera, Z up. Distances are model-estimated
metres, not measured calibration. A floor hypothesis is not semantic proof.
"""
from dataclasses import dataclass
import math
import numpy as np


class GeometryError(ValueError):
    pass


def homogeneous(extrinsic):
    matrix = np.asarray(extrinsic, dtype=np.float64)
    if matrix.shape == (3, 4):
        matrix = np.vstack([matrix, [0., 0., 0., 1.]])
    if matrix.shape != (4, 4) or not np.isfinite(matrix).all():
        raise GeometryError("Camera extrinsics are missing or nonfinite")
    if not np.allclose(matrix[3], [0, 0, 0, 1], atol=1e-5):
        raise GeometryError("Invalid homogeneous camera transform")
    rotation = matrix[:3, :3]
    if not np.allclose(rotation.T @ rotation, np.eye(3), atol=.03) or abs(np.linalg.det(rotation)-1) > .03:
        raise GeometryError("Camera rotation is not a proper rigid transform")
    return matrix.copy()


def valid_intrinsics(intrinsics, width, height):
    k = np.asarray(intrinsics, dtype=np.float64)
    if k.shape != (3, 3) or not np.isfinite(k).all():
        raise GeometryError("Camera intrinsics are missing or nonfinite")
    if not (.2*width < k[0, 0] < 5*width and .2*height < k[1, 1] < 8*height):
        raise GeometryError("Predicted focal length is outside admitted range")
    if not (-.1*width < k[0, 2] < 1.1*width and -.1*height < k[1, 2] < 1.1*height):
        raise GeometryError("Predicted principal point is outside image")
    if not np.allclose(k[2], [0, 0, 1], atol=1e-5):
        raise GeometryError("Invalid intrinsic matrix")
    return k


def metric_depth(canonical_depth, intrinsics):
    """Official DA3 apply_metric_scaling: depth * mean(fx,fy) / 300."""
    return np.asarray(canonical_depth, dtype=np.float64) * (
        (intrinsics[0, 0]+intrinsics[1, 1])/600.)


def robust_scale(relative, metric, confidence=None, sky=None):
    a, b = np.asarray(relative), np.asarray(metric)
    if a.shape != b.shape:
        raise GeometryError("Depth models returned inconsistent processed dimensions")
    mask = np.isfinite(a) & np.isfinite(b) & (a > 1e-4) & (b > .15) & (b < 35)
    if confidence is not None:
        conf = np.asarray(confidence)
        finite = np.isfinite(conf)
        if finite.sum() < 100:
            raise GeometryError("Insufficient depth confidence")
        mask &= finite & (conf >= np.quantile(conf[finite], .5))
    if sky is not None:
        mask &= ~np.asarray(sky, dtype=bool)
    if mask.sum() < 300:
        raise GeometryError("Insufficient valid pixels for metric-scale alignment")
    ratios = b[mask]/a[mask]
    scale = float(np.median(ratios))
    scatter = float(np.median(np.abs(ratios/scale-1)))
    if not math.isfinite(scale) or scale <= 0 or scatter > .35:
        raise GeometryError("Relative and metric depth estimates disagree")
    return scale, scatter


def unproject(depth, intrinsics, pixels):
    pixels = np.asarray(pixels, dtype=np.float64)
    uv1 = np.column_stack([pixels, np.ones(len(pixels))])
    return (uv1 @ np.linalg.inv(intrinsics).T) * np.asarray(depth).reshape(-1, 1)


@dataclass
class Floor:
    normal: np.ndarray
    offset: float
    anchor_from_stage: np.ndarray
    inlier_ratio: float
    residual_m: float
    support_width_m: float
    support_depth_m: float


def fit_floor(depth, intrinsics, confidence=None, sky=None, seed=7):
    depth = np.asarray(depth, dtype=np.float64)
    height, width = depth.shape
    k = valid_intrinsics(intrinsics, width, height)
    yy, xx = np.mgrid[0:height:4, 0:width:4]
    values = depth[yy, xx]
    mask = (yy >= .52*height) & np.isfinite(values) & (values > .3) & (values < 12)
    if confidence is not None:
        conf = np.asarray(confidence)
        finite = np.isfinite(conf)
        if finite.sum() < 100:
            raise GeometryError("No reliable floor-depth pixels")
        mask &= np.isfinite(conf[yy, xx]) & (conf[yy, xx] >= np.quantile(conf[finite], .5))
    if sky is not None:
        mask &= ~np.asarray(sky, dtype=bool)[yy, xx]
    pixels = np.column_stack([xx[mask], yy[mask]])
    if len(pixels) < 150:
        raise GeometryError("Searching for a visible, textured lower-image floor")
    points = unproject(values[mask], k, pixels)
    rng = np.random.default_rng(seed)
    best = None
    for _ in range(240):
        p = points[rng.choice(len(points), 3, replace=False)]
        normal = np.cross(p[1]-p[0], p[2]-p[0])
        norm = np.linalg.norm(normal)
        if norm < 1e-7:
            continue
        normal /= norm
        offset = -float(normal @ p[0])
        if offset < 0:
            normal, offset = -normal, -offset
        # Upright/obliquely held camera prior. No IMU/gravity is claimed.
        if normal[1] > -.45 or not .5 < offset < 2.5:
            continue
        residual = np.abs(points @ normal+offset)
        inliers = residual < .045
        score = int(inliers.sum())
        if best is None or score > best[0]:
            best = (score, inliers)
    if best is None or best[0]/len(points) < .32 or best[0] < 120:
        raise GeometryError("No sufficiently supported floor plane; point camera toward the floor")
    inlier_points = points[best[1]]
    centroid = np.mean(inlier_points, axis=0)
    _, _, vh = np.linalg.svd(inlier_points-centroid, full_matrices=False)
    normal = vh[-1]
    offset = -float(normal @ centroid)
    if offset < 0:
        normal, offset = -normal, -offset
    residuals = np.abs(points @ normal+offset)
    inliers = residuals < .045
    if normal[1] > -.45 or not .5 < offset < 2.5 or inliers.mean() < .32:
        raise GeometryError("Refined floor is inconsistent with an upright handheld camera")
    right = np.array([1., 0., 0.])-normal*normal[0]
    right /= np.linalg.norm(right)
    forward = np.cross(normal, right)
    forward /= np.linalg.norm(forward)
    origin = np.median(points[inliers], axis=0)
    origin -= normal*(normal @ origin+offset)
    projected = (points[inliers]-origin) @ np.column_stack([right, forward])
    extent = np.quantile(projected, .95, axis=0)-np.quantile(projected, .05, axis=0)
    if extent[0] < .65 or extent[1] < .65:
        raise GeometryError("Floor support is too narrow; a tabletop or thin surface is possible")
    # Do not imply that the entire requested virtual stage fits the observed room.
    transform = np.eye(4)
    transform[:3, :3] = np.column_stack([right, forward, normal])
    transform[:3, 3] = origin
    return Floor(normal, offset, transform, float(inliers.mean()),
                 float(np.median(residuals[inliers])), float(extent[0]), float(extent[1]))


def relative_camera(extrinsic, anchor_extrinsic, scale):
    relative = homogeneous(extrinsic) @ np.linalg.inv(homogeneous(anchor_extrinsic))
    relative[:3, 3] *= scale
    return relative


def world_to_clip(intrinsics, width, height, camera_from_stage, near=.05, far=100.):
    """OpenCV +Z-forward camera -> WebGL clip; result column-major for Three."""
    k = valid_intrinsics(intrinsics, width, height)
    projection = np.zeros((4, 4), dtype=np.float64)
    projection[0] = [2*k[0, 0]/width, 2*k[0, 1]/width, 2*k[0, 2]/width-1, 0]
    projection[1] = [0, -2*k[1, 1]/height, 1-2*k[1, 2]/height, 0]
    projection[2] = [0, 0, (far+near)/(far-near), -2*far*near/(far-near)]
    projection[3] = [0, 0, 1, 0]
    matrix = projection @ homogeneous(camera_from_stage)
    if not np.isfinite(matrix).all():
        raise GeometryError("Projection contains nonfinite values")
    return matrix.flatten(order="F").tolist()


def reprojection_error(points_uv, observed_uv, source_depth, source_k, target_k, target_from_source):
    uv = np.asarray(points_uv, dtype=np.float64)
    observed = np.asarray(observed_uv, dtype=np.float64)
    xy = np.rint(uv).astype(int)
    height, width = source_depth.shape
    valid = (xy[:, 0] >= 0) & (xy[:, 0] < width) & (xy[:, 1] >= 0) & (xy[:, 1] < height)
    xy = xy[valid]
    uv, observed = uv[valid], observed[valid]
    depths = source_depth[xy[:, 1], xy[:, 0]]
    points = unproject(depths, source_k, uv)
    transform = homogeneous(target_from_source)
    camera = points @ transform[:3, :3].T+transform[:3, 3]
    valid = np.isfinite(camera).all(axis=1) & (depths > .15) & (depths < 35) & (camera[:, 2] > .1)
    if valid.sum() < 20:
        raise GeometryError("Insufficient reliable matched 3D points")
    pixels = camera[valid] @ target_k.T
    pixels = pixels[:, :2]/pixels[:, 2:]
    errors = np.linalg.norm(pixels-observed[valid], axis=1)
    return float(np.median(errors)), float(np.mean(errors < 12)), int(len(errors))
