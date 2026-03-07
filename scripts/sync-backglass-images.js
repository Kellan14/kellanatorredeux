const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const sourceDir = path.join(__dirname, '../opdb_backglass_images');
const publicDir = path.join(__dirname, '../public/opdb_backglass_images');

// Ensure public directory exists
if (!fs.existsSync(publicDir)) {
  fs.mkdirSync(publicDir, { recursive: true });
}

// Get all jpg files from source
const sourceFiles = fs.readdirSync(sourceDir).filter(file =>
  file.toLowerCase().endsWith('.jpg') && !file.startsWith('.')
);

console.log(`Found ${sourceFiles.length} images in source directory`);

let copied = 0;
let skipped = 0;

// Copy new or updated images to public directory
for (const file of sourceFiles) {
  const sourcePath = path.join(sourceDir, file);
  const destPath = path.join(publicDir, file);

  // Check if file needs to be copied
  if (fs.existsSync(destPath)) {
    const sourceStats = fs.statSync(sourcePath);
    const destStats = fs.statSync(destPath);

    // Skip if destination is newer or same age
    if (destStats.mtimeMs >= sourceStats.mtimeMs) {
      skipped++;
      continue;
    }
    console.log(`Updating: ${file}`);
  } else {
    console.log(`Copying new: ${file}`);
  }

  fs.copyFileSync(sourcePath, destPath);
  copied++;
}

console.log(`\nSync complete: ${copied} copied, ${skipped} skipped (already up to date)`);

// Run thumbnail generation if any files were copied
if (copied > 0) {
  console.log('\nRegenerating thumbnails...');
  try {
    execSync('node scripts/generate-thumbnails.js', {
      cwd: path.join(__dirname, '..'),
      stdio: 'inherit'
    });
  } catch (err) {
    console.error('Error generating thumbnails:', err.message);
    process.exit(1);
  }
} else {
  console.log('\nNo new images to process, skipping thumbnail generation.');
}
