// Copy app icons to Android and iOS platforms
const fs = require('fs');
const path = require('path');
const sharp = require('sharp');

const sourceIcon = path.join(__dirname, '../public/icons/icon.svg');

// Android icon sizes (mipmap folders)
const androidSizes = [
  { folder: 'mipmap-mdpi', size: 48 },
  { folder: 'mipmap-hdpi', size: 72 },
  { folder: 'mipmap-xhdpi', size: 96 },
  { folder: 'mipmap-xxhdpi', size: 144 },
  { folder: 'mipmap-xxxhdpi', size: 192 },
];

// iOS icon sizes
const iosSizes = [
  { name: 'AppIcon-20x20@1x.png', size: 20 },
  { name: 'AppIcon-20x20@2x.png', size: 40 },
  { name: 'AppIcon-20x20@2x-1.png', size: 40 },
  { name: 'AppIcon-20x20@3x.png', size: 60 },
  { name: 'AppIcon-29x29@1x.png', size: 29 },
  { name: 'AppIcon-29x29@2x.png', size: 58 },
  { name: 'AppIcon-29x29@2x-1.png', size: 58 },
  { name: 'AppIcon-29x29@3x.png', size: 87 },
  { name: 'AppIcon-40x40@1x.png', size: 40 },
  { name: 'AppIcon-40x40@2x.png', size: 80 },
  { name: 'AppIcon-40x40@2x-1.png', size: 80 },
  { name: 'AppIcon-40x40@3x.png', size: 120 },
  { name: 'AppIcon-60x60@2x.png', size: 120 },
  { name: 'AppIcon-60x60@3x.png', size: 180 },
  { name: 'AppIcon-76x76@1x.png', size: 76 },
  { name: 'AppIcon-76x76@2x.png', size: 152 },
  { name: 'AppIcon-83.5x83.5@2x.png', size: 167 },
  { name: 'AppIcon-512@2x.png', size: 1024 },
];

async function generateIcons() {
  console.log('Generating Android icons...');

  // Android icons
  const androidResDir = path.join(__dirname, '../android/app/src/main/res');
  for (const { folder, size } of androidSizes) {
    const outputDir = path.join(androidResDir, folder);
    if (fs.existsSync(outputDir)) {
      await sharp(sourceIcon)
        .resize(size, size)
        .png()
        .toFile(path.join(outputDir, 'ic_launcher.png'));

      // Also create round icon
      await sharp(sourceIcon)
        .resize(size, size)
        .png()
        .toFile(path.join(outputDir, 'ic_launcher_round.png'));

      // Create foreground for adaptive icons
      await sharp(sourceIcon)
        .resize(Math.round(size * 1.5), Math.round(size * 1.5))
        .png()
        .toFile(path.join(outputDir, 'ic_launcher_foreground.png'));

      console.log(`  Generated ${folder} icons (${size}px)`);
    }
  }

  console.log('Generating iOS icons...');

  // iOS icons
  const iosIconDir = path.join(__dirname, '../ios/App/App/Assets.xcassets/AppIcon.appiconset');
  if (fs.existsSync(iosIconDir)) {
    for (const { name, size } of iosSizes) {
      await sharp(sourceIcon)
        .resize(size, size)
        .png()
        .toFile(path.join(iosIconDir, name));
      console.log(`  Generated ${name} (${size}px)`);
    }
  } else {
    console.log('  iOS icon directory not found, skipping...');
  }

  console.log('Done!');
}

generateIcons().catch(console.error);
