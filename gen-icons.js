const sharp = require('sharp');

const src = 'C:/Users/LENOVO/.gemini/antigravity/brain/df885153-6a7d-42fd-815f-2a1c16d09461/.user_uploaded/media__1785017400481.png';

async function generateIcon(size, outPath) {
  // Trim white background, then resize to fill with white background preserved (logo has white bg)
  await sharp(src)
    .trim({ background: '#ffffff', threshold: 15 })
    .resize(size, size, {
      fit: 'contain',
      background: { r: 255, g: 255, b: 255, alpha: 255 }
    })
    .png()
    .toFile(outPath);

  console.log(`Generated ${outPath} (${size}x${size})`);
}

(async () => {
  await generateIcon(192, './public/icon-192.png');
  await generateIcon(512, './public/icon-512.png');
  // Also replace logo.png with this better version
  await sharp(src)
    .resize(512, 512, { fit: 'contain', background: { r: 255, g: 255, b: 255, alpha: 255 } })
    .png()
    .toFile('./public/logo.png');
  console.log('logo.png updated');
})();
