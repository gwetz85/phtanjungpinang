const sharp = require('sharp');

const src = './public/logo.png';

async function generateIcon(size, outPath) {
  // Strategy: use 'cover' to zoom and fill the entire square
  // Then trim any excess white border first

  // Step 1: trim white borders from original logo
  const trimmed = await sharp(src)
    .trim({ background: '#ffffff', threshold: 20 })
    .toBuffer();

  // Step 2: resize to fill square fully (cover = crop edges to fill, no letterbox)
  const padding = Math.round(size * 0.06); // 6% padding all sides
  const innerSize = size - padding * 2;

  const logoResized = await sharp(trimmed)
    .resize(innerSize, innerSize, {
      fit: 'contain',
      background: { r: 15, g: 35, b: 52, alpha: 255 }
    })
    .png()
    .toBuffer();

  // Step 3: place on themed background
  await sharp({
    create: {
      width: size,
      height: size,
      channels: 4,
      background: { r: 15, g: 35, b: 52, alpha: 255 }
    }
  })
    .composite([{ input: logoResized, top: padding, left: padding }])
    .png()
    .toFile(outPath);

  console.log(`Generated ${outPath} (${size}x${size})`);
}

(async () => {
  await generateIcon(192, './public/icon-192.png');
  await generateIcon(512, './public/icon-512.png');
})();
