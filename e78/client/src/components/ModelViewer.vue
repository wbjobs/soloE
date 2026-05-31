<template>
  <div ref="container" class="viewer"></div>
</template>

<script setup>
import { ref, onMounted, onUnmounted, watch, nextTick } from 'vue';
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { OBJLoader } from 'three/examples/jsm/loaders/OBJLoader.js';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';

const props = defineProps({
  file1: Object,
  file2: Object,
  heatmapData: Object,
  stats: Object
});

const container = ref(null);
let scene, camera, renderer, controls;
let model1, model2;
let animationId;
let loadedFile1 = null;
let loadedFile2 = null;

const init = () => {
  const width = container.value.clientWidth;
  const height = container.value.clientHeight;

  scene = new THREE.Scene();
  scene.background = new THREE.Color(0x0a0a1a);

  camera = new THREE.PerspectiveCamera(60, width / height, 0.1, 1000);
  camera.position.set(5, 5, 5);

  renderer = new THREE.WebGLRenderer({ antialias: true });
  renderer.setSize(width, height);
  renderer.setPixelRatio(window.devicePixelRatio);
  container.value.appendChild(renderer.domElement);

  controls = new OrbitControls(camera, renderer.domElement);
  controls.enableDamping = true;
  controls.dampingFactor = 0.05;

  const ambientLight = new THREE.AmbientLight(0xffffff, 0.6);
  scene.add(ambientLight);

  const directionalLight = new THREE.DirectionalLight(0xffffff, 0.8);
  directionalLight.position.set(10, 10, 5);
  scene.add(directionalLight);

  const gridHelper = new THREE.GridHelper(10, 10, 0x333333, 0x222222);
  scene.add(gridHelper);

  const axesHelper = new THREE.AxesHelper(3);
  scene.add(axesHelper);

  animate();
  window.addEventListener('resize', onWindowResize);
};

const onWindowResize = () => {
  if (!container.value) return;
  const width = container.value.clientWidth;
  const height = container.value.clientHeight;
  camera.aspect = width / height;
  camera.updateProjectionMatrix();
  renderer.setSize(width, height);
};

const animate = () => {
  animationId = requestAnimationFrame(animate);
  controls.update();
  renderer.render(scene, camera);
};

const disposeObject = (object) => {
  if (!object) return;
  object.traverse((child) => {
    if (child.geometry) child.geometry.dispose();
    if (child.material) {
      if (Array.isArray(child.material)) {
        child.material.forEach(m => m.dispose());
      } else {
        child.material.dispose();
      }
    }
  });
};

const loadModel = (file, offsetX = 0) => {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const ext = '.' + file.name.split('.').pop().toLowerCase();

    let loader;
    if (ext === '.obj') {
      loader = new OBJLoader();
    } else if (ext === '.gltf' || ext === '.glb') {
      loader = new GLTFLoader();
    } else {
      URL.revokeObjectURL(url);
      reject(new Error('不支持的文件格式'));
      return;
    }

    loader.load(
      url,
      (loaded) => {
        let object;
        if (loaded.scene) {
          object = loaded.scene;
        } else {
          object = loaded;
        }

        const box = new THREE.Box3().setFromObject(object);
        const center = box.getCenter(new THREE.Vector3());
        const size = box.getSize(new THREE.Vector3());
        
        const maxDim = Math.max(size.x, size.y, size.z);
        const scale = 3 / maxDim;

        object.position.set(-center.x * scale + offsetX, -center.y * scale, -center.z * scale);
        object.scale.setScalar(scale);

        URL.revokeObjectURL(url);
        resolve(object);
      },
      undefined,
      (error) => {
        URL.revokeObjectURL(url);
        reject(error);
      }
    );
  });
};

