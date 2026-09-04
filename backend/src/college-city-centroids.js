// 2024 U.S. Census Gazetteer internal points for Arkansas incorporated places.
// These are deliberately coarse fallback coordinates for college Nearby discovery.
// Existing exact school coordinates are preserved because M4 catalog materialization
// uses INSERT OR IGNORE. Do not describe these as exact venue or campus locations.
// Source: https://www2.census.gov/geo/docs/maps-data/data/gazetteer/2024_Gazetteer/2024_gaz_place_05.txt
export const ARKANSAS_CITY_CENTROIDS = Object.freeze({
  "Arkadelphia": Object.freeze({ latitude:34.12738, longitude:-93.070851 }),
  "Batesville": Object.freeze({ latitude:35.768572, longitude:-91.622652 }),
  "Bentonville": Object.freeze({ latitude:36.352662, longitude:-94.231181 }),
  "Camden": Object.freeze({ latitude:33.567672, longitude:-92.849064 }),
  "Clarksville": Object.freeze({ latitude:35.453918, longitude:-93.481558 }),
  "Conway": Object.freeze({ latitude:35.074404, longitude:-92.467004 }),
  "De Queen": Object.freeze({ latitude:34.042245, longitude:-94.342133 }),
  "El Dorado": Object.freeze({ latitude:33.218982, longitude:-92.664071 }),
  "Fayetteville": Object.freeze({ latitude:36.071455, longitude:-94.166564 }),
  "Fort Smith": Object.freeze({ latitude:35.349276, longitude:-94.370883 }),
  "Harrison": Object.freeze({ latitude:36.242592, longitude:-93.11765 }),
  "Hot Springs": Object.freeze({ latitude:34.489442, longitude:-93.050254 }),
  "Jonesboro": Object.freeze({ latitude:35.819755, longitude:-90.679033 }),
  "Little Rock": Object.freeze({ latitude:34.725393, longitude:-92.358556 }),
  "Magnolia": Object.freeze({ latitude:33.276698, longitude:-93.226247 }),
  "Malvern": Object.freeze({ latitude:34.373579, longitude:-92.82125 }),
  "Mena": Object.freeze({ latitude:34.58184, longitude:-94.236518 }),
  "Monticello": Object.freeze({ latitude:33.624778, longitude:-91.793722 }),
  "Mountain Home": Object.freeze({ latitude:36.335074, longitude:-92.3841 }),
  "Newport": Object.freeze({ latitude:35.623772, longitude:-91.231682 }),
  "North Little Rock": Object.freeze({ latitude:34.781752, longitude:-92.235057 }),
  "Paragould": Object.freeze({ latitude:36.052289, longitude:-90.510464 }),
  "Pine Bluff": Object.freeze({ latitude:34.211591, longitude:-92.017555 }),
  "Russellville": Object.freeze({ latitude:35.276328, longitude:-93.138743 }),
  "Searcy": Object.freeze({ latitude:35.241134, longitude:-91.735223 }),
  "Siloam Springs": Object.freeze({ latitude:36.185382, longitude:-94.530029 }),
  "Springdale": Object.freeze({ latitude:36.191438, longitude:-94.155062 }),
  "Walnut Ridge": Object.freeze({ latitude:36.084796, longitude:-90.94684 }),
  "West Memphis": Object.freeze({ latitude:35.149554, longitude:-90.199266 })
});

export function arkansasCityCentroid(city) {
  return ARKANSAS_CITY_CENTROIDS[String(city || "").trim()] || null;
}
