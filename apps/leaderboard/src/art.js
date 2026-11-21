// A hand-drawn winter chancery. The intrinsic grid is intentionally low resolution.
export function drawEmbassy(canvas) {
  const c = canvas.getContext("2d");
  canvas.width = 240;
  canvas.height = 100;
  function rect(x, y, w, h, colour) {
    c.fillStyle = colour;
    c.fillRect(x, y, w, h);
  }
  rect(0, 0, 240, 100, "#183a50");
  rect(0, 41, 240, 53, "#235064");
  rect(0, 58, 240, 35, "#346775");
  for (let i = 0; i < 60; i++)
    rect(
      (i * 53 + 13) % 240,
      (i * 31 + 3) % 64,
      i % 4 === 0 ? 2 : 1,
      1,
      "#82a6a5",
    );
  rect(184, 12, 15, 15, "#ffc675");
  rect(181, 15, 21, 9, "#ffc675");
  for (let x = 0; x < 240; x += 15) {
    const h = 9 + ((x * 7) % 22);
    rect(x, 75 - h, 12, h, "#254959");
    rect(x + 2, 76 - h, 2, 2, "#608180");
  }
  rect(0, 79, 240, 21, "#b4cfca");
  rect(0, 84, 240, 16, "#89acae");
  function pine(x, y, s) {
    for (let i = 0; i < 5; i++) {
      rect(x + (4 - i) * s, y + i * 3 * s, (i * 2 + 1) * s, 4 * s, "#1a4148");
      rect(x + (4 - i) * s, y + i * 3 * s, 2 * s, s, "#8db9b6");
    }
    rect(x + 4 * s, y + 16 * s, s, 2 * s, "#243d45");
  }
  pine(201, 48, 2);
  pine(21, 52, 2);
  pine(220, 68, 1);
  pine(8, 68, 1);
  rect(49, 52, 141, 30, "#35525a");
  rect(52, 54, 134, 25, "#afaaa0");
  rect(48, 49, 142, 5, "#456575");
  rect(50, 47, 138, 3, "#e4e4c9");
  for (let i = 0; i < 11; i++) {
    const x = 56 + i * 12;
    rect(x, 57, 7, 12, "#314b57");
    rect(x + 1, 58, 5, 4, "#ffc674");
    rect(x + 1, 64, 5, 3, "#dc9556");
  }
  rect(93, 42, 50, 40, "#d3cbbb");
  rect(90, 40, 56, 4, "#324b55");
  for (let i = 0; i < 6; i++)
    rect(88 + i * 5, 39 - i * 2, 60 - i * 10, 3, i % 2 ? "#c0cebe" : "#e4e4ce");
  rect(114, 31, 8, 4, "#527780");
  rect(117, 12, 1, 17, "#e1dbc8");
  rect(118, 12, 16, 9, "#e7e9d7");
  rect(123, 12, 3, 9, "#2b628a");
  rect(118, 15, 16, 3, "#2b628a");
  rect(110, 54, 15, 27, "#25434c");
  rect(112, 57, 5, 11, "#c48755");
  rect(119, 57, 4, 11, "#f4b970");
  for (const x of [95, 104, 129, 138]) {
    rect(x, 46, 3, 32, "#eee3c8");
    rect(x + 3, 46, 1, 32, "#8d958c");
    rect(x - 1, 77, 5, 2, "#798784");
  }
  for (let i = 0; i < 3; i++)
    rect(91 - i * 3, 80 + i * 2, 54 + i * 6, 2, "#d5d9c1");
  rect(50, 87, 140, 1, "#698b92");
}
