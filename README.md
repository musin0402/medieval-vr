# Reinos Perdidos — mundo medieval procedural en WebXR (Three.js)

Prototipo jugable: terreno infinito generado mientras caminas (praderas, bosques, montañas nevadas, ríos, lagos y ruinas medievales), primera persona, espada en la mano y botón **ENTER VR** para Meta Quest 2.

## Publicar gratis en GitHub Pages
1. Crea un repositorio en GitHub y sube **todo el contenido de esta carpeta** (index.html, style.css, js/…).
2. Settings → Pages → *Deploy from a branch* → rama `main`, carpeta `/ (root)` → Save.
3. Abre `https://TU-USUARIO.github.io/TU-REPO/` en el navegador del Quest 2 y pulsa **ENTER VR**.

(WebXR exige HTTPS: GitHub Pages ya lo da. Three.js se carga desde el CDN jsDelivr, así que el Quest necesita internet.)

## Probar en local
`python3 -m http.server 8000` y abre `http://localhost:8000` (escritorio). Para el Quest, usa la URL de GitHub Pages.

## Controles
- **Quest:** stick izquierdo = mover (púlsalo = correr) · stick derecho = girar por pasos · la espada va en el mando derecho.
- **Escritorio:** WASD, Shift correr, ratón para mirar (clic para capturar), clic = espadazo.

## Ajustes rápidos (js/main.js y js/world.js)
`SEED` (otro mundo) · `WALK_SPEED` · `SWORD_TILT` (inclinación de la espada) · `TERRAIN_RADIUS` / `PROP_RADIUS` en world.js (distancia de dibujado; bájalos si notas tirones).

## Estructura
`js/noise.js` ruido · `js/heightfield.js` altura/ríos/montañas/bosques · `js/world.js` chunks, árboles, rocas, ruinas, colisiones · `js/sword.js` espada · `js/main.js` VR, controles y bucle.
