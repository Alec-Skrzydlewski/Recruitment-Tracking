import { PHOTO_MAX_BYTES, compressionPlan, fitDimensions } from './imageSizing.js';

function loadImage(file) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      resolve(img);
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error('Could not read that image'));
    };
    img.src = url;
  });
}

function canvasToJpeg(canvas, quality) {
  return new Promise((resolve, reject) => {
    canvas.toBlob(blob => {
      if (!blob) reject(new Error('Could not compress that image'));
      else resolve(blob);
    }, 'image/jpeg', quality);
  });
}

function blobToBase64(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = String(reader.result || '');
      const comma = result.indexOf(',');
      resolve(comma >= 0 ? result.slice(comma + 1) : result);
    };
    reader.onerror = () => reject(new Error('Could not read that image'));
    reader.readAsDataURL(blob);
  });
}

export async function preparePhoto(file) {
  if (!file) throw new Error('Choose an image file');
  if (file.type && String(file.type).indexOf('image/') !== 0) {
    throw new Error('Choose an image file');
  }
  const img = await loadImage(file);
  const sourceW = img.naturalWidth || img.width;
  const sourceH = img.naturalHeight || img.height;
  if (!sourceW || !sourceH) throw new Error('Could not read that image');

  const plan = compressionPlan();
  let canvas = null;
  let lastW = 0;
  let lastH = 0;
  let best = null;
  for (let i = 0; i < plan.length; i++) {
    const step = plan[i];
    const fitted = fitDimensions(sourceW, sourceH, step.maxEdge);
    if (!canvas || fitted.width !== lastW || fitted.height !== lastH) {
      canvas = document.createElement('canvas');
      canvas.width = fitted.width;
      canvas.height = fitted.height;
      const ctx = canvas.getContext('2d');
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, fitted.width, fitted.height);
      ctx.drawImage(img, 0, 0, fitted.width, fitted.height);
      lastW = fitted.width;
      lastH = fitted.height;
    }
    const blob = await canvasToJpeg(canvas, step.quality);
    if (!best || blob.size < best.size) best = blob;
    if (blob.size <= PHOTO_MAX_BYTES) {
      best = blob;
      break;
    }
  }
  if (!best || best.size > PHOTO_MAX_BYTES) {
    throw new Error('Image is still over 300KB after compression');
  }
  const dataBase64 = await blobToBase64(best);
  return { dataBase64: dataBase64, mimeType: 'image/jpeg' };
}
