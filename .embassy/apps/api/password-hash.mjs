import { randomBytes, scryptSync } from "node:crypto";
let input = "";
for await (const chunk of process.stdin) input += chunk;
const password = input.replace(/\r?\n$/, "");
if (password.length < 16 || password.length > 256)
  throw Error("Use a 16–256 character organiser password");
const salt = randomBytes(16).toString("hex");
console.log(salt + "." + scryptSync(password, salt, 64).toString("hex"));
