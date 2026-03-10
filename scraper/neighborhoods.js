// Lat/lng centroids for Asuncion neighborhoods
// Used as fallback when a listing doesn't provide GPS coordinates
const NEIGHBORHOOD_COORDS = {
  // Asuncion districts
  "Villa Morra":         { lat: -25.2897, lng: -57.5736 },
  "Carmelitas":          { lat: -25.2864, lng: -57.5821 },
  "Centro":              { lat: -25.2867, lng: -57.6466 },
  "Centro Histórico":    { lat: -25.2854, lng: -57.6402 },
  "Sajonia":             { lat: -25.2780, lng: -57.6100 },
  "Las Mercedes":        { lat: -25.2950, lng: -57.5650 },
  "Recoleta":            { lat: -25.3012, lng: -57.5580 },
  "Ycuá Satí":           { lat: -25.3100, lng: -57.5700 },
  "Barrio Jara":         { lat: -25.3000, lng: -57.6300 },
  "San Pablo":           { lat: -25.3200, lng: -57.6200 },
  "Barrio Obrero":       { lat: -25.3050, lng: -57.6350 },
  "Trinidad":            { lat: -25.2800, lng: -57.5900 },
  "Mburucuyá":           { lat: -25.2950, lng: -57.6150 },
  "Pettirossi":          { lat: -25.2920, lng: -57.6250 },
  "Virgen de la Asunción":{ lat: -25.3150, lng: -57.6050 },
  "Loma Pytá":           { lat: -25.2600, lng: -57.5500 },
  "Mcal. López":         { lat: -25.2870, lng: -57.5600 },
  "Capitalía":           { lat: -25.2830, lng: -57.6500 },
  "Zeballos Cué":        { lat: -25.3300, lng: -57.6100 },
  "Mariscal Estigarribia":{ lat: -25.3400, lng: -57.5900 },
  // Greater Asuncion metro
  "San Lorenzo":         { lat: -25.3423, lng: -57.5073 },
  "Fernando de la Mora": { lat: -25.3350, lng: -57.5250 },
  "Luque":               { lat: -25.2669, lng: -57.4840 },
  "Lambaré":             { lat: -25.3400, lng: -57.6100 },
  "Mariano Roque Alonso":{ lat: -25.1742, lng: -57.5340 },
  "Capiatá":             { lat: -25.3533, lng: -57.4502 },
  "Ñemby":               { lat: -25.3950, lng: -57.5550 },
  "Villa Elisa":         { lat: -25.3700, lng: -57.4900 },
  "Itauguá":             { lat: -25.3897, lng: -57.3560 },
  "Limpio":              { lat: -25.1700, lng: -57.4700 },
};

// Default fallback — city center of Asuncion
const DEFAULT_COORDS = { lat: -25.2867, lng: -57.6466 };

function getCoords(neighborhood) {
  if (!neighborhood) return DEFAULT_COORDS;
  // Exact match
  if (NEIGHBORHOOD_COORDS[neighborhood]) return NEIGHBORHOOD_COORDS[neighborhood];
  // Partial match
  const key = Object.keys(NEIGHBORHOOD_COORDS).find(k =>
    neighborhood.toLowerCase().includes(k.toLowerCase()) ||
    k.toLowerCase().includes(neighborhood.toLowerCase())
  );
  if (key) return NEIGHBORHOOD_COORDS[key];
  // Add small random jitter to default so pins don't stack
  return {
    lat: DEFAULT_COORDS.lat + (Math.random() - 0.5) * 0.05,
    lng: DEFAULT_COORDS.lng + (Math.random() - 0.5) * 0.05,
  };
}

module.exports = { NEIGHBORHOOD_COORDS, DEFAULT_COORDS, getCoords };
