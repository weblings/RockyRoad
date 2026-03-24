import * as THREE from "three";

export class Camera3D {
  readonly threeCamera: THREE.PerspectiveCamera;

  position: THREE.Vector3;
  forward: THREE.Vector3;
  up: THREE.Vector3;
  right: THREE.Vector3;

  mirrorLeftRight: boolean = false;
  isOrthographic: boolean = false;
  orthographicScale: number = 1;

  constructor(
    viewportWidth: number,
    viewportHeight: number,
    fieldOfViewDeg: number = 45,
    nearPlane: number = 1,
    farPlane: number = 10000
  ) {
    this.threeCamera = new THREE.PerspectiveCamera(
      fieldOfViewDeg,
      viewportWidth / viewportHeight,
      nearPlane,
      farPlane
    );

    this.position = new THREE.Vector3(0, 0, 0);
    this.forward  = new THREE.Vector3(0, 0, -1);
    this.up       = new THREE.Vector3(0, 1, 0);
    this.right    = new THREE.Vector3(1, 0, 0);
  }

  setViewport(width: number, height: number): void {
    this.threeCamera.aspect = width / height;
    this.threeCamera.updateProjectionMatrix();
  }

  setLookAt(lookAt: THREE.Vector3): void {
    this.forward = lookAt.clone().sub(this.position).normalize();
    this.right = new THREE.Vector3()
      .crossVectors(this.forward, new THREE.Vector3(0, 1, 0))
      .normalize();
    this.up = new THREE.Vector3()
      .crossVectors(this.right, this.forward)
      .normalize();

    this.threeCamera.position.copy(this.position);
    this.threeCamera.up.copy(this.up);
    this.threeCamera.lookAt(lookAt);
    this.applyMirror();
  }

  syncToThreeCamera(): void {
    this.threeCamera.position.copy(this.position);
    this.threeCamera.up.copy(this.up);
    this.applyMirror();
  }

  private applyMirror(): void {
    this.threeCamera.scale.x = this.mirrorLeftRight ? -1 : 1;
    this.threeCamera.updateMatrix();
  }

  getDistanceForWidth(width: number): number {
    const fovRad = THREE.MathUtils.degToRad(this.threeCamera.fov);
    return width / (2.0 * Math.tan(fovRad / 2.0));
  }
}
