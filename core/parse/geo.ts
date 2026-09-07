/** Hometown string -> ISO-3166 alpha-2 with a confidence. Never guesses silently: confidence < 0.9 lands in review flags. */
const US_STATES: Record<string, string> = {
  al: "Alabama", ak: "Alaska", az: "Arizona", ar: "Arkansas", ca: "California", co: "Colorado", ct: "Connecticut", de: "Delaware", fl: "Florida", ga: "Georgia", hi: "Hawaii", id: "Idaho", il: "Illinois", in: "Indiana", ia: "Iowa", ks: "Kansas", ky: "Kentucky", la: "Louisiana", me: "Maine", md: "Maryland", ma: "Massachusetts", mi: "Michigan", mn: "Minnesota", ms: "Mississippi", mo: "Missouri", mt: "Montana", ne: "Nebraska", nv: "Nevada", nh: "New Hampshire", nj: "New Jersey", nm: "New Mexico", ny: "New York", nc: "North Carolina", nd: "North Dakota", oh: "Ohio", ok: "Oklahoma", or: "Oregon", pa: "Pennsylvania", ri: "Rhode Island", sc: "South Carolina", sd: "South Dakota", tn: "Tennessee", tx: "Texas", ut: "Utah", vt: "Vermont", va: "Virginia", wa: "Washington", wv: "West Virginia", wi: "Wisconsin", wy: "Wyoming", dc: "Washington DC",
};
const COUNTRIES: Record<string, string> = {
  "united states": "US", usa: "US", "puerto rico": "PR", pr: "PR", mexico: "MX", mex: "MX", mx: "MX", cuba: "CU", cub: "CU", argentina: "AR", arg: "AR", colombia: "CO", col: "CO", canada: "CA", can: "CA", ecuador: "EC", ecu: "EC", uruguay: "UY", ury: "UY", uru: "UY", nicaragua: "NI", nic: "NI", uzbekistan: "UZ", uzb: "UZ", india: "IN", ind: "IN", serbia: "RS", srb: "RS", turkey: "TR", tur: "TR", türkiye: "TR", "dominican republic": "DO", dom: "DO", venezuela: "VE", ven: "VE", brazil: "BR", bra: "BR", "united kingdom": "GB", uk: "GB", england: "GB", gbr: "GB", ireland: "IE", irl: "IE", japan: "JP", jpn: "JP", philippines: "PH", phi: "PH", phl: "PH", ghana: "GH", gha: "GH", nigeria: "NG", ngr: "NG", russia: "RU", rus: "RU", ukraine: "UA", ukr: "UA", kazakhstan: "KZ", kaz: "KZ", australia: "AU", aus: "AU", germany: "DE", ger: "DE", france: "FR", fra: "FR", spain: "ES", esp: "ES", italy: "IT", ita: "IT", panama: "PA", pan: "PA", guatemala: "GT", gua: "GT", honduras: "HN", hon: "HN", "el salvador": "SV", esa: "SV", peru: "PE", per: "PE", chile: "CL", chi: "CL", bolivia: "BO", bol: "BO", paraguay: "PY", par: "PY", jamaica: "JM", jam: "JM", haiti: "HT", hai: "HT", "south africa": "ZA", rsa: "ZA", armenia: "AM", arm: "AM", georgia: "GE", geo: "GE", poland: "PL", pol: "PL", sweden: "SE", swe: "SE", norway: "NO", nor: "NO", denmark: "DK", den: "DK", netherlands: "NL", ned: "NL", belgium: "BE", bel: "BE", croatia: "HR", cro: "HR", romania: "RO", rou: "RO", hungary: "HU", hun: "HU", china: "CN", chn: "CN", "south korea": "KR", kor: "KR", thailand: "TH", tha: "TH", indonesia: "ID", ina: "ID", "new zealand": "NZ", nzl: "NZ", tonga: "TO", tga: "TO", samoa: "WS", sam: "WS",
};

export interface Geo { country: string | null; confidence: number; note?: string }

export function countryFromHometown(hometown: string): Geo {
  const parts = hometown.split(",").map((s) => s.trim().toLowerCase()).filter(Boolean);
  if (!parts.length) return { country: null, confidence: 0, note: "empty hometown" };
  const last = parts[parts.length - 1];
  const isState = !!US_STATES[last] || Object.values(US_STATES).some((s) => s.toLowerCase() === last);
  if (COUNTRIES[last]) {
    // "Georgia" is both a country and a US state — with a city in front, a US card almost always means the state
    if (isState) return parts.length > 1
      ? { country: "US", confidence: 0.7, note: `'${last}' is both a US state and a country — read as the state` }
      : { country: COUNTRIES[last], confidence: 0.5, note: `'${last}' is both a country and a US state` };
    return { country: COUNTRIES[last], confidence: 1 };
  }
  if (isState) return { country: "US", confidence: 0.95, note: "US inferred from state" };
  // "Las Vegas, Nevada/Honululu, Hawaii" style
  for (const p of parts) for (const k of Object.keys(COUNTRIES)) if (p.includes(k) && k.length > 3) return { country: COUNTRIES[k], confidence: 0.7, note: `matched '${k}' inside '${p}'` };
  return { country: null, confidence: 0, note: `could not resolve country for '${hometown}'` };
}

/** Men's pro limits (lbs). Used only to *suggest* a class when the sheet omits it; always flagged. */
const LIMITS: [number, string][] = [[105, "Minimumweight"], [108, "Light Flyweight"], [112, "Flyweight"], [115, "Super Flyweight"], [118, "Bantamweight"], [122, "Super Bantamweight"], [126, "Featherweight"], [130, "Super Featherweight"], [135, "Lightweight"], [140, "Super Lightweight"], [147, "Welterweight"], [154, "Super Welterweight"], [160, "Middleweight"], [168, "Super Middleweight"], [175, "Light Heavyweight"], [200, "Cruiserweight"], [Infinity, "Heavyweight"]];
export function weightClassFromLbs(lbs: number): string { return LIMITS.find(([lim]) => lbs <= lim + 0.9)![1]; }

export function parseRecord(s: string): { w: number; l: number; d: number; ko: number } | null {
  const m = s.replace(/\s+/g, " ").match(/(\d+)\s*-\s*(\d+)(?:\s*-\s*(\d+))?\s*\(\s*(\d+)\s*KO/i);
  return m ? { w: +m[1], l: +m[2], d: +(m[3] ?? 0), ko: +m[4] } : null;
}
