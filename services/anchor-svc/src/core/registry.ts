import { AnchorError, type EntityRegistry, type EntityRegistryEntry } from '../domain/types.js';

export function lookupEntity(registry: EntityRegistry, entityId: string): EntityRegistryEntry {
  if (!Object.prototype.hasOwnProperty.call(registry, entityId)) {
    throw new AnchorError('ENTITY_NOT_REGISTERED', `no registry entry for entityId=${entityId}`);
  }
  return registry[entityId]!;
}
