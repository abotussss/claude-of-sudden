/**
 * DOES THE FIRE STILL READ AS FIRE? — the flame pixels, isolated by hue.
 *
 *   node _nfhue.mjs shots/scar/SCAR-final-020m.png [...]
 *
 * The crash's flames were tuned against a specific auto-exposure and the whole
 * failure mode they were tuned out of is a COLOUR one: `render` runs
 * `NoToneMapping` and the composite tonemaps AFTER multiplying by exposure, so
 * three channels over the AgX shoulder is white whatever their ratio was in
 * source. A brightness number cannot see that.
 *
 * So this counts FLAME pixels — bright, and warm in the ordering R > G > B —
 * and reports how many there are, how hot they are and how orange they still
 * are. "Brightest 1%" was tried first and measured the EMP dome and the HUD
 * caption instead, which is why the hue test is the selector rather than a
 * post-hoc statistic. WHITE-CORE counts the ones that have gone achromatic,
 * which is the actual defect being watched for.
 */
import { readFileSync } from 'node:fs';
import { PNG } from 'pngjs';
for (const f of process.argv.slice(2)) {
  const p = PNG.sync.read(readFileSync(f));
  let n = 0, r = 0, g = 0, b = 0, white = 0, bg = 0, bgn = 0;
  for (let j = 60; j < p.height * 0.68; j++) {
    for (let i = 0; i < p.width; i++) {
      const o = (j * p.width + i) * 4;
      const R = p.data[o], G = p.data[o + 1], B = p.data[o + 2];
      if (R > 110 && R > G * 1.15 && G >= B) {
        n++; r += R; g += G; b += B;
        if (R > 235 && G > 215 && B > 195) white++;
      } else { bg += (R + G + B) / 3; bgn++; }
    }
  }
  if (!n) { console.log(`${f.split('/').pop().padEnd(26)} no flame pixels`); continue; }
  console.log(`${f.split('/').pop().padEnd(26)} flame px ${String(n).padStart(6)} (${((n / (p.width * p.height * 0.62)) * 100).toFixed(1)}%)  ` +
    `mean ${(r / n).toFixed(0)}/${(g / n).toFixed(0)}/${(b / n).toFixed(0)}  R:G ${(r / g).toFixed(2)}  ` +
    `white-core ${((white / n) * 100).toFixed(1)}%   world behind ${(bg / bgn).toFixed(1)}`);
}
