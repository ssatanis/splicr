import pg from "pg"; import fs from "node:fs";
const env = Object.fromEntries(fs.readFileSync(".env","utf8").split("\n").filter(l=>l.includes("=")&&!l.trim().startsWith("#")).map(l=>{const i=l.indexOf("=");return [l.slice(0,i).trim(), l.slice(i+1).trim()];}));
const c = new pg.Client({connectionString: env.SUPABASE_DB_URL, ssl:{rejectUnauthorized:false}});
await c.connect();
console.log(JSON.stringify((await c.query(process.argv[2])).rows, null, 1).slice(0, 4000));
await c.end();
