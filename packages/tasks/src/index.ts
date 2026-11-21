import {
  catalogueSchema,
  categoryTargets,
  rooms,
  type Catalogue,
} from "@embassy/contracts";
import sample from "./sample.json" with { type: "json" };

export function loadCatalogue(raw: unknown, full = false): Catalogue {
  const catalogue = catalogueSchema.parse(raw);
  for (const key of ["id", "title", "description"] as const) {
    const values = catalogue.definitions.map((d) =>
      d[key].trim().toLowerCase(),
    );
    if (new Set(values).size !== values.length)
      throw new Error("Duplicate incident " + key);
  }
  for (const room of rooms) {
    if (!catalogue.definitions.some((d) => d.rooms.includes(room)))
      throw new Error("No flavour for " + room);
  }
  if (full) {
    for (const [category, count] of Object.entries(categoryTargets)) {
      if (
        catalogue.definitions.filter((d) => d.category === category).length !==
        count
      )
        throw new Error("Wrong distribution for " + category);
    }
  }
  return catalogue;
}
export const sampleCatalogue = loadCatalogue(sample);
