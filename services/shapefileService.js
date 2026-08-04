/**
 * shapefileService.js
 *
 * Parses an uploaded GIS file into a normalized list of GeoJSON features in
 * WGS84 (EPSG:4326), ready to be staged as AssetFeatures.
 *
 * Supports two source formats:
 *   • Zipped shapefile — a .zip containing .shp/.dbf/.shx and (ideally) .prj.
 *     `shpjs` reads the parts and reprojects to WGS84 using the .prj.
 *   • GeoJSON — a Feature, FeatureCollection or bare geometry, assumed to
 *     already be in WGS84 (the GeoJSON spec mandates CRS84 / lng-lat).
 *
 * Output feature shape:
 *   { geometry: <GeoJSON geometry>, properties: <object> }
 * plus a computed bbox and the base geometry family for the whole set.
 */
const shp = require("shpjs");

// GeoJSON geometry type → the AssetLayer.geometry_type family it belongs to.
const GEOM_FAMILY = {
    Point: "POINT",
    MultiPoint: "POINT",
    LineString: "LINESTRING",
    MultiLineString: "LINESTRING",
    Polygon: "POLYGON",
    MultiPolygon: "POLYGON",
};

/** Detect format from filename + mimetype. Returns "SHAPEFILE_ZIP" | "GEOJSON". */
function detectFormat(fileName = "", mimeType = "") {
    const lower = fileName.toLowerCase();
    if (lower.endsWith(".zip") || mimeType.includes("zip")) return "SHAPEFILE_ZIP";
    if (lower.endsWith(".geojson") || lower.endsWith(".json")) return "GEOJSON";
    if (mimeType.includes("json")) return "GEOJSON";
    // Fall back to shapefile-zip; shp() will throw a clear error if it isn't one.
    return "SHAPEFILE_ZIP";
}

/** Normalize any GeoJSON container into a flat array of Feature objects. */
function toFeatureArray(geojson) {
    if (!geojson) return [];
    // shpjs may return an array of FeatureCollections (multi-layer zip).
    if (Array.isArray(geojson)) return geojson.flatMap(toFeatureArray);
    if (geojson.type === "FeatureCollection") return geojson.features || [];
    if (geojson.type === "Feature") return [geojson];
    // Bare geometry.
    if (geojson.type && geojson.coordinates) {
        return [{ type: "Feature", geometry: geojson, properties: {} }];
    }
    return [];
}

/** Expand the bbox accumulator with every coordinate in a geometry. */
function extendBbox(bbox, geometry) {
    if (!geometry || !geometry.coordinates) return;
    const walk = (coords) => {
        if (typeof coords[0] === "number") {
            const [lng, lat] = coords;
            if (lng < bbox[0]) bbox[0] = lng;
            if (lat < bbox[1]) bbox[1] = lat;
            if (lng > bbox[2]) bbox[2] = lng;
            if (lat > bbox[3]) bbox[3] = lat;
            return;
        }
        coords.forEach(walk);
    };
    walk(geometry.coordinates);
}

/**
 * Parse an uploaded buffer.
 * @param {Buffer} buffer
 * @param {{ fileName?: string, mimeType?: string }} meta
 * @returns {Promise<{
 *   format: string,
 *   features: Array<{geometry:object, properties:object}>,
 *   geometryFamilies: string[],
 *   bbox: [number,number,number,number]|null
 * }>}
 */
async function parseUpload(buffer, { fileName = "", mimeType = "" } = {}) {
    const format = detectFormat(fileName, mimeType);

    let geojson;
    if (format === "GEOJSON") {
        try {
            geojson = JSON.parse(buffer.toString("utf8"));
        } catch (e) {
            throw new Error("Invalid GeoJSON: could not parse the uploaded file.");
        }
    } else {
        try {
            // shpjs accepts a Buffer of the .zip and reprojects to WGS84.
            geojson = await shp(buffer);
        } catch (e) {
            throw new Error(
                "Could not read shapefile zip. Ensure the .zip contains .shp, .dbf and .prj parts. (" +
                    e.message +
                    ")"
            );
        }
    }

    const rawFeatures = toFeatureArray(geojson);
    const bbox = [Infinity, Infinity, -Infinity, -Infinity];
    const families = new Set();
    const features = [];

    for (const f of rawFeatures) {
        const geometry = f.geometry;
        if (!geometry || !geometry.type || !geometry.coordinates) continue;
        const family = GEOM_FAMILY[geometry.type];
        if (!family) continue; // GeometryCollection / unknown — skip
        families.add(family);
        extendBbox(bbox, geometry);
        features.push({ geometry, properties: f.properties || {} });
    }

    const hasBbox = bbox[0] !== Infinity;

    return {
        format,
        features,
        geometryFamilies: [...families],
        bbox: hasBbox ? bbox : null,
    };
}

module.exports = { parseUpload, detectFormat, GEOM_FAMILY };
