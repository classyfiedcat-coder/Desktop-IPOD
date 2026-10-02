/** Countries for "Local Stations", named in the user's language. */

const CODES =
  'AR AT AU BE BG BR CA CH CL CN CO CZ DE DK EE EG ES FI FR GB GR HK HR HU ID IE IL IN IR IS IT JP KE KR LT LU LV MA MX MY NG NL NO NZ PE PH PK PL PT RO RS RU SA SE SG SI SK TH TR TW UA US UY VE VN ZA'.split(' ');

let names;
try {
  names = new Intl.DisplayNames([navigator.language || 'en'], { type: 'region' });
} catch {
  names = { of: (c) => c };
}

export const CITY_COUNTRIES = CODES.map((c) => [c, names.of(c) || c]).sort((a, b) => a[1].localeCompare(b[1]));
