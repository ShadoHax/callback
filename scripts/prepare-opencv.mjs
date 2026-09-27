import { mkdir, copyFile } from 'node:fs/promises';
await mkdir(new URL('../public/vendor/', import.meta.url), { recursive: true });
await copyFile(new URL('../node_modules/@techstark/opencv-js/dist/opencv.js', import.meta.url), new URL('../public/vendor/opencv.js', import.meta.url));
