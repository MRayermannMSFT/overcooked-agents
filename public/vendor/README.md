# Vendored third-party assets

These files are checked in so the kitchen runs with **zero `npm install`**.

| Path | Source | License |
|------|--------|---------|
| `three/three.bundle.min.js` | [three.js](https://threejs.org) `0.186.1` (`three` + `examples/jsm/geometries/RoundedBoxGeometry.js`), bundled and minified with esbuild | MIT (`three/LICENSE`) |
| `../fonts/fredoka-latin-*.woff2` | [Fredoka](https://github.com/hafontia/Fredoka-One) via `@fontsource/fredoka` `5.3.0` | SIL OFL 1.1 (`../fonts/OFL-LICENSE.txt`) |

## Rebuilding the three.js bundle

```sh
mkdir three-bundle && cd three-bundle
npm init -y && npm install three@0.186.1 esbuild
printf "export * from 'three';\nexport { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';\n" > entry.js
npx esbuild entry.js --bundle --minify --format=esm --legal-comments=inline --outfile=three.bundle.min.js
```

Copy the output over `public/vendor/three/three.bundle.min.js`.
