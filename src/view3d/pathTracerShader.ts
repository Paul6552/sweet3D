import { type Material, MeshPhysicalMaterial, type Object3D, type ShaderMaterial } from 'three'

/*
 * Verkleinert den Shader von three-gpu-pathtracer. Der Treiber fügt alle Funktionsaufrufe einzeln
 * ein; der vollständige Shader braucht unter Mesa auf Intel UHD über 20 s zum Kompilieren, so lange,
 * dass Chrome den Grafikprozess für hängend hält und zurücksetzt (Context Lost). Entfernt wird nur,
 * was die Szene nicht nutzt, das Bild bleibt also gleich.
 */

/**
 * Direktes Licht wie im Original, aber mit nur einem Schattenstrahl und einer BSDF-Auswertung:
 * Das Original wertet beides getrennt für Lampen und Umgebung aus. Gleiche Zufallszahlen, gleiches Ergebnis.
 */
const DIRECT_LIGHT = /* glsl */ `vec3 directLightContribution( vec3 worldWo, SurfaceRecord surf, RenderState state, vec3 rayOrigin ) {

		vec3 result = vec3( 0.0 );

		// uniformly pick a light or environment map
		bool hasSample = false;
		bool isDeltaLight = false;
		vec3 direction = vec3( 0.0 );
		vec3 emission = vec3( 0.0 );
		float dist = INFINITY;
		float pdf = 0.0;
		if( lightsDenom != 0.0 && rand( 5 ) < float( lights.count ) / lightsDenom ) {

			LightRecord lightRec = randomLightSample( lights.tex, iesProfiles, lights.count, rayOrigin, rand3( 6 ) );
			hasSample = true;
			isDeltaLight = lightRec.type == SPOT_LIGHT_TYPE || lightRec.type == DIR_LIGHT_TYPE || lightRec.type == POINT_LIGHT_TYPE;
			direction = lightRec.direction;
			emission = lightRec.emission;
			dist = lightRec.dist;
			pdf = lightRec.pdf;

		} else if ( envMapInfo.totalSum != 0.0 && environmentIntensity != 0.0 ) {

			vec3 envColor, envDirection;
			pdf = sampleEquirectProbability( rand2( 7 ), envColor, envDirection );
			hasSample = true;
			direction = invEnvRotation3x3 * envDirection;
			emission = environmentIntensity * envColor;

		}

		bool isSampleBelowSurface = ! surf.volumeParticle && dot( surf.faceNormal, direction ) < 0.0;
		if ( isSampleBelowSurface ) {

			pdf = 0.0;

		}

		// check if a ray could even reach the light or environment
		Ray sampleRay;
		sampleRay.origin = rayOrigin;
		sampleRay.direction = direction;
		vec3 attenuatedColor;
		if (
			hasSample &&
			pdf > 0.0 &&
			isDirectionValid( direction, surf.normal, surf.faceNormal ) &&
			! attenuateHit( state, sampleRay, dist, attenuatedColor )
		) {

			// get the material pdf
			vec3 sampleColor;
			float materialPdf = bsdfResult( worldWo, direction, surf, sampleColor );
			bool isValidSampleColor = all( greaterThanEqual( sampleColor, vec3( 0.0 ) ) );
			if ( materialPdf > 0.0 && isValidSampleColor ) {

				// weight the direct light contribution
				float samplePdf = pdf / lightsDenom;
				float misWeight = isDeltaLight ? 1.0 : misHeuristic( samplePdf, materialPdf );
				result = attenuatedColor * emission * state.throughputColor * sampleColor * misWeight / samplePdf;

			}

		}

		return result;

	}`

/** Anfang und Ende (hinter der schließenden Klammer) der Funktion, deren Kopf mit `header` beginnt. */
function functionRange(source: string, header: string): [number, number] | null {
  const start = source.indexOf(header)
  if (start < 0) return null
  let depth = 0
  for (let i = source.indexOf('{', start); i < source.length; i++) {
    if (source[i] === '{') depth++
    else if (source[i] === '}' && --depth === 0) return [start, i + 1]
  }
  return null
}

