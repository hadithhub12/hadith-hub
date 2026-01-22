// Generate PNG icons from SVG using sharp
// Run: npm install sharp && node scripts/generate-icons.js

const fs = require('fs');
const path = require('path');

async function generateIcons() {
  try {
    const sharp = require('sharp');
    const svgPath = path.join(__dirname, '../public/icons/icon.svg');
    const outputDir = path.join(__dirname, '../public/icons');

    const sizes = [72, 96, 128, 144, 152, 192, 384, 512];

    for (const size of sizes) {
      await sharp(svgPath)
        .resize(size, size)
        .png()
        .toFile(path.join(outputDir, `icon-${size}.png`));
      console.log(`Generated icon-${size}.png`);
    }

    console.log('All icons generated successfully!');
  } catch (err) {
    console.error('Error generating icons:', err.message);
    console.log('\nTo generate icons, run:');
    console.log('  npm install sharp');
    console.log('  node scripts/generate-icons.js');
    console.log('\nOr use an online tool to convert the SVG at public/icons/icon.svg');
  }
}

generateIcons();
