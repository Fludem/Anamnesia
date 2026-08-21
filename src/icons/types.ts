import { z } from 'zod';

/** Every game-icons SVG uses this viewBox; the extractor asserts it rather than storing it. */
export const ICON_VIEWBOX = '0 0 512 512';

export const LicenseSchema = z.enum(['CC-BY-3.0', 'CC0-1.0']);
export type License = z.infer<typeof LicenseSchema>;

export const IconEntrySchema = z.object({
  /** `${author}/${slug}` — slugs collide across authors, so the author is part of the identity. */
  id: z.string().regex(/^[a-z0-9-]+\/[a-z0-9-]+$/),
  slug: z.string().min(1),
  /** Upstream directory name, e.g. "lorc". */
  author: z.string().min(1),
  /** Display name from upstream license.txt, e.g. "Lorc". */
  authorName: z.string().min(1),
  authorUrl: z.string().url().optional(),
  license: LicenseSchema,
  /** Curated tags from content/icon-tags.json only. Slug tokens are derived at search time. */
  tags: z.array(z.string()),
  /** Foreground path data (SVG `d` attribute) in the 0 0 512 512 coordinate space. */
  d: z.string().min(1),
});
export type IconEntry = z.infer<typeof IconEntrySchema>;

export const IconIndexSchema = z.object({
  version: z.literal(1),
  source: z.object({
    repo: z.string(),
    commit: z.string().regex(/^[0-9a-f]{40}$/),
  }),
  icons: z.array(IconEntrySchema),
});
export type IconIndex = z.infer<typeof IconIndexSchema>;
