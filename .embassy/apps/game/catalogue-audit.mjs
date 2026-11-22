import { fullCatalogue, loadCatalogue } from "@embassy/tasks";
import { categoryTargets } from "@embassy/contracts";
import { entrance, shortestPath, stations } from "@embassy/simulation";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
const { version, definitions } = loadCatalogue(fullCatalogue, true);
const counts = {};
for (const category of Object.keys(categoryTargets))
  counts[category] = definitions.filter((d) => d.category === category).length;
const locations = Object.fromEntries(
  stations.map(({ room, position }) => [
    room,
    {
      definitions: definitions.filter((d) => d.rooms.includes(room)).length,
      entrance_distance: shortestPath(entrance, position).length,
    },
  ]),
);
const digest = createHash("sha256")
  .update(
    readFileSync(
      new URL("../../packages/tasks/src/dispatch-1.json", import.meta.url),
      "utf8",
    ).replaceAll("\r\n", "\n"),
  )
  .digest("hex");
console.log(
  JSON.stringify(
    {
      version,
      total: definitions.length,
      counts,
      unique_ids: new Set(definitions.map((d) => d.id)).size,
      unique_titles: new Set(definitions.map((d) => d.title)).size,
      unique_descriptions: new Set(definitions.map((d) => d.description)).size,
      locations,
      sha256: digest,
    },
    null,
    2,
  ),
);
