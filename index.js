const axios = require("axios");
const fs = require("fs-extra");
const path = require("path");
const { createCanvas, loadImage } = require("canvas");
const GIFEncoder = require("gifencoder");
const ffmpeg = require("fluent-ffmpeg");

// ======== CONFIG ========

// Years (or dates) you want to visualize
const years = [2023, 2024, 2025];

// Exact location
const lat = 4.5;   // latitude
const lon = 12.5;  // longitude

// Bounding box around the point
const delta = 0.5; // degrees (~50 km around the point)
const minLat = lat - delta;
const maxLat = lat + delta;
const minLon = lon - delta;
const maxLon = lon + delta;

// WMS base URL
const baseUrle = "https://gibs.earthdata.nasa.gov/wms/epsg4326/best/wms.cgi";

// Output directories
const framesDir = path.join(__dirname, "frames");
const outputDir = path.join(__dirname, "output");
fs.ensureDirSync(framesDir);
fs.ensureDirSync(outputDir);

// ======== FUNCTIONS ========

async function downloadImage(url, filename) {
  try {
    const response = await axios.get(url, { responseType: "arraybuffer" });
    const contentType = response.headers["content-type"];
    if (!contentType.startsWith("image")) {
      console.error("Server did not return an image:", contentType);
      fs.writeFileSync("error_response.html", response.data); // save response for debugging
      return false;
    }
    await fs.writeFile(filename, response.data);
    console.log(`Downloaded: ${filename}`);
    return true;
  } catch (err) {
    console.error("Download failed:", err.message);
    return false;
  }
}

async function createGIF(images, outputFile) {
  const encoder = new GIFEncoder(512, 512);
  const canvas = createCanvas(512, 512);
  const ctx = canvas.getContext("2d");

  const writeStream = fs.createWriteStream(outputFile);
  encoder.createReadStream().pipe(writeStream);

  encoder.start();
  encoder.setRepeat(0); // loop
  encoder.setDelay(800);
  encoder.setQuality(10);

  for (let imgPath of images) {
    const img = await loadImage(imgPath);
    ctx.clearRect(0, 0, 512, 512);
    ctx.drawImage(img, 0, 0, 512, 512);
    encoder.addFrame(ctx);
  }

  encoder.finish();
  console.log(`GIF created: ${outputFile}`);
}

// ======== MAIN ========

async function main() {
  const images = [];

  for (let year of years) {
    const bbox = `${minLat},${minLon},${maxLat},${maxLon}`; // lat,lon order for EPSG:4326
    const url = `${baseUrle}?service=WMS&version=1.3.0&request=GetMap&layers=MODIS_Terra_CorrectedReflectance_TrueColor&styles=&format=image/png&transparent=false&height=512&width=512&bbox=${bbox}&CRS=EPSG:4326&time=${year}-01-01`;
    const filename = path.join(framesDir, `modis_${year}.png`);

    const success = await downloadImage(url, filename);
    if (success) images.push(filename);
  }

  if (images.length === 0) {
    console.error("No valid images downloaded. Exiting.");
    return;
  }

  const gifFile = path.join(outputDir, "forest_loss.gif");
  await createGIF(images, gifFile);

  const mp4File = path.join(outputDir, "forest_loss.mp4");
  ffmpeg(gifFile)
    .output(mp4File)
    .on("end", () => console.log(`MP4 created: ${mp4File}`))
    .on("error", (err) => console.error("FFmpeg error:", err.message))
    .run();
}

main();
