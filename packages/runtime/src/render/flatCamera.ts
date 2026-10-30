import type * as THREE from 'three';

/*
 * Flat (orthographic) view for 2D games: things look the same size near and far. The engine's
 * cameras stay PerspectiveCamera objects (everything else expects one); only how they project
 * changes. Raycasts and orbit controls see an orthographic camera, so picking and panning work.
 */

interface FlatCamera extends THREE.PerspectiveCamera {
  left: number;
  right: number;
  top: number;
  bottom: number;
}

const own = (camera: THREE.PerspectiveCamera) => camera as unknown as FlatCamera & { isOrthographicCamera: boolean; isPerspectiveCamera: boolean };

/** Is this camera drawing flat? */
export function isFlat(camera: THREE.Camera): boolean {
  return (camera.userData.flatHeight ?? 0) > 0;
}

/** Draw flat, showing `viewHeight` world units from the bottom of the screen to the top (null: normal 3D again). */
export function setFlat(camera: THREE.PerspectiveCamera, viewHeight: number | null): void {
  const c = own(camera);
  if (viewHeight && viewHeight > 0) {
    camera.userData.flatHeight = viewHeight;
    c.isOrthographicCamera = true;
    c.isPerspectiveCamera = false;
    camera.updateProjectionMatrix = function (this: FlatCamera) {
      const h = (this.userData.flatHeight as number) / 2 / (this.zoom || 1);
      const w = h * this.aspect;
      this.left = -w;
      this.right = w;
      this.top = h;
      this.bottom = -h;
      this.projectionMatrix.makeOrthographic(-w, w, h, -h, this.near, this.far);
      this.projectionMatrixInverse.copy(this.projectionMatrix).invert();
    };
  } else if (isFlat(camera)) {
    delete camera.userData.flatHeight;
    c.isOrthographicCamera = false;
    c.isPerspectiveCamera = true;
    // Back to PerspectiveCamera's own.
    delete (camera as unknown as { updateProjectionMatrix?: unknown }).updateProjectionMatrix;
  }
  camera.updateProjectionMatrix();
}
