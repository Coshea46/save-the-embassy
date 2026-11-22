import type { Position, Room } from "@embassy/contracts";

// # masonry, F furniture, + doors, = public corridor, . room floors
export const tiles = [
  "###################",
  "#.....#.....#.....#",
  "#..F..#..F..#..F..#",
  "#.....#.....#.....#",
  "###+#####+#####+###",
  "#=================#",
  "###+#####+#####+###",
  "#.....#.....#.....#",
  "#..F..#..F..#..F..#",
  "#.....#.....#.....#",
  "###################",
] as const;
export const entrance: Position = { x: 9, y: 5 };
export const stations: ReadonlyArray<{ room: Room; position: Position }> = [
  { room: "reception", position: { x: 2, y: 2 } },
  { room: "office", position: { x: 8, y: 2 } },
  { room: "kitchen", position: { x: 16, y: 2 } },
  { room: "plant", position: { x: 2, y: 8 } },
  { room: "archive", position: { x: 10, y: 8 } },
  { room: "sauna", position: { x: 16, y: 8 } },
];
export const samePosition = (a: Position, b: Position) =>
  a.x === b.x && a.y === b.y;
export function walkable(p: Position) {
  return (
    Number.isInteger(p.x) &&
    Number.isInteger(p.y) &&
    ".=+".includes(tiles[p.y]?.[p.x] ?? "#")
  );
}
const width = tiles[0].length;
const key = (p: Position) => p.y * width + p.x;
const routes = new Map<number, Position[]>();
export function shortestPath(from: Position, to: Position): Position[] {
  if (!walkable(from) || !walkable(to))
    throw new RangeError("Invalid endpoint");
  const cacheKey = key(from) * width * tiles.length + key(to);
  let route = routes.get(cacheKey);
  if (!route) {
    const queue = [from];
    const parent = new Map<number, Position>([[key(from), from]]);
    for (let i = 0; i < queue.length && !parent.has(key(to)); i++) {
      const p = queue[i]!;
      for (const [dx, dy] of [
        [0, -1],
        [1, 0],
        [0, 1],
        [-1, 0],
      ] as const) {
        const next = { x: p.x + dx, y: p.y + dy };
        if (walkable(next) && !parent.has(key(next))) {
          parent.set(key(next), p);
          queue.push(next);
        }
      }
    }
    if (!parent.has(key(to))) throw new RangeError("Disconnected destination");
    route = [];
    for (let p = to; !samePosition(p, from); p = parent.get(key(p))!)
      route.push(p);
    route.reverse();
    routes.set(cacheKey, route);
  }
  return route.map((p) => ({ ...p }));
}
