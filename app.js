// server.js
import express from "express";
import cors from "cors";
import axios from "axios";
import fs from "fs-extra";
import path from "path";
import { createCanvas, loadImage } from "canvas";
import GIFEncoder from "gifencoder";
import ffmpeg from "fluent-ffmpeg";

const app = express();
app.use(cors());
app.use(express.json());

// Temporary directories
const framesDir = path.join(process.cwd(), "frames");
const outputDir = path.join(process.cwd(), "output");
fs.ensureDirSync(framesDir);
fs.ensureDirSync(outputDir);

const baseUrle = "https://gibs.earthdata.nasa.gov/wms/epsg4326/best/wms.cgi";

// ======== Utility Functions ========

async function downloadImage(url, filename) {
  try {
    const response = await axios.get(url, { responseType: "arraybuffer" });
    const contentType = response.headers["content-type"];
    if (!contentType.startsWith("image")) {
      console.error("Server did not return an image:", contentType);
      fs.writeFileSync("error_response.html", response.data);
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
  encoder.setRepeat(0);
  encoder.setDelay(800);
  encoder.setQuality(10);

  for (let imgPath of images) {
    const img = await loadImage(imgPath);
    ctx.clearRect(0, 0, 512, 512);
    ctx.drawImage(img, 0, 0, 512, 512);
    encoder.addFrame(ctx);
  }

  encoder.finish();
}

// ======== API Route ========

app.post("/generate-video", async (req, res) => {
  try {
    const { lat, lon, years } = req.body;

    if (!lat || !lon) {
      return res.status(400).json({ error: "Latitude and longitude are required" });
    }

    const delta = 0.5; // adjust area around the point
    const minLat = lat - delta;
    const maxLat = lat + delta;
    const minLon = lon - delta;
    const maxLon = lon + delta;

    const images = [];

    for (let year of years || [2025]) {
      const bbox = `${minLat},${minLon},${maxLat},${maxLon}`;
      const url = `${baseUrle}?service=WMS&version=1.3.0&request=GetMap&layers=MODIS_Terra_CorrectedReflectance_TrueColor&styles=&format=image/png&transparent=false&height=512&width=512&bbox=${bbox}&CRS=EPSG:4326&time=${year}-01-01`;
      const filename = path.join(framesDir, `modis_${year}.png`);

      const success = await downloadImage(url, filename);
      if (success) images.push(filename);
    }

    if (images.length === 0) {
      return res.status(500).json({ error: "No valid images downloaded" });
    }

    const gifFile = path.join(outputDir, `forest_loss.gif`);
    await createGIF(images, gifFile);

    const mp4File = path.join(outputDir, `forest_loss.mp4`);
    await new Promise((resolve, reject) => {
      ffmpeg(gifFile)
        .output(mp4File)
        .on("end", resolve)
        .on("error", reject)
        .run();
    });

    // Send MP4 file to frontend
    res.download(mp4File, "forest_loss.mp4");

    // Optional: clean up frames and GIF after sending
    // fs.emptyDirSync(framesDir);
    // fs.removeSync(gifFile);

  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

// ======== Start Server ========
const PORT = process.env.PORT || 8000;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
