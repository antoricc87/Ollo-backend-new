// Drop-in replacement for bson's ObjectId.isValid, used since the move to PostgreSQL.
// Accepts UUIDs (current Prisma @default(uuid()) ids) and legacy 24-char hex ObjectIds.
const UUID_REGEX =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const LEGACY_OBJECT_ID_REGEX = /^[0-9a-f]{24}$/i;

export const ObjectId = {
  isValid(id: unknown): boolean {
    return (
      typeof id === "string" &&
      (UUID_REGEX.test(id) || LEGACY_OBJECT_ID_REGEX.test(id))
    );
  },
};
