const sharp = require('sharp');
const fs = require('fs');
const path = require('path');

const sourceDir = path.join(__dirname, '../public/opdb_backglass_images');
const thumbDir = path.join(sourceDir, 'thumbnails');

// Create thumbnails directory if it doesn't exist
if (!fs.existsSync(thumbDir)) {
  fs.mkdirSync(thumbDir, { recursive: true });
}

// Get all jpg files
const files = fs.readdirSync(sourceDir).filter(file =>
  file.toLowerCase().endsWith('.jpg') && !file.startsWith('.')
);

console.log(`Found ${files.length} images to process`);

let processed = 0;
let errors = 0;

// Process each image
async function generateThumbnails() {
  for (const file of files) {
    try {
      const sourcePath = path.join(sourceDir, file);
      const thumbPath = path.join(thumbDir, file);

      // Check if thumbnail exists and is up to date
      if (fs.existsSync(thumbPath)) {
        const sourceStats = fs.statSync(sourcePath);
        const thumbStats = fs.statSync(thumbPath);

        // Skip if thumbnail is newer than source (already up to date)
        if (thumbStats.mtimeMs >= sourceStats.mtimeMs) {
          processed++;
          continue;
        }
        console.log(`Regenerating outdated thumbnail: ${file}`);
      }

      // Generate thumbnail at 200px width (maintains aspect ratio)
      await sharp(sourcePath)
        .resize(200, null, {
          withoutEnlargement: true,
          fit: 'inside'
        })
        .jpeg({
          quality: 80,
          progressive: true
        })
        .toFile(thumbPath);

      processed++;
      if (processed % 50 === 0) {
        console.log(`Processed ${processed}/${files.length} images...`);
      }
    } catch (err) {
      console.error(`Error processing ${file}:`, err.message);
      errors++;
    }
  }

  console.log(`\nComplete! Processed ${processed} images with ${errors} errors.`);

  // Show size comparison
  const originalSize = execSync(`du -sh "${sourceDir}" | cut -f1`).toString().trim();
  const thumbSize = execSync(`du -sh "${thumbDir}" | cut -f1`).toString().trim();
  console.log(`Original images: ${originalSize}`);
  console.log(`Thumbnails: ${thumbSize}`);
}

const { execSync } = require('child_process');

generateThumbnails().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
