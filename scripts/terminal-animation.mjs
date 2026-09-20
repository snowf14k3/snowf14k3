import { readFile } from "node:fs/promises";

const animation = JSON.parse(
  await readFile(new URL("../assets/animation/character-frames.json", import.meta.url), "utf8"),
);
const playbackSlowdown = 2;

// Keep the original color families readable against each transparent theme.
const lightPalette = ["#21366c", "#405779", "#557b88", "#43818a", "#8c765c", "#706962", "#7f817b", "#8b1430"];
const darkPalette = ["#7a98dc", "#8ba8c7", "#a6ced9", "#d2f1f2", "#dac9ad", "#b2aca3", "#eee8dd", "#ed6c82"];

const escapeText = (text) => text.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");

export function terminalAnimationStyles() {
  let elapsed = 0;
  const keyframes = animation.frames.map(({ duration_ms }, index) => {
    const start = (elapsed / animation.duration_ms) * 100;
    elapsed += duration_ms;
    const end = (elapsed / animation.duration_ms) * 100;
    const before = index === 0 ? "" : "0% { visibility: hidden; } ";
    const after = end === 100 ? "100%" : `${end.toFixed(8)}%, 100%`;
    return `@keyframes ascii-${index} { ${before}${start.toFixed(8)}% { visibility: visible; } ${after} { visibility: hidden; } }`;
  }).join("\n    ");

  const variables = (palette) => palette.map((color, index) => `--ascii-${index}: ${color};`).join(" ");
  return `:root { ${variables(lightPalette)} }
    @media (prefers-color-scheme: dark) { :root { ${variables(darkPalette)} } }
    .ascii-glyphs { font-family: Consolas, "Liberation Mono", Menlo, monospace; font-size: 10px; font-weight: 700; font-variant-ligatures: none; }
    .ascii-frame { animation-duration: ${animation.duration_ms * playbackSlowdown}ms; animation-timing-function: step-end; animation-iteration-count: infinite; }
    ${keyframes}
    @media (prefers-reduced-motion: reduce) {
      .ascii-frame { animation: none; visibility: hidden; }
      .ascii-first { visibility: visible; }
    }`;
}

export function renderTerminalAnimation() {
  const frames = animation.frames.map(({ rows }, index) => {
    const glyphs = animation.palette.map((_, colorIndex) => {
      const x = [];
      const y = [];
      const characters = [];
      rows.forEach((row, rowIndex) => {
        [...row.text].forEach((character, columnIndex) => {
          if (character === " " || row.colors[columnIndex] !== String(colorIndex)) return;
          x.push(columnIndex * 6);
          y.push(rowIndex * 12 + 10);
          characters.push(character);
        });
      });
      if (characters.length === 0) return "";
      return `<text fill="var(--ascii-${colorIndex})" x="${x.join(" ")}" y="${y.join(" ")}">${escapeText(characters.join(""))}</text>`;
    }).join("");
    return `<g class="ascii-frame${index === 0 ? " ascii-first" : ""}" visibility="${index === 0 ? "visible" : "hidden"}" style="animation-name: ascii-${index}">${glyphs}</g>`;
  }).join("\n    ");

  return `<g id="terminal-animation" role="img" aria-label="Cirno from cirno.gif spinning in colored ASCII, with the original 35 frames at half speed.">
    <g class="ascii-glyphs" transform="translate(18 452) scale(0.4)" aria-hidden="true">
    ${frames}
    </g>
  </g>`;
}