/** Ersetzt eine ganze Funktion; ändert nichts, wenn sie (nach einem Update der Bibliothek) fehlt. */
function replaceFunction(source: string, header: string, replace: (code: string) => string): string {
  const range = functionRange(source, header)
  const code = range && source.slice(...range)
  const result = code === null ? code : replace(code)
  if (!range || result === null || result === code) {
    console.warn(`Pathtracer-Shader: ${header} nicht wie erwartet gefunden, bleibt unverändert`)
    return source
  }
  return source.slice(0, range[0]) + result + source.slice(range[1])
}

/** Ersetzt den Rumpf einer Funktion. */
function stubFunction(source: string, header: string, body: string): string {
  return replaceFunction(source, header, (code) => `${code.slice(0, code.indexOf('{') + 1)} ${body} }`)
}

/** Welche aufwendigen Materialeigenschaften die Szene nutzt. */
function usedFeatures(scene: Object3D) {
  const used = { clearcoat: false, sheen: false, iridescence: false, transmissionMaps: false }
  scene.traverse((object) => {
    const material = (object as Object3D & { material?: Material | Material[] }).material
    for (const m of [material ?? []].flat()) {
      if (!(m instanceof MeshPhysicalMaterial)) continue
      used.clearcoat ||= m.clearcoat > 0
      used.sheen ||= m.sheen > 0
      used.iridescence ||= m.iridescence > 0
      // Diese Maps wirken im Schattenstrahl nur bei lichtdurchlässigen Materialien
      used.transmissionMaps ||= m.transmission > 0 && !!(m.transmissionMap || m.metalnessMap)
    }
  })
  return used
}

/**
 * Passt den Pathtracing-Shader an die Szene an. Spot- und Flächenlichter kommen im Foto nie vor
 * (siehe photoScene), die übrigen Teile fallen nur weg, wenn kein Material sie braucht. Muss vor
 * dem ersten Kompilieren aufgerufen werden.
 */
export function slimPathTracerShader(material: ShaderMaterial, scene: Object3D) {
  const used = usedFeatures(scene)
  let source = replaceFunction(material.fragmentShader, 'vec3 directLightContribution(', () => DIRECT_LIGHT)
  const noLight = 'LightRecord record; record.pdf = 0.0; record.type = -1; return record;'
  source = stubFunction(source, 'LightRecord randomSpotLightSample(', noLight)
  source = stubFunction(source, 'LightRecord randomAreaLightSample(', noLight)
  if (!used.iridescence) source = stubFunction(source, 'vec3 evalIridescence(', 'return baseF0;')
  if (!used.sheen) {
    source = stubFunction(source, 'vec3 sheenColor(', 'return vec3( 0.0 );')
    source = stubFunction(source, 'float sheenAlbedoScaling( vec3 wo, vec3 wi,', 'return 1.0;')
  }
  if (!used.clearcoat) source = stubFunction(source, 'float clearcoatEval(', 'return 0.0;')
  if (!used.transmissionMaps) {
    source = replaceFunction(source, 'bool attenuateHit(', (code) =>
      code.replace(
        /\/\/ transmission[\s\S]*?(?=float alphaTest)/,
        'float transmission = material.transmission;\n\t\t\t\tfloat metalness = material.metalness;\n\n\t\t\t\t',
      ),
    )
  }
  // Ohne needsUpdate: Das würde beim Pathtracer sofort eine Kompilierung starten
  material.fragmentShader = source
}

/**
 * Stößt genau eine Kompilierung mit den endgültigen Defines an. Sonst setzt der Pathtracer beim
 * ersten Bild mehrere Defines nacheinander, und jede Änderung startet eine eigene Kompilierung des
 * ganzen Shaders. Aufrufen, wenn Szene und Kamera gesetzt sind.
 */
export function compileOnce(material: ShaderMaterial & { onBeforeRender: () => void }) {
  const dispatch = material.dispatchEvent
  material.dispatchEvent = () => {}
  try {
    material.onBeforeRender()
  } finally {
    material.dispatchEvent = dispatch
  }
  // needsUpdate löst beim Pathtracer-Material das Kompilieren aus
  material.needsUpdate = true
}
