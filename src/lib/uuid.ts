const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Whether `id` has the shape of a UUID. A non-UUID id is never sent to Supabase, whose id columns are `uuid`. */
export function isUuid(id: string): boolean {
  return UUID.test(id);
}
