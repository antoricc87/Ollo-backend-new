import { Per100g } from "./foodResolver.types";

/**
 * Map FoodData Central nutrient records (per 100 g) to Ollo's nutrient fields.
 * Pure function — unit tested.
 *
 * Accepts both shapes FDC returns:
 *  - search results:  { nutrientId, value, unitName }
 *  - food detail:     { nutrient: { id, unitName }, amount }
 */
export interface FdcNutrientLike {
  nutrientId?: number;
  value?: number;
  unitName?: string;
  nutrient?: { id: number; unitName?: string };
  amount?: number;
}

const ID = {
  ENERGY_KCAL: 1008,
  ENERGY_ATWATER_GENERAL: 2047,
  ENERGY_ATWATER_SPECIFIC: 2048,
  PROTEIN: 1003,
  FAT: 1004,
  CARB_DIFF: 1005,
  CARB_SUM: 1050,
  FIBER: 1079,
  SUGARS_TOTAL: 2000,
  SUGARS_NLEA: 1063,
  SUGARS_ADDED: 1235,
  CALCIUM: 1087,
  IRON: 1089,
  MAGNESIUM: 1090,
  POTASSIUM: 1092,
  SODIUM: 1093,
  ZINC: 1095,
  VIT_C: 1162,
  VIT_D_UG: 1114,
  VIT_D_IU: 1110,
  VIT_B12: 1178,
  VIT_E: 1109,
  CHOLESTEROL: 1253,
  SAT_FAT: 1258,
  ALA_18_3_N3: 1404,
  F18_3_TOTAL: 1270,
  EPA_20_5: 1278,
  DPA_22_5: 1280,
  DHA_22_6: 1272,
};

type Target = "g" | "mg" | "ug" | "kcal";

/** Convert a value from FDC unit to the target unit. Unknown units are returned as-is. */
export function convertUnit(value: number, from: string | undefined, to: Target): number {
  const f = (from || "").toLowerCase().replace("µ", "u");
  if (!f || f === to) return value;
  const toGrams: Record<string, number> = { g: 1, mg: 1e-3, ug: 1e-6 };
  if (toGrams[f] != null && toGrams[to] != null) return (value * toGrams[f]) / toGrams[to];
  if (f === "kj" && to === "kcal") return value / 4.184;
  return value;
}

export function mapFdcNutrients(list: FdcNutrientLike[] | undefined): Per100g {
  const byId = new Map<number, { value: number; unit: string | undefined }>();
  for (const n of list || []) {
    const id = n.nutrientId ?? n.nutrient?.id;
    const value = n.value ?? n.amount;
    if (id == null || value == null || !isFinite(value)) continue;
    byId.set(id, { value, unit: n.unitName ?? n.nutrient?.unitName });
  }
  const get = (id: number, to: Target): number | null => {
    const hit = byId.get(id);
    return hit ? convertUnit(hit.value, hit.unit, to) : null;
  };
  const first = (ids: number[], to: Target): number => {
    for (const id of ids) {
      const v = get(id, to);
      if (v != null) return v;
    }
    return 0;
  };

  const proteins = first([ID.PROTEIN], "g");
  const fats = first([ID.FAT], "g");
  const carbohydrates = first([ID.CARB_DIFF, ID.CARB_SUM], "g");
  let calories = first([ID.ENERGY_KCAL, ID.ENERGY_ATWATER_SPECIFIC, ID.ENERGY_ATWATER_GENERAL], "kcal");
  if (!calories) calories = 4 * proteins + 4 * carbohydrates + 9 * fats;

  const sugarsTotal = first([ID.SUGARS_TOTAL, ID.SUGARS_NLEA], "g");
  const addedSugar = first([ID.SUGARS_ADDED], "g");

  let vitaminD = get(ID.VIT_D_UG, "ug");
  if (vitaminD == null) {
    const iu = get(ID.VIT_D_IU, "ug"); // IU is not a mass unit; convert explicitly
    vitaminD = iu != null ? iu * 0.025 : 0;
  }

  const ala = get(ID.ALA_18_3_N3, "g") ?? get(ID.F18_3_TOTAL, "g") ?? 0;
  const omega_3 = ala + first([ID.EPA_20_5], "g") + first([ID.DPA_22_5], "g") + first([ID.DHA_22_6], "g");

  const r = (n: number, d = 3) => Math.round(n * 10 ** d) / 10 ** d;
  return {
    calories: r(calories, 1),
    carbohydrates: r(carbohydrates),
    proteins: r(proteins),
    fats: r(fats),
    saturatedFats: r(first([ID.SAT_FAT], "g")),
    fiber: r(first([ID.FIBER], "g")),
    sodium: r(first([ID.SODIUM], "mg")),
    naturalSugar: r(Math.max(0, sugarsTotal - addedSugar)),
    addedSugar: r(addedSugar),
    calcium: r(first([ID.CALCIUM], "mg")),
    magnesium: r(first([ID.MAGNESIUM], "mg")),
    iron: r(first([ID.IRON], "mg")),
    potassium: r(first([ID.POTASSIUM], "mg")),
    omega_3: r(omega_3),
    cholesterol: r(first([ID.CHOLESTEROL], "mg")),
    zinc: r(first([ID.ZINC], "mg")),
    vitaminD: r(vitaminD),
    vitaminB12: r(first([ID.VIT_B12], "ug")),
    vitaminC: r(first([ID.VIT_C], "mg")),
    vitaminE: r(first([ID.VIT_E], "mg")),
  };
}

/** Scale a per-100 g vector to a gram amount. */
export function scalePer100g(per100g: Per100g, grams: number): Per100g {
  const k = Math.max(0, grams) / 100;
  const out: any = {};
  for (const key of Object.keys(per100g) as (keyof Per100g)[]) {
    out[key] = Math.round(per100g[key] * k * 1000) / 1000;
  }
  return out as Per100g;
}
