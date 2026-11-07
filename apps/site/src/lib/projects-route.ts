import type { Content, Collection } from '@astro-static-studio/contracts';

export type ProjectsIndexView = { collection: Collection | undefined; items: Content['items'] };

/** Resolve the fixed /projects/ route to the canonical Projects collection. */
export function projectsIndexView(data: Content): ProjectsIndexView {
  return {
    collection: data.collections.find(collection => collection.slug === 'projects'),
    items: data.items,
  };
}
