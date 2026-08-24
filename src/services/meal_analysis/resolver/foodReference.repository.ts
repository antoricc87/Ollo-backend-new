import prisma from "../../../utility/prismaClient";
import {
  FoodCandidate,
  ReferencePortion,
  ResolvedReference,
  ResolutionMethod,
} from "./foodResolver.types";

const NEGATIVE_CACHE_MS = 7 * 24 * 3600 * 1000;

export function normalizeTerm(s: string): string {
  return (s || "")
    .toLowerCase()
    .replace(/[^a-z0-9%.,' -]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/^[.,'\- ]+|[.,'\- ]+$/g, "");
}

export type CachedAlias =
  | { kind: "hit"; reference: ResolvedReference & { id: string }; score: number | null; method: string | null }
  | { kind: "negative" }
  | { kind: "miss" };

function toResolved(row: any): ResolvedReference & { id: string } {
  return {
    id: row.id,
    source: row.source,
    sourceId: row.sourceId,
    dataType: row.dataType,
    description: row.description,
    brand: row.brand,
    per100g: row.per100g,
    portions: Array.isArray(row.portions) ? row.portions : [],
  };
}

export async function findAlias(term: string, brand: string): Promise<CachedAlias> {
  const row = await prisma.foodReferenceAlias.findUnique({
    where: { term_brand: { term, brand } },
    include: { reference: true },
  });
  if (!row) return { kind: "miss" };
  if (!row.referenceId || !row.reference) {
    if (Date.now() - new Date(row.createdAt).getTime() > NEGATIVE_CACHE_MS) return { kind: "miss" };
    return { kind: "negative" };
  }
  return { kind: "hit", reference: toResolved(row.reference), score: row.score, method: row.method };
}

export async function saveMatch(
  term: string,
  brand: string,
  candidate: FoodCandidate,
  score: number | null,
  method: ResolutionMethod
): Promise<ResolvedReference & { id: string }> {
  const reference = await prisma.foodReference.upsert({
    where: { source_sourceId: { source: candidate.source, sourceId: candidate.sourceId } },
    create: {
      source: candidate.source,
      sourceId: candidate.sourceId,
      dataType: candidate.dataType,
      description: candidate.description,
      brand: candidate.brand,
      per100g: candidate.per100g as any,
    },
    update: {
      description: candidate.description,
      dataType: candidate.dataType,
      brand: candidate.brand,
      per100g: candidate.per100g as any,
    },
  });
  await prisma.foodReferenceAlias.upsert({
    where: { term_brand: { term, brand } },
    create: { term, brand, referenceId: reference.id, score, method },
    update: { referenceId: reference.id, score, method, createdAt: new Date() },
  });
  return toResolved(reference);
}

export async function saveNoMatch(term: string, brand: string, method: ResolutionMethod) {
  await prisma.foodReferenceAlias.upsert({
    where: { term_brand: { term, brand } },
    create: { term, brand, referenceId: null, score: null, method },
    update: { referenceId: null, score: null, method, createdAt: new Date() },
  });
}

export async function savePortions(referenceId: string, portions: ReferencePortion[]) {
  await prisma.foodReference.update({ where: { id: referenceId }, data: { portions: portions as any } });
}