const applyHeatmapColors = (object, heatmapColors) => {
  if (!object || !heatmapColors || heatmapColors.length === 0) {
    if (object) {
      object.traverse((child) => {
        if (child.isMesh) {
          child.material = new THREE.MeshStandardMaterial({
            color: 0x555555,
            side: THREE.DoubleSide,
            roughness: 0.8,
            metalness: 0.1
          });
        }
      });
    }
    return;
  }

  object.traverse((child) => {
    if (child.isMesh) {
      const geometry = child.geometry;
      const positions = geometry.attributes.position;
      const count = positions.count;
      
      let colorAttribute = geometry.attributes.color;
      if (!colorAttribute || colorAttribute.count !== count) {
        colorAttribute = new THREE.BufferAttribute(
          new Float32Array(count * 3),
          3
        );
        geometry.setAttribute('color', colorAttribute);
      }

      const colorMap = new Map();
      heatmapColors.forEach(item => {
        colorMap.set(item.index, item.color);
      });

      for (let i = 0; i < count; i++) {
        const color = colorMap.get(i) || [128, 128, 128];
        colorAttribute.setXYZ(i, color[0] / 255, color[1] / 255, color[2] / 255);
      }

      colorAttribute.needsUpdate = true;
      
      if (!child.material || !child.material.vertexColors) {
        child.material = new THREE.MeshStandardMaterial({
          vertexColors: true,
          side: THREE.DoubleSide,
          roughness: 0.8,
          metalness: 0.1
        });
      }

      child.material.needsUpdate = true;
      geometry.colorsNeedUpdate = true;
    }
  });
};

const loadAndDisplayModels = async () => {
  if (!props.file1 || !props.file2) return;

  const file1Changed = !loadedFile1 || loadedFile1.name !== props.file1.name || loadedFile1.lastModified !== props.file1.lastModified;
  const file2Changed = !loadedFile2 || loadedFile2.name !== props.file2.name || loadedFile2.lastModified !== props.file2.lastModified;

  if (file1Changed) {
    if (model1) {
      scene.remove(model1);
      disposeObject(model1);
    }
    try {
      model1 = await loadModel(props.file1, -2);
      scene.add(model1);
      loadedFile1 = props.file1;
    } catch (error) {
      console.error('加载模型1失败:', error);
    }
  }

  if (file2Changed) {
    if (model2) {
      scene.remove(model2);
      disposeObject(model2);
    }
    try {
      model2 = await loadModel(props.file2, 2);
      scene.add(model2);
      loadedFile2 = props.file2;
    } catch (error) {
      console.error('加载模型2失败:', error);
    }
  }

  if (props.heatmapData && props.heatmapData.colors) {
    applyHeatmapColors(model1, props.heatmapData.colors);
  } else {
    applyHeatmapColors(model1, []);
  }

  if (model1 && model2) {
    const box1 = new THREE.Box3().setFromObject(model1);
    const box2 = new THREE.Box3().setFromObject(model2);
    const combinedBox = box1.clone().union(box2);
    const center = combinedBox.getCenter(new THREE.Vector3());
    const size = combinedBox.getSize(new THREE.Vector3());
    
    const maxDim = Math.max(size.x, size.y, size.z);
    camera.position.set(center.x + maxDim * 1.2, center.y + maxDim * 0.8, center.z + maxDim * 1.2);
    camera.lookAt(center);
    controls.target.copy(center);
    controls.update();
  }
};

const updateHeatmap = () => {
  if (!model1) return;
  
  if (props.heatmapData && props.heatmapData.colors) {
    applyHeatmapColors(model1, props.heatmapData.colors);
  } else {
    applyHeatmapColors(model1, []);
  }
};

onMounted(() => {
  init();
  nextTick(() => {
    loadAndDisplayModels();
  });
});

onUnmounted(() => {
  window.removeEventListener('resize', onWindowResize);
  if (animationId) {
    cancelAnimationFrame(animationId);
  }
  if (renderer) {
    renderer.dispose();
  }
  disposeObject(model1);
  disposeObject(model2);
});

watch(
  () => [props.file1, props.file2],
  () => {
    if (props.file1 && props.file2) {
      loadAndDisplayModels();
    }
  },
  { deep: true }
);

watch(
  () => props.heatmapData,
  () => {
    updateHeatmap();
  },
  { deep: true }
);
</script>

<style scoped>
.viewer {
  width: 100%;
  height: 100%;
}
</style>
