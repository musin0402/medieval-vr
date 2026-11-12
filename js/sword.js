import * as THREE from 'three';

// Espada low-poly. El filo apunta hacia -Z (la dirección del rayo del mando); la empuñadura queda en el origen.
export function createSword() {
  const sword = new THREE.Group();
  const steel = new THREE.MeshLambertMaterial({ color: 0xdfe6ee, emissive: 0x1d242c });
  const gold = new THREE.MeshLambertMaterial({ color: 0xc9a227, emissive: 0x2a2000 });
  const leather = new THREE.MeshLambertMaterial({ color: 0x4a2f1c });

  const blade = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.012, 0.8), steel);
  blade.position.set(0, 0, -0.46);
  const ridge = new THREE.Mesh(new THREE.BoxGeometry(0.012, 0.02, 0.78), steel);
  ridge.position.set(0, 0, -0.46);
  const tip = new THREE.Mesh(new THREE.ConeGeometry(0.0354, 0.1, 4), steel);
  tip.rotation.set(-Math.PI / 2, Math.PI / 4, 0);
  tip.scale.set(1, 1, 0.24);
  tip.position.set(0, 0, -0.91);
  const guard = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.03, 0.035), gold);
  guard.position.set(0, 0, -0.04);
  const grip = new THREE.Mesh(new THREE.CylinderGeometry(0.017, 0.017, 0.16, 8), leather);
  grip.rotation.x = Math.PI / 2;
  grip.position.set(0, 0, 0.05);
  const pommel = new THREE.Mesh(new THREE.SphereGeometry(0.026, 8, 6), gold);
  pommel.position.set(0, 0, 0.14);

  sword.add(blade, ridge, tip, guard, grip, pommel);
  return sword;
}
