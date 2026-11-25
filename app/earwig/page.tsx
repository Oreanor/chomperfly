'use client';

import { useEffect, useRef } from 'react';
import * as THREE from 'three';
import { makeEarwig, poseAbdomen } from '@/lib/worm/earwigModel';

/**
 * The earwig on a turntable, to look at the model: W curls the tail over the back, A / D swings it,
 * S stretches it.
 */
export default function EarwigPage() {
  const mountRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const mount = mountRef.current!;
    const renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
    renderer.setSize(mount.clientWidth, mount.clientHeight);
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    mount.appendChild(renderer.domElement);
    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0x1d2a1c);
    const camera = new THREE.PerspectiveCamera(35, mount.clientWidth / mount.clientHeight, 0.01, 50);
    scene.add(new THREE.HemisphereLight(0xdfe8ff, 0x332211, 0.9));
    const sun = new THREE.DirectionalLight(0xffffff, 2.6);
    sun.position.set(1.5, 3, 1.2);
    sun.castShadow = true;
    sun.shadow.mapSize.set(2048, 2048);
    const sc = sun.shadow.camera;
    sc.left = sc.bottom = -1.2;
    sc.right = sc.top = 1.2;
    scene.add(sun);
    // a red disc to stand on (an apple's skin)
    const floor = new THREE.Mesh(new THREE.CircleGeometry(1.4, 64), new THREE.MeshStandardMaterial({ color: 0xb3261e, roughness: 0.45 }));
    floor.rotation.x = -Math.PI / 2;
    floor.receiveShadow = true;
    scene.add(floor);
    const earwig = makeEarwig(1);
    scene.add(earwig.group);
    const down = new Set<string>();
    const onDown = (e: KeyboardEvent) => down.add(e.code);
    const onUp = (e: KeyboardEvent) => down.delete(e.code);
    window.addEventListener('keydown', onDown);
    window.addEventListener('keyup', onUp);
    const pose = { yaw: 0, curl: 0.03, stretch: 1 };
    let last = performance.now();
    let raf = 0;
    const start = performance.now();
    const frame = () => {
      const t = (performance.now() - start) / 1000;
      const dt = Math.min(0.05, (performance.now() - last) / 1000);
      last = performance.now();
      // the camera goes slowly round
      const a = 0.15 * t;
      camera.position.set(Math.sin(a) * 1.45, 0.75, Math.cos(a) * 1.45);
      camera.lookAt(0, 0.04, -0.12);
      const want = {
        yaw: (down.has('KeyA') || down.has('ArrowLeft') ? 1.9 : 0) - (down.has('KeyD') || down.has('ArrowRight') ? 1.9 : 0),
        curl: down.has('KeyW') || down.has('ArrowUp') ? 1.2 : 0.03,
        stretch: down.has('KeyS') || down.has('ArrowDown') ? 1.9 : 1,
      };
      const k = 1 - Math.exp(-12 * dt);
      pose.yaw += (want.yaw - pose.yaw) * k;
      pose.curl += (want.curl - pose.curl) * k;
      pose.stretch += (want.stretch - pose.stretch) * k;
      poseAbdomen(earwig, pose.curl, pose.yaw, pose.stretch);
      earwig.group.rotation.z = Math.max(-0.35, Math.min(0.35, pose.yaw * 0.2));
      for (const w of earwig.wings) {
        w.visible = false;
        w.rotation.z = Math.sin(t * 30) * 0.25 * Math.sign(w.position.x);
      }
      renderer.render(scene, camera);
      raf = requestAnimationFrame(frame);
    };
    frame();
    const onResize = () => {
      renderer.setSize(mount.clientWidth, mount.clientHeight);
      camera.aspect = mount.clientWidth / mount.clientHeight;
      camera.updateProjectionMatrix();
    };
    window.addEventListener('resize', onResize);
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener('resize', onResize);
      window.removeEventListener('keydown', onDown);
      window.removeEventListener('keyup', onUp);
      renderer.dispose();
      mount.removeChild(renderer.domElement);
    };
  }, []);
  return <div ref={mountRef} style={{ position: 'fixed', inset: 0 }} />;
}
