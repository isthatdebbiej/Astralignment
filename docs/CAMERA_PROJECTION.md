# Fixed-camera projection contract

`web/src/camera/projection.ts` exports `estimateCameraProjection(calibration, verticalFovDegrees, {near?, far?})`. It returns a column-major 4×4 `worldToClip` matrix that already contains camera extrinsics, camera position in meters/Z-up world space, `reprojectionRmsPixels`, and a normalized-image `project([x,y,z])` helper. A Three.js Camera using this combined matrix must keep its world transform and inverse identity. Do not apply a second view transform.

Floor points come from the confirmed four-corner homography. Elevated geometry uses a pinhole estimate with an explicitly supplied vertical field of view, centered principal point, square pixels, zero lens distortion and orthogonalized camera axes. The field of view is an assumption unless separately measured. Reprojection RMS reports how closely that assumption reproduces the measured floor corners; low residual alone does not establish correct elevated geometry, particularly for a near fronto-parallel floor view. Degenerate calibration, behind-camera corners and a camera estimated below the stage are rejected.

`containVideoRect` computes the same uncropped letterbox rectangle for the original video and transparent projection canvas. Display source video pixels without color processing, replacement backgrounds or inferred objects. Authoritative simulation poses supply the virtual robots. Do not use this matrix to modify physics state.

This is not automatic scene reconstruction, object occlusion, camera tracking, depth sensing or physical safety validation. Camera movement, zoom/crop changes, stabilization-induced framing shifts, orientation changes or switching phone lenses can invalidate calibration. Reconfirm the floor and lens estimate after these changes. A static frame dimension match alone cannot prove the camera stayed fixed.

## Live video but no robots

Pairing only supplies video; it does not calibrate the physical floor. In **Setup → Camera**, capture a calibration still, select the four floor corners in the displayed order, enter measured width/depth, and confirm the layout. Keep the phone fixed afterward. A scene reset that changes floor dimensions invalidates the existing projection; the overlay deliberately hides robots instead of showing them at an incorrect scale. Use **Calibrate this camera** on the warning to supply the correct floor. Lens settings cannot repair a floor-dimension or video-aspect mismatch.

Synthetic browser fixtures are not measurements of a user's room. Do not run scene-mutating overlay tests against an active shared deployment; use an isolated test instance.

## Pairing lifetime

The desktop retains its private pairing in tab-scoped session storage and resumes it automatically after reload/navigation. A returning viewer renegotiates the connection without stopping the phone's camera track. **Disconnect and forget** clears the saved pairing and explicitly stops the peer. Closing the desktop tab, expiration of the 30-minute pairing, or a gateway restart can require pairing again. Phone camera permission and keeping the phone page open are still browser/device requirements; this is not background camera access. Pairing persistence does not validate a moved camera's calibration.

Focused tests use a known synthetic oblique pinhole camera and verify ground/elevated point projection and column-major clip mapping to 1e-8; a deliberately wrong FOV increases residual. Letterbox tests preserve aspect ratio within floating-point tolerance. These math checks do not establish real iPhone calibration accuracy or deployment readiness. Product owns overlay integration and browser verification.
