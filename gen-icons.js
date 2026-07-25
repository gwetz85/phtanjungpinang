const sharp = require('sharp');
const src = './public/logo.png';

sharp(src)
  .resize(192, 192, { fit: 'contain', background: { r: 15, g: 35, b: 52, alpha: 1 } })
  .png()
  .toFile('./public/icon-192.png', (err) => {
    if (err) console.error('192 error:', err);
    else console.log('icon-192.png generated');
  });

sharp(src)
  .resize(512, 512, { fit: 'contain', background: { r: 15, g: 35, b: 52, alpha: 1 } })
  .png()
  .toFile('./public/icon-512.png', (err) => {
    if (err) console.error('512 error:', err);
    else console.log('icon-512.png generated');
  });
