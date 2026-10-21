import * as THREE from "three";

// Ported from Camera3D.cs. Three.js computes view/projection matrices internally (no
// GetViewMatrix()/GetProjectionMatrix() needed). XNA is left-handed, Three.js right-handed —
// FretCamera's Forward=(0,0,-1) already matches right-handed, so world coords are assumed
// compatible as-is (verify if anything mirrors on Z). IsOrthographic is never set true in the
// original — ported as a stub, always perspective.

export class Camera3D {
  // In Three.js, camera state is stored on the THREE.PerspectiveCamera directly.
  // We hold a reference to it so callers can add it to a scene and pass it to
  // renderer.render().
  readonly threeCamera: THREE.PerspectiveCamera;

  // Keeping these as explicit properties to match the original API surface.
  // They are updated by SetLookAt() and read by subclass update logic.
  position: THREE.Vector3;
  forward: THREE.Vector3;
  up: THREE.Vector3;
  right: THREE.Vector3;

  // Lefty mode: mirrors the scene horizontally via camera.scale.x = -1 (XNA used
  // Matrix.CreateScale(-1,1,1)). Inverts face winding, but original code uses CullNone
  // everywhere so it has no rendering effect.
  mirrorLeftRight: boolean = false;

  // Orthographic stub — not used in practice (IsOrthographic is always false).
  isOrthographic: boolean = false;
  orthographicScale: number = 1;

  constructor(
    viewportWidth: number,
    viewportHeight: number,
    fieldOfViewDeg: number = 45,  // see note below
    nearPlane: number = 1,
    farPlane: number = 10000
  ) {
    // FOV conversion: XNA stores FOV in RADIANS (Math.PI / 4 = 45 degrees).
    // THREE.PerspectiveCamera takes FOV in DEGREES.
    // Both use VERTICAL field of view, so no axis swap needed — just unit conversion.
    // The default Math.PI/4 rad = 45 deg is preserved here.
    this.threeCamera = new THREE.PerspectiveCamera(
      fieldOfViewDeg,
      viewportWidth / viewportHeight,
      nearPlane,
      farPlane
    );

    // Initialize to match XNA defaults: position at origin, looking down -Z.
    this.position = new THREE.Vector3(0, 0, 0);
    this.forward  = new THREE.Vector3(0, 0, -1);
    this.up       = new THREE.Vector3(0, 1, 0); // Vector3.Up = (0,1,0) in both XNA and Three.js
    this.right    = new THREE.Vector3(1, 0, 0);
  }

  // Called whenever viewport dimensions change (e.g. window resize).
  setViewport(width: number, height: number): void {
    this.threeCamera.aspect = width / height;
    this.threeCamera.updateProjectionMatrix();
  }

  // Mirrors SetLookAt(Vector3 lookAt) from the original.
  // XNA: manually computes Forward, Right, Up and stores them.
  // Three.js: camera.lookAt() handles the internal matrix — we mirror the stored
  // vectors so subclass code that reads this.forward/right/up stays consistent.
  setLookAt(lookAt: THREE.Vector3): void {
    this.forward = lookAt.clone().sub(this.position).normalize();

    // Cross(forward, worldUp) — same math as XNA's Vector3.Cross(Forward, Vector3.Up)
    this.right = new THREE.Vector3()
      .crossVectors(this.forward, new THREE.Vector3(0, 1, 0))
      .normalize();

    // Recompute up to be orthogonal (Cross(right, forward))
    this.up = new THREE.Vector3()
      .crossVectors(this.right, this.forward)
      .normalize();

    // Sync to Three.js camera. We set position first so lookAt is correct.
    this.threeCamera.position.copy(this.position);
    this.threeCamera.up.copy(this.up);
    this.threeCamera.lookAt(lookAt);

    // Apply lefty mirror after lookAt so it isn't overwritten.
    this.applyMirror();
  }

  // Syncs this.position / this.mirrorLeftRight state to the Three.js camera.
  // Call this if you update position or mirrorLeftRight directly rather than
  // going through setLookAt().
  syncToThreeCamera(): void {
    this.threeCamera.position.copy(this.position);
    this.threeCamera.up.copy(this.up);
    this.applyMirror();
  }

  private applyMirror(): void {
    // XNA: Matrix.CreateLookAt(...) * Matrix.CreateScale(-1, 1, 1)
    // Three.js: negating camera.scale.x mirrors the rendered output identically.
    this.threeCamera.scale.x = this.mirrorLeftRight ? -1 : 1;
    this.threeCamera.updateMatrix();
  }

  // Ported directly — pure trigonometry, no framework dependency.
  // Returns the camera distance at which a world-space horizontal span of
  // `width` units exactly fills the viewport (given the current FOV).
  getDistanceForWidth(width: number): number {
    const fovRad = THREE.MathUtils.degToRad(this.threeCamera.fov);
    return width / (2.0 * Math.tan(fovRad / 2.0));
  }
}
