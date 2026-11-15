// Renders the app icon and launch image from the SVG sources in this folder.
//
//   cd ios-app/resources
//   npm install --no-save @resvg/resvg-js@2.6.2 pngjs@7.0.0
//   node render.mjs
//
// Free tools only (resvg, pngjs; both MIT/open source). The output PNGs are
// 8-bit RGB with NO alpha channel (PNG colour type 2): App Store Connect
// rejects a marketing icon with transparency, and White Glove Treatment's
// handoff (amberai src/lib/api-v1/ios-build/handoff.ts isOpaque1024Png) only
// accepts exactly that format.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Resvg } from "@resvg/resvg-js";
import { PNG } from "pngjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const assets = path.join(here, "..", "ios", "App", "App", "Assets.xcassets");

function renderOpaque(svgFile, size, background) {
  const svg = fs.readFileSync(path.join(here, svgFile), "utf8");
  const rgba = new Resvg(svg, { fitTo: { mode: "width", value: size }, background }).render();
  const src = PNG.sync.read(rgba.asPng());
  const out = new PNG({ width: src.width, height: src.height, colorType: 2, inputColorType: 6, inputHasAlpha: true });
  // Flatten onto the background colour, then force alpha to 255.
  const [br, bg, bb] = background.match(/\w\w/g).map((h) => parseInt(h, 16));
  for (let i = 0; i < src.data.length; i += 4) {
    const a = src.data[i + 3] / 255;
    out.data[i] = Math.round(src.data[i] * a + br * (1 - a));
    out.data[i + 1] = Math.round(src.data[i + 1] * a + bg * (1 - a));
    out.data[i + 2] = Math.round(src.data[i + 2] * a + bb * (1 - a));
    out.data[i + 3] = 255;
  }
  return PNG.sync.write(out, { colorType: 2, inputColorType: 6, inputHasAlpha: true });
}

const icon = renderOpaque("icon.svg", 1024, "#07071a");
fs.writeFileSync(path.join(here, "AppIcon-1024.png"), icon);
fs.writeFileSync(path.join(assets, "AppIcon.appiconset", "AppIcon-512@2x.png"), icon);

const splash = renderOpaque("splash.svg", 2732, "#0b1020");
for (const name of ["splash-2732x2732.png", "splash-2732x2732-1.png", "splash-2732x2732-2.png"]) {
  fs.writeFileSync(path.join(assets, "Splash.imageset", name), splash);
}
console.log("icon", icon.length, "bytes; splash", splash.length, "bytes");
